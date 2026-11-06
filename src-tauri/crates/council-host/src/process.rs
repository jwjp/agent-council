use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::Read,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
};
use tokio_util::sync::CancellationToken;

pub fn hidden(command: &mut Command) -> &mut Command {
    command.env("PATH", crate::platform::cli_path());
    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
    }
    command
}

pub fn launcher(name: &str) -> Result<(PathBuf, Vec<String>)> {
    launcher_in(
        name,
        &crate::platform::cli_path(),
        &std::env::current_dir()?,
    )
}

fn launcher_in(name: &str, path: &std::ffi::OsStr, cwd: &Path) -> Result<(PathBuf, Vec<String>)> {
    // Grok also installs `agent.exe`. Its login is unrelated to Cursor's.
    if name == "agent" {
        if let Ok(executable) = which::which_in("cursor-agent", Some(path), cwd) {
            return resolve_launcher(name, executable);
        }
    }
    let executable = which::which_in(name, Some(path), cwd)
        .with_context(|| format!("CLI not found on PATH: {name}"))?;
    let launch = resolve_launcher(name, executable.clone())?;
    // Supported Windows Node layouts are explicitly Cursor-specific. A generic
    // native `agent` must identify itself before we send any project prompt.
    if name == "agent" && launch.1.is_empty() {
        anyhow::ensure!(
            cursor_identity(&launch.0),
            "The agent command at {} could not be identified as Cursor (Grok also uses this name). Use Cursor's cursor-agent command; check cursor-agent status and sign in with cursor-agent login.",
            executable.display()
        );
    }
    Ok(launch)
}

fn resolve_launcher(name: &str, executable: PathBuf) -> Result<(PathBuf, Vec<String>)> {
    #[cfg(windows)]
    if executable
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("ps1"))
    {
        let root = executable.parent().unwrap();
        if name == "agent" {
            let mut versions = vec![root.to_owned()];
            if let Ok(entries) = std::fs::read_dir(root.join("versions")) {
                let mut paths: Vec<_> = entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
                paths.sort();
                paths.reverse();
                versions.extend(paths);
            }
            for version in versions {
                if version.join("node.exe").is_file() && version.join("index.js").is_file() {
                    return Ok((
                        version.join("node.exe"),
                        vec![version.join("index.js").to_string_lossy().into()],
                    ));
                }
            }
        }
        let script = match name {
            "codex" => "@openai/codex/bin/codex.js",
            "gemini" => "@google/gemini-cli/bundle/gemini.js",
            "claude" => "@anthropic-ai/claude-code/cli.js",
            _ => "",
        };
        let script = root.join("node_modules").join(script);
        if script.is_file() {
            let node = if root.join("node.exe").is_file() {
                root.join("node.exe")
            } else {
                which::which("node")?
            };
            return Ok((node, vec![script.to_string_lossy().into()]));
        }
        anyhow::bail!(
            "Unsupported CLI launcher: {}. Install a native executable or supported Node launcher.",
            executable.display()
        );
    }
    Ok((executable, vec![]))
}

fn cursor_identity(program: &Path) -> bool {
    type Entry = (Option<std::time::SystemTime>, u64, bool);
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Entry>>> = OnceLock::new();
    let Ok(meta) = program.metadata() else {
        return false;
    };
    let stamp = (meta.modified().ok(), meta.len());
    let mut cache = CACHE.get_or_init(Default::default).lock().unwrap();
    if let Some((modified, len, result)) = cache.get(program) {
        if (*modified, *len) == stamp {
            return *result;
        }
    }
    let result = probe_cursor_identity(program);
    if cache.len() >= 64 {
        cache.clear();
    }
    cache.insert(program.to_path_buf(), (stamp.0, stamp.1, result));
    result
}

