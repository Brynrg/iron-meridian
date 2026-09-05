import { describe, expect, it } from "vitest";
import { buildMap, MAP_POOL, parseAsciiMap } from "../../src/sim/maps";
import { Terrain, idx, isPassable } from "../../src/sim/map";
import { findPath } from "../../src/sim/pathfind";

describe("map pool", () => {
  it("has at least 16 maps and every entry builds with the right number of starts", () => {
    expect(MAP_POOL.length).toBeGreaterThanOrEqual(16);
    for (const e of MAP_POOL) {
      const m = buildMap(e, e.players);
      expect(m.starts.length, e.id).toBeGreaterThanOrEqual(e.players);
      for (const s of m.starts) expect(isPassable(m, s.x, s.y, "track"), `${e.id} start ${s.x},${s.y}`).toBe(true);
    }
  });

  it("authored maps parse terrain, ore, gems, and starts; the two starts are connected by land", () => {
    const e = MAP_POOL.find((m) => m.id === "river-crossing")!;
    const m = parseAsciiMap(e.name, e.ascii!);
    expect(m.starts.length).toBe(2);
    let water = 0;
    let ore = 0;
    let gems = 0;
    let bridge = 0;
    for (let i = 0; i < m.terrain.length; i++) {
      if (m.terrain[i] === Terrain.Water) water++;
      if (m.terrain[i] === Terrain.Bridge) bridge++;
      if ((m.ore[i] as number) > 0) ore++;
      if (m.gems[i]) gems++;
    }
    expect(water).toBeGreaterThan(50);
    expect(bridge).toBe(6);
    expect(ore).toBeGreaterThan(10);
    expect(gems).toBeGreaterThan(3);
    const [a, b] = m.starts as [{ x: number; y: number }, { x: number; y: number }];
    const path = findPath(m, a.x, a.y, b.x, b.y, "track");
    expect(path.length).toBeGreaterThan(20);
    const last = path[path.length - 1]!;
    expect(last).toEqual([b.x, b.y]);
    expect(m.terrain[idx(m, 0, 0)]).toBe(Terrain.Cliff);
  });
});
