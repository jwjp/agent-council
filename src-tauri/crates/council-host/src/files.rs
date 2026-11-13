use anyhow::{Context, Result};
use serde::Serialize;
use std::{
    io::Read,
    path::{Path, PathBuf},
};

#[derive(Serialize)]
pub struct Preview {
    pub path: String,
    pub name: String,
    pub text: String,
    pub line: Option<usize>,
    pub truncated: bool,
    pub start_line: usize,
}

fn target(raw: &str) -> Result<(String, Option<usize>)> {
    let decoded = urlencoding::decode(raw)
        .context("Invalid file link")?
        .into_owned();
    let mut path = decoded.trim().to_owned();
    if let Some(p) = path.strip_prefix("file:///") {
        path = if cfg!(windows) {
            p.to_owned()
        } else {
            format!("/{p}")
        };
    }
    anyhow::ensure!(
        !path.contains('\0') && !path.starts_with("//") && !path.starts_with(r"\\"),
        "Unsupported file link"
    );
    let mut line = None;
    if let Some((p, fragment)) = path.rsplit_once('#') {
        line = fragment
            .strip_prefix('L')
            .and_then(|s| s.split('-').next()?.parse().ok());
        path = p.to_owned();
    }
    let re = regex::Regex::new(r":(\d+)(?::\d+)?$")?;
    if let Some(c) = re.captures(&path) {
        line = c[1].parse().ok();
        path.truncate(c.get(0).unwrap().start());
    }
    anyhow::ensure!(!path.is_empty(), "Choose a file link");
    Ok((path, line.filter(|&n| n > 0)))
}

pub fn read(
    folder: &str,
    references: &[String],
    profiles: &[crate::model::AgentProfile],
    raw: &str,
) -> Result<Preview> {
    let (link, line) = target(raw)?;
    let path = Path::new(&link);
    let candidates = if path.is_absolute() {
        vec![path.to_path_buf()]
    } else {
        std::iter::once(folder)
            .chain(references.iter().map(String::as_str))
            .flat_map(|p| {
                let root = Path::new(p);
                let mut candidates = vec![root.join(path)];
                if let Some(name) = root.file_name() {
                    if let Ok(relative) = path.strip_prefix(name) {
                        candidates.push(root.join(relative));
                    }
                }
                candidates
            })
            .collect::<Vec<PathBuf>>()
    };
    let path = candidates
        .into_iter()
        .find_map(|p| p.canonicalize().ok().filter(|p| p.is_file()))
        .context("File not found in the project or reference folders.")?;
    let allowed = std::iter::once(folder)
        .chain(references.iter().map(String::as_str))
        .filter_map(|p| Path::new(p).canonicalize().ok())
        .any(|root| path.starts_with(root));
    anyhow::ensure!(
        allowed,
        "This file is outside the project and reference folders."
    );
    anyhow::ensure!(
        !crate::agent_accounts::PROVIDERS
            .into_iter()
            .flat_map(|provider| [
                crate::agent_accounts::managed_root(provider),
                crate::agent_accounts::default_dir(provider),
            ])
            .chain(
                profiles
                    .iter()
                    .map(|profile| PathBuf::from(&profile.config_dir))
            )
            .any(|folder| folder
                .canonicalize()
                .is_ok_and(|root| path.starts_with(root))),
        "Agent account folders are private."
    );
    const MAX: u64 = 512 * 1024;
    let mut bytes = Vec::new();
    std::fs::File::open(&path)?
        .take(MAX + 1)
        .read_to_end(&mut bytes)?;
    let mut truncated = bytes.len() as u64 > MAX;
    bytes.truncate(MAX as usize);
    anyhow::ensure!(
        !bytes.contains(&0),
        "This file is binary and cannot be previewed as text."
    );
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    let lines = text.split('\n').collect::<Vec<_>>();
    let start = if lines.len() > 3000 {
        line.unwrap_or(1)
            .saturating_sub(1200)
            .min(lines.len() - 3000)
    } else {
        0
    };
    if lines.len() > 3000 {
        text = lines[start..start + 3000].join("\n");
        truncated = true;
    }
    Ok(Preview {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        path: path.to_string_lossy().trim_start_matches(r"\\?\").into(),
        text,
        line,
        truncated,
        start_line: start + 1,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn links_preserve_drive_colons_and_line_numbers() {
        assert_eq!(
            target("C:/work/main.py:8:2").unwrap(),
            ("C:/work/main.py".into(), Some(8))
        );
        assert_eq!(
            target("src/My%20file.rs#L12-L18").unwrap(),
            ("src/My file.rs".into(), Some(12))
        );
        #[cfg(unix)]
        assert_eq!(
            target("file:///Users/tester/main.rs#L8").unwrap(),
            ("/Users/tester/main.rs".into(), Some(8))
        );
    }
    #[test]
    fn preview_resolves_references_but_rejects_escape() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let project = root.join("project");
        let reference = root.join("reference");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir(&reference).unwrap();
        std::fs::write(reference.join("한글.rs"), "first\n둘째").unwrap();
        std::fs::write(root.join("outside.txt"), "private").unwrap();
        std::fs::write(project.join("binary.dat"), [0, 1, 2, 3]).unwrap();
        let p = project.to_str().unwrap();
        let refs = vec![reference.to_string_lossy().into_owned()];
        let preview = read(p, &refs, &[], "한글.rs:2").unwrap();
        assert_eq!(preview.line, Some(2));
        assert!(preview.text.contains("둘째"));
        assert!(read(p, &refs, &[], "../outside.txt").is_err());
        assert!(read(p, &refs, &[], "binary.dat").is_err());
        std::fs::write(
            project.join("long.txt"),
            (1..=7000)
                .map(|n| format!("line {n}"))
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .unwrap();
        let long = read(p, &refs, &[], "long.txt:6000").unwrap();
        assert!(long.start_line > 1 && long.truncated);
        assert_eq!(long.text.split('\n').count(), 3000);
        assert!(long.text.contains("line 6000"));
        assert!(read(p, &refs, &[], "javascript:alert(1)").is_err());
        assert!(root
            .canonicalize()
            .unwrap()
            .starts_with(std::env::temp_dir().canonicalize().unwrap()));
        std::fs::remove_dir_all(root).unwrap();
    }
}
