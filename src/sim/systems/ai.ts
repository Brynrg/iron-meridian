// Skirmish AI. Runs inside the sim (deterministic) and issues ordinary
// commands, so it can never do anything a player could not. Three
// difficulties change thresholds and reaction speed, not the rules.

import { LEPTONS_PER_CELL, cellsToLeptons, tileToWorldCenter } from "../coords";
import { nextInt } from "../rng";
import { buildableTypes, canPlace, countOwned, ownsStructure, producersOf, structDef, unitDef } from "../state";
import { findPath, nearestPassable } from "../pathfind";
import { Terrain, idx as cellIndex, inBounds } from "../map";

/** Is there water within 14 cells of the yard (so a naval yard could go somewhere)? */
function shoreNear(state: SimState, yard: Actor): boolean {
  const m = state.map;
  const cx = worldToTile(yard.x);
  const cy = worldToTile(yard.y);
  for (let dy = -14; dy <= 14; dy++)
    for (let dx = -14; dx <= 14; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (inBounds(m, x, y) && m.terrain[cellIndex(m, x, y)] === Terrain.Water) return true;
    }
  return false;
}
import { worldToTile } from "../coords";
import type { Actor, Command, Player, SimState } from "../types";
import type { QueueKind } from "../../data/schemas";

const BUILD_ORDER: Record<string, string[]> = {
  alliance: ["power", "refinery", "barracks", "power", "factory", "refinery", "radar", "pillbox", "power", "turret", "depot", "apower", "pillbox", "techcenter", "turret", "refinery", "aagun", "apower", "factory", "helipad", "navalyard", "gapgen", "phasegate"],
  pact: ["power", "refinery", "barracks", "power", "factory", "refinery", "radar", "flametower", "power", "kennel", "depot", "apower", "arctower", "techcenter", "refinery", "samsite", "apower", "factory", "airfield", "subpen", "arctower", "missilesilo", "aegis"],
};

const INFANTRY_MIX: Record<string, string[]> = {
  alliance: ["rifle", "rifle", "rocket", "rifle", "rocket", "medic"],
  pact: ["rifle", "grenadier", "rifle", "rocket", "flamer", "dog"],
};
const VEHICLE_MIX: Record<string, string[]> = {
  alliance: ["lighttank", "mediumtank", "mediumtank", "ranger", "artillery", "mediumtank", "apc"],
  pact: ["heavytank", "heavytank", "flaktruck", "rocketlauncher", "heavytank", "kolossus", "arctank"],
};

export function runAi(state: SimState, out: Command[]): void {
  for (const p of state.players) {
    if (!p.isAI || p.defeated || !p.ai) continue;
    const mem = p.ai;
    if (state.tick < mem.nextThinkTick) continue;
    const interval = p.difficulty === "hard" ? 10 : p.difficulty === "easy" ? 30 : 20;
    mem.nextThinkTick = state.tick + interval + (p.id % 5);
    think(state, p, out);
  }
}

