import { test, expect, type Page } from "@playwright/test";

// Campaign + save/load gates: a mission boots with its objectives panel, the
// scripted start trigger fires, quick save + quick load restore the same tick,
// and the replay/menu surfaces exist.

const BASE = "http://localhost:4173/";

async function tickOf(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __im: { state: { tick: number } } }).__im.state.tick);
}

test("mission a01 boots with objectives, start message, and scripted actors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}?autostart=1&mission=a01`, { waitUntil: "load" });
  await expect(page.locator("canvas.game-canvas")).toBeVisible({ timeout: 3000 });
  await expect(page.locator(".objectives")).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".objectives")).toContainText("Destroy the Pact listening post");
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => {
    const im = (window as unknown as { __im: { state: { tick: number; mission: { status: Record<string, string>; fired: string[] }; actors: Map<number, { owner: number; type: string }> } } }).__im;
    let mine = 0;
    let theirs = 0;
    for (const a of im.state.actors.values()) {
      if (a.owner === 0) mine++;
      if (a.owner === 1) theirs++;
    }
    return { tick: im.state.tick, fired: im.state.mission.fired, status: im.state.mission.status, mine, theirs };
  });
  expect(info.tick).toBeGreaterThan(10);
  expect(info.fired).toContain("startMsg");
  expect(info.status.post).toBe("active");
  expect(info.mine).toBeGreaterThanOrEqual(9); // 6 rifles + medic + 2 rangers
  expect(info.theirs).toBeGreaterThanOrEqual(8);
  expect(errors).toEqual([]);
});

test("quick save and quick load round-trip through localStorage", async ({ page }) => {
  await page.goto(`${BASE}?autostart=1&seed=77&ai=easy&size=48`, { waitUntil: "load" });
  await expect(page.locator("canvas.game-canvas")).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(800);
  const t1 = await tickOf(page);
  await page.evaluate(() => (window as unknown as { __im: { save: (s: number) => void } }).__im.save(3));
  const stored = await page.evaluate(() => localStorage.getItem("speedrungames:iron-meridian:save:3"));
  expect(stored).not.toBeNull();
  expect((stored as string).length).toBeGreaterThan(1000);
  await page.waitForTimeout(1500);
  const t2 = await tickOf(page);
  expect(t2).toBeGreaterThan(t1 + 10);
  await page.evaluate(() => (window as unknown as { __im: { load: (s: number) => void } }).__im.load(3));
  await page.waitForTimeout(300);
  const t3 = await tickOf(page);
  expect(t3).toBeLessThan(t2);
  expect(t3).toBeGreaterThanOrEqual(t1);
  await expect(page.locator(".sidebar")).toBeVisible();
});

test("main menu exposes skirmish, campaign, multiplayer, load, replay, options, controls", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "load" });
  for (const label of ["Skirmish", "Campaign", "Multiplayer", "Load game", "Watch last replay", "Options", "Controls"]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }
  await page.getByRole("button", { name: "Campaign" }).click();
  await expect(page.locator(".mission-btn")).toHaveCount(28);
  await page.locator('.mission-btn[data-id="p01"]').click();
  await expect(page.locator(".briefing")).toContainText("observation post");
  await page.getByRole("button", { name: "Begin mission" }).click();
  await expect(page.locator(".objectives")).toBeVisible({ timeout: 5000 });
});
