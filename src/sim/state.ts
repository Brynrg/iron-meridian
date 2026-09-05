// Simulation state construction and the shared helpers every system uses:
// spawning, lookup, ownership, prerequisites, events.

import { LEPTONS_PER_CELL, cellsToLeptons, tileToWorldCenter, worldToTile } from "./coords";
import { createGrid } from "./grid";
import { type MapData, clearOccupancy, isBuildable, mapHeightLeptons, mapWidthLeptons, setGate, setOccupancy, inBounds, idx, Terrain } from "./map";
import { createRng } from "./rng";
import { findPath } from "./pathfind";
import type { FactionId, QueueKind, Rules, StructureDef, UnitDef } from "../data/schemas";
import type { Actor, GameOptions, Player, ProductionQueue, SimEvent, SimState } from "./types";

export const QUEUE_KINDS: QueueKind[] = ["building", "defense", "infantry", "vehicle", "aircraft", "ship"];

export interface PlayerSetup {
  name: string;
  faction: FactionId;
  color: string;
  isAI: boolean;
  difficulty?: "easy" | "normal" | "hard";
  team?: number;
}

function emptyQueue(): ProductionQueue {
  return { items: [], hold: false, ready: false };
}

export function createPlayer(id: number, s: PlayerSetup, credits: number): Player {
  return {
    id,
    name: s.name,
    faction: s.faction,
    color: s.color,
    isAI: s.isAI,
    difficulty: s.difficulty ?? "normal",
    team: s.team ?? id,
    credits,
    ore: 0,
    storage: 0,
    powerSupply: 0,
    powerDrain: 0,
    alive: true,
    defeated: false,
    queues: {
      building: emptyQueue(),
      defense: emptyQueue(),
      infantry: emptyQueue(),
      vehicle: emptyQueue(),
      aircraft: emptyQueue(),
      ship: emptyQueue(),
    },
    radarActive: false,
    gps: false,
    discovered: [],
    stats: { built: 0, lost: 0, kills: 0, harvested: 0 },
    superweapons: {},
    ai: s.isAI
      ? {
          phase: 0,
          nextThinkTick: 0,
          attackWaveAt: 0,
          rallyX: 0,
          rallyY: 0,
          targetX: -1,
          targetY: -1,
          attacking: false,
          lastBaseAttackTick: -100000,
          buildOrderIdx: 0,
          failedPlacements: 0,
          blocked: [],
          blockedClearTick: 0,
        }
      : null,
  };
}

export function createSim(rules: Rules, map: MapData, setups: PlayerSetup[], options: GameOptions, seed: number): SimState {
  const players = setups.map((s, i) => createPlayer(i, s, options.startingCredits));
  const state: SimState = {
    tick: 0,
    seed,
    rng: createRng(seed),
    map,
    actors: new Map(),
    actorList: [],
    nextId: 1,
    players,
    fog: players.map(() => new Uint8Array(map.width * map.height).fill(options.shroud ? 0 : 1)),
    grid: createGrid(mapWidthLeptons(map), mapHeightLeptons(map)),
    events: [],
    phaseReturns: [],
    mission: null,
    crates: [],
    winner: -1,
    finished: false,
    options,
    rules,
    hash: 0,
  };
  return state;
}

/** Spend credits, consuming harvested ore before cash (classic behaviour). */
export function spend(p: Player, amount: number): void {
  p.credits -= amount;
  p.ore = Math.max(0, Math.min(p.ore - amount, p.credits));
}

export function emit(state: SimState, ev: SimEvent): void {
  state.events.push(ev);
}

export function unitDef(state: SimState, type: string): UnitDef | undefined {
  return state.rules.units[type];
}

export function structDef(state: SimState, type: string): StructureDef | undefined {
  return state.rules.structures[type];
}

export function getActor(state: SimState, id: number): Actor | undefined {
  const a = state.actors.get(id);
  return a && !a.dead ? a : undefined;
}

