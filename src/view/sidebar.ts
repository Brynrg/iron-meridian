// Classic right-hand sidebar: radar minimap, credits ticker, power bar,
// two build columns with tabs, repair/sell/superweapon buttons. Plain DOM +
// small canvases; refreshed a few times per second from sim state.

import { CELL_PX, worldToPx } from "../sim/coords";
import { Terrain, idx } from "../sim/map";
import { buildableTypes } from "../sim/state";
import type { QueueKind } from "../data/schemas";
import type { GameView } from "./game";
import { drawIcon, teamStyle } from "./sprites";

const LEFT_TABS: QueueKind[] = ["building", "defense"];
const RIGHT_TABS: QueueKind[] = ["infantry", "vehicle", "aircraft", "ship"];
const TAB_LABEL: Record<QueueKind, string> = { building: "Structures", defense: "Defenses", infantry: "Infantry", vehicle: "Vehicles", aircraft: "Aircraft", ship: "Ships" };

interface ButtonEl {
  root: HTMLButtonElement;
  icon: HTMLCanvasElement;
  progress: HTMLDivElement;
  count: HTMLDivElement;
  label: HTMLDivElement;
  type: string;
  queue: QueueKind;
}

export class Sidebar {
  root: HTMLElement;
  radar: HTMLCanvasElement;
  credits: HTMLDivElement;
  shownCredits = 0;
  powerBar: HTMLDivElement;
  powerFill: HTMLDivElement;
  powerText: HTMLDivElement;
  leftTab: QueueKind = "building";
  rightTab: QueueKind = "infantry";
  leftTabs: HTMLDivElement;
  rightTabs: HTMLDivElement;
  leftGrid: HTMLDivElement;
  rightGrid: HTMLDivElement;
  buttons = new Map<string, ButtonEl>();
  lastRefresh = 0;
  repairBtn: HTMLButtonElement;
  sellBtn: HTMLButtonElement;
  primaryBtn: HTMLButtonElement;
  swRow: HTMLDivElement;
  status: HTMLDivElement;
  view: GameView;

