//! Remote companion transport. No CLI execution, host database or provider credentials.
use futures_util::StreamExt;
use reqwest::{header, Method, Response, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

pub use council_core::Event;
const DEVICE: &str = "CouncilDevice";
const PAIR: &str = "CouncilPair";
const MAX_JSON: usize = 8 * 1024 * 1024;

#[cfg(test)]
mod tests;

#[derive(Debug, Serialize)]
pub struct Error {
    pub status: u16,
    pub message: String,
}
pub type Result<T> = std::result::Result<T, Error>;
fn error(status: u16, message: &str) -> Error {
    Error {
        status,
        message: message.into(),
    }
}
impl From<reqwest::Error> for Error {
    fn from(_: reqwest::Error) -> Self {
        error(
            502,
            "Cannot reach the host securely. Check Tailscale and the host connection.",
        )
    }
}

// Intentionally not Debug and never returned from a frontend command.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Credentials {
    origin: String,
    device: String,
    expires: i64,
}
#[derive(Clone)]
pub struct Client {
    http: reqwest::Client,
    origin: Option<Url>,
    pending: Option<String>,
    device: Option<String>,
    expires: i64,
}
fn secret(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn origin(value: &str) -> Result<Url> {
    let u =
        Url::parse(value).map_err(|_| error(400, "Enter the HTTPS pairing link from your PC."))?;
    if u.scheme() != "https"
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
        || u.path() != "/"
    {
        return Err(error(
            400,
            "Only an HTTPS host origin without credentials is allowed.",
        ));
    }
    Ok(u)
}
pub fn pairing_link(value: &str) -> Result<(Url, String)> {
    let mut url = Url::parse(value.trim())
        .map_err(|_| error(400, "Paste a fresh pairing link from your PC."))?;
    if !matches!(url.path(), "/companion/" | "/companion") || url.query().is_some() {
        return Err(error(400, "Use the complete companion pairing link."));
    }
    let challenge = url
        .fragment()
        .and_then(|f| f.strip_prefix("pair="))
        .filter(|s| secret(s))
        .ok_or_else(|| error(400, "The pairing challenge is missing or invalid."))?
        .to_owned();
    url.set_fragment(None);
    url.set_path("/");
    Ok((origin(url.as_str())?, challenge))
}
fn allowed(method: &str, path: &str) -> bool {
    match (method, path) {
        ("GET", "/session" | "/state")
        | ("PUT", "/draft")
        | ("POST", "/pair/complete" | "/jobs" | "/files/read" | "/usage/refresh" | "/logout") => {
            true
        }
        ("POST", p) => p
            .strip_prefix("/jobs/")
            .and_then(|p| p.strip_suffix("/cancel"))
            .is_some_and(|id| {
                !id.is_empty()
                    && id.len() <= 64
                    && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            }),
        _ => false,
    }
}
impl Client {
    pub fn new() -> Result<Self> {
        let roots =
            rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let tls = rustls::ClientConfig::builder_with_provider(std::sync::Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .map_err(|_| error(500, "Cannot configure secure transport."))?
        .with_root_certificates(roots)
        .with_no_client_auth();
        let http = reqwest::Client::builder()
            .tls_backend_preconfigured(tls)
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(Duration::from_secs(40))
            .user_agent("AgentCouncil-Companion/0.1")
            .build()?;
        Ok(Self {
            http,
            origin: None,
            pending: None,
            device: None,
            expires: 0,
        })
    }
    pub fn restore(&mut self, saved: &str) -> Result<()> {
        let record: Credentials = serde_json::from_str(saved)
            .map_err(|_| error(400, "Saved connection is invalid. Pair again."))?;
        let host = origin(&record.origin)?;
        if !secret(&record.device) || record.expires <= 0 {
            return Err(error(400, "Saved connection is invalid. Pair again."));
        }
        self.origin = Some(host);
        self.device = Some(record.device);
        self.expires = record.expires;
        self.pending = None;
        Ok(())
    }
    /// For native encrypted storage only; must never be exposed through JS IPC.
    pub fn storage_record(&self) -> Option<String> {
        if self.expires <= 0 {
            return None;
        }
        Some(
            serde_json::to_string(&Credentials {
                origin: self.origin.as_ref()?.origin().ascii_serialization(),
                device: self.device.clone()?,
                expires: self.expires,
            })
            .ok()?,
        )
    }
    pub fn forget(&mut self) {
        self.origin = None;
        self.device = None;
        self.pending = None;
        self.expires = 0;
    }
    fn builder(&self, method: Method, path: &str) -> Result<reqwest::RequestBuilder> {
        let host = self
            .origin
            .as_ref()
            .ok_or_else(|| error(401, "Pair this app with your PC."))?;
        let url = host
            .join(&format!("companion/v1{path}"))
            .map_err(|_| error(400, "Invalid companion operation."))?;
        let mut cookies = Vec::new();
        if let Some(token) = &self.device {
            cookies.push(format!("{DEVICE}={token}"));
        }
        if let Some(token) = &self.pending {
            cookies.push(format!("{PAIR}={token}"));
        }
        let mut request = self
            .http
            .request(method, url)
            .header(header::ORIGIN, host.origin().ascii_serialization());
        if !cookies.is_empty() {
            request = request.header(header::COOKIE, cookies.join("; "));
        }
        Ok(request)
    }
    fn absorb(&mut self, response: &Response) -> Result<()> {
        for raw in response.headers().get_all(header::SET_COOKIE) {
            let Ok(raw) = raw.to_str() else {
                continue;
            };
            let fields: Vec<_> = raw.split(';').map(str::trim).collect();
            let Some((name, value)) = fields[0].split_once('=') else {
                continue;
            };
            let slot = match name {
                DEVICE => &mut self.device,
                PAIR => &mut self.pending,
                _ => continue,
            };
            if fields.iter().any(|s| s.eq_ignore_ascii_case("Max-Age=0")) {
                *slot = None;
                continue;
            }
            if !secret(value)
                || !fields.iter().any(|s| s.eq_ignore_ascii_case("Secure"))
                || !fields.iter().any(|s| s.eq_ignore_ascii_case("HttpOnly"))
                || !fields
                    .iter()
                    .any(|s| s.eq_ignore_ascii_case("SameSite=Strict"))
                || !fields
                    .iter()
                    .any(|s| s.eq_ignore_ascii_case("Path=/companion"))
            {
                return Err(error(502, "Host returned an unsafe device cookie."));
            }
            *slot = Some(value.into());
        }
        Ok(())
    }
    async fn body(response: Response) -> Result<Value> {
        let status = response.status().as_u16();
        if (300..400).contains(&status) {
            return Err(error(
                502,
                "The host redirected this request. Check the pairing address.",
            ));
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_JSON as u64)
        {
            return Err(error(502, "Host response is too large."));
        }
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            if bytes.len() + chunk.len() > MAX_JSON {
                return Err(error(502, "Host response is too large."));
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|_| error(502, "Host returned an invalid response."))?;
        if !(200..300).contains(&status) {
            return Err(error(
                status,
                value["error"].as_str().unwrap_or("Host request failed."),
            ));
        }
        Ok(value)
    }
    pub async fn pair(&mut self, link: &str, name: &str) -> Result<Value> {
        let (host, code) = pairing_link(link)?;
        if name.trim().is_empty() || name.chars().count() > 60 || name.chars().any(char::is_control)
        {
            return Err(error(400, "Enter a device name under 60 characters."));
        }
        let mut candidate = Self {
            http: self.http.clone(),
            origin: Some(host),
            pending: None,
            device: None,
            expires: 0,
        };
        let response = candidate
            .builder(Method::POST, "/pair")?
            .json(&json!({"code":code,"name":name}))
            .timeout(Duration::from_secs(30))
            .send()
            .await?;
        let ok = response.status().is_success();
        if ok {
            candidate.absorb(&response)?;
        }
        let value = Self::body(response).await?;
        if candidate.pending.is_none() {
            return Err(error(502, "Host did not create a pending device session."));
        }
        *self = candidate;
        Ok(value)
    }
    pub async fn request(
        &mut self,
        method: &str,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value> {
        if !allowed(method, path) {
            return Err(error(
                400,
                "This operation is not available to a companion.",
            ));
        }
        if body.as_ref().is_some_and(|b| b.to_string().len() > 131072) {
            return Err(error(413, "Request is too large."));
        }
        let method =
            Method::from_bytes(method.as_bytes()).map_err(|_| error(400, "Invalid method."))?;
        let mut request = self.builder(method, path)?.timeout(Duration::from_secs(30));
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await?;
        if response.status().as_u16() == 401 {
            self.device = None;
            self.expires = 0;
            if path == "/pair/complete" {
                self.pending = None;
            }
        }
        let mut next = self.clone();
        if response.status().is_success() {
            next.absorb(&response)?;
        }
        let value = Self::body(response).await?;
        if path == "/pair/complete" && value["status"] != "pending" {
            if next.device.is_none() || value["protocol"] != "companion-v1" {
                return Err(error(502, "Host pairing response was incomplete."));
            }
            match value["expires"].as_i64().filter(|e| *e > 0) {
                Some(expires) => next.expires = expires,
                None => {
                    return Err(error(502, "Device expiry was missing."));
                }
            }
        }
        if path == "/logout" {
            next.forget();
        }
        *self = next;
        Ok(value)
    }
    pub async fn events(&self, after: i64) -> Result<Response> {
        if after < 0 {
            return Err(error(400, "Invalid event cursor."));
        }
        let response = self
            .builder(Method::GET, &format!("/events?after={after}"))?
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            return Err(error(
                status,
                "Event connection failed. Reconnect or pair again.",
            ));
        }
        if !response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|h| h.to_str().ok())
            .is_some_and(|s| s.starts_with("text/event-stream"))
        {
            return Err(error(502, "Host did not return an event stream."));
        }
        Ok(response)
    }
}

#[derive(Default)]
pub struct Decoder {
    buffer: Vec<u8>,
}
impl Decoder {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Event>> {
        self.buffer.extend_from_slice(bytes);
        if self.buffer.len() > 1024 * 1024 {
            return Err(error(502, "Event frame exceeds the size limit."));
        }
        let mut events = Vec::new();
        while let Some((at, len)) = self
            .buffer
            .windows(2)
            .position(|p| p == b"\n\n")
            .map(|i| (i, 2))
            .into_iter()
            .chain(
                self.buffer
                    .windows(4)
                    .position(|p| p == b"\r\n\r\n")
                    .map(|i| (i, 4)),
            )
            .min_by_key(|(at, _)| *at)
        {
            let frame = self.buffer.drain(..at + len).collect::<Vec<_>>();
            let text =
                std::str::from_utf8(&frame).map_err(|_| error(502, "Invalid event encoding."))?;
            let data = text
                .lines()
                .filter_map(|l| l.strip_prefix("data:").map(str::trim_start))
                .collect::<Vec<_>>()
                .join("\n");
            if !data.is_empty() {
                events.push(
                    serde_json::from_str(&data).map_err(|_| error(502, "Invalid host event."))?,
                );
            }
        }
        Ok(events)
    }
}
