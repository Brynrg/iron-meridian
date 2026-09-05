// Save/load and replay containers. A save is the full sim state as JSON; a
// replay is the seed + setup + ordered command log. Both are plain data so
// they survive localStorage and clipboard round-trips.

import type { Rules } from "../data/schemas";
import { createGrid } from "./grid";
import { deserializeMap, mapHeightLeptons, mapWidthLeptons, serializeMap, type MapData } from "./map";
import type { PlayerSetup } from "./state";
import type { Actor, Command, GameOptions, Player, SimState } from "./types";

export const SAVE_VERSION = 1;

export interface SaveFile {
  version: number;
  savedAt: number;
  label: string;
  tick: number;
  seed: number;
  rng: number;
  map: Record<string, unknown>;
  actors: Actor[];
  nextId: number;
  players: Player[];
  fog: string[]; // per player, run-length encoded
  phaseReturns: SimState["phaseReturns"];
  missionRt: SimState["mission"];
  crates: SimState["crates"];
  winner: number;
  finished: boolean;
  options: GameOptions;
  localPlayer: number;
  mission?: string;
}

export interface ReplayFile {
  version: number;
  seed: number;
  setups: PlayerSetup[];
  options: GameOptions;
  mapGen?: { width: number; height: number; players: number; waterAmount: number; oreAmount: number; seed: number };
  mapName?: string;
  mission?: string;
  commands: Array<{ tick: number; cmds: Command[] }>;
  finalTick: number;
  finalHash: number;
}

export function serializeState(state: SimState, label: string, localPlayer: number, mission?: string): SaveFile {
  const save: SaveFile = {
    version: SAVE_VERSION,
    savedAt: 0,
    label,
    tick: state.tick,
    seed: state.seed,
    rng: state.rng.state,
    map: serializeMap(state.map),
    actors: [...state.actors.values()].filter((a) => !a.dead),
    nextId: state.nextId,
    players: state.players,
    fog: state.fog.map(rle),
    phaseReturns: state.phaseReturns,
    missionRt: state.mission,
    crates: state.crates,
    winner: state.winner,
    finished: state.finished,
    options: state.options,
    localPlayer,
  };
  if (mission) save.mission = mission;
  return JSON.parse(JSON.stringify(save)) as SaveFile;
}

export function deserializeState(rules: Rules, save: SaveFile): SimState {
  if (save.version !== SAVE_VERSION) throw new Error(`unsupported save version ${save.version}`);
  const map: MapData = deserializeMap(save.map);
  const actors = new Map<number, Actor>();
  for (const a of save.actors) actors.set(a.id, a);
  const state: SimState = {
    tick: save.tick,
    seed: save.seed,
    rng: { state: save.rng },
    map,
    actors,
    actorList: [],
    nextId: save.nextId,
    players: save.players,
    fog: save.fog.map((s) => unrle(s, map.width * map.height)),
    grid: createGrid(mapWidthLeptons(map), mapHeightLeptons(map)),
    events: [],
    phaseReturns: save.phaseReturns ?? [],
    mission: save.missionRt ?? null,
    crates: save.crates ?? [],
    winner: save.winner,
    finished: save.finished,
    options: save.options,
    rules,
    hash: 0,
  };
  return state;
}

/** Run-length encode a byte array as "v*n,v*n,...". */
export function rle(arr: Uint8Array): string {
  const out: string[] = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i] as number;
    let n = 1;
    while (i + n < arr.length && arr[i + n] === v) n++;
    out.push(n === 1 ? String(v) : `${v}*${n}`);
    i += n;
  }
  return out.join(",");
}

export function unrle(s: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let i = 0;
  if (!s) return out;
  for (const part of s.split(",")) {
    const star = part.indexOf("*");
    const v = Number(star < 0 ? part : part.slice(0, star));
    const n = star < 0 ? 1 : Number(part.slice(star + 1));
    out.fill(v, i, i + n);
    i += n;
  }
  return out;
}
