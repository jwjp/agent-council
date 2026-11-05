import { describe, it, expect } from "vitest";
import { parseFrames } from "./api";
import { windows, countdown } from "./quotas";
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
