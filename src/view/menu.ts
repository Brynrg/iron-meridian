// Title screen, skirmish setup, campaign select and briefing, save/load
// slots, controls, and the end screen. Plain DOM.

import type { FactionId } from "../data/schemas";
import type { GameOptions } from "../sim/types";
import type { PlayerSetup } from "../sim/state";
import { MAP_POOL } from "../sim/maps";
import { CAMPAIGN, isUnlocked, loadProgress, type MissionSpec } from "../data/campaign";

export interface SkirmishSetup {
  players: PlayerSetup[];
  options: GameOptions;
  seed: number;
  mapId: string; // pool id or "random"
  mapSize: number;
  water: number;
  ore: number;
}

export const COLORS = ["#3a7bd5", "#d53a3a", "#3ab54a", "#e0b040", "#a05ad5", "#e07a30", "#3ac5c5", "#c05a8a"];
export const COLORBLIND_COLORS = ["#0072b2", "#d55e00", "#009e73", "#f0e442", "#cc79a7", "#e69f00", "#56b4e9", "#999999"];

export interface MainMenuHandlers {
  onSkirmish: () => void;
  onCampaign: () => void;
  onLoad: () => void;
  onReplay: () => void;
  onMultiplayer: () => void;
  onOptions: () => void;
  onControls: () => void;
}

export function showMainMenu(parent: HTMLElement, h: MainMenuHandlers): HTMLElement {
  const root = document.createElement("div");
  root.className = "menu";
  root.innerHTML = `
    <div class="menu-card">
      <h1>IRON MERIDIAN</h1>
      <p class="tag">Cold-war real-time strategy · Meridian Alliance vs Ural Pact</p>
      <div class="menu-actions" style="flex-direction:column">
        <button id="mm-skirmish" class="primary">Skirmish</button>
        <button id="mm-campaign">Campaign</button>
        <button id="mm-mp">Multiplayer</button>
        <button id="mm-load">Load game</button>
        <button id="mm-replay">Watch last replay</button>
        <button id="mm-options">Options</button>
        <button id="mm-controls">Controls</button>
      </div>
      <p class="fine">Original factions, art, and audio. Mechanics follow the 1996 classic. v${__APP_VERSION__}</p>
    </div>`;
  parent.appendChild(root);
  const bind = (id: string, fn: () => void) => (root.querySelector(`#${id}`) as HTMLButtonElement).addEventListener("click", fn);
  bind("mm-skirmish", h.onSkirmish);
  bind("mm-campaign", h.onCampaign);
  bind("mm-mp", h.onMultiplayer);
  bind("mm-load", h.onLoad);
  bind("mm-replay", h.onReplay);
  bind("mm-options", h.onOptions);
  bind("mm-controls", h.onControls);
  return root;
}

