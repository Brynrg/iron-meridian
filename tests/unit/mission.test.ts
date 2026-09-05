import { describe, expect, it } from "vitest";
import { loadRules } from "../../src/data/rules";
import { generateMap } from "../../src/sim/mapgen";
import { createMission, stepSim } from "../../src/sim/index";
import { buildMission, CAMPAIGN, missionSpec } from "../../src/data/campaign";
import type { MissionDef } from "../../src/sim/mission";

const rules = loadRules();

function run(state: ReturnType<typeof createMission>, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepSim(state, []);
}

describe("campaign data", () => {
  it("has 14 missions per faction with unique ids and buildable definitions", () => {
    const alliance = CAMPAIGN.filter((m) => m.faction === "alliance");
    const pact = CAMPAIGN.filter((m) => m.faction === "pact");
    expect(alliance.length).toBe(14);
    expect(pact.length).toBe(14);
    expect(new Set(CAMPAIGN.map((m) => m.id)).size).toBe(28);
    for (const spec of CAMPAIGN) {
      const map = generateMap({ ...spec.map });
      const def = buildMission(spec, map);
      expect(def.objectives.length).toBeGreaterThan(0);
      for (const a of def.actors) expect(rules.units[a.type] ?? rules.structures[a.type], `${spec.id} actor ${a.type}`).toBeDefined();
      const state = createMission(rules, map, def);
      run(state, 60);
      expect(state.finished, `${spec.id} ended early: ${JSON.stringify(state.mission?.status)}`).toBe(false);
      expect(state.actors.size).toBeGreaterThan(3);
    }
  });
});

describe("mission engine", () => {
  it("a destroyStructures objective completes and wins the mission", () => {
    const spec = missionSpec("a01")!;
    const map = generateMap({ ...spec.map });
    const def = buildMission(spec, map);
    const state = createMission(rules, map, def);
    run(state, 40);
    // Remove every enemy structure as if destroyed.
    for (const a of [...state.actors.values()]) if (a.owner === 1 && a.kind === "structure") a.hp = 0;
    // Damage system only kills on damage; emulate by direct kill through combat helper path:
    const { killActor } = await_import();
    for (const a of [...state.actors.values()]) if (a.owner === 1 && a.kind === "structure") killActor(state, a);
    run(state, 25);
    expect(state.mission!.status.post).toBe("done");
    expect(state.finished).toBe(true);
    expect(state.winner).toBe(0);
  });

  it("a timer trigger fails a flag objective when it expires", () => {
    const base = missionSpec("a01")!;
    const map = generateMap({ ...base.map });
    const def: MissionDef = {
      ...buildMission(base, map),
      id: "test-timer",
      objectives: [{ id: "timer", kind: "flag", text: "Beat the clock" }, { id: "never", kind: "flag", text: "Unreachable" }],
      triggers: [{ id: "t", when: { kind: "start" }, actions: [{ kind: "timer", seconds: 2, label: "Clock" }] }],
    };
    const state = createMission(rules, map, def);
    run(state, 60);
    expect(state.mission!.status.timer).toBe("failed");
    expect(state.finished).toBe(true);
    expect(state.players[0]!.defeated).toBe(true);
  });

  it("reinforcements arrive from a time trigger", () => {
    const base = missionSpec("p01")!;
    const map = generateMap({ ...base.map });
    const start = map.starts[0]!;
    const def: MissionDef = {
      ...buildMission(base, map),
      id: "test-reinf",
      objectives: [{ id: "x", kind: "flag", text: "x" }],
      triggers: [{ id: "r", when: { kind: "time", seconds: 1 }, actions: [{ kind: "reinforce", owner: 0, units: [{ type: "heavytank", count: 3 }], tx: start.x, ty: start.y + 4 }] }],
    };
    const state = createMission(rules, map, def);
    const before = [...state.actors.values()].filter((a) => a.owner === 0 && a.type === "heavytank").length;
    run(state, 40);
    const after = [...state.actors.values()].filter((a) => a.owner === 0 && a.type === "heavytank").length;
    expect(after - before).toBe(3);
  });
});

function await_import(): typeof import("../../src/sim/state") {
  // Static import kept at bottom for readability of the test body.
  return stateModule;
}
import * as stateModule from "../../src/sim/state";
