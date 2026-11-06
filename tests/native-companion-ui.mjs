// Packaged React UI + mocked native IPC. Not a Swift/Keychain/device test.
import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let web, browser;
try {
  try {
    await fetch("http://127.0.0.1:1421");
    throw Error("Port 1421 is already in use");
  } catch (e) {
    if (String(e).includes("already in use")) throw e;
  }
  web = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      ...(process.argv.includes("--dev") ? [] : ["preview"]),
      "--config",
      "vite.mobile.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      "1421",
      "--strictPort",
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:1421")).ok) break;
    } catch {}
    await pause(100);
  }
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const errors = [],
    apiRequests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/companion/v1")) apiRequests.push(r.url());
  });
  await page.addInitScript(() => {
    window.isTauri = true;
    let pending = false,
      polls = 0,
      draft = "";
    const session = {
      id: "fixture",
      name: "My iPhone",
      folder: "/fixture/project",
      coder: "claude",
      reviewers: ["codex"],
      allow_work: true,
      protocol: "companion-v1",
    };
    const paired = () => sessionStorage.getItem("fixture-paired") === "yes";
    window.fixtureCalls = [];
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      unregisterCallback: () => {},
      invoke: async (command, args) => {
        window.fixtureCalls.push({ command, path: args?.path });
        if (command === "mobile_pair") {
          pending = true;
          polls = 0;
          return { status: "pending" };
        }
        if (command === "mobile_forget") {
          sessionStorage.removeItem("fixture-paired");
          return;
        }
        if (command === "mobile_stop" || command === "mobile_open_web") return;
        if (command === "mobile_events") {
          window.fixtureChannel = args.channel;
          return 1;
        }
        if (command !== "mobile_request")
          throw { status: 400, message: "Unexpected native operation" };
        if (args.path === "/pair/complete" && pending) {
          if (++polls < 2) return { status: "pending" };
          pending = false;
          sessionStorage.setItem("fixture-paired", "yes");
          return session;
        }
        if (!paired())
          throw { status: 401, message: "Pair this app with your PC." };
        if (args.path === "/session") return session;
        if (args.path === "/draft") {
          draft = args.body.text;
          return {};
        }
        if (args.path === "/logout") {
          sessionStorage.removeItem("fixture-paired");
          return {};
        }
        if (args.path === "/state")
          return {
            device: session,
            can_cancel: false,
            job: null,
            cursor: 0,
            draft,
            settings: {
              folder: session.folder,
              coder: "claude",
              reviewers: ["codex"],
              references: [],
              language: "English",
              appearance: "light",
              permissions: "all",
              draft: "",
            },
            messages: [
              {
                role: "council",
                text: "## Fixture report\nA complete **native view**. [Source](main.rs:8) and [Docs](https://example.com/docs).",
                stage: "report",
                time: "",
              },
            ],
            activity: [],
            agents: [],
            usage: { claude: { input_tokens: 123, output_tokens: 20 } },
            limits: {},
            limit_errors: {},
            running_jobs: 0,
            version: "fixture",
          };
        if (args.path === "/files/read")
          return {
            name: "main.rs",
            path: "/fixture/project/main.rs",
            line: 8,
            start_line: 8,
            text: "fn main() {}",
            truncated: false,
          };
        throw { status: 400, message: "Unexpected companion operation" };
      },
    };
  });
  await page.goto("http://127.0.0.1:1421");
  await expect(page.getByLabel("Pairing link", { exact: true })).toBeVisible();
  await page
    .getByLabel("Pairing link", { exact: true })
    .fill("https://pc.example/companion/#pair=" + "a".repeat(64));
  await page.getByLabel("Device name", { exact: true }).fill("My iPhone");
  mkdirSync(".runtime-test", { recursive: true });
  await page.screenshot({ path: ".runtime-test/native-phone-pairing.png" });
  await page
    .getByRole("button", { name: "Request connection", exact: true })
    .click();
  await expect(
    page.getByText("Waiting for host approval", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Fixture report", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  console.log(
    "PASS packaged native view pairs through IPC and renders the shared report",
  );
  await page.getByRole("link", { name: "Source", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "File preview" }),
  ).toBeVisible();
  await expect(page.locator(".file-target")).toContainText("fn main()");
  await page.getByRole("button", { name: "Close file", exact: true }).click();
  await page.getByRole("link", { name: "Docs", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.fixtureCalls.some((c) => c.command === "mobile_open_web"),
      ),
    )
    .toBe(true);
  const input = page.locator("textarea");
  await input.fill("한글 native draft");
  await expect
    .poll(() =>
      page.evaluate(() => window.fixtureCalls.some((c) => c.path === "/draft")),
    )
    .toBe(true);
  await page.screenshot({ path: ".runtime-test/native-phone-report.png" });
  console.log(
    "PASS file preview, external browser command and private draft use the native bridge",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Fixture report", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.fixtureChannel.onmessage({
      kind: "error",
      data: { status: 401, message: "Device revoked" },
    }),
  );
  await expect(page.getByLabel("Pairing link", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Forget saved connection", exact: true })
    .click();
  await page.reload();
  await expect(page.getByLabel("Pairing link", { exact: true })).toBeVisible();
  assert.deepEqual(apiRequests, []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS reload, native revocation and local forget; no web API fetches or browser exceptions",
  );
} finally {
  await browser?.close();
  if (web && !web.killed) {
    web.kill();
    await new Promise((r) => {
      web.once("exit", r);
      setTimeout(r, 3000);
    });
  }
}
