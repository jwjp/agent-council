//! A separate opt-in browser gateway. Local administrator credentials never authenticate here.
use crate::{engine::Engine, model::*, server::Server};
use axum::{
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event as SseEvent, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    convert::Infallible,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;
use tokio::sync::Notify;

const PAIR_SECONDS: i64 = 300;
const DEVICE_SECONDS: i64 = 30 * 24 * 3600;
const DEVICE_COOKIE: &str = "CouncilDevice";
const PAIR_COOKIE: &str = "CouncilPair";
mod assets {
    include!(concat!(env!("OUT_DIR"), "/companion_assets.rs"));
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub enabled: bool,
    pub origin: String,
    pub port: u16,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: false,
            origin: String::new(),
            port: 43128,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
struct Device {
    id: String,
    name: String,
    digest: [u8; 32],
    settings: Settings,
    allow_work: bool,
    created: i64,
    expires: i64,
}
struct Invitation {
    id: String,
    code: [u8; 32],
    expires: i64,
    settings: Settings,
    allow_work: bool,
    claim: Option<([u8; 32], String)>,
    approved: bool,
}
impl Invitation {
    fn can_claim(&self, code: &str, now: i64) -> bool {
        self.expires > now && self.claim.is_none() && matches(&self.code, code)
    }
    fn can_complete(&self, token: &str, now: i64) -> bool {
        self.expires > now && self.claim.as_ref().is_some_and(|(d, _)| matches(d, token))
    }
}
struct Memory {
    config: Config,
    devices: Vec<Device>,
    invitations: Vec<Invitation>,
    ready: bool,
    error: String,
    attempts: VecDeque<Instant>,
    refreshed: HashMap<String, Instant>,
}
pub struct Companion {
    engine: Arc<Engine>,
    state: Mutex<Memory>,
    changed: Notify,
}
pub struct Error(StatusCode, String);
type Reply = Result<Json<Value>, Error>;
impl From<anyhow::Error> for Error {
    fn from(error: anyhow::Error) -> Self {
        let text = error.to_string();
        Self(
            if text.contains("already running") {
                StatusCode::CONFLICT
            } else {
                StatusCode::BAD_REQUEST
            },
            text,
        )
    }
}
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error":self.1}))).into_response()
    }
}
fn fail(status: StatusCode, text: &str) -> Error {
    Error(status, text.into())
}
fn seconds() -> i64 {
    chrono::Utc::now().timestamp()
}
fn secret() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
fn digest(text: &str) -> [u8; 32] {
    Sha256::digest(text.as_bytes()).into()
}
fn matches(stored: &[u8; 32], text: &str) -> bool {
    bool::from(stored.ct_eq(&digest(text)))
}
fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|part| {
            let (key, value) = part.trim().split_once('=')?;
            (key == name && value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit()))
                .then(|| value.to_owned())
        })
}
fn validate_origin(raw: &str) -> anyhow::Result<String> {
    let url = reqwest::Url::parse(raw)?;
    let local = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    anyhow::ensure!((url.scheme()=="https" || (local && url.scheme()=="http")) && url.username().is_empty()
        && url.password().is_none() && url.path()=="/" && url.query().is_none() && url.fragment().is_none(),
        "Enter an HTTPS origin without a path, query or credentials. HTTP is for loopback testing only.");
    Ok(url.origin().ascii_serialization())
}
fn draft_key(device: &Device) -> String {
    format!("companion:draft:{}", device.id)
}
fn grant(device: &Device) -> Value {
    json!({"id":device.id,"name":device.name,"folder":device.settings.folder,"coder":device.settings.coder,
        "reviewers":device.settings.reviewers,"allow_work":device.allow_work,"created":device.created,
        "expires":device.expires,"protocol":"companion-v1"})
}
fn effective(device: &Device, engine: &Engine) -> Settings {
    let mut settings = device.settings.clone();
    let current = engine.settings.lock().unwrap().permissions.clone();
    let rank = |s: &str| match s {
        "all" => 2,
        "coder" => 1,
        _ => 0,
    };
    if rank(&current) < rank(&settings.permissions) {
        settings.permissions = current;
    }
    settings
}
impl Companion {
    pub fn new(engine: Arc<Engine>) -> anyhow::Result<Arc<Self>> {
        let config = engine
            .store
            .get("companion:config")?
            .map(serde_json::from_value)
            .transpose()?
            .unwrap_or_default();
        let mut devices: Vec<Device> = engine
            .store
            .get("companion:devices")?
            .map(serde_json::from_value)
            .transpose()?
            .unwrap_or_default();
        devices.retain(|d| d.expires > seconds());
        Ok(Arc::new(Self {
            engine,
            state: Mutex::new(Memory {
                config,
                devices,
                invitations: vec![],
                ready: false,
                error: String::new(),
                attempts: VecDeque::new(),
                refreshed: HashMap::new(),
            }),
            changed: Notify::new(),
        }))
    }
    fn persist(&self, memory: &Memory) -> anyhow::Result<()> {
        self.engine
            .store
            .put("companion:devices", &json!(memory.devices))
    }
    fn device(&self, headers: &HeaderMap) -> Result<Device, Error> {
        let state = self.state.lock().unwrap();
        if !state.config.enabled {
            return Err(fail(
                StatusCode::SERVICE_UNAVAILABLE,
                "Companion access is disabled.",
            ));
        }
        let token = cookie(headers, DEVICE_COOKIE)
            .ok_or_else(|| fail(StatusCode::UNAUTHORIZED, "Pair this device with the host."))?;
        state
            .devices
            .iter()
            .find(|d| d.expires > seconds() && matches(&d.digest, &token))
            .cloned()
            .ok_or_else(|| {
                fail(
                    StatusCode::UNAUTHORIZED,
                    "This device has expired or was disconnected. Pair again.",
                )
            })
    }
    fn set_cookie(&self, response: &mut Response, name: &str, token: &str, age: i64) {
        let secure = self
            .state
            .lock()
            .unwrap()
            .config
            .origin
            .starts_with("https:");
        let value = format!(
            "{name}={token}; Path=/companion; HttpOnly; SameSite=Strict; Max-Age={age}{}",
            if secure { "; Secure" } else { "" }
        );
        response
            .headers_mut()
            .append(header::SET_COOKIE, HeaderValue::from_str(&value).unwrap());
    }
    pub async fn run(self: Arc<Self>) {
        loop {
            let changed = self.changed.notified();
            let config = self.state.lock().unwrap().config.clone();
            if !config.enabled {
                changed.await;
                continue;
            }
            let result =
                tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, config.port)).await;
            match result {
                Ok(listener) => {
                    {
                        let mut state = self.state.lock().unwrap();
                        state.ready = true;
                        state.error.clear();
                    }
                    tokio::select! {
                        result=async { axum::serve(listener, self.clone().router()).await } => {
                            if let Err(error)=result { self.state.lock().unwrap().error=error.to_string(); }
                        },
                        _=changed=>{},
                    }
                }
                Err(error) => {
                    self.state.lock().unwrap().error =
                        format!("Cannot open companion port: {error}");
                    changed.await;
                }
            }
            self.state.lock().unwrap().ready = false;
        }
    }
    fn router(self: Arc<Self>) -> Router {
        Router::new()
            .route("/companion/v1/pair", post(claim))
            .route("/companion/v1/pair/complete", post(complete))
            .route("/companion/v1/session", get(session))
            .route("/companion/v1/state", get(snapshot))
            .route("/companion/v1/draft", axum::routing::put(draft))
            .route("/companion/v1/jobs", post(start))
            .route("/companion/v1/jobs/{id}/cancel", post(cancel))
            .route("/companion/v1/events", get(events))
            .route("/companion/v1/files/read", post(read_file))
            .route("/companion/v1/usage/refresh", post(refresh))
            .route("/companion/v1/logout", post(logout))
            .fallback(static_file)
            .layer(DefaultBodyLimit::max(131072))
            .layer(middleware::from_fn_with_state(self.clone(), boundary))
            .with_state(self)
    }
}
async fn boundary(State(c): State<Arc<Companion>>, req: Request, next: Next) -> Response {
    let api_request = req.uri().path().starts_with("/companion/v1/");
    let (enabled, origin) = {
        let s = c.state.lock().unwrap();
        (s.config.enabled, s.config.origin.clone())
    };
    if !enabled {
        return fail(
            StatusCode::SERVICE_UNAVAILABLE,
            "Companion access is disabled.",
        )
        .into_response();
    }
    let supplied = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|s| s.to_str().ok());
    if supplied.is_some_and(|s| s != origin)
        || (matches!(*req.method(), Method::POST | Method::PUT | Method::DELETE)
            && supplied != Some(origin.as_str()))
    {
        return fail(
            StatusCode::FORBIDDEN,
            "This origin cannot access the companion.",
        )
        .into_response();
    }
    let mut response = next.run(req).await;
    if api_request
        && matches!(
            response.status(),
            StatusCode::BAD_REQUEST
                | StatusCode::UNSUPPORTED_MEDIA_TYPE
                | StatusCode::UNPROCESSABLE_ENTITY
                | StatusCode::PAYLOAD_TOO_LARGE
        )
        && !response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|s| s.to_str().ok())
            .is_some_and(|s| s.starts_with("application/json"))
    {
        response = if response.status() == StatusCode::PAYLOAD_TOO_LARGE {
            fail(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Request body exceeds 128 KiB.",
            )
            .into_response()
        } else {
            fail(StatusCode::BAD_REQUEST, "Invalid JSON request body.").into_response()
        };
    }
    let h = response.headers_mut();
    h.entry(header::CACHE_CONTROL)
        .or_insert(HeaderValue::from_static("no-store"));
    h.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    h.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    h.insert(
        "cross-origin-resource-policy",
        HeaderValue::from_static("same-origin"),
    );
    h.insert("content-security-policy",HeaderValue::from_static("default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"));
    response
}