export function isEnemy(state: SimState, a: Actor, b: Actor): boolean {
  if (a.owner === b.owner) return false;
  if (a.owner < 0 || b.owner < 0) return false; // neutrals are never enemies
  const pa = state.players[a.owner];
  const pb = state.players[b.owner];
  if (!pa || !pb) return false;
  return pa.team !== pb.team;
}

export function isAlly(state: SimState, ownerA: number, ownerB: number): boolean {
  if (ownerA === ownerB) return true;
  const pa = state.players[ownerA];
  const pb = state.players[ownerB];
  return !!pa && !!pb && pa.team === pb.team;
}

function baseActor(state: SimState, type: string, owner: number, x: number, y: number): Actor {
  return {
    id: state.nextId++,
    type,
    kind: "unit",
    owner,
    x,
    y,
    facing: 0,
    turretFacing: 0,
    hp: 1,
    maxHp: 1,
    loco: "none",
    speed: 0,
    order: { kind: "idle" },
    queuedOrders: [],
    stance: "aggressive",
    path: null,
    pathIdx: 0,
    moveGoal: null,
    repathTimer: 0,
    stuckTicks: 0,
    target: -1,
    cooldown: [],
    burstLeft: [],
    harvester: null,
    cargo: [],
    inside: -1,
    prone: false,
    cloaked: false,
    ammo: 0,
    lastFiredTick: -100000,
    revealedUntil: 0,
    guardX: x,
    guardY: y,
    tx: 0,
    ty: 0,
    w: 0,
    h: 0,
    buildup: 1,
    rally: null,
    primary: false,
    repairing: false,
    selling: false,
    sellTimer: 0,
    charge: 0,
    disabled: false,
    captureProgress: 0,
    proj: null,
    huskTtl: 0,
    dead: false,
    lastDamagedTick: -100000,
    lastAttacker: -1,
    kills: 0,
    spawnedTick: state.tick,
  };
}

export function spawnUnit(state: SimState, type: string, owner: number, x: number, y: number, facing = 0): Actor {
  const def = state.rules.units[type];
  if (!def) throw new Error(`unknown unit ${type}`);
  const a = baseActor(state, type, owner, x, y);
  a.kind = "unit";
  a.hp = def.hp;
  a.maxHp = def.hp;
  a.loco = def.loco;
  a.speed = (def.speed * LEPTONS_PER_CELL) / 20; // cells/s -> leptons/tick at 20 Hz
  a.facing = facing;
  a.turretFacing = facing;
  a.cooldown = def.weapons.map(() => 0);
  a.burstLeft = def.weapons.map(() => 0);
  a.cloaked = def.cloaked;
  a.ammo = def.class === "aircraft" ? def.ammo : def.minelayer ? 5 : 0;
  if (def.harvester) a.harvester = { cargo: 0, gems: 0, state: "idle", refinery: -1, fieldX: -1, fieldY: -1, avoid: [] };
  state.actors.set(a.id, a);
  return a;
}

export function spawnStructure(state: SimState, type: string, owner: number, tx: number, ty: number, buildup = 0): Actor {
  const def = state.rules.structures[type];
  if (!def) throw new Error(`unknown structure ${type}`);
  const [w, h] = def.footprint;
  const cx = tx * LEPTONS_PER_CELL + (w * LEPTONS_PER_CELL) / 2;
  const cy = ty * LEPTONS_PER_CELL + (h * LEPTONS_PER_CELL) / 2;
  const a = baseActor(state, type, owner, Math.round(cx), Math.round(cy));
  a.kind = "structure";
  a.hp = def.hp;
  a.maxHp = def.hp;
  a.tx = tx;
  a.ty = ty;
  a.w = w;
  a.h = h;
  a.buildup = buildup;
  a.cooldown = def.weapons.map(() => 0);
  a.burstLeft = def.weapons.map(() => 0);
  a.cloaked = type === "camopillbox" || def.mine;
  if (!def.mine) setOccupancy(state.map, tx, ty, w, h, a.id);
  if (def.gate && owner >= 0) {
    const team = state.players[owner]?.team ?? -1;
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) setGate(state.map, x, y, team);
  }
  if (def.exit) a.rally = { x: tileToWorldCenter(tx + def.exit[0]), y: tileToWorldCenter(ty + def.exit[1]) };
  state.actors.set(a.id, a);
  if (owner >= 0) {
    const p = state.players[owner];
    if (p) p.stats.built++;
  }
  return a;
}

