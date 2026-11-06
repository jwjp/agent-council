import { execFileSync } from "node:child_process";
const tree=execFileSync("cargo",["tree","--locked","--manifest-path","mobile/src-tauri/Cargo.toml","--prefix","none"],{encoding:"utf8"});
for(const name of ["council-host","rusqlite","rfd","open","portable-pty"]) {
  if(new RegExp(`^${name} v`,"m").test(tree))throw Error(`Mobile must not include ${name}`);
}
console.log("PASS native companion has no execution host, database or CLI dependencies");
