use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

pub const AGENTS: [&str; 6] = ["codex", "claude", "agy", "grok", "agent", "gemini"];
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub fn home() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into())
}
pub fn data_dir() -> PathBuf {
    std::env::var_os("AGENT_COUNCIL_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_else(|| home().into()))
                .join("AgentCouncil")
        })
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub folder: String,
    pub coder: Option<String>,
    pub reviewers: Vec<String>,
    pub references: Vec<String>,
    pub language: String,
    pub appearance: String,
    pub permissions: String,
    pub draft: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            folder: home(),
            coder: Some("claude".into()),
            reviewers: vec![],
            references: vec![],
            language: "English".into(),
            appearance: "light".into(),
            permissions: "all".into(),
            draft: String::new(),
        }
    }
}
impl Settings {
    pub fn validate(&mut self) -> anyhow::Result<()> {
        anyhow::ensure!(
            std::path::Path::new(&self.folder).is_dir(),
            "Choose an existing project folder."
        );
        self.folder = canonical(&self.folder)?;
        anyhow::ensure!(
            self.coder.as_deref().is_none_or(|a| AGENTS.contains(&a)),
            "Unknown coding agent."
        );
        anyhow::ensure!(
            self.reviewers.iter().all(|a| AGENTS.contains(&a.as_str())),
            "Unknown reviewer."
        );
        self.reviewers.retain(|a| Some(a) != self.coder.as_ref());
        let mut seen = std::collections::HashSet::new();
        self.reviewers.retain(|a| seen.insert(a.clone()));
        for reference in &mut self.references {
            anyhow::ensure!(
                std::path::Path::new(reference).is_dir(),
                "Reference folder does not exist."
            );
            *reference = canonical(reference)?;
        }
        self.references.retain(|r| r != &self.folder);
        anyhow::ensure!(
            ["English", "한국어"].contains(&self.language.as_str()),
            "Unknown language."
        );
        anyhow::ensure!(
            ["light", "dark", "system"].contains(&self.appearance.as_str()),
            "Unknown appearance."
        );
        anyhow::ensure!(
            ["restricted", "coder", "all"].contains(&self.permissions.as_str()),
            "Unknown permissions."
        );
        Ok(())
    }
}
pub fn canonical(path: &str) -> anyhow::Result<String> {
    let result = std::fs::canonicalize(path)?.to_string_lossy().into_owned();
    Ok(result.strip_prefix(r"\\?\").unwrap_or(&result).to_owned())
}
pub fn folder_key(path: &str) -> String {
    path.replace('/', "\\").to_lowercase()
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
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
