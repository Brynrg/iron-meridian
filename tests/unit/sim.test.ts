import { describe, expect, it } from "vitest";
import { loadRules } from "../../src/data/rules";
import { generateMap } from "../../src/sim/mapgen";
import { DEFAULT_OPTIONS, computeHash, createSkirmish, stepSim } from "../../src/sim/index";
import type { Command, SimState } from "../../src/sim/types";
import { tileToWorldCenter } from "../../src/sim/coords";
import { SIM_TICK_RATE } from "../../src/sim/loop";
import { spawnStructure, spawnUnit } from "../../src/sim/state";

const rules = loadRules();

function newGame(seed = 1234, ai = true): SimState {
  const map = generateMap({ seed, width: 48, height: 48, players: 2, waterAmount: 0.3, oreAmount: 0.6 });
  return createSkirmish(
    rules,
    map,
    [
      { name: "P1", faction: "alliance", color: "#3a7bd5", isAI: false },
      { name: "P2", faction: "pact", color: "#d53a3a", isAI: ai, difficulty: "normal" },
    ],
    { ...DEFAULT_OPTIONS, startingCredits: 5000 },
    seed,
  );
}

function run(state: SimState, ticks: number, cmds: (t: number) => Command[] = () => []): void {
  for (let i = 0; i < ticks; i++) stepSim(state, cmds(state.tick));
}

describe("rules data", () => {
  it("loads and cross-references cleanly", () => {
    expect(Object.keys(rules.units).length).toBeGreaterThan(30);
    expect(Object.keys(rules.structures).length).toBeGreaterThan(25);
    expect(rules.weapons.rifle?.warhead).toBe("sa");
  });
});

