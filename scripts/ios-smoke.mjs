// Native simulator launch evidence; never claim physical-device or signed distribution.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { hasPairingScreen } from "./ios-screen-check.mjs";
const run = (command, args, timeout = 120000) =>
  execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
    timeout,
  }).trim();
mkdirSync(".runtime-test", { recursive: true });
const found = run("find", [
  "mobile/src-tauri/gen/apple",
  "-type",
  "d",
  "-name",
  "*.app",
])
  .split("\n")
  .filter((p) => p.endsWith(".app") && !p.includes(".xcarchive/"));
if (!found.length) throw Error("No simulator app was produced");
const app = found[0];
// Let Xcode produce simulator signatures and embedded simulated entitlements.
const platform = run("/usr/libexec/PlistBuddy", [
  "-c",
  "Print :DTPlatformName",
  app + "/Info.plist",
]);
if (platform !== "iphonesimulator") throw Error("Expected a simulator bundle");
const executable = run("/usr/libexec/PlistBuddy", [
  "-c",
  "Print :CFBundleExecutable",
  app + "/Info.plist",
]);
const commands = run("otool", ["-l", app + "/" + executable]);
writeFileSync(".runtime-test/ios-macho.txt", commands);
if (!/sectname\s+__entitlements/.test(commands))
  throw Error("Simulator Keychain entitlements were not embedded");
const devices = JSON.parse(
  run("xcrun", ["simctl", "list", "devices", "available", "-j"]),
).devices;
const device = Object.values(devices)
  .flat()
  .find((d) => d.name.includes("iPhone"));
if (!device) throw Error("No available iPhone simulator");
console.log("Booting simulator:", device.name);
if (device.state !== "Booted") run("xcrun", ["simctl", "boot", device.udid]);
run("xcrun", ["simctl", "bootstatus", device.udid, "-b"], 600000);
console.log("Installing packaged app:", app);
run("xcrun", ["simctl", "install", device.udid, app]);
const output = run("xcrun", [
  "simctl",
  "launch",
  device.udid,
  "dev.agentcouncil.companion",
]);
console.log("Launched:", output);
run("xcrun", [
  "swiftc",
  "scripts/ios-screen-text.swift",
  "-o",
  ".runtime-test/ios-screen-text",
]);
const screenshot = ".runtime-test/ios-pairing.png";
const deadline = Date.now() + 90000;
let ready = false;
do {
  run("xcrun", ["simctl", "io", device.udid, "screenshot", screenshot]);
  const lines = JSON.parse(
    run(".runtime-test/ios-screen-text", [screenshot], 30000),
  );
  writeFileSync(
    ".runtime-test/ios-screen-text.json",
    JSON.stringify(lines, null, 2),
  );
  ready = hasPairingScreen(lines);
  console.log("Pairing screen visible:", ready);
  if (!ready) await new Promise((r) => setTimeout(r, 2000));
} while (!ready && Date.now() < deadline);
if (!ready) {
  try {
    writeFileSync(
      ".runtime-test/ios-runtime.log",
      run(
        "xcrun",
        [
          "simctl",
          "spawn",
          device.udid,
          "log",
          "show",
          "--last",
          "3m",
          "--style",
          "compact",
          "--predicate",
          'process == "Council Companion" OR eventMessage CONTAINS "dev.agentcouncil.companion"',
        ],
        30000,
      ),
    );
  } catch {
    writeFileSync(
      ".runtime-test/ios-runtime.log",
      "Simulator diagnostics unavailable.",
    );
  }
  throw Error(
    "Native pairing screen did not render; inspect screenshot/OCR/runtime diagnostics",
  );
}
writeFileSync(
  ".runtime-test/ios-launch.txt",
  `Simulator: ${device.name}\n${output}\nPackaged app: ${app}\nNo distribution signing or physical device verification.\n`,
);
console.log(
  "PASS simulator installed, launched and rendered the pairing form; inspect ios-pairing.png",
);
