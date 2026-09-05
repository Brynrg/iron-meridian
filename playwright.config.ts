import { defineConfig } from "@playwright/test";

// Smoke test config. Builds the game and serves dist/ via `vite preview`.
// Because vite.config.ts uses `base: "./"`, the build is mount-location
// independent — serving at root is a faithful proxy for /games/<slug>/.
export default defineConfig({
  testDir: "tests",
  testIgnore: ["**/unit/**"],
  timeout: 30_000,
  fullyParallel: true,
  use: { headless: true },
  webServer: {
    command: "npm run build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
