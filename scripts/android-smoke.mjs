import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const apk = process.argv[2];
assert.equal(
  process.argv.length,
  3,
  "Usage: node scripts/android-smoke.mjs DEBUG_APK",
);
const app = "dev.agentcouncil.companion";
const evidence = ".runtime-test/android";
const hierarchyPath = `/data/local/tmp/council-window-${process.pid}.xml`;
const labels = [
  "Bring your workspace along",
  "Device name",
  "Pairing link from your PC",
];
const adb = (args, timeout = 30000) =>
  execFileSync("adb", ["-e", ...args], { timeout, maxBuffer: 8 * 1024 * 1024 });
mkdirSync(evidence, { recursive: true });

try {
  adb(["install", apk], 120000);
  const launch = adb([
    "shell",
    "am",
    "start",
    "-W",
    "-n",
    `${app}/.MainActivity`,
  ]).toString();
  writeFileSync(`${evidence}/launch.txt`, launch);
  assert.match(launch, /Status: ok/);

  const deadline = Date.now() + 90000;
  do {
    const dump = adb([
      "shell",
      "uiautomator",
      "dump",
      hierarchyPath,
    ]).toString();
    if (dump.includes("dumped to")) {
      const hierarchy = adb(["shell", "cat", hierarchyPath]).toString();
      writeFileSync(`${evidence}/window.xml`, hierarchy);
      const nodes = hierarchy.match(/<node\b[^>]*>/g) ?? [];
      if (
        labels.every((label) =>
          nodes.some(
            (node) =>
              node.includes(`package="${app}"`) &&
              node.includes(`text="${label}"`),
          ),
        )
      ) {
        writeFileSync(
          `${evidence}/pairing.png`,
          adb(["exec-out", "screencap", "-p"]),
        );
        console.log(
          "PASS Android pairing heading and both form labels rendered",
        );
        break;
      }
    }
    assert.ok(Date.now() < deadline, "Android pairing screen did not render");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } while (true);
} catch (error) {
  try {
    writeFileSync(
      `${evidence}/failure.png`,
      adb(["exec-out", "screencap", "-p"]),
    );
    writeFileSync(
      `${evidence}/logcat.txt`,
      adb([
        "logcat",
        "-d",
        "-t",
        "250",
        "AndroidRuntime:E",
        "chromium:W",
        "Tauri:W",
        "*:S",
      ]),
    );
  } catch {
    console.error("Could not collect emulator diagnostics");
  }
  throw error;
} finally {
  try {
    adb(["shell", "rm", "-f", hierarchyPath]);
  } catch {
    console.warn("Could not remove the emulator's temporary window dump");
  }
}
