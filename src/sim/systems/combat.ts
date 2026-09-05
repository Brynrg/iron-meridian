// Target acquisition, weapon firing, projectile flight, warhead damage,
// splash, healing, prone, and death handling.

import { LEPTONS_PER_CELL, cellsToLeptons, facingFromDelta, turnToward } from "../coords";
import { queryCircle } from "../grid";
import { nextInt } from "../rng";
import { emit, getActor, isAlly, isEnemy, killActor, removeActor, spawnProjectile, structDef, unitDef } from "../state";
import type { Actor, SimState } from "../types";
import type { WeaponDef } from "../../data/schemas";
import { nextOrder } from "./movement";

const SCAN_INTERVAL = 5;
const scratch: number[] = [];

export function runCombat(state: SimState): void {
  for (const a of state.actorList) {
    if ((a.kind !== "unit" && a.kind !== "structure") || a.inside >= 0) continue;
    const weapons = weaponsOf(state, a);
    if (weapons.length === 0) {
      // Unarmed units still complete attack orders by doing nothing sensible: drop them.
      if (a.kind === "unit" && a.order.kind === "attack") nextOrder(a);
      continue;
    }
    if (a.kind === "structure" && (a.buildup < 1 || a.disabled)) continue;
    const adef = a.kind === "unit" ? unitDef(state, a.type) : undefined;
    if (adef && adef.ammo > 0 && a.ammo <= 0) {
      // Out of ammunition: go home and rearm (aircraft) or wait (minelayer).
      if (adef.class === "aircraft" && a.order.kind !== "rearm") {
        a.order = { kind: "rearm" };
        a.target = -1;
        a.moveGoal = null;
      }
      continue;
    }
    for (let i = 0; i < a.cooldown.length; i++) if ((a.cooldown[i] as number) > 0) a.cooldown[i] = (a.cooldown[i] as number) - 1;

    // Validate / acquire target.
    let target = a.target >= 0 ? getActor(state, a.target) : undefined;
    if (target && (target.dead || target.inside >= 0 || !canEngage(state, a, target, weapons))) {
      target = undefined;
      a.target = -1;
    }
    if (a.order.kind === "attack") {
      const t = getActor(state, a.order.target);
      if (!t) {
        nextOrder(a);
        continue;
      }
      target = t;
      a.target = t.id;
    } else if (!target && (state.tick + a.id) % SCAN_INTERVAL === 0 && a.stance !== "hold") {
      const found = acquire(state, a, weapons);
      if (found) {
        target = found;
        a.target = found.id;
      }
    }
    if (!target) {
      if (a.kind === "unit" && a.turretFacing !== a.facing) a.turretFacing = turnToward(a.turretFacing, a.facing, 3);
      continue;
    }

    // Range handling.
    const maxRange = Math.max(...weapons.map((w) => w.def.range));
    const d = Math.hypot(target.x - a.x, target.y - a.y);
    const reach = cellsToLeptons(maxRange) + footprintPad(target);
    const isAttackOrder = a.order.kind === "attack";
    if (d > reach) {
      if (a.kind === "unit" && (isAttackOrder || a.order.kind === "attackMove" || a.order.kind === "guard" || a.order.kind === "idle")) {
        if (a.order.kind === "idle" || a.order.kind === "guard") {
          // Only pursue a short distance from the post.
          const home = a.order.kind === "guard" ? { x: a.guardX, y: a.guardY } : { x: a.x, y: a.y };
          if (Math.hypot(target.x - home.x, target.y - home.y) > cellsToLeptons(maxRange + 3)) {
            a.target = -1;
            continue;
          }
        }
        if (!a.moveGoal || Math.hypot(a.moveGoal.x - target.x, a.moveGoal.y - target.y) > LEPTONS_PER_CELL) {
          a.moveGoal = { x: target.x, y: target.y };
          a.path = null;
        }
      }
      continue;
    }
    // In range: stop and fire.
    if (a.kind === "unit" && a.order.kind !== "move") {
      a.moveGoal = null;
      a.path = null;
    }
    const want = facingFromDelta(target.x - a.x, target.y - a.y);
    const def = a.kind === "unit" ? unitDef(state, a.type) : structDef(state, a.type);
    const hasTurret = !!def?.turret;
    if (hasTurret) a.turretFacing = turnToward(a.turretFacing, want, 4);
    else {
      if (a.kind === "unit") a.facing = turnToward(a.facing, want, unitDef(state, a.type)?.turnRate ?? 8);
      a.turretFacing = a.facing;
    }
    const aim = hasTurret ? a.turretFacing : a.kind === "structure" ? want : a.facing;
    let diff = Math.abs(aim - want);
    if (diff > 16) diff = 32 - diff;
    if (diff > 2 && a.kind === "unit") continue;

    for (const w of weapons) {
      if ((a.cooldown[w.index] as number) > 0) continue;
      if (!weaponCanTarget(state, w.def, target)) continue;
      const wd = d - footprintPad(target);
      if (wd > cellsToLeptons(w.def.range) || wd < cellsToLeptons(w.def.minRange)) continue;
      fire(state, a, w.index, w.def, w.name, target);
      a.lastFiredTick = state.tick;
      if (adef && adef.ammo > 0) a.ammo--;
      if (a.kind === "structure" && structDef(state, a.type)?.mine) {
        emit(state, { kind: "explosion", x: a.x, y: a.y, size: 2, tick: state.tick });
        removeActor(state, a);
        break;
      }
      const burstLeft = (a.burstLeft[w.index] ?? 0) > 0 ? (a.burstLeft[w.index] as number) - 1 : w.def.burst - 1;
      a.burstLeft[w.index] = burstLeft;
      a.cooldown[w.index] = burstLeft > 0 ? w.def.burstDelay : w.def.rof;
      if (a.kind === "unit" && a.cloaked) a.cloaked = false; // subs surface to fire
    }
  }
  runProjectiles(state);
}

