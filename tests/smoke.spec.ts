import { test, expect } from "@playwright/test";

const URL = "http://localhost:4173/";

// Required smoke per docs/browser-game-template-contract.md §4: the built game
// must render a game-root element and log no console errors. This runs in CI
// before deploy, so a broken build is caught before it can reach the portal.
test("game loads and renders without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(URL, { waitUntil: "load" });

  // game-root element appears within 3s (canvas / #game / [data-game-root])
  await expect(
    page.locator("canvas, #game, [data-game-root]").first(),
  ).toBeVisible({ timeout: 3000 });

  // give the first frames time to run, then assert a clean console
  await page.waitForTimeout(1500);
  expect(errors, `console errors:\n${errors.join("\n")}`).toEqual([]);
});
