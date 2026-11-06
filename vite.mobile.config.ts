import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  root: path.resolve("mobile"),
  resolve: { alias: { "/src": path.resolve("src") } },
  plugins: [react()],
  server: { port: 1421, strictPort: true, fs: { allow: [path.resolve(".")] } },
  build: {
    outDir: "web-dist",
    rollupOptions: { input: path.resolve("mobile/index.html") },
  },
});