interface WeaponRef {
  index: number;
  name: string;
  def: WeaponDef;
}

function weaponsOf(state: SimState, a: Actor): WeaponRef[] {
  const def = a.kind === "unit" ? unitDef(state, a.type) : structDef(state, a.type);
  if (!def) return [];
  const out: WeaponRef[] = [];
  def.weapons.forEach((name, index) => {
    const w = state.rules.weapons[name];
    if (w) out.push({ index, name, def: w });
  });
  return out;
}

function footprintPad(t: Actor): number {
  return t.kind === "structure" ? (Math.max(t.w, t.h) * LEPTONS_PER_CELL) / 2 : 0;
}

function targetClass(state: SimState, t: Actor): "ground" | "air" | "naval" {
  if (t.kind === "unit") {
    if (t.loco === "air") return "air";
    if (t.loco === "naval") return "naval";
  }
  if (t.kind === "structure") {
    const sd = structDef(state, t.type);
    if (sd?.produces.includes("ship")) return "ground";
  }
  return "ground";
}

function weaponCanTarget(state: SimState, w: WeaponDef, t: Actor): boolean {
  const cls = targetClass(state, t);
  if (!w.targets.includes(cls)) return cls === "naval" && w.targets.includes("ground") && w.projectile !== "instant" ? true : false;
  const wh = state.rules.warheads[w.warhead];
  if (wh?.infantryOnly && !(t.kind === "unit" && unitDef(state, t.type)?.class === "infantry")) return false;
  if (wh?.ignoresBuildings && t.kind === "structure") return false;
  return true;
}

function isHealer(w: WeaponDef): boolean {
  return w.damage < 0;
}

function canEngage(state: SimState, a: Actor, t: Actor, weapons: WeaponRef[]): boolean {
  if (t.kind !== "unit" && t.kind !== "structure") return false;
  const heal = weapons.some((w) => isHealer(w.def));
  if (heal) return isAlly(state, a.owner, t.owner) && t.hp < t.maxHp && t.id !== a.id && weapons.some((w) => weaponCanTarget(state, w.def, t));
  if (!isEnemy(state, a, t)) return false;
  if (t.cloaked && state.tick >= t.revealedUntil && !canDetect(state, a, t)) return false;
  if (t.kind === "structure" && structDef(state, t.type)?.mine) return false; // mines are cleared by detectors, not shot at
  return weapons.some((w) => weaponCanTarget(state, w.def, t));
}

function canDetect(state: SimState, a: Actor, t: Actor): boolean {
  const def = a.kind === "unit" ? unitDef(state, a.type) : structDef(state, a.type);
  if (def?.detector) return true;
  // Anyone sees a cloaked thing that is adjacent or has just fired.
  return Math.hypot(t.x - a.x, t.y - a.y) < LEPTONS_PER_CELL * 1.5;
}

