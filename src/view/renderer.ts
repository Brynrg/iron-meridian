// Canvas renderer: terrain (cached), resources, fog, actors, projectiles,
// effects, selection, placement ghost, and on-screen messages.

import { CELL_PX, LEPTONS_PER_CELL, worldToPx, worldToTile, facingToRadians } from "../sim/coords";
import { Terrain, idx } from "../sim/map";
import type { Actor, SimState } from "../sim/types";
import { canPlace } from "../sim/state";
import type { GameView } from "./game";
import { drawAircraft, drawCrate, drawInfantry, drawShip, drawStructure, drawTurret, drawVehicle, teamStyle, type UnitStyle } from "./sprites";

const TERRAIN_COLORS: Record<number, string> = {
  [Terrain.Clear]: "#6f7a48",
  [Terrain.Road]: "#8d8875",
  [Terrain.Rough]: "#66683f",
  [Terrain.Beach]: "#c9b878",
  [Terrain.Water]: "#2c5a86",
  [Terrain.Cliff]: "#5a4a3a",
  [Terrain.Tree]: "#3f5f2f",
  [Terrain.Bridge]: "#8a7a5a",
  [Terrain.Rock]: "#6f6f6a",
};

let terrainCache: HTMLCanvasElement | null = null;
let terrainCacheKey = "";
const styleCache = new Map<string, UnitStyle>();
const NEUTRAL = teamStyle("#9a9a9a");

function styleFor(state: SimState, owner: number): UnitStyle {
  if (owner < 0) return NEUTRAL;
  const c = state.players[owner]?.color ?? "#9a9a9a";
  let s = styleCache.get(c);
  if (!s) {
    s = teamStyle(c);
    styleCache.set(c, s);
  }
  return s;
}

