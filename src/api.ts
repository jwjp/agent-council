import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Activity } from "./types";
interface Runtime {
  url: string;
  token: string;
  version: string;
}
let runtime: Runtime;
export async function connect() {
  runtime = isTauri()
    ? await invoke<Runtime>("bootstrap")
    : await fetch("/__council/runtime").then(async (r) => {
        const v = await r.json();
        if (!r.ok)
          throw Error(
            v.error || "Start the Rust engine to open this workspace.",
          );
        return v;
      });
  return runtime;
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  if (!runtime) await connect();
  const response = await fetch(runtime.url + "/v1" + path, {
    method,
    headers: {
      Authorization: "Bearer " + runtime.token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw Error(raw || `Request failed (${response.status})`);
  }
  if (!response.ok)
    throw Error(data.error || `Request failed (${response.status})`);
  return data as T;
}
export function persistDraft(folder: string, text: string) {
  if (!runtime || !folder) return Promise.resolve();
  return fetch(runtime.url + "/v1/draft", {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + runtime.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ folder, text }),
    keepalive: true,
  }).then((response) => {
    if (!response.ok) throw Error("Could not save the draft.");
  });
}
export function parseFrames(buffer: string): {
  frames: string[];
  rest: string;
} {
  const chunks = buffer.replace(/\r\n/g, "\n").split("\n\n");
  return { frames: chunks.slice(0, -1), rest: chunks.at(-1) || "" };
}
export async function subscribe(
  after: number,
  signal: AbortSignal,
  onEvent: (event: Activity) => void,
  onStatus: (connected: boolean) => void,
) {
  let cursor = after;
  while (!signal.aborted) {
    try {
      if (!runtime) await connect();
      const response = await fetch(`${runtime.url}/v1/events?after=${cursor}`, {
        headers: { Authorization: "Bearer " + runtime.token },
        signal,
      });
      if (!response.ok || !response.body)
        throw Error("Event connection unavailable");
      onStatus(true);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (!signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseFrames(buffer);
          buffer = parsed.rest;
          for (const frame of parsed.frames) {
            const data = frame
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trimStart())
              .join("\n");
            if (!data) continue;
            const event: Activity = JSON.parse(data);
            if (event.id > cursor) {
              cursor = event.id;
              onEvent(event);
            }
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    } catch (error) {
      if (signal.aborted) return;
      onStatus(false);
    }
    if (!signal.aborted) {
      await new Promise<void>((resolve) => {
        const id = setTimeout(resolve, 2000);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(id);
            resolve();
          },
          { once: true },
        );
      });
      if (!signal.aborted)
        try {
          await connect();
        } catch {}
    }
  }
}
export const pickFolder = async () =>
  isTauri()
    ? invoke<string | null>("select_folder")
    : window.prompt("Project folder path / 프로젝트 폴더 경로");
export const external = async (url: string) => {
  if (isTauri()) return invoke("open_external", { url });
  if (/^https?:\/\//.test(url))
    window.open(url, "_blank", "noopener,noreferrer");
};
export const desktop = isTauri();