fn probe_cursor_identity(program: &Path) -> bool {
    // A bounded, no-model help probe, cached by file identity metadata. Never
    // probe login or run a project request merely to discover a provider.
    let mut command = std::process::Command::new(program);
    command
        .arg("--help")
        .env("PATH", crate::platform::cli_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let Ok(mut child) = command.spawn() else {
        return false;
    };
    #[cfg(windows)]
    let guard = {
        use std::os::windows::io::AsRawHandle;
        match JobGuard::assign(child.as_raw_handle()) {
            Ok(guard) => guard,
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    };
    #[cfg(unix)]
    let guard = ProcessGroup(child.id() as i32);
    let stdout = child.stdout.take().unwrap();
    let output = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.take(65536).read_to_string(&mut text);
        text
    });
    let start = Instant::now();
    let success = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if start.elapsed() < Duration::from_secs(3) => {
                std::thread::sleep(Duration::from_millis(20))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break false;
            }
        }
    };
    drop(guard);
    let text = output.join().unwrap_or_default().to_ascii_lowercase();
    success && text.contains("cursor agent") && text.contains("cursor_api_key")
}
pub fn args(name: &str, prompt: &str, implement: bool, full: bool) -> Vec<String> {
    let mut args: Vec<&str> = match name {
        "codex" => {
            if full {
                vec![
                    "exec",
                    "--dangerously-bypass-approvals-and-sandbox",
                    "--skip-git-repo-check",
                    "--json",
                    "-",
                ]
            } else {
                vec![
                    "exec",
                    "--sandbox",
                    if implement {
                        "workspace-write"
                    } else {
                        "read-only"
                    },
                    "--skip-git-repo-check",
                    "--json",
                    "-",
                ]
            }
        }
        "claude" => {
            if full {
                vec!["--print", "--dangerously-skip-permissions"]
            } else if implement {
                vec!["--print", "--permission-mode", "acceptEdits"]
            } else {
                vec![
                    "--print",
                    "--permission-mode",
                    "plan",
                    "--tools=Read,Glob,Grep",
                ]
            }
        }
        "agy" => {
            if full {
                vec![
                    "--output-format",
                    "stream-json",
                    "--dangerously-skip-permissions",
                    "--mode",
                    "auto",
                    "--print",
                    prompt,
                ]
            } else {
                vec![
                    "--output-format",
                    "stream-json",
                    "--mode",
                    if implement { "accept-edits" } else { "plan" },
                    "--print",
                    prompt,
                ]
            }
        }
        "grok" => vec![
            "--output-format",
            "streaming-json",
            "--permission-mode",
            if full {
                "bypassPermissions"
            } else if implement {
                "acceptEdits"
            } else {
                "plan"
            },
            "--single",
            prompt,
        ],
        "gemini" => {
            let mut a = vec![
                "--output-format",
                "stream-json",
                "--approval-mode",
                if full {
                    "yolo"
                } else if implement {
                    "auto_edit"
                } else {
                    "plan"
                },
            ];
            if full {
                a.push("--sandbox=false");
            }
            a.extend(["--prompt", "Respond to the request above."]);
            a
        }
        _ => {
            if full {
                vec!["--print", "--yolo", "--sandbox", "disabled", "--", prompt]
            } else if implement {
                vec!["--print", "--sandbox", "enabled", "--", prompt]
            } else {
                vec![
                    "--print",
                    "--mode",
                    "ask",
                    "--sandbox",
                    "enabled",
                    "--",
                    prompt,
                ]
            }
        }
    };
    if name == "claude" {
        args.extend([
            "--verbose",
            "--output-format",
            "stream-json",
            "--include-partial-messages",
        ]);
    }
    args.into_iter().map(str::to_owned).collect()
}

