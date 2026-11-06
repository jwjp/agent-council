// Real host + deterministic native CLI fixtures. No provider credentials or Tailscale changes.
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  writeFileSync,
  readFileSync,
  statSync,
  existsSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, delimiter } from "node:path";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { exeSuffix } from "../scripts/host-paths.mjs";

const root = mkdtempSync(join(tmpdir(), "council-companion-test-")),
  project = join(root, "project-a"),
  other = join(root, "project-b"),
  bin = join(root, "bin");
for (const p of [project, other, bin]) mkdirSync(p);
writeFileSync(join(project, "main.rs"), "first line\n// 한글 파일 내용\n");
writeFileSync(join(other, "secret.txt"), "OTHER_PROJECT_PRIVATE");
writeFileSync(
  join(root, "settings.json"),
  JSON.stringify({
    folder: project,
    coder: "claude",
    reviewers: ["codex"],
    permissions: "all",
  }),
);
const exe = resolve(
  process.argv[2] || `src-tauri/target/debug/CouncilHost${exeSuffix}`,
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
// File identity also handles Windows 8.3 aliases and macOS /var symlinks.
function directoryIdentity(path) {
  const info = statSync(path, { bigint: true });
  assert.ok(info.isDirectory());
  assert.notEqual(info.ino, 0n);
  return [info.dev, info.ino];
}
let daemon, runtime, port;
const free = () =>
  new Promise((r, j) => {
    const s = createServer();
    s.on("error", j);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });
async function boot() {
  daemon = spawn(exe, ["--serve"], { env, windowsHide: true, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try {
      runtime = JSON.parse(readFileSync(join(root, "runtime.json"), "utf8"));
      const res = await fetch(runtime.url + "/v1/health", {
        headers: { Authorization: "Bearer " + runtime.token },
      });
      if (res.ok && runtime.pid === daemon.pid) return;
    } catch {}
    await pause(100);
  }
  throw Error("Test host did not start");
}
async function local(path, body, method = body === undefined ? "GET" : "POST") {
  const res = await fetch(runtime.url + "/v1" + path, {
    method,
    headers: {
      Authorization: "Bearer " + runtime.token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const v = await res.json();
  assert.ok(res.ok, JSON.stringify(v));
  return v;
}
function phone() {
  const jar = new Map();
  return {
    jar,
    async request(path, body, options = {}) {
      const res = await fetch(`http://127.0.0.1:${port}` + path, {
        method: options.method || (body === undefined ? "GET" : "POST"),
        headers: {
          Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join(";"),
          ...(options.noOrigin
            ? {}
            : { Origin: options.origin || `http://127.0.0.1:${port}` }),
          "Content-Type": "application/json",
          ...options.headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: options.signal,
      });
      for (const value of res.headers.getSetCookie()) {
        const [item] = value.split(";");
        const [key, token] = item.split("=");
        if (token) jar.set(key, token);
        else jar.delete(key);
      }
      return res;
    },
  };
}
async function json(res, status = 200) {
  assert.equal(res.status, status);
  return res.json();
}
async function pair(client, name = "Test phone", work = true) {
  const invite = await local("/companion/invitations", { allow_work: work });
  const code = new URLSearchParams(new URL(invite.url).hash.slice(1)).get(
    "pair",
  );
  assert.ok(
    invite.expires * 1000 > Date.now() &&
      invite.expires * 1000 < Date.now() + 301000,
  );
  const claimed = await client.request("/companion/v1/pair", { code, name });
  assert.match(claimed.headers.get("set-cookie"), /HttpOnly/);
  assert.match(claimed.headers.get("set-cookie"), /SameSite=Strict/);
  await json(claimed);
  await json(await client.request("/companion/v1/state"), 401);
  assert.equal(
    (await json(await client.request("/companion/v1/pair/complete", {})))
      .status,
    "pending",
  );
  const stranger = phone();
  await json(
    await stranger.request("/companion/v1/pair", { code, name: "Replay" }),
    401,
  );
  await local(`/companion/invitations/${invite.id}/approve`, {});
  const result = await json(
    await client.request("/companion/v1/pair/complete", {}),
  );
  assert.equal(result.protocol, "companion-v1");
  assert.ok(!JSON.stringify(result).includes("digest"));
  return result;
}
try {
  const built = spawnSync(
    "rustc",
    ["tests/fixture_agent.rs", "-o", join(bin, "fixture" + exeSuffix)],
    { encoding: "utf8" },
  );
  assert.equal(built.status, 0, built.stderr);
  for (const name of ["claude", "codex", "grok", "agy", "agent", "gemini"]) {
    const target = join(bin, name + exeSuffix);
    copyFileSync(join(bin, "fixture" + exeSuffix), target);
    if (process.platform !== "win32") chmodSync(target, 0o700);
  }
  await boot();
  assert.equal((await local("/companion")).config.enabled, false);
  port = await free();
  const origin = `http://127.0.0.1:${port}`;
  await local("/companion", { enabled: true, origin, port }, "PUT");
  for (let i = 0; i < 50 && !(await local("/companion")).ready; i++)
    await pause(100);
  assert.ok((await local("/companion")).ready);
  if (process.env.COUNCIL_POSTMAN_VERIFY === "1") {
    const postman = spawnSync(
      process.platform === "win32" ? "postman.exe" : "postman",
      [
        "collection",
        "run",
        "postman/collections/Companion Boundaries",
        "--env-var",
        `companionOrigin=${origin}`,
        "--no-report-events",
      ],
      { encoding: "utf8", timeout: 60000 },
    );
    mkdirSync(".runtime-test", { recursive: true });
    writeFileSync(
      ".runtime-test/companion-postman.log",
      postman.stdout + postman.stderr,
    );
    assert.equal(
      postman.status,
      0,
      "Postman boundary collection failed; see .runtime-test/companion-postman.log",
    );
    console.log(
      "PASS local Postman boundary collection (no credentials or cloud run reporting)",
    );
  }
  const p = phone(),
    p2 = phone(),
    observer = phone();
  await json(
    await p.request("/companion/v1/state", undefined, {
      headers: { Authorization: "Bearer " + runtime.token },
    }),
    401,
  );
  assert.equal((await p.request("/v1/state")).status, 404);
  assert.equal((await p.request("/__council/runtime")).status, 404);
  assert.equal((await p.request("/v1/companion")).status, 404);
  for (const path of ["settings", "update", "maintenance"])
    assert.equal(
      (await p.request(`/companion/v1/${path}`, {}, { method: "POST" })).status,
      404,
    );
  const page = await p.request("/companion/");
  assert.equal(page.status, 200);
  assert.match(
    page.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.match(await page.text(), /Agent Council/);
  const device = await pair(p),
    second = await pair(p2, "Other phone"),
    view = await pair(observer, "Observer", false);
  const config = (await local("/state")).settings;
  await local("/draft", { folder: project, text: "PC draft" }, "PUT");
  await json(
    await p.request(
      "/companion/v1/draft",
      { text: "Phone draft 한글" },
      { method: "PUT" },
    ),
  );
  assert.equal((await local("/state")).draft, "PC draft");
  assert.equal((await json(await p2.request("/companion/v1/state"))).draft, "");
  await json(
    await p.request(
      "/companion/v1/draft",
      { text: "csrf" },
      { method: "PUT", origin: "https://other.example" },
    ),
    403,
  );
  await json(
    await p.request(
      "/companion/v1/draft",
      { text: "csrf" },
      { method: "PUT", noOrigin: true },
    ),
    403,
  );
  await json(
    await observer.request("/companion/v1/jobs", {
      request: "No",
      request_id: "read-only",
    }),
    403,
  );
  await local("/settings", { ...config, folder: other }, "PUT");
  const state = await json(await p.request("/companion/v1/state"));
  assert.deepEqual(
    directoryIdentity(state.settings.folder),
    directoryIdentity(project),
  );
  assert.equal(state.draft, "Phone draft 한글");
  await json(
    await p.request("/companion/v1/files/read", {
      target: join(other, "secret.txt"),
    }),
    400,
  );
  const file = await json(
    await p.request("/companion/v1/files/read", { target: "main.rs:2" }),
  );
  assert.equal(file.line, 2);
  assert.ok(file.text.includes("한글"));
  const job = await json(
    await p.request("/companion/v1/jobs", {
      request: "Inspect the fixture",
      request_id: "same-request",
    }),
  );
  const duplicate = await json(
    await p.request("/companion/v1/jobs", {
      request: "Inspect the fixture",
      request_id: "same-request",
    }),
  );
  assert.equal(job.id, duplicate.id);
  for (let i = 0; i < 100; i++) {
    const s = await json(await p.request("/companion/v1/state"));
    if (s.job?.status !== "running") break;
    await pause(100);
  }
  const finished = await json(await p.request("/companion/v1/state"));
  assert.equal(finished.job.status, "done");
  assert.ok(finished.messages.some((m) => m.role === "council"));
  assert.deepEqual(
    directoryIdentity((await local("/state")).settings.folder),
    directoryIdentity(other),
  );
  assert.equal((await local("/state")).messages.length, 0);
  assert.equal((await json(await p2.request("/companion/v1/state"))).draft, "");
  const another = await json(
    await p2.request("/companion/v1/jobs", {
      request: "Inspect independently",
      request_id: "same-request",
    }),
  );
  assert.notEqual(another.id, job.id);
  for (let i = 0; i < 100; i++) {
    if (
      (await json(await p2.request("/companion/v1/state"))).job?.status !==
      "running"
    )
      break;
    await pause(100);
  }
  const privateJob = await local("/jobs", {
    request: "OTHER_PROJECT_PRIVATE",
    request_id: "private-other",
  });
  for (let i = 0; i < 100; i++) {
    if ((await local("/state")).job?.status !== "running") break;
    await pause(100);
  }
  const controller = new AbortController(),
    stream = await p.request("/companion/v1/events?after=0", undefined, {
      signal: controller.signal,
    }),
    reader = stream.body.getReader();
  let chunks = "";
  while (!chunks.includes('"kind":"done"')) {
    const v = await reader.read();
    if (v.done) break;
    chunks += new TextDecoder().decode(v.value);
  }
  assert.ok(!chunks.includes("OTHER_PROJECT_PRIVATE"));
  assert.ok(!chunks.includes(privateJob.id));
  await local(`/companion/devices/${device.id}`, undefined, "DELETE");
  await json(await p.request("/companion/v1/state"), 401);
  const ended = await Promise.race([
    (async () => {
      for (;;) {
        const v = await reader.read();
        if (v.done) return true;
      }
    })(),
    pause(3000).then(() => false),
  ]);
  assert.ok(ended, "Revocation must end an open event stream");
  controller.abort();
  const dbFiles = readdirSync(root).filter((n) =>
    n.startsWith("council.sqlite3"),
  );
  for (const name of dbFiles) {
    const content = readFileSync(join(root, name));
    assert.ok(
      !content.includes(p2.jar.get("CouncilDevice")),
      "Device credential was persisted in cleartext",
    );
  }
  const pendingInvite = await local("/companion/invitations", {
    allow_work: false,
  });
  const exit = new Promise((r) => daemon.once("exit", r));
  daemon.kill();
  await exit;
  await boot();
  for (let i = 0; i < 50 && !(await local("/companion")).ready; i++)
    await pause(100);
  assert.equal(
    (await json(await p2.request("/companion/v1/session"))).id,
    second.id,
  );
  assert.equal(
    (await json(await observer.request("/companion/v1/session"))).id,
    view.id,
  );
  const oldCode = new URLSearchParams(
    new URL(pendingInvite.url).hash.slice(1),
  ).get("pair");
  await json(
    await phone().request("/companion/v1/pair", {
      code: oldCode,
      name: "Expired on restart",
    }),
    401,
  );
  await json(await p2.request("/companion/v1/logout", {}));
  await json(await p2.request("/companion/v1/state"), 401);
  await local("/companion", { enabled: false, origin, port }, "PUT");
  console.log(
    "PASS companion approval/replay, cookie separation, CSRF, view-only grant, project/file/event scope, per-device drafts/idempotency, job execution, revocation/SSE, credential digests and restart persistence",
  );
} finally {
  if (daemon) {
    const exit = new Promise((r) => daemon.once("exit", r));
    if (daemon.exitCode === null) {
      daemon.kill();
      await Promise.race([exit, pause(12000)]);
    }
  }
  assert.ok(root.startsWith(join(tmpdir(), "council-companion-test-")));
  rmSync(root, { recursive: true, force: true });
}