function think(state: SimState, p: Player, out: Command[]): void {
  const mem = p.ai;
  if (!mem) return;
  const mine = state.actorList.filter((a) => a.owner === p.id && !a.dead && a.inside < 0);
  const structures = mine.filter((a) => a.kind === "structure");
  const units = mine.filter((a) => a.kind === "unit");
  const conyard = structures.find((a) => a.type === "conyard");

  // 1. Deploy the MCV if we have no yard.
  if (!conyard) {
    const mcv = units.find((a) => unitDef(state, a.type)?.deploysTo);
    if (mcv) {
      if (mcv.order.kind === "idle") out.push({ player: p.id, kind: "deploy", actors: [mcv.id] });
      // If deploy failed (blocked), shuffle a little.
      if (state.tick % 60 === 0) out.push({ player: p.id, kind: "move", actors: [mcv.id], x: mcv.x + (nextInt(state.rng, 3) - 1) * LEPTONS_PER_CELL * 2, y: mcv.y + (nextInt(state.rng, 3) - 1) * LEPTONS_PER_CELL * 2, queue: false });
    }
    return;
  }
  if (mem.rallyX === 0) {
    // Rally point: a few cells from the yard toward the map centre.
    const cx = tileToWorldCenter(Math.floor(state.map.width / 2));
    const cy = tileToWorldCenter(Math.floor(state.map.height / 2));
    const dx = cx - conyard.x;
    const dy = cy - conyard.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    mem.rallyX = Math.round(conyard.x + (dx / d) * cellsToLeptons(8));
    mem.rallyY = Math.round(conyard.y + (dy / d) * cellsToLeptons(8));
  }

  // Island mode: if no ground path reaches an enemy base, pull navy/air forward in the build order.
  if (state.tick % 600 === 0 || mem.phase === 0) {
    const enemyYard = state.actorList.find((a) => a.kind === "structure" && a.owner >= 0 && state.players[a.owner]?.team !== p.team && a.type === "conyard") ?? state.actorList.find((a) => a.owner >= 0 && a.kind === "structure" && state.players[a.owner]?.team !== p.team);
    if (enemyYard) {
      const from = nearestPassable(state.map, worldToTile(conyard.x), worldToTile(conyard.y) + 2, "track", 8) ?? [worldToTile(conyard.x), worldToTile(conyard.y) + 2];
      const goal = nearestPassable(state.map, worldToTile(enemyYard.x), worldToTile(enemyYard.y) + 2, "track", 8) ?? [worldToTile(enemyYard.x), worldToTile(enemyYard.y) + 2];
      const path = findPath(state.map, from[0], from[1], goal[0], goal[1], "track", -1, p.team);
      const last = path[path.length - 1];
      const reached = !!last && Math.abs(last[0] - goal[0]) <= 2 && Math.abs(last[1] - goal[1]) <= 2;
      // 1 = land route; 2 = island with a shoreline near the base (navy + air); 3 = cut off but no shore (air only)
      mem.phase = reached ? 1 : shoreNear(state, conyard) ? 2 : 3;
    } else mem.phase = 1;
  }
  if (state.tick >= mem.blockedClearTick) {
    mem.blocked = [];
    mem.blockedClearTick = state.tick + 20 * 120;
  }

  // 2. Structures: place anything ready, else queue the next build-order item.
  placeReady(state, p, conyard, out);
  const lowPower = p.powerDrain + 20 > p.powerSupply;
  const bq = p.queues.building;
  const dq = p.queues.defense;
  if (bq.items.length === 0 && !bq.ready) {
    let order = BUILD_ORDER[p.faction] ?? [];
    const navy = p.faction === "pact" ? "subpen" : "navalyard";
    const air = p.faction === "pact" ? "airfield" : "helipad";
    if (mem.phase === 2) {
      // Island: naval yard right after the refinery, air right after radar.
      order = ["power", "refinery", navy, "barracks", "power", "factory", "radar", air, ...order.filter((t) => t !== navy && t !== air)];
    } else if (mem.phase === 3) {
      // Cut off with no shore: air power as early as the tech allows.
      order = ["power", "refinery", "barracks", "power", "factory", "radar", air, ...order.filter((t) => t !== air && t !== navy)];
    }
    order = order.filter((t) => !mem.blocked.includes(t));
    const canBuild = buildableTypes(state, p.id, "building");
    const canDef = buildableTypes(state, p.id, "defense");
    let pick: string | null = null;
    if (lowPower && canBuild.includes("apower")) pick = "apower";
    else if (lowPower && canBuild.includes("power")) pick = "power";
    else if (p.credits > 3000 && countOwned(state, p.id, "refinery") < 4 && canBuild.includes("refinery") && countOwned(state, p.id, "oretruck") >= countOwned(state, p.id, "refinery") * 2) pick = "refinery";
    else {
      // Walk the build order, skipping what we already have (except repeatables).
      for (let i = 0; i < order.length; i++) {
        const t = order[i] as string;
        const repeatable = t === "power" || t === "apower" || t === "refinery" || t === "pillbox" || t === "turret" || t === "flametower" || t === "arctower" || t === "samsite" || t === "aagun" || t === "factory";
        const have = countOwned(state, p.id, t);
        const wanted = order.slice(0, i + 1).filter((x) => x === t).length;
        if (!repeatable && have > 0) continue;
        if (repeatable && have >= wanted) continue;
        if (canBuild.includes(t)) {
          pick = t;
          break;
        }
        if (canDef.includes(t) && dq.items.length === 0 && !dq.ready) {
          out.push({ player: p.id, kind: "queue", queue: "defense", type: t });
          break;
        }
        // Not yet available (prereq pending) -> try the next item rather than stall.
      }
    }
    if (pick) out.push({ player: p.id, kind: "queue", queue: "building", type: pick });
  }
  // Extra defenses when rich.
  if (dq.items.length === 0 && !dq.ready && p.credits > 2500 && state.tick % 200 === 0) {
    const canDef = buildableTypes(state, p.id, "defense").filter((t) => !structDef(state, t)?.wall && !structDef(state, t)?.fake);
    if (canDef.length) out.push({ player: p.id, kind: "queue", queue: "defense", type: canDef[nextInt(state.rng, canDef.length)] as string });
  }

  // 3. Repair damaged buildings when affordable.
  if (p.credits > 500) {
    for (const s of structures) if (!s.repairing && s.hp < s.maxHp * 0.7) out.push({ player: p.id, kind: "repair", actor: s.id });
  }

  // 4. Units.
  const harvesters = units.filter((a) => a.harvester);
  const refineries = countOwned(state, p.id, "refinery");
  const wantHarvesters = Math.min(6, refineries * 2);
  const vq = p.queues.vehicle;
  const iq = p.queues.infantry;
  if (vq.items.length === 0 && producersOf(state, p.id, "vehicle").length) {
    const can = buildableTypes(state, p.id, "vehicle");
    let type: string | null = null;
    if (harvesters.length < wantHarvesters && can.includes("oretruck")) type = "oretruck";
    else {
      const mix = (VEHICLE_MIX[p.faction] ?? []).filter((t) => can.includes(t));
      if (mix.length) type = mix[nextInt(state.rng, mix.length)] as string;
    }
    if (type && (type === "oretruck" || p.credits > 600)) out.push({ player: p.id, kind: "queue", queue: "vehicle", type });
  }
  if (iq.items.length === 0 && producersOf(state, p.id, "infantry").length && p.credits > 300) {
    const can = buildableTypes(state, p.id, "infantry");
    const mix = (INFANTRY_MIX[p.faction] ?? []).filter((t) => can.includes(t));
    if (mix.length && units.filter((a) => unitDef(state, a.type)?.class === "infantry").length < 24) {
      out.push({ player: p.id, kind: "queue", queue: "infantry", type: mix[nextInt(state.rng, mix.length)] as string });
    }
  }
  // Air.
  const aq = p.queues.aircraft;
  if (aq.items.length === 0 && producersOf(state, p.id, "aircraft").length && p.credits > 2000) {
    const can = buildableTypes(state, p.id, "aircraft").filter((t) => (unitDef(state, t)?.weapons.length ?? 0) > 0);
    if (can.length && units.filter((a) => a.loco === "air").length < 4) out.push({ player: p.id, kind: "queue", queue: "aircraft", type: can[nextInt(state.rng, can.length)] as string });
  }

  // Navy.
  const sq = p.queues.ship;
  if (sq.items.length === 0 && producersOf(state, p.id, "ship").length && p.credits > 1500) {
    const can = buildableTypes(state, p.id, "ship").filter((t) => (unitDef(state, t)?.weapons.length ?? 0) > 0);
    if (can.length && units.filter((a) => a.loco === "naval").length < 6) out.push({ player: p.id, kind: "queue", queue: "ship", type: can[nextInt(state.rng, can.length)] as string });
  }
  // Ships hunt on their own: attack-move toward the enemy along water.
  if (state.tick % 200 === 0) {
    const ships = units.filter((a) => a.loco === "naval" && a.order.kind === "idle" && (unitDef(state, a.type)?.weapons.length ?? 0) > 0);
    const target = pickTarget(state, p, conyard);
    if (ships.length && target) out.push({ player: p.id, kind: "attackMove", actors: ships.map((a) => a.id), x: target.x, y: target.y, queue: false });
  }

  // 5. Army control.
  const army = units.filter((a) => {
    const d = unitDef(state, a.type);
    return d && d.weapons.length > 0 && !a.harvester && !d.deploysTo && !d.medic && !d.mechanic && d.class !== "aircraft";
  });
  const air = units.filter((a) => a.loco === "air" && (unitDef(state, a.type)?.weapons.length ?? 0) > 0);
  let threshold = (p.difficulty === "hard" ? 6 : p.difficulty === "easy" ? 14 : 9) + Math.min(3, Math.floor(state.tick / (20 * 240)));
  // Finish the job: when an enemy is down to a few structures and little army, any force will do.
  const enemies = state.players.filter((q) => q.team !== p.team && !q.defeated);
  const crippled = enemies.length > 0 && enemies.every((q) => {
    let structs = 0;
    let armed = 0;
    for (const a of state.actorList) {
      if (a.owner !== q.id) continue;
      if (a.kind === "structure" && !structDef(state, a.type)?.wall && !structDef(state, a.type)?.mine) structs++;
      else if (a.kind === "unit" && (unitDef(state, a.type)?.weapons.length ?? 0) > 0) armed++;
    }
    return structs <= 4 && armed <= 3;
  });
  if (crippled) threshold = Math.min(threshold, 3);
  const underAttack = state.tick - mem.lastBaseAttackTick < 20 * 15 && mem.targetX >= 0;
  const nearBase = underAttack && Math.hypot(mem.targetX - conyard.x, mem.targetY - conyard.y) < cellsToLeptons(18);

  if (nearBase && !mem.attacking) {
    // Defend the base with whatever is home; production continues (handled above).
    const home = army.filter((a) => Math.hypot(a.x - conyard.x, a.y - conyard.y) < cellsToLeptons(24)).map((a) => a.id);
    if (home.length && state.tick % 40 === 0) out.push({ player: p.id, kind: "attackMove", actors: home, x: mem.targetX, y: mem.targetY, queue: false });
  } else if (!mem.attacking) {
    // Gather idle army at the rally point.
    const idle = army.filter((a) => a.order.kind === "idle" && Math.hypot(a.x - mem.rallyX, a.y - mem.rallyY) > cellsToLeptons(4));
    if (idle.length && state.tick % 60 === 0) out.push({ player: p.id, kind: "move", actors: idle.map((a) => a.id), x: mem.rallyX, y: mem.rallyY, queue: false });
    if (army.length >= threshold) {
      const target = pickTarget(state, p, conyard);
      if (target) {
        mem.attacking = true;
        mem.attackWaveAt = state.tick;
        out.push({ player: p.id, kind: "attackMove", actors: army.map((a) => a.id), x: target.x, y: target.y, queue: false });
        if (air.length) out.push({ player: p.id, kind: "attackMove", actors: air.map((a) => a.id), x: target.x, y: target.y, queue: false });
      }
    }
  } else {
    // Keep the wave pointed at something; retarget every few seconds.
    if (state.tick % 100 === 0) {
      const idle = army.filter((a) => a.order.kind === "idle" || a.order.kind === "guard");
      const lead = idle[0] ?? army[0];
      const target = lead ? pickTarget(state, p, lead) : null;
      if (!target) mem.attacking = false;
      else if (idle.length) out.push({ player: p.id, kind: "attackMove", actors: idle.map((a) => a.id), x: target.x, y: target.y, queue: false });
    }
    if (army.length < Math.max(3, threshold / 3)) mem.attacking = false;
  }

  // 6. Superweapons: fire at the biggest enemy cluster (their conyard).
  for (const [power, sw] of Object.entries(p.superweapons)) {
    if (!sw.ready) continue;
    const target = pickTarget(state, p, conyard, true);
    if (!target) continue;
    const vehicles = army.filter((a) => unitDef(state, a.type)?.class === "vehicle").slice(0, 5).map((a) => a.id);
    out.push({ player: p.id, kind: "superweapon", power, x: target.x, y: target.y, actors: vehicles });
  }
}

