// Native simulator launch evidence; never claim physical-device or signed distribution.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
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
// Local ad-hoc identity for this simulator only, never an Apple distribution signature.
const platform = run("/usr/libexec/PlistBuddy", [
  "-c",
  "Print :DTPlatformName",
  app + "/Info.plist",
]);
if (platform !== "iphonesimulator")
  throw Error("Refusing simulator signing for a non-simulator bundle");
writeFileSync(
  ".runtime-test/ios-simulator.entitlements",
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>application-identifier</key><string>dev.agentcouncil.companion</string>
<key>keychain-access-groups</key><array><string>dev.agentcouncil.companion</string></array>
<key>get-task-allow</key><true/>
</dict></plist>`,
);
run("codesign", [
  "--force",
  "--sign",
  "-",
  "--entitlements",
  ".runtime-test/ios-simulator.entitlements",
  app,
]);
run("codesign", ["--verify", "--strict", app]);
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
