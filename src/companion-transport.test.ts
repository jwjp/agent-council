import { afterEach, expect, it, vi } from "vitest";
import type { Activity } from "./types";
import { Channel } from "@tauri-apps/api/core";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
async function transport(
  handler: (command: string, args: Record<string, unknown>) => unknown,
  native = true,
) {
  vi.stubGlobal("isTauri", native);
  vi.stubGlobal("window", {
    __TAURI_INTERNALS__: {
      invoke: handler,
      transformCallback: () => 1,
      unregisterCallback: () => {},
    },
  });
  return import("./companion-transport");
}
it("native REST and pairing use IPC without fetching or exposing cookies", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const ipc = vi.fn().mockResolvedValue({ protocol: "companion-v1" });
  const t = await transport(ipc);
  await t.pair("https://pc.example/companion/#pair=fixture", "iPhone");
  await t.call("/draft", { text: "한글 draft" }, "PUT");
  expect(ipc.mock.calls.map((call) => call.slice(0, 2))).toEqual([
    [
      "mobile_pair",
      { link: "https://pc.example/companion/#pair=fixture", name: "iPhone" },
    ],
    [
      "mobile_request",
      { path: "/draft", method: "PUT", body: { text: "한글 draft" } },
    ],
  ]);
  expect(fetch).not.toHaveBeenCalled();
});
it("native auth errors retain status for re-pairing", async () => {
  const t = await transport(() =>
    Promise.reject({ status: 401, message: "Device revoked" }),
  );
  await expect(t.call("/session")).rejects.toMatchObject({
    status: 401,
    message: "Device revoked",
  });
});
it("aborting before a native stream ID arrives still stops that exact stream", async () => {
  let finish: ((value: number) => void) | undefined;
  const ipc = vi.fn((command: string) =>
    command === "mobile_events"
      ? new Promise<number>((r) => {
          finish = r;
        })
      : Promise.resolve(),
  );
  const t = await transport(ipc);
  const controller = new AbortController();
  const stream = t.events(18, controller.signal, () => {});
  controller.abort();
  await stream;
  finish!(27);
  await Promise.resolve();
  await Promise.resolve();
  await vi.waitFor(() =>
    expect(ipc).toHaveBeenCalledWith("mobile_stop", { id: 27 }, undefined),
  );
});
it("native streams preserve events and reject failures once", async () => {
  let channel: Channel<{ kind: string; data: unknown }>;
  const ipc = vi.fn((command: string, args: Record<string, unknown>) => {
    if (command === "mobile_events") {
      channel = args.channel as typeof channel;
      return 9;
    }
  });
  const t = await transport(ipc),
    receive = vi.fn();
  const stream = t.events(0, new AbortController().signal, receive);
  const event = { id: 3, text: "검토 중" } as Activity;
  channel!.onmessage({ kind: "event", data: event });
  channel!.onmessage({
    kind: "error",
    data: { status: 401, message: "Revoked" },
  });
  channel!.onmessage({ kind: "closed", data: null });
  await expect(stream).rejects.toMatchObject({ status: 401 });
  expect(receive).toHaveBeenCalledExactlyOnceWith(event);
});
it("browser transport remains same-origin and streams fragmented Unicode", async () => {
  const encoder = new TextEncoder();
  const wire = encoder.encode('data: {"id":8,"text":"한글"}\r\n\r\n');
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
    .mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(c) {
            for (const b of wire) c.enqueue(new Uint8Array([b]));
            c.close();
          },
        }),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  const t = await transport(() => {
    throw Error("Unexpected native call");
  }, false);
  await t.call("/draft", { text: "draft" }, "PUT");
  const receive = vi.fn();
  await t.events(7, new AbortController().signal, receive);
  expect(fetch.mock.calls[0][0]).toBe("/companion/v1/draft");
  expect(fetch.mock.calls[0][1].credentials).toBe("same-origin");
  expect(receive).toHaveBeenCalledWith({ id: 8, text: "한글" });
});