#[derive(Default, Debug)]
pub struct Parsed {
    pub answer: String,
    pub preview: String,
    pub input: u64,
    pub output: u64,
    pub has_usage: bool,
    pub failed: bool,
    pub error: String,
    pub limits: Option<Value>,
}
impl Parsed {
    pub fn line(&mut self, name: &str, line: &str) -> Option<String> {
        if name == "agent" {
            self.answer.push_str(line);
            self.answer.push('\n');
            self.preview = self.answer.clone();
            return None;
        }
        let Ok(e) = serde_json::from_str::<Value>(line) else {
            return None;
        };
        let kind = e["type"].as_str().or(e["event"].as_str()).unwrap_or("");
        if kind == "error" {
            self.failed = true;
            self.error = e["error"]["message"]
                .as_str()
                .or(e["message"].as_str())
                .or(e["error"].as_str())
                .unwrap_or("The CLI reported an error.")
                .into();
        }
        let item = &e["item"];
        let mut usage = Value::Null;
        let mut tool = None;
        match name {
            "codex" => {
                if ["item.completed", "item.updated"].contains(&kind)
                    && item["type"] == "agent_message"
                {
                    self.preview = item["text"].as_str().unwrap_or("").into();
                    if kind == "item.completed" {
                        self.answer = self.preview.clone();
                    }
                }
                if kind == "turn.completed" {
                    usage = e["usage"].clone();
                }
                if kind == "turn.failed" {
                    self.failed = true;
                    self.error = e["error"]["message"]
                        .as_str()
                        .unwrap_or("Turn failed")
                        .into();
                }
                if ["command_execution", "file_change", "mcp_tool_call"]
                    .contains(&item["type"].as_str().unwrap_or(""))
                {
                    tool = Some(item["type"].as_str().unwrap().into());
                }
            }
            "claude" => {
                if kind == "stream_event" && e["event"]["delta"]["type"] == "text_delta" {
                    self.preview
                        .push_str(e["event"]["delta"]["text"].as_str().unwrap_or(""));
                }
                if kind == "result" {
                    self.answer = e["result"].as_str().unwrap_or("").into();
                    self.failed = e["is_error"].as_bool().unwrap_or(false);
                    usage = e["usage"].clone();
                    if let Some(u) = usage.as_object_mut() {
                        let total = u.get("input_tokens").and_then(Value::as_u64).unwrap_or(0)
                            + u.get("cache_read_input_tokens")
                                .and_then(Value::as_u64)
                                .unwrap_or(0)
                            + u.get("cache_creation_input_tokens")
                                .and_then(Value::as_u64)
                                .unwrap_or(0);
                        u.insert("input_tokens".into(), json!(total));
                    }
                }
                if kind == "rate_limit_event" {
                    self.limits = Some(e["rate_limit_info"].clone());
                }
                if let Some(blocks) = e["message"]["content"].as_array() {
                    for b in blocks {
                        if b["type"] == "tool_use" {
                            tool = Some(
                                b["name"]
                                    .as_str()
                                    .unwrap_or("Tool")
                                    .chars()
                                    .take(45)
                                    .collect(),
                            );
                        }
                    }
                }
            }
            "agy" => {
                if kind == "step_update" && e["step_update"]["step_type"] == "agent_response" {
                    self.preview
                        .push_str(e["step_update"]["text_delta"].as_str().unwrap_or(""));
                }
                if kind == "result" {
                    self.answer = e["result"]["response"].as_str().unwrap_or("").into();
                    self.failed = e["result"]["status"] != "SUCCESS";
                    usage = e["result"]["usage"].clone();
                    self.error = e["result"]["error"]["message"]
                        .as_str()
                        .or(e["result"]["error"].as_str())
                        .unwrap_or("")
                        .into();
                }
            }
            "grok" => {
                if kind == "text" {
                    let part = e["data"]
                        .as_str()
                        .or(e["data"]["text"].as_str())
                        .unwrap_or("");
                    self.answer.push_str(part);
                    self.preview = self.answer.clone();
                }
                if kind == "end" {
                    usage = e["usage"].clone();
                }
            }
            "gemini" => {
                if kind == "message" && e["role"] == "assistant" {
                    if !e["delta"].as_bool().unwrap_or(false) {
                        self.answer.clear();
                    }
                    self.answer.push_str(e["content"].as_str().unwrap_or(""));
                    self.preview = self.answer.clone();
                }
                if kind == "result" {
                    self.failed = e["status"] != "success";
                    usage = e["stats"].clone();
                    self.error = e["error"]["message"].as_str().unwrap_or("").into();
                }
            }
            _ => {}
        }
        if let Some(n) = usage["input_tokens"].as_u64() {
            self.input = n;
            self.has_usage = true;
        }
        if let Some(n) = usage["output_tokens"].as_u64() {
            self.output = n;
            self.has_usage = true;
        }
        // Prevent malformed or exceptionally verbose provider output from exhausting memory.
        // Keep the beginning: tail slicing breaks sentences and Markdown links.
        // The final answer is retained separately from this bounded preview.
        if self.preview.len() > 512000 {
            self.preview = self.preview.chars().take(128000).collect();
        }
        tool
    }
}

