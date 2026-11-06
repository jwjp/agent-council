use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub use council_core::{Event, Job, Message, AGENTS, VERSION};
pub fn home() -> String {
    crate::platform::home().to_string_lossy().into_owned()
}
pub fn data_dir() -> PathBuf {
    crate::platform::data_dir()
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
    if cfg!(windows) {
        path.replace('/', "\\").to_lowercase()
    } else {
        path.to_owned()
    }
}
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_identity_obeys_platform_case_rules() {
        if cfg!(windows) {
            assert_eq!(
                folder_key("C:/Work/Project"),
                folder_key(r"c:\work\project")
            );
        } else {
            assert_ne!(folder_key("/work/Project"), folder_key("/work/project"));
        }
    }
}
