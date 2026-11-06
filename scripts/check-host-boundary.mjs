import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

for (const name of ["council-core", "council-host"]) {
  const result = spawnSync("cargo", ["tree", "--locked", "--manifest-path", "src-tauri/Cargo.toml", "-p", name, "--edges", "normal", "--prefix", "none", "--format", "{p}"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const packages = result.stdout.split(/\r?\n/).map((line) => line.split(" ")[0]);
  const forbidden = packages.filter((pkg) => /^(tauri(?:-|$)|wry$|rfd$|gtk(?:-|$)|webkit)/.test(pkg));
  assert.deepEqual(forbidden, [], `${name} must remain independent of desktop UI libraries`);
  if (name === "council-core") {
    assert.ok(!packages.some((pkg) => /^(tokio|axum|reqwest|rusqlite|windows-sys)$/.test(pkg)), "Wire types must not pull in the execution host");
  }
  console.log(`PASS ${name} dependency boundary`);
}
