// Path following, turning, soft unit separation, crushing, and order
// progression for move-type orders.

import { LEPTONS_PER_CELL, facingFromDelta, tileToWorldCenter, turnToward, worldToTile } from "../coords";
import { queryCircle } from "../grid";
import { isPassable, mapHeightLeptons, mapWidthLeptons } from "../map";
import { findPath, nearestPassable } from "../pathfind";
import { getActor, isEnemy, killActor, spawnUnit, spend, unitDef } from "../state";
import type { Actor, SimState } from "../types";
import { unloadCargo } from "./command";

const ARRIVE = 24; // leptons
const REPATH_TICKS = 40;

export function runMovement(state: SimState): void {
  const m = state.map;
  const maxX = mapWidthLeptons(m) - 1;
  const maxY = mapHeightLeptons(m) - 1;
  for (const a of state.actorList) {
    if (a.kind !== "unit" || a.inside >= 0) continue;
    const def = unitDef(state, a.type);
    if (!def) continue;
    resolveOrderGoal(state, a);
    if (a.loco !== "air" && a.loco !== "naval" && (state.tick + a.id) % 10 === 0) {
      const cx = worldToTile(a.x);
      const cy = worldToTile(a.y);
      if (!isPassable(m, cx, cy, a.loco, -1, state.players[a.owner]?.team ?? -1)) {
        const np = nearestPassable(m, cx, cy, a.loco, 6);
        if (np) {
          a.x = tileToWorldCenter(np[0]);
          a.y = tileToWorldCenter(np[1]);
          a.path = null;
        }
      }
    }
    if (!a.moveGoal) continue;

    // Aircraft fly straight.
    if (a.loco === "air") {
      stepToward(a, a.moveGoal.x, a.moveGoal.y, a.speed, def.turnRate, true);
      if (Math.hypot(a.moveGoal.x - a.x, a.moveGoal.y - a.y) <= ARRIVE) arrive(state, a);
      continue;
    }

    // Need a path?
    const [tx, ty] = [worldToTile(a.moveGoal.x), worldToTile(a.moveGoal.y)];
    if (!a.path || a.repathTimer <= 0) {
      const [sx, sy] = [worldToTile(a.x), worldToTile(a.y)];
      let gx = tx;
      let gy = ty;
      if (!isPassable(m, gx, gy, a.loco)) {
        const np = nearestPassable(m, gx, gy, a.loco);
        if (np) [gx, gy] = np;
      }
      a.path = findPath(m, sx, sy, gx, gy, a.loco, -1, state.players[a.owner]?.team ?? -1);
      a.pathIdx = 0;
      a.repathTimer = REPATH_TICKS + (a.id % 7);
      if (a.path.length === 0) {
        // Already there or unreachable: head straight to goal if same cell, else give up.
        if (sx === gx && sy === gy) {
          const d = Math.hypot(a.moveGoal.x - a.x, a.moveGoal.y - a.y);
          if (d > ARRIVE) {
            stepToward(a, a.moveGoal.x, a.moveGoal.y, a.speed, def.turnRate, def.class === "infantry");
            continue;
          }
        }
        arrive(state, a);
        continue;
      }
    }
    a.repathTimer--;
    const wp = a.path[a.pathIdx];
    if (!wp) {
      arrive(state, a);
      continue;
    }
    const isLast = a.pathIdx === a.path.length - 1;
    const wx = isLast && worldToTile(a.moveGoal.x) === wp[0] && worldToTile(a.moveGoal.y) === wp[1] ? a.moveGoal.x : tileToWorldCenter(wp[0]);
    const wy = isLast && worldToTile(a.moveGoal.x) === wp[0] && worldToTile(a.moveGoal.y) === wp[1] ? a.moveGoal.y : tileToWorldCenter(wp[1]);
    const before = a.x * 7 + a.y;
    const speed = a.prone ? a.speed * 0.5 : a.speed;
    const moved = stepToward(a, wx, wy, speed, def.turnRate, def.class === "infantry");
    if (Math.hypot(wx - a.x, wy - a.y) <= Math.max(ARRIVE, speed)) {
      a.pathIdx++;
      if (a.pathIdx >= a.path.length) arrive(state, a);
    }
    if (!moved || a.x * 7 + a.y === before) {
      a.stuckTicks++;
      if (a.stuckTicks > 20) {
        a.path = null;
        a.stuckTicks = 0;
      }
    } else a.stuckTicks = 0;
    a.x = Math.max(0, Math.min(maxX, a.x));
    a.y = Math.max(0, Math.min(maxY, a.y));
    if (def.crushes) crush(state, a);
    pickupCrate(state, a);
  }
  separate(state);
}