export function showSkirmishSetup(parent: HTMLElement, colourblind: boolean, onStart: (s: SkirmishSetup) => void, onBack: () => void): HTMLElement {
  const root = document.createElement("div");
  root.className = "menu";
  const palette = colourblind ? COLORBLIND_COLORS : COLORS;
  root.innerHTML = `
    <div class="menu-card">
      <h2>Skirmish</h2>
      <div class="menu-grid">
        <label>Map <select id="m-map"><option value="random">Random (generated)</option>${MAP_POOL.map((m) => `<option value="${m.id}">${m.name} · ${m.players}p · ${m.size}</option>`).join("")}</select></label>
        <label>Your faction <select id="m-fac"><option value="alliance">Meridian Alliance</option><option value="pact">Ural Pact</option></select></label>
        <label>Opponents <select id="m-opp"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
        <label>Enemy faction <select id="m-efac"><option value="random">Random</option><option value="alliance">Meridian Alliance</option><option value="pact">Ural Pact</option></select></label>
        <label>Difficulty <select id="m-diff"><option value="easy">Easy</option><option value="normal" selected>Normal</option><option value="hard">Hard</option></select></label>
        <label>Teams <select id="m-teams"><option value="ffa">Free for all</option><option value="allvsme">All AI vs me</option></select></label>
        <label>Random map size <select id="m-size"><option value="48">Small (48)</option><option value="64" selected>Medium (64)</option><option value="96">Large (96)</option><option value="128">Huge (128)</option></select></label>
        <label>Random map water <select id="m-water"><option value="0">None</option><option value="0.3" selected>Some</option><option value="0.7">Lots</option></select></label>
        <label>Starting credits <select id="m-cred"><option value="2500">2,500</option><option value="5000">5,000</option><option value="10000" selected>10,000</option><option value="20000">20,000</option></select></label>
        <label>Tech level <select id="m-tech"><option value="10" selected>Full</option><option value="7">High</option><option value="5">Mid</option><option value="2">Low</option></select></label>
        <label>Starting units <select id="m-units"><option value="0" selected>MCV only</option><option value="4">Small escort</option><option value="10">Large escort</option></select></label>
        <label>Shroud <select id="m-shroud"><option value="1" selected>On</option><option value="0">Off</option></select></label>
        <label>Crates <select id="m-crates"><option value="0" selected>Off</option><option value="1">On</option></select></label>
        <label>Ore regrowth <select id="m-ore"><option value="1" selected>On</option><option value="0">Off</option></select></label>
        <label>Short game (structures only) <select id="m-short"><option value="1" selected>On</option><option value="0">Off</option></select></label>
        <label>Seed <input id="m-seed" type="text" value="${Math.floor(Math.random() * 1e6)}" /></label>
      </div>
      <div class="menu-actions">
        <button id="m-back">Back</button>
        <button id="m-start" class="primary">Start Skirmish</button>
      </div>
    </div>`;
  parent.appendChild(root);
  const q = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`) as T;
  q<HTMLButtonElement>("m-back").addEventListener("click", onBack);
  q<HTMLButtonElement>("m-start").addEventListener("click", () => {
    const fac = q<HTMLSelectElement>("m-fac").value as FactionId;
    const opp = Number(q<HTMLSelectElement>("m-opp").value);
    const efacSel = q<HTMLSelectElement>("m-efac").value;
    const diff = q<HTMLSelectElement>("m-diff").value as "easy" | "normal" | "hard";
    const teams = q<HTMLSelectElement>("m-teams").value;
    const seedRaw = q<HTMLInputElement>("m-seed").value.trim();
    const seed = /^\d+$/.test(seedRaw) ? Number(seedRaw) % 2147483647 : hashSeed(seedRaw);
    const players: PlayerSetup[] = [{ name: "Commander", faction: fac, color: palette[0] as string, isAI: false, team: 0 }];
    for (let i = 0; i < opp; i++) {
      const efac: FactionId = efacSel === "random" ? ((seed + i) % 2 ? "pact" : "alliance") : (efacSel as FactionId);
      players.push({ name: `AI ${i + 1}`, faction: efac, color: palette[i + 1] as string, isAI: true, difficulty: diff, team: teams === "allvsme" ? 1 : i + 1 });
    }
    onStart({
      players,
      options: {
        startingCredits: Number(q<HTMLSelectElement>("m-cred").value),
        techLevel: Number(q<HTMLSelectElement>("m-tech").value),
        shroud: q<HTMLSelectElement>("m-shroud").value === "1",
        crates: q<HTMLSelectElement>("m-crates").value === "1",
        shortGame: q<HTMLSelectElement>("m-short").value === "1",
        unitCount: Number(q<HTMLSelectElement>("m-units").value),
        oreGrowth: q<HTMLSelectElement>("m-ore").value === "1",
      },
      seed,
      mapId: q<HTMLSelectElement>("m-map").value,
      mapSize: Number(q<HTMLSelectElement>("m-size").value),
      water: Number(q<HTMLSelectElement>("m-water").value),
      ore: 0.6,
    });
  });
  return root;
}

export function showCampaign(parent: HTMLElement, onPick: (spec: MissionSpec) => void, onBack: () => void): HTMLElement {
  const root = document.createElement("div");
  root.className = "menu";
  const done = loadProgress();
  const list = (faction: FactionId) =>
    CAMPAIGN.filter((m) => m.faction === faction)
      .map((m) => {
        const unlocked = isUnlocked(m, done);
        return `<button class="mission-btn ${done.has(m.id) ? "done" : ""} ${unlocked ? "" : "locked"}" data-id="${m.id}" ${unlocked ? "" : "disabled"}>Act ${m.act} · Mission ${m.index}<small>${m.title}</small></button>`;
      })
      .join("");
  root.innerHTML = `
    <div class="menu-card wide">
      <h2>Campaign</h2>
      <h3>Meridian Alliance</h3>
      <div class="mission-list">${list("alliance")}</div>
      <h3>Ural Pact</h3>
      <div class="mission-list">${list("pact")}</div>
      <div class="menu-actions"><button id="c-back">Back</button></div>
    </div>`;
  parent.appendChild(root);
  root.querySelectorAll<HTMLButtonElement>(".mission-btn").forEach((b) =>
    b.addEventListener("click", () => {
      const spec = CAMPAIGN.find((m) => m.id === b.dataset.id);
      if (spec) onPick(spec);
    }),
  );
  (root.querySelector("#c-back") as HTMLButtonElement).addEventListener("click", onBack);
  return root;
}

export function showBriefing(parent: HTMLElement, spec: MissionSpec, onStart: (difficulty: "easy" | "normal" | "hard") => void, onBack: () => void): HTMLElement {
  const root = document.createElement("div");
  root.className = "menu";
  root.innerHTML = `
    <div class="menu-card wide">
      <h2>${spec.faction === "alliance" ? "Meridian Alliance" : "Ural Pact"} · Act ${spec.act} · Mission ${spec.index}</h2>
      <h1 style="font-size:24px;letter-spacing:3px">${spec.title.toUpperCase()}</h1>
      <div class="briefing">${spec.briefing.map((l) => `> ${l}`).join("\n\n")}</div>
      <div class="menu-grid" style="margin-top:12px"><label>Difficulty <select id="b-diff"><option value="easy">Easy — more credits, slower enemy</option><option value="normal" selected>Normal</option><option value="hard">Hard — richer, faster enemy</option></select></label></div>
      <div class="menu-actions">
        <button id="b-back">Back</button>
        <button id="b-start" class="primary">Begin mission</button>
      </div>
    </div>`;
  parent.appendChild(root);
  (root.querySelector("#b-back") as HTMLButtonElement).addEventListener("click", onBack);
  (root.querySelector("#b-start") as HTMLButtonElement).addEventListener("click", () => onStart((root.querySelector("#b-diff") as HTMLSelectElement).value as "easy" | "normal" | "hard"));
  return root;
}

export interface SaveSlotInfo {
  slot: number;
  label: string | null; // null = empty
  savedAt: number;
}

export function showSaveSlots(parent: HTMLElement, mode: "save" | "load", slots: SaveSlotInfo[], onPick: (slot: number) => void, onBack: () => void): HTMLElement {
  const root = document.createElement("div");
  root.className = "menu overlay";
  root.innerHTML = `
    <div class="menu-card">
      <h2>${mode === "save" ? "Save game" : "Load game"}</h2>
      <div class="save-list">${slots
        .map((s) => {
          const when = s.savedAt ? new Date(s.savedAt).toLocaleString() : "";
          const empty = s.label === null;
          return `<div class="save-row"><span class="slot">${s.slot === 0 ? "Autosave" : s.slot === 9 ? "Quick save" : `Slot ${s.slot}`} — ${empty ? "empty" : `${s.label} · ${when}`}</span><button class="tool-btn" data-slot="${s.slot}" ${mode === "load" && empty ? "disabled" : ""} ${mode === "save" && (s.slot === 0 || s.slot === 9) ? "disabled" : ""}>${mode === "save" ? "Save" : "Load"}</button></div>`;
        })
        .join("")}</div>
      <div class="menu-actions"><button id="s-back" class="primary">Back</button></div>
    </div>`;
  parent.appendChild(root);
  root.querySelectorAll<HTMLButtonElement>("button[data-slot]").forEach((b) => b.addEventListener("click", () => onPick(Number(b.dataset.slot))));
  (root.querySelector("#s-back") as HTMLButtonElement).addEventListener("click", onBack);
  return root;
}

export function showInGameMenu(parent: HTMLElement, h: { onResume: () => void; onSave: () => void; onLoad: () => void; onOptions: () => void; onQuit: () => void }): HTMLElement {
  const root = document.createElement("div");
  root.className = "menu overlay";
  root.innerHTML = `
    <div class="menu-card">
      <h2>Paused</h2>
      <div class="menu-actions" style="flex-direction:column">
        <button id="g-resume" class="primary">Resume</button>
        <button id="g-save">Save game</button>
        <button id="g-load">Load game</button>
        <button id="g-options">Options</button>
        <button id="g-quit">Quit to main menu</button>
      </div>
    </div>`;
  parent.appendChild(root);
  const bind = (id: string, fn: () => void) => (root.querySelector(`#${id}`) as HTMLButtonElement).addEventListener("click", fn);
  bind("g-resume", h.onResume);
  bind("g-save", h.onSave);
  bind("g-load", h.onLoad);
  bind("g-options", h.onOptions);
  bind("g-quit", h.onQuit);
  return root;
}

