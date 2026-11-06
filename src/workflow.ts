import type { Activity, Job, Settings } from "./types";

const order = [
  "work",
  "review",
  "refinement",
  "verification",
  "discussion",
  "report",
];
export function workflowProgress(
  job: Job,
  events: Activity[],
  settings: Pick<Settings, "coder" | "reviewers">,
) {
  const current = events.filter((e) => e.job === job.id);
  const flow = current.filter((e) => e.kind === "workflow").at(-1);
  const stage =
    flow?.stage ||
    current.filter((e) => e.kind === "phase").at(-1)?.stage ||
    "work";
  const expected =
    stage === "work" || stage === "refinement"
      ? ([settings.coder].filter(Boolean) as string[])
      : stage === "report"
        ? []
        : stage === "review" || stage === "verification"
          ? settings.reviewers
          : ([settings.coder, ...settings.reviewers].filter(
              Boolean,
            ) as string[]);
  const data = flow?.data as { participants?: unknown } | null;
  const members = Array.isArray(data?.participants)
    ? data.participants.filter((a): a is string => typeof a === "string")
    : expected;
  const latest = new Map(
    current
      .filter((e) => e.kind === "phase" && e.stage === stage)
      .map((e) => [e.agent, e.text]),
  );
  const completed = members.filter((a) =>
    ["Done", "Failed"].includes(latest.get(a) || ""),
  ).length;
  const failed = members.filter((a) => latest.get(a) === "Failed").length;
  const observed = new Set(
    current
      .filter((e) => ["workflow", "phase"].includes(e.kind))
      .map((e) => e.stage),
  );
  const planned = new Set([
    ...(settings.coder ? ["work"] : []),
    ...(settings.reviewers.length
      ? [
          "review",
          ...(settings.reviewers.length + Number(!!settings.coder) > 1
            ? ["discussion"]
            : []),
          "report",
        ]
      : []),
    ...observed,
  ]);
  const steps =
    stage === "question"
      ? ["work", "question"]
      : order.filter(
          (s) =>
            planned.has(s) &&
            (observed.has(s) || order.indexOf(s) >= order.indexOf(stage)),
        );
  return {
    stage,
    members,
    completed,
    failed,
    steps,
    running: job.status === "running",
    issues: current.some((e) => e.kind === "error"),
  };
}