/** Turn toward and move toward a point. Returns whether the actor translated. */
function stepToward(a: Actor, x: number, y: number, speed: number, turnRate: number, instantTurn: boolean): boolean {
  const dx = x - a.x;
  const dy = y - a.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return false;
  const want = facingFromDelta(dx, dy);
  if (instantTurn) a.facing = want;
  else {
    a.facing = turnToward(a.facing, want, turnRate);
    let diff = Math.abs(a.facing - want);
    if (diff > 16) diff = 32 - diff;
    if (diff > 6) return false; // finish turning before rolling
  }
  const step = Math.min(speed, d);
  a.x = Math.round(a.x + (dx / d) * step);
  a.y = Math.round(a.y + (dy / d) * step);
  return true;
}

function arrive(state: SimState, a: Actor): void {
  a.moveGoal = null;
  a.path = null;
  const o = a.order;
  switch (o.kind) {
    case "move":
    case "attackMove":
    case "forceMove":
      nextOrder(a);
      break;
    case "rearm":
      break; // special system handles docking
    case "enter": {
      const t = getActor(state, o.target);
      if (t) enterTarget(state, a, t);
      nextOrder(a);
      break;
    }
    default:
      break; // harvest/capture/etc. manage their own goals
  }
}

export function nextOrder(a: Actor): void {
  const n = a.queuedOrders.shift();
  a.order = n ?? { kind: "idle" };
  a.target = -1;
}

/** Translate the current order into a movement goal when one is needed. */
function resolveOrderGoal(state: SimState, a: Actor): void {
  const o = a.order;
  switch (o.kind) {
    case "move":
    case "attackMove":
      if (!a.moveGoal && a.target < 0) a.moveGoal = { x: o.x, y: o.y };
      break;
    case "forceMove":
      if (!a.moveGoal) a.moveGoal = { x: o.x, y: o.y };
      a.target = -1;
      break;
    case "attack":
    case "capture":
    case "repairUnit":
    case "sabotage":
    case "infiltrate":
    case "enter": {
      const t = getActor(state, o.target);
      if (!t) {
        nextOrder(a);
        a.moveGoal = null;
        return;
      }
      // Combat decides range for attack; for the others walk adjacent.
      if (o.kind !== "attack") {
        const d = Math.hypot(t.x - a.x, t.y - a.y);
        const reach = LEPTONS_PER_CELL * (0.75 + Math.max(t.w, t.h) / 2);
        if (d <= reach) {
          a.moveGoal = null;
          applyContact(state, a, t);
        } else if (!a.moveGoal || Math.hypot(a.moveGoal.x - t.x, a.moveGoal.y - t.y) > LEPTONS_PER_CELL) {
          a.moveGoal = { x: t.x, y: t.y };
          a.path = null;
        }
      }
      break;
    }
    case "guard":
    case "idle":
      if (a.target < 0 && a.moveGoal && o.kind === "idle") a.moveGoal = null;
      break;
    default:
      break;
  }
}

