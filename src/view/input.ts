// Mouse and keyboard handling. Converts screen input into selection changes,
// camera moves, and sim commands (queued on the GameView, applied next tick).

import { CELL_PX, LEPTONS_PER_CELL, screenToTile, screenToWorld, worldToPx } from "../sim/coords";
import { idx, inBounds } from "../sim/map";
import type { Actor } from "../sim/types";
import type { GameView } from "./game";
import { wallCells } from "./renderer";
import { KeyBindings } from "./keys";

export const keyBindings = new KeyBindings();

const EDGE = 18;
const SCROLL_SPEED = 900; // px per second

export interface InputState {
  keys: Set<string>;
  edgeX: number;
  edgeY: number;
  lastClick: number;
  lastClickId: number;
}

export function attachInput(view: GameView): InputState {
  const canvas = view.canvas;
  const input: InputState = { keys: new Set(), edgeX: 0, edgeY: 0, lastClick: 0, lastClickId: -1 };
  canvas.oncontextmenu = (e) => e.preventDefault();

  const pos = (e: MouseEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) * canvas.width) / r.width, ((e.clientY - r.top) * canvas.height) / r.height];
  };

  canvas.addEventListener("pointerdown", (e) => {
    view.audio.unlock();
    const [sx, sy] = pos(e);
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1) {
      view.drag = null;
      input.keys.add("__pan");
      return;
    }
    if (e.button === 0) {
      if (view.placing) {
        const def = view.state.rules.structures[view.placing];
        if (!def) return;
        if (def.wall || def.gate) {
          // Walls are line-drawn: press starts the line, release places it.
          view.wallDrag = { tx: view.hoverTx, ty: view.hoverTy };
          return;
        }
        const [w, h] = def.footprint;
        const tx = view.hoverTx - Math.floor(w / 2);
        const ty = view.hoverTy - Math.floor(h / 2);
        view.issue({ kind: "place", type: view.placing, tx, ty } as never);
        view.placing = null;
        return;
      }
      if (view.mode !== "normal") {
        handleModeClick(view, sx, sy);
        return;
      }
      view.drag = { x0: sx, y0: sy, x1: sx, y1: sy };
      return;
    }
    if (e.button === 2) {
      if (view.placing) {
        view.placing = null;
        return;
      }
      if (view.mode !== "normal") {
        view.mode = "normal";
        return;
      }
      contextCommand(view, sx, sy, e.shiftKey, e.ctrlKey || e.metaKey, e.altKey);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const [sx, sy] = pos(e);
    if (input.keys.has("__pan")) {
      view.cam.x -= e.movementX;
      view.cam.y -= e.movementY;
      view.clampCamera();
    }
    view.mouseX = sx;
    view.mouseY = sy;
    const [tx, ty] = screenToTile(view.cam, sx, sy);
    view.hoverTx = tx;
    view.hoverTy = ty;
    if (view.drag) {
      view.drag.x1 = sx;
      view.drag.y1 = sy;
    }
    // Edge scroll only while the pointer is inside the canvas.
    input.edgeX = sx < EDGE ? -1 : sx > canvas.width - EDGE ? 1 : 0;
    input.edgeY = sy < EDGE ? -1 : sy > canvas.height - EDGE ? 1 : 0;
  });
  canvas.addEventListener("pointerleave", () => {
    input.edgeX = 0;
    input.edgeY = 0;
  });

  canvas.addEventListener("pointerup", (e) => {
    if (e.button === 1) {
      input.keys.delete("__pan");
      return;
    }
    if (e.button === 0 && view.wallDrag && view.placing) {
      const cells = wallCells(view);
      view.issue({ kind: "placeWall", type: view.placing, cells } as never);
      view.wallDrag = null;
      return;
    }
    if (e.button !== 0 || !view.drag) return;
    const d = view.drag;
    view.drag = null;
    const w = Math.abs(d.x1 - d.x0);
    const h = Math.abs(d.y1 - d.y0);
    if (w < 4 && h < 4) clickSelect(view, input, d.x1, d.y1, e.shiftKey);
    else boxSelect(view, Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), w, h, e.shiftKey);
  });

  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
    input.keys.add(e.key);
    if (handleKey(view, e)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => input.keys.delete(e.key));
  window.addEventListener("blur", () => input.keys.clear());
  return input;
}

