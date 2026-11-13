use crate::model::{data_dir, Settings};
use anyhow::{bail, ensure, Result};
use serde::Serialize;
use similar::TextDiff;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{ErrorKind, Read},
    path::{Component, Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tokio::{io::AsyncReadExt, process::Command, time::timeout};

const MAX_PATHS: usize = 4000;
const MAX_FOLDER_ENTRIES: usize = 12000;
const MAX_LIST_BYTES: usize = 1024 * 1024;
const MAX_FILE_BYTES: usize = 128 * 1024;
const MAX_CAPTURE_BYTES: usize = 24 * 1024 * 1024;
const MAX_CHANGES: usize = 100;
const MAX_PATCH_BYTES: usize = 16 * 1024;
const MAX_TOTAL_PATCH_BYTES: usize = 128 * 1024;

pub(crate) struct Capture {
    source: Source,
    files: BTreeMap<String, Option<Vec<u8>>>,
    skipped: usize,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum Source {
    Git,
    Folder,
}

#[derive(Serialize)]
pub(crate) struct Changes {
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<Source>,
    skipped: usize,
    files: Vec<Change>,
}

#[derive(Serialize)]
struct Change {
    path: String,
    kind: &'static str,
    patch: Option<String>,
    truncated: bool,
}

impl Changes {
    fn unavailable() -> Self {
        Self {
            available: false,
            source: None,
            skipped: 0,
            files: Vec::new(),
        }
    }

    pub(crate) fn evidence(&self) -> String {
        if !self.available {
            return "No comparable project snapshots are available.".into();
        }
        let mut result = format!(
            "{} changes since this request started. Omitted snapshot entries or file changes: {}.\n",
            match self.source {
                Some(Source::Folder) => "Project-folder (supported text files only)",
                _ => "Working-tree",
            },
            self.skipped
        );
        for file in &self.files {
            let row = format!("{}: {:?}\n", file.kind, file.path);
            if result.len() + row.len() > 3000 {
                result.push_str("Additional paths omitted from this excerpt.\n");
                break;
            }
            result.push_str(&row);
        }
        for patch in self.files.iter().filter_map(|file| file.patch.as_deref()) {
            let remaining = 6000usize.saturating_sub(result.len());
            if remaining == 0 {
                break;
            }
            result.push_str(&patch[..patch.floor_char_boundary(remaining.min(patch.len()))]);
            result.push('\n');
        }
        if self.files.is_empty() {
            result.push_str("No changes were observed in comparable files.");
        }
        result
    }
}

impl Capture {
    pub(crate) async fn take(settings: &Settings) -> Option<Arc<Self>> {
        Self::take_with_previous(settings, None).await.map(Arc::new)
    }

    async fn take_with_previous(settings: &Settings, previous: Option<Arc<Self>>) -> Option<Self> {
        let folder = PathBuf::from(&settings.folder);
        let git_listing = match previous.as_ref().map(|capture| capture.source) {
            Some(Source::Folder) => None,
            _ => listed_files(&folder).await.ok(),
        };
        let mut private_dirs = vec![data_dir()];
        for provider in crate::agent_accounts::PROVIDERS {
            private_dirs.push(crate::agent_accounts::default_dir(provider));
        }
        private_dirs.extend(
            settings
                .agent_profiles
                .iter()
                .map(|p| PathBuf::from(&p.config_dir)),
        );
        let references = settings.references.clone();
        timeout(
            Duration::from_secs(8),
            tokio::task::spawn_blocking(move || {
                let root = folder.canonicalize()?;
                let mut private_dirs: Vec<_> = private_dirs
                    .iter()
                    .filter_map(|p| p.canonicalize().ok())
                    .collect();
                ensure!(
                    !private_dirs.iter().any(|dir| root.starts_with(dir)),
                    "Private folder"
                );
                private_dirs.extend(references.iter().filter_map(|p| {
                    let path = Path::new(p).canonicalize().ok()?;
                    (path != root && path.starts_with(&root)).then_some(path)
                }));
                let (source, listing) = match git_listing {
                    Some(listing) => (Source::Git, listing),
                    None => {
                        let folder_baseline = previous
                            .as_ref()
                            .is_some_and(|capture| matches!(capture.source, Source::Folder));
                        ensure!(
                            folder_baseline || (previous.is_none() && !has_git_ancestor(&root)?),
                            "Git file listing unavailable"
                        );
                        (Source::Folder, folder_listing(&root, &private_dirs)?)
                    }
                };
                capture_files(&root, source, &listing, &private_dirs, previous.as_deref())
            }),
        )
        .await
        .ok()?
        .ok()?
        .ok()
    }

    pub(crate) async fn changes(before: Option<&Arc<Self>>, settings: &Settings) -> Changes {
        let Some(before) = before else {
            return Changes::unavailable();
        };
        let Some(after) = Self::take_with_previous(settings, Some(before.clone())).await else {
            return Changes::unavailable();
        };
        let before = before.clone();
        tokio::task::spawn_blocking(move || before.compare(&after))
            .await
            .unwrap_or_else(|_| Changes::unavailable())
    }

    fn compare(&self, after: &Self) -> Changes {
        let mut changes = Changes {
            available: true,
            source: Some(self.source),
            skipped: self.skipped + after.skipped,
            files: Vec::new(),
        };
        let paths: BTreeSet<_> = self.files.keys().chain(after.files.keys()).collect();
        let mut patch_budget = MAX_TOTAL_PATCH_BYTES;
        for path in paths {
            let old = self.files.get(path);
            let new = after.files.get(path);
            if old == new || matches!(old, Some(None)) || matches!(new, Some(None)) {
                continue;
            }
            if changes.files.len() == MAX_CHANGES {
                changes.skipped += 1;
                continue;
            }
            let kind = match (old, new) {
                (None, _) => "added",
                (_, None) => "deleted",
                _ => "modified",
            };
            let patch = text_patch(path, old, new);
            let limit = patch_budget.min(MAX_PATCH_BYTES);
            let truncated = patch.as_ref().is_some_and(|text| text.len() > limit);
            let patch = patch.and_then(|mut text| {
                text.truncate(text.floor_char_boundary(limit.min(text.len())));
                patch_budget -= text.len();
                (!text.is_empty()).then_some(text)
            });
            changes.files.push(Change {
                path: path.clone(),
                kind,
                patch,
                truncated,
            });
        }
        changes
    }
}

async fn listed_files(folder: &Path) -> Result<Vec<u8>> {
    let mut cmd = Command::new("git");
    cmd.args([
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "--literal-pathspecs",
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        ".",
    ])
    .env_remove("GIT_DIR")
    .env_remove("GIT_WORK_TREE")
    .env_remove("GIT_COMMON_DIR")
    .env_remove("GIT_INDEX_FILE")
    .current_dir(folder)
    .kill_on_drop(true)
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::null());
    crate::process::hidden(&mut cmd);
    timeout(Duration::from_secs(5), async {
        let mut child = cmd.spawn()?;
        let mut listing = Vec::new();
        child
            .stdout
            .take()
            .unwrap()
            .take((MAX_LIST_BYTES + 1) as u64)
            .read_to_end(&mut listing)
            .await?;
        ensure!(
            listing.len() <= MAX_LIST_BYTES,
            "Too many Git paths to capture"
        );
        ensure!(
            child.wait().await?.success(),
            "Git file listing unavailable"
        );
        Ok(listing)
    })
    .await?
}

fn has_git_ancestor(folder: &Path) -> Result<bool> {
    for directory in folder.ancestors() {
        match fs::symlink_metadata(directory.join(".git")) {
            Ok(_) => return Ok(true),
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(false)
}

fn folder_listing(root: &Path, private_dirs: &[PathBuf]) -> Result<Vec<u8>> {
    let mut listing = Vec::new();
    let mut directories = vec![root.to_path_buf()];
    let mut visited = 0;
    let mut files = 0;
    while let Some(directory) = directories.pop() {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            visited += 1;
            ensure!(
                visited <= MAX_FOLDER_ENTRIES,
                "Too many folder entries to capture"
            );
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if name.starts_with('.') {
                continue;
            }
            let path = entry.path();
            if private_dirs.iter().any(|dir| path.starts_with(dir)) {
                continue;
            }
            let kind = entry.file_type()?;
            if kind.is_dir() {
                if !matches!(
                    name.as_str(),
                    "node_modules"
                        | "target"
                        | "dist"
                        | "build"
                        | "venv"
                        | "__pycache__"
                        | "vendor"
                        | "multi_ai_runs"
                        | "web-dist"
                ) && path.canonicalize()? == path
                    && !path.join(".git").try_exists()?
                {
                    directories.push(path);
                }
            } else if kind.is_file() && project_text_file(&name, &path) {
                let relative = path.strip_prefix(root)?;
                let mut parts = relative.iter().map(|part| part.to_str());
                let name = parts.try_fold(String::new(), |mut name, part| {
                    if !name.is_empty() {
                        name.push('/');
                    }
                    name.push_str(part?);
                    Some(name)
                });
                let Some(name) = name else { continue };
                files += 1;
                ensure!(
                    files <= MAX_PATHS && listing.len() + name.len() < MAX_LIST_BYTES,
                    "Too many project files to capture"
                );
                listing.extend_from_slice(name.as_bytes());
                listing.push(0);
            }
        }
    }
    Ok(listing)
}

fn project_text_file(name: &str, path: &Path) -> bool {
    if matches!(
        name,
        "credentials.json"
            | "auth.json"
            | "secrets.json"
            | "secrets.yaml"
            | "secrets.yml"
            | "secrets.toml"
            | "secrets.txt"
    ) {
        return false;
    }
    matches!(
        name,
        "makefile" | "dockerfile" | "justfile" | "license" | "readme"
    ) || matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some(
            "py" | "pyi"
                | "rs"
                | "js"
                | "jsx"
                | "ts"
                | "tsx"
                | "mjs"
                | "cjs"
                | "vue"
                | "svelte"
                | "html"
                | "css"
                | "scss"
                | "go"
                | "java"
                | "kt"
                | "cs"
                | "c"
                | "cpp"
                | "h"
                | "hpp"
                | "php"
                | "rb"
                | "swift"
                | "sh"
                | "ps1"
                | "bat"
                | "cmd"
                | "sql"
                | "md"
                | "mdx"
                | "txt"
                | "rst"
                | "json"
                | "jsonc"
                | "yaml"
                | "yml"
                | "toml"
                | "ini"
                | "xml"
                | "lock"
        )
    )
}

fn capture_files(
    root: &Path,
    source: Source,
    listing: &[u8],
    private_dirs: &[PathBuf],
    previous: Option<&Capture>,
) -> Result<Capture> {
    let mut capture = Capture {
        source,
        files: BTreeMap::new(),
        skipped: 0,
    };
    let mut remaining = MAX_CAPTURE_BYTES;
    let paths: BTreeSet<_> = listing
        .split(|&byte| byte == 0)
        .filter(|p| !p.is_empty())
        .chain(
            previous
                .into_iter()
                .flat_map(|capture| capture.files.keys().map(|path| path.as_bytes())),
        )
        .collect();
    ensure!(
        paths.len() <= MAX_PATHS,
        "Too many project paths to capture"
    );
    for raw in paths {
        let Ok(name) = std::str::from_utf8(raw) else {
            capture.skipped += 1;
            continue;
        };
        let path = Path::new(name);
        let file = match read_file(root, path, private_dirs, remaining.min(MAX_FILE_BYTES)) {
            Ok(Some(bytes)) => {
                remaining -= bytes.len();
                Some(bytes)
            }
            Ok(None) => continue,
            Err(_) => {
                capture.skipped += 1;
                None
            }
        };
        capture.files.insert(name.into(), file);
    }
    Ok(capture)
}

fn read_file(
    root: &Path,
    relative: &Path,
    private_dirs: &[PathBuf],
    limit: usize,
) -> Result<Option<Vec<u8>>> {
    ensure!(
        relative
            .components()
            .all(|part| matches!(part, Component::Normal(_))),
        "Invalid project path"
    );
    ensure!(
        !relative.to_string_lossy().chars().any(char::is_control),
        "Unsupported project path"
    );
    let path = root.join(relative);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let name = relative
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase();
    if name == ".env" || name.starts_with(".env.") || name == ".credentials.json" {
        bail!("Credential file excluded");
    }
    let canonical = path.canonicalize()?;
    ensure!(
        metadata.is_file()
            && canonical == path
            && !private_dirs.iter().any(|dir| canonical.starts_with(dir)),
        "File is outside the capture scope"
    );
    ensure!(metadata.len() <= limit as u64, "Capture size limit");
    let mut bytes = Vec::new();
    File::open(canonical)?
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= limit, "Capture size limit");
    Ok(Some(bytes))
}

fn text_patch(
    path: &str,
    old: Option<&Option<Vec<u8>>>,
    new: Option<&Option<Vec<u8>>>,
) -> Option<String> {
    let old_bytes = old.and_then(Option::as_deref).unwrap_or_default();
    let new_bytes = new.and_then(Option::as_deref).unwrap_or_default();
    if old_bytes.contains(&0) || new_bytes.contains(&0) || old_bytes == new_bytes {
        return None;
    }
    let diff = TextDiff::configure()
        .timeout(Duration::from_millis(50))
        .diff_lines(
            std::str::from_utf8(old_bytes).ok()?,
            std::str::from_utf8(new_bytes).ok()?,
        );
    Some(
        diff.unified_diff()
            .header(&format!("Before: {path}"), &format!("After: {path}"))
            .to_string(),
    )
}
