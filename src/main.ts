// Entry point: menus -> skirmish / campaign / multiplayer / load / replay ->
// game loop. The only file that touches both the sim factories and the DOM
// shell.

import "./styles.css";
import { loadRules } from "./data/rules";
import { generateMap } from "./sim/mapgen";
import { buildMap, mapById, MAP_POOL } from "./sim/maps";
import { DEFAULT_OPTIONS, createMission, createSkirmish, refreshActorList, registerMission, MISSION_REGISTRY } from "./sim/index";
import { deserializeState, serializeState, type ReplayFile, type SaveFile } from "./sim/serialize";
import type { Command, SimState } from "./sim/types";
import type { MapData } from "./sim/map";
import { buildMission, CAMPAIGN, markComplete, missionSpec, type MissionSpec } from "./data/campaign";
import { GameView } from "./view/game";
import { attachInput, keyBindings, updateCamera, type InputState } from "./view/input";
import { render } from "./view/renderer";
import { Sidebar } from "./view/sidebar";
import { Audio } from "./view/audio";
import { ObjectivesPanel } from "./view/objectives";
import { showOptions } from "./view/options";
import { Lockstep, showLobby, type LobbyResult } from "./view/multiplayer";
import { COLORBLIND_COLORS, COLORS, showBriefing, showCampaign, showControls, showEndScreen, showInGameMenu, showMainMenu, showSaveSlots, showSkirmishSetup, type SaveSlotInfo, type SkirmishSetup } from "./view/menu";

const SLUG = "iron-meridian";
const SAVE_PREFIX = `speedrungames:${SLUG}:save:`;
const REPLAY_KEY = `speedrungames:${SLUG}:lastreplay`;
const PB_KEY = `speedrungames:${SLUG}:pb`;

const root = document.getElementById("app");
if (!root) throw new Error("#app element missing in index.html");
root.dataset.gameRoot = "1";
const app = root as HTMLElement;

const audio = new Audio();
const rules = loadRules();

interface GameStart {
  state: SimState;
  mapName: string;
  mission?: MissionSpec;
  replay?: ReplayFile;
  lockstep?: Lockstep;
  localPlayer?: number;
  replayMeta?: Omit<ReplayFile, "commands" | "finalTick" | "finalHash">;
}

interface Session {
  view: GameView;
  sidebar: Sidebar;
  input: InputState;
  shell: HTMLElement;
  stop: () => void;
  mission?: MissionSpec;
}

let session: Session | null = null;
let overlay: HTMLElement | null = null;

function clearOverlay(): void {
  overlay?.remove();
  overlay = null;
}

function setOverlay(el: HTMLElement): void {
  clearOverlay();
  overlay = el;
}

function endSession(): void {
  if (session) {
    session.stop();
    session.shell.remove();
    session = null;
  }
}

// ── Menus ────────────────────────────────────────────────────────────────────

function mainMenu(): void {
  endSession();
  setOverlay(
    showMainMenu(app, {
      onSkirmish: () => setOverlay(showSkirmishSetup(app, loadSettingsColourblind(), startSkirmish, mainMenu)),
      onCampaign: campaignMenu,
      onLoad: () => setOverlay(showSaveSlots(app, "load", slotInfos(), (slot) => loadSlot(slot), mainMenu)),
      onReplay: watchReplay,
      onMultiplayer: () => setOverlay(showLobby(app, MAP_POOL.filter((m) => m.players >= 2).map((m) => ({ id: m.id, name: m.name })), startMultiplayer, mainMenu)),
      onOptions: () => optionsOverlay(mainMenu),
      onControls: () => setOverlay(showControls(app, mainMenu)),
    }),
  );
  audio.unlock();
}

function loadSettingsColourblind(): boolean {
  try {
    const raw = localStorage.getItem("speedrungames:iron-meridian:settings");
    return raw ? !!(JSON.parse(raw) as { colourblind?: boolean }).colourblind : false;
  } catch {
    return false;
  }
}

function campaignMenu(): void {
  setOverlay(showCampaign(app, (spec) => setOverlay(showBriefing(app, spec, () => startMission(spec), campaignMenu)), mainMenu));
}

function optionsOverlay(onClose: () => void): void {
  const settings = session ? session.view.settings : new GameView(dummyState(), document.createElement("canvas"), audio).settings;
  setOverlay(
    showOptions(app, {
      settings,
      keys: keyBindings,
      music: audio.music,
      onVolume: (v) => audio.setVolume(v),
      onVoice: (on) => (audio.voice = on),
      onClose: () => {
        if (session) session.view.settings = settings;
        onClose();
      },
    }),
  );
}

