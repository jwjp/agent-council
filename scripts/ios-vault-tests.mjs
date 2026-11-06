import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: "inherit", ...options });
const info = JSON.parse(
  execFileSync("xcrun", ["simctl", "list", "devices", "available", "-j"], {
    encoding: "utf8",
  }),
);
const device = Object.values(info.devices)
  .flat()
  .find((d) => d.name.includes("iPhone"));
if (!device) throw Error("No iPhone simulator for native vault tests");
mkdirSync(".runtime-test", { recursive: true });
run("xcodegen", ["generate"], { cwd: "mobile/tests/ios" });
run("xcodebuild", [
  "test",
  "-project",
  "mobile/tests/ios/CouncilVaultTests.xcodeproj",
  "-scheme",
  "VaultTests",
  "-destination",
  `platform=iOS Simulator,id=${device.udid}`,
  "-derivedDataPath",
  "mobile/tests/ios/build",
  "-resultBundlePath",
  ".runtime-test/ios-vault.xcresult",
  "-parallel-testing-enabled",
  "NO",
  "CODE_SIGNING_ALLOWED=YES",
  "CODE_SIGN_IDENTITY=-",
  "CODE_SIGNING_REQUIRED=YES",
  "CODE_SIGN_STYLE=Manual",
]);
