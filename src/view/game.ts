// GameView: owns the running sim, camera, selection, pending commands,
// transient effects, and the fixed-step loop. Everything view-side hangs off
// this object; systems in src/sim never see it.

import { CELL_PX, type Camera, worldToPx } from "../sim/coords";
import { accumulate, type Accumulator } from "../sim/loop";
import { stepSim } from "../sim/index";
import type { Actor, Command, SimEvent, SimState } from "../sim/types";
import { mapHeightLeptons, mapWidthLeptons } from "../sim/map";
import type { Audio } from "./audio";

export interface Effect {
  kind: "explosion" | "muzzle" | "ring" | "text";
  x: number; // world leptons
  y: number;
  size: number;
  born: number; // ms
  dur: number;
  facing?: number;
  text?: string;
  color?: string;
}

export type Mode = "normal" | "sell" | "repair" | "superweapon" | "attackMove" | "force" | "phase";

export interface Settings {
  volume: number;
  voice: boolean;
  subtitles: boolean;
  scrollSpeed: number; // multiplier
  colourblind: boolean;
  edgeScroll: boolean;
}

export const DEFAULT_SETTINGS: Settings = { volume: 0.5, voice: true, subtitles: true, scrollSpeed: 1, colourblind: false, edgeScroll: true };
export const SETTINGS_KEY = "speedrungames:iron-meridian:settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // ignore
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

export class GameView {
  state: SimState;
  cam: Camera;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  localPlayer = 0;
  selection: number[] = [];
  groups = new Map<number, number[]>();
  pending: Command[] = [];
  effects: Effect[] = [];
  placing: string | null = null;
  mode: Mode = "normal";
  superweapon = "";
  hoverTx = -1;
  hoverTy = -1;
  drag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  wallDrag: { tx: number; ty: number } | null = null;
  decals: Array<{ x: number; y: number; r: number; born: number }> = [];
  settings: Settings = loadSettings();
  replayMode = false;
  replayCommands: Array<{ tick: number; cmds: Command[] }> = [];
  replayIdx = 0;
  autosaveEvery = 20 * 120; // ticks
  onAutosave: (() => void) | null = null;
  mission: string | null = null;
  /** Multiplayer hook: given this tick's local commands, return the merged set or null to wait. */
  netStep: ((tick: number, pending: Command[]) => Command[] | null) | null = null;
  mouseX = 0;
  mouseY = 0;
  acc: Accumulator = { carry: 0 };
  paused = false;
  speed = 1;
  lastFrame = 0;
  raf = 0;
  now = 0;
  lastEvent: { x: number; y: number } | null = null;
  lastBaseAttackMs = -1e9;
  lastHarvAttackMs = -1e9;
  messages: Array<{ text: string; born: number }> = [];
  audio: Audio;
  onTick: (() => void) | null = null;
  onEnd: ((won: boolean) => void) | null = null;
  ended = false;
  replay: Array<{ tick: number; cmds: Command[] }> = [];
  bookmarks: Array<{ x: number; y: number } | null> = [null, null, null, null];

  constructor(state: SimState, canvas: HTMLCanvasElement, audio: Audio) {
    this.state = state;
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.audio = audio;
    this.cam = { x: 0, y: 0, width: canvas.width, height: canvas.height };
    this.centerOnStart();
  }

  centerOnStart(): void {
    const yard = this.own().find((a) => a.type === "conyard" || a.type === "mcv");
    if (yard) this.centerOn(yard.x, yard.y);
  }

  own(): Actor[] {
    return this.state.actorList.filter((a) => a.owner === this.localPlayer && !a.dead);
  }

  centerOn(wx: number, wy: number): void {
    this.cam.x = worldToPx(wx) - this.cam.width / 2;
    this.cam.y = worldToPx(wy) - this.cam.height / 2;
    this.clampCamera();
  }

  clampCamera(): void {
    const maxX = worldToPx(mapWidthLeptons(this.state.map)) - this.cam.width;
    const maxY = worldToPx(mapHeightLeptons(this.state.map)) - this.cam.height;
    this.cam.x = Math.max(0, Math.min(Math.max(0, maxX), this.cam.x));
    this.cam.y = Math.max(0, Math.min(Math.max(0, maxY), this.cam.y));
  }

  resize(w: number, h: number): void {
    this.canvas.width = w;
    this.canvas.height = h;
    this.cam.width = w;
    this.cam.height = h;
    this.clampCamera();
  }

  issue(c: Omit<Command, "player"> & Partial<Pick<Command, "player">>): void {
    this.pending.push({ ...(c as Command), player: this.localPlayer });
  }

  selectedActors(): Actor[] {
    const out: Actor[] = [];
    for (const id of this.selection) {
      const a = this.state.actors.get(id);
      if (a && !a.dead) out.push(a);
    }
    if (out.length !== this.selection.length) this.selection = out.map((a) => a.id);
    return out;
  }

  selectedUnits(): Actor[] {
    return this.selectedActors().filter((a) => a.kind === "unit");
  }