/** Called each frame to apply edge/keyboard scrolling. */
export function updateCamera(view: GameView, input: InputState, dtMs: number): void {
  const step = (SCROLL_SPEED * view.settings.scrollSpeed * dtMs) / 1000;
  let dx = view.settings.edgeScroll ? input.edgeX : 0;
  let dy = view.settings.edgeScroll ? input.edgeY : 0;
  if (input.keys.has("ArrowLeft")) dx -= 1;
  if (input.keys.has("ArrowRight")) dx += 1;
  if (input.keys.has("ArrowUp")) dy -= 1;
  if (input.keys.has("ArrowDown")) dy += 1;
  if (dx || dy) {
    view.cam.x += dx * step;
    view.cam.y += dy * step;
    view.clampCamera();
  }
}

function actorAt(view: GameView, sx: number, sy: number, ownOnly = false): Actor | null {
  const [wx, wy] = screenToWorld(view.cam, sx, sy);
  const fog = view.state.fog[view.localPlayer] as Uint8Array;
  const m = view.state.map;
  let best: Actor | null = null;
  let bestD = Infinity;
  for (const a of view.state.actorList) {
    if (a.kind === "projectile" || a.kind === "husk" || a.inside >= 0) continue;
    if (ownOnly && a.owner !== view.localPlayer) continue;
    if (a.kind === "structure") {
      const x0 = a.tx * LEPTONS_PER_CELL;
      const y0 = a.ty * LEPTONS_PER_CELL;
      if (wx >= x0 && wy >= y0 && wx < x0 + a.w * LEPTONS_PER_CELL && wy < y0 + a.h * LEPTONS_PER_CELL) {
        const tx = Math.floor(wx / LEPTONS_PER_CELL);
        const ty = Math.floor(wy / LEPTONS_PER_CELL);
        if (inBounds(m, tx, ty) && (fog[idx(m, tx, ty)] as number) >= 1) return a;
      }
      continue;
    }
    if (a.cloaked && a.owner !== view.localPlayer) continue;
    const tx = Math.floor(a.x / LEPTONS_PER_CELL);
    const ty = Math.floor(a.y / LEPTONS_PER_CELL);
    if (!inBounds(m, tx, ty) || fog[idx(m, tx, ty)] !== 2) continue;
    const r = a.loco === "air" ? 160 : 140;
    const d = Math.hypot(a.x - wx, a.y - (a.loco === "air" ? wy + 100 : wy));
    if (d < r && d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

function clickSelect(view: GameView, input: InputState, sx: number, sy: number, shift: boolean): void {
  const a = actorAt(view, sx, sy);
  const now = performance.now();
  const dbl = a && now - input.lastClick < 350 && input.lastClickId === a.id;
  input.lastClick = now;
  input.lastClickId = a ? a.id : -1;
  if (!a) {
    if (!shift) view.selection = [];
    return;
  }
  if (a.owner !== view.localPlayer) {
    view.selection = [a.id];
    return;
  }
  if (dbl && a.kind === "unit") {
    // Select all of the same type on screen.
    const ids: number[] = [];
    for (const b of view.state.actorList) {
      if (b.owner !== view.localPlayer || b.type !== a.type || b.kind !== "unit" || b.inside >= 0) continue;
      if (view.visible(b.x, b.y)) ids.push(b.id);
    }
    view.selection = ids;
    view.audio.ack(a.type);
    return;
  }
  if (shift) {
    if (view.selection.includes(a.id)) view.selection = view.selection.filter((i) => i !== a.id);
    else view.selection = [...view.selection.filter((i) => view.state.actors.get(i)?.kind === a.kind), a.id];
  } else view.selection = [a.id];
  view.audio.ack(a.type);
}

function boxSelect(view: GameView, x: number, y: number, w: number, h: number, shift: boolean): void {
  const ids: number[] = shift ? [...view.selection] : [];
  for (const a of view.state.actorList) {
    if (a.kind !== "unit" || a.owner !== view.localPlayer || a.inside >= 0) continue;
    const sx = worldToPx(a.x) - view.cam.x;
    const sy = worldToPx(a.y) - view.cam.y;
    if (sx >= x && sy >= y && sx <= x + w && sy <= y + h && !ids.includes(a.id)) ids.push(a.id);
  }
  // Prefer combat units over harvesters when both are boxed.
  const combat = ids.filter((id) => !view.state.actors.get(id)?.harvester);
  view.selection = combat.length > 0 && combat.length < ids.length ? combat : ids;
  if (view.selection.length) {
    const first = view.state.actors.get(view.selection[0] as number);
    if (first) view.audio.ack(first.type);
  }
}

function handleModeClick(view: GameView, sx: number, sy: number): void {
  const [wx, wy] = screenToWorld(view.cam, sx, sy);
  const units = view.selectedUnits().map((a) => a.id);
  switch (view.mode) {
    case "sell": {
      const a = actorAt(view, sx, sy, true);
      if (a && a.kind === "structure") view.issue({ kind: "sell", actor: a.id } as never);
      return;
    }
    case "repair": {
      const a = actorAt(view, sx, sy, true);
      if (a && a.kind === "structure") view.issue({ kind: "repair", actor: a.id } as never);
      return;
    }
    case "attackMove":
      if (units.length) view.issue({ kind: "attackMove", actors: units, x: wx, y: wy, queue: false } as never);
      view.mode = "normal";
      view.effects.push({ kind: "ring", x: wx, y: wy, size: 1, born: view.now, dur: 500, color: "#f44" });
      return;
    case "force":
      if (units.length) view.issue({ kind: "force", actors: units, x: wx, y: wy } as never);
      view.mode = "normal";
      return;
    case "superweapon":
      view.issue({ kind: "superweapon", power: view.superweapon, x: wx, y: wy, actors: units } as never);
      view.mode = "normal";
      return;
    case "phase": {
      for (const id of units) {
        const a = view.state.actors.get(id);
        if (a && (view.state.rules.units[a.type]?.phaseJump ?? 0) > 0) view.issue({ kind: "phaseJump", actor: id, x: wx, y: wy } as never);
      }
      view.mode = "normal";
      view.effects.push({ kind: "ring", x: wx, y: wy, size: 1, born: view.now, dur: 500, color: "#5df" });
      return;
    }
    default:
      return;
  }
}

function contextCommand(view: GameView, sx: number, sy: number, shift: boolean, ctrl: boolean, alt: boolean): void {
  const sel = view.selectedActors();
  if (sel.length === 0) return;
  const [wx, wy] = screenToWorld(view.cam, sx, sy);
  const units = sel.filter((a) => a.kind === "unit" && a.owner === view.localPlayer).map((a) => a.id);
  const structures = sel.filter((a) => a.kind === "structure" && a.owner === view.localPlayer);
  if (units.length === 0) {
    // Right-click with a producer selected sets its rally point.
    for (const s of structures) {
      const def = view.state.rules.structures[s.type];
      if (def && def.produces.length > 0) view.issue({ kind: "setRally", actor: s.id, x: wx, y: wy } as never);
    }
    return;
  }
  const target = actorAt(view, sx, sy);
  if (ctrl) {
    if (target) view.issue({ kind: "attack", actors: units, target: target.id, queue: shift } as never);
    else view.issue({ kind: "force", actors: units, x: wx, y: wy } as never);
    view.audio.ackAttack();
    return;
  }
  if (alt) {
    view.issue({ kind: "forceMove", actors: units, x: wx, y: wy, queue: shift } as never);
    view.effects.push({ kind: "ring", x: wx, y: wy, size: 1, born: view.now, dur: 500, color: "#4f4" });
    view.audio.ackMove();
    return;
  }
  if (!target) {
    // Ore under cursor and a harvester selected -> harvest there.
    const [tx, ty] = screenToTile(view.cam, sx, sy);
    const m = view.state.map;
    const harvesters = units.filter((id) => view.state.actors.get(id)?.harvester);
    if (harvesters.length && inBounds(m, tx, ty) && (m.ore[idx(m, tx, ty)] as number) > 0) {
      view.issue({ kind: "harvest", actors: harvesters, tx, ty } as never);
      const rest = units.filter((id) => !harvesters.includes(id));
      if (rest.length) view.issue({ kind: "move", actors: rest, x: wx, y: wy, queue: shift } as never);
    } else view.issue({ kind: "move", actors: units, x: wx, y: wy, queue: shift } as never);
    view.effects.push({ kind: "ring", x: wx, y: wy, size: 1, born: view.now, dur: 500, color: "#4f4" });
    view.audio.ackMove();
    return;
  }
  const own = target.owner === view.localPlayer || (target.owner >= 0 && view.state.players[target.owner]?.team === view.state.players[view.localPlayer]?.team);
  if (own) {
    // Enter transports/depots, heal/repair, or just move next to it.
    view.issue({ kind: "attack", actors: units, target: target.id, queue: shift } as never);
    view.audio.ackMove();
  } else {
    view.issue({ kind: "attack", actors: units, target: target.id, queue: shift } as never);
    view.effects.push({ kind: "ring", x: target.x, y: target.y, size: 1, born: view.now, dur: 500, color: "#f44" });
    view.audio.ackAttack();
  }
}

function handleKey(view: GameView, e: KeyboardEvent): boolean {
  const k = e.key;
  const units = view.selectedUnits().map((a) => a.id);
  const lower = k.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (/^[0-9]$/.test(k)) {
      view.groups.set(Number(k), [...view.selection]);
      view.toast(`Group ${k} assigned`);
      return true;
    }
    return false;
  }
  if (/^[0-9]$/.test(k)) {
    const g = view.groups.get(Number(k));
    if (g) {
      const alive = g.filter((id) => view.state.actors.get(id) && !view.state.actors.get(id)?.dead);
      view.selection = alive;
      if (e.altKey && alive.length) {
        const a = view.state.actors.get(alive[0] as number);
        if (a) view.centerOn(a.x, a.y);
      }
    }
    return true;
  }
  const action = keyBindings.actionFor(lower) ?? (lower === "f1" || lower === "f2" || lower === "f3" || lower === "f4" ? lower : null);
  switch (action) {
    case "cancel":
      view.placing = null;
      view.mode = "normal";
      return true;
    case "stop":
      if (units.length) view.issue({ kind: "stop", actors: units } as never);
      return true;
    case "guard":
      if (units.length) view.issue({ kind: "guard", actors: units } as never);
      return true;
    case "scatter":
      if (units.length) view.issue({ kind: "scatter", actors: units } as never);
      return true;
    case "selectAllCombat": {
      const ids = view.own().filter((a) => a.kind === "unit" && !a.harvester && (view.state.rules.units[a.type]?.weapons.length ?? 0) > 0 && !view.state.rules.units[a.type]?.deploysTo).map((a) => a.id);
      view.selection = ids;
      return true;
    }
    case "nextIdleHarvester": {
      const idle = view.own().filter((a) => a.harvester && (a.harvester.state === "idle" || a.order.kind === "idle"));
      const pick = idle[0] ?? view.own().find((a) => a.harvester);
      if (pick) {
        view.selection = [pick.id];
        view.centerOn(pick.x, pick.y);
      }
      return true;
    }
    case "sell":
      view.mode = view.mode === "sell" ? "normal" : "sell";
      view.placing = null;
      return true;
    case "repair":
      view.mode = view.mode === "repair" ? "normal" : "repair";
      view.placing = null;
      return true;
    case "quickSave":
      document.dispatchEvent(new CustomEvent("im:quicksave"));
      return true;
    case "quickLoad":
      document.dispatchEvent(new CustomEvent("im:quickload"));
      return true;
    case "musicNext":
      document.dispatchEvent(new CustomEvent("im:musicnext"));
      return true;
    case "cycleUnitsTab":
      return false; // sidebar handles Tab itself
    case "deploy": {
      const phasers = units.filter((id) => (view.state.rules.units[view.state.actors.get(id)?.type ?? ""]?.phaseJump ?? 0) > 0);
      if (phasers.length) {
        view.mode = view.mode === "phase" ? "normal" : "phase";
        return true;
      }
      if (units.length) view.issue({ kind: "deploy", actors: units } as never);
      if (units.length) view.issue({ kind: "unload", actors: units } as never);
      return true;
    }
    case "attackMove":
      if (units.length) view.mode = view.mode === "attackMove" ? "normal" : "attackMove";
      return true;
    case "forceFire":
      if (units.length) view.mode = view.mode === "force" ? "normal" : "force";
      return true;
    case "home": {
      const yard = view.own().find((a) => a.type === "conyard") ?? view.own()[0];
      if (yard) view.centerOn(yard.x, yard.y);
      return true;
    }
    case "lastEvent":
      view.jumpToLastEvent();
      return true;
    case "pause":
      view.paused = !view.paused;
      return true;
    case "speedUp":
      view.speed = Math.min(4, view.speed + 0.5);
      view.toast(`Speed ${view.speed}x`);
      return true;
    case "speedDown":
      view.speed = Math.max(0.5, view.speed - 0.5);
      view.toast(`Speed ${view.speed}x`);
      return true;
    case "f1":
    case "f2":
    case "f3":
    case "f4": {
      const i = Number(lower[1]) - 1;
      if (e.shiftKey) {
        view.bookmarks[i] = { x: view.cam.x, y: view.cam.y };
        view.toast(`Bookmark ${i + 1} set`);
      } else {
        const b = view.bookmarks[i];
        if (b) {
          view.cam.x = b.x;
          view.cam.y = b.y;
          view.clampCamera();
        }
      }
      return true;
    }
    default:
      return false;
  }
}

export { CELL_PX };
