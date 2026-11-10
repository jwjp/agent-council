// Cross-version lifecycle check with real binaries, private data and fixture CLIs.
// Supply the old and new executable paths explicitly. No live accounts or tailnet.
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  chmodSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename, delimiter } from "node:path";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { exeSuffix, runtimeRevision } from "../scripts/host-paths.mjs";

assert.equal(
  process.argv.length,
  4,
  "Usage: node tests/upgrade.mjs OLD_EXE NEW_EXE",
);
const oldExe = resolve(process.argv[2]);
const newExe = resolve(process.argv[3]);
assert.ok(existsSync(oldExe) && existsSync(newExe), "Both binaries must exist");
assert.notEqual(oldExe, newExe);
const root = mkdtempSync(join(tmpdir(), "council-upgrade-test-"));
const project = join(root, "project");
const reference = join(root, "reference");
const bin = join(root, "bin");
for (const path of [project, reference, bin]) mkdirSync(path);
writeFileSync(
  join(project, "main.rs"),
  "fn main() {}\n// Saved project 한글\n",
);
writeFileSync(join(reference, "readme.txt"), "Read-only reference\n");
writeFileSync(
  join(root, "settings.json"),
  JSON.stringify({
    folder: project,
    references: [reference],
    coder: "claude",
    reviewers: ["codex"],
    language: "한국어",
    appearance: "dark",
    permissions: "all",
    draft: "",
  }),
);
const env = {
  ...process.env,
  AGENT_COUNCIL_DATA: root,
  AGENT_COUNCIL_AUTH_HOME: root,
  CLAUDE_CONFIG_DIR: join(root, ".claude"),
  GROK_HOME: join(root, ".grok"),
  PATH: bin + delimiter + process.env.PATH,
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const owned = new Set();
let runtime, daemon, port;
const descriptor = () =>
  JSON.parse(readFileSync(join(root, "runtime.json"), "utf8"));
async function local(path, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(runtime.url + "/v1" + path, {
    method,
    headers: {
      Authorization: "Bearer " + runtime.token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  assert.ok(
    response.ok,
    "Local request failed: " + path + " (" + response.status + ")",
  );
  return response.json();
}
async function waitFor(check, label) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await pause(100);
  }
  throw Error("Timed out: " + label);
}
async function idle() {
  await waitFor(
    async () => (await local("/state")).running_jobs === 0,
    "owned work completion",
  );
}
function client() {
  const jar = new Map();
  return {
    async request(path, body, method = body === undefined ? "GET" : "POST") {
      const response = await fetch(
        "http://127.0.0.1:" + port + "/companion/v1" + path,
        {
          method,
          headers: {
            Cookie: [...jar].map(([k, v]) => k + "=" + v).join(";"),
            Origin: "http://127.0.0.1:" + port,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        },
      );
      for (const value of response.headers.getSetCookie()) {
        const [key, token] = value.split(";")[0].split("=");
        if (token) jar.set(key, token);
        else jar.delete(key);
      }
      return response;
    },
  };
}
async function json(response, status = 200) {
  assert.equal(response.status, status);
  return response.json();
}
async function pair(phone, allowWork) {
  const invitation = await local("/companion/invitations", {
    allow_work: allowWork,
  });
  const code = new URLSearchParams(new URL(invitation.url).hash.slice(1)).get(
    "pair",
  );
  await json(
    await phone.request("/pair", {
      code,
      name: allowWork ? "Work fixture" : "Observer fixture",
    }),
  );
  await local("/companion/invitations/" + invitation.id + "/approve", {});
  return json(await phone.request("/pair/complete", {}));
}
function bootstrap(exe) {
  return spawnSync(exe, ["--ensure-server"], {
    env,
    windowsHide: true,
    stdio: "ignore",
    timeout: 20000,
  });
}

try {
  const fixture = join(bin, "fixture" + exeSuffix);
  const compiled = spawnSync(
    "rustc",
    ["tests/fixture_agent.rs", "-o", fixture],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(compiled.status, 0, compiled.stderr);
  for (const name of [
    "claude",
    "codex",
    "grok",
    "agy",
    "agent",
    "cursor-agent",
    "gemini",
  ]) {
    const path = join(bin, name + exeSuffix);
    copyFileSync(fixture, path);
    if (process.platform !== "win32") chmodSync(path, 0o700);
  }
  daemon = spawn(oldExe, ["--serve"], {
    env,
    windowsHide: true,
    stdio: "ignore",
  });
  owned.add(daemon.pid);
  await waitFor(async () => {
    try {
      runtime = descriptor();
      if (runtime.pid !== daemon.pid) return false;
      return (await local("/health")).pid === daemon.pid;
    } catch {
      return false;
    }
  }, "old isolated host");
  assert.equal(runtime.revision, runtimeRevision);
  const oldVersion = runtime.version,
    oldPid = runtime.pid;
  port = await new Promise((done, fail) => {
    const server = createServer();
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const allocated = server.address().port;
      server.close(() => done(allocated));
    });
  });
  const gatewayConfig = {
    enabled: true,
    origin: "http://127.0.0.1:" + port,
    port,
  };
  await local("/companion", gatewayConfig, "PUT");
  await waitFor(
    async () => (await local("/companion")).ready,
    "old gateway readiness",
  );
  const work = client(),
    observer = client();
  const workSession = await pair(work, true),
    observerSession = await pair(observer, false);
  const phoneJob = await json(
    await work.request("/jobs", {
      request: "Inspect the upgrade fixture",
      request_id: "retained-request",
    }),
  );
  await idle();
  assert.equal((await local("/state")).job.status, "done");
  assert.ok((await local("/state")).messages.some((m) => m.role === "council"));
  console.log(
    "PASS old-version fixture workflow and approved work/observer sessions seeded",
  );

  const busyJob = await local("/jobs", {
    request: "WAIT_FOR_CANCEL",
    request_id: "upgrade-busy",
  });
  await waitFor(
    async () => existsSync(join(project, "fixture-pids.txt")),
    "busy fixture started",
  );
  assert.notEqual(
    bootstrap(newExe).status,
    0,
    "Upgrade must refuse a busy old host",
  );
  assert.equal(descriptor().pid, oldPid);
  assert.equal((await local("/state")).job.status, "running");
  await local("/jobs/" + busyJob.id + "/cancel", {});
  await idle();
  console.log(
    "PASS new-version bootstrap refuses to replace the busy old host",
  );

  await local("/draft", { folder: project, text: "Desktop draft 한글" }, "PUT");
  await json(
    await work.request("/draft", { text: "Private phone draft 한글" }, "PUT"),
  );
  const pending = await local("/companion/invitations", { allow_work: false });
  const before = await local("/state");
  const phoneBefore = await json(await work.request("/state"));
  assert.equal(
    bootstrap(newExe).status,
    0,
    "Idle cross-version bootstrap failed",
  );
  runtime = descriptor();
  assert.notEqual(runtime.pid, oldPid);
  assert.notEqual(
    runtime.version,
    oldVersion,
    "This must be a cross-version check",
  );
  assert.equal(runtime.revision, runtimeRevision);
  owned.add(runtime.pid);
  await waitFor(
    async () => (await local("/companion")).ready,
    "upgraded gateway readiness",
  );
  const after = await local("/state");
  assert.deepEqual(after.settings, before.settings);
  assert.deepEqual(after.messages, before.messages);
  assert.deepEqual(after.usage, before.usage);
  assert.deepEqual(after.job, before.job);
  assert.equal(after.draft, "Desktop draft 한글");
  assert.ok(after.cursor >= before.cursor);
  assert.deepEqual((await local("/companion")).config, gatewayConfig);
  console.log(
    "PASS idle upgrade preserves settings, permission policy, references, history, tokens, jobs and desktop draft",
  );

  const phoneAfter = await json(await work.request("/state"));
  assert.deepEqual(phoneAfter.messages, phoneBefore.messages);
  assert.equal(phoneAfter.draft, "Private phone draft 한글");
  assert.equal((await json(await work.request("/session"))).id, workSession.id);
  assert.equal(
    (await json(await observer.request("/session"))).id,
    observerSession.id,
  );
  await json(
    await observer.request("/jobs", {
      request: "Must remain denied",
      request_id: "observer-denial",
    }),
    403,
  );
  const oldCode = new URLSearchParams(new URL(pending.url).hash.slice(1)).get(
    "pair",
  );
  await json(
    await client().request("/pair", {
      code: oldCode,
      name: "Expired pending invitation",
    }),
    401,
  );
  const repeated = await json(
    await work.request("/jobs", {
      request: "Inspect the upgrade fixture",
      request_id: "retained-request",
    }),
  );
  assert.equal(repeated.id, phoneJob.id);
  assert.deepEqual((await local("/state")).messages, before.messages);
  assert.equal((await local("/state")).running_jobs, 0);
  console.log(
    "PASS existing device cookies/drafts and read-only access survive; old invitations expire and accepted IDs do not rerun",
  );

  const newPid = runtime.pid;
  assert.equal(bootstrap(newExe).status, 0);
  assert.equal(descriptor().pid, newPid);
  const manifest = await fetch(
    "http://127.0.0.1:" + port + "/companion/manifest.webmanifest",
  );
  assert.equal(manifest.status, 200);
  assert.equal((await manifest.json()).start_url, "/companion/");
  console.log(
    "PASS compatible new host is reused and current Home Screen metadata is served",
  );
  console.log(
    "PASS cross-version upgrade " +
      oldVersion +
      " -> " +
      runtime.version +
      " (isolated native fixtures only)",
  );
} finally {
  if (runtime && owned.has(runtime.pid)) {
    try {
      const state = await local("/state");
      if (state.running_jobs && state.job?.status === "running") {
        await local("/jobs/" + state.job.id + "/cancel", {});
        await idle();
      }
    } catch {
      /* The old process may already have exited. */
    }
  }
  for (const pid of owned) {
    if (pid === daemon?.pid) {
      // Keep the original child handle; do not target an exited/reused PID.
      if (daemon.exitCode === null) daemon.kill();
      continue;
    }
    try {
      // The replacement belongs to this fresh profile. Verify its private
      // endpoint before stopping it rather than trusting an old PID alone.
      if (runtime?.pid === pid && (await local("/health")).pid === pid)
        process.kill(pid);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  await pause(500);
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  assert.ok(basename(root).startsWith("council-upgrade-test-"));
  rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
