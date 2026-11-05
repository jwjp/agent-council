import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "local-runtime-bridge",
      configureServer(server) {
        server.middlewares.use("/__council/runtime", async (req, res) => {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          if (
            req.method !== "GET" ||
            req.headers.host !== "127.0.0.1:1420" ||
            (req.headers.origin &&
              req.headers.origin !== "http://127.0.0.1:1420") ||
            req.headers["sec-fetch-site"] === "cross-site"
          ) {
            res.statusCode = 403;
            res.end(JSON.stringify({ error: "Local workspace access only." }));
            return;
          }
          try {
            const root =
              process.env.AGENT_COUNCIL_DATA ||
              path.join(
                process.env.LOCALAPPDATA || os.homedir(),
                "AgentCouncil",
              );
            const read = async () =>
              JSON.parse(
                await readFile(path.join(root, "runtime.json"), "utf8"),
              );
            const healthy = async () => {
              try {
                const r = await read();
                if (new URL(r.url).hostname !== "127.0.0.1" || r.revision !== 2)
                  return null;
                const result = await fetch(r.url + "/v1/health", {
                  headers: { Authorization: "Bearer " + r.token },
                  signal: AbortSignal.timeout(1000),
                });
                return result.ok ? r : null;
              } catch {
                return null;
              }
            };
            let runtime = await healthy();
            if (!runtime) {
              const candidates = [
                "src-tauri/target/debug/AgentCouncil.exe",
                "src-tauri/target/release/AgentCouncil.exe",
              ];
              const exe = candidates
                .map((p) => path.resolve(p))
                .find(existsSync);
              if (!exe)
                throw Error(
                  "Build the Rust engine first: cargo build --manifest-path src-tauri/Cargo.toml",
                );
              const child = spawn(exe, ["--ensure-server"], {
                windowsHide: true,
                stdio: "ignore",
                env: process.env,
              });
              child.on("error", () => {});
              for (let n = 0; n < 50 && !runtime; n++) {
                await new Promise((r) => setTimeout(r, 200));
                runtime = await healthy();
              }
            }
            if (!runtime)
              throw Error(
                "Cannot start the execution engine. Finish older running tasks and restart the app.",
              );
            res.end(JSON.stringify(runtime));
          } catch (error) {
            res.statusCode = 503;
            res.end(JSON.stringify({ error: String(error) }));
          }
        });
      },
    },
  ],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { outDir: "web-dist" },
});