pub async fn run<F>(
    name: &str,
    prompt: &str,
    cwd: &Path,
    implement: bool,
    full: bool,
    cancel: CancellationToken,
    mut emit: F,
) -> Result<Parsed>
where
    F: FnMut(&str, &str, Value) + Send,
{
    let (program, prefix) = launcher(name)?;
    let mut command = Command::new(program);
    command
        .args(prefix)
        .args(args(name, prompt, implement, full))
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    hidden(&mut command);
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command.spawn()?;
    #[cfg(windows)]
    let _guard = JobGuard::assign(child.raw_handle().context("Process handle missing")?)?;
    #[cfg(unix)]
    let _guard = ProcessGroup(child.id().context("Process ID missing")? as i32);
    let mut input = child.stdin.take().unwrap();
    let source = if ["codex", "claude", "gemini"].contains(&name) {
        prompt.to_owned()
    } else {
        String::new()
    };
    let writer = tokio::spawn(async move {
        let result = input.write_all(source.as_bytes()).await;
        let _ = input.shutdown().await;
        result
    });
    let mut stdout = BufReader::new(child.stdout.take().unwrap()).lines();
    let mut stderr = BufReader::new(child.stderr.take().unwrap()).lines();
    let mut parsed = Parsed::default();
    let mut output_open = true;
    let mut error_open = true;
    let deadline = tokio::time::sleep(Duration::from_secs(600));
    tokio::pin!(deadline);
    let mut last = Instant::now() - Duration::from_secs(5);
    let mut last_note = String::new();
    let result:Result<()> = async {
        while output_open||error_open {tokio::select! {
            _=cancel.cancelled()=>anyhow::bail!("Cancelled"),
            _=&mut deadline=>anyhow::bail!("CLI timed out after 600 seconds"),
            line=stdout.next_line(),if output_open=>match line? {Some(line)=>{
                anyhow::ensure!(line.len()<4_000_000,"CLI output line exceeded limit");
                if let Some(tool)=parsed.line(name,&line){emit("tool",&tool,Value::Null);}
                if let Some(limits)=parsed.limits.take(){emit("limits","",limits);}
                if last.elapsed()>=Duration::from_secs(3)&&parsed.preview!=last_note&&!parsed.preview.is_empty(){last_note=parsed.preview.clone();emit_note(&parsed.preview,&mut emit);last=Instant::now();}
            },None=>output_open=false},
            line=stderr.next_line(),if error_open=>match line?{Some(line)=>{parsed.error.push_str(&line);parsed.error.push('\n');if parsed.error.len()>8000{parsed.error=parsed.error.chars().rev().take(4000).collect::<String>().chars().rev().collect();}},None=>error_open=false}
        }}
        tokio::select!{status=child.wait()=>{anyhow::ensure!(status?.success(),"{}",if parsed.error.is_empty(){"CLI exited unsuccessfully"}else{&parsed.error});},_=cancel.cancelled()=>anyhow::bail!("Cancelled"),_=&mut deadline=>anyhow::bail!("CLI timed out")};Ok(())
    }.await;
    writer.abort();
    if result.is_err() {
        let _ = child.kill().await;
    }
    result?;
    if name == "agy"
        && !parsed.failed
        && parsed.answer.trim().is_empty()
        && !parsed.preview.trim().is_empty()
    {
        parsed.answer = parsed.preview.clone();
    }
    anyhow::ensure!(
        !parsed.failed,
        "{}",
        if parsed.error.is_empty() {
            &parsed.answer
        } else {
            &parsed.error
        }
    );
    anyhow::ensure!(
        !parsed.answer.trim().is_empty(),
        "CLI returned no answer. {}",
        parsed.error
    );
    if !parsed.answer.is_empty() {
        emit_note(&parsed.answer, &mut emit);
    }
    if parsed.has_usage {
        emit(
            "usage",
            "",
            json!({"input_tokens":parsed.input,"output_tokens":parsed.output}),
        );
    }
    Ok(parsed)
}

fn emit_note<F: FnMut(&str, &str, Value)>(text: &str, emit: &mut F) {
    let note = text.chars().take(64000).collect::<String>();
    emit(
        "note",
        &note,
        json!({"truncated":text.chars().count()>64000}),
    );
}

#[cfg(unix)]
struct ProcessGroup(i32);
#[cfg(unix)]
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        // A new process group is created before exec; signal only that owned group.
        // This also cleans up descendants holding inherited output pipes on cancellation.
        if self.0 > 1 {
            unsafe {
                libc::kill(-self.0, libc::SIGKILL);
            }
        }
    }
}