export function placeReady(state: SimState, p: Player, conyard: Actor, out: Command[]): void {
  const mem = p.ai;
  if (!mem) return;
  for (const qk of ["building", "defense"] as QueueKind[]) {
    const q = p.queues[qk];
    const item = q.items[0];
    if (!q.ready || !item) continue;
    const def = structDef(state, item.type);
    if (!def) continue;
    const spot = findSpot(state, p, item.type, conyard, qk === "defense");
    if (spot) {
      out.push({ player: p.id, kind: "place", type: item.type, tx: spot[0], ty: spot[1] });
      mem.failedPlacements = 0;
    } else if (++mem.failedPlacements > 6) {
      out.push({ player: p.id, kind: "cancelPlace", queue: qk });
      mem.failedPlacements = 0;
      if (!mem.blocked.includes(item.type)) mem.blocked.push(item.type); // do not retry for a while
    }
  }
}

/** Search outward from the yard (defenses: from the rally side) for a legal spot. */
export function findSpot(state: SimState, p: Player, type: string, conyard: Actor, defense: boolean): [number, number] | null {
  const def = structDef(state, type);
  if (!def) return null;
  const mem = p.ai;
  const [w, h] = def.footprint;
  const ox = conyard.tx + 1;
  const oy = conyard.ty + 1;
  const bias = defense && mem ? [Math.sign(mem.rallyX - conyard.x), Math.sign(mem.rallyY - conyard.y)] : [0, 0];
  const start = defense ? 4 : 2;
  // Two passes: first insist the base stays open; if nothing fits, economy buildings may
  // still go down (a base with no refinery is worse than a tight one).
  for (const strict of def.produces.length > 0 || def.refinery || def.power > 0 ? [true, false] : [true]) {
  for (let r = start; r <= 14; r++) {
    const ring: Array<[number, number]> = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        // Keep a one-cell lane between buildings so units can path.
        if ((dx + dy) % 2 !== 0 && !defense) continue;
        ring.push([ox + dx + (bias[0] as number) * 3 - Math.floor(w / 2), oy + dy + (bias[1] as number) * 3 - Math.floor(h / 2)]);
      }
    }
    // Deterministic rotation so bases are not always identical.
    const rot = nextInt(state.rng, ring.length || 1);
    for (let i = 0; i < ring.length; i++) {
      const [tx, ty] = ring[(i + rot) % ring.length] as [number, number];
      if (canPlace(state, p.id, type, tx, ty) && laneClear(state, tx, ty, w, h) && (!strict || keepsBaseOpen(state, p, conyard, tx, ty, w, h))) return [tx, ty];
    }
  }
  }
  return null;
}