export function spawnProjectile(
  state: SimState,
  weapon: string,
  source: Actor,
  x: number,
  y: number,
  targetId: number,
  tx: number,
  ty: number,
): Actor {
  const a = baseActor(state, weapon, source.owner, x, y);
  a.kind = "projectile";
  const wdef = state.rules.weapons[weapon];
  const d = Math.max(1, Math.hypot(tx - x, ty - y));
  const speed = wdef?.speed ?? 0;
  const ticks = speed > 0 ? Math.max(1, Math.ceil(d / speed)) : 1;
  a.proj = { weapon, source: source.id, targetId, tx, ty, ttl: ticks + 40, arcT: 0, arcTotal: ticks, sx: x, sy: y };
  state.actors.set(a.id, a);
  return a;
}

export function removeActor(state: SimState, a: Actor): void {
  a.dead = true;
  if (a.kind === "structure") clearOccupancy(state.map, a.id);
  state.actors.delete(a.id);
}

/** Kill an actor: emit death event, drop passengers, leave a husk for vehicles. */
export function killActor(state: SimState, a: Actor, attacker = -1): void {
  if (a.dead) return;
  const owner = state.players[a.owner];
  if (owner && a.kind !== "projectile" && a.kind !== "husk") owner.stats.lost++;
  const att = attacker >= 0 ? state.actors.get(attacker) : undefined;
  if (att && !att.dead) {
    att.kills++;
    const ap = state.players[att.owner];
    if (ap && a.kind !== "projectile") ap.stats.kills++;
  }
  for (const pid of a.cargo) {
    const p = state.actors.get(pid);
    if (p) {
      p.inside = -1;
      p.x = a.x;
      p.y = a.y;
      killActor(state, p, attacker);
    }
  }
  emit(state, { kind: "died", actor: a.id, type: a.type, kind2: a.kind, x: a.x, y: a.y, player: a.owner });
  removeActor(state, a);
  if (a.kind === "unit") {
    const def = state.rules.units[a.type];
    if (def && def.class === "vehicle") {
      const husk = baseActor(state, a.type, -1, a.x, a.y);
      husk.kind = "husk";
      husk.facing = a.facing;
      husk.turretFacing = a.turretFacing;
      husk.huskTtl = 20 * 45;
      state.actors.set(husk.id, husk);
    }
  }
}

/** Does the player own a live, built structure of `type` (or a fake-free equivalent)? */
export function ownsStructure(state: SimState, player: number, type: string): boolean {
  for (const a of state.actors.values()) {
    if (a.kind === "structure" && a.owner === player && a.type === type && a.buildup >= 1 && !a.dead) return true;
  }
  return false;
}

export function hasPrereqs(state: SimState, player: number, prereq: string[]): boolean {
  for (const p of prereq) {
    if (p === "none") return false;
    if (!ownsStructure(state, player, p)) return false;
  }
  return true;
}

export function countOwned(state: SimState, player: number, type: string): number {
  let n = 0;
  for (const a of state.actors.values()) if (a.owner === player && a.type === type && !a.dead && a.kind !== "husk") n++;
  return n;
}

