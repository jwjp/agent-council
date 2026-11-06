import type { Activity } from "./types";

// Notes are cumulative snapshots, not deltas. Keep the latest full note per agent.
export function compactActivity(input: Activity[]): Activity[] {
  const unique = [...new Map(input.map((e) => [e.id, e])).values()].sort(
    (a, b) => a.id - b.id,
  );
  const agents = new Set<string>();
  const milestones = new Set<string>();
  let other = 0;
  return unique
    .reverse()
    .filter((e) => {
      if (["workflow", "phase"].includes(e.kind)) {
        const key = [e.job, e.agent, e.stage, e.kind].join(":");
        if (milestones.has(key)) return false;
        milestones.add(key);
        return true;
      }
      if (e.kind === "note") {
        const key = e.job + ":" + e.agent;
        if (agents.has(key)) return false;
        agents.add(key);
        return true;
      }
      return ++other <= 160;
    })
    .reverse();
}
export function snapshotActivity(
  incoming: Activity[],
  previous: Activity[],
  cursor: number,
): Activity[] {
  return compactActivity([
    ...incoming,
    ...previous.filter((e) => e.id > cursor),
  ]);
}
