use crate::{
    model::{canonical, data_dir, folder_key, AgentProfile, Settings},
    process::{configure_profile, hidden, launcher},
    quota::{auth_home, claude_config_dir},
};
use anyhow::{Context, Result};
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    time::timeout,
};

pub(crate) const PROVIDERS: [&str; 2] = ["claude", "codex"];
pub(crate) const CODEX_FILE_AUTH: [&str; 2] = ["-c", "cli_auth_credentials_store=file"];

pub(crate) fn auth_environment(provider: &str) -> (&'static str, &'static [&'static str]) {
    if provider == "codex" {
        (
            "CODEX_HOME",
            &[
                "OPENAI_API_KEY",
                "CODEX_API_KEY",
                "CODEX_ACCESS_TOKEN",
                "OPENAI_BASE_URL",
            ],
        )
    } else {
        ("CLAUDE_CONFIG_DIR", crate::process::CLAUDE_AUTH_OVERRIDES)
    }
}

pub(crate) fn default_dir(provider: &str) -> PathBuf {
    if provider == "codex" {
        std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| auth_home().join(".codex"))
    } else {
        claude_config_dir()
    }
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum Status {
    Connected,
    SignInRequired,
    CliUnavailable,
    CheckFailed,
}

#[derive(Serialize)]
pub(crate) struct Account {
    #[serde(flatten)]
    profile: AgentProfile,
    status: Status,
    #[serde(skip_serializing_if = "Option::is_none")]
    account_email: Option<String>,
    #[serde(flatten)]
    login: Option<Login>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum LoginShell {
    #[serde(rename = "powershell")]
    PowerShell,
    MacosTerminal,
    PosixTerminal,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_login_uses_an_isolated_posix_shell() {
        let path = "/Users/test/Library/Application Support/AgentCouncil/O'Neil $test";
        let command = command_for("claude", path, LoginShell::MacosTerminal);
        assert!(command.starts_with("(unset ANTHROPIC_API_KEY"));
        assert!(command.contains("O'\\''Neil $test'; claude auth login)"));
        if let Some(shell) = std::env::var_os("COUNCIL_TEST_POSIX_SHELL")
            .or_else(|| cfg!(unix).then(|| "/bin/sh".into()))
        {
            let script = format!(
                r#"
claude() {{
    [ "$1 $2" = "auth login" ] && [ "$CLAUDE_CONFIG_DIR" = "$EXPECTED_DIR" ] && [ -z "${{ANTHROPIC_API_KEY+x}}" ]
}}
{command} && [ "$CLAUDE_CONFIG_DIR" = default ] && [ "$ANTHROPIC_API_KEY" = fixture ]
"#
            );
            assert!(std::process::Command::new(shell)
                .args(["-c", &script])
                .env("EXPECTED_DIR", path)
                .env("CLAUDE_CONFIG_DIR", "default")
                .env("ANTHROPIC_API_KEY", "fixture")
                .status()
                .unwrap()
                .success());
        }
    }

    #[test]
    fn email_identifies_only_a_claude_subscription_session() {
        let auth: AuthStatus = serde_json::from_value(serde_json::json!({
            "loggedIn": true, "authMethod": "api_key", "email": "stale@example.invalid"
        }))
        .unwrap();
        assert!(auth.signed_in_email().is_none());
    }
}

#[derive(Serialize)]
struct Login {
    login_command: String,
    login_shell: LoginShell,
}

impl Login {
    fn for_folder(provider: &str, config_dir: &str) -> Self {
        let login_shell = if cfg!(windows) {
            LoginShell::PowerShell
        } else if cfg!(target_os = "macos") {
            LoginShell::MacosTerminal
        } else {
            LoginShell::PosixTerminal
        };
        Self {
            login_command: command_for(provider, config_dir, login_shell),
            login_shell,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthStatus {
    logged_in: bool,
    config_directory: Option<String>,
    auth_method: Option<String>,
    email: Option<String>,
}

impl AuthStatus {
    fn signed_in_email(self) -> Option<String> {
        if self.auth_method.as_deref() != Some("claude.ai") {
            return None;
        }
        let email = self.email?;
        let email = email.trim();
        let (user, host) = email.split_once('@')?;
        (!user.is_empty()
            && !host.is_empty()
            && !host.contains('@')
            && email.len() <= 254
            && !email.chars().any(|c| c.is_whitespace() || c.is_control()))
        .then(|| email.to_owned())
    }
}

fn key(path: &str) -> String {
    folder_key(&canonical(path).unwrap_or_else(|_| path.to_owned()))
}

pub(crate) fn managed_root(provider: &str) -> PathBuf {
    data_dir().join(format!("{provider}-accounts"))
}

fn profile(provider: &str, config_dir: String, managed: bool) -> AgentProfile {
    let hash = format!("{:x}", Sha256::digest(folder_key(&config_dir).as_bytes()));
    let display_name = (!managed)
        .then(|| {
            let folder = Path::new(&config_dir).file_name()?.to_str()?;
            let suffix = folder
                .trim_start_matches('.')
                .strip_prefix(&format!("{provider}-"))
                .unwrap_or(folder.trim_start_matches('.'));
            let label: String = suffix
                .replace(['-', '_'], " ")
                .chars()
                .filter(|c| !c.is_control())
                .take(40)
                .collect();
            (!label.trim().is_empty()).then(|| label.trim().to_owned())
        })
        .flatten();
    AgentProfile {
        name: format!("{provider}-{}", &hash[..32]),
        config_dir,
        display_name,
    }
}

fn command_for(provider: &str, config_dir: &str, shell: LoginShell) -> String {
    let (home, overrides) = auth_environment(provider);
    let login = if provider == "codex" {
        format!("codex {} login", CODEX_FILE_AUTH.join(" "))
    } else {
        "claude auth login".into()
    };
    if matches!(shell, LoginShell::PowerShell) {
        let path = config_dir
            .replace('\'', "''")
            .replace('\u{2018}', "\u{2018}\u{2018}")
            .replace('\u{2019}', "\u{2019}\u{2019}");
        let variables = overrides
            .iter()
            .map(|key| format!("'Env:{key}'"))
            .collect::<Vec<_>>()
            .join(", ");
        format!("$env:{home} = '{path}'\nRemove-Item -LiteralPath {variables} -ErrorAction SilentlyContinue\n{login}")
    } else {
        let path = config_dir.replace('\'', "'\\''");
        format!(
            "(unset {}; export {home}='{path}'; {login})",
            overrides.join(" ")
        )
    }
}

pub(crate) fn prepare(provider: &str, request_id: Option<&str>) -> Result<Account> {
    launcher(provider)?;
    let id = request_id
        .map(uuid::Uuid::parse_str)
        .transpose()
        .context("Invalid login preparation request ID.")?
        .unwrap_or_else(uuid::Uuid::new_v4);
    let root = managed_root(provider);
    fs::create_dir_all(&root).context("Could not prepare the account folder.")?;
    let path = fs::canonicalize(&root)?.join(id.simple().to_string());
    let mut directory = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        directory.mode(0o700);
    }
    if let Err(error) = directory.recursive(false).create(&path) {
        if request_id.is_none() || error.kind() != std::io::ErrorKind::AlreadyExists {
            return Err(error).context("Could not prepare the account folder.");
        }
        anyhow::ensure!(
            fs::symlink_metadata(&path)?.file_type().is_dir()
                && folder_key(&fs::canonicalize(&path)?.to_string_lossy())
                    == folder_key(&path.to_string_lossy()),
            "The account folder conflicts with an existing path."
        );
    }
    let config_dir = canonical(path.to_str().context("Invalid account folder.")?)?;
    Ok(Account {
        login: Some(Login::for_folder(provider, &config_dir)),
        profile: profile(provider, config_dir, true),
        status: Status::SignInRequired,
        account_email: None,
    })
}

pub(crate) async fn check(provider: &str, config_dir: &str) -> Result<Account> {
    let path = Path::new(config_dir);
    anyhow::ensure!(
        path.is_absolute() && path.is_dir() && !config_dir.chars().any(char::is_control),
        "Choose an existing agent configuration folder."
    );
    let config_dir = canonical(config_dir)?;
    anyhow::ensure!(
        folder_key(&config_dir) != key(&default_dir(provider).to_string_lossy()),
        "This folder belongs to the default account."
    );
    let managed = Path::new(&config_dir).parent().is_some_and(|parent| {
        key(&parent.to_string_lossy()) == key(&managed_root(provider).to_string_lossy())
    });
    Ok(inspect(profile(provider, config_dir, managed), managed).await)
}

pub(crate) async fn discover(provider: &str, settings: Settings) -> Vec<Account> {
    let default_dir = default_dir(provider).to_string_lossy().into_owned();
    let mut seen = HashSet::from([key(&default_dir)]);
    let mut profiles = vec![(
        AgentProfile {
            name: provider.into(),
            config_dir: default_dir,
            display_name: None,
        },
        false,
    )];
    let managed = key(&managed_root(provider).to_string_lossy());
    for profile in settings
        .agent_profiles
        .into_iter()
        .filter(|p| p.provider() == provider)
    {
        seen.insert(key(&profile.config_dir));
        let is_managed = Path::new(&profile.config_dir)
            .parent()
            .is_some_and(|parent| key(&parent.to_string_lossy()) == managed);
        profiles.push((profile, is_managed));
    }
    let profile_prefix = format!(".{provider}-");
    for (root, is_managed) in [(auth_home(), false), (managed_root(provider), true)] {
        let mut candidates: Vec<_> = fs::read_dir(root)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name();
                let name = name.to_str()?;
                let matches = if is_managed {
                    uuid::Uuid::parse_str(name).is_ok()
                } else {
                    name.starts_with(&profile_prefix)
                };
                (matches && entry.file_type().ok()?.is_dir()).then(|| entry.path())
            })
            .collect();
        candidates.sort();
        for path in candidates.into_iter().take(12) {
            if let Some(dir) = path.to_str().and_then(|p| canonical(p).ok()) {
                if seen.insert(folder_key(&dir)) {
                    profiles.push((profile(provider, dir, is_managed), is_managed));
                }
            }
        }
    }
    stream::iter(profiles)
        .map(|(profile, managed)| inspect(profile, managed))
        .buffered(8)
        .collect()
        .await
}

async fn inspect(profile: AgentProfile, managed: bool) -> Account {
    let provider = profile.provider();
    let (status, account_email) = match launcher(provider) {
        Err(_) => (Status::CliUnavailable, None),
        Ok(_) if profile.name != provider && !Path::new(&profile.config_dir).is_dir() => {
            (Status::CheckFailed, None)
        }
        Ok((program, prefix)) => probe(program, prefix, &profile)
            .await
            .unwrap_or((Status::CheckFailed, None)),
    };
    Account {
        status,
        account_email,
        login: managed.then(|| Login::for_folder(provider, &profile.config_dir)),
        profile,
    }
}

async fn probe(
    program: PathBuf,
    prefix: Vec<String>,
    profile: &AgentProfile,
) -> Result<(Status, Option<String>)> {
    let mut command = Command::new(program);
    let provider = profile.provider();
    command
        .args(prefix)
        .current_dir(data_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    if profile.name != provider {
        configure_profile(&mut command, provider, &profile.config_dir);
    }
    if provider == "codex" {
        command.args(["login", "status"]).stderr(Stdio::piped());
    } else {
        command.args(["auth", "status"]);
    }
    hidden(&mut command);
    timeout(Duration::from_secs(4), async {
        let mut child = command.spawn()?;
        let (bytes, stderr) = tokio::try_join!(
            read_status(child.stdout.take()),
            read_status(child.stderr.take())
        )?;
        let exit = child.wait().await?;
        if provider == "codex" {
            let signed_out = [&bytes, &stderr].iter().any(|output| {
                String::from_utf8_lossy(output)
                    .to_ascii_lowercase()
                    .contains("not logged in")
            });
            return Ok((
                match exit.code() {
                    Some(0) => Status::Connected,
                    Some(1) if signed_out => Status::SignInRequired,
                    _ => Status::CheckFailed,
                },
                None,
            ));
        }
        let status: AuthStatus = serde_json::from_slice(&bytes)?;
        if profile.name != "claude"
            && status
                .config_directory
                .as_ref()
                .is_some_and(|dir| key(dir) != key(&profile.config_dir))
        {
            return Ok((Status::CheckFailed, None));
        }
        Ok(match (exit.code(), status.logged_in) {
            (Some(0), true) => (Status::Connected, status.signed_in_email()),
            (Some(1), false) => (Status::SignInRequired, None),
            _ => (Status::CheckFailed, None),
        })
    })
    .await?
}

async fn read_status(stream: Option<impl AsyncRead + Unpin>) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    if let Some(stream) = stream {
        const MAX: u64 = 16384;
        stream.take(MAX + 1).read_to_end(&mut bytes).await?;
        anyhow::ensure!(bytes.len() as u64 <= MAX, "Unexpected CLI status output.");
    }
    Ok(bytes)
}