/**
 * Would this footprint seal the base? Temporarily mark it occupied and check that a
 * tracked unit can still drive from the yard's doorstep to the AI's rally point.
 */
function keepsBaseOpen(state: SimState, p: Player, conyard: Actor, tx: number, ty: number, w: number, h: number): boolean {
  const m = state.map;
  const mem = p.ai;
  if (!mem) return true;
  const saved: Array<[number, number]> = [];
  for (let y = ty; y < ty + h; y++)
    for (let x = tx; x < tx + w; x++) {
      if (!inBounds(m, x, y)) continue;
      const i = cellIndex(m, x, y);
      saved.push([i, m.occupancy[i] as number]);
      m.occupancy[i] = 0x7ffffff0; // fake id
    }
  const goal = nearestPassable(m, worldToTile(mem.rallyX), worldToTile(mem.rallyY), "track", 6);
  // Every door that units come out of must still reach the rally point: the yard's
  // doorstep and each producer's exit cell.
  const doors: Array<[number, number]> = [[conyard.tx + 1, conyard.ty + conyard.h]];
  for (const a of state.actorList) {
    if (a.kind !== "structure" || a.owner !== p.id) continue;
    const d = structDef(state, a.type);
    if (d?.exit && d.produces.length > 0 && !d.produces.includes("ship") && !d.produces.includes("aircraft")) doors.push([a.tx + d.exit[0], a.ty + d.exit[1]]);
  }
  let open = true;
  if (goal) {
    for (const door of doors) {
      const from = nearestPassable(m, door[0], door[1], "track", 3);
      if (!from) {
        open = false;
        break;
      }
      const path = findPath(m, from[0], from[1], goal[0], goal[1], "track", -1, p.team);
      const last = path[path.length - 1];
      const ok = (from[0] === goal[0] && from[1] === goal[1]) || (!!last && Math.abs(last[0] - goal[0]) <= 1 && Math.abs(last[1] - goal[1]) <= 1);
      if (!ok) {
        open = false;
        break;
      }
    }
  }
  for (const [i, v] of saved) m.occupancy[i] = v;
  return open;
}