export function showControls(parent: HTMLElement, onClose: () => void): HTMLElement {
  const root = document.createElement("div");
  root.className = "menu";
  root.innerHTML = `
    <div class="menu-card">
      <h2>Controls</h2>
      <table class="controls">
        <tr><td>Left click / drag</td><td>Select · box-select</td></tr>
        <tr><td>Right click</td><td>Move · attack · harvest · enter · set rally (producer selected)</td></tr>
        <tr><td>Shift + right click</td><td>Queue waypoint</td></tr>
        <tr><td>Ctrl + right click</td><td>Force fire / force attack</td></tr>
        <tr><td>Alt + right click</td><td>Force move (ignore targets, crush)</td></tr>
        <tr><td>A / F</td><td>Attack-move mode / force-fire mode, then click</td></tr>
        <tr><td>S · G · X · D</td><td>Stop · Guard · Scatter · Deploy, unload, or phase-jump</td></tr>
        <tr><td>E · N</td><td>Select all combat units · select idle ore truck</td></tr>
        <tr><td>Z · R</td><td>Sell mode · repair mode</td></tr>
        <tr><td>Ctrl+0–9 · 0–9 · Alt+0–9</td><td>Assign group · select group · select and centre</td></tr>
        <tr><td>Double click</td><td>Select all of that type on screen</td></tr>
        <tr><td>H · Space · F1–F4 · Shift+F1–F4</td><td>Home · last event · bookmark · set bookmark</td></tr>
        <tr><td>Tab / Shift+Tab</td><td>Cycle unit / structure sidebar tabs</td></tr>
        <tr><td>Walls</td><td>Click a wall in the sidebar, then drag a line on the map</td></tr>
        <tr><td>Arrow keys · edge · middle drag · minimap</td><td>Scroll the map</td></tr>
        <tr><td>P · + / −</td><td>Pause · game speed</td></tr>
        <tr><td>F5 · F9 · M</td><td>Quick save · quick load · next music track</td></tr>
        <tr><td>Sidebar left click / right click</td><td>Build or place · pause then cancel</td></tr>
        <tr><td>Esc</td><td>Cancel placement or mode; in-game menu</td></tr>
      </table>
      <p class="fine">All keys can be rebound in Options.</p>
      <div class="menu-actions"><button id="c-close" class="primary">Back</button></div>
    </div>`;
  parent.appendChild(root);
  (root.querySelector("#c-close") as HTMLButtonElement).addEventListener("click", onClose);
  return root;
}