function applyContact(state: SimState, a: Actor, t: Actor): void {
  const o = a.order;
  const def = unitDef(state, a.type);
  if (!def) return;
  switch (o.kind) {
    case "capture": {
      if (!isEnemy(state, a, t) && t.owner >= 0) {
        nextOrder(a);
        return;
      }
      const sd = state.rules.structures[t.type];
      if (!sd?.capturable) {
        nextOrder(a);
        return;
      }
      // Engineer is consumed; structure changes hands (classic: instant capture).
      const oldOwner = t.owner;
      t.owner = a.owner;
      t.repairing = false;
      t.selling = false;
      t.primary = false;
      if (oldOwner >= 0) {
        state.events.push({ kind: "eva", cue: "buildingCaptured", player: oldOwner });
      }
      state.events.push({ kind: "eva", cue: "buildingCaptured", player: a.owner });
      const p = state.players[a.owner];
      if (p && sd && !sd.factions.includes(p.faction) && sd.factions.length > 0 && !p.discovered.includes(t.type)) p.discovered.push(t.type);
      killActorSilently(state, a);
      break;
    }
    case "repairUnit": {
      t.hp = t.maxHp;
      killActorSilently(state, a);
      break;
    }
    case "sabotage": {
      if (!isEnemy(state, a, t)) {
        nextOrder(a);
        return;
      }
      t.hp = 0;
      killActor(state, t, a.id);
      state.events.push({ kind: "explosion", x: t.x, y: t.y, size: 3, tick: state.tick });
      nextOrder(a);
      break;
    }
    case "infiltrate": {
      if (!isEnemy(state, a, t)) {
        nextOrder(a);
        return;
      }
      const sd = state.rules.structures[t.type];
      const victim = state.players[t.owner];
      const me = state.players[a.owner];
      if (def.thief && victim && me && (sd?.storage ?? 0) > 0) {
        const stolen = Math.floor(victim.credits / 2);
        victim.credits -= stolen;
        victim.ore = Math.min(victim.ore, victim.credits);
        me.credits += stolen;
        state.events.push({ kind: "eva", cue: "creditsStolen", player: t.owner });
      } else if (def.spy && sd) {
        if (sd.radar) {
          const fog = state.fog[a.owner];
          const vfog = state.fog[t.owner];
          if (fog && vfog) for (let i = 0; i < fog.length; i++) if ((vfog[i] as number) > (fog[i] as number)) fog[i] = 1;
        } else if (sd.power > 0) {
          t.disabled = true;
          t.charge = -20 * 30; // negative charge = disabled ticks for power plants
        } else if (sd.superweapon) {
          const sw = victim?.superweapons[sd.superweapon];
          if (sw) sw.charge = 0;
        } else if (sd.produces.includes("ship") && me) {
          me.superweapons.sonar = { charge: 0, ready: true };
        }
        state.events.push({ kind: "eva", cue: "buildingInfiltrated", player: t.owner });
      }
      killActorSilently(state, a);
      break;
    }
    case "enter":
      enterTarget(state, a, t);
      nextOrder(a);
      break;
    default:
      break;
  }
}

function enterTarget(state: SimState, a: Actor, t: Actor): void {
  const tdef = t.kind === "unit" ? unitDef(state, t.type) : undefined;
  const sdef = t.kind === "structure" ? state.rules.structures[t.type] : undefined;
  if (tdef && tdef.cargo > 0 && t.cargo.length < tdef.cargo) {
    a.inside = t.id;
    a.moveGoal = null;
    a.path = null;
    t.cargo.push(a.id);
    return;
  }
  if (sdef?.repairs) {
    a.hp = a.maxHp; // service depot: instant for now, costed in economy later
    const p = state.players[a.owner];
    const udef = unitDef(state, a.type);
    if (p && udef) spend(p, Math.min(p.credits, Math.round(udef.cost * 0.1)));
    if (udef?.minelayer) a.ammo = 5;
    return;
  }
  if (sdef?.helipad) {
    a.ammo = 6;
    a.hp = a.maxHp;
  }
}

function killActorSilently(state: SimState, a: Actor): void {
  a.dead = true;
  state.actors.delete(a.id);
}