let dummy: SimState | null = null;
function dummyState(): SimState {
  if (!dummy) {
    const map = generateMap({ seed: 1, width: 16, height: 16, players: 2, waterAmount: 0, oreAmount: 0 });
    dummy = createSkirmish(rules, map, [{ name: "x", faction: "alliance", color: "#fff", isAI: false }], DEFAULT_OPTIONS, 1);
  }
  return dummy;
}

// ── Starting games ───────────────────────────────────────────────────────────

function skirmishMap(setup: SkirmishSetup): { map: MapData; name: string } {
  const entry = setup.mapId !== "random" ? mapById(setup.mapId) : undefined;
  if (entry) return { map: buildMap(entry, setup.players.length), name: entry.id };
  return { map: generateMap({ seed: setup.seed, width: setup.mapSize, height: setup.mapSize, players: setup.players.length, waterAmount: setup.water, oreAmount: setup.ore }), name: "random" };
}

function startSkirmish(setup: SkirmishSetup): void {
  const { map, name } = skirmishMap(setup);
  const state = createSkirmish(rules, map, setup.players, setup.options, setup.seed);
  runGame({
    state,
    mapName: name,
    replayMeta: { version: 1, seed: setup.seed, setups: setup.players, options: setup.options, mapName: name, mapGen: name === "random" ? { seed: setup.seed, width: setup.mapSize, height: setup.mapSize, players: setup.players.length, waterAmount: setup.water, oreAmount: setup.ore } : undefined },
  });
}

function startMission(spec: MissionSpec): void {
  const map = generateMap({ ...spec.map });
  const def = buildMission(spec, map);
  const state = createMission(rules, map, def);
  runGame({ state, mapName: `mission:${spec.id}`, mission: spec, replayMeta: { version: 1, seed: state.seed, setups: def.players, options: state.options, mission: spec.id } });
}

function startMultiplayer(r: LobbyResult): void {
  clearOverlay();
  const entry = r.mapId !== "random" ? mapById(r.mapId) : undefined;
  const map = entry ? buildMap(entry, 2) : generateMap({ seed: r.seed, width: 64, height: 64, players: 2, waterAmount: 0.3, oreAmount: 0.6 });
  const setups = [
    { name: "Host", faction: r.hostFaction, color: COLORS[0] as string, isAI: false, team: 0 },
    { name: "Guest", faction: r.guestFaction, color: COLORS[1] as string, isAI: false, team: 1 },
  ];
  const state = createSkirmish(rules, map, setups, { ...DEFAULT_OPTIONS }, r.seed);
  const localPlayer = r.isHost ? 0 : 1;
  const lockstep = new Lockstep(r.link, localPlayer);
  runGame({ state, mapName: r.mapId, lockstep, localPlayer });
}

function watchReplay(): void {
  let replay: ReplayFile | null = null;
  try {
    const raw = localStorage.getItem(REPLAY_KEY);
    if (raw) replay = JSON.parse(raw) as ReplayFile;
  } catch {
    replay = null;
  }
  if (!replay) {
    alert("No replay recorded yet. Finish a skirmish or mission first.");
    return;
  }
  let state: SimState;
  let mission: MissionSpec | undefined;
  if (replay.mission) {
    const spec = missionSpec(replay.mission);
    if (!spec) return;
    const map = generateMap({ ...spec.map });
    state = createMission(rules, map, buildMission(spec, map));
    mission = spec;
  } else {
    const entry = replay.mapName && replay.mapName !== "random" ? mapById(replay.mapName) : undefined;
    const map = entry ? buildMap(entry, replay.setups.length) : generateMap({ ...(replay.mapGen ?? { seed: replay.seed, width: 64, height: 64, players: 2, waterAmount: 0.3, oreAmount: 0.6 }) });
    state = createSkirmish(rules, map, replay.setups, replay.options, replay.seed);
  }
  runGame({ state, mapName: replay.mapName ?? "replay", replay, mission });
}

// ── Saves ────────────────────────────────────────────────────────────────────

function slotInfos(): SaveSlotInfo[] {
  const out: SaveSlotInfo[] = [];
  for (const slot of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    try {
      const raw = localStorage.getItem(SAVE_PREFIX + slot);
      if (!raw) out.push({ slot, label: null, savedAt: 0 });
      else {
        const s = JSON.parse(raw) as SaveFile;
        out.push({ slot, label: s.label, savedAt: s.savedAt });
      }
    } catch {
      out.push({ slot, label: null, savedAt: 0 });
    }
  }
  return out;
}