export function showEndScreen(parent: HTMLElement, won: boolean, stats: { built: number; lost: number; kills: number; harvested: number }, seconds: number, h: { onMenu: () => void; onContinue: () => void; onNext?: () => void; onRetry?: () => void; onSkip?: () => void }): HTMLElement {
  const root = document.createElement("div");
  root.className = "menu overlay";
  const mm = Math.floor(seconds / 60);
  const ss = Math.floor(seconds % 60).toString().padStart(2, "0");
  root.innerHTML = `
    <div class="menu-card">
      <h1 class="${won ? "win" : "lose"}">${won ? "MISSION ACCOMPLISHED" : "MISSION FAILED"}</h1>
      <table class="controls">
        <tr><td>Time</td><td>${mm}:${ss}</td></tr>
        <tr><td>Built</td><td>${stats.built}</td></tr>
        <tr><td>Lost</td><td>${stats.lost}</td></tr>
        <tr><td>Kills</td><td>${stats.kills}</td></tr>
        <tr><td>Harvested</td><td>$${stats.harvested.toLocaleString()}</td></tr>
      </table>
      <div class="menu-actions">
        ${h.onNext ? '<button id="e-next" class="primary">Next mission</button>' : ""}
        ${h.onRetry ? '<button id="e-retry" class="primary">Retry</button>' : ""}
        ${h.onSkip ? '<button id="e-skip">Skip mission</button>' : ""}
        <button id="e-menu" ${h.onNext || h.onRetry ? "" : 'class="primary"'}>Main menu</button>
        <button id="e-cont">Keep watching</button>
      </div>
    </div>`;
  parent.appendChild(root);
  (root.querySelector("#e-menu") as HTMLButtonElement).addEventListener("click", h.onMenu);
  (root.querySelector("#e-cont") as HTMLButtonElement).addEventListener("click", h.onContinue);
  if (h.onNext) (root.querySelector("#e-next") as HTMLButtonElement).addEventListener("click", h.onNext);
  if (h.onRetry) (root.querySelector("#e-retry") as HTMLButtonElement).addEventListener("click", h.onRetry);
  if (h.onSkip) (root.querySelector("#e-skip") as HTMLButtonElement).addEventListener("click", h.onSkip);
  return root;
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 2147483647;
}
