import { describe, expect, it } from "vitest";
import { loadRules } from "../../src/data/rules";
import { generateMap } from "../../src/sim/mapgen";
import { DEFAULT_OPTIONS, createSkirmish, refreshActorList, stepSim } from "../../src/sim/index";
import { deserializeState, rle, serializeState, unrle } from "../../src/sim/serialize";
import type { SimState } from "../../src/sim/types";

const rules = loadRules();

function game(seed: number): SimState {
  const map = generateMap({ seed, width: 40, height: 40, players: 2, waterAmount: 0.3, oreAmount: 0.6 });
  return createSkirmish(
    rules,
    map,
    [
      { name: "A", faction: "alliance", color: "#38f", isAI: true, difficulty: "normal" },
      { name: "B", faction: "pact", color: "#f33", isAI: true, difficulty: "normal" },
    ],
    { ...DEFAULT_OPTIONS, crates: true },
    seed,
  );
}

describe("run-length fog encoding", () => {
  it("round-trips", () => {
    const a = new Uint8Array([0, 0, 0, 1, 2, 2, 0, 1, 1, 1, 1]);
    expect(unrle(rle(a), a.length)).toEqual(a);
    const big = new Uint8Array(5000).fill(1);
    big[100] = 2;
    expect(unrle(rle(big), big.length)).toEqual(big);
  });
});

describe("save / load", () => {
  it("a loaded save continues identically to the original game", () => {
    const original = game(2024);
    for (let i = 0; i < 900; i++) stepSim(original, []);
    const json = JSON.stringify(serializeState(original, "test", 0));
    expect(json.length).toBeGreaterThan(1000);
    const loaded = deserializeState(rules, JSON.parse(json));
    refreshActorList(loaded);
    expect(loaded.tick).toBe(original.tick);
    expect(loaded.actors.size).toBe(original.actors.size);
    for (let i = 0; i < 400; i++) {
      stepSim(original, []);
      stepSim(loaded, []);
    }
    expect(loaded.hash).toBe(original.hash);
    expect(loaded.players[0]!.credits).toBe(original.players[0]!.credits);
  });
});