// These handlers are mounted ONLY behind the local runtime administrator middleware.
pub async fn status(State(s): State<Server>) -> Reply {
    let mut m = s.companion.state.lock().unwrap();
    m.invitations.retain(|p| p.expires > seconds());
    Ok(Json(
        json!({"config":m.config,"ready":m.ready,"error":m.error,
        "pending":m.invitations.iter().map(|p|json!({"id":p.id,"name":p.claim.as_ref().map(|(_,n)|n),"expires":p.expires,
            "approved":p.approved,"folder":p.settings.folder,"allow_work":p.allow_work})).collect::<Vec<_>>(),
        "devices":m.devices.iter().filter(|d|d.expires>seconds()).map(grant).collect::<Vec<_>>()}),
    ))
}
pub async fn configure(State(s): State<Server>, Json(mut config): Json<Config>) -> Reply {
    if config.enabled {
        config.origin = validate_origin(&config.origin)?;
    } else if !config.origin.is_empty() {
        config.origin = validate_origin(&config.origin)?;
    }
    if config.port < 1024 {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "Choose a local port from 1024 to 65535.",
        ));
    }
    {
        let mut m = s.companion.state.lock().unwrap();
        if config.origin != m.config.origin {
            m.devices.clear();
            s.companion.persist(&m)?;
        }
        m.invitations.clear();
        m.ready = false;
        m.error.clear();
        s.engine.store.put("companion:config", &json!(config))?;
        m.config = config;
    }
    s.companion.changed.notify_one();
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Invite {
    allow_work: bool,
}
pub async fn invite(State(s): State<Server>, Json(input): Json<Invite>) -> Reply {
    let mut settings = s.engine.settings.lock().unwrap().clone();
    settings.draft.clear();
    settings.agent_profiles.retain(|profile| {
        settings.coder.as_ref() == Some(&profile.name) || settings.reviewers.contains(&profile.name)
    });
    settings.validate()?;
    let mut m = s.companion.state.lock().unwrap();
    if !m.config.enabled || !m.ready {
        return Err(fail(
            StatusCode::SERVICE_UNAVAILABLE,
            "Enable the companion gateway first.",
        ));
    }
    m.invitations.retain(|p| p.expires > seconds());
    if m.invitations.len() >= 8 {
        return Err(fail(
            StatusCode::TOO_MANY_REQUESTS,
            "Cancel an older invitation first.",
        ));
    }
    let code = secret();
    let id = uuid::Uuid::new_v4().to_string();
    let expires = seconds() + PAIR_SECONDS;
    let url = format!("{}/companion/#pair={code}", m.config.origin);
    m.invitations.push(Invitation {
        id: id.clone(),
        code: digest(&code),
        expires,
        settings,
        allow_work: input.allow_work,
        claim: None,
        approved: false,
    });
    Ok(Json(json!({"id":id,"url":url,"expires":expires})))
}
pub async fn approve(State(s): State<Server>, Path(id): Path<String>) -> Reply {
    let mut m = s.companion.state.lock().unwrap();
    let p = m
        .invitations
        .iter_mut()
        .find(|p| p.id == id && p.expires > seconds() && p.claim.is_some())
        .ok_or_else(|| fail(StatusCode::BAD_REQUEST, "No active phone claim to approve."))?;
    p.approved = true;
    Ok(Json(json!({"ok":true})))
}
pub async fn reject(State(s): State<Server>, Path(id): Path<String>) -> Reply {
    s.companion
        .state
        .lock()
        .unwrap()
        .invitations
        .retain(|p| p.id != id);
    Ok(Json(json!({"ok":true})))
}
pub async fn revoke(State(s): State<Server>, Path(id): Path<String>) -> Reply {
    let mut m = s.companion.state.lock().unwrap();
    m.devices.retain(|d| d.id != id);
    m.refreshed.remove(&id);
    s.companion.persist(&m)?;
    s.engine
        .store
        .put(&format!("companion:draft:{id}"), &json!(""))?;
    Ok(Json(json!({"ok":true})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Claim {
    code: String,
    name: String,
}
async fn claim(
    State(c): State<Arc<Companion>>,
    headers: HeaderMap,
    Json(input): Json<Claim>,
) -> Result<Response, Error> {
    let name = input.name.trim();
    if name.is_empty()
        || name.chars().count() > 60
        || name.chars().any(char::is_control)
        || input.code.len() != 64
    {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "Enter a device name and a valid pairing code.",
        ));
    }
    let token = secret();
    {
        let mut m = c.state.lock().unwrap();
        m.attempts.retain(|t| t.elapsed() < Duration::from_secs(60));
        if m.attempts.len() >= 30 {
            return Err(fail(
                StatusCode::TOO_MANY_REQUESTS,
                "Wait before trying to pair again.",
            ));
        }
        m.attempts.push_back(Instant::now());
        let p = m
            .invitations
            .iter_mut()
            .find(|p| p.can_claim(&input.code, seconds()))
            .ok_or_else(|| {
                fail(
                    StatusCode::UNAUTHORIZED,
                    "This invitation expired or was already used. Create another on the host.",
                )
            })?;
        p.claim = Some((digest(&token), name.into()));
        if let Some(previous) = cookie(&headers, DEVICE_COOKIE) {
            m.devices.retain(|d| !matches(&d.digest, &previous));
            c.persist(&m)?;
        }
    }
    let mut response = Json(json!({"status":"pending"})).into_response();
    c.set_cookie(&mut response, PAIR_COOKIE, &token, PAIR_SECONDS);
    c.set_cookie(&mut response, DEVICE_COOKIE, "", 0);
    Ok(response)
}
async fn complete(State(c): State<Arc<Companion>>, headers: HeaderMap) -> Result<Response, Error> {
    let token = match cookie(&headers, PAIR_COOKIE) {
        Some(token) => token,
        None => return Ok(Json(grant(&c.device(&headers)?)).into_response()),
    };
    let credential = secret();
    let device = {
        let mut m = c.state.lock().unwrap();
        let index = m
            .invitations
            .iter()
            .position(|p| p.can_complete(&token, seconds()))
            .ok_or_else(|| {
                fail(
                    StatusCode::UNAUTHORIZED,
                    "This pairing request expired or was rejected.",
                )
            })?;
        if !m.invitations[index].approved {
            return Ok(Json(json!({"status":"pending"})).into_response());
        }
        m.devices.retain(|d| d.expires > seconds());
        if m.devices.len() >= 32 {
            return Err(fail(
                StatusCode::TOO_MANY_REQUESTS,
                "Disconnect an older device on the host.",
            ));
        }
        let p = m.invitations.remove(index);
        let device = Device {
            id: uuid::Uuid::new_v4().to_string(),
            name: p.claim.unwrap().1,
            digest: digest(&credential),
            settings: p.settings,
            allow_work: p.allow_work,
            created: seconds(),
            expires: seconds() + DEVICE_SECONDS,
        };
        m.devices.push(device.clone());
        if let Err(error) = c.persist(&m) {
            m.devices.retain(|d| d.id != device.id);
            return Err(error.into());
        }
        device
    };
    let mut response = Json(grant(&device)).into_response();
    c.set_cookie(&mut response, DEVICE_COOKIE, &credential, DEVICE_SECONDS);
    c.set_cookie(&mut response, PAIR_COOKIE, "", 0);
    Ok(response)
}
async fn session(State(c): State<Arc<Companion>>, headers: HeaderMap) -> Reply {
    Ok(Json(grant(&c.device(&headers)?)))
}
async fn snapshot(State(c): State<Arc<Companion>>, headers: HeaderMap) -> Reply {
    let device = c.device(&headers)?;
    let mut state = c.engine.state_for(
        effective(&device, &c.engine),
        Some(&draft_key(&device)),
        true,
    )?;
    let own = state["job"]["request_id"]
        .as_str()
        .is_some_and(|r| r.starts_with(&format!("phone:{}:", device.id)));
    state["can_cancel"] = json!(device.allow_work && own);
    state["running_jobs"] = json!(if state["job"]["status"] == "running" {
        1
    } else {
        0
    });
    state["device"] = grant(&device);
    Ok(Json(state))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Draft {
    text: String,
}
async fn draft(
    State(c): State<Arc<Companion>>,
    headers: HeaderMap,
    Json(input): Json<Draft>,
) -> Reply {
    let device = c.device(&headers)?;
    if input.text.len() > 64000 {
        return Err(fail(StatusCode::BAD_REQUEST, "Draft is too long."));
    }
    c.engine
        .store
        .put(&draft_key(&device), &json!(input.text))?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Start {
    request: String,
    request_id: String,
}
async fn start(
    State(c): State<Arc<Companion>>,
    headers: HeaderMap,
    Json(input): Json<Start>,
) -> Reply {
    let device = c.device(&headers)?;
    if !device.allow_work {
        return Err(fail(
            StatusCode::FORBIDDEN,
            "This device can view progress only.",
        ));
    }
    if input.request_id.is_empty() || input.request_id.len() > 64 {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "Use a request_id of 1–64 bytes.",
        ));
    }
    let mut settings = effective(&device, &c.engine);
    settings.validate()?;
    let job = c.engine.start_for(
        input.request,
        format!("phone:{}:{}", device.id, input.request_id),
        settings,
        Some(&draft_key(&device)),
    )?;
    Ok(Json(json!(job)))
}
async fn cancel(
    State(c): State<Arc<Companion>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Reply {
    let device = c.device(&headers)?;
    let own = c
        .engine
        .store
        .jobs()?
        .iter()
        .any(|j| j.id == id && j.request_id.starts_with(&format!("phone:{}:", device.id)));
    if !device.allow_work || !own {
        return Err(fail(
            StatusCode::FORBIDDEN,
            "Only this device's requests can be cancelled here.",
        ));
    }
    c.engine.cancel(&id)?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    target: String,
}
async fn read_file(
    State(c): State<Arc<Companion>>,
    headers: HeaderMap,
    Json(input): Json<File>,
) -> Reply {
    let device = c.device(&headers)?;
    let mut profiles = c.engine.settings.lock().unwrap().agent_profiles.clone();
    profiles.extend(device.settings.agent_profiles);
    let preview = tokio::task::spawn_blocking(move || {
        crate::files::read(
            &device.settings.folder,
            &device.settings.references,
            &profiles,
            &input.target,
        )
    })
    .await
    .map_err(anyhow::Error::from)??;
    Ok(Json(json!(preview)))
}
async fn refresh(State(c): State<Arc<Companion>>, headers: HeaderMap) -> Reply {
    let device = c.device(&headers)?;
    {
        let mut m = c.state.lock().unwrap();
        if m.refreshed
            .get(&device.id)
            .is_some_and(|t| t.elapsed() < Duration::from_secs(30))
        {
            return Err(fail(
                StatusCode::TOO_MANY_REQUESTS,
                "Usage was refreshed recently. Try again shortly.",
            ));
        }
        m.refreshed.insert(device.id, Instant::now());
    }
    tokio::spawn(c.engine.clone().refresh_limits());
    Ok(Json(json!({"ok":true})))
}
async fn events(
    State(c): State<Arc<Companion>>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Response, Error> {
    let device = c.device(&headers)?;
    let mut after = q
        .get("after")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0)
        .max(0);
    let stream = async_stream::stream! {
        loop {
            if c.device(&headers).is_err() { break; }
            let Ok(events)=c.engine.store.events(after) else { break; };
            for mut event in events {
                after=event.id;
                if event.job.is_empty() && event.kind=="limits" {
                    if !event.agent.is_empty()
                        && !crate::model::AGENTS.contains(&event.agent.as_str())
                        && device.settings.agent_profile(&event.agent).is_none()
                    {
                        continue;
                    }
                    event.folder=device.settings.folder.clone();
                }
                if folder_key(&event.folder)==folder_key(&device.settings.folder) {
                    yield Ok::<_,Infallible>(SseEvent::default().id(after.to_string()).data(serde_json::to_string(&event).unwrap()));
                }
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    };
    Ok(Sse::new(stream)
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
        .into_response())
}
async fn logout(State(c): State<Arc<Companion>>, headers: HeaderMap) -> Result<Response, Error> {
    let device = c.device(&headers)?;
    {
        let mut m = c.state.lock().unwrap();
        m.devices.retain(|d| d.id != device.id);
        m.refreshed.remove(&device.id);
        c.persist(&m)?;
    }
    c.engine.store.put(&draft_key(&device), &json!(""))?;
    let mut response = Json(json!({"ok":true})).into_response();
    c.set_cookie(&mut response, DEVICE_COOKIE, "", 0);
    Ok(response)
}
async fn static_file(req: Request) -> Response {
    if req.method() != Method::GET {
        return StatusCode::NOT_FOUND.into_response();
    }
    let path = req.uri().path();
    let key = if matches!(path, "/" | "/companion" | "/companion/") {
        "companion/index.html"
    } else {
        path.trim_start_matches('/')
    };
    if !key.starts_with("assets/")
        && key != "companion/index.html"
        && key != "companion/third-party-notices.txt"
        && !matches!(
            key,
            "companion/manifest.webmanifest"
                | "companion/apple-touch-icon.png"
                | "companion/app-icon-192.png"
                | "companion/app-icon-512.png"
        )
    {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Some((_, data)) = assets::ASSETS.iter().find(|(name, _)| *name == key) {
        let mime = if key.ends_with(".html") {
            "text/html; charset=utf-8"
        } else if key.ends_with(".js") {
            "text/javascript; charset=utf-8"
        } else if key.ends_with(".css") {
            "text/css; charset=utf-8"
        } else if key.ends_with(".svg") {
            "image/svg+xml"
        } else if key.ends_with(".webmanifest") {
            "application/manifest+json; charset=utf-8"
        } else if key.ends_with(".png") {
            "image/png"
        } else if key.ends_with(".txt") {
            "text/plain; charset=utf-8"
        } else {
            "application/octet-stream"
        };
        let mut response = ([(header::CONTENT_TYPE, mime)], *data).into_response();
        if key.starts_with("assets/") {
            response.headers_mut().insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=31536000, immutable"),
            );
        }
        return response;
    }
    (
        StatusCode::SERVICE_UNAVAILABLE,
        "Build the companion browser assets with npm run build, then rebuild the host.",
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invitation_expiry_and_single_use_apply_to_claim_and_completion() {
        let mut p = Invitation {
            id: "test".into(),
            code: digest("challenge"),
            expires: 100,
            settings: Settings::default(),
            allow_work: false,
            claim: None,
            approved: false,
        };
        assert!(p.can_claim("challenge", 99));
        assert!(!p.can_claim("wrong", 99));
        assert!(!p.can_claim("challenge", 100));
        p.claim = Some((digest("pending"), "phone".into()));
        assert!(!p.can_claim("challenge", 99));
        assert!(p.can_complete("pending", 99));
        assert!(!p.can_complete("wrong", 99));
        assert!(!p.can_complete("pending", 100));
    }
    #[test]
    fn origins_cannot_downgrade_remote_transport_or_hide_credentials() {
        assert!(validate_origin("http://pc.example.com").is_err());
        assert!(validate_origin("https://user:pass@example.com").is_err());
        assert!(validate_origin("https://example.com/path").is_err());
        assert!(validate_origin("https://example.com/?token=bad").is_err());
        assert_eq!(
            validate_origin("http://127.0.0.1:43128/").unwrap(),
            "http://127.0.0.1:43128"
        );
        assert_eq!(
            validate_origin("https://pc.example.ts.net").unwrap(),
            "https://pc.example.ts.net"
        );
    }
}
