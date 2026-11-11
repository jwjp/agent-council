#![windows_subsystem = "windows"]

use std::{env, fs, io, path::PathBuf, process::Command};

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetCurrentPackageFamilyName(length: *mut u32, name: *mut u16) -> i32;
}

fn trial_root() -> io::Result<PathBuf> {
    let mut buffer = [0u16; 128];
    let mut length = buffer.len() as u32;
    // PACKAGE_FAMILY_NAME_MAX_LENGTH fits in this buffer, including the NUL.
    let result = unsafe { GetCurrentPackageFamilyName(&mut length, buffer.as_mut_ptr()) };
    if result != 0 {
        return Err(io::Error::from_raw_os_error(result));
    }
    let family = String::from_utf16_lossy(&buffer[..length as usize - 1]);
    if !family.starts_with("AgentCouncil.CompatibilityTrial_") {
        return Err(io::Error::other("Unexpected MSIX trial package identity"));
    }
    let local = env::var_os("LOCALAPPDATA")
        .ok_or_else(|| io::Error::other("Local app data path is unavailable"))?;
    Ok(PathBuf::from(local)
        .join("Packages")
        .join(family)
        .join("LocalState"))
}

fn launch(root: &std::path::Path) -> io::Result<()> {
    let app = env::current_exe()?.with_file_name("AgentCouncil.exe");
    let auth = root.join("auth");
    fs::create_dir_all(&auth)?;
    let fixture = root.join("fixture-bin");
    let inherited = env::var_os("PATH").unwrap_or_default();
    let path = if fixture.is_dir() {
        env::join_paths(std::iter::once(fixture).chain(env::split_paths(&inherited)))
            .map_err(io::Error::other)?
    } else {
        inherited
    };
    Command::new(app)
        .current_dir(root)
        .env_remove("AGENT_COUNCIL_DATA")
        .env("AGENT_COUNCIL_AUTH_HOME", &auth)
        .env("CODEX_HOME", auth.join(".codex"))
        .env("CLAUDE_CONFIG_DIR", auth.join(".claude"))
        .env("GROK_HOME", auth.join(".grok"))
        .env_remove("WEBVIEW2_USER_DATA_FOLDER")
        .env("PATH", path)
        .spawn()?;
    Ok(())
}

fn main() -> io::Result<()> {
    let root = trial_root()?;
    let result = launch(&root);
    if let Err(error) = &result {
        let _ = fs::write(root.join("launcher-error.log"), error.to_string());
    }
    result
}