  /** Advance the sim by wall-clock time; returns ticks run. */
  update(elapsedMs: number): number {
    if (this.paused || this.state.finished) {
      if (this.state.finished && !this.ended) this.finish();
      return 0;
    }
    const ticks = accumulate(this.acc, elapsedMs * this.speed);
    for (let i = 0; i < ticks; i++) {
      let cmds = this.pending;
      this.pending = [];
      if (this.replayMode) {
        cmds = [];
        while (this.replayIdx < this.replayCommands.length && (this.replayCommands[this.replayIdx] as { tick: number }).tick === this.state.tick) {
          cmds.push(...(this.replayCommands[this.replayIdx] as { cmds: Command[] }).cmds);
          this.replayIdx++;
        }
      } else if (this.netStep) {
        const merged = this.netStep(this.state.tick, cmds);
        if (!merged) {
          // Peer's commands for this tick have not arrived: hold the tick, keep no local backlog.
          this.acc.carry = 0;
          break;
        }
        cmds = merged;
      } else if (cmds.length) this.replay.push({ tick: this.state.tick, cmds });
      stepSim(this.state, cmds);
      if (!this.replayMode && this.onAutosave && this.state.tick % this.autosaveEvery === 0 && this.state.tick > 0) this.onAutosave();
      this.consumeEvents(this.state.events);
      if (this.onTick) this.onTick();
      if (this.state.finished) break;
    }
    return ticks;
  }

  private finish(): void {
    this.ended = true;
    const me = this.state.players[this.localPlayer];
    const won = !!me && !me.defeated && this.state.winner === me.team;
    if (this.onEnd) this.onEnd(won);
  }

  consumeEvents(events: SimEvent[]): void {
    const now = this.now;
    const p = this.localPlayer;
    for (const ev of events) {
      switch (ev.kind) {
        case "explosion":
          this.effects.push({ kind: "explosion", x: ev.x, y: ev.y, size: ev.size, born: now, dur: 300 + ev.size * 200 });
          if (ev.size >= 2) {
            this.decals.push({ x: ev.x, y: ev.y, r: 4 + ev.size * 3, born: now });
            if (this.decals.length > 200) this.decals.shift();
          }
          if (this.visible(ev.x, ev.y)) this.audio.play(ev.size >= 3 ? "explosion_big" : ev.size >= 1 ? "explosion" : "hit", this.pan(ev.x));
          break;
        case "muzzle":
          this.effects.push({ kind: "muzzle", x: ev.x, y: ev.y, size: 1, born: now, dur: 80, facing: ev.facing });
          break;
        case "sfx":
          if (this.visible(ev.x, ev.y) || ev.player === p) this.audio.play(ev.name, this.pan(ev.x));
          break;
        case "eva":
          if (ev.player === p || ev.player === -1) {
            const line = this.audio.eva(ev.cue);
            if (line && this.settings.subtitles) this.toast(line);
          }
          break;
        case "crate":
          if (ev.player === p) {
            this.toast(ev.crate === "money" ? "Crate: +$2000" : ev.crate === "heal" ? "Crate: units repaired" : ev.crate === "reveal" ? "Crate: map revealed" : ev.crate === "unit" ? "Crate: reinforcement" : "Crate: shroud regrows");
            this.audio.play("ready", this.pan(ev.x));
          }
          break;
        case "placed":
          break;
        case "unitReady":
          break;
        case "died":
          if (ev.player === p && ev.kind2 === "structure") this.lastEvent = { x: ev.x, y: ev.y };
          break;
        case "baseAttack":
          if (ev.player === p) {
            this.lastEvent = { x: ev.x, y: ev.y };
            if (now - this.lastBaseAttackMs > 15000) {
              this.lastBaseAttackMs = now;
              this.audio.eva("baseUnderAttack");
              this.toast("Base under attack");
            }
          }
          break;
        case "harvesterAttack":
          if (ev.player === p) {
            this.lastEvent = { x: ev.x, y: ev.y };
            if (now - this.lastHarvAttackMs > 20000) {
              this.lastHarvAttackMs = now;
              this.audio.eva("harvesterUnderAttack");
              this.toast("Ore truck under attack");
            }
          }
          break;
        case "victory":
          if (ev.player === p) this.audio.eva("missionAccomplished");
          break;
        case "defeat":
          if (ev.player === p) this.audio.eva("missionFailed");
          break;
        case "text":
          if (ev.player === p || ev.player === -1) this.toast(ev.text);
          break;
      }
    }
  }

  toast(text: string): void {
    this.messages.push({ text, born: this.now });
    if (this.messages.length > 6) this.messages.shift();
  }

  visible(wx: number, wy: number): boolean {
    const sx = worldToPx(wx) - this.cam.x;
    const sy = worldToPx(wy) - this.cam.y;
    return sx > -CELL_PX * 4 && sy > -CELL_PX * 4 && sx < this.cam.width + CELL_PX * 4 && sy < this.cam.height + CELL_PX * 4;
  }

  pan(wx: number): number {
    const sx = worldToPx(wx) - this.cam.x;
    return Math.max(-1, Math.min(1, (sx / this.cam.width) * 2 - 1));
  }

  jumpToLastEvent(): void {
    if (this.lastEvent) this.centerOn(this.lastEvent.x, this.lastEvent.y);
  }
}
