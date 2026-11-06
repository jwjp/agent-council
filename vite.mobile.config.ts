import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  plugins: [react()],
  server: { port: 1421, strictPort: true },
  build: {
    outDir: "mobile/web-dist",
    rollupOptions: { input: path.resolve("mobile/index.html") },
  },
});
