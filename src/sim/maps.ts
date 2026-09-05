// Map pool and the authored map format.
//
// Authored maps are ASCII rows, one character per cell:
//   .  clear      ,  rough      =  road      ~  water     :  beach
//   ^  cliff      T  tree       #  rock      -  bridge
//   o  ore        O  ore mine (regrows)      g  gems
//   1..4 player start (cell is clear)
// Generated maps are named presets over the procedural generator so the pool
// has variety without hand-painting every cell.

import { generateMap, type MapGenOptions } from "./mapgen";
import { type MapData, Terrain, createMap, idx, ORE_PER_CELL_MAX } from "./map";

export interface MapEntry {
  id: string;
  name: string;
  players: number;
  size: string;
  gen?: Omit<MapGenOptions, "seed" | "players"> & { seed: number };
  ascii?: string[];
  neutrals?: Array<{ type: string; tx: number; ty: number }>;
}

export function parseAsciiMap(name: string, rows: string[]): MapData {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const m = createMap(name, width, height);
  m.terrain.fill(Terrain.Clear);
  for (let y = 0; y < height; y++) {
    const row = rows[y] as string;
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? "^";
      const i = idx(m, x, y);
      let t: Terrain = Terrain.Clear;
      switch (ch) {
        case ",":
          t = Terrain.Rough;
          break;
        case "=":
          t = Terrain.Road;
          break;
        case "~":
          t = Terrain.Water;
          break;
        case ":":
          t = Terrain.Beach;
          break;
        case "^":
          t = Terrain.Cliff;
          break;
        case "T":
          t = Terrain.Tree;
          break;
        case "#":
          t = Terrain.Rock;
          break;
        case "-":
          t = Terrain.Bridge;
          break;
        case "o":
          m.ore[i] = Math.round(ORE_PER_CELL_MAX * 0.6);
          break;
        case "O":
          m.ore[i] = ORE_PER_CELL_MAX;
          m.oreMine[i] = 1;
          break;
        case "g":
          m.ore[i] = Math.round(ORE_PER_CELL_MAX * 0.5);
          m.gems[i] = 1;
          break;
        default:
          if (ch >= "1" && ch <= "8") {
            const n = Number(ch) - 1;
            while (m.starts.length <= n) m.starts.push({ x: 0, y: 0 });
            m.starts[n] = { x, y };
          }
      }
      m.terrain[i] = t;
    }
  }
  // Border is always cliff so nothing walks off the edge.
  for (let x = 0; x < width; x++) {
    m.terrain[idx(m, x, 0)] = Terrain.Cliff;
    m.terrain[idx(m, x, height - 1)] = Terrain.Cliff;
  }
  for (let y = 0; y < height; y++) {
    m.terrain[idx(m, 0, y)] = Terrain.Cliff;
    m.terrain[idx(m, width - 1, y)] = Terrain.Cliff;
  }
  return m;
}

/** Build the MapData for a pool entry. */
export function buildMap(entry: MapEntry, players: number): MapData {
  if (entry.ascii) return parseAsciiMap(entry.name, entry.ascii);
  const g = entry.gen ?? { seed: 1, width: 64, height: 64, waterAmount: 0.3, oreAmount: 0.6 };
  return generateMap({ ...g, players: Math.max(entry.players, players) });
}

// A compact hand-authored 1v1 map: two plateaus, a river with two bridges, and
// contested gems in the middle.
const RIVER_CROSSING: string[] = [
  "^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
  "^..........TT...........................TT.....^",
  "^.....1.....T..........................T.......^",
  "^..............,,,......................,,.....^",
  "^....OOo........,,,.....................,......^",
  "^....Ooo.........,.............................^",
  "^....oo...........................T............^",
  "^.................................TT...........^",
  "^..........T....................................^",
  "^..........TT....==============================^",
  "^................=.............................^",
  "^................=...........................,,^",
  "^.......:::::::::=:::::::::::::::::::::::::::..^",
  "^......::~~~~~~~~-~~~~~~~~~~~~~~~~~~~~~~~~~~::.^",
  "^......:~~~~~~~~~-~~~~~~~~~~~~~~~~~~~~~~~~~~~:.^",
  "^......:~~~~~~~~~-~~~~~~~~~~~~~~~~~~~~-~~~~~~:.^",
  "^......::~~~~~~~~~~~~~~~~~~~~~~~~~~~~~-~~~~~~:.^",
  "^.......::::::::::::::::::::::::::::::-::::::..^",
  "^.....................................=........^",
  "^..............gg.....................=........^",
  "^.............ggg.....................=........^",
  "^..............g......................=........^",
  "^..........,,.........................=........^",
  "^..........,,.........................=........^",
  "^.....................................=........^",
  "^....==================================........^",
  "^....=.........................................^",
  "^....=..............T..........................^",
  "^....=..............TT.........................^",
  "^....=.........................................^",
  "^....=.........................................^",
  "^....=.......................................oo^",
  "^....=......................................ooO^",
  "^....=.......................................OO^",
  "^............................................o.^",
  "^.............................2................^",
  "^......TT......................................^",
  "^.......T......................................^",
  "^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
];

