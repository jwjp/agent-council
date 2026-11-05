export const agents = [
  "claude",
  "codex",
  "grok",
  "agy",
  "agent",
  "gemini",
] as const;
export type Agent = (typeof agents)[number];
export const names: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  grok: "Grok",
  agy: "Antigravity",
  agent: "Cursor Agent",
  gemini: "Gemini CLI",
  council: "Council report",
  You: "You",
  system: "Agent Council",
};
export const marks: Record<string, string> = {
  claude: "✳",
  codex: "◎",
  grok: "𝕏",
  agy: "Λ",
  agent: "▣",
  gemini: "✦",
  council: "✧",
};
export const colors: Record<string, string> = {
  claude: "#bf775e",
  codex: "#508b78",
  grok: "#737984",
  agy: "#668be2",
  agent: "#777f8e",
  gemini: "#8a78d6",
  council: "#6b64c4",
};
export interface Settings {
  folder: string;
  coder: Agent | null;
  reviewers: Agent[];
  references: string[];
  language: string;
  appearance: "light" | "dark" | "system";
  permissions: "restricted" | "coder" | "all";
  draft: string;
}
export interface Message {
  role: string;
  text: string;
  stage: string;
  time: string;
}
export interface Job {
  id: string;
  folder: string;
  request: string;
  request_id: string;
  status: string;
  time: string;
}
export interface Activity {
  id: number;
  job: string;
  folder: string;
  agent: string;
  kind: string;
  text: string;
  stage: string;
  time: string;
  data: unknown;
}
export interface Snapshot {
  settings: Settings;
  messages: Message[];
  agents: { id: Agent; installed: boolean }[];
  job: Job | null;
  cursor: number;
  draft: string;
  activity: Activity[];
  running_jobs: number;
  usage: Record<
    string,
    { input_tokens?: number; output_tokens?: number }
  > | null;
  limits: Record<string, unknown>;
  limit_errors: Record<string, string>;
  version: string;
}
