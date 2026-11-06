import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const root = mkdtempSync(join(tmpdir(), "council-rust-test-")),
  bin = join(root, "bin"),
  project = join(root, "project");
mkdirSync(bin);
mkdirSync(project);
const exe = resolve(
  process.argv[2] || "src-tauri/target/debug/AgentCouncil.exe",
);
let daemon;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const compile = spawnSync(
    "rustc",
    ["tests/fixture_agent.rs", "-o", join(bin, "fixture.exe")],
    { encoding: "utf8" },
  );
  assert.equal(compile.status, 0, compile.stderr);
  for (const name of ["claude", "codex", "grok", "agy", "agent", "gemini"])
    copyFileSync(join(bin, "fixture.exe"), join(bin, name + ".exe"));
  writeFileSync(
    join(root, "settings.json"),
    JSON.stringify({
      folder: project,
      coder: "claude",
      reviewers: ["codex", "grok"],
      permissions: "all",
    }),
  );
  const env = {
    ...process.env,
    AGENT_COUNCIL_DATA: root,
    AGENT_COUNCIL_AUTH_HOME: root,
    CLAUDE_CONFIG_DIR: join(root, ".claude"),
    GROK_HOME: join(root, ".grok"),
    PATH: bin + ";" + process.env.PATH,
  };
  daemon = spawn(exe, ["--serve"], { env, windowsHide: true, stdio: "ignore" });
  for (let i = 0; i < 100 && !existsSync(join(root, "runtime.json")); i++)
    await pause(100);
  let runtime = JSON.parse(readFileSync(join(root, "runtime.json"), "utf8"));
  const request = async (
    path,
    body,
    method = body === undefined ? "GET" : "POST",
  ) => {
    const response = await fetch(runtime.url + "/v1" + path, {
      method,
      headers: {
        Authorization: "Bearer " + runtime.token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await response.json();
    assert.ok(response.ok, JSON.stringify(value));
    return value;
  };
  assert.equal((await fetch(runtime.url + "/v1/state")).status, 401);
  const initial = await request("/state");
  assert.ok(initial.agents.every((a) => a.installed));
  assert.equal(initial.messages.length, 0);
  writeFileSync(join(project, "main.rs"), "first line\n// 한글 파일 내용\n");
  writeFileSync(join(root, "outside.txt"), "outside selected folders");
  const preview = await request("/files/read", { target: "main.rs:2" });
  assert.equal(preview.line, 2);
  assert.ok(preview.text.includes("한글 파일 내용"));
  const escapedFile = await fetch(runtime.url + "/v1/files/read", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + runtime.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ target: "../outside.txt" }),
  });
  assert.equal(escapedFile.status, 400);
  const invalid = await fetch(runtime.url + "/v1/settings", {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + runtime.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...initial.settings, coder: "unknown" }),
  });
  assert.equal(invalid.status, 400);
  const job = await request("/jobs", {
    request: "Inspect the fixture project.",
    request_id: "first",
  });
  const duplicate = await request("/jobs", {
    request: "Inspect the fixture project.",
    request_id: "first",
  });
  assert.equal(job.id, duplicate.id);
  let state;
  for (let i = 0; i < 100; i++) {
    state = await request("/state");
    if (state.job.status !== "running") break;
    await pause(100);
  }
  assert.equal(state.job.status, "done");
  assert.equal(state.messages.filter((m) => m.role === "You").length, 1);
  assert.ok(state.messages.some((m) => m.role === "council"));
  assert.equal(state.messages.filter((m) => m.stage === "review").length, 2);
  assert.equal(
    state.messages.filter((m) => m.stage === "discussion").length,
    3,
  );
  assert.equal(state.usage.claude.input_tokens, 33);
  assert.equal(state.usage.codex.input_tokens, 20);
  assert.equal(state.usage.grok.input_tokens, 24);
  for (const coder of ["agy", "gemini", "agent"]) {
    await request(
      "/settings",
      { ...initial.settings, coder, reviewers: [] },
      "PUT",
    );
    await request("/jobs", {
      request: "Check this fixture.",
      request_id: coder,
    });
    for (let i = 0; i < 100; i++) {
      state = await request("/state");
      if (state.job.status !== "running") break;
      await pause(100);
    }
    assert.equal(state.job.status, "done", coder + " adapter failed");
    if (coder === "agent")
      assert.equal(
        state.usage.agent,
        undefined,
        "Missing usage must not be invented",
      );
  }
  await request(
    "/settings",
    { ...initial.settings, coder: null, reviewers: ["codex"] },
    "PUT",
  );
  const reviewOnly = await request("/jobs", {
    request: "Inspect without changes.",
    request_id: "review-only",
  });
  for (let i = 0; i < 100; i++) {
    state = await request("/state");
    if (state.job.status !== "running") break;
    await pause(100);
  }
  assert.equal(state.job.id, reviewOnly.id);
  assert.equal(state.job.status, "done");
  const onlyEvents = state.activity.filter((e) => e.job === reviewOnly.id);
  assert.ok(onlyEvents.some((e) => e.stage === "review"));
  assert.ok(!onlyEvents.some((e) => ["work", "refinement"].includes(e.stage)));
  await request("/settings", initial.settings, "PUT");
  await request("/maintenance", { enabled: true });
  const gated = await fetch(runtime.url + "/v1/jobs", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + runtime.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      request: "blocked during update",
      request_id: "gated",
    }),
  });
  assert.equal(gated.status, 400);
  await request("/maintenance", { enabled: false });
  const controller = new AbortController();
  const stream = await fetch(runtime.url + "/v1/events?after=0", {
    headers: { Authorization: "Bearer " + runtime.token },
    signal: controller.signal,
  });
  const reader = stream.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.ok(first.includes("data:"));
  controller.abort();
  const waiting = await request("/jobs", {
    request: "WAIT_FOR_CANCEL",
    request_id: "cancel",
  });
  for (let i = 0; i < 50 && !existsSync(join(project, "fixture-pids.txt")); i++)
    await pause(100);
  const pids = readFileSync(join(project, "fixture-pids.txt"), "utf8")
    .split("\n")
    .map(Number);
  const unsafeUpdate = await fetch(runtime.url + "/v1/maintenance", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + runtime.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(unsafeUpdate.status, 400);
  const conflict = await fetch(runtime.url + "/v1/jobs", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + runtime.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ request: "another", request_id: "conflict" }),
  });
  assert.equal(conflict.status, 409);
  await request("/jobs/" + waiting.id + "/cancel", {});
  for (let i = 0; i < 50; i++) {
    state = await request("/state");
    if (state.job.status === "cancelled") break;
    await pause(100);
  }
  assert.equal(state.job.status, "cancelled");
  await pause(300);
  for (const pid of pids) {
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    assert.equal(alive, false, "Cancelled subprocess tree is still alive");
  }
  await request("/draft", { folder: project, text: "Saved draft 한글" }, "PUT");
  const cursor = (await request("/state")).cursor;
  daemon.kill();
  await new Promise((r) => daemon.once("exit", r));
  daemon = spawn(exe, ["--serve"], { env, windowsHide: true, stdio: "ignore" });
  await pause(1500);
  runtime = JSON.parse(readFileSync(join(root, "runtime.json"), "utf8"));
  state = await request("/state");
  assert.equal(state.draft, "Saved draft 한글");
  assert.ok(state.cursor >= cursor);
  assert.ok(state.messages.some((m) => m.role === "council"));
  console.log(
    "PASS authenticated API, validation, idempotency, coder + review + conference + report, usage totals, SSE replay, cancellation tree, restart persistence",
  );
} finally {
  if (daemon) {
    daemon.kill();
    await pause(500);
  }
  assert.ok(root.startsWith(join(tmpdir(), "council-rust-test-")));
  rmSync(root, { recursive: true, force: true });
}
