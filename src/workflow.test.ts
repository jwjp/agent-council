import { it, expect } from "vitest";
import { workflowProgress } from "./workflow";
import { compactActivity } from "./companion-state";
import type { Activity, Job, Settings } from "./types";
const job: Job = {
  id: "j",
  folder: "p",
  request: "inspect",
  request_id: "r",
  status: "running",
  time: "",
};
const settings: Pick<Settings, "coder" | "reviewers"> = {
  coder: "claude",
  reviewers: ["codex", "grok"],
};
const event = (
  id: number,
  kind: string,
  agent: string,
  text: string,
  stage = "review",
  data: unknown = null,
): Activity => ({
  id,
  job: "j",
  folder: "p",
  kind,
  agent,
  text,
  stage,
  data,
  time: "",
});
it("counts only observed completions in the current round after a busy tool stream", () => {
  const events = compactActivity([
    event(1, "workflow", "", "review", "review", {
      participants: ["codex", "grok"],
    }),
    event(2, "phase", "codex", "Done"),
    event(3, "phase", "grok", "Reviewing"),
    ...Array.from({ length: 200 }, (_, i) =>
      event(i + 4, "tool", "grok", "Reading"),
    ),
  ]);
  const progress = workflowProgress(job, events, settings);
  expect(progress.completed).toBe(1);
  expect(progress.members).toEqual(["codex", "grok"]);
  expect(progress.failed).toBe(0);
});
it("does not mark an unrun discussion as completed when going straight to synthesis", () => {
  const progress = workflowProgress(
    { ...job, status: "done" },
    [
      event(1, "workflow", "", "review", "review", {
        participants: ["codex", "grok"],
      }),
      event(2, "workflow", "", "report", "report", {
        participants: ["claude"],
      }),
    ],
    settings,
  );
  expect(progress.steps).toEqual(["review", "report"]);
});
it("keeps a clarification distinct from a finished review workflow", () => {
  const progress = workflowProgress(
    { ...job, status: "done" },
    [
      event(1, "workflow", "", "work", "work", { participants: ["claude"] }),
      event(2, "workflow", "", "question", "question", {
        participants: ["claude"],
      }),
    ],
    settings,
  );
  expect(progress.stage).toBe("question");
  expect(progress.steps).toEqual(["work", "question"]);
});
