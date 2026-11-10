import assert from "node:assert/strict";
import { hasPairingScreen } from "../scripts/ios-screen-check.mjs";

assert.equal(hasPairingScreen([]), false);
assert.equal(hasPairingScreen(["12:15", "LTE", "100%"]), false);
assert.equal(
  hasPairingScreen(["Council Companion", "Checking connection…"]),
  false,
);
assert.equal(
  hasPairingScreen(["Bring your workspace along", "Device name"]),
  false,
);
assert.equal(
  hasPairingScreen([
    "Bring your workspace",
    "along",
    "Device name",
    "Pairing link from your PC",
  ]),
  true,
);
assert.equal(
  hasPairingScreen([
    "BRING YOUR WORKSPACE ALONG",
    "Device  name",
    "Pairing link from your PC",
  ]),
  true,
);
console.log(
  "PASS simulator screen gate rejects blank/status/loading/incomplete frames and accepts the visible pairing form",
);