function saveToSlot(slot: number, silent = false): void {
  if (!session) return;
  const v = session.view;
  const label = session.mission ? `${session.mission.title} · tick ${v.state.tick}` : `Skirmish · tick ${v.state.tick}`;
  const save = serializeState(v.state, label, v.localPlayer, session.mission?.id);
  save.savedAt = Date.now();
  try {
    localStorage.setItem(SAVE_PREFIX + slot, JSON.stringify(save));
    if (!silent) v.toast(slot === 9 ? "Quick saved" : `Saved to slot ${slot}`);
    if (!silent) audio.eva("autosaved");
  } catch (e) {
    v.toast(`Save failed: ${String(e)}`);
  }
}

function loadSlot(slot: number): void {
  let save: SaveFile | null = null;
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + slot);
    if (raw) save = JSON.parse(raw) as SaveFile;
  } catch {
    save = null;
  }
  if (!save) return;
  let mission: MissionSpec | undefined;
  if (save.mission) {
    mission = missionSpec(save.mission);
    if (mission && !MISSION_REGISTRY.has(mission.id)) {
      const map = generateMap({ ...mission.map });
      registerMission(buildMission(mission, map));
    }
  }
  const state = deserializeState(rules, save);
  refreshActorList(state);
  runGame({ state, mapName: "save", mission, localPlayer: save.localPlayer });
}

// ── The game shell ───────────────────────────────────────────────────────────

