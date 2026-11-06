import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  copyFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
const root = resolve(process.argv[3] || ".runtime-test/ui"),
  bin = join(root, "bin"),
  project = join(root, "project");
mkdirSync(bin, { recursive: true });
mkdirSync(project, { recursive: true });
if (!existsSync(join(project, "main.rs")))
  writeFileSync(join(project, "main.rs"), "fn main() {}\n// 한글 파일 내용\n");
const compiled = spawnSync(
  "rustc",
  ["tests/fixture_agent.rs", "-o", join(bin, "fixture.exe")],
  { encoding: "utf8" },
);
if (compiled.status) throw Error(compiled.stderr);
for (const name of ["claude", "codex", "grok", "agy", "agent", "gemini"])
  copyFileSync(join(bin, "fixture.exe"), join(bin, name + ".exe"));
writeFileSync(
  join(root, "settings.json"),
  JSON.stringify({
    folder: project,
    coder: "claude",
    reviewers: ["codex", "grok"],
    permissions: "all",
    language: process.env.COUNCIL_PREVIEW_LANGUAGE || "English",
  }),
);
const gui = spawn(
  resolve(process.argv[2] || "src-tauri/target/debug/AgentCouncil.exe"),
  [],
  {
    env: {
      ...process.env,
      AGENT_COUNCIL_DATA: root,
      AGENT_COUNCIL_AUTH_HOME: root,
      CLAUDE_CONFIG_DIR: join(root, ".claude"),
      GROK_HOME: join(root, ".grok"),
      PATH: bin + ";" + process.env.PATH,
    },
    stdio: "ignore",
    windowsHide: true,
  },
);
console.log("Isolated Rust/React preview started, PID " + gui.pid);
gui.on("exit", () => console.log("Preview window closed."));
setTimeout(() => {
  gui.kill();
  if (existsSync(join(root, "runtime.json"))) {
    const { pid } = JSON.parse(
      readFileSync(join(root, "runtime.json"), "utf8"),
    );
    try {
      process.kill(pid);
    } catch {}
  }
}, 600000).unref();