// Four-player cross: a rocky centre with gems, each corner has an ore field.
const CROSSFIRE: string[] = [
  "^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
  "^...............................T.....................^",
  "^....1..........................T.................2...^",
  "^.......................TT............................^",
  "^..Ooo.................................TT........oOO..^",
  "^..oo.....................................T.......oo..^",
  "^.....................,,,,............................^",
  "^....................,,,,,,...........................^",
  "^.....................,,,,,,..........................^",
  "^............T.........,,,,.........T.................^",
  "^............TT.....................TT................^",
  "^.....................................................^",
  "^..........................###........................^",
  "^........................###g###......................^",
  "^.......................##ggggg##.....................^",
  "^.......................#ggg###gg#....................^",
  "^........................##ggg##......................^",
  "^..........................###........................^",
  "^.....................................................^",
  "^.....................................................^",
  "^..............TT.....................T...............^",
  "^...............T.....................TT..............^",
  "^.....................,,,,,...........................^",
  "^....................,,,,,,,..........................^",
  "^.....................,,,,,...........................^",
  "^..oo.............................................oo..^",
  "^..ooO..............TT............................Ooo.^",
  "^...................T.................................^",
  "^....3..............................T.............4...^",
  "^...................................TT................^",
  "^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
];

export const MAP_POOL: MapEntry[] = [
  { id: "river-crossing", name: "River Crossing", players: 2, size: "48×39", ascii: RIVER_CROSSING },
  { id: "crossfire", name: "Crossfire", players: 4, size: "56×31", ascii: CROSSFIRE },
  { id: "meridian-plain", name: "Meridian Plain", players: 2, size: "48", gen: { seed: 101, width: 48, height: 48, waterAmount: 0.0, oreAmount: 0.5 } },
  { id: "frozen-lake", name: "Frozen Lake", players: 2, size: "64", gen: { seed: 202, width: 64, height: 64, waterAmount: 0.6, oreAmount: 0.6 } },
  { id: "ural-foothills", name: "Ural Foothills", players: 2, size: "64", gen: { seed: 303, width: 64, height: 64, waterAmount: 0.15, oreAmount: 0.8 } },
  { id: "the-wash", name: "The Wash", players: 2, size: "80", gen: { seed: 404, width: 80, height: 80, waterAmount: 0.75, oreAmount: 0.5 } },
  { id: "black-forest", name: "Black Forest", players: 2, size: "64", gen: { seed: 505, width: 64, height: 64, waterAmount: 0.1, oreAmount: 0.7 } },
  { id: "checkpoint", name: "Checkpoint", players: 2, size: "48", gen: { seed: 606, width: 48, height: 48, waterAmount: 0.3, oreAmount: 0.9 } },
  { id: "salt-flats", name: "Salt Flats", players: 3, size: "72", gen: { seed: 707, width: 72, height: 72, waterAmount: 0.05, oreAmount: 0.6 } },
  { id: "three-rivers", name: "Three Rivers", players: 3, size: "80", gen: { seed: 808, width: 80, height: 80, waterAmount: 0.55, oreAmount: 0.6 } },
  { id: "iron-square", name: "Iron Square", players: 4, size: "80", gen: { seed: 909, width: 80, height: 80, waterAmount: 0.25, oreAmount: 0.7 } },
  { id: "archipelago", name: "Archipelago", players: 4, size: "96", gen: { seed: 1010, width: 96, height: 96, waterAmount: 0.8, oreAmount: 0.6 } },
  { id: "tundra", name: "Tundra", players: 4, size: "96", gen: { seed: 1111, width: 96, height: 96, waterAmount: 0.2, oreAmount: 0.5 } },
  { id: "gem-basin", name: "Gem Basin", players: 4, size: "80", gen: { seed: 1212, width: 80, height: 80, waterAmount: 0.3, oreAmount: 1.0 } },
  { id: "continental", name: "Continental Divide", players: 4, size: "112", gen: { seed: 1313, width: 112, height: 112, waterAmount: 0.4, oreAmount: 0.7 } },
  { id: "grand-front", name: "Grand Front", players: 4, size: "128", gen: { seed: 1414, width: 128, height: 128, waterAmount: 0.35, oreAmount: 0.8 } },
];

export function mapById(id: string): MapEntry | undefined {
  return MAP_POOL.find((m) => m.id === id);
}
