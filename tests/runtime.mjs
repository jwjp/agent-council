import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  existsSync,
  rmSync,
  chmodSync,
  statSync,
} from "node:fs";
import { join, resolve, delimiter } from "node:path";
import { exeSuffix, runtimeRevision } from "../scripts/host-paths.mjs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const root = mkdtempSync(join(tmpdir(), "council-rust-test-")),
  bin = join(root, "bin"),
  project = join(root, "project"),
  data = join(root, "data");
mkdirSync(bin);
mkdirSync(project);
mkdirSync(data);
const exe = resolve(
  process.argv[2] || `src-tauri/target/debug/AgentCouncil${exeSuffix}`,
);
let daemon;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const turnMessages = (state) =>
  state.messages.slice(
    state.messages.map((m) => m.role).lastIndexOf("You") + 1,
  );
try {
  const compile = spawnSync(
    "rustc",
    ["tests/fixture_agent.rs", "-o", join(bin, "fixture" + exeSuffix)],
    { encoding: "utf8" },
  );
  assert.equal(compile.status, 0, compile.stderr);
  for (const name of [
    "claude",
    "codex",
    "grok",
    "agy",
    "agent",
    "cursor-agent",
    "gemini",
  ]) {
    const destination = join(bin, name + exeSuffix);
    copyFileSync(join(bin, "fixture" + exeSuffix), destination);
    if (process.platform !== "win32") chmodSync(destination, 0o700);
  }
  writeFileSync(
    join(bin, "agent-is-grok"),
    "generic command collision fixture",
  );
  writeFileSync(
    join(data, "settings.json"),
    JSON.stringify({
      folder: project,
      coder: "claude",
      reviewers: ["codex", "grok"],
      permissions: "all",
    }),
  );
  const env = {
    ...process.env,
    AGENT_COUNCIL_DATA: data,
    AGENT_COUNCIL_AUTH_HOME: root,
    GIT_CEILING_DIRECTORIES: root,
    CLAUDE_CONFIG_DIR: join(root, ".claude"),
    ANTHROPIC_API_KEY: "fixture-global-override",
    OPENAI_API_KEY: "fixture-global-override",
    GROK_HOME: join(root, ".grok"),
    PATH: bin + delimiter + process.env.PATH,
  };
  daemon = spawn(exe, ["--serve"], { env, windowsHide: true, stdio: "ignore" });
  for (let i = 0; i < 100 && !existsSync(join(data, "runtime.json")); i++)
    await pause(100);
  let runtime = JSON.parse(readFileSync(join(data, "runtime.json"), "utf8"));
  assert.equal(runtime.revision, runtimeRevision);
  assert.equal(new URL(runtime.url).hostname, "127.0.0.1");
  if (process.platform !== "win32") {
    assert.equal(
      statSync(join(data, "runtime.json")).mode & 0o077,
      0,
      "Runtime credentials must be private",
    );
  }
  const reused = spawnSync(exe, ["--ensure-server"], {
    env,
    windowsHide: true,
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(
    reused.status,
    0,
    "Bootstrap must reconnect to the matching host",
  );
  assert.equal(
    JSON.parse(readFileSync(join(data, "runtime.json"), "utf8")).pid,
    runtime.pid,
    "Reconnection must not start a second host",
  );
  try {
    writeFileSync(
      join(data, "runtime.json"),
      JSON.stringify({ ...runtime, revision: runtimeRevision + 1 }),
    );
    const olderApp = spawnSync(exe, ["--ensure-server"], {
      env,
      windowsHide: true,
      timeout: 15000,
    });
    assert.equal(olderApp.status, 1);
    assert.equal(
      JSON.parse(readFileSync(join(data, "runtime.json"), "utf8")).pid,
      runtime.pid,
    );
  } finally {
    writeFileSync(join(data, "runtime.json"), JSON.stringify(runtime));
  }
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
    if (path.startsWith("/claude/accounts")) {
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.doesNotMatch(JSON.stringify(value), /fixture-secret/);
    }
    return value;
  };
  assert.equal((await fetch(runtime.url + "/v1/state")).status, 401);
  assert.equal((await fetch(runtime.url + "/v1/claude/accounts")).status, 401);
  const scanned = await request("/claude/accounts");
  assert.equal(scanned.find((a) => a.name === "claude").status, "connected");
  assert.equal(
    scanned.find((a) => a.name === "claude").account_email,
    "default-fixture@example.invalid",
  );
  const prepareBody = { request_id: randomUUID() };
  const [prepared, repeated] = await Promise.all([
    request("/claude/accounts/prepare", prepareBody),
    request("/claude/accounts/prepare", prepareBody),
  ]);
  assert.deepEqual(repeated, prepared);
  assert.equal(prepared.status, "sign_in_required");
  assert.equal(
    prepared.login_shell,
    { win32: "powershell", darwin: "macos_terminal" }[process.platform] ??
      "posix_terminal",
  );
  if (process.platform === "win32")
    assert.match(prepared.login_command, /^\$env:CLAUDE_CONFIG_DIR/);
  else assert.match(prepared.login_command, /^\(unset ANTHROPIC_API_KEY/);
  assert.match(prepared.login_command, /claude auth login/);
  const accountFile = join(prepared.config_dir, "fixture-sign-in-data.json");
  writeFileSync(accountFile, "fixture only");
  const beforeLogin = await request("/claude/accounts/check", {
    config_dir: prepared.config_dir,
  });
  assert.equal(beforeLogin.status, "sign_in_required");
  assert.equal(beforeLogin.account_email, undefined);
  writeFileSync(join(prepared.config_dir, "fixture-signed-in"), "");
  const afterLogin = await request("/claude/accounts/check", {
    config_dir: prepared.config_dir,
  });
  assert.equal(afterLogin.status, "connected");
  assert.equal(afterLogin.account_email, "extra-fixture@example.invalid");
  assert.equal(afterLogin.name, prepared.name);
  const initial = await request("/state");
  assert.doesNotMatch(JSON.stringify(initial), /fixture@example\.invalid/);
  assert.ok(initial.agents.every((a) => a.installed));
  assert.equal(initial.messages.length, 0);
  await request(
    "/settings",
    { ...initial.settings, references: [root] },
    "PUT",
  );
  await assert.rejects(
    request("/files/read", { target: accountFile }),
    /Agent account folders are private/,
  );
  await request("/settings", initial.settings, "PUT");
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
  await request("/jobs", {
    request: "SMOOTH_PROGRESS",
    request_id: "smooth-progress",
  });
  for (let i = 0; i < 100; i++) {
    state = await request("/state");
    if (
      turnMessages(state).some(
        (m) => m.role === "codex" && m.stage === "review",
      ) &&
      existsSync(join(project, "slow-review-started.txt"))
    )
      break;
    await pause(100);
  }
  assert.equal(
    state.job.status,
    "running",
    "Fast review must be published before the slow peer finishes",
  );
  assert.ok(
    turnMessages(state).some((m) => m.role === "codex" && m.stage === "review"),
  );
  assert.ok(
    !turnMessages(state).some((m) => m.role === "grok" && m.stage === "review"),
  );
  writeFileSync(join(project, "release-slow-review.txt"), "continue");
  for (let i = 0; i < 100; i++) {
    state = await request("/state");
    if (state.job.status !== "running") break;
    await pause(100);
  }
  assert.equal(state.job.status, "done");
  const reviews = state.activity.filter(
    (e) => e.kind === "phase" && e.text === "Done" && e.stage === "review",
  );
  const discussion = state.activity.find(
    (e) => e.kind === "workflow" && e.stage === "discussion",
  );
  assert.equal(reviews.length, 2);
  assert.ok(
    discussion.id > Math.max(...reviews.map((e) => e.id)),
    "Discussion starts only after initial reviews complete",
  );
  await request("/jobs", {
    request: "ASK_FOR_DIRECTION",
    request_id: "clarification",
  });
  for (let i = 0; i < 100; i++) {
    state = await request("/state");
    if (state.job.status !== "running") break;
    await pause(100);
  }
  assert.equal(state.job.status, "done");
  assert.equal(
    state.activity.filter((e) => e.kind === "workflow").at(-1).stage,
    "question",
  );
  assert.ok(!state.activity.some((e) => e.stage === "review"));
  const noGitChanges = await request(`/jobs/${state.job.id}/changes`);
  assert.deepEqual(noGitChanges, { available: true, source: "folder", skipped: 0, files: [] });
  mkdirSync(join(project, "node_modules"));
  const references = join(project, "references");
  mkdirSync(references);
  await request("/settings", { ...initial.settings, references: [references] }, "PUT");
  writeFileSync(join(project, "fixture-implementation.txt"), "before this run\n");
  writeFileSync(join(project, "removed-by-run.txt"), "previous file\n");
  await request("/jobs", {
    request: "IMPLEMENT_REVIEW_FIX CHECK_FOLDER_CHANGES",
    request_id: "folder-changes",
  });
  for (let i = 0; i < 100; i++) {
    state = await request("/state");
    if (state.job.status !== "running") break;
    await pause(100);
  }
  assert.equal(state.job.status, "done");
  const folderChangesPath = `/jobs/${state.job.id}/changes`;
  const folderChanges = await request(folderChangesPath);
  assert.equal(folderChanges.source, "folder");
  assert.deepEqual(folderChanges.files.map(({ path, kind }) => ({ path, kind })), [
    { path: "created-by-run.txt", kind: "added" },
    { path: "fixture-implementation.txt", kind: "modified" },
    { path: "removed-by-run.txt", kind: "deleted" },
  ]);
  assert.match(folderChanges.files[1].patch, /^\+corrected$/m);
  assert.ok(!existsSync(join(project, ".git")));
  for (const file of ["created-by-run.txt", ".env", "auth.json", "node_modules/generated.js", "references/notes.md"]) {
    rmSync(join(project, file));
  }
  await request("/settings", initial.settings, "PUT");
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: project, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git("init", "-q");
  writeFileSync(join(project, ".gitignore"), "*.log\n");
  writeFileSync(join(project, "fixture-implementation.txt"), "staged baseline\n");
  writeFileSync(join(project, "untouched-dirty.txt"), "staged other file\n");
  writeFileSync(join(project, "removed-by-run.txt"), "previous file\n");
  git("add", "--", "fixture-implementation.txt", "untouched-dirty.txt", "removed-by-run.txt");
  writeFileSync(join(project, "fixture-implementation.txt"), "before this run\n");
  writeFileSync(join(project, "untouched-dirty.txt"), "pre-existing dirty change\n");
  const indexBefore = readFileSync(join(project, ".git", "index"));
  await request("/jobs", {
    request: "IMPLEMENT_REVIEW_FIX FAIL_GROK_REVIEW CHECK_FILE_CHANGES",
    request_id: "failed-peer",
  });
  for (let i = 0; i < 100; i++) {
    state = await request("/state");
    if (state.job.status !== "running") break;
    await pause(100);
  }
  assert.equal(state.job.status, "done");
  const changesPath = `/jobs/${state.job.id}/changes`;
  assert.ok(
    turnMessages(state).find((m) => m.stage === "report").text.startsWith(
      "**Lead** 1/1 responded · **Individual review** 1/2 responded\n\n",
    ),
  );
  const recordedChanges = await request(changesPath);
  assert.equal(recordedChanges.available, true);
  assert.equal(recordedChanges.source, "git");
  assert.deepEqual(recordedChanges.files.map(({ path, kind }) => ({ path, kind })), [
    { path: "created-by-run.txt", kind: "added" },
    { path: "fixture-implementation.txt", kind: "modified" },
    { path: "removed-by-run.txt", kind: "deleted" },
  ]);
  assert.match(recordedChanges.files[0].patch, /^\+new file$/m);
  assert.match(recordedChanges.files[1].patch, /^-before this run$/m);
  assert.match(recordedChanges.files[1].patch, /^\+corrected$/m);
  assert.ok(!recordedChanges.files[1].patch.includes("staged baseline"));
  assert.match(recordedChanges.files[2].patch, /^-previous file$/m);
  assert.deepEqual(readFileSync(join(project, ".git", "index")), indexBefore);
  assert.ok(
    state.activity.some(
      (e) => e.kind === "workflow" && e.stage === "verification",
    ),
  );
  assert.ok(
    !state.activity.some(
      (e) =>
        e.agent === "grok" &&
        ["verification", "discussion", "report"].includes(e.stage),
    ),
    "Failed reviewers must not be retried in later stages",
  );
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
    assert.ok(!turnMessages(state).some((m) => m.stage === "report"));
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
  assert.ok(
    !existsSync(join(project, "wrong-provider.txt")),
    "Cursor must not execute Grok's generic agent command",
  );
  const reviewOnly = await request("/jobs", {
    request: "COMPACT_REPORT_FIXTURE Summarize in one sentence.",
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
  const shortReport = turnMessages(state).find((m) => m.stage === "report");
  assert.equal(shortReport.report_summary, "The status changed to ready.\n\n**Lead** None · **Individual review** 1/1 responded");
  assert.equal(shortReport.text, `${shortReport.report_summary}\n\n**Verification:** The reviewer checked the file.`);
  const profileDir = join(root, ".claude-jw");
  mkdirSync(profileDir);
  mkdirSync(join(root, ".claude"));
  const profile = { name: "claude-jw", config_dir: profileDir };
  const { agent_profiles: _, ...legacySettings } = initial.settings;
  const profileSettings = { ...legacySettings, claude_profiles: [profile] };
  for (const [index, [coder, reviewer]] of [
    ["claude", "claude-jw"],
    ["claude-jw", "claude"],
  ].entries()) {
    const before = await request(
      "/settings",
      { ...profileSettings, coder, reviewers: [reviewer], language: "한국어" },
      "PUT",
    );
    assert.ok(before.agents.some((a) => a.id === "claude-jw" && a.installed));
    await request("/jobs", {
      request: "CHECK_CLAUDE_PROFILES",
      request_id: `claude-profiles-${index}`,
    });
    for (let i = 0; i < 100; i++) {
      state = await request("/state");
      if (state.job.status !== "running") break;
      await pause(100);
    }
    assert.equal(state.job.status, "done");
    const roles = { claude: "default Claude", "claude-jw": "Claude JW" };
    for (const [agent, stage] of [
      [coder, "work"],
      [reviewer, "review"],
      [coder, "discussion"],
      [reviewer, "discussion"],
    ]) {
      assert.ok(
        turnMessages(state).some(
          (m) =>
            m.role === agent &&
            m.stage === stage &&
            m.text.includes(roles[agent]),
        ),
        `${agent} must publish its own ${stage} output`,
      );
    }
    const report = turnMessages(state).find(
      (m) => m.role === "council" && m.stage === "report",
    );
    assert.ok(report.text.startsWith("**담당** 1/1명 응답 · **개별 검수** 1/1명 응답\n\n"));
    assert.ok(
      state.activity.some(
        (e) =>
          e.kind === "note" &&
          e.agent === "claude-jw" &&
          e.text.includes("Claude JW"),
      ),
    );
    assert.equal(
      state.usage["claude-jw"].input_tokens -
        (before.usage["claude-jw"]?.input_tokens ?? 0),
      17 * (coder === "claude-jw" ? 3 : 2),
    );
    assert.equal(
      state.usage.claude.input_tokens - before.usage.claude.input_tokens,
      11 * (coder === "claude" ? 3 : 2),
    );
    assert.equal(state.limits["claude-jw"].windows[0].used, 20);
  }
  const renamed = await request(
    "/settings",
    {
      ...state.settings,
      agent_profiles: [{ ...profile, display_name: "Studio Claude" }],
    },
    "PUT",
  );
  assert.equal(renamed.settings.coder, "claude-jw");
  assert.equal(renamed.agent_labels["claude-jw"], "Studio Claude");
  assert.deepEqual(renamed.usage["claude-jw"], state.usage["claude-jw"]);
  assert.equal(renamed.limits["claude-jw"].windows[0].used, 20);
  const removed = await request("/settings", initial.settings, "PUT");
  assert.ok(!removed.agents.some((a) => a.id === "claude-jw"));
  assert.equal(removed.limits["claude-jw"], undefined);
  assert.ok(removed.messages.some((m) => m.role === "claude-jw"));
  const codexPrepared = await request("/codex/accounts/prepare", {
    request_id: randomUUID(),
  });
  assert.match(codexPrepared.login_command, /CODEX_HOME/);
  assert.match(
    codexPrepared.login_command,
    /cli_auth_credentials_store=file login/,
  );
  const checkCodex = () =>
    request("/codex/accounts/check", {
      config_dir: codexPrepared.config_dir,
    });
  assert.equal((await checkCodex()).status, "sign_in_required");
  writeFileSync(join(codexPrepared.config_dir, "fixture-signed-in"), "");
  assert.equal((await checkCodex()).status, "connected");
  const codexProfile = {
    name: codexPrepared.name,
    config_dir: codexPrepared.config_dir,
    display_name: "Second Codex",
  };
  await request(
    "/settings",
    {
      ...initial.settings,
      coder: codexProfile.name,
      reviewers: ["codex"],
      agent_profiles: [codexProfile, profile],
    },
    "PUT",
  );
  await request("/jobs", {
    request: "CHECK_CODEX_PROFILES",
    request_id: "codex-profiles",
  });
  for (let i = 0; i < 200; i++) {
    state = await request("/state");
    if (
      state.job.status === "done" &&
      state.limits[codexProfile.name]?.status === "ok"
    )
      break;
    if (i % 10 === 0) await request("/usage/refresh", {});
    await pause(100);
  }
  assert.equal(state.job.status, "done");
  assert.ok(
    turnMessages(state).some(
      (m) =>
        m.role === codexProfile.name &&
        m.stage === "work" &&
        m.text.includes("Extra Codex profile"),
    ),
  );
  assert.ok(
    turnMessages(state).some(
      (m) =>
        m.role === "codex" &&
        m.stage === "review" &&
        m.text.includes("Default Codex"),
    ),
  );
  assert.equal(state.limits[codexProfile.name].windows[0].used, 67);
  assert.equal(state.limits.codex.windows[0].used, 31);
  assert.equal(state.limits["claude-jw"].status, "cli_only");
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
  try {
    writeFileSync(
      join(data, "runtime.json"),
      JSON.stringify({ ...runtime, revision: runtimeRevision - 1 }),
    );
    const blocked = spawnSync(exe, ["--ensure-server"], {
      env,
      windowsHide: true,
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(
      blocked.status,
      1,
      "An incompatible busy engine must not be replaced",
    );
    assert.equal((await request("/state")).job.status, "running");
  } finally {
    writeFileSync(join(data, "runtime.json"), JSON.stringify(runtime));
  }
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
  for (const pid of pids) {
    let alive = true;
    for (let i = 0; i < 50 && alive; i++) {
      try {
        process.kill(pid, 0);
        await pause(100);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
        alive = false;
      }
    }
    assert.equal(alive, false, "Cancelled subprocess tree is still alive");
  }
  await request("/draft", { folder: project, text: "Saved draft 한글" }, "PUT");
  const cursor = (await request("/state")).cursor;
  daemon.kill();
  await new Promise((r) => daemon.once("exit", r));
  daemon = spawn(exe, ["--serve"], { env, windowsHide: true, stdio: "ignore" });
  await pause(1500);
  runtime = JSON.parse(readFileSync(join(data, "runtime.json"), "utf8"));
  state = await request("/state");
  assert.deepEqual(await request(changesPath), recordedChanges);
  assert.deepEqual(await request(folderChangesPath), folderChanges);
  assert.ok(state.messages.some((m) => m.report_summary === shortReport.report_summary && m.text === shortReport.text));
  assert.equal(state.draft, "Saved draft 한글");
  assert.deepEqual(
    await request("/claude/accounts/prepare", prepareBody),
    prepared,
  );
  assert.ok(state.cursor >= cursor);
  assert.ok(state.messages.some((m) => m.role === "council"));
  // A host stop must also close the CLI descendants, not just explicit job cancellation.
  rmSync(join(project, "fixture-pids.txt"), { force: true });
  await request("/jobs", {
    request: "WAIT_FOR_CANCEL",
    request_id: "host-stop",
  });
  for (let i = 0; i < 50 && !existsSync(join(project, "fixture-pids.txt")); i++)
    await pause(100);
  const stoppingPids = readFileSync(join(project, "fixture-pids.txt"), "utf8")
    .split("\n")
    .map(Number);
  const exited = new Promise((r) => daemon.once("exit", r));
  daemon.kill();
  await exited;
  for (const pid of stoppingPids) {
    let alive = true;
    for (let i = 0; i < 50 && alive; i++) {
      try {
        process.kill(pid, 0);
        await pause(100);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
        alive = false;
      }
    }
    assert.equal(alive, false, "Host shutdown left a CLI descendant alive");
  }
  daemon = null;
  console.log(
    "PASS authenticated API, validation, idempotency, coder + review + conference + report, usage totals, SSE replay, cancellation tree, restart persistence, host shutdown tree, compatible/busy host bootstrap",
  );
} finally {
  if (daemon) {
    daemon.kill();
    await pause(500);
  }
  assert.ok(root.startsWith(join(tmpdir(), "council-rust-test-")));
  rmSync(root, { recursive: true, force: true });
}
