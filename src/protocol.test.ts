import { describe, it, expect } from "vitest";
import { parseFrames } from "./api";
import { windows, countdown, summaryWindow, percent } from "./quotas";
import { linkKind } from "./links";
describe("runtime event replay", () => {
  it("retains a partial frame and ignores heartbeat data", () => {
    const p = parseFrames(
      ': ping\n\nid: 12\ndata: {"text":"한글"}\n\nid: 13\ndata: {',
    );
    expect(p.frames).toHaveLength(2);
    expect(p.rest).toBe("id: 13\ndata: {");
  });
});
describe("quota semantics", () => {
  it("labels the limiting window and keeps fractional usage visible", () => {
    expect(
      summaryWindow([
        { label: "5 hours", used: 1, reset: null },
        { label: "Weekly", used: 79, reset: null },
      ])?.label,
    ).toBe("Weekly");
    expect(percent(0.4)).toBe("0.4%");
    expect(percent(99.5)).toBe("99.5%");
    expect(percent(0.04)).toBe("<0.1%");
    expect(percent(99.96)).toBe(">99.9%");
  });
  it("converts remaining fraction to used percentage", () => {
    expect(
      windows("agy", [
        { name: "Models", buckets: [{ remaining_fraction: 0.7 }] },
      ])[0].used,
    ).toBeCloseTo(30);
  });
  it("does not invent unsupported quotas", () => {
    expect(windows("grok", {})).toEqual([]);
  });
  it("shows reset rather than one minute after expiry", () => {
    expect(countdown(100, 101)).toBe("now");
  });
});
describe("file navigation", () => {
  it("accepts file references while rejecting executable URL schemes", () => {
    expect(linkKind("C:/project/main.py:8")).toBe("file");
    expect(linkKind("file:///C:/project/main.py#L2")).toBe("file");
    expect(linkKind("src/main.rs")).toBe("file");
    expect(linkKind("https://example.com")).toBe("web");
    expect(linkKind("javascript:alert(1)")).toBe("blocked");
    expect(linkKind("data:text/html,hello")).toBe("blocked");
    expect(linkKind("//server/file")).toBe("blocked");
  });
});
