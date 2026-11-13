use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

pub use council_core::{Event, Job, Message, AGENTS, VERSION};
pub fn home() -> String {
    crate::platform::home().to_string_lossy().into_owned()
}
pub fn data_dir() -> PathBuf {
    crate::platform::data_dir()
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentProfile {
    pub name: String,
    pub config_dir: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}
impl AgentProfile {
    pub fn provider(&self) -> &str {
        self.name
            .split_once('-')
            .map_or(&self.name, |(provider, _)| provider)
    }
    pub fn same_config(&self, other: &Self) -> bool {
        folder_key(&self.config_dir) == folder_key(&other.config_dir)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub folder: String,
    pub coder: Option<String>,
    pub reviewers: Vec<String>,
    #[serde(alias = "claude_profiles")]
    pub agent_profiles: Vec<AgentProfile>,
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
            agent_profiles: vec![],
            references: vec![],
            language: "English".into(),
            appearance: "light".into(),
            permissions: "all".into(),
            draft: String::new(),
        }
    }
}
impl Settings {
    pub fn agent_profile(&self, agent: &str) -> Option<&AgentProfile> {
        self.agent_profiles
            .iter()
            .find(|profile| profile.name == agent)
    }

    pub fn agent_label<'a>(&'a self, agent: &'a str) -> &'a str {
        self.agent_profile(agent)
            .and_then(|profile| profile.display_name.as_deref())
            .unwrap_or(match agent {
                "claude" => "Claude Code",
                "codex" => "Codex",
                "grok" => "Grok",
                "agy" => "Antigravity",
                "agent" => "Cursor Agent",
                "gemini" => "Gemini CLI",
                _ => agent,
            })
    }

    pub fn matches_profile(&self, agent: &str, profile: Option<&AgentProfile>) -> bool {
        match (self.agent_profile(agent), profile) {
            (Some(current), Some(profile)) => current.same_config(profile),
            (None, None) => true,
            _ => false,
        }
    }

    pub fn validate(&mut self) -> anyhow::Result<()> {
        anyhow::ensure!(
            std::path::Path::new(&self.folder).is_dir(),
            "Choose an existing project folder."
        );
        self.folder = canonical(&self.folder)?;
        let mut names = HashSet::new();
        let mut dirs = HashSet::new();
        for provider in crate::agent_accounts::PROVIDERS {
            let default_dir = crate::agent_accounts::default_dir(provider);
            if let Some(default) = default_dir.to_str() {
                dirs.insert(folder_key(
                    &canonical(default).unwrap_or_else(|_| default.to_owned()),
                ));
            }
        }
        for profile in &mut self.agent_profiles {
            if let Some(label) = &mut profile.display_name {
                *label = label.trim().to_owned();
                anyhow::ensure!(
                    !label.is_empty()
                        && label.chars().count() <= 40
                        && !label.chars().any(char::is_control),
                    "Enter an account name of 1–40 characters."
                );
            }
            anyhow::ensure!(
                profile
                    .name
                    .split_once('-')
                    .is_some_and(|(provider, suffix)| {
                        crate::agent_accounts::PROVIDERS.contains(&provider)
                            && (1..=32).contains(&suffix.len())
                            && suffix.as_bytes()[0].is_ascii_alphanumeric()
                            && suffix.bytes().all(|c| {
                                c.is_ascii_lowercase()
                                    || c.is_ascii_digit()
                                    || c == b'-'
                                    || c == b'_'
                            })
                    }),
                "Invalid agent profile ID."
            );
            anyhow::ensure!(
                names.insert(profile.name.clone()),
                "Agent profile IDs must be unique."
            );
            let path = Path::new(&profile.config_dir);
            anyhow::ensure!(
                path.is_absolute(),
                "Choose an absolute configuration folder for {}.",
                profile.name
            );
            // Keep saved profiles editable when a drive or directory becomes unavailable.
            if path.exists() {
                anyhow::ensure!(
                    path.is_dir(),
                    "Choose a configuration folder for {}.",
                    profile.name
                );
                profile.config_dir = canonical(&profile.config_dir)?;
            }
            anyhow::ensure!(
                dirs.insert(folder_key(&profile.config_dir)),
                "Each agent profile must use a different configuration folder."
            );
        }
        let known = |agent: &str| AGENTS.contains(&agent) || names.contains(agent);
        anyhow::ensure!(
            self.coder.as_deref().is_none_or(known),
            "Unknown coding agent."
        );
        anyhow::ensure!(self.reviewers.iter().all(|a| known(a)), "Unknown reviewer.");
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
