// Deterministic CLI fixture for runtime integration tests. No model calls.
use std::{env,fs,time::Duration};
fn main(){
 let args:Vec<_>=env::args().collect();
 if args.iter().any(|s|s=="--child"){std::thread::sleep(Duration::from_secs(90));return;}
 let name=std::path::Path::new(&args[0]).file_stem().unwrap().to_string_lossy().to_string();
 let grok_alias=name=="agent"&&std::path::Path::new(&args[0]).parent().unwrap().join("agent-is-grok").is_file();
 if args.iter().any(|s|s=="--help") {if grok_alias {println!("Grok CLI. GROK_API_KEY");} else {println!("Start the Cursor Agent. CURSOR_API_KEY");}return;}
 if name == "claude" && args.get(1).is_some_and(|arg| arg == "auth") && args.get(2).is_some_and(|arg| arg == "status") {
  let config = std::path::PathBuf::from(env::var_os("CLAUDE_CONFIG_DIR").unwrap());
  let logged_in = config.ends_with(".claude") || config.join("fixture-signed-in").exists();
  let dir = config.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"");
  let email = if config.ends_with(".claude") { "default-fixture@example.invalid" } else { "extra-fixture@example.invalid" };
  println!(r#"{{"loggedIn":{logged_in},"configDirectory":"{dir}","authMethod":"claude.ai","email":"{email}","token":"fixture-secret"}}"#);
  std::process::exit(i32::from(!logged_in));
 }
 let extra_codex = name == "codex" && args.iter().any(|s| s == "cli_auth_credentials_store=file");
 if extra_codex {
  assert!(env::var_os("OPENAI_API_KEY").is_none());
  assert!(env::var_os("CODEX_API_KEY").is_none());
  let folder = std::path::PathBuf::from(env::var_os("CODEX_HOME").unwrap());
  if args.ends_with(&["login".into(), "status".into()]) {
   if folder.join("fixture-signed-in").is_file() {
    println!("Logged in using ChatGPT");
   } else {
    eprintln!("Not logged in");
    std::process::exit(1);
   }
   return;
  }
  assert!(folder.join("fixture-signed-in").is_file());
 }
 if name == "codex" && args.iter().any(|s| s == "app-server") {
  use std::io::{self, BufRead, Write};
  let mut stdout = io::stdout().lock();
  for line in io::stdin().lock().lines().map_while(Result::ok) {
   if line.contains("\"method\":\"initialize\"") {
    writeln!(stdout, r#"{{"id":1,"result":{{}}}}"#).unwrap();
   }
   if line.contains("account/rateLimits/read") {
    let used = if extra_codex { 67 } else { 31 };
    writeln!(stdout, r#"{{"id":2,"result":{{"rateLimits":{{"primary":{{"usedPercent":{used},"windowDurationMins":300}}}}}}}}"#).unwrap();
    return;
   }
   stdout.flush().unwrap();
  }
  return;
 }
 if grok_alias {fs::write("wrong-provider.txt","Grok ran in place of Cursor").unwrap();std::process::exit(4);}
 let mut prompt=String::new();if ["codex","claude","gemini"].contains(&name.as_str()){use std::io::Read;std::io::stdin().read_to_string(&mut prompt).unwrap();}else{prompt=args.last().cloned().unwrap_or_default();}
 if name == "claude" && prompt.contains("<request>CHECK_CLAUDE_PROFILES</request>") {
  let config = std::path::PathBuf::from(env::var_os("CLAUDE_CONFIG_DIR").unwrap());
  let (account, tokens, fraction) = match config.file_name().unwrap().to_str().unwrap() {
   ".claude" => ("default Claude", 11, 0.1),
   ".claude-jw" => {
    assert!(env::var_os("ANTHROPIC_API_KEY").is_none());
    ("Claude JW", 17, 0.2)
   }
   _ => panic!("unexpected Claude config directory"),
  };
  println!(r#"{{"type":"stream_event","event":{{"delta":{{"type":"text_delta","text":"{account} inspected the project."}}}}}}"#);
  println!(r#"{{"type":"rate_limit_event","rate_limit_info":{{"rateLimitType":"five_hour","utilization":{fraction}}}}}"#);
  println!(r#"{{"type":"result","result":"ANSWER\n{account} checked the project.","usage":{{"input_tokens":{tokens},"output_tokens":4}}}}"#);
  return;
 }
 if prompt.contains("<request>WAIT_FOR_CANCEL</request>") || prompt.contains("<request>WAIT_FOR_CANCEL from desktop</request>") {
  let child=std::process::Command::new(&args[0]).arg("--child").spawn().unwrap();
  fs::write("fixture-pids.txt",format!("{}\n{}",std::process::id(),child.id())).unwrap();std::thread::sleep(Duration::from_secs(90));
 }
 if prompt.contains("<request>SMOOTH_PROGRESS</request>")&&prompt.contains("Independently evaluate")&&name=="grok" {
  fs::write("slow-review-started.txt","waiting").unwrap();
  for _ in 0..300 {if std::path::Path::new("release-slow-review.txt").exists(){break;}std::thread::sleep(Duration::from_millis(50));}
 }
 if prompt.contains("FAIL_GROK_REVIEW")&&name=="grok" {eprintln!("Fixture authentication required");std::process::exit(3);}
 if name=="codex" && prompt.contains("CHECK_FILE_CHANGES") && prompt.contains("Independently evaluate") {
  assert!(prompt.contains("-before this run\n+needs correction"));
  assert!(!prompt.contains("untouched-dirty.txt"));
 }
 if name=="codex" && prompt.contains("CHECK_FOLDER_CHANGES") && prompt.contains("Independently evaluate") {
  assert!(prompt.contains("Project-folder (supported text files only)"));
  assert!(prompt.contains("-before this run\n+needs correction"));
  assert!(!prompt.contains("excluded-fixture-content"));
 }
 if prompt.contains("FAIL_GROK_REVIEW") && prompt.contains("Write one final") {
  assert!(prompt.contains(r#""lead":"Claude Code""#));
  assert!(prompt.contains(r#""assigned_reviewers":["Codex","Grok"]"#));
  assert!(prompt.contains(r#""reviewers_who_responded":["Codex"]"#));
 }
 let default="ANSWER\\n## Fixture result\\nChecked the project. No files changed. See [main.rs](main.rs:2).\\n\\n| File | Result |\\n| --- | --- |\\n| main.rs | checked |\\n| app.tsx | checked |\\n";
 let detailed_review=if prompt.contains("<request>SMOOTH_PROGRESS</request>")&&prompt.contains("Independently evaluate")&&name=="codex" {format!("PASS\\n## Fast review\\n{}", "A confirmed observation with supporting evidence.\\n\\n".repeat(80))}else{String::new()};
 let result=if prompt.contains("<request>CHECK_CODEX_PROFILES</request>") && name == "codex" {
  if extra_codex {"ANSWER\\nExtra Codex profile checked the project."} else {"ANSWER\\nDefault Codex checked the project."}
 }else if prompt.contains("<request>COMPACT_REPORT_FIXTURE ") && prompt.contains("Write one final") {
  assert!(prompt.contains("first Markdown paragraph"));
  "The status changed to ready.\\n\\n**Verification:** The reviewer checked the file."
 }else if !detailed_review.is_empty(){detailed_review.as_str()}
 else if prompt.contains("<request>ASK_FOR_DIRECTION</request>")&&name=="claude"&&prompt.contains("For inspection or questions") {"QUESTION\\nShould this use SQLite or PostgreSQL?"}
 else if prompt.contains("IMPLEMENT_REVIEW_FIX")&&name=="claude"&&!prompt.contains("Do not change files")&&!prompt.contains("Write one final") {
   if prompt.contains("one bounded correction pass"){fs::write("fixture-implementation.txt","corrected").unwrap();"IMPLEMENTED\\nFixed the confirmed issue."}else if prompt.contains("For inspection or questions"){
    fs::write("fixture-implementation.txt","needs correction").unwrap();
    if prompt.contains("CHECK_FILE_CHANGES") {
     fs::write("created-by-run.txt", "new file\n").unwrap();
     fs::write("ignored.log", "ignored output\n").unwrap();
     fs::remove_file("removed-by-run.txt").unwrap();
    }
    if prompt.contains("CHECK_FOLDER_CHANGES") {
     fs::write("created-by-run.txt", "new file\n").unwrap();
     fs::remove_file("removed-by-run.txt").unwrap();
     for file in [".env", "auth.json", "node_modules/generated.js", "references/notes.md"] {
      fs::write(file, "excluded-fixture-content\n").unwrap();
     }
    }
    "IMPLEMENTED\\nInitial implementation ready."
   }else{default}
 }else if prompt.contains("IMPLEMENT_REVIEW_FIX")&&prompt.contains("Independently evaluate"){"FIX_REQUIRED\\nThe fixture implementation needs correction."}else if prompt.contains("Re-check the correction pass"){"PASS\\nCorrection verified."}else{default};
 match name.as_str(){
  "codex"=>{println!("{{\"type\":\"item.completed\",\"item\":{{\"type\":\"agent_message\",\"text\":\"{result}\"}}}}");println!("{{\"type\":\"turn.completed\",\"usage\":{{\"input_tokens\":10,\"output_tokens\":3}}}}");},
  "claude"=>println!("{{\"type\":\"result\",\"result\":\"{result}\",\"usage\":{{\"input_tokens\":11,\"output_tokens\":4}}}}"),
  "grok"=>{println!("{{\"type\":\"text\",\"data\":\"{result}\"}}");println!("{{\"type\":\"end\",\"usage\":{{\"input_tokens\":12,\"output_tokens\":5}}}}");},
  "agy"=>{println!("{{\"event\":\"step_update\",\"step_update\":{{\"step_type\":\"agent_response\",\"text_delta\":\"{result}\"}}}}");println!("{{\"event\":\"result\",\"result\":{{\"status\":\"SUCCESS\",\"response\":\"\",\"usage\":{{\"input_tokens\":13,\"output_tokens\":6}}}}}}");},
  "gemini"=>{println!("{{\"type\":\"message\",\"role\":\"assistant\",\"content\":\"{result}\"}}");println!("{{\"type\":\"result\",\"status\":\"success\",\"stats\":{{\"input_tokens\":14,\"output_tokens\":7}}}}");},
  _=>println!("{result}"),
 }
}