function buildTerrainCache(state: SimState): HTMLCanvasElement {
  const m = state.map;
  const key = `${m.name}:${m.width}x${m.height}`;
  if (terrainCache && terrainCacheKey === key) return terrainCache;
  const c = document.createElement("canvas");
  c.width = m.width * CELL_PX;
  c.height = m.height * CELL_PX;
  const g = c.getContext("2d");
  if (!g) return c;
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      const t = m.terrain[idx(m, x, y)] as number;
      g.fillStyle = TERRAIN_COLORS[t] ?? "#f0f";
      g.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
      // Cheap texture: deterministic speckle from coordinates.
      const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      const v = (n % 17) - 8;
      g.fillStyle = v > 0 ? `rgba(255,255,255,${v / 90})` : `rgba(0,0,0,${-v / 90})`;
      g.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
      if (t === Terrain.Tree) {
        g.fillStyle = "#2b4a22";
        g.beginPath();
        g.arc(x * CELL_PX + 12 + (n % 5) - 2, y * CELL_PX + 12 + ((n >> 3) % 5) - 2, 9, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#4f7a3a";
        g.beginPath();
        g.arc(x * CELL_PX + 9 + (n % 5) - 2, y * CELL_PX + 9 + ((n >> 3) % 5) - 2, 5, 0, Math.PI * 2);
        g.fill();
      } else if (t === Terrain.Cliff) {
        g.fillStyle = "#3f3327";
        g.fillRect(x * CELL_PX, y * CELL_PX + 16, CELL_PX, 8);
        g.fillStyle = "#7a6650";
        g.fillRect(x * CELL_PX + 2, y * CELL_PX + 2, CELL_PX - 4, 6);
      } else if (t === Terrain.Rock) {
        g.fillStyle = "#8a8a84";
        g.beginPath();
        g.arc(x * CELL_PX + 12, y * CELL_PX + 13, 7, 0, Math.PI * 2);
        g.fill();
      } else if (t === Terrain.Road) {
        g.fillStyle = "rgba(0,0,0,0.12)";
        g.fillRect(x * CELL_PX, y * CELL_PX + 10, CELL_PX, 4);
      } else if (t === Terrain.Bridge) {
        g.fillStyle = "#5a4a3a";
        g.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, 3);
        g.fillRect(x * CELL_PX, y * CELL_PX + CELL_PX - 3, CELL_PX, 3);
      }
    }
  }
  // Edge transitions: soften water/beach/cliff boundaries so tiles read as terrain, not a grid.
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= m.width || y >= m.height ? Terrain.Cliff : (m.terrain[idx(m, x, y)] as number));
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      const t = at(x, y);
      const px = x * CELL_PX;
      const py = y * CELL_PX;
      const edges: Array<[number, number, number]> = [
        [0, -1, at(x, y - 1)],
        [1, 0, at(x + 1, y)],
        [0, 1, at(x, y + 1)],
        [-1, 0, at(x - 1, y)],
      ];
      for (const [dx, dy, n] of edges) {
        let color: string | null = null;
        if (t === Terrain.Water && n !== Terrain.Water && n !== Terrain.Bridge) color = "rgba(200,220,240,0.35)"; // foam
        else if ((t === Terrain.Clear || t === Terrain.Rough || t === Terrain.Road) && n === Terrain.Cliff) color = "rgba(0,0,0,0.28)"; // cliff shadow
        else if (t === Terrain.Beach && (n === Terrain.Clear || n === Terrain.Rough)) color = "rgba(120,140,80,0.25)"; // grass creeping onto sand
        if (!color) continue;
        g.fillStyle = color;
        const th = 4;
        if (dy === -1) g.fillRect(px, py, CELL_PX, th);
        else if (dy === 1) g.fillRect(px, py + CELL_PX - th, CELL_PX, th);
        else if (dx === -1) g.fillRect(px, py, th, CELL_PX);
        else g.fillRect(px + CELL_PX - th, py, th, CELL_PX);
      }
      // Rounded water corners.
      if (t !== Terrain.Water) {
        const corners: Array<[number, number, number, number]> = [
          [-1, -1, 0, 0],
          [1, -1, CELL_PX, 0],
          [1, 1, CELL_PX, CELL_PX],
          [-1, 1, 0, CELL_PX],
        ];
        for (const [cx, cy, ox, oy] of corners) {
          if (at(x + cx, y) === Terrain.Water && at(x, y + cy) === Terrain.Water) {
            g.fillStyle = TERRAIN_COLORS[Terrain.Water] as string;
            g.beginPath();
            g.arc(px + ox, py + oy, 7, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
    }
  }
  terrainCache = c;
  terrainCacheKey = key;
  return c;
}

export function render(view: GameView, alphaMs: number): void {
  const { ctx, state, cam } = view;
  const m = state.map;
  const t = view.now / 1000;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cam.width, cam.height);

  const terrain = buildTerrainCache(state);
  const sx = Math.floor(cam.x);
  const sy = Math.floor(cam.y);
  ctx.drawImage(terrain, sx, sy, cam.width, cam.height, 0, 0, cam.width, cam.height);

  // Visible tile bounds.
  const tx0 = Math.max(0, Math.floor(cam.x / CELL_PX));
  const ty0 = Math.max(0, Math.floor(cam.y / CELL_PX));
  const tx1 = Math.min(m.width - 1, Math.ceil((cam.x + cam.width) / CELL_PX));
  const ty1 = Math.min(m.height - 1, Math.ceil((cam.y + cam.height) / CELL_PX));
  const fog = state.fog[view.localPlayer] as Uint8Array;

  // Water shimmer + ore.
  for (let y = ty0; y <= ty1; y++) {
    for (let x = tx0; x <= tx1; x++) {
      const i = idx(m, x, y);
      if (fog[i] === 0) continue;
      const px = x * CELL_PX - cam.x;
      const py = y * CELL_PX - cam.y;
      if (m.terrain[i] === Terrain.Water) {
        const w = Math.sin(t * 2 + x * 0.7 + y * 1.3) * 0.5 + 0.5;
        ctx.fillStyle = `rgba(120,170,220,${0.08 + w * 0.08})`;
        ctx.fillRect(px, py + ((y + Math.floor(t * 2)) % 3) * 8, CELL_PX, 3);
      }
      const ore = m.ore[i] as number;
      if (ore > 0) {
        const gem = m.gems[i] === 1;
        const n = Math.min(6, Math.ceil(ore / 2));
        for (let k = 0; k < n; k++) {
          const h = ((x * 31 + y * 17 + k * 7) % 13) / 13;
          const ox = 3 + ((k * 5 + x) % 4) * 5 + h * 3;
          const oy = 3 + Math.floor(k / 2) * 7 + ((y + k) % 3) * 2;
          ctx.fillStyle = gem ? (k % 2 ? "#7ff" : "#3cc") : k % 2 ? "#e0b040" : "#c89a2a";
          ctx.fillRect(px + ox, py + oy, 3, 3);
        }
      }
    }
  }

  // Craters and scorch marks left by explosions (view-only decals).
  for (let i = view.decals.length - 1; i >= 0; i--) {
    const d = view.decals[i] as { x: number; y: number; r: number; born: number };
    const age = view.now - d.born;
    if (age > 60000) {
      view.decals.splice(i, 1);
      continue;
    }
    const [dx, dy] = toScreen(view, d.x, d.y);
    if (dx < -40 || dy < -40 || dx > cam.width + 40 || dy > cam.height + 40) continue;
    const tx = worldToTile(d.x);
    const ty = worldToTile(d.y);
    if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height || fog[idx(m, tx, ty)] === 0) continue;
    ctx.globalAlpha = Math.min(0.55, (60000 - age) / 60000);
    ctx.fillStyle = "#1a1a14";
    ctx.beginPath();
    ctx.ellipse(dx, dy, d.r, d.r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Crates.
  for (const c of state.crates) {
    if (fog[idx(m, c.tx, c.ty)] !== 2) continue;
    ctx.save();
    ctx.translate(c.tx * CELL_PX - cam.x + CELL_PX / 2, c.ty * CELL_PX - cam.y + CELL_PX / 2);
    drawCrate(ctx, t + c.tx);
    ctx.restore();
  }

  // Placement / base radius hint.
  if (view.placing) drawPlacement(view);
  if (view.placing && view.wallDrag) drawWallLine(view);

  // Actors, sorted so structures draw first, then ground, then air.
  const list = state.actorList;
  const structures: Actor[] = [];
  const husks: Actor[] = [];
  const ground: Actor[] = [];
  const air: Actor[] = [];
  const projectiles: Actor[] = [];
  for (const a of list) {
    if (a.inside >= 0) continue;
    if (!isRevealed(state, fog, a)) continue;
    if (a.kind === "structure") structures.push(a);
    else if (a.kind === "husk") husks.push(a);
    else if (a.kind === "projectile") projectiles.push(a);
    else if (a.loco === "air") air.push(a);
    else ground.push(a);
  }
  const selected = new Set(view.selection);
  for (const a of structures) drawStructureActor(view, a, t, selected.has(a.id));
  for (const a of husks) drawHusk(view, a);
  for (const a of ground) drawUnit(view, a, t, selected.has(a.id), alphaMs);
  for (const a of projectiles) drawProjectile(view, a);
  drawEffects(view, false);
  for (const a of air) drawUnit(view, a, t, selected.has(a.id), alphaMs);
  drawEffects(view, true);

  // Fog overlay.
  for (let y = ty0; y <= ty1; y++) {
    for (let x = tx0; x <= tx1; x++) {
      const f = fog[idx(m, x, y)];
      if (f === 2) continue;
      ctx.fillStyle = f === 0 ? "#000" : "rgba(0,0,0,0.45)";
      ctx.fillRect(x * CELL_PX - cam.x, y * CELL_PX - cam.y, CELL_PX, CELL_PX);
    }
  }

  // Rally point of a selected producer.
  for (const a of view.selectedActors()) {
    if (a.kind === "structure" && a.rally && a.owner === view.localPlayer) {
      const [ax, ay] = toScreen(view, a.x, a.y);
      const [rx, ry] = toScreen(view, a.rally.x, a.rally.y);
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(rx, ry);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#ff0";
      ctx.fillRect(rx - 3, ry - 3, 6, 6);
    }
  }

  // Drag box.
  if (view.drag) {
    const d = view.drag;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.min(d.x0, d.x1) + 0.5, Math.min(d.y0, d.y1) + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
  }

  // Mode cursor hint.
  if (view.mode !== "normal" || view.placing) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(8, 8, 200, 24);
    ctx.fillStyle = "#fff";
    ctx.font = "13px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const label = view.placing ? `Place ${state.rules.structures[view.placing]?.name ?? ""} (Esc cancels)` : view.mode === "sell" ? "Sell: click a structure" : view.mode === "repair" ? "Repair: click a structure" : view.mode === "attackMove" ? "Attack-move: click target" : view.mode === "force" ? "Force fire: click target" : `${view.superweapon}: choose target`;
    ctx.fillText(label, 14, 20);
  }

  // Toasts.
  ctx.font = "13px system-ui, sans-serif";
  ctx.textAlign = "left";
  let ty = cam.height - 16;
  for (let i = view.messages.length - 1; i >= 0; i--) {
    const msg = view.messages[i] as { text: string; born: number };
    const age = view.now - msg.born;
    if (age > 6000) {
      view.messages.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = Math.min(1, (6000 - age) / 1000);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(8, ty - 10, ctx.measureText(msg.text).width + 12, 20);
    ctx.fillStyle = "#ffd";
    ctx.textBaseline = "middle";
    ctx.fillText(msg.text, 14, ty);
    ty -= 24;
  }
  ctx.globalAlpha = 1;
  if (view.paused) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, cam.width, cam.height);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("PAUSED", cam.width / 2, cam.height / 2);
  }
  ctx.restore();
}

