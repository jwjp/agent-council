import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      exclude: [
        ...configDefaults.exclude,
        ".runtime-test/**",
        "web-dist/**",
        "mobile/web-dist/**",
        "src-tauri/target/**",
        "mobile/src-tauri/target/**",
      ],
    },
  }),
);