/** Types the player may currently build in a queue, honouring faction, tech, prereqs, limits. */
export function buildableTypes(state: SimState, player: number, queue: QueueKind): string[] {
  const p = state.players[player];
  if (!p) return [];
  const out: string[] = [];
  const tech = state.options.techLevel;
  if (queue === "building" || queue === "defense") {
    if (!ownsStructure(state, player, "conyard")) return [];
    for (const [type, def] of Object.entries(state.rules.structures)) {
      if (def.queue !== queue) continue;
      if (def.factions.length === 0) continue;
      if (!def.factions.includes(p.faction) && !p.discovered.includes(type)) continue;
      if (def.tech > tech) continue;
      if (!hasPrereqs(state, player, def.prereq)) continue;
      if (def.buildLimit > 0 && countOwned(state, player, type) >= def.buildLimit) continue;
      out.push(type);
    }
  } else {
    // Need a producer of this queue kind.
    if (!producersOf(state, player, queue).length) return [];
    for (const [type, def] of Object.entries(state.rules.units)) {
      if (def.queue !== queue) continue;
      if (!def.factions.includes(p.faction)) continue;
      if (def.tech > tech) continue;
      if (!hasPrereqs(state, player, def.prereq)) continue;
      if (def.buildLimit > 0 && countOwned(state, player, type) >= def.buildLimit) continue;
      out.push(type);
    }
  }
  return out;
}