function runGame(start: GameStart): void {
  clearOverlay();
  endSession();
  audio.unlock();
  const state = start.state;

  const shell = document.createElement("div");
  shell.className = "shell";
  const stage = document.createElement("div");
  stage.className = "stage";
  const canvas = document.createElement("canvas");
  canvas.className = "game-canvas";
  canvas.tabIndex = 0;
  stage.appendChild(canvas);
  shell.appendChild(stage);
  app.appendChild(shell);

  const view = new GameView(state, canvas, audio);
  view.localPlayer = start.localPlayer ?? 0;
  audio.setVolume(view.settings.volume);
  audio.voice = view.settings.voice;
  if (view.settings.colourblind) state.players.forEach((p, i) => (p.color = COLORBLIND_COLORS[i % COLORBLIND_COLORS.length] as string));
  const sidebar = new Sidebar(view, shell);
  const input = attachInput(view);
  const objectives = new ObjectivesPanel(stage);
  const missionDef = start.mission ? MISSION_REGISTRY.get(start.mission.id) ?? null : null;
  view.mission = start.mission?.id ?? null;
  if (start.replay) {
    view.replayMode = true;
    view.replayCommands = start.replay.commands;
    view.toast("Replay playback. +/- changes speed.");
  }
  if (!audio.music.playing) audio.music.play(state.players[view.localPlayer]?.faction === "pact" ? "drone" : "march");

  const fit = () => {
    const r = stage.getBoundingClientRect();
    view.resize(Math.max(320, Math.floor(r.width)), Math.max(240, Math.floor(r.height)));
  };
  fit();
  view.centerOnStart();
  window.addEventListener("resize", fit);

  // Multiplayer lockstep hook.
  if (start.lockstep) {
    const ls = start.lockstep;
    view.netStep = (tick, pending) => {
      ls.submitLocal(tick, pending);
      return ls.commandsFor(tick);
    };
    view.onTick = () => {
      if (state.tick % 20 === 0) ls.reportHash(state.tick, state.hash);
      if (ls.desync) view.toast("DESYNC detected: the two games have diverged.");
      if (ls.peerQuit) view.toast("Opponent left the game.");
    };
  }

  let last = performance.now();
  let raf = 0;
  const startedAt = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(250, now - last);
    last = now;
    view.now = now;
    updateCamera(view, input, dt);
    view.update(dt);
    if (view.state.mission?.cameraTx !== undefined && view.state.mission && view.state.mission.cameraTx >= 0) {
      view.centerOn(view.state.mission.cameraTx * 256 + 128, view.state.mission.cameraTy * 256 + 128);
      view.state.mission.cameraTx = -1;
    }
    render(view, 0);
    sidebar.refresh();
    objectives.refresh(view, missionDef);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  view.onAutosave = start.lockstep || start.replay ? null : () => saveToSlot(0, true);

  view.onEnd = (won) => {
    const me = state.players[view.localPlayer];
    const seconds = (performance.now() - startedAt) / 1000;
    if (!start.replay && !start.lockstep && start.replayMeta) {
      const rep: ReplayFile = { ...start.replayMeta, commands: view.replay, finalTick: state.tick, finalHash: state.hash };
      try {
        localStorage.setItem(REPLAY_KEY, JSON.stringify(rep));
      } catch {
        // storage full; ignore
      }
    }
    if (won && !start.replay) {
      try {
        const pb = JSON.parse(localStorage.getItem(PB_KEY) ?? "null") as { ms: number } | null;
        const ms = Math.round(seconds * 1000);
        if (!pb || ms < pb.ms) localStorage.setItem(PB_KEY, JSON.stringify({ ms, achievedAt: Date.now() }));
      } catch {
        // ignore
      }
      if (start.mission) markComplete(start.mission.id);
    }
    start.lockstep?.link.send({ t: "quit" });
    const next = start.mission ? CAMPAIGN.find((m) => m.faction === start.mission!.faction && m.index === start.mission!.index + 1) : undefined;
    setOverlay(
      showEndScreen(app, won, me?.stats ?? { built: 0, lost: 0, kills: 0, harvested: 0 }, seconds, {
        onMenu: mainMenu,
        onContinue: clearOverlay,
        onNext: won && next ? () => setOverlay(showBriefing(app, next, () => startMission(next), campaignMenu)) : undefined,
        onRetry: !won && start.mission ? () => startMission(start.mission as MissionSpec) : undefined,
      }),
    );
  };

  const inGameMenu = () => {
    if (overlay) return;
    view.paused = true;
    setOverlay(
      showInGameMenu(app, {
        onResume: () => {
          clearOverlay();
          view.paused = false;
        },
        onSave: () => setOverlay(showSaveSlots(app, "save", slotInfos(), (slot) => { saveToSlot(slot); inGameMenuAgain(); }, inGameMenuAgain)),
        onLoad: () => setOverlay(showSaveSlots(app, "load", slotInfos(), (slot) => loadSlot(slot), inGameMenuAgain)),
        onOptions: () => optionsOverlay(inGameMenuAgain),
        onQuit: () => {
          start.lockstep?.link.send({ t: "quit" });
          start.lockstep?.link.close();
          mainMenu();
        },
      }),
    );
  };
  const inGameMenuAgain = () => {
    clearOverlay();
    inGameMenu();
  };
  const onMenu = () => inGameMenu();
  const onQuickSave = () => {
    if (!start.lockstep && !start.replay) saveToSlot(9);
  };
  const onQuickLoad = () => {
    if (!start.lockstep && !start.replay) loadSlot(9);
  };
  const onMusicNext = () => {
    audio.music.next();
    view.toast(`♪ ${audio.music.track.name}`);
  };
  const onEsc = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !view.placing && view.mode === "normal" && !overlay) inGameMenu();
  };
  document.addEventListener("im:menu", onMenu);
  document.addEventListener("im:quicksave", onQuickSave);
  document.addEventListener("im:quickload", onQuickLoad);
  document.addEventListener("im:musicnext", onMusicNext);
  window.addEventListener("keydown", onEsc);

  session = {
    view,
    sidebar,
    input,
    shell,
    mission: start.mission,
    stop: () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
      window.removeEventListener("keydown", onEsc);
      document.removeEventListener("im:menu", onMenu);
      document.removeEventListener("im:quicksave", onQuickSave);
      document.removeEventListener("im:quickload", onQuickLoad);
      document.removeEventListener("im:musicnext", onMusicNext);
    },
  };
  // Debug hooks for Playwright liveness gates.
  (window as unknown as { __im: unknown }).__im = {
    get state() {
      return view.state;
    },
    view,
    issue: (c: unknown) => view.issue(c as never),
    save: (slot: number) => saveToSlot(slot),
    load: (slot: number) => loadSlot(slot),
    startMission: (id: string) => {
      const spec = missionSpec(id);
      if (spec) startMission(spec);
    },
  };
}

// ── Boot ─────────────────────────────────────────────────────────────────────

const params = new URLSearchParams(location.search);
if (params.get("autostart") === "1") {
  const seed = Number(params.get("seed") ?? "42");
  const mission = params.get("mission");
  if (mission) {
    const spec = missionSpec(mission);
    if (spec) startMission(spec);
    else mainMenu();
  } else {
    startSkirmish({
      players: [
        { name: "Commander", faction: (params.get("faction") as "alliance" | "pact") ?? "alliance", color: "#3a7bd5", isAI: false, team: 0 },
        { name: "AI 1", faction: "pact", color: "#d53a3a", isAI: true, difficulty: (params.get("ai") as "easy" | "normal" | "hard") ?? "normal", team: 1 },
      ],
      options: { startingCredits: 10000, techLevel: 10, shroud: params.get("shroud") !== "0", crates: params.get("crates") === "1", shortGame: true, unitCount: 0, oreGrowth: true },
      seed,
      mapId: params.get("map") ?? "random",
      mapSize: Number(params.get("size") ?? "64"),
      water: 0.3,
      ore: 0.6,
    });
  }
} else {
  mainMenu();
}

export type { Command };
