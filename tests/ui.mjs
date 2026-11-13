import { chromium, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const root = mkdtempSync(join(tmpdir(), "council-ui-test-")),
  project = join(root, "project"),
  bin = join(root, "bin"),
  data = join(root, "data");
mkdirSync(project);
mkdirSync(data);
writeFileSync(join(project, "main.rs"), "fn main() {}\n// 한글 파일 내용\n");
mkdirSync(bin);
let web, browser, runtime;
const errors = [];
let checks = 0;
const pass = (name) => {
  checks++;
  console.log("PASS", name);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const compile = spawnSync(
    "rustc",
    ["tests/fixture_agent.rs", "-o", join(bin, "fixture.exe")],
    { encoding: "utf8" },
  );
  assert.equal(compile.status, 0, compile.stderr);
  for (const a of [
    "claude",
    "codex",
    "agy",
    "grok",
    "agent",
    "cursor-agent",
    "gemini",
  ])
    copyFileSync(join(bin, "fixture.exe"), join(bin, a + ".exe"));
  writeFileSync(
    join(data, "settings.json"),
    JSON.stringify({
      folder: project,
      coder: "claude",
      reviewers: ["codex", "grok"],
      language: "English",
      permissions: "all",
    }),
  );
  const env = {
    ...process.env,
    AGENT_COUNCIL_DATA: data,
    AGENT_COUNCIL_AUTH_HOME: root,
    CLAUDE_CONFIG_DIR: join(root, ".claude"),
    GROK_HOME: join(root, ".grok"),
    PATH: bin + ";" + process.env.PATH,
  };
  try {
    await fetch("http://127.0.0.1:1420");
    throw Error(
      "Port 1420 is already in use; stop the earlier development server before UI tests.",
    );
  } catch (error) {
    if (String(error).includes("already in use")) throw error;
  }
  web = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
    { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  web.stdout.on("data", (b) => (output += b));
  web.stderr.on("data", (b) => (output += b));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:1420")).ok) break;
    } catch {}
    if (web.exitCode !== null) throw Error(output);
    await pause(100);
  }
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1180, height: 820 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("file:///" + resolve("index.html").replaceAll("\\", "/"));
  await expect(
    page.getByRole("heading", { name: "Agent Council", exact: true }),
  ).toBeVisible();
  pass("Opening source index.html shows a useful launch screen");
  const start = Date.now();
  await page.goto("http://127.0.0.1:1420");
  await expect(page.getByText("Engine connected", { exact: true })).toBeVisible(
    { timeout: 25000 },
  );
  assert.ok(Date.now() - start < 15000, "Browser startup exceeded 15 seconds");
  pass("Browser connects to the real isolated Rust engine");
  await page.route("**/v1/update", (route) =>
    route.fulfill({
      json: {
        channel: "windows-package",
        available: false,
        version: "3.2.0-beta.3",
        url: "ms-windows-store://downloadsandupdates",
        asset: null,
      },
    }),
  );
  await page.getByTitle("App menu", { exact: true }).click();
  await page.getByRole("button", { name: "Check for updates" }).click();
  const packageUpdates = page.getByRole("dialog", { name: "Software update" });
  await expect(
    packageUpdates.getByRole("heading", { name: "Windows package updates" }),
  ).toBeVisible();
  await expect(
    packageUpdates.getByRole("button", { name: "Open Microsoft Store" }),
  ).toBeVisible();
  await expect(
    packageUpdates.getByRole("button", { name: "Download & restart" }),
  ).toHaveCount(0);
  await page.screenshot({ path: ".runtime-test/msix-update-dialog.png" });
  await page.keyboard.press("Escape");
  await expect(packageUpdates).toHaveCount(0);
  await page.unroute("**/v1/update");
  pass(
    "Windows packages show Store update guidance and no portable install action",
  );
  runtime = JSON.parse(readFileSync(join(data, "runtime.json"), "utf8"));
  const req = async (path, body, method = body ? "POST" : "GET") => {
    const r = await fetch(runtime.url + "/v1" + path, {
      method,
      headers: {
        Authorization: "Bearer " + runtime.token,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const v = await r.json();
    assert.ok(r.ok, JSON.stringify(v));
    return v;
  };
  await page
    .getByRole("button", { name: "Choose lead agent", exact: true })
    .click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("menu").getByRole("button", { name: /Codex/ }).click();
  await expect
    .poll(async () => (await req("/state")).settings.coder)
    .toBe("codex");
  pass("Lead selector changes the lead directly without opening settings");
  await page
    .getByRole("button", { name: "Execution permissions", exact: true })
    .click();
  await page
    .getByRole("menu")
    .getByRole("button", { name: "Standard permissions", exact: true })
    .click();
  await expect
    .poll(async () => (await req("/state")).settings.permissions)
    .toBe("restricted");
  pass("Permission selector changes only the permission policy");
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Agent team", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^Lead agent/ }),
  ).toBeVisible();
  const profileDir = join(root, ".claude-studio");
  mkdirSync(profileDir);
  writeFileSync(join(profileDir, "fixture-signed-in"), "");
  await page.getByText("Claude accounts", { exact: true }).click();
  const accountPanel = page.locator(".claude-accounts");
  await expect(
    accountPanel.getByText("Signed in", { exact: true }),
  ).toBeVisible();
  await expect(
    accountPanel.getByText("default-fixture@example.invalid", { exact: true }),
  ).toBeVisible();
  await accountPanel
    .getByRole("button", { name: "Connect existing account", exact: true })
    .click();
  await expect(accountPanel.getByText("studio", { exact: true })).toBeVisible();
  await expect(
    accountPanel.getByText("extra-fixture@example.invalid", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: ".runtime-test/ui-claude-accounts.png" });
  await accountPanel
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await page.locator(".agent-choice").filter({ hasText: "Claude Code 2" }).click();
  await expect(
    page.locator(".review-choice").filter({ hasText: "Claude Code 2" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Claude Code 2 usage", exact: true }).locator(".quota-name"),
  ).toHaveText("Claude Code 2");
  const profileId = (await req("/state")).settings.coder;
  assert.match(profileId, /^claude-[0-9a-f]{32}$/);
  assert.equal((await req("/state")).agent_labels[profileId], "Claude Code 2");
  pass("Agents discovers and connects an existing Claude sign-in");
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await accountPanel.getByText("Claude accounts", { exact: true }).click();
  await expect(
    accountPanel.getByText("extra-fixture@example.invalid", { exact: true }),
  ).toBeVisible();
  await expect(accountPanel.getByText("Claude Code 2", { exact: true })).toBeVisible();
  await page.screenshot({ path: ".runtime-test/ui-claude-profile-name.png" });
  await accountPanel.getByText("Claude Code 2", { exact: true }).click();
  await accountPanel
    .getByRole("button", { name: "Rename", exact: true })
    .click();
  await accountPanel.getByLabel("Display name").fill("Studio Claude");
  await accountPanel.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Studio Claude usage", exact: true }),
  ).toBeVisible();
  assert.equal((await req("/state")).settings.coder, profileId);
  pass(
    "Renaming a Claude account preserves its participant ID and selected role",
  );
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await accountPanel.getByText("Claude accounts", { exact: true }).click();
  await accountPanel
    .getByRole("button", { name: "Sign in to a new account", exact: true })
    .click();
  const prepareRequests = [];
  let lostPreparation;
  await page.route("**/v1/claude/accounts/prepare", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    prepareRequests.push(route.request().postDataJSON());
    if (prepareRequests.length === 1) {
      const response = await route.fetch();
      lostPreparation = await response.json();
      await route.abort("connectionreset");
    } else {
      await route.continue();
    }
  });
  const prepared = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/claude/accounts/prepare") && response.ok(),
  );
  await accountPanel
    .getByRole("button", { name: "Prepare login", exact: true })
    .click();
  const pending = await (await prepared).json();
  await page.unroute("**/v1/claude/accounts/prepare");
  assert.equal(prepareRequests.length, 2);
  assert.match(prepareRequests[0].request_id, /^[a-f0-9-]{36}$/);
  assert.deepEqual(prepareRequests[1], prepareRequests[0]);
  assert.deepEqual(pending, lostPreparation);
  pass(
    "Claude login preparation recovers a lost response without duplicating the account folder",
  );
  await expect(
    accountPanel.getByRole("button", {
      name: "Copy login command",
      exact: true,
    }),
  ).toBeVisible();
  const checkLogin = async (status) => {
    const checked = page.waitForResponse((response) =>
      response.url().endsWith("/v1/claude/accounts/check"),
    );
    await accountPanel
      .getByRole("button", { name: "Check sign-in", exact: true })
      .click();
    const response = await checked;
    const result = await response.json();
    assert.equal(response.status(), 200, JSON.stringify(result));
    assert.equal(result.status, status);
  };
  await checkLogin("sign_in_required");
  writeFileSync(join(pending.config_dir, "fixture-signed-in"), "");
  await checkLogin("connected");
  await expect(
    accountPanel
      .locator(".claude-account-connect")
      .getByText("extra-fixture@example.invalid", { exact: true }),
  ).toBeVisible();
  await accountPanel
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await page.locator(".agent-choice").filter({ hasText: "Codex" }).click();
  await page
    .locator(".review-choice")
    .filter({ hasText: "Claude Code 3" })
    .click();
  for (const name of ["Studio Claude", "Claude Code 3"]) {
    const row = accountPanel
      .locator("details.claude-account-row")
      .filter({ has: page.getByText(name, { exact: true }) });
    await row.getByText(name, { exact: true }).click();
    await row.getByRole("button", { name: "Disconnect", exact: true }).click();
  }
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect
    .poll(async () => (await req("/state")).settings.agent_profiles)
    .toEqual([]);
  assert.ok(!(await req("/state")).settings.reviewers.includes(pending.name));
  pass(
    "Agents prepares a separate login and disconnects accounts without leaving a selected role",
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".settings-nav-bottom")).toContainText(
    `v${(await req("/state")).version}`,
  );
  await expect(
    page.getByRole("heading", { name: "Project folder", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Lead agent/ })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  pass("General settings opens workspace; appearance saves independently");
  page.once("dialog", (d) => d.accept(project));
  await page.locator(".breadcrumb").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  pass("Project breadcrumb opens project selection, not settings");
  await page.route("**/v1/settings", async (route) => {
    await pause(500);
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Choose lead agent", exact: true })
    .click();
  await page
    .getByRole("menu")
    .getByRole("button", { name: /Claude Code/ })
    .click();
  const input = page.locator(".composer textarea");
  await input.fill("한글 입력 중");
  await expect
    .poll(async () => (await req("/state")).settings.coder)
    .toBe("claude");
  await expect(input).toHaveValue("한글 입력 중");
  await page.unroute("**/v1/settings");
  pass("A delayed settings response does not overwrite newly typed text");
  await input.dispatchEvent("compositionstart");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  assert.equal((await req("/state")).messages.length, 0);
  await input.dispatchEvent("compositionend", { data: "한글 입력 중" });
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("한글 입력 중\n");
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(input).toHaveValue("한글 입력 중\n");
  pass(
    "IME Enter does not send; Shift+Enter and focus changes preserve the draft",
  );
  await page.reload();
  await expect(
    page.getByText("Engine connected", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".composer textarea")).toHaveValue(
    "한글 입력 중\n",
  );
  pass("Draft survives reload");
  let s = await req("/state");
  await req(
    "/settings",
    { ...s.settings, coder: "claude", reviewers: ["codex", "grok"] },
    "PUT",
  );
  await page.reload();
  await expect(
    page.getByText("Engine connected", { exact: true }),
  ).toBeVisible();
  await page.locator(".composer textarea").fill("SMOOTH_PROGRESS");
  await page.locator(".composer textarea").press("Enter");
  const progress = page.getByRole("region", { name: "Council progress" });
  // A labelled section is exposed as a region to assistive technology.
  await expect(progress).toContainText("1/2 finished", { timeout: 12000 });
  await expect(progress).toContainText("Gathering independent perspectives");
  await page.locator(".agent-pane select").first().selectOption("codex");
  const fastPane = page.locator(".agent-pane").first();
  await expect(
    fastPane
      .locator(".pane-report")
      .getByRole("heading", { name: "Fast review" }),
  ).toBeVisible();
  assert.equal((await req("/state")).job.status, "running");
  await page.screenshot({ path: ".runtime-test/workflow-review.png" });
  pass(
    "Fast review is readable immediately while the progress rail counts the remaining peer",
  );
  await fastPane.locator(".pane-content").evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  writeFileSync(join(project, "release-slow-review.txt"), "continue");
  await expect(progress).toContainText("Ready for your next step", {
    timeout: 20000,
  });
  await expect(
    fastPane.getByRole("button", { name: "New results ↓" }),
  ).toBeVisible();
  assert.equal(
    await fastPane.locator(".pane-content").evaluate((el) => el.scrollTop),
    0,
  );
  await fastPane.getByRole("button", { name: "New results ↓" }).click();
  await page.locator(".agent-pane select").first().selectOption("claude");
  pass(
    "New discussion results do not pull a reader away from an earlier review",
  );
  const git = spawnSync("git", ["init", "-q"], { cwd: project, encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  writeFileSync(join(project, "fixture-implementation.txt"), "before this run\n");
  await page.locator(".composer textarea").fill("IMPLEMENT_REVIEW_FIX");
  await page.locator(".composer textarea").press("Enter");
  await expect(page.locator(".current-request")).toContainText(
    "IMPLEMENT_REVIEW_FIX",
  );
  await expect(page.locator(".job-badge.done")).toBeVisible({ timeout: 15000 });
  s = await req("/state");
  assert.equal(
    readFileSync(join(project, "fixture-implementation.txt"), "utf8"),
    "corrected",
  );
  assert.equal(s.messages.filter((m) => m.stage === "refinement").length, 1);
  assert.equal(s.messages.filter((m) => m.stage === "verification").length, 2);
  const finalReport = page.locator(".pane-report").filter({ hasText: /Final report/i });
  await expect(finalReport).toBeVisible();
  await expect(finalReport).toContainText(
    "Lead 1/1 responded · Individual review 2/2 responded",
  );
  await page.screenshot({ path: ".runtime-test/ui-report-participation.png" });
  pass(
    "Real UI runs lead → parallel review → one correction → recheck → conference → report",
  );
  await page.getByText("Changes from this run", { exact: true }).click();
  await page.getByRole("button", { name: /fixture-implementation.txt Modified/ }).click();
  const diff = page.getByLabel("File diff", { exact: true });
  await expect(diff).toContainText("-before this run");
  await expect(diff).toContainText("+corrected");
  await page.screenshot({ path: ".runtime-test/ui-report-diff.png" });
  await page.getByText("Changes from this run", { exact: true }).click();
  pass("The final report opens a diff against the actual pre-job working file");
  await page
    .locator(".agent-pane")
    .first()
    .getByRole("button", { name: "Activity history" })
    .click();
  await expect(page.locator(".activity-log")).toBeVisible();
  await page
    .locator(".agent-pane")
    .first()
    .getByRole("button", { name: "Activity history" })
    .click();
  await page.locator(".split-handle").hover();
  const rect = await page.locator(".split-handle").boundingBox();
  await page.mouse.move(rect.x + 3, rect.y + 20);
  await page.mouse.down();
  await page.mouse.move(rect.x + 70, rect.y + 20);
  await page.mouse.up();
  pass("Split resize and per-agent activity switch work");
  await page
    .locator(".agent-pane")
    .first()
    .getByRole("button", { name: /Read full note/ })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Working notes" }),
  ).toBeVisible();
  await expect(page.locator(".note-full h2")).toHaveText("Fixture result");
  await page.screenshot({ path: ".runtime-test/ui-note.png" });
  await page
    .locator(".note-full")
    .getByRole("link", { name: "main.rs" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "File preview" }),
  ).toBeVisible();
  await expect(page.locator(".highlighted-line")).toContainText(
    "한글 파일 내용",
  );
  assert.equal(
    await page
      .locator(".file-drawer h2")
      .evaluate((el) => getComputedStyle(el).color),
    await page
      .locator(".file-source code")
      .first()
      .evaluate((el) => getComputedStyle(el).color),
    "Dark file title must keep readable contrast",
  );
  await page.screenshot({ path: ".runtime-test/ui-file.png" });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Working notes" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  pass(
    "Full notes render Markdown and local links open the correct file and line",
  );
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  await expect(page.locator(".conversation")).toBeVisible();
  await page.getByRole("button", { name: "Split view", exact: true }).click();
  pass("Conversation and split view switch separately");
  await page.screenshot({ path: ".runtime-test/ui-split.png" });
  await page.route("**/v1/state", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.limits.claude = {
      status: "ok",
      windows: [
        { label: "5 hours", used: 44, reset: Date.now() / 1000 + 3600 },
        { label: "Weekly", used: 79, reset: Date.now() / 1000 + 86400 },
      ],
      source: "Test fixture",
    };
    data.settings.agent_profiles = Array.from({ length: 4 }, (_, i) => ({
      name: `claude-quota-${i}`,
      config_dir: project,
      display_name: `Claude account ${i + 1}`,
    }));
    for (const profile of data.settings.agent_profiles)
      data.agent_labels = {
        ...data.agent_labels,
        [profile.name]: profile.display_name,
      };
    data.limits["claude-quota-0"] = { status: "cli_only" };
    const report = data.messages.findLast((m) => m.role === "council");
    report.text =
      "# Scrollable review\n\n" +
      "- **Changes:** Added the health response.\n" +
      "- **Verification:** Claude Code 2 ran the tests.\n" +
      "- **Review:** Optional suggestions deferred.\n\n" +
      "| File | Finding |\n| --- | --- |\n" +
      Array.from(
        { length: 80 },
        (_, i) => `| File ${i} | Reviewed item ${i} |`,
      ).join("\n");
    await route.fulfill({ response, json: data });
  });
  await page.reload();
  await expect(
    page.locator(".quota-strip").getByRole("button", { name: /Claude Code/ }),
  ).toContainText("79%");
  await page.locator(".usage-toggle").click();
  const usage = page.getByRole("region", { name: "Account usage" });
  await expect(usage.locator(".usage-agent-heading")).toHaveCount(10);
  await expect(usage.locator(".usage-detail")).toHaveCount(0);
  await expect(
    usage.getByRole("button", { name: /Claude Code/ }),
  ).toContainText("79%");
  await expect(
    usage.getByRole("button", { name: /Claude account 1/ }),
  ).toContainText("Awaiting CLI");
  const reading = usage.getByRole("button", { name: /Claude Code/ }).locator(".usage-reading");
  const meter = await reading.locator(".window-meter").boundingBox();
  const rate = await reading.locator("strong").boundingBox();
  assert.ok(meter && rate);
  assert.ok(Math.abs(meter.y + meter.height / 2 - rate.y - rate.height / 2) < 2);
  await page.screenshot({ path: ".runtime-test/ui-usage-overview.png" });
  await usage.getByRole("button", { name: /Claude account 1/ }).click();
  await expect(usage.locator(".usage-detail")).toContainText(
    "during a run with this account",
  );
  await usage.getByRole("button", { name: "Close usage" }).click();
  pass("Ten accounts use compact rows and only one detail is expanded");
  await page
    .locator(".quota-strip")
    .getByRole("button", { name: /Claude Code/ })
    .click();
  await expect(
    page
      .locator(".usage-agent")
      .filter({ hasText: "Claude Code" })
      .locator(".usage-detail"),
  ).toBeVisible();
  await expect(page.locator(".usage-detail")).toContainText("44% used");
  await expect(page.locator(".usage-detail")).toContainText("79% used");
  pass(
    "Account quota and direct agent drill-down are distinct from project tokens",
  );
  await page.screenshot({ path: ".runtime-test/ui-usage.png" });
  await page.keyboard.press("Escape");
  await page.locator(".dismiss").click({ force: true });
  const reportPane = page
    .locator(".pane-report")
    .filter({ hasText: "Scrollable review" });
  const reportScroll = reportPane.locator("..");
  await expect(reportPane.getByRole("heading", { name: "Scrollable review" })).toBeInViewport();
  await expect(reportPane.getByText("Verification:", { exact: true })).toBeInViewport();
  assert.equal(await reportScroll.evaluate((el) => el.scrollTop), 0);
  await page.screenshot({ path: ".runtime-test/ui-report-summary.png" });
  pass("A long final report opens at its summary");
  await reportScroll.evaluate((el) => {
    el.scrollTop = 250;
  });
  await reportPane.getByRole("cell", { name: "File 9", exact: true }).hover();
  const beforeScroll = await reportScroll.evaluate((el) => el.scrollTop);
  await page.mouse.wheel(0, -120);
  await expect
    .poll(() => reportScroll.evaluate((el) => el.scrollTop))
    .toBeLessThan(beforeScroll);
  pass("Wheel over a Markdown table scrolls its report pane upward");
  await page.unroute("**/v1/state");
  await page.setViewportSize({ width: 680, height: 540 });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const modal = await page.getByRole("dialog").boundingBox();
  assert.ok(
    modal.x >= 0 &&
      modal.y >= 0 &&
      modal.x + modal.width <= 680 &&
      modal.y + modal.height <= 540,
  );
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeVisible();
  pass("Small viewport keeps modal and save controls in bounds");
  await page.screenshot({ path: ".runtime-test/ui-small-settings.png" });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.locator(".agent-pane select").last().selectOption("council");
  await req("/jobs", {
    request: "ASK_FOR_DIRECTION",
    request_id: "ui-clarification",
  });
  await expect(
    page.getByRole("region", { name: "Council progress" }),
  ).toContainText("Your answer will guide the next step", { timeout: 15000 });
  await expect(page.locator(".job-badge")).toContainText("Your input");
  await expect(
    page
      .locator(".agent-pane")
      .last()
      .locator(".pane-report")
      .getByText("Should this use SQLite or PostgreSQL?", { exact: true }),
  ).toBeVisible();
  pass(
    "Clarifications remain visible in the council pane and ask for input without extra review rounds",
  );
  await req("/jobs", {
    request: "COMPACT_REPORT_FIXTURE Summarize in one sentence.",
    request_id: "ui-compact-report",
  });
  const shortReport = page.locator(".agent-pane").last();
  const reviewDetails = shortReport.getByText("Review details", { exact: true });
  const supportingEvidence = shortReport.getByText("The reviewer checked the file.", { exact: false });
  await expect(shortReport.getByText("The status changed to ready.", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(reviewDetails).toBeVisible();
  await expect(supportingEvidence).toBeHidden();
  await page.screenshot({ path: ".runtime-test/ui-compact-report.png" });
  await reviewDetails.click();
  await expect(supportingEvidence).toBeVisible();
  pass("Short requests show the answer first and expand the review evidence on demand");
  assert.deepEqual(errors, [], "Unexpected browser exceptions");
  pass("No unhandled browser errors");
  console.log(`${checks} UI checks passed`);
} catch (error) {
  if (browser) {
    const pages = browser.contexts().flatMap((c) => c.pages());
    if (pages[0])
      await pages[0].screenshot({
        path: ".runtime-test/ui-failure.png",
        fullPage: true,
      });
  }
  throw error;
} finally {
  await browser?.close();
  web?.kill();
  if (existsSync(join(data, "runtime.json"))) {
    try {
      const r = JSON.parse(readFileSync(join(data, "runtime.json"), "utf8"));
      process.kill(r.pid);
    } catch {}
  }
  await pause(400);
  assert.ok(root.startsWith(join(tmpdir(), "council-ui-test-")));
  rmSync(root, { recursive: true, force: true });
}