export function producersOf(state: SimState, player: number, queue: QueueKind): Actor[] {
  const out: Actor[] = [];
  for (const a of state.actors.values()) {
    if (a.kind !== "structure" || a.owner !== player || a.dead || a.buildup < 1) continue;
    const def = state.rules.structures[a.type];
    if (def && def.produces.includes(queue)) out.push(a);
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

/** Placement legality: terrain, occupancy, and adjacency to the player's base. */
export function canPlace(state: SimState, player: number, type: string, tx: number, ty: number): boolean {
  const def = state.rules.structures[type];
  if (!def) return false;
  const [w, h] = def.footprint;
  const m = state.map;
  const isNaval = def.produces.includes("ship");
  let touchesWater = false;
  for (let y = ty; y < ty + h; y++) {
    for (let x = tx; x < tx + w; x++) {
      if (!inBounds(m, x, y)) return false;
      const i = idx(m, x, y);
      const t = m.terrain[i] as Terrain;
      if (isNaval) {
        if (t === Terrain.Water) touchesWater = true;
        else if (t !== Terrain.Beach && t !== Terrain.Clear) return false;
        if ((m.occupancy[i] as number) !== -1) return false;
      } else if (!isBuildable(m, x, y)) return false;
      // Units standing in the footprint block placement (they are pushed out otherwise).
    }
  }
  if (isNaval && !touchesWater) return false;
  // The new structure's own exit/dock cell must be open ground (or water for naval yards).
  if (def.exit) {
    const ex = tx + def.exit[0];
    const ey = ty + def.exit[1];
    if (!inBounds(m, ex, ey)) return false;
    const et = m.terrain[idx(m, ex, ey)] as Terrain;
    if ((m.occupancy[idx(m, ex, ey)] as number) !== -1) return false;
    if (isNaval ? et !== Terrain.Water && et !== Terrain.Beach : et === Terrain.Water || et === Terrain.Cliff || et === Terrain.Tree || et === Terrain.Rock) return false;
  }
  // Never build on another structure's exit/dock cell or the cell in front of it: trucks and
  // fresh units must be able to leave.
  for (const a of state.actors.values()) {
    if (a.kind !== "structure" || a.dead) continue;
    const ad = state.rules.structures[a.type];
    if (!ad?.exit) continue;
    const ex = a.tx + ad.exit[0];
    const ey = a.ty + ad.exit[1];
    for (const [rx, ry] of [[ex, ey], [ex, ey + 1], [ex + 1, ey]] as Array<[number, number]>) {
      if (rx >= tx && rx < tx + w && ry >= ty && ry < ty + h) return false;
    }
  }
  // Adjacency: within baseRadius cells of a base-normal structure the player owns.
  const r = state.rules.general.baseRadius;
  const rl = cellsToLeptons(r + Math.max(w, h) / 2);
  const cx = tileToWorldCenter(tx) + ((w - 1) * LEPTONS_PER_CELL) / 2;
  const cy = tileToWorldCenter(ty) + ((h - 1) * LEPTONS_PER_CELL) / 2;
  for (const a of state.actors.values()) {
    if (a.kind !== "structure" || a.owner !== player || a.dead) continue;
    const ad = state.rules.structures[a.type];
    if (!ad || !ad.baseNormal) continue;
    if (Math.hypot(a.x - cx, a.y - cy) <= rl + cellsToLeptons(Math.max(a.w, a.h) / 2)) return true;
  }
  return false;
}

/** Find a free cell around a structure for a freshly built unit. */
export function findExitCell(state: SimState, producer: Actor, loco: Actor["loco"]): [number, number] {
  const cells = exitCandidates(state, producer, loco);
  if (loco === "air" || cells.length <= 1) return cells[0] ?? [producer.tx, producer.ty + producer.h];
  // Prefer a cell from which the unit can actually reach the rally point (or the map centre).
  const target = producer.rally ? [worldToTile(producer.rally.x), worldToTile(producer.rally.y)] : [Math.floor(state.map.width / 2), Math.floor(state.map.height / 2)];
  for (const c of cells.slice(0, 12)) {
    const path = findPath(state.map, c[0], c[1], target[0] as number, target[1] as number, loco, -1, state.players[producer.owner]?.team ?? -1);
    const last = path[path.length - 1];
    if ((c[0] === target[0] && c[1] === target[1]) || (!!last && Math.abs(last[0] - (target[0] as number)) <= 1 && Math.abs(last[1] - (target[1] as number)) <= 1)) return c;
  }
  return cells[0] as [number, number];
}

function exitCandidates(state: SimState, producer: Actor, loco: Actor["loco"]): Array<[number, number]> {
  const def = state.rules.structures[producer.type];
  const m = state.map;
  const candidates: Array<[number, number]> = [];
  if (def?.exit) candidates.push([producer.tx + def.exit[0], producer.ty + def.exit[1]]);
  for (let r = 1; r <= 4; r++) {
    for (let y = producer.ty - r; y < producer.ty + producer.h + r; y++) {
      for (let x = producer.tx - r; x < producer.tx + producer.w + r; x++) {
        if (x >= producer.tx && x < producer.tx + producer.w && y >= producer.ty && y < producer.ty + producer.h) continue;
        candidates.push([x, y]);
      }
    }
  }
  const out: Array<[number, number]> = [];
  for (const [x, y] of candidates) {
    if (!inBounds(m, x, y)) continue;
    const i = idx(m, x, y);
    if ((m.occupancy[i] as number) !== -1) continue;
    const t = m.terrain[i] as Terrain;
    if (loco === "naval" ? t === Terrain.Water : t !== Terrain.Water && t !== Terrain.Cliff && t !== Terrain.Tree && t !== Terrain.Rock) out.push([x, y]);
  }
  return out;
}

export function tileOf(a: Actor): [number, number] {
  return [worldToTile(a.x), worldToTile(a.y)];
}

export function deployMcv(state: SimState, mcv: Actor): boolean {
  const def = state.rules.units[mcv.type];
  if (!def?.deploysTo) return false;
  const sdef = state.rules.structures[def.deploysTo];
  if (!sdef) return false;
  const [w, h] = sdef.footprint;
  const [ux, uy] = tileOf(mcv);
  const tx = ux - Math.floor(w / 2);
  const ty = uy - Math.floor(h / 2);
  for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) if (!isBuildable(state.map, x, y)) return false;
  removeActor(state, mcv);
  const s = spawnStructure(state, def.deploysTo, mcv.owner, tx, ty, 0);
  emit(state, { kind: "placed", actor: s.id, player: mcv.owner });
  return true;
}