function acquire(state: SimState, a: Actor, weapons: WeaponRef[]): Actor | undefined {
  const maxRange = Math.max(...weapons.map((w) => w.def.range)) + (a.kind === "structure" ? 0 : 1);
  const r = cellsToLeptons(maxRange) + LEPTONS_PER_CELL * 2;
  const ids = queryCircle(state.grid, a.x, a.y, r, scratch);
  let best: Actor | undefined;
  let bestScore = Infinity;
  for (const id of ids) {
    const t = state.actors.get(id);
    if (!t || t.dead || t.id === a.id || t.inside >= 0) continue;
    if (!canEngage(state, a, t, weapons)) continue;
    const d = Math.hypot(t.x - a.x, t.y - a.y) - footprintPad(t);
    if (d > cellsToLeptons(maxRange)) continue;
    // Threat weighting: armed things first, harvesters and walls last.
    let score = d;
    const armed = weaponsOf(state, t).length > 0;
    if (!armed) score += LEPTONS_PER_CELL * 3;
    if (t.kind === "structure" && structDef(state, t.type)?.wall) score += LEPTONS_PER_CELL * 6;
    if (t.lastAttacker === a.id) score -= LEPTONS_PER_CELL;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

function fire(state: SimState, a: Actor, index: number, w: WeaponDef, name: string, target: Actor): void {
  void index;
  const facing = a.turretFacing;
  emit(state, { kind: "muzzle", x: a.x, y: a.y, facing, tick: state.tick });
  emit(state, { kind: "sfx", name: w.sound, x: a.x, y: a.y, player: a.owner });
  if (w.projectile === "instant" || w.projectile === "heal" || w.projectile === "arc") {
    if (w.projectile === "arc") emit(state, { kind: "explosion", x: target.x, y: target.y, size: 0, tick: state.tick });
    applyWarhead(state, name, w, a.id, a.owner, target.x, target.y, target.id);
    return;
  }
  let tx = target.x;
  let ty = target.y;
  if (w.inaccuracy > 0) {
    const s = cellsToLeptons(w.inaccuracy);
    tx += nextInt(state.rng, s * 2 + 1) - s;
    ty += nextInt(state.rng, s * 2 + 1) - s;
  }
  spawnProjectile(state, name, a, a.x, a.y, w.projectile === "missile" || w.projectile === "torpedo" ? target.id : -1, tx, ty);
}

function runProjectiles(state: SimState): void {
  for (const p of state.actorList) {
    if (p.kind !== "projectile" || !p.proj) continue;
    const pr = p.proj;
    const w = state.rules.weapons[pr.weapon];
    if (!w) {
      removeActor(state, p);
      continue;
    }
    pr.ttl--;
    // Homing: track a live target.
    if (pr.targetId >= 0) {
      const t = getActor(state, pr.targetId);
      if (t) {
        pr.tx = t.x;
        pr.ty = t.y;
      }
    }
    const dx = pr.tx - p.x;
    const dy = pr.ty - p.y;
    const d = Math.hypot(dx, dy);
    const speed = pr.weapon === "nukeBlast" ? p.speed : w.speed;
    pr.arcT++;
    if (d <= speed || pr.ttl <= 0) {
      p.x = pr.tx;
      p.y = pr.ty;
      const src = state.actors.get(pr.source);
      applyWarhead(state, pr.weapon, w, pr.source, src?.owner ?? p.owner, pr.tx, pr.ty, pr.targetId);
      const size = w.projectile === "shell" || w.projectile === "missile" ? (w.damage >= 100 ? 2 : 1) : 0;
      emit(state, { kind: "explosion", x: pr.tx, y: pr.ty, size: pr.weapon === "nukeBlast" ? 4 : size, tick: state.tick });
      if (pr.weapon === "nukeBlast") emit(state, { kind: "sfx", name: "nuke", x: pr.tx, y: pr.ty, player: -1 });
      removeActor(state, p);
      continue;
    }
    p.facing = facingFromDelta(dx, dy);
    p.x = Math.round(p.x + (dx / d) * speed);
    p.y = Math.round(p.y + (dy / d) * speed);
  }
}

/** Apply a weapon's warhead at a point (splash) or to a direct target. */
export function applyWarhead(state: SimState, weaponName: string, w: WeaponDef, attacker: number, attackerOwner: number, x: number, y: number, directTarget: number): void {
  void weaponName;
  const wh = state.rules.warheads[w.warhead];
  if (!wh) return;
  const spread = cellsToLeptons(wh.spread);
  if (spread <= 0) {
    const t = directTarget >= 0 ? getActor(state, directTarget) : undefined;
    if (t) damage(state, t, w.damage, wh.versus, attacker, attackerOwner);
    return;
  }
  const ids = queryCircle(state.grid, x, y, spread + LEPTONS_PER_CELL * 2, scratch).slice();
  for (const id of ids) {
    const t = state.actors.get(id);
    if (!t || t.dead || (t.kind !== "unit" && t.kind !== "structure") || t.inside >= 0) continue;
    if (wh.infantryOnly && !(t.kind === "unit" && unitDef(state, t.type)?.class === "infantry")) continue;
    if (wh.ignoresBuildings && t.kind === "structure") continue;
    if (w.damage < 0 && !isAlly(state, attackerOwner, t.owner)) continue;
    const d = Math.max(0, Math.hypot(t.x - x, t.y - y) - footprintPad(t));
    if (d > spread) continue;
    const falloff = d <= spread * 0.35 ? 1 : 1 - (d - spread * 0.35) / (spread * 0.65);
    damage(state, t, Math.round(w.damage * falloff), wh.versus, attacker, attackerOwner);
  }
}

export function damage(state: SimState, t: Actor, amount: number, versus: Record<string, number | undefined>, attacker: number, attackerOwner: number): void {
  if (t.dead) return;
  const def = t.kind === "unit" ? unitDef(state, t.type) : structDef(state, t.type);
  if (!def) return;
  const armor = def.armor;
  const isInfantry = t.kind === "unit" && (def as { class?: string }).class === "infantry";
  const isSuicide = t.kind === "unit" && !!(def as { suicide?: boolean }).suicide;
  let dmg = Math.round((amount * (versus[armor] ?? 100)) / 100);
  if (dmg < 0) {
    // Heal.
    if (t.hp >= t.maxHp) return;
    t.hp = Math.min(t.maxHp, t.hp - dmg);
    return;
  }
  if (dmg <= 0) return;
  if (t.kind === "unit" && t.charge > 0) return; // aegis
  if (isInfantry && t.prone) dmg = Math.round(dmg * 0.5);
  if (isInfantry) t.prone = true;
  t.hp -= dmg;
  t.lastDamagedTick = state.tick;
  t.lastAttacker = attacker;
  // Retaliate if idle / guarding and the attacker is reachable.
  if (t.target < 0 && (t.order.kind === "idle" || t.order.kind === "guard" || t.order.kind === "attackMove") && t.stance !== "hold") {
    const att = getActor(state, attacker);
    if (att && isEnemy(state, t, att)) t.target = att.id;
  }
  // Player notifications (rate limited by the view).
  if (t.owner >= 0 && attackerOwner !== t.owner) {
    if (t.kind === "structure") emit(state, { kind: "baseAttack", player: t.owner, x: t.x, y: t.y });
    else if (t.harvester) emit(state, { kind: "harvesterAttack", player: t.owner, x: t.x, y: t.y });
  }
  if (t.hp <= 0) {
    t.hp = 0;
    const big = t.kind === "structure" ? 3 : isInfantry ? 0 : 2;
    emit(state, { kind: "explosion", x: t.x, y: t.y, size: big, tick: state.tick });
    if (t.kind === "structure" && t.owner >= 0) emit(state, { kind: "eva", cue: "structureLost", player: t.owner });
    if (t.kind === "unit" && t.harvester && t.owner >= 0) emit(state, { kind: "eva", cue: "harvesterLost", player: t.owner });
    // Demolition trucks and chained explosions.
    if (isSuicide) {
      const w = state.rules.weapons.demoCharge;
      if (w) {
        const owner = t.owner;
        const tx = t.x;
        const ty = t.y;
        killActor(state, t, attacker);
        applyWarhead(state, "demoCharge", w, t.id, owner, tx, ty, -1);
        emit(state, { kind: "explosion", x: tx, y: ty, size: 4, tick: state.tick });
        return;
      }
    }
    killActor(state, t, attacker);
  }
}

/** Suicide units detonate on contact with their target. */
export function runSuicide(state: SimState): void {
  for (const a of state.actorList) {
    if (a.kind !== "unit" || a.order.kind !== "attack") continue;
    const def = unitDef(state, a.type);
    if (!def?.suicide) continue;
    const t = getActor(state, a.order.target);
    if (!t) continue;
    if (Math.hypot(t.x - a.x, t.y - a.y) <= LEPTONS_PER_CELL * 0.8 + footprintPad(t)) {
      a.hp = 0;
      damage(state, a, 1, { none: 100, light: 100, heavy: 100, wood: 100, concrete: 100 }, a.id, a.owner);
    } else if (!a.moveGoal) {
      a.moveGoal = { x: t.x, y: t.y };
      a.path = null;
    }
  }
}
