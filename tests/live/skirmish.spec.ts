import { test, expect, type Page } from "@playwright/test";

// Liveness gate for milestone 0.2/0.3: the game boots straight into a
// skirmish, the sim advances, the player's MCV deploys, a structure is built
// and placed through the real command path, and an ore truck raises credits.

const URL = "http://localhost:4173/?autostart=1&seed=4242&ai=easy&size=48&shroud=0";

interface DebugState {
  tick: number;
  credits: number;
  ore: number;
  storage: number;
  yard: boolean;
  power: number;
  refinery: boolean;
  trucks: number;
  harvested: number;
  ready: boolean;
  yardTile: [number, number] | null;
  hash: number;
}

async function snapshot(page: Page): Promise<DebugState> {
  return page.evaluate(() => {
    const im = (window as unknown as { __im: { state: { tick: number; players: Array<{ credits: number; ore: number; storage: number; stats: { harvested: number }; powerSupply: number; queues: { building: { ready: boolean } } }>; actors: Map<number, { owner: number; type: string; tx: number; ty: number; kind: string }>; hash: number } } }).__im;
    const s = im.state;
    const p = s.players[0]!;
    let yard = false;
    let refinery = false;
    let trucks = 0;
    let yardTile: [number, number] | null = null;
    for (const a of s.actors.values()) {
      if (a.owner !== 0) continue;
      if (a.type === "conyard") {
        yard = true;
        yardTile = [a.tx, a.ty];
      }
      if (a.type === "refinery") refinery = true;
      if (a.type === "oretruck") trucks++;
    }
    return { tick: s.tick, credits: p.credits, ore: p.ore, storage: p.storage, yard, power: p.powerSupply, refinery, trucks, harvested: p.stats.harvested, ready: p.queues.building.ready, yardTile, hash: s.hash };
  });
}

async function issue(page: Page, cmd: Record<string, unknown>): Promise<void> {
  await page.evaluate((c) => (window as unknown as { __im: { issue: (c: unknown) => void } }).__im.issue(c), cmd);
}

/** Queue an item, retrying until the sim accepts it (a yard must finish building up first). */
async function queueUntilAccepted(page: Page, queue: string, type: string): Promise<void> {
  const start = Date.now();
  for (;;) {
    const before = await snapshot(page);
    await issue(page, { kind: "queue", queue, type });
    await page.waitForTimeout(300);
    const after = await snapshot(page);
    if (after.credits < before.credits || after.ready) return;
    if (Date.now() - start > 10000) throw new Error(`queue ${type} never accepted: ${JSON.stringify(after)}`);
  }
}

async function waitFor(page: Page, pred: (s: DebugState) => boolean, timeoutMs: number, label: string): Promise<DebugState> {
  const start = Date.now();
  let last = await snapshot(page);
  while (!pred(last)) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}: ${JSON.stringify(last)}`);
    await page.waitForTimeout(200);
    last = await snapshot(page);
  }
  return last;
}

test("skirmish boots, sim ticks, MCV deploys, power + refinery build, ore truck earns credits", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(URL, { waitUntil: "load" });
  await expect(page.locator("canvas.game-canvas")).toBeVisible({ timeout: 3000 });
  await expect(page.locator(".sidebar")).toBeVisible();

  const s0 = await snapshot(page);
  await page.waitForTimeout(1000);
  const s1 = await snapshot(page);
  expect(s1.tick).toBeGreaterThan(s0.tick + 10); // ~20 ticks/s

  // Speed the sim up for the gate (same code path as the +/- keys).
  await page.evaluate(() => ((window as unknown as { __im: { view: { speed: number } } }).__im.view.speed = 4));

  // Deploy the MCV via the real key handler.
  const mcvId = await page.evaluate(() => {
    const im = (window as unknown as { __im: { state: { actors: Map<number, { owner: number; type: string; id: number }> } } }).__im;
    for (const a of im.state.actors.values()) if (a.owner === 0 && a.type === "mcv") return a.id;
    return -1;
  });
  expect(mcvId).toBeGreaterThan(0);
  await issue(page, { kind: "deploy", actors: [mcvId] });
  const s2 = await waitFor(page, (s) => s.yard, 5000, "conyard");
  expect(s2.yardTile).not.toBeNull();

  // Queue a power plant, wait until ready, place it next to the yard.
  await queueUntilAccepted(page, "building", "power");
  await waitFor(page, (s) => s.ready, 15000, "power ready");
  const [yx, yy] = s2.yardTile as [number, number];
  await issue(page, { kind: "place", type: "power", tx: yx + 4, ty: yy });
  const s3 = await waitFor(page, (s) => s.power >= 100, 8000, "power supply");
  expect(s3.power).toBe(100);

  // Refinery: ships with a truck; harvested credits must rise.
  await queueUntilAccepted(page, "building", "refinery");
  await waitFor(page, (s) => s.ready, 30000, "refinery ready");
  await issue(page, { kind: "place", type: "refinery", tx: yx, ty: yy + 4 });
  const s4 = await waitFor(page, (s) => s.refinery && s.trucks >= 1 && s.storage >= 2000, 8000, "refinery + truck + storage");
  expect(s4.storage).toBe(2000);
  const s5 = await waitFor(page, (s) => s.harvested > 0, 60000, "first harvest");
  expect(s5.ore).toBeGreaterThan(0);

  // Screenshot proves pixels, not just state.
  const shot = await page.locator("canvas.game-canvas").screenshot();
  expect(shot.byteLength).toBeGreaterThan(10000);
  expect(errors, `console errors:\n${errors.join("\n")}`).toEqual([]);
});

test("sidebar build button queues and the credits ticker moves", async ({ page }) => {
  await page.goto(URL, { waitUntil: "load" });
  await expect(page.locator("canvas.game-canvas")).toBeVisible({ timeout: 3000 });
  const mcvId = await page.evaluate(() => {
    const im = (window as unknown as { __im: { state: { actors: Map<number, { owner: number; type: string; id: number }> } } }).__im;
    for (const a of im.state.actors.values()) if (a.owner === 0 && a.type === "mcv") return a.id;
    return -1;
  });
  await issue(page, { kind: "deploy", actors: [mcvId] });
  await waitFor(page, (s) => s.yard, 5000, "conyard");
  const btn = page.locator('.build-btn[data-key="building:power"]');
  await expect(btn).toBeVisible({ timeout: 4000 });
  const before = await snapshot(page);
  await btn.click();
  await page.waitForTimeout(1500);
  const after = await snapshot(page);
  expect(after.credits).toBeLessThan(before.credits);
  await expect(page.locator(".credits")).not.toHaveText(String(Math.floor(before.credits)));
});
