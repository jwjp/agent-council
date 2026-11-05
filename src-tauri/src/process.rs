use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
};
use tokio_util::sync::CancellationToken;

pub fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
    }
    command
}

pub fn launcher(name: &str) -> Result<(PathBuf, Vec<String>)> {
    let executable =
        which::which(name).with_context(|| format!("CLI not found on PATH: {name}"))?;
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
                    self.error = e["result"]["error"].as_str().unwrap_or("").into();
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
        if self.preview.len() > 16000 {
            self.preview = self
                .preview
                .chars()
                .rev()
                .take(3000)
                .collect::<String>()
                .chars()
                .rev()
                .collect();
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
    let mut child = command.spawn()?;
    #[cfg(windows)]
    let _guard = JobGuard::assign(child.raw_handle().context("Process handle missing")?)?;
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
                if last.elapsed()>=Duration::from_secs(3)&&parsed.preview!=last_note&&!parsed.preview.is_empty(){last_note=parsed.preview.clone();let note=parsed.preview.chars().rev().take(420).collect::<String>().chars().rev().collect::<String>();emit("note",&note,Value::Null);last=Instant::now();}
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
    if parsed.has_usage {
        emit(
            "usage",
            "",
            json!({"input_tokens":parsed.input,"output_tokens":parsed.output}),
        );
    }
    Ok(parsed)
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
