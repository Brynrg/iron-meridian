import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

// `base: "./"` is REQUIRED so built asset URLs are relative: speedrungames.net
// serves this game under /games/<slug>/ and absolute paths would 404.
export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