function pickupCrate(state: SimState, a: Actor): void {
  if (state.crates.length === 0 || a.owner < 0 || a.loco === "air") return;
  const tx = worldToTile(a.x);
  const ty = worldToTile(a.y);
  const i = state.crates.findIndex((c) => c.tx === tx && c.ty === ty);
  if (i < 0) return;
  const crate = state.crates[i] as { tx: number; ty: number; kind: string };
  state.crates.splice(i, 1);
  const p = state.players[a.owner];
  if (!p) return;
  switch (crate.kind) {
    case "money":
      p.credits += 2000;
      break;
    case "heal":
      for (const u of state.actorList) if (u.owner === a.owner && u.kind === "unit") u.hp = u.maxHp;
      break;
    case "reveal": {
      const fog = state.fog[a.owner];
      if (fog) for (let k = 0; k < fog.length; k++) if (fog[k] === 0) fog[k] = 1;
      break;
    }
    case "shroud": {
      const fog = state.fog[a.owner];
      if (fog) for (let k = 0; k < fog.length; k++) if (fog[k] === 1) fog[k] = 0;
      break;
    }
    case "unit": {
      const pick = p.faction === "pact" ? "heavytank" : "mediumtank";
      const u = spawnUnit(state, pick, a.owner, a.x + LEPTONS_PER_CELL, a.y);
      u.order = { kind: "guard" };
      break;
    }
  }
  state.events.push({ kind: "crate", player: a.owner, crate: crate.kind, x: a.x, y: a.y });
}

/** Tracked vehicles crush enemy infantry they roll over. */
function crush(state: SimState, a: Actor): void {
  const ids = queryCircle(state.grid, a.x, a.y, LEPTONS_PER_CELL, []);
  for (const id of ids) {
    const t = state.actors.get(id);
    if (!t || t.dead || t.kind !== "unit" || t.id === a.id) continue;
    const td = unitDef(state, t.type);
    if (!td?.crushable || !isEnemy(state, a, t)) continue;
    if (Math.hypot(t.x - a.x, t.y - a.y) < LEPTONS_PER_CELL * 0.45) {
      state.events.push({ kind: "sfx", name: "crush", x: t.x, y: t.y, player: -1 });
      killActor(state, t, a.id);
    }
  }
}

/** Soft separation so units do not stack on one point. Deterministic order. */
function separate(state: SimState): void {
  const scratch: number[] = [];
  for (const a of state.actorList) {
    if (a.kind !== "unit" || a.inside >= 0 || a.loco === "air" || a.loco === "naval") continue;
    const ad = unitDef(state, a.type);
    if (!ad) continue;
    const ra = ad.class === "infantry" ? 40 : 110;
    const ids = queryCircle(state.grid, a.x, a.y, 300, scratch);
    let px = 0;
    let py = 0;
    for (const id of ids) {
      if (id <= a.id) continue;
      const b = state.actors.get(id);
      if (!b || b.dead || b.kind !== "unit" || b.inside >= 0 || b.loco === "air" || b.loco === "naval") continue;
      const bd = unitDef(state, b.type);
      if (!bd) continue;
      const rb = bd.class === "infantry" ? 40 : 110;
      const minD = ra + rb;
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d = Math.hypot(dx, dy);
      if (d >= minD) continue;
      if (d < 1) {
        dx = ((a.id * 31) % 7) - 3 || 1;
        dy = ((b.id * 17) % 5) - 2 || 1;
        d = Math.hypot(dx, dy);
      }
      const push = ((minD - d) / d) * 0.5;
      const mx = Math.round(dx * push);
      const my = Math.round(dy * push);
      px += mx;
      py += my;
      // Only displace the stationary partner; movers keep their heading.
      if (!b.moveGoal) {
        b.x -= mx;
        b.y -= my;
      }
    }
    if (!a.moveGoal) {
      a.x += px;
      a.y += py;
    }
  }
}

export { unloadCargo };
