use crate::model::*;
use anyhow::Result;
use serde_json::{json, Value};
#[cfg(windows)]
use sha2::{Digest, Sha256};

pub const STORE_UPDATES_URI: &str = "ms-windows-store://downloadsandupdates";

pub async fn available() -> Result<Value> {
    if crate::platform::package_local_state().is_some() {
        return Ok(json!({
            "channel": "windows-package",
            "available": false,
            "version": VERSION,
            "url": STORE_UPDATES_URI,
            "asset": null,
        }));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("AgentCouncil")
        .build()?;
    let release: Value = client
        .get("https://api.github.com/repos/jwjp/agent-council/releases/latest")
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let tag = release["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v');
    let asset = release["assets"]
        .as_array()
        .and_then(|a| a.iter().find(|a| a["name"] == "AgentCouncil.exe"))
        .cloned()
        .unwrap_or(Value::Null);
    Ok(
        json!({"available":newer(tag,VERSION),"version":tag,"url":release["html_url"],"asset":asset}),
    )
}
fn newer(candidate: &str, current: &str) -> bool {
    match (
        semver::Version::parse(candidate),
        semver::Version::parse(current),
    ) {
        (Ok(candidate), Ok(current)) => candidate > current,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stable_updates_supersede_previews_without_downgrading() {
        assert!(newer("3.2.0", "3.2.0-beta.1"));
        assert!(newer("3.2.0-beta.2", "3.2.0-beta.1"));
        assert!(!newer("3.1.0", "3.2.0-beta.1"));
        assert!(!newer("3.2.0-beta.1", "3.2.0"));
        assert!(!newer("invalid", "3.2.0"));
    }
}
#[cfg(windows)]
pub async fn install() -> Result<()> {
    anyhow::ensure!(
        crate::platform::package_local_state().is_none(),
        "Use Windows package updates for this installation."
    );
    let release = available().await?;
    anyhow::ensure!(
        release["available"] == true,
        "You already have the latest version."
    );
    let asset = &release["asset"];
    let url = asset["browser_download_url"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Executable asset unavailable"))?;
    anyhow::ensure!(
        url.starts_with("https://github.com/jwjp/agent-council/releases/download/"),
        "Untrusted update URL"
    );
    let expected = asset["digest"]
        .as_str()
        .and_then(|s| s.strip_prefix("sha256:"))
        .ok_or_else(|| anyhow::anyhow!("Update has no SHA-256 digest"))?;
    let bytes = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()?
        .get(url)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;
    anyhow::ensure!(
        format!("{:x}", Sha256::digest(&bytes)) == expected,
        "Update checksum mismatch"
    );
    #[cfg(windows)]
    {
        use base64::Engine;
        // The runtime must have no active work before either process is stopped.
        let runtime = crate::server::running()
            .await
            .ok_or_else(|| anyhow::anyhow!("Runtime unavailable"))?;
        let exe = std::env::current_exe()?;
        let pending = exe.with_extension("pending");
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()?;
        let response = client
            .post(format!("{}/v1/maintenance", runtime.url))
            .bearer_auth(&runtime.token)
            .json(&json!({"enabled":true}))
            .send()
            .await?;
        anyhow::ensure!(
            response.status().is_success(),
            "Finish or cancel running work before updating."
        );
        let result:Result<()> = async {
        std::fs::write(&pending, &bytes)?;
        let script = r#"$ErrorActionPreference='Stop'
$target=$env:COUNCIL_EXE
$pending=$env:COUNCIL_PENDING
$backup=$target+'.backup'
try {
  Wait-Process -Id ([int]$env:COUNCIL_GUI) -Timeout 25 -ErrorAction SilentlyContinue
  Stop-Process -Id ([int]$env:COUNCIL_RUNTIME) -ErrorAction SilentlyContinue
  for($i=0;$i -lt 40;$i++) { try { [IO.File]::Replace($pending,$target,$backup); break } catch [IO.IOException] { if($i -eq 39){throw}; Start-Sleep -Milliseconds 250 } }
  Start-Process -FilePath $target -WorkingDirectory ([IO.Path]::GetDirectoryName($target))
  [IO.File]::Delete($backup)
} catch { Add-Type -AssemblyName System.Windows.Forms; [void][Windows.Forms.MessageBox]::Show($_.Exception.Message,'Agent Council update') }
finally { if([IO.File]::Exists($pending)){[IO.File]::Delete($pending)} }
"#;
        let utf16 = script
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>();
        let encoded = base64::engine::general_purpose::STANDARD.encode(utf16);
        let mut cmd = tokio::process::Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &encoded])
            .env("COUNCIL_EXE", exe)
            .env("COUNCIL_PENDING", pending)
            .env("COUNCIL_GUI", std::process::id().to_string())
            .env("COUNCIL_RUNTIME", runtime.pid.to_string());
        crate::process::hidden(&mut cmd);
        cmd.spawn()?;
        Ok(())
        }.await;
        if result.is_err() {
            let _ = client
                .post(format!("{}/v1/maintenance", runtime.url))
                .bearer_auth(&runtime.token)
                .json(&json!({"enabled":false}))
                .send()
                .await;
        }
        return result;
    }
}

#[cfg(not(windows))]
pub async fn install() -> Result<()> {
    // Reject before any download: the current release asset is a Windows executable.
    anyhow::bail!("In-app installation is currently supported only by the Windows portable build. Download the release for your platform.")
}