#[cfg(windows)]
struct JobGuard(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl JobGuard {
    fn assign(process: std::os::windows::io::RawHandle) -> Result<Self> {
        unsafe {
            use windows_sys::Win32::System::JobObjects::*;
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            anyhow::ensure!(!handle.is_null(), "Cannot create process job");
            let guard = Self(handle);
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            anyhow::ensure!(
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as _,
                    std::mem::size_of_val(&info) as u32
                ) != 0,
                "Cannot configure process job"
            );
            anyhow::ensure!(
                AssignProcessToJobObject(handle, process as _) != 0,
                "Cannot attach process job"
            );
            Ok(guard)
        }
    }
}
#[cfg(windows)]
impl Drop for JobGuard {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
#[cfg(windows)]
unsafe impl Send for JobGuard {}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cursor_alias_takes_priority_over_generic_agent_on_path() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let grok = root.join("grok");
        let cursor = root.join("cursor");
        std::fs::create_dir_all(&grok).unwrap();
        std::fs::create_dir_all(&cursor).unwrap();
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let generic = grok.join(format!("agent{suffix}"));
        let alias = cursor.join(format!("cursor-agent{suffix}"));
        for file in [&generic, &alias] {
            std::fs::write(file, "fixture executable").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o700)).unwrap();
            }
        }
        let path = std::env::join_paths([&grok, &cursor]).unwrap();
        let selected = launcher_in("agent", &path, &root).unwrap().0;
        assert_eq!(
            selected.canonicalize().unwrap(),
            alias.canonicalize().unwrap()
        );
        assert!(root
            .canonicalize()
            .unwrap()
            .starts_with(std::env::temp_dir().canonicalize().unwrap()));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn generic_agent_help_must_identify_cursor_and_does_not_run_models() {
        // The Rust test runner's --help is deliberately unrelated to Cursor.
        // Install it under the colliding name, with no Cursor-specific alias.
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&root).unwrap();
        let file = root.join(if cfg!(windows) { "agent.exe" } else { "agent" });
        std::fs::copy(std::env::current_exe().unwrap(), &file).unwrap();
        let error = launcher_in("agent", root.as_os_str(), &root)
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("could not be identified as Cursor"),
            "{error}"
        );
        assert!(root
            .canonicalize()
            .unwrap()
            .starts_with(std::env::temp_dir().canonicalize().unwrap()));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn notes_keep_complete_sentences_and_markdown_links() {
        let text = format!(
            "[main.rs](main.rs:8)\n{}\nEnd of the note.",
            "Readable sentence. ".repeat(100)
        );
        let mut saved = String::new();
        let mut data = Value::Null;
        emit_note(&text, &mut |_, note, meta| {
            saved = note.into();
            data = meta;
        });
        assert_eq!(saved, text);
        assert_eq!(data["truncated"], false);
        emit_note(&"한".repeat(65000), &mut |_, note, meta| {
            saved = note.into();
            data = meta;
        });
        assert_eq!(saved.chars().count(), 64000);
        assert_eq!(data["truncated"], true);
    }
    #[test]
    fn permissions_are_explicit_and_prompts_remain_arguments() {
        for name in crate::model::AGENTS {
            let a = args(name, "hello\n\" & $(secret)", false, true);
            assert!(a.iter().any(|a| a.contains("bypass")
                || a.contains("skip-permissions")
                || a == "yolo"
                || a == "--yolo"));
        }
        assert!(args("codex", "", false, false).contains(&"read-only".into()));
    }
    #[test]
    fn claude_cache_is_counted_once() {
        let mut p = Parsed::default();
        p.line("claude",r#"{"type":"result","result":"ok","usage":{"input_tokens":10,"cache_read_input_tokens":30,"output_tokens":5}}"#);
        assert_eq!((p.input, p.output), (40, 5));
    }
    #[test]
    fn codex_final_does_not_repeat_streamed_text() {
        let mut p = Parsed::default();
        p.line(
            "codex",
            r#"{"type":"item.updated","item":{"type":"agent_message","text":"draft"}}"#,
        );
        p.line(
            "codex",
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"final"}}"#,
        );
        assert_eq!(p.answer, "final");
    }
}