function isRevealed(state: SimState, fog: Uint8Array, a: Actor): boolean {
  const m = state.map;
  if (a.kind === "structure") {
    // Structures stay visible once seen (explored), like the classic.
    for (let y = a.ty; y < a.ty + a.h; y++) for (let x = a.tx; x < a.tx + a.w; x++) if (x >= 0 && y >= 0 && x < m.width && y < m.height && (fog[idx(m, x, y)] as number) >= 1) return true;
    return false;
  }
  const tx = worldToTile(a.x);
  const ty = worldToTile(a.y);
  if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height) return false;
  return fog[idx(m, tx, ty)] === 2;
}

function toScreen(view: GameView, wx: number, wy: number): [number, number] {
  return [worldToPx(wx) - view.cam.x, worldToPx(wy) - view.cam.y];
}

function drawStructureActor(view: GameView, a: Actor, t: number, selected: boolean): void {
  const { ctx, state } = view;
  const def = state.rules.structures[a.type];
  if (!def) return;
  const [sx, sy] = toScreen(view, a.x, a.y);
  const st = styleFor(state, a.owner);
  const showType = def.fake && a.owner !== view.localPlayer ? def.fake : a.type;
  const fdef = state.rules.structures[showType] ?? def;
  if (a.cloaked && a.owner !== view.localPlayer && state.tick >= a.revealedUntil && a.cooldown.every((c) => c === 0)) return;
  ctx.save();
  ctx.translate(sx, sy);
  if (a.cloaked && a.owner === view.localPlayer) ctx.globalAlpha = 0.6;
  drawStructure(ctx, showType, fdef.footprint[0], fdef.footprint[1], st, a.buildup, a.hp / a.maxHp, t, a.disabled);
  ctx.globalAlpha = 1;
  if (a.hp < a.maxHp * 0.25 && a.buildup >= 1) {
    // Fire at red health.
    for (let k = 0; k < 3; k++) {
      const fx = ((a.id * 13 + k * 29) % Math.max(1, a.w * CELL_PX - 8)) - (a.w * CELL_PX) / 2 + 4;
      const fy = ((a.id * 7 + k * 17) % Math.max(1, a.h * CELL_PX - 8)) - (a.h * CELL_PX) / 2 + 4;
      const fl = 3 + Math.sin(t * 10 + k * 2 + a.id) * 1.5;
      ctx.fillStyle = "rgba(255,120,30,0.85)";
      ctx.beginPath();
      ctx.arc(fx, fy - fl, fl, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,230,120,0.9)";
      ctx.beginPath();
      ctx.arc(fx, fy - fl, fl * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  drawTurret(ctx, showType, a.turretFacing, st, a.disabled, t);
  if (a.selling) {
    ctx.fillStyle = "rgba(255,220,80,0.5)";
    ctx.fillRect(-a.w * 12, -a.h * 12, a.w * 24, a.h * 24 * (a.sellTimer / 30));
  }
  if (a.repairing && Math.floor(t * 3) % 2 === 0) {
    ctx.fillStyle = "#fd0";
    ctx.fillRect(-2, -10, 4, 20);
    ctx.fillRect(-10, -2, 20, 4);
  }
  if (a.primary) {
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("PRIMARY", 0, -a.h * 12 - 4);
  }
  ctx.restore();
  // Smoke when damaged.
  if (a.hp < a.maxHp * 0.5 && a.buildup >= 1) {
    const k = Math.floor(t * 4 + a.id) % 4;
    ctx.fillStyle = `rgba(60,60,60,${0.5 - k * 0.1})`;
    ctx.beginPath();
    ctx.arc(sx - a.w * 4 + ((a.id * 7) % 9), sy - a.h * 6 - k * 4, 4 + k * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (selected) drawSelection(view, a, a.w * CELL_PX, a.h * CELL_PX);
}

function drawHusk(view: GameView, a: Actor): void {
  const { ctx } = view;
  const [sx, sy] = toScreen(view, a.x, a.y);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.globalAlpha = Math.min(1, a.huskTtl / 200);
  drawVehicle(ctx, a.type, a.facing, a.turretFacing, teamStyle("#3a3a3a"), 0);
  ctx.restore();
}

function drawUnit(view: GameView, a: Actor, t: number, selected: boolean, alphaMs: number): void {
  const { ctx, state } = view;
  const def = state.rules.units[a.type];
  if (!def) return;
  void alphaMs;
  const [sx, sy] = toScreen(view, a.x, a.y);
  const st = styleFor(state, a.owner);
  const mine = a.owner === view.localPlayer;
  if (a.cloaked && !mine && state.tick >= a.revealedUntil) return;
  ctx.save();
  ctx.translate(sx, sy);
  if (a.cloaked && mine) ctx.globalAlpha = 0.55;
  if (a.charge > 0) {
    ctx.strokeStyle = "rgba(255,80,80,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.stroke();
  }
  const walk = a.moveGoal ? t * 12 + a.id : 0;
  switch (def.class) {
    case "infantry": {
      // Spies are disguised: everyone else sees a rifleman in their own colours.
      const disguised = def.spy && !mine;
      drawInfantry(ctx, disguised ? "rifle" : a.type, a.facing, disguised ? styleFor(state, view.localPlayer) : st, a.prone, walk);
      break;
    }
    case "aircraft":
      ctx.translate(0, -10);
      drawAircraft(ctx, a.type, a.facing, st, t);
      break;
    case "ship":
      drawShip(ctx, a.type, a.facing, st, a.cloaked);
      break;
    default:
      drawVehicle(ctx, a.type, a.facing, a.turretFacing, st, a.hp / a.maxHp);
      if (a.harvester && a.harvester.cargo + a.harvester.gems > 0) {
        ctx.save();
        ctx.rotate(facingToRadians(a.facing));
        ctx.fillStyle = a.harvester.gems > 0 ? "#5ee" : "#f0c050";
        const fill = (a.harvester.cargo + a.harvester.gems) / (def.harvester?.capacity ?? 20);
        ctx.fillRect(-4, -2, 8, 7 * fill);
        ctx.restore();
      }
  }
  ctx.restore();
  if (selected) drawSelection(view, a, def.class === "infantry" ? 14 : 24, def.class === "infantry" ? 14 : 24);
  if (selected && def.ammo > 0) {
    // Ammo pips under the health bar.
    const w = 24;
    const pip = Math.max(2, Math.floor((w - 2) / def.ammo) - 1);
    for (let k = 0; k < def.ammo; k++) {
      ctx.fillStyle = k < a.ammo ? "#4cf" : "#333";
      ctx.fillRect(sx - w / 2 + 1 + k * (pip + 1), sy + 14, pip, 2);
    }
  }
  if (mine && def.phaseJump > 0 && state.tick < a.revealedUntil) {
    ctx.strokeStyle = "rgba(80,220,255,0.7)";
    ctx.beginPath();
    ctx.arc(sx, sy, 15, 0, Math.PI * 2 * (1 - (a.revealedUntil - state.tick) / (20 * 30)));
    ctx.stroke();
  }
  if (a.cargo.length > 0) {
    ctx.fillStyle = "#fff";
    ctx.font = "9px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(String(a.cargo.length), sx, sy - 14);
  }
}

function drawSelection(view: GameView, a: Actor, w: number, h: number): void {
  const { ctx } = view;
  const [sx, sy] = toScreen(view, a.x, a.y);
  const x = sx - w / 2;
  const y = sy - h / 2;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1;
  const c = Math.min(6, w / 3);
  ctx.beginPath();
  for (const [cx, cy, dx, dy] of [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ] as Array<[number, number, number, number]>) {
    ctx.moveTo(cx + 0.5, cy + dy * c + 0.5);
    ctx.lineTo(cx + 0.5, cy + 0.5);
    ctx.lineTo(cx + dx * c + 0.5, cy + 0.5);
  }
  ctx.stroke();
  // Health bar.
  const frac = a.hp / a.maxHp;
  ctx.fillStyle = "#000";
  ctx.fillRect(x, y - 6, w, 4);
  ctx.fillStyle = frac > 0.5 ? "#3c3" : frac > 0.25 ? "#fc0" : "#e33";
  ctx.fillRect(x + 1, y - 5, (w - 2) * frac, 2);
}

function drawProjectile(view: GameView, a: Actor): void {
  const { ctx, state } = view;
  if (!a.proj) return;
  const w = state.rules.weapons[a.proj.weapon];
  const [sx, sy0] = toScreen(view, a.x, a.y);
  let sy = sy0;
  const kind = w?.projectile ?? "bullet";
  if (kind === "shell") {
    // Parabolic arc for visuals only.
    const f = a.proj.arcTotal > 0 ? a.proj.arcT / a.proj.arcTotal : 1;
    sy -= Math.sin(Math.min(1, f) * Math.PI) * Math.min(60, a.proj.arcTotal * 2);
  }
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(facingToRadians(a.facing));
  if (a.proj.weapon === "nukeBlast") {
    ctx.fillStyle = "#eee";
    ctx.fillRect(-3, -14, 6, 28);
    ctx.fillStyle = "#e33";
    ctx.fillRect(-3, -14, 6, 6);
  } else if (kind === "missile" || kind === "torpedo") {
    ctx.fillStyle = "#ddd";
    ctx.fillRect(-1.5, -6, 3, 10);
    ctx.fillStyle = "#f93";
    ctx.fillRect(-1.5, 4, 3, 4);
  } else if (kind === "flame") {
    ctx.fillStyle = `rgba(255,${120 + Math.floor(Math.random() * 80)},40,0.9)`;
    ctx.beginPath();
    ctx.arc(0, 0, 4 + Math.random() * 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "shell") {
    ctx.fillStyle = "#333";
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = "#ffd";
    ctx.fillRect(-1, -4, 2, 6);
  }
  ctx.restore();
}

function drawEffects(view: GameView, above: boolean): void {
  const { ctx } = view;
  const now = view.now;
  for (let i = view.effects.length - 1; i >= 0; i--) {
    const e = view.effects[i] as { kind: string; x: number; y: number; size: number; born: number; dur: number; facing?: number; text?: string; color?: string };
    const age = now - e.born;
    if (age > e.dur) {
      view.effects.splice(i, 1);
      continue;
    }
    if ((e.kind === "explosion" && e.size >= 2) !== above && e.kind === "explosion" && e.size < 2 && above) continue;
    const f = age / e.dur;
    const [sx, sy] = toScreen(view, e.x, e.y);
    if (e.kind === "explosion") {
      const r = (6 + e.size * 10) * (0.4 + f * 0.9);
      ctx.globalAlpha = 1 - f;
      ctx.fillStyle = e.size >= 4 ? "#fff" : "#ffb030";
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e04010";
      ctx.beginPath();
      ctx.arc(sx, sy, r * 0.6, 0, Math.PI * 2);
      ctx.fill();
      if (e.size >= 2) {
        ctx.fillStyle = "rgba(50,50,50,0.6)";
        ctx.beginPath();
        ctx.arc(sx + f * 6, sy - f * 20, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (e.kind === "muzzle" && !above) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(facingToRadians(e.facing ?? 0));
      ctx.fillStyle = "#ffe080";
      ctx.beginPath();
      ctx.arc(0, -12, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (e.kind === "ring" && !above) {
      ctx.strokeStyle = e.color ?? "#0f0";
      ctx.globalAlpha = 1 - f;
      ctx.beginPath();
      ctx.arc(sx, sy, 4 + f * 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (e.kind === "text") {
      ctx.fillStyle = e.color ?? "#fff";
      ctx.font = "bold 12px system-ui";
      ctx.textAlign = "center";
      ctx.globalAlpha = 1 - f;
      ctx.fillText(e.text ?? "", sx, sy - f * 20);
      ctx.globalAlpha = 1;
    }
  }
}

function drawPlacement(view: GameView): void {
  const { ctx, state, cam } = view;
  const type = view.placing;
  if (!type) return;
  const def = state.rules.structures[type];
  if (!def || view.hoverTx < 0) return;
  const [w, h] = def.footprint;
  const tx = view.hoverTx - Math.floor(w / 2);
  const ty = view.hoverTy - Math.floor(h / 2);
  const ok = canPlace(state, view.localPlayer, type, tx, ty);
  // Per-cell legality tint.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = tx + x;
      const cy = ty + y;
      ctx.fillStyle = ok ? "rgba(80,255,80,0.35)" : "rgba(255,60,60,0.4)";
      ctx.fillRect(cx * CELL_PX - cam.x, cy * CELL_PX - cam.y, CELL_PX, CELL_PX);
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.strokeRect(cx * CELL_PX - cam.x + 0.5, cy * CELL_PX - cam.y + 0.5, CELL_PX - 1, CELL_PX - 1);
    }
  }
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.translate((tx + w / 2) * CELL_PX - cam.x, (ty + h / 2) * CELL_PX - cam.y);
  drawStructure(ctx, type, w, h, styleFor(state, view.localPlayer), 1, 1, 0, false);
  ctx.restore();
}

function drawWallLine(view: GameView): void {
  const { ctx, cam } = view;
  if (!view.wallDrag || !view.placing) return;
  for (const [tx, ty] of wallCells(view)) {
    const ok = canPlace(view.state, view.localPlayer, view.placing, tx, ty);
    ctx.fillStyle = ok ? "rgba(80,255,80,0.35)" : "rgba(255,60,60,0.4)";
    ctx.fillRect(tx * CELL_PX - cam.x, ty * CELL_PX - cam.y, CELL_PX, CELL_PX);
  }
}

/** Cells along the L-shaped line from the wall drag start to the hover cell. */
export function wallCells(view: GameView): Array<[number, number]> {
  const d = view.wallDrag;
  if (!d) return [];
  const out: Array<[number, number]> = [];
  const x0 = d.tx;
  const y0 = d.ty;
  const x1 = view.hoverTx;
  const y1 = view.hoverTy;
  const sx = Math.sign(x1 - x0) || 1;
  const sy = Math.sign(y1 - y0) || 1;
  if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) {
    for (let x = x0; x !== x1 + sx; x += sx) out.push([x, y0]);
    for (let y = y0 + sy; y !== y1 + sy; y += sy) out.push([x1, y]);
  } else {
    for (let y = y0; y !== y1 + sy; y += sy) out.push([x0, y]);
    for (let x = x0 + sx; x !== x1 + sx; x += sx) out.push([x, y1]);
  }
  return out.slice(0, 40);
}

/** Ghost outline for the base radius shown while placing (cheap approximation). */
export function placementOrigin(view: GameView): [number, number] | null {
  const type = view.placing;
  if (!type) return null;
  const def = view.state.rules.structures[type];
  if (!def) return null;
  const [w, h] = def.footprint;
  return [view.hoverTx - Math.floor(w / 2), view.hoverTy - Math.floor(h / 2)];
}

export { LEPTONS_PER_CELL };
