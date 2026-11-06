// Deterministic CLI fixture for runtime integration tests. No model calls.
use std::{env,fs,time::Duration};
fn main(){
 let args:Vec<_>=env::args().collect();
 if args.iter().any(|s|s=="--child"){std::thread::sleep(Duration::from_secs(90));return;}
 let name=std::path::Path::new(&args[0]).file_stem().unwrap().to_string_lossy().to_string();
 let grok_alias=name=="agent"&&std::path::Path::new(&args[0]).parent().unwrap().join("agent-is-grok").is_file();
 if args.iter().any(|s|s=="--help") {if grok_alias {println!("Grok CLI. GROK_API_KEY");} else {println!("Start the Cursor Agent. CURSOR_API_KEY");}return;}
 if grok_alias {fs::write("wrong-provider.txt","Grok ran in place of Cursor").unwrap();std::process::exit(4);}
 let mut prompt=String::new();if ["codex","claude","gemini"].contains(&name.as_str()){use std::io::Read;std::io::stdin().read_to_string(&mut prompt).unwrap();}else{prompt=args.last().cloned().unwrap_or_default();}
 if args.iter().any(|s|s=="app-server") {return;}
 if prompt.contains("WAIT_FOR_CANCEL"){
  let child=std::process::Command::new(&args[0]).arg("--child").spawn().unwrap();
  fs::write("fixture-pids.txt",format!("{}\n{}",std::process::id(),child.id())).unwrap();std::thread::sleep(Duration::from_secs(90));
 }
 if prompt.contains("<request>SMOOTH_PROGRESS</request>")&&prompt.contains("Independently evaluate")&&name=="grok" {
  fs::write("slow-review-started.txt","waiting").unwrap();
  for _ in 0..300 {if std::path::Path::new("release-slow-review.txt").exists(){break;}std::thread::sleep(Duration::from_millis(50));}
 }
 if prompt.contains("FAIL_GROK_REVIEW")&&name=="grok" {eprintln!("Fixture authentication required");std::process::exit(3);}
 let default="ANSWER\\n## Fixture result\\nChecked the project. No files changed. See [main.rs](main.rs:2).\\n\\n| File | Result |\\n| --- | --- |\\n| main.rs | checked |\\n| app.tsx | checked |\\n";
 let detailed_review=if prompt.contains("<request>SMOOTH_PROGRESS</request>")&&prompt.contains("Independently evaluate")&&name=="codex" {format!("PASS\\n## Fast review\\n{}", "A confirmed observation with supporting evidence.\\n\\n".repeat(80))}else{String::new()};
 let result=if !detailed_review.is_empty(){detailed_review.as_str()}
 else if prompt.contains("<request>ASK_FOR_DIRECTION</request>")&&name=="claude"&&prompt.contains("For inspection or questions") {"QUESTION\\nShould this use SQLite or PostgreSQL?"}
 else if prompt.contains("IMPLEMENT_REVIEW_FIX")&&name=="claude"&&!prompt.contains("Do not change files")&&!prompt.contains("Write one final") {
   if prompt.contains("one bounded correction pass"){fs::write("fixture-implementation.txt","corrected").unwrap();"IMPLEMENTED\\nFixed the confirmed issue."}else if prompt.contains("For inspection or questions"){fs::write("fixture-implementation.txt","needs correction").unwrap();"IMPLEMENTED\\nInitial implementation ready."}else{default}
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
