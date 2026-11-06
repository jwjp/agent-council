// Vite preserves the multi-page entry path. Tauri requires a root index.html.
import { copyFile, readFile } from "node:fs/promises";
const source = "mobile/web-dist/mobile/index.html";
await copyFile(source, "mobile/web-dist/index.html");
const html = await readFile(source, "utf8");
if (!html.includes("/assets/")) throw Error("Missing packaged mobile entry");
