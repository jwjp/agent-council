import { chromium, webkit, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  copyFileSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { join, resolve, delimiter } from "node:path";
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
  PATH: bin + delimiter + process.env.PATH,
};
const suffix = process.platform === "win32" ? ".exe" : "";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
// WebKit screenshots inject an inline `body {}` animation-sync stylesheet.
// Keep the host's strict CSP intact; inspect screenshots with Edge instead.
const screenshot = (target, path) =>
  process.env.COUNCIL_UI_BROWSER === "webkit"
    ? Promise.resolve()
    : target.screenshot({ path });
async function observeCompanion(target) {
  // WebKit's protocol reports some caught Fetch network diagnostics as pageerror.
  // Observe actual DOM errors/rejections and CSP events, without suppressing them.
  await target.exposeFunction("recordScriptFailure", (message) => {
    errors.push(`JS: ${message}`);
  });
  await target.exposeFunction("recordCspViolation", (directive, blocked) =>
    errors.push(`CSP: ${directive} blocked ${blocked}`),
  );
  await target.addInitScript(() => {
    window.addEventListener("error", (event) => {
      if (event instanceof ErrorEvent)
        void window.recordScriptFailure(event.message);
    });
    window.addEventListener(
      "unhandledrejection",
      (event) => void window.recordScriptFailure(String(event.reason)),
    );
    document.addEventListener(
      "securitypolicyviolation",
      (event) =>
        void window.recordCspViolation(
          event.effectiveDirective,
          event.blockedURI,
        ),
    );
  });
}
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
    ["tests/fixture_agent.rs", "-o", join(bin, "fixture" + suffix)],
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
    copyFileSync(join(bin, "fixture" + suffix), join(bin, name + suffix));
    if (process.platform !== "win32")
      chmodSync(join(bin, name + suffix), 0o755);
  }
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
  browser =
    process.env.COUNCIL_UI_BROWSER === "webkit"
      ? await webkit.launch({ headless: true })
      : await chromium.launch({ channel: "msedge", headless: true });
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
  await screenshot(page, ".runtime-test/desktop-phone-settings.png");
  pass(
    "Desktop creates a scoped pairing QR through a distinct connection panel",
  );
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  phone = await context.newPage();
  await observeCompanion(phone);
  await phone.goto(invite.url);
  const manifestResponse = await context.request.get(
    origin + "/companion/manifest.webmanifest",
  );
  assert.equal(manifestResponse.status(), 200);
  assert.match(
    manifestResponse.headers()["content-type"],
    /application\/manifest\+json/,
  );
  const manifest = await manifestResponse.json();
  assert.equal(manifest.start_url, "/companion/");
  assert.equal(manifest.id, "/companion/");
  assert.equal(manifest.display, "standalone");
  for (const icon of manifest.icons) {
    const r = await context.request.get(origin + icon.src);
    assert.equal(r.status(), 200);
    assert.match(r.headers()["content-type"], /image\/png/);
  }
  assert.match(
    (await context.request.get(origin + "/companion/")).headers()[
      "content-security-policy"
    ],
    /manifest-src 'self'/,
  );
  await phone
    .getByRole("button", { name: "Add to Home Screen", exact: true })
    .click();
  await expect(
    phone.getByRole("dialog", { name: "Install companion" }),
  ).toBeVisible();
  await screenshot(phone, ".runtime-test/mobile-install-guide.png");
  await phone
    .getByRole("button", { name: "Close install guide", exact: true })
    .click();
  pass(
    "Home Screen manifest/icons use a stable non-secret launch URL and the install guide opens in-window",
  );
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
  await screenshot(phone, ".runtime-test/mobile-pairing.png");
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
    JSON.stringify(
      cookies.map(({ name, httpOnly, sameSite }) => ({
        name,
        httpOnly,
        sameSite,
      })),
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
  await input.focus();
  await input.evaluate((el) => {
    el.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        keyCode: 13,
        isComposing: false,
        bubbles: true,
      }),
    );
    el.form.requestSubmit();
  });
  await pause(500);
  assert.equal((await local("/state")).messages.length, 0);
  await input.evaluate((el) => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    ).set.call(el, "한글 조합 마지막 글자");
    el.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "자" }),
    );
  });
  await expect(input).toHaveValue("한글 조합 마지막 글자");
  await input.evaluate((el) => {
    el.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    ).set.call(el, "포커스 이동에도 입력 보존");
    el.blur();
  });
  await expect
    .poll(() =>
      phone.evaluate(() =>
        fetch("/companion/v1/state")
          .then((r) => r.json())
          .then((s) => s.draft),
      ),
    )
    .toBe("포커스 이동에도 입력 보존");
  await expect(input).toHaveValue("포커스 이동에도 입력 보존");
  pass(
    "Explicit IME composition blocks Enter/form submission and retains final DOM input on composition end or blur",
  );

  await input.focus();
  await phone.evaluate(() => {
    Object.defineProperties(visualViewport, {
      height: { configurable: true, value: 340 },
      offsetTop: { configurable: true, value: 44 },
      scale: { configurable: true, value: 1 },
    });
    visualViewport.dispatchEvent(new Event("resize"));
  });
  const shell = phone.locator(".companion-app");
  await expect(shell).toHaveClass(/phone-keyboard/);
  await expect
    .poll(() =>
      shell.evaluate((el) => Math.round(el.getBoundingClientRect().height)),
    )
    .toBe(340);
  const visibleComposer = () =>
    phone.evaluate(() => {
      const app = document
        .querySelector(".companion-app")
        .getBoundingClientRect();
      const input = document
        .querySelector(".phone-composer textarea")
        .getBoundingClientRect();
      const send = document
        .querySelector(".phone-send")
        .getBoundingClientRect();
      return (
        input.top >= app.top && send.bottom <= app.bottom && input.height >= 38
      );
    });
  assert.ok(await visibleComposer());
  await screenshot(phone, ".runtime-test/mobile-keyboard.png");
  await phone.evaluate(() => {
    Object.defineProperties(visualViewport, {
      height: { configurable: true, value: 150 },
      offsetTop: { configurable: true, value: 100 },
      scale: { configurable: true, value: 2 },
    });
    visualViewport.dispatchEvent(new Event("resize"));
  });
  await pause(100);
  assert.equal(
    await shell.evaluate((el) => Math.round(el.getBoundingClientRect().height)),
    340,
  );
  await phone.evaluate(() => {
    Object.defineProperties(visualViewport, {
      height: { configurable: true, value: 260 },
      scale: { configurable: true, value: 1 },
    });
    visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect(shell).toHaveClass(/phone-keyboard-tight/);
  assert.ok(await visibleComposer());
  await phone
    .getByRole("button", { name: "Dismiss keyboard", exact: true })
    .click();
  await expect(shell).not.toHaveClass(/phone-keyboard/);
  await phone.evaluate(() => {
    for (const name of ["height", "offsetTop", "scale"])
      delete visualViewport[name];
    document.activeElement.blur();
    visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect(shell).not.toHaveClass(/phone-keyboard/);
  await expect(phone.locator(".phone-header")).toBeVisible();
  await phone.setViewportSize({ width: 844, height: 390 });
  await expect
    .poll(() =>
      shell.evaluate((el) => Math.round(el.getBoundingClientRect().height)),
    )
    .toBe(390);
  assert.ok(await visibleComposer());
  await expect(
    phone.getByRole("button", { name: "Disconnect this device", exact: true }),
  ).toBeVisible();
  await screenshot(phone, ".runtime-test/mobile-landscape.png");
  await phone.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      shell.evaluate((el) => Math.round(el.getBoundingClientRect().height)),
    )
    .toBe(844);
  pass(
    "Simulated keyboard/pan bounds keep input and send controls visible, preserve pinch zoom, and restore after rotation/blur",
  );
  const offlineText = "오프라인 입력을 잃지 않습니다";
  await context.setOffline(true);
  await expect(
    phone.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  await input.fill(offlineText);
  await input.press("Enter");
  await expect(input).toHaveValue(offlineText);
  assert.equal((await local("/state")).messages.length, 0);
  const backup = JSON.parse(
    await phone.evaluate(() =>
      sessionStorage.getItem("council-companion-draft-v1"),
    ),
  );
  assert.equal(backup.text, offlineText);
  const blockDraft = (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Fixture draft connection interrupted" }),
    });
  await phone.route("**/companion/v1/draft", blockDraft);
  await context.setOffline(false);
  await phone.reload();
  await expect(input).toHaveValue(offlineText, { timeout: 10000 });
  await phone.unroute("**/companion/v1/draft", blockDraft);
  await phone.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(() =>
      phone.evaluate(() =>
        fetch("/companion/v1/state")
          .then((r) => r.json())
          .then((s) => s.draft),
      ),
    )
    .toBe(offlineText);
  await expect(phone.getByLabel("Draft status", { exact: true })).toContainText(
    "PC에 저장",
  );
  assert.equal(
    await phone.evaluate(() =>
      sessionStorage.getItem("council-companion-draft-v1"),
    ),
    null,
  );
  pass(
    "Offline input survives a reload with interrupted saves, then syncs without sending a job",
  );
  let held = false,
    release;
  let captured;
  const arrived = new Promise((r) => (captured = r));
  const holdState = async (route) => {
    if (held) {
      await route.continue();
      return;
    }
    held = true;
    const response = await route.fetch();
    captured();
    await new Promise((r) => (release = r));
    await route.fulfill({ response });
  };
  await phone.route("**/companion/v1/state", holdState);
  await phone.evaluate(() => window.dispatchEvent(new Event("online")));
  await arrived;
  await input.fill("새 입력이 늦은 화면 갱신보다 우선합니다");
  await expect(phone.getByLabel("Draft status", { exact: true })).toContainText(
    "PC에 저장",
  );
  release();
  await pause(500);
  await expect(input).toHaveValue("새 입력이 늦은 화면 갱신보다 우선합니다");
  await phone.unroute("**/companion/v1/state", holdState);
  pass("A delayed pre-edit snapshot cannot overwrite newer acknowledged input");
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
  await screenshot(phone, ".runtime-test/mobile-dashboard.png");
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
  await local("/jobs", {
    request: "ASK_FOR_DIRECTION",
    request_id: "phone-clarification",
  });
  await expect(
    phone.getByRole("region", { name: "회의 진행 상황" }),
  ).toContainText("답변을 주시면 이어서 진행할 수 있어요", { timeout: 15000 });
  await expect(
    phone
      .locator(".phone-message")
      .getByText("Should this use SQLite or PostgreSQL?", { exact: true }),
  ).toBeVisible();
  pass(
    "Phone shows the lead's clarification directly in the council tab without unnecessary rounds",
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
  const loseJobAck = async (route) => {
    await route.fetch();
    await route.abort("failed");
  };
  await phone.route("**/companion/v1/jobs", loseJobAck);
  await input.fill("PHONE_ACK_RECOVERY");
  await phone
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await local("/state")).messages.filter(
          (m) => m.role === "You" && m.text === "PHONE_ACK_RECOVERY",
        ).length,
      { timeout: 15000 },
    )
    .toBe(1);
  await expect(input).toHaveValue("", { timeout: 15000 });
  assert.equal(
    await phone.evaluate(() =>
      sessionStorage.getItem("council-companion-draft-v1"),
    ),
    null,
  );
  await phone.unroute("**/companion/v1/jobs", loseJobAck);
  await phone.reload();
  await expect(input).toHaveValue("", { timeout: 10000 });
  assert.equal(
    (await local("/state")).messages.filter(
      (m) => m.role === "You" && m.text === "PHONE_ACK_RECOVERY",
    ).length,
    1,
  );
  pass(
    "A lost job acknowledgement is confirmed from scoped host state without restoring or repeating submitted text",
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
  assert.equal(
    await phone.evaluate(() =>
      sessionStorage.getItem("council-companion-draft-v1"),
    ),
    null,
  );
  const homeContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await homeContext.addInitScript(() =>
    Object.defineProperty(navigator, "standalone", { value: true }),
  );
  const home = await homeContext.newPage();
  await observeCompanion(home);
  await home.goto(origin + "/companion/");
  await expect(home.getByLabel("Pairing link", { exact: true })).toBeVisible();
  await expect(
    home.getByRole("button", { name: "Add to Home Screen", exact: true }),
  ).toHaveCount(0);
  const homeInvite = await local("/companion/invitations", {
    allow_work: true,
  });
  await home.getByLabel("Pairing link", { exact: true }).fill(homeInvite.url);
  await home.getByLabel("Device name", { exact: true }).fill("Home Screen");
  await home
    .getByRole("button", { name: "Request connection", exact: true })
    .click();
  await expect(
    home.getByText("Waiting for host approval", { exact: true }),
  ).toBeVisible();
  await local("/companion/invitations/" + homeInvite.id + "/approve", {});
  await expect(home.getByText("Connected", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await screenshot(home, ".runtime-test/mobile-home-screen.png");
  await home
    .getByRole("button", { name: "Disconnect this device", exact: true })
    .click();
  await expect(home.getByLabel("Pairing link", { exact: true })).toBeVisible();
  await homeContext.close();
  pass(
    "A fresh standalone context can paste a new pairing link, get host approval and disconnect",
  );
  assert.deepEqual(errors, []);
  pass("No browser exceptions or companion CSP violations");
  console.log(`${checks} companion UI checks passed`);
} catch (e) {
  if (page)
    await screenshot(page, ".runtime-test/desktop-phone-failure.png").catch(
      () => {},
    );
  if (phone)
    await screenshot(phone, ".runtime-test/phone-ui-failure.png").catch(
      () => {},
    );
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
