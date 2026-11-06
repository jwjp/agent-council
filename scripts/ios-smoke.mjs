// Native simulator launch evidence; never claim physical-device or signed distribution.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const run = (command, args) =>
  execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
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
const devices = JSON.parse(
  run("xcrun", ["simctl", "list", "devices", "available", "-j"]),
).devices;
const device = Object.values(devices)
  .flat()
  .find((d) => d.name.includes("iPhone"));
if (!device) throw Error("No available iPhone simulator");
if (device.state !== "Booted") run("xcrun", ["simctl", "boot", device.udid]);
run("xcrun", ["simctl", "bootstatus", device.udid, "-b"]);
run("xcrun", ["simctl", "install", device.udid, app]);
const output = run("xcrun", [
  "simctl",
  "launch",
  device.udid,
  "dev.agentcouncil.companion",
]);
await new Promise((r) => setTimeout(r, 6000));
run("xcrun", [
  "simctl",
  "io",
  device.udid,
  "screenshot",
  ".runtime-test/ios-pairing.png",
]);
writeFileSync(
  ".runtime-test/ios-launch.txt",
  `Simulator: ${device.name}\n${output}\nPackaged app: ${app}\nNo distribution signing or physical device verification.\n`,
);
console.log("PASS simulator installed and launched; inspect ios-pairing.png");
