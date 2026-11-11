//! Desktop OS boundaries. Path construction is testable without modifying process environment.
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Os {
    Windows,
    Mac,
    Linux,
}

fn current_os() -> Os {
    if cfg!(windows) {
        Os::Windows
    } else if cfg!(target_os = "macos") {
        Os::Mac
    } else {
        Os::Linux
    }
}

pub fn home() -> PathBuf {
    let primary = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(primary)
        .or_else(|| {
            if cfg!(windows) {
                std::env::var_os("HOME")
            } else {
                None
            }
        })
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(windows)]
pub fn package_local_state() -> Option<PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::Storage::Packaging::Appx::{
        GetCurrentPackageFamilyName, PACKAGE_FAMILY_NAME_MAX_LENGTH,
    };

    let mut family = [0u16; PACKAGE_FAMILY_NAME_MAX_LENGTH as usize + 1];
    let mut length = family.len() as u32;
    // Windows returns the process's registered package family, including its NUL.
    if unsafe { GetCurrentPackageFamilyName(&mut length, family.as_mut_ptr()) } != 0 {
        return None;
    }
    let family = OsString::from_wide(&family[..length as usize - 1]);
    let local = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join("AppData/Local"));
    Some(local.join("Packages").join(family).join("LocalState"))
}

#[cfg(not(windows))]
pub fn package_local_state() -> Option<PathBuf> {
    None
}

fn default_data_dir(
    os: Os,
    home: &Path,
    local: Option<OsString>,
    xdg: Option<OsString>,
) -> PathBuf {
    match os {
        Os::Windows => local
            .map(PathBuf::from)
            .unwrap_or_else(|| home.to_path_buf())
            .join("AgentCouncil"),
        Os::Mac => home.join("Library/Application Support/AgentCouncil"),
        Os::Linux => xdg
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .unwrap_or_else(|| home.join(".local/share"))
            .join("AgentCouncil"),
    }
}

pub fn data_dir() -> PathBuf {
    std::env::var_os("AGENT_COUNCIL_DATA")
        .map(PathBuf::from)
        .or_else(|| package_local_state().map(|path| path.join("council")))
        .unwrap_or_else(|| {
            default_data_dir(
                current_os(),
                &home(),
                std::env::var_os("LOCALAPPDATA"),
                std::env::var_os("XDG_DATA_HOME"),
            )
        })
}

fn cursor_path(os: Os, home: &Path, appdata: Option<OsString>, xdg: Option<OsString>) -> PathBuf {
    match os {
        Os::Windows => appdata
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData/Roaming"))
            .join("Cursor"),
        Os::Mac => home.join("Library/Application Support/Cursor"),
        Os::Linux => xdg
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .unwrap_or_else(|| home.join(".config"))
            .join("Cursor"),
    }
}

pub fn cursor_dir(auth_home: &Path, isolated: bool) -> PathBuf {
    cursor_path(
        current_os(),
        auth_home,
        if isolated {
            None
        } else {
            std::env::var_os("APPDATA")
        },
        if isolated {
            None
        } else {
            std::env::var_os("XDG_CONFIG_HOME")
        },
    )
}

fn search_dirs(os: Os, home: &Path, inherited: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut dirs = inherited;
    if os != Os::Windows {
        // Finder-launched apps do not inherit an interactive shell's PATH.
        // Do not execute login shells or user startup scripts just to discover CLIs.
        for dir in [
            home.join(".local/bin"),
            home.join(".cargo/bin"),
            home.join(".bun/bin"),
            home.join("Library/pnpm"),
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
        ] {
            if !dirs.contains(&dir) {
                dirs.push(dir);
            }
        }
    }
    dirs
}

pub fn cli_path() -> OsString {
    let inherited = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    std::env::join_paths(search_dirs(current_os(), &home(), inherited)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_and_auth_paths_follow_the_host_platform() {
        let home = Path::new("/Users/tester");
        assert_eq!(
            default_data_dir(Os::Mac, home, None, None),
            home.join("Library/Application Support/AgentCouncil")
        );
        assert_eq!(
            cursor_path(Os::Mac, home, None, None),
            home.join("Library/Application Support/Cursor")
        );
        assert_eq!(
            default_data_dir(Os::Windows, home, None, None),
            home.join("AgentCouncil")
        );
        assert_eq!(
            cursor_path(Os::Windows, home, None, None),
            home.join("AppData/Roaming/Cursor")
        );
        assert_eq!(
            default_data_dir(Os::Linux, home, None, Some("relative".into())),
            home.join(".local/share/AgentCouncil")
        );
    }

    #[test]
    fn gui_path_preserves_explicit_priority_and_adds_native_install_locations() {
        let home = Path::new("/Users/tester");
        let first = home.join("custom/bin");
        let dirs = search_dirs(Os::Mac, home, vec![first.clone()]);
        assert_eq!(dirs[0], first);
        assert!(dirs.contains(&home.join(".local/bin")));
        assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert_eq!(
            search_dirs(Os::Windows, home, vec![first.clone()]),
            vec![first]
        );
    }
}