describe("determinism", () => {
  it("two runs with the same seed and commands produce identical hashes", () => {
    const a = newGame(77);
    const b = newGame(77);
    const cmds = (t: number): Command[] => (t === 5 ? [{ player: 0, kind: "deploy", actors: [1] }] : []);
    run(a, 600, cmds);
    run(b, 600, cmds);
    expect(a.hash).toBe(b.hash);
    expect(computeHash(a)).toBe(computeHash(b));
    expect(a.actors.size).toBe(b.actors.size);
  });

  it("different seeds diverge", () => {
    const a = newGame(1);
    const b = newGame(2);
    run(a, 100);
    run(b, 100);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("economy", () => {
  it("MCV deploys into a Construction Yard and the refinery ships a truck that raises credits", () => {
    const s = newGame(99, false);
    const mcv = [...s.actors.values()].find((a) => a.owner === 0 && a.type === "mcv");
    expect(mcv).toBeDefined();
    run(s, 1, () => [{ player: 0, kind: "deploy", actors: [mcv!.id] }]);
    const yard = [...s.actors.values()].find((a) => a.owner === 0 && a.type === "conyard");
    expect(yard).toBeDefined();
    // Build a power plant then a refinery via the sidebar queue.
    run(s, 60); // let buildup finish
    run(s, 1, () => [{ player: 0, kind: "queue", queue: "building", type: "power" }]);
    run(s, 8 * SIM_TICK_RATE + 20);
    expect(s.players[0]!.queues.building.ready).toBe(true);
    const px = yard!.tx + 4;
    const py = yard!.ty;
    run(s, 1, () => [{ player: 0, kind: "place", type: "power", tx: px, ty: py }]);
    expect([...s.actors.values()].some((a) => a.type === "power" && a.owner === 0)).toBe(true);
    run(s, 60);
    run(s, 1, () => [{ player: 0, kind: "queue", queue: "building", type: "refinery" }]);
    run(s, 20 * SIM_TICK_RATE + 40);
    expect(s.players[0]!.queues.building.ready).toBe(true);
    const creditsBefore = s.players[0]!.credits;
    run(s, 1, () => [{ player: 0, kind: "place", type: "refinery", tx: yard!.tx, ty: yard!.ty + 4 }]);
    const truck = [...s.actors.values()].find((a) => a.owner === 0 && a.type === "oretruck");
    expect(truck).toBeDefined();
    // Give the truck time to find ore, fill, and unload at least once.
    run(s, 20 * SIM_TICK_RATE * 6);
    expect(s.players[0]!.stats.harvested).toBeGreaterThan(0);
    expect(s.players[0]!.credits).toBeGreaterThan(creditsBefore - 2000 + 200);
    expect(truck!.harvester!.state).not.toBe("idle");
  });

  it("power supply and drain are tallied from structures", () => {
    const s = newGame(5, false);
    const mcv = [...s.actors.values()].find((a) => a.owner === 0 && a.type === "mcv")!;
    run(s, 1, () => [{ player: 0, kind: "deploy", actors: [mcv.id] }]);
    run(s, 60);
    const yard = [...s.actors.values()].find((a) => a.owner === 0 && a.type === "conyard")!;
    run(s, 1, () => [{ player: 0, kind: "queue", queue: "building", type: "power" }]);
    run(s, 8 * SIM_TICK_RATE + 20);
    run(s, 1, () => [{ player: 0, kind: "place", type: "power", tx: yard.tx + 4, ty: yard.ty }]);
    run(s, 60);
    expect(s.players[0]!.powerSupply).toBe(100);
  });
});

describe("combat", () => {
  it("a heavy tank destroys a rifle squad and a rifle squad cannot easily kill a tank", () => {
    const s = newGame(11, false);
    // Remove starting units so only the test actors matter.
    for (const a of [...s.actors.values()]) s.actors.delete(a.id);
    spawnStructure(s, "conyard", 0, 2, 2, 1);
    spawnStructure(s, "conyard", 1, 40, 40, 1);
    const tank = spawnUnit(s, "heavytank", 1, tileToWorldCenter(20), tileToWorldCenter(20));
    const rifles = [0, 1, 2].map((i) => spawnUnit(s, "rifle", 0, tileToWorldCenter(23 + i), tileToWorldCenter(20)));
    run(s, 1, () => [{ player: 1, kind: "attackMove", actors: [tank.id], x: tileToWorldCenter(24), y: tileToWorldCenter(20), queue: false }]);
    run(s, 20 * 60);
    const aliveRifles = rifles.filter((r) => !r.dead).length;
    expect(aliveRifles).toBe(0);
    expect(tank.dead).toBe(false);
    expect(tank.hp).toBeGreaterThan(tank.maxHp * 0.5);
  });

  it("rocket soldiers out-trade a light tank per credit", () => {
    const s = newGame(12, false);
    for (const a of [...s.actors.values()]) s.actors.delete(a.id);
    spawnStructure(s, "conyard", 0, 2, 2, 1);
    spawnStructure(s, "conyard", 1, 40, 40, 1);
    const tank = spawnUnit(s, "lighttank", 1, tileToWorldCenter(20), tileToWorldCenter(20));
    const rockets = [0, 1, 2].map((i) => spawnUnit(s, "rocket", 0, tileToWorldCenter(24), tileToWorldCenter(19 + i)));
    run(s, 1, () => [{ player: 1, kind: "attackMove", actors: [tank.id], x: tileToWorldCenter(24), y: tileToWorldCenter(20), queue: false }]);
    run(s, 20 * 40);
    expect(tank.dead).toBe(true);
    expect(rockets.some((r) => !r.dead)).toBe(true);
  });
});

describe("AI skirmish", () => {
  it("AI vs AI runs 4 sim-minutes without errors, builds a base, and produces an army", () => {
    const map = generateMap({ seed: 31337, width: 56, height: 56, players: 2, waterAmount: 0.3, oreAmount: 0.7 });
    const s = createSkirmish(
      rules,
      map,
      [
        { name: "A", faction: "alliance", color: "#38f", isAI: true, difficulty: "hard" },
        { name: "B", faction: "pact", color: "#f33", isAI: true, difficulty: "hard" },
      ],
      { ...DEFAULT_OPTIONS, startingCredits: 10000 },
      31337,
    );
    run(s, SIM_TICK_RATE * 240);
    const structuresA = [...s.actors.values()].filter((a) => a.owner === 0 && a.kind === "structure").length;
    const structuresB = [...s.actors.values()].filter((a) => a.owner === 1 && a.kind === "structure").length;
    expect(structuresA).toBeGreaterThanOrEqual(5);
    expect(structuresB).toBeGreaterThanOrEqual(5);
    const armed = [...s.actors.values()].filter((a) => a.kind === "unit" && (rules.units[a.type]?.weapons.length ?? 0) > 0);
    expect(armed.length).toBeGreaterThan(6);
    expect(s.players[0]!.stats.harvested + s.players[1]!.stats.harvested).toBeGreaterThan(1000);
  });
});