function laneClear(state: SimState, tx: number, ty: number, w: number, h: number): boolean {
  // Require the ring around the footprint to be mostly free of other structures.
  let blocked = 0;
  const m = state.map;
  for (let y = ty - 1; y <= ty + h; y++) {
    for (let x = tx - 1; x <= tx + w; x++) {
      if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
      if (x >= tx && x < tx + w && y >= ty && y < ty + h) continue;
      if ((m.occupancy[y * m.width + x] as number) !== -1) blocked++;
    }
  }
  return blocked <= (w + h);
}

function pickTarget(state: SimState, p: Player, from: Actor, preferYard = false): Actor | null {
  let best: Actor | null = null;
  let bestScore = Infinity;
  for (const a of state.actorList) {
    if (a.owner < 0 || a.dead || a.kind === "projectile" || a.kind === "husk") continue;
    const q = state.players[a.owner];
    if (!q || q.team === p.team) continue;
    let score = Math.hypot(a.x - from.x, a.y - from.y);
    if (a.kind === "structure") {
      score -= cellsToLeptons(10);
      if (a.type === "conyard") score -= cellsToLeptons(preferYard ? 100 : 5);
      if (structDef(state, a.type)?.wall) score += cellsToLeptons(50);
    }
    if (score < bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

/** Called by the tick loop with this tick's events so the AI can react to raids. */
export function aiObserve(state: SimState): void {
  for (const ev of state.events) {
    if (ev.kind === "baseAttack" || ev.kind === "harvesterAttack") {
      const p = state.players[ev.player];
      if (p?.ai) {
        p.ai.lastBaseAttackTick = state.tick;
        p.ai.targetX = ev.x;
        p.ai.targetY = ev.y;
      }
    }
  }
  void ownsStructure;
}
