import { it, expect } from "vitest";
import { compactActivity, snapshotActivity } from "./companion-state";
import type { Activity } from "./types";
const event = (id: number, kind = "note", text = "note"): Activity => ({
  id,
  job: "j",
  agent: "codex",
  folder: "p",
  kind,
  text,
  stage: "work",
  time: "",
  data: null,
});
it("keeps a complete latest note and bounds duplicated activity", () => {
  const latest = event(
    300,
    "note",
    "Complete [source](main.rs:8) and final sentence.",
  );
  const result = compactActivity([
    ...Array.from({ length: 250 }, (_, i) => event(i, "tool")),
    event(290),
    latest,
    latest,
  ]);
  expect(result.filter((e) => e.kind === "note")).toEqual([latest]);
  expect(result.length).toBe(161);
});
it("does not replace a newer streamed note with an older snapshot response", () => {
  const streamed = event(12, "note", "Newest full note");
  expect(snapshotActivity([event(9)], [streamed], 10)).toEqual([streamed]);
});