  constructor(view: GameView, parent: HTMLElement) {
    this.view = view;
    this.root = el("aside", "sidebar");
    parent.appendChild(this.root);
    // Radar
    const radarWrap = el("div", "radar-wrap");
    this.radar = document.createElement("canvas");
    this.radar.width = 184;
    this.radar.height = 184;
    this.radar.className = "radar";
    radarWrap.appendChild(this.radar);
    this.root.appendChild(radarWrap);
    this.radar.addEventListener("pointerdown", (e) => this.radarClick(e));
    this.radar.addEventListener("pointermove", (e) => {
      if (e.buttons & 1) this.radarClick(e);
    });
    this.radar.oncontextmenu = (e) => e.preventDefault();
    // Credits + power
    const stats = el("div", "stats");
    this.credits = el("div", "credits") as HTMLDivElement;
    this.credits.textContent = "0";
    stats.appendChild(this.credits);
    this.powerBar = el("div", "power") as HTMLDivElement;
    this.powerFill = el("div", "power-fill") as HTMLDivElement;
    this.powerText = el("div", "power-text") as HTMLDivElement;
    this.powerBar.appendChild(this.powerFill);
    this.powerBar.appendChild(this.powerText);
    stats.appendChild(this.powerBar);
    this.root.appendChild(stats);
    // Repair / Sell / options
    const tools = el("div", "tools");
    this.repairBtn = button("Repair", () => this.toggleMode("repair"));
    this.sellBtn = button("Sell", () => this.toggleMode("sell"));
    tools.appendChild(this.repairBtn);
    tools.appendChild(this.sellBtn);
    this.primaryBtn = button("Primary", () => {
      const s = this.view.selectedActors().find((a) => a.kind === "structure" && (this.view.state.rules.structures[a.type]?.produces.length ?? 0) > 0);
      if (s) this.view.issue({ kind: "setPrimary", actor: s.id } as never);
    });
    tools.appendChild(this.primaryBtn);
    tools.appendChild(button("Menu", () => document.dispatchEvent(new CustomEvent("im:menu"))));
    this.root.appendChild(tools);
    this.swRow = el("div", "sw-row") as HTMLDivElement;
    this.root.appendChild(this.swRow);
    // Build columns
    const cols = el("div", "cols");
    const left = el("div", "col");
    const right = el("div", "col");
    this.leftTabs = el("div", "tabs") as HTMLDivElement;
    this.rightTabs = el("div", "tabs") as HTMLDivElement;
    this.leftGrid = el("div", "grid") as HTMLDivElement;
    this.rightGrid = el("div", "grid") as HTMLDivElement;
    left.appendChild(this.leftTabs);
    left.appendChild(this.leftGrid);
    right.appendChild(this.rightTabs);
    right.appendChild(this.rightGrid);
    cols.appendChild(left);
    cols.appendChild(right);
    this.root.appendChild(cols);
    this.status = el("div", "status") as HTMLDivElement;
    this.root.appendChild(this.status);
    this.buildTabs();
    window.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) this.leftTab = LEFT_TABS[(LEFT_TABS.indexOf(this.leftTab) + 1) % LEFT_TABS.length] as QueueKind;
        else this.rightTab = RIGHT_TABS[(RIGHT_TABS.indexOf(this.rightTab) + 1) % RIGHT_TABS.length] as QueueKind;
        this.buildTabs();
        this.refresh(true);
      }
    });
  }

  toggleMode(mode: "sell" | "repair"): void {
    this.view.placing = null;
    this.view.mode = this.view.mode === mode ? "normal" : mode;
    this.view.audio.play("click");
  }

  buildTabs(): void {
    this.leftTabs.replaceChildren(...LEFT_TABS.map((q) => tab(TAB_LABEL[q], q === this.leftTab, () => { this.leftTab = q; this.buildTabs(); this.refresh(true); })));
    this.rightTabs.replaceChildren(...RIGHT_TABS.map((q) => tab(TAB_LABEL[q], q === this.rightTab, () => { this.rightTab = q; this.buildTabs(); this.refresh(true); })));
  }

  radarClick(e: PointerEvent): void {
    const v = this.view;
    const p = v.state.players[v.localPlayer];
    if (!p?.radarActive && !v.state.finished) return;
    const r = this.radar.getBoundingClientRect();
    const m = v.state.map;
    const scale = Math.min(this.radar.width / m.width, this.radar.height / m.height);
    const ox = (this.radar.width - m.width * scale) / 2;
    const oy = (this.radar.height - m.height * scale) / 2;
    const tx = ((e.clientX - r.left) * (this.radar.width / r.width) - ox) / scale;
    const ty = ((e.clientY - r.top) * (this.radar.height / r.height) - oy) / scale;
    if (e.button === 2) {
      const units = v.selectedUnits().map((a) => a.id);
      if (units.length) v.issue({ kind: "move", actors: units, x: Math.round(tx * 256), y: Math.round(ty * 256), queue: false } as never);
      return;
    }
    v.cam.x = tx * CELL_PX - v.cam.width / 2;
    v.cam.y = ty * CELL_PX - v.cam.height / 2;
    v.clampCamera();
  }

  /** Refresh DOM from state; cheap parts every frame, buttons a few times a second. */
  refresh(force = false): void {
    const v = this.view;
    const p = v.state.players[v.localPlayer];
    if (!p) return;
    // Credits ticker.
    const target = Math.floor(p.credits);
    if (this.shownCredits !== target) {
      const diff = target - this.shownCredits;
      this.shownCredits += Math.sign(diff) * Math.max(1, Math.min(Math.abs(diff), Math.ceil(Math.abs(diff) / 12)));
      this.credits.textContent = this.shownCredits.toLocaleString();
    }
    const low = p.powerDrain > p.powerSupply;
    const max = Math.max(100, p.powerSupply, p.powerDrain) * 1.15;
    this.powerFill.style.height = `${Math.min(100, (p.powerSupply / max) * 100)}%`;
    this.powerFill.style.background = low ? "#e33" : p.powerDrain > p.powerSupply * 0.8 ? "#ec3" : "#3c3";
    this.powerText.textContent = `${p.powerDrain}/${p.powerSupply}`;
    this.powerBar.style.setProperty("--drain", `${Math.min(100, (p.powerDrain / max) * 100)}%`);
    this.repairBtn.classList.toggle("active", v.mode === "repair");
    const producerSelected = v.selectedActors().some((a) => a.kind === "structure" && a.owner === v.localPlayer && (v.state.rules.structures[a.type]?.produces.length ?? 0) > 0 && !v.state.rules.structures[a.type]?.produces.includes("building"));
    this.primaryBtn.disabled = !producerSelected;
    this.sellBtn.classList.toggle("active", v.mode === "sell");
    if (low && !this.lowWarned && v.state.tick > 40) {
      v.audio.eva("lowPower");
      this.lowWarned = true;
    } else if (!low) this.lowWarned = false;

    const now = performance.now();
    if (!force && now - this.lastRefresh < 150) {
      this.drawRadar();
      return;
    }
    this.lastRefresh = now;
    this.refreshGrid(this.leftGrid, this.leftTab);
    this.refreshGrid(this.rightGrid, this.rightTab);
    this.refreshSuperweapons();
    this.drawRadar();
    const sel = v.selectedActors();
    if (sel.length === 1) {
      const a = sel[0] as { type: string; hp: number; maxHp: number; kind: string };
      const def = a.kind === "unit" ? v.state.rules.units[a.type] : v.state.rules.structures[a.type];
      this.status.textContent = `${def?.name ?? a.type}  ${Math.ceil(a.hp)}/${a.maxHp}`;
    } else if (sel.length > 1) this.status.textContent = `${sel.length} selected`;
    else this.status.textContent = `Tick ${v.state.tick}  ${v.speed}x`;
  }
  private lowWarned = false;

  private refreshGrid(grid: HTMLDivElement, queue: QueueKind): void {
    const v = this.view;
    const p = v.state.players[v.localPlayer];
    if (!p) return;
    const types = buildableTypes(v.state, v.localPlayer, queue);
    const q = p.queues[queue];
    const wantKeys = types.map((t) => `${queue}:${t}`);
    // Remove stale buttons.
    for (const child of [...grid.children]) {
      const key = (child as HTMLElement).dataset.key ?? "";
      if (!wantKeys.includes(key)) grid.removeChild(child);
    }
    types.forEach((type, i) => {
      const key = `${queue}:${type}`;
      let b = this.buttons.get(key);
      if (!b) {
        b = this.makeButton(type, queue);
        this.buttons.set(key, b);
      }
      if (b.root.parentElement !== grid) grid.insertBefore(b.root, grid.children[i] ?? null);
      else if (grid.children[i] !== b.root) grid.insertBefore(b.root, grid.children[i] ?? null);
      const item = q.items.find((it) => it.type === type);
      const first = q.items[0];
      const active = !!item && first === item;
      const sd = v.state.rules.structures[type];
      b.root.classList.toggle("ready", (active && q.ready) || (!!sd && (sd.wall || sd.gate) && v.placing === type));
      if (sd && (sd.wall || sd.gate)) {
        b.progress.style.display = "none";
        b.count.textContent = v.placing === type ? "DRAW" : "";
        b.root.classList.toggle("poor", p.credits < sd.cost);
        return;
      }
      const prog = active ? item.progress : 0;
      b.progress.style.height = `${(1 - prog) * 100}%`;
      b.progress.style.display = active || (item && !active) ? "block" : "none";
      b.count.textContent = item && item.count > 1 ? String(item.count) : active && q.ready ? "READY" : active && q.hold ? "HOLD" : "";
      b.root.classList.toggle("ready", active && q.ready);
      b.root.classList.toggle("hold", active && q.hold);
      const def = v.state.rules.units[type] ?? v.state.rules.structures[type];
      b.root.classList.toggle("poor", !!def && p.credits < def.cost * 0.1 && !active);
    });
  }

  private makeButton(type: string, queue: QueueKind): ButtonEl {
    const v = this.view;
    const isStructure = queue === "building" || queue === "defense";
    const def = isStructure ? v.state.rules.structures[type] : v.state.rules.units[type];
    const root = document.createElement("button");
    root.className = "build-btn";
    root.dataset.key = `${queue}:${type}`;
    const icon = document.createElement("canvas");
    icon.width = 60;
    icon.height = 44;
    root.appendChild(icon);
    const g = icon.getContext("2d");
    if (g && def) {
      const p = v.state.players[v.localPlayer];
      const st = teamStyle(p?.color ?? "#888");
      g.fillStyle = "#1e232b";
      g.fillRect(0, 0, 60, 44);
      const fp = isStructure ? (def as { footprint: [number, number] }).footprint : [1, 1];
      drawIcon(g, type, isStructure, fp[0], fp[1], st, isStructure ? "" : (def as { class: string }).class);
    }
    const progress = el("div", "progress") as HTMLDivElement;
    root.appendChild(progress);
    const count = el("div", "count") as HTMLDivElement;
    root.appendChild(count);
    const label = el("div", "label") as HTMLDivElement;
    label.textContent = `${def?.name ?? type}\n$${def?.cost ?? 0}`;
    root.appendChild(label);
    root.title = `${def?.name ?? type} — $${def?.cost ?? 0}\n${(def as { desc?: string })?.desc ?? ""}\nLeft-click: build / place · Right-click: cancel`;
    root.addEventListener("click", () => this.onBuildClick(type, queue));
    root.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.onBuildCancel(type, queue);
    });
    return { root, icon, progress, count, label, type, queue };
  }

  private onBuildClick(type: string, queue: QueueKind): void {
    const v = this.view;
    v.audio.unlock();
    const p = v.state.players[v.localPlayer];
    if (!p) return;
    const q = p.queues[queue];
    const first = q.items[0];
    const sdef = v.state.rules.structures[type];
    if (sdef && (sdef.wall || sdef.gate)) {
      // Walls and gates are bought per cell while drawing; no queue.
      v.placing = type;
      v.mode = "normal";
      v.audio.play("click");
      return;
    }
    if ((queue === "building" || queue === "defense") && first?.type === type && q.ready) {
      v.placing = type;
      v.mode = "normal";
      v.audio.play("click");
      return;
    }
    if (first && first.type === type && q.hold) {
      v.issue({ kind: "hold", queue, hold: false } as never);
      return;
    }
    v.issue({ kind: "queue", queue, type } as never);
    v.audio.play("click");
  }

  private onBuildCancel(type: string, queue: QueueKind): void {
    const v = this.view;
    const p = v.state.players[v.localPlayer];
    if (!p) return;
    const q = p.queues[queue];
    const first = q.items[0];
    if (first && first.type === type && q.ready) {
      v.issue({ kind: "cancelPlace", queue } as never);
      if (v.placing === type) v.placing = null;
      return;
    }
    if (first && first.type === type && !q.hold && first.progress > 0 && first.count === 1) {
      // First right-click pauses, second cancels (classic behaviour).
      v.issue({ kind: "hold", queue, hold: true } as never);
      return;
    }
    v.issue({ kind: "dequeue", queue, type } as never);
  }

  private refreshSuperweapons(): void {
    const v = this.view;
    const p = v.state.players[v.localPlayer];
    if (!p) return;
    const entries = Object.entries(p.superweapons);
    const want = entries.map(([k]) => k).join(",");
    if (this.swRow.dataset.keys !== want) {
      this.swRow.dataset.keys = want;
      this.swRow.replaceChildren(
        ...entries.map(([power]) => {
          const b = button(power.toUpperCase(), () => {
            v.mode = "superweapon";
            v.superweapon = power;
            v.placing = null;
          });
          b.dataset.power = power;
          return b;
        }),
      );
    }
    for (const child of this.swRow.children) {
      const b = child as HTMLButtonElement;
      const sw = p.superweapons[b.dataset.power ?? ""];
      if (!sw) continue;
      const def = Object.values(v.state.rules.structures).find((s) => s.superweapon === b.dataset.power);
      const total = (def?.chargeTime ?? 1) * 20;
      const frac = sw.ready ? 1 : Math.min(1, sw.charge / total);
      b.disabled = !sw.ready;
      b.textContent = sw.ready ? `${b.dataset.power?.toUpperCase()} READY` : `${b.dataset.power?.toUpperCase()} ${Math.floor(frac * 100)}%`;
    }
  }

  drawRadar(): void {
    const v = this.view;
    const g = this.radar.getContext("2d");
    if (!g) return;
    const m = v.state.map;
    const p = v.state.players[v.localPlayer];
    const W = this.radar.width;
    const H = this.radar.height;
    g.fillStyle = "#0a0d12";
    g.fillRect(0, 0, W, H);
    if (!p?.radarActive && !v.state.finished) {
      g.fillStyle = "#3a4a3a";
      g.font = "12px system-ui";
      g.textAlign = "center";
      g.fillText(v.state.tick % 40 < 20 ? "RADAR OFFLINE" : "", W / 2, H / 2);
      g.strokeStyle = "#1f2a1f";
      for (let y = 0; y < H; y += 6) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
      }
      return;
    }
    const scale = Math.min(W / m.width, H / m.height);
    const ox = (W - m.width * scale) / 2;
    const oy = (H - m.height * scale) / 2;
    const fog = v.state.fog[v.localPlayer] as Uint8Array;
    const img = g.createImageData(m.width, m.height);
    const d = img.data;
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const i = idx(m, x, y);
        const f = fog[i] as number;
        let r = 0;
        let gg = 0;
        let b = 0;
        if (f > 0) {
          const t = m.terrain[i] as number;
          if (t === Terrain.Water) [r, gg, b] = [40, 80, 130];
          else if (t === Terrain.Cliff || t === Terrain.Rock) [r, gg, b] = [90, 74, 58];
          else if (t === Terrain.Tree) [r, gg, b] = [40, 80, 40];
          else if (t === Terrain.Beach) [r, gg, b] = [180, 165, 110];
          else [r, gg, b] = [95, 105, 65];
          if ((m.ore[i] as number) > 0) [r, gg, b] = m.gems[i] ? [80, 220, 220] : [210, 170, 60];
          if (f === 1) {
            r = r * 0.5;
            gg = gg * 0.5;
            b = b * 0.5;
          }
        }
        const o = i * 4;
        d[o] = r;
        d[o + 1] = gg;
        d[o + 2] = b;
        d[o + 3] = 255;
      }
    }
    const tmp = document.createElement("canvas");
    tmp.width = m.width;
    tmp.height = m.height;
    tmp.getContext("2d")?.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(tmp, ox, oy, m.width * scale, m.height * scale);
    // Actors
    for (const a of v.state.actorList) {
      if (a.kind === "projectile" || a.kind === "husk" || a.inside >= 0) continue;
      const tx = Math.floor(a.x / 256);
      const ty = Math.floor(a.y / 256);
      if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height) continue;
      const f = fog[idx(m, tx, ty)] as number;
      if (a.kind === "structure" ? f === 0 : f !== 2) continue;
      if (a.cloaked && a.owner !== v.localPlayer) continue;
      g.fillStyle = a.owner < 0 ? "#bbb" : (v.state.players[a.owner]?.color ?? "#fff");
      const s = a.kind === "structure" ? Math.max(2, a.w * scale) : Math.max(2, scale);
      g.fillRect(ox + tx * scale, oy + ty * scale, s, a.kind === "structure" ? Math.max(2, a.h * scale) : s);
    }
    // Viewport
    g.strokeStyle = "#fff";
    g.lineWidth = 1;
    g.strokeRect(ox + (v.cam.x / CELL_PX) * scale + 0.5, oy + (v.cam.y / CELL_PX) * scale + 0.5, (v.cam.width / CELL_PX) * scale, (v.cam.height / CELL_PX) * scale);
    // Last event blip
    if (v.lastEvent && v.now - v.lastBaseAttackMs < 6000 && Math.floor(v.now / 250) % 2 === 0) {
      g.strokeStyle = "#f33";
      g.beginPath();
      g.arc(ox + (worldToPx(v.lastEvent.x) / CELL_PX) * scale, oy + (worldToPx(v.lastEvent.y) / CELL_PX) * scale, 5, 0, Math.PI * 2);
      g.stroke();
    }
  }
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "tool-btn";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function tab(label: string, active: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = `tab${active ? " active" : ""}`;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}
