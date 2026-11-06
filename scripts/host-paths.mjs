// Build/development paths shared by Vite and test harnesses, never a remote bootstrap.
import path from "node:path";
import os from "node:os";

export const runtimeRevision = 3;
export const exeSuffix = process.platform === "win32" ? ".exe" : "";

export function hostDataDir(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.AGENT_COUNCIL_DATA) return env.AGENT_COUNCIL_DATA;
  if (platform === "win32") return path.join(env.LOCALAPPDATA || home, "AgentCouncil");
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "AgentCouncil");
  return path.join(env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.join(home, ".local", "share"), "AgentCouncil");
}

export function hostCandidates() {
  return ["debug", "release"].flatMap((profile) => [
    `src-tauri/target/${profile}/CouncilHost${exeSuffix}`,
    `src-tauri/target/${profile}/AgentCouncil${exeSuffix}`,
  ]);
}
