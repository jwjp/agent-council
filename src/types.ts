export const agents = [
  "claude",
  "codex",
  "grok",
  "agy",
  "agent",
  "gemini",
] as const;
export const accountProviders = ["claude", "codex"] as const;
export type AccountProvider = (typeof accountProviders)[number];
export type AgentProfileName = `${AccountProvider}-${string}`;
export type Agent = (typeof agents)[number] | AgentProfileName;
const names: Record<string, string> = {
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
const marks: Record<string, string> = {
  claude: "✳",
  codex: "◎",
  grok: "𝕏",
  agy: "Λ",
  agent: "▣",
  gemini: "✦",
  council: "✧",
};
const colors: Record<string, string> = {
  claude: "#bf775e",
  codex: "#508b78",
  grok: "#737984",
  agy: "#668be2",
  agent: "#777f8e",
  gemini: "#8a78d6",
  council: "#6b64c4",
};
export function isAgentProfile(agent: string): agent is AgentProfileName {
  return /^(claude|codex)-[a-z0-9][a-z0-9_-]{0,31}$/.test(agent);
}
export function agentProvider(agent: string) {
  return isAgentProfile(agent) ? (agent.split("-", 1)[0] as AccountProvider) : agent;
}
export function isAgent(agent: string): agent is Agent {
  return (
    (agents as readonly string[]).includes(agent) || isAgentProfile(agent)
  );
}
export type AgentLabels = Record<string, string>;
export function agentName(agent: string, labels?: AgentLabels) {
  if (labels && Object.hasOwn(labels, agent)) return labels[agent];
  return Object.hasOwn(names, agent) ? names[agent] : agent;
}
export function agentMark(agent: string) {
  const id = agentProvider(agent);
  return Object.hasOwn(marks, id) ? marks[id] : "·";
}
export function agentColor(agent: string) {
  const id = agentProvider(agent);
  return Object.hasOwn(colors, id) ? colors[id] : "#80899a";
}
export function agentChoices(settings: Settings): Agent[] {
  return [
    ...agents,
    ...(settings.agent_profiles ?? []).map(({ name }) => name),
  ];
}
export interface AgentProfile {
  name: AgentProfileName;
  config_dir: string;
  display_name?: string;
}
export interface Settings {
  folder: string;
  coder: Agent | null;
  reviewers: Agent[];
  agent_profiles?: AgentProfile[];
  references: string[];
  language: string;
  appearance: "light" | "dark" | "system";
  permissions: "restricted" | "coder" | "all";
  draft: string;
}
export interface Message {
  role: string;
  text: string;
  report_summary?: string;
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
  agent_labels?: AgentLabels;
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
