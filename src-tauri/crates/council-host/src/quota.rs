//! Read-only usage probes. Credentials stay in this process and are never returned to clients.
//! Protocol mappings reference Orca's MIT implementation; see THIRD_PARTY_NOTICES.md.
use anyhow::{Context, Result};
use base64::Engine as _;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

fn auth_home() -> PathBuf {
    std::env::var_os("AGENT_COUNCIL_AUTH_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| crate::model::home().into())
}
fn read(path: impl AsRef<Path>) -> Result<Value> {
    let data =
        std::fs::read(path).context("Local sign-in not found. Open this agent and sign in.")?;
    serde_json::from_slice(&data).context("Local sign-in data could not be read.")
}
fn number(v: &Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str()?.parse().ok())
        .filter(|n| n.is_finite())
}
fn timestamp(v: &Value) -> Option<f64> {
    number(v)
        .map(|n| if n > 1e12 { n / 1000.0 } else { n })
        .or_else(|| {
            chrono::DateTime::parse_from_rfc3339(v.as_str()?)
                .ok()
                .map(|d| d.timestamp() as f64)
        })
}
fn window(label: &str, used: f64, reset: &Value) -> Value {
    json!({"label":label,"used":used.clamp(0.0,100.0),"reset":timestamp(reset)})
}
fn result(windows: Vec<Value>, source: &str) -> Value {
    json!({"status":if windows.is_empty(){"unavailable"}else{"ok"},"windows":windows,"source":source,"updated_at":crate::model::now(),"message":if windows.is_empty(){"The provider did not report a quota for this account."}else{""}})
}
fn claude_label(raw: &str) -> &str {
    match raw {
        "five_hour" | "fiveHour" | "session" => "5 hours",
        "seven_day" | "sevenDay" | "weekly" => "Weekly",
        _ => raw,
    }
}
pub fn merge_event(previous: &Value, incoming: Value) -> Value {
    let Some(updates) = incoming["windows"].as_array() else {
        return previous.clone();
    };
    if updates.is_empty() {
        return previous.clone();
    }
    let mut out = previous.clone();
    let mut all = previous["windows"].as_array().cloned().unwrap_or_default();
    for update in updates {
        if let Some(old) = all.iter_mut().find(|w| w["label"] == update["label"]) {
            let stale = match (old["reset"].as_f64(), update["reset"].as_f64()) {
                (Some(a), Some(b)) if a > chrono::Utc::now().timestamp() as f64 => {
                    b < a - 60.0
                        || ((a - b).abs() <= 60.0 && update["used"].as_f64() < old["used"].as_f64())
                }
                _ => false,
            };
            if !stale {
                *old = update.clone();
            }
        } else {
            all.push(update.clone());
        }
    }
    out["windows"] = json!(all);
    out["status"] = json!("ok");
    out["message"] = json!("");
    out["updated_at"] = incoming["updated_at"].clone();
    out["refreshing"] = json!(false);
    if out["source"].is_null() {
        out["source"] = incoming["source"].clone();
    }
    out
}
pub fn failed_refresh(previous: &Value, error: &str) -> Value {
    if previous["windows"]
        .as_array()
        .is_some_and(|w| !w.is_empty())
    {
        let mut value = previous.clone();
        value["status"] = json!("stale");
        value["refreshing"] = json!(false);
        value["message"] = json!(error);
        value["attempted_at"] = json!(crate::model::now());
        value
    } else {
        failure(error)
    }
}
pub fn failure(message: &str) -> Value {
    json!({"status":if message.contains("sign-in")||message.contains("sign in"){"signed_out"}else{"error"},"windows":[],"updated_at":crate::model::now(),"message":message})
}
pub fn loading() -> Value {
    json!({"status":"loading","windows":[],"message":"Checking account usage…"})
}
pub fn normalize(agent: &str, v: &Value, source: &str) -> Value {
    let mut windows = vec![];
    match agent {
        "codex" => {
            let limits = if v["rateLimits"].is_object() {
                &v["rateLimits"]
            } else {
                &v["rateLimitsByLimitId"]["codex"]
            };
            for (i, key) in ["primary", "secondary"].iter().enumerate() {
                let w = &limits[*key];
                if let Some(used) = number(&w["usedPercent"]) {
                    let duration = number(&w["windowDurationMins"]);
                    let label = match duration {
                        Some(n) if (n - 10080.0).abs() <= 1.0 => "Weekly",
                        Some(n) if (n - 300.0).abs() <= 1.0 => "5 hours",
                        _ if i == 1 => "Weekly",
                        _ => "5 hours",
                    };
                    windows.push(window(label, used, &w["resetsAt"]));
                }
            }
            windows.sort_by_key(|w| if w["label"] == "5 hours" { 0 } else { 1 });
        }
        "agy" => {
            if let Some(groups) = v.as_array() {
                for group in groups {
                    if let Some(buckets) = group["buckets"].as_array() {
                        for b in buckets {
                            if b["disabled"] == true {
                                continue;
                            }
                            if let Some(left) = number(&b["remaining_fraction"]) {
                                let label = format!(
                                    "{} · {}",
                                    group["name"].as_str().unwrap_or("Models"),
                                    b["window"]
                                        .as_str()
                                        .or(b["name"].as_str())
                                        .unwrap_or("quota")
                                );
                                windows.push(window(
                                    &label,
                                    100.0 * (1.0 - left),
                                    &b["reset_time"],
                                ));
                            }
                        }
                    }
                }
            }
        }
        "claude" => {
            if let Some(unified) = v["unifiedWindows"].as_object() {
                for (key, w) in unified {
                    if let Some(fraction) = number(&w["utilization"]) {
                        windows.push(window(claude_label(key), 100.0 * fraction, &w["resetsAt"]));
                    }
                }
            } else if v.get("rateLimitType").is_some() {
                if let Some(fraction) = number(&v["utilization"]) {
                    windows.push(window(
                        claude_label(v["rateLimitType"].as_str().unwrap_or("Quota")),
                        fraction * 100.0,
                        &v["resetsAt"],
                    ));
                }
            } else {
                for (key, label) in [
                    ("five_hour", "5 hours"),
                    ("seven_day", "Weekly"),
                    ("seven_day_opus", "Opus · weekly"),
                    ("seven_day_sonnet", "Sonnet · weekly"),
                    ("fable_weekly", "Fable · weekly"),
                ] {
                    let w = &v[key];
                    if let Some(used) =
                        number(&w["utilization"]).or_else(|| number(&w["used_percentage"]))
                    {
                        windows.push(window(label, used, &w["resets_at"]));
                    }
                }
            }
        }
        "grok" => {
            let c = if v["config"].is_object() {
                &v["config"]
            } else {
                v
            };
            let reset = c["currentPeriod"]
                .get("end")
                .unwrap_or(&c["billingPeriodEnd"]);
            if let Some(percent) = number(&c["creditUsagePercent"]) {
                windows.push(window("Weekly", percent, reset));
            } else if let (Some(used), Some(limit)) =
                (number(&c["used"]["val"]), number(&c["monthlyLimit"]["val"]))
            {
                if limit > 0.0 {
                    windows.push(window("Monthly", 100.0 * used / limit, reset));
                }
            }
        }
        "agent" => {
            if v["isUnlimited"] != true {
                let plan = &v["individualUsage"]["plan"];
                let overall = &v["individualUsage"]["overall"];
                let p = if (plan.is_null() || plan["enabled"] == false) && overall.is_object() {
                    overall
                } else {
                    plan
                };
                let p = if v["planUsage"].is_object() {
                    &v["planUsage"]
                } else {
                    p
                };
                if p["enabled"] != false {
                    let percent = number(&p["totalPercentUsed"]).or_else(|| {
                        let used = number(&p["used"])?;
                        let limit = number(&p["limit"])?;
                        (limit > 0.0).then_some(100.0 * used / limit)
                    });
                    if let Some(used) = percent {
                        windows.push(window("Plan", used, &v["billingCycleEnd"]));
                    }
                    for (key, label) in [
                        ("autoPercentUsed", "Cursor models"),
                        ("apiPercentUsed", "Other models"),
                    ] {
                        if let Some(used) = number(&p[key]) {
                            windows.push(window(label, used, &v["billingCycleEnd"]));
                        }
                    }
                }
            }
        }
        "gemini" => {
            if let Some(buckets) = v["buckets"].as_array().or_else(|| v.as_array()) {
                for b in buckets {
                    if let Some(left) = number(&b["remainingFraction"]) {
                        windows.push(window(
                            b["modelId"].as_str().unwrap_or("Models"),
                            100.0 * (1.0 - left),
                            &b["resetTime"],
                        ));
                    }
                }
            }
        }
        _ => {}
    }
    let mut output = result(windows, source);
    if agent == "agent" && v["isUnlimited"] == true {
        output["status"] = json!("unlimited");
        output["message"] = json!("Unlimited plan · no quota percentage reported");
    }
    output
}
async fn checked(request: reqwest::RequestBuilder) -> Result<Value> {
    let response = request
        .send()
        .await
        .context("Usage service could not be reached.")?;
    let status = response.status();
    anyhow::ensure!(
        status.is_success(),
        "{}",
        match status.as_u16() {
            401 => "The saved sign-in expired. Open the agent to refresh it.",
            403 => "The provider refused this account's usage request.",
            429 => "Usage lookup is rate limited. Try again later.",
            _ => "The provider's usage service is temporarily unavailable.",
        }
    );
    response
        .json()
        .await
        .context("The provider returned an unrecognized usage response.")
}
fn secret<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .context("No saved sign-in. Open the agent and sign in.")
}
pub async fn fetch(agent: &str, folder: &str) -> Result<Value> {
    if ["codex", "agy"].contains(&agent) {
        return Ok(normalize(
            agent,
            &crate::engine::read_limits(agent, folder).await?,
            "Local CLI",
        ));
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("AgentCouncil/3")
        .build()?;
    let mut auth_source = None;
    let data = match agent {
        "claude" => {
            let root = std::env::var_os("CLAUDE_CONFIG_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| auth_home().join(".claude"));
            let credentials = read(root.join(".credentials.json"))?;
            let token = secret(&credentials["claudeAiOauth"], "accessToken")?;
            checked(
                client
                    .get("https://api.anthropic.com/api/oauth/usage")
                    .bearer_auth(token)
                    .header("anthropic-beta", "oauth-2025-04-20")
                    .header("User-Agent", "claude-code/2.1.0"),
            )
            .await?
        }
        "grok" => {
            let root = std::env::var_os("GROK_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| auth_home().join(".grok"));
            let credentials = read(root.join("auth.json"))?;
            let object = credentials
                .as_object()
                .context("Local Grok sign-in could not be read.")?;
            let entry = object
                .iter()
                .find(|(k, v)| k.starts_with("https://auth.x.ai") && v["key"].is_string())
                .or_else(|| object.iter().find(|(_, v)| v["key"].is_string()))
                .map(|(_, v)| v)
                .context("No Grok sign-in found.")?;
            let token = secret(entry, "key")?;
            let build = |url: &str| {
                let mut req = client
                    .get(url)
                    .bearer_auth(token)
                    .header("X-XAI-Token-Auth", "xai-grok-cli");
                if let Some(id) = entry["user_id"].as_str() {
                    req = req.header("x-userid", id);
                }
                req
            };
            let data = checked(build(
                "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
            ))
            .await?;
            if normalize(agent, &data, "")["windows"]
                .as_array()
                .is_some_and(|a| !a.is_empty())
            {
                data
            } else {
                checked(build("https://cli-chat-proxy.grok.com/v1/billing")).await?
            }
        }
        "agent" => {
            let root = crate::platform::cursor_dir(
                &auth_home(),
                std::env::var_os("AGENT_COUNCIL_AUTH_HOME").is_some(),
            );
            let mut token = read(root.join("auth.json"))
                .ok()
                .and_then(|v| v["accessToken"].as_str().map(str::to_owned));
            auth_source = Some(if token.is_some() {
                "Cursor Agent CLI"
            } else {
                "Cursor IDE"
            });
            if token.is_none() {
                let path = root.join("User/globalStorage/state.vscdb");
                if let Ok(db) = rusqlite::Connection::open_with_flags(
                    path,
                    rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
                        | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
                ) {
                    token = db
                        .query_row(
                            "SELECT value FROM ItemTable WHERE key='cursorAuth/accessToken'",
                            [],
                            |r| r.get::<_, String>(0),
                        )
                        .ok();
                }
            }
            let token =
                token.context("No Cursor sign-in found. Sign in with Cursor or Cursor Agent.")?;
            let token = decrypt_cursor_token(&root, &token)?;
            let payload = token
                .split('.')
                .nth(1)
                .context("The saved Cursor sign-in could not be read.")?;
            let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(payload.trim_end_matches('='))
                .context("The saved Cursor sign-in could not be read.")?;
            let claims: Value = serde_json::from_slice(&bytes)
                .context("The saved Cursor sign-in could not be read.")?;
            let subject = secret(&claims, "sub")?;
            let cookie = format!(
                "WorkosCursorSessionToken={}%3A%3A{}",
                url_encode(subject),
                token
            );
            let build = |req: reqwest::RequestBuilder| {
                req.header("Cookie", &cookie)
                    .header("Origin", "https://cursor.com")
                    .header("Referer", "https://cursor.com/dashboard")
                    .header("Accept", "application/json")
            };
            let summary =
                checked(build(client.get("https://cursor.com/api/usage-summary"))).await?;
            if summary["membershipType"]
                .as_str()
                .is_some_and(|s| s.starts_with("unified_"))
            {
                checked(build(
                    client
                        .post("https://cursor.com/api/dashboard/get-current-period-usage")
                        .json(&json!({})),
                ))
                .await?
            } else {
                summary
            }
        }
        "gemini" => {
            let credentials = read(auth_home().join(".gemini/oauth_creds.json"))?;
            let mut token = secret(&credentials, "access_token")?.to_owned();
            if number(&credentials["expiry_date"])
                .is_some_and(|n| n < chrono::Utc::now().timestamp_millis() as f64)
            {
                let (_, prefix) = crate::process::launcher("gemini")?;
                let script = prefix
                    .first()
                    .context("Open Gemini CLI to refresh its sign-in.")?;
                let source = std::fs::read_to_string(script)
                    .context("Open Gemini CLI to refresh its sign-in.")?;
                let extract = |name: &str| -> Result<String> {
                    let re = regex::Regex::new(&format!(r#"{}\s*=\s*['\"]([^'\"]+)['\"]"#, name))?;
                    Ok(re
                        .captures(&source)
                        .and_then(|c| c.get(1))
                        .context("Open Gemini CLI to refresh its sign-in.")?
                        .as_str()
                        .into())
                };
                let id = extract("OAUTH_CLIENT_ID")?;
                let secret = extract("OAUTH_CLIENT_SECRET")?;
                let refresh = crate::quota::secret(&credentials, "refresh_token")?;
                let response=checked(client.post("https://oauth2.googleapis.com/token").header("Content-Type","application/x-www-form-urlencoded").body(format!("client_id={}&client_secret={}&refresh_token={}&grant_type=refresh_token",url_encode(&id),url_encode(&secret),url_encode(refresh)))).await?;
                token = crate::quota::secret(&response, "access_token")?.into();
            }
            let project = checked(
                client
                    .post("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist")
                    .bearer_auth(&token)
                    .json(&json!({"metadata":{"ideType":"GEMINI_CLI","pluginType":"GEMINI"}})),
            )
            .await?;
            let project = project["cloudaicompanionProject"]
                .as_str()
                .or(project["cloudaicompanionProject"]["id"].as_str())
                .context("Gemini did not report a quota project for this account.")?;
            checked(
                client
                    .post("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota")
                    .bearer_auth(&token)
                    .json(&json!({"project":project})),
            )
            .await?
        }
        _ => anyhow::bail!("Unknown usage provider"),
    };
    let mut result = normalize(agent, &data, "Existing local sign-in");
    if let Some(source) = auth_source {
        result["auth_source"] = json!(source);
    }
    Ok(result)
}
fn decrypt_cursor_token(root: &Path, token: &str) -> Result<String> {
    let Some(encoded) = token.strip_prefix("cursor-safe-storage:v1:") else {
        return Ok(token.into());
    };
    #[cfg(windows)]
    {
        use aes_gcm::{
            aead::{Aead, KeyInit},
            Aes256Gcm, Nonce,
        };
        let data = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .context("Cursor's protected sign-in could not be read.")?;
        anyhow::ensure!(
            data.starts_with(b"v10") && data.len() > 31,
            "This Cursor sign-in storage version is not supported."
        );
        let state = read(root.join("Local State"))?;
        let key = secret(&state["os_crypt"], "encrypted_key")?;
        let protected = base64::engine::general_purpose::STANDARD
            .decode(key)
            .context("Cursor's protected key could not be read.")?;
        anyhow::ensure!(
            protected.starts_with(b"DPAPI"),
            "Unsupported Cursor key storage."
        );
        let key = unprotect(&protected[5..])?;
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|_| anyhow::anyhow!("Cursor's protected key could not be opened."))?;
        let plain = cipher
            .decrypt(Nonce::from_slice(&data[3..15]), &data[15..])
            .map_err(|_| {
                anyhow::anyhow!(
                    "Cursor's protected sign-in could not be opened for this Windows user."
                )
            })?;
        return String::from_utf8(plain)
            .context("Cursor's protected sign-in format is not supported.");
    }
    #[cfg(not(windows))]
    {
        let _ = (root, encoded);
        anyhow::bail!("Protected Cursor sign-in is not supported on this platform.")
    }
}
#[cfg(windows)]
fn unprotect(data: &[u8]) -> Result<Vec<u8>> {
    unsafe {
        use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};
        let source = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output: CRYPT_INTEGER_BLOB = std::mem::zeroed();
        anyhow::ensure!(
            CryptUnprotectData(
                &source,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                1,
                &mut output
            ) != 0,
            "Windows could not open Cursor's key for the current user."
        );
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        windows_sys::Win32::Foundation::LocalFree(output.pbData as _);
        Ok(bytes)
    }
}
fn url_encode(value: &str) -> String {
    value
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn claude_oauth_percent_is_not_a_fraction() {
        let v = normalize(
            "claude",
            &json!({"five_hour":{"utilization":44,"resets_at":"2026-11-05T15:00:00Z"}}),
            "test",
        );
        assert_eq!(v["windows"][0]["used"], 44.0);
    }
    #[test]
    fn partial_claude_event_retains_weekly_and_ignores_older_snapshot() {
        let future = chrono::Utc::now().timestamp() + 10000;
        let previous = normalize(
            "claude",
            &json!({"five_hour":{"utilization":44,"resets_at":future},"seven_day":{"utilization":79,"resets_at":future+300000}}),
            "OAuth",
        );
        let event = normalize(
            "claude",
            &json!({"rateLimitType":"five_hour","utilization":0.12,"resetsAt":future}),
            "CLI event",
        );
        let merged = merge_event(&previous, event);
        assert_eq!(merged["windows"].as_array().unwrap().len(), 2);
        assert_eq!(merged["windows"][0]["used"], 44.0);
        assert_eq!(merged["windows"][1]["used"], 79.0);
        let stale = failed_refresh(&merged, "Usage lookup is rate limited.");
        assert_eq!(stale["status"], "stale");
        assert_eq!(stale["updated_at"], merged["updated_at"]);
    }
    #[test]
    fn codex_duration_selects_the_window_not_the_position() {
        let value = normalize(
            "codex",
            &json!({"rateLimits":{"primary":{"usedPercent":79,"windowDurationMins":10079},"secondary":{"usedPercent":1,"windowDurationMins":301}}}),
            "RPC",
        );
        assert_eq!(value["windows"][0]["label"], "5 hours");
        assert_eq!(value["windows"][0]["used"], 1.0);
        assert_eq!(value["windows"][1]["label"], "Weekly");
        assert_eq!(value["windows"][1]["used"], 79.0);
    }
    #[test]
    fn disabled_antigravity_buckets_do_not_invent_headroom() {
        let value = normalize(
            "agy",
            &json!([{"name":"Models","buckets":[{"remaining_fraction":1,"disabled":true},{"remaining_fraction":0.2,"window":"weekly"}]}]),
            "CLI",
        );
        assert_eq!(value["windows"].as_array().unwrap().len(), 1);
        assert_eq!(value["windows"][0]["used"], 80.0);
    }
    #[test]
    fn missing_grok_percent_is_never_zero() {
        let v = normalize(
            "grok",
            &json!({"config":{"monthlyLimit":{"val":"0"},"used":{"val":"12"}}}),
            "test",
        );
        assert_eq!(v["windows"], json!([]));
    }
    #[test]
    fn cursor_uses_reported_plan_percent_before_raw_budget() {
        let v = normalize(
            "agent",
            &json!({"individualUsage":{"plan":{"used":100,"limit":100,"totalPercentUsed":45}},"billingCycleEnd":1800000000000u64}),
            "test",
        );
        assert_eq!(v["windows"][0]["used"], 45.0);
        assert_eq!(v["windows"][0]["reset"], 1800000000.0);
    }
    #[test]
    fn gemini_remaining_is_converted_and_grouped() {
        let v = normalize(
            "gemini",
            &json!({"buckets":[{"modelId":"pro","remainingFraction":0.7}]}),
            "test",
        );
        assert!((v["windows"][0]["used"].as_f64().unwrap() - 30.0).abs() < 0.001);
    }
}
