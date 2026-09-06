import { test, expect } from "@playwright/test";

// End points: a finished game shows the score screen and returns to the main menu.
const URL = "http://localhost:4173/?autostart=1&seed=3&ai=easy&size=48";

test("victory shows the score screen and Main menu returns to the title", async ({ page }) => {
  await page.goto(URL, { waitUntil: "load" });
  await expect(page.locator("canvas.game-canvas")).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => { (window as unknown as { __im: { state: { players: Array<{ defeated: boolean }> } } }).__im.state.players[1]!.defeated = true; });
  await expect(page.locator(".menu.overlay h1")).toContainText("MISSION ACCOMPLISHED", { timeout: 8000 });
  await expect(page.locator(".menu.overlay")).toContainText("Kills");
  await page.getByRole("button", { name: "Main menu" }).click();
  await expect(page.getByRole("button", { name: "Skirmish" })).toBeVisible();
});

test("defeat shows the failure screen", async ({ page }) => {
  await page.goto(URL, { waitUntil: "load" });
  await expect(page.locator("canvas.game-canvas")).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => { (window as unknown as { __im: { state: { players: Array<{ defeated: boolean }> } } }).__im.state.players[0]!.defeated = true; });
  await expect(page.locator(".menu.overlay h1")).toContainText("MISSION FAILED", { timeout: 8000 });
});
