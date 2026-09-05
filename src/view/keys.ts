// Rebindable hotkeys. Actions are stable ids; bindings are KeyboardEvent.key
// values (lower-cased). Persisted per player in localStorage.

export type Action =
  | "stop"
  | "guard"
  | "scatter"
  | "deploy"
  | "attackMove"
  | "forceFire"
  | "home"
  | "lastEvent"
  | "pause"
  | "speedUp"
  | "speedDown"
  | "cycleUnitsTab"
  | "cancel"
  | "selectAllCombat"
  | "nextIdleHarvester"
  | "quickSave"
  | "quickLoad"
  | "musicNext"
  | "sell"
  | "repair";

export const ACTION_LABELS: Record<Action, string> = {
  stop: "Stop",
  guard: "Guard",
  scatter: "Scatter",
  deploy: "Deploy / unload / phase",
  attackMove: "Attack-move mode",
  forceFire: "Force-fire mode",
  home: "Centre on base",
  lastEvent: "Jump to last event",
  pause: "Pause",
  speedUp: "Game speed up",
  speedDown: "Game speed down",
  cycleUnitsTab: "Cycle sidebar tab",
  cancel: "Cancel mode / placement",
  selectAllCombat: "Select all combat units",
  nextIdleHarvester: "Select idle ore truck",
  quickSave: "Quick save",
  quickLoad: "Quick load",
  musicNext: "Next music track",
  sell: "Sell mode",
  repair: "Repair mode",
};

export const DEFAULT_BINDINGS: Record<Action, string> = {
  stop: "s",
  guard: "g",
  scatter: "x",
  deploy: "d",
  attackMove: "a",
  forceFire: "f",
  home: "h",
  lastEvent: " ",
  pause: "p",
  speedUp: "=",
  speedDown: "-",
  cycleUnitsTab: "tab",
  cancel: "escape",
  selectAllCombat: "e",
  nextIdleHarvester: "n",
  quickSave: "f5",
  quickLoad: "f9",
  musicNext: "m",
  sell: "z",
  repair: "r",
};

const KEY = "speedrungames:iron-meridian:keys";

export class KeyBindings {
  bindings: Record<Action, string> = { ...DEFAULT_BINDINGS };

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.bindings = { ...DEFAULT_BINDINGS, ...(JSON.parse(raw) as Partial<Record<Action, string>>) };
    } catch {
      // ignore
    }
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.bindings));
    } catch {
      // ignore
    }
  }

  set(action: Action, key: string): void {
    this.bindings[action] = key.toLowerCase();
    this.save();
  }

  reset(): void {
    this.bindings = { ...DEFAULT_BINDINGS };
    this.save();
  }

  /** Which action a key press maps to, if any. */
  actionFor(key: string): Action | null {
    const k = key.toLowerCase();
    for (const [action, bound] of Object.entries(this.bindings) as Array<[Action, string]>) if (bound === k) return action;
    return null;
  }

  label(action: Action): string {
    const k = this.bindings[action];
    return k === " " ? "Space" : k.length === 1 ? k.toUpperCase() : k[0]?.toUpperCase() + k.slice(1);
  }
}
