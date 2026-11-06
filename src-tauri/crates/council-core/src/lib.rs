//! Shared wire types. No GUI, subprocess, database or provider credential dependencies.
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const AGENTS: [&str; 6] = ["codex", "claude", "agy", "grok", "agent", "gemini"];
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const RUNTIME_REVISION: u32 = 4;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Runtime {
    pub url: String,
    pub token: String,
    pub version: String,
    pub pid: u32,
    #[serde(default)]
    pub revision: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub text: String,
    #[serde(default)]
    pub stage: String,
    #[serde(default)]
    pub time: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub folder: String,
    pub request: String,
    pub request_id: String,
    pub status: String,
    pub time: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Event {
    pub id: i64,
    pub job: String,
    pub folder: String,
    pub agent: String,
    pub kind: String,
    pub text: String,
    pub stage: String,
    pub time: String,
    pub data: Value,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_message_and_runtime_remain_readable() {
        let message: Message = serde_json::from_str(r#"{"role":"codex","text":"안녕"}"#).unwrap();
        assert_eq!(message.text, "안녕");
        assert_eq!(message.stage, "");
        let runtime: Runtime = serde_json::from_str(
            r#"{"url":"http://127.0.0.1:1","token":"fixture","version":"3.1.0","pid":1}"#,
        )
        .unwrap();
        assert_eq!(runtime.revision, 0);
    }
}
