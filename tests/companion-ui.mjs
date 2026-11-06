import { chromium, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import assert from "node:assert/strict";

const root = mkdtempSync(join(tmpdir(), "council-phone-ui-")),
  project = join(root, "project"),
  bin = join(root, "bin");
mkdirSync(project);
mkdirSync(bin);
mkdirSync(".runtime-test", { recursive: true });
writeFileSync(join(project, "main.rs"), "fn main() {}\n// 한글 파일 내용\n");
writeFileSync(
  join(root, "settings.json"),
  JSON.stringify({
    folder: project,
    coder: "claude",
    reviewers: ["codex", "grok"],
    permissions: "all",
    language: "English",
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
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
let web, browser, runtime, page, phone;
let checks = 0;
const pass = (name) => {
  checks++;
  console.log("PASS", name);
};
const free = () =>
  new Promise((r, j) => {
    const s = createServer();
    s.on("error", j);
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => r(port));
    });
  });
try {
  const compile = spawnSync(
    "rustc",
    ["tests/fixture_agent.rs", "-o", join(bin, "fixture.exe")],
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
  ])
    copyFileSync(join(bin, "fixture.exe"), join(bin, name + ".exe"));
  try {
    await fetch("http://127.0.0.1:1420");
    throw Error("Port 1420 is already in use");
  } catch (e) {
    if (String(e).includes("already in use")) throw e;
  }
  web = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
    { env, windowsHide: true, stdio: "ignore" },
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:1420")).ok) break;
    } catch {}
    await pause(100);
  }
  browser = await chromium.launch({ channel: "msedge", headless: true });
  page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:1420");
  await expect(page.getByText("Engine connected", { exact: true })).toBeVisible(
    { timeout: 25000 },
  );
  runtime = JSON.parse(readFileSync(join(root, "runtime.json"), "utf8"));
  const local = async (
    path,
    body,
    method = body === undefined ? "GET" : "POST",
  ) => {
    const r = await fetch(runtime.url + "/v1" + path, {
      method,
      headers: {
        Authorization: "Bearer " + runtime.token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const v = await r.json();
    assert.ok(r.ok, JSON.stringify(v));
    return v;
  };
  const port = await free(),
    origin = `http://127.0.0.1:${port}`;
  const desktopInput = page.locator(".composer textarea");
  await desktopInput.fill("Desktop draft stays here");
  await pause(800);
  await page.getByRole("button", { name: "App menu", exact: true }).click();
  await page
    .getByRole("button", { name: "Connect a phone", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Connect a phone" }),
  ).toBeVisible();
  await page.getByLabel("Companion HTTPS address").fill(origin);
  await page.getByLabel("Companion local port").fill(String(port));
  await page
    .getByRole("button", { name: "Start gateway", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Create pairing QR", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  const invitationResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/companion/invitations") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Create pairing QR", exact: true })
    .click();
  const invite = await (await invitationResponse).json();
  await expect(page.getByAltText("Scan to request pairing")).toHaveAttribute(
    "src",
    /^data:image\/png/,
  );
  await page.screenshot({ path: ".runtime-test/desktop-phone-settings.png" });
  pass(
    "Desktop creates a scoped pairing QR through a distinct connection panel",
  );
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  phone = await context.newPage();
  phone.on("pageerror", (e) => errors.push(e.message));
  phone.on("console", (m) => {
    if (
      m.type() === "error" &&
      /Content Security Policy|Refused to/.test(m.text())
    )
      errors.push(m.text());
  });
  await phone.goto(invite.url);
  await expect(
    phone.getByRole("button", { name: "Request connection", exact: true }),
  ).toBeVisible();
  assert.ok(!phone.url().includes("#"));
  await phone.getByLabel("Device name", { exact: true }).fill("Pocket review");
  await phone
    .getByRole("button", { name: "Request connection", exact: true })
    .click();
  await expect(
    phone.getByText("Waiting for host approval", { exact: true }),
  ).toBeVisible();
  await phone.reload();
  await expect(
    phone.getByText("Waiting for host approval", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Pocket review", { exact: true })).toBeVisible({
    timeout: 8000,
  });
  await phone.screenshot({ path: ".runtime-test/mobile-pairing.png" });
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(phone.getByText("Connected", { exact: true })).toBeVisible({
    timeout: 12000,
  });
  const cookies = await context.cookies();
  assert.ok(
    cookies.some(
      (c) =>
        c.name === "CouncilDevice" && c.httpOnly && c.sameSite === "Strict",
    ),
  );
  assert.ok(
    !(await phone.evaluate(() => JSON.stringify(localStorage))).includes(
      "CouncilDevice",
    ),
  );
  pass(
    "Phone strips the invitation fragment, survives pending reload and requires PC approval",
  );
  const input = phone.getByRole("textbox", { name: "Message to your team" });
  await input.fill("한글 초안 보관");
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("한글 초안 보관\n");
  await input.evaluate((el) =>
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        keyCode: 229,
        isComposing: true,
        bubbles: true,
      }),
    ),
  );
  await pause(700);
  assert.equal((await local("/state")).messages.length, 0);
  await phone.getByRole("button", { name: "Change language" }).click();
  await expect(input).toHaveValue("한글 초안 보관\n");
  await phone.reload();
  await expect(input).toHaveValue("한글 초안 보관\n", { timeout: 10000 });
  assert.equal((await local("/state")).draft, "Desktop draft stays here");
  pass(
    "Korean composition, Shift+Enter, focus/language changes and private drafts survive reload",
  );
  await input.fill("IMPLEMENT_REVIEW_FIX");
  await input.press("Enter");
  await expect(
    phone.locator(".phone-message").filter({ hasText: "IMPLEMENT_REVIEW_FIX" }),
  ).toBeVisible();
  await expect
    .poll(async () => (await local("/state")).job?.status, { timeout: 25000 })
    .toBe("done");
  await expect(
    phone.locator(".markdown h2").filter({ hasText: "Fixture result" }),
  ).toBeVisible({ timeout: 10000 });
  assert.equal(
    readFileSync(join(project, "fixture-implementation.txt"), "utf8"),
    "corrected",
  );
  await phone.screenshot({ path: ".runtime-test/mobile-dashboard.png" });
  pass(
    "Mobile submits real host work and displays the attributed Markdown council report",
  );
  await phone.getByRole("button", { name: "Claude Code", exact: true }).click();
  await expect(
    phone
      .locator(".phone-message")
      .filter({ hasText: "Initial implementation ready" }),
  ).toBeVisible();
  await phone.getByRole("button", { name: "최종 보고", exact: false }).click();
  await phone
    .locator(".markdown a")
    .filter({ hasText: "main.rs" })
    .first()
    .click();
  await expect(
    phone.getByRole("dialog", { name: "File preview" }),
  ).toBeVisible();
  await expect(
    phone.getByRole("heading", { name: "main.rs:2", exact: true }),
  ).toBeVisible();
  await phone.getByRole("button", { name: "Close file" }).click();
  pass(
    "Agent tabs separate opinions and file links open an approved host preview",
  );
  await phone.getByRole("button", { name: "사용량", exact: true }).click();
  await expect(
    phone.getByRole("dialog", { name: "Account usage" }),
  ).toBeVisible();
  await expect(
    phone.getByRole("heading", { name: "계정 사용량" }),
  ).toBeVisible();
  await phone.getByRole("button", { name: "Close usage" }).click();
  await expect
    .poll(() =>
      phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await phone.setViewportSize({ width: 320, height: 640 });
  await expect(input).toBeInViewport();
  await expect(
    phone.getByRole("button", { name: "Send message" }),
  ).toBeInViewport();
  await phone.setViewportSize({ width: 390, height: 844 });
  pass(
    "Usage details and compact phone layout remain accessible at 320px width",
  );
  const hostStarted = await local("/jobs", {
    request: "WAIT_FOR_CANCEL from desktop",
    request_id: "host-progress",
  });
  await expect(
    phone.getByRole("button", { name: "Cancel my request" }),
  ).toBeVisible({ timeout: 10000 });
  await expect(
    phone.getByRole("button", { name: "Cancel my request" }),
  ).toBeDisabled();
  await local(`/jobs/${hostStarted.id}/cancel`, {});
  await expect(phone.getByRole("button", { name: "Send message" })).toBeVisible(
    { timeout: 10000 },
  );
  pass(
    "Phone follows host-started work without gaining permission to cancel it",
  );
  await input.fill("WAIT_FOR_CANCEL");
  await phone.getByRole("button", { name: "Send message" }).click();
  await expect(
    phone.getByRole("button", { name: "Cancel my request" }),
  ).toBeVisible();
  await phone.goto("about:blank");
  assert.equal((await local("/state")).job.status, "running");
  await phone.goto(origin + "/companion/");
  await expect(
    phone.getByRole("button", { name: "Cancel my request" }),
  ).toBeVisible({ timeout: 10000 });
  await phone.getByRole("button", { name: "Cancel my request" }).click();
  await expect
    .poll(async () => (await local("/state")).job?.status, { timeout: 10000 })
    .toBe("cancelled");
  assert.equal(
    (await local("/state")).messages.filter(
      (m) => m.role === "You" && m.text === "WAIT_FOR_CANCEL",
    ).length,
    1,
  );
  pass(
    "Leaving the phone does not cancel work; reconnection resumes without duplicate requests",
  );
  await page
    .locator(".phone-device")
    .filter({ hasText: "Pocket review" })
    .getByRole("button", { name: "Disconnect", exact: true })
    .click();
  await expect(
    phone.getByRole("heading", { name: "어디서든 작업을 이어가세요" }),
  ).toBeVisible({ timeout: 10000 });
  pass("Host revocation removes access from a live phone session");
  assert.deepEqual(errors, []);
  pass("No browser exceptions or companion CSP violations");
  console.log(`${checks} companion UI checks passed`);
} catch (e) {
  await page
    ?.screenshot({ path: ".runtime-test/desktop-phone-failure.png" })
    .catch(() => {});
  await phone
    ?.screenshot({ path: ".runtime-test/phone-ui-failure.png" })
    .catch(() => {});
  throw e;
} finally {
  await browser?.close();
  web?.kill();
  if (existsSync(join(root, "runtime.json"))) {
    try {
      const descriptor = JSON.parse(
        readFileSync(join(root, "runtime.json"), "utf8"),
      );
      process.kill(descriptor.pid);
    } catch {}
  }
  await pause(500);
  assert.ok(root.startsWith(join(tmpdir(), "council-phone-ui-")));
  rmSync(root, { recursive: true, force: true });
}
