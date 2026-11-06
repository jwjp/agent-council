import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type { Activity } from "./types";

export const nativeCompanion = isTauri();
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function native<T>(
  command: string,
  args: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    const value = e as { status?: number; message?: string };
    throw new ApiError(
      value?.status || 500,
      value?.message || "The native connection failed.",
    );
  }
}
export async function call<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  keepalive = false,
): Promise<T> {
  if (nativeCompanion)
    return native<T>("mobile_request", { path, method, body: body ?? null });
  const response = await fetch(`/companion/v1${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    keepalive,
    signal: keepalive ? undefined : AbortSignal.timeout(20000),
  });
  const value = await response.json();
  if (!response.ok)
    throw new ApiError(response.status, value.error || "Request failed");
  return value as T;
}
export function pair(linkOrCode: string, name: string): Promise<unknown> {
  return nativeCompanion
    ? native("mobile_pair", { link: linkOrCode, name })
    : call("/pair", { code: linkOrCode, name });
}
export function forget(): Promise<void> {
  return native("mobile_forget", {});
}
export function openWeb(url: string): Promise<unknown> {
  if (nativeCompanion) return native("mobile_open_web", { url });
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve();
}
type Frame =
  | { kind: "connected" | "closed" }
  | { kind: "event"; data: Activity }
  | { kind: "error"; data: { status: number; message: string } };
export async function events(
  after: number,
  signal: AbortSignal,
  onEvent: (event: Activity) => void,
): Promise<void> {
  if (signal.aborted) return;
  if (nativeCompanion) {
    return new Promise<void>((resolve, reject) => {
      let id: number | undefined,
        finished = false;
      const done = (error?: unknown) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", abort);
        if (id !== undefined)
          void native("mobile_stop", { id }).catch(() => {});
        if (error) reject(error);
        else resolve();
      };
      const abort = () => done();
      const channel = new Channel<Frame>();
      channel.onmessage = (frame) => {
        if (finished) return;
        if (frame.kind === "event") onEvent(frame.data);
        else if (frame.kind === "error")
          done(new ApiError(frame.data.status, frame.data.message));
        else if (frame.kind === "closed") done();
      };
      signal.addEventListener("abort", abort, { once: true });
      void native<number>("mobile_events", { after, channel })
        .then((value) => {
          id = value;
          if (finished) void native("mobile_stop", { id }).catch(() => {});
        })
        .catch(done);
    });
  }
  const response = await fetch(`/companion/v1/events?after=${after}`, {
    credentials: "same-origin",
    signal,
  });
  if (!response.ok)
    throw new ApiError(
      response.status,
      "Connection lost. Reconnect or pair again.",
    );
  if (!response.body) throw Error("This browser cannot stream progress.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const r = await reader.read();
      if (r.done) break;
      buffer += decoder.decode(r.value, { stream: true });
      const parts = buffer.replace(/\r\n/g, "\n").split("\n\n");
      buffer = parts.pop() || "";
      for (const frame of parts) {
        const data = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data) onEvent(JSON.parse(data) as Activity);
      }
      if (buffer.length > 1024 * 1024)
        throw Error("Event frame exceeds the size limit.");
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
