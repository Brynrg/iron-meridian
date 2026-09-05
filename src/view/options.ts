// Options overlay: audio, voice, subtitles, scrolling, colour-blind palette,
// music track, and hotkey rebinding. Writes through to Settings/KeyBindings.

import { saveSettings, type Settings } from "./game";
import { ACTION_LABELS, type Action, type KeyBindings } from "./keys";
import { TRACKS, type Music } from "./music";

export interface OptionsDeps {
  settings: Settings;
  keys: KeyBindings;
  music: Music;
  onVolume: (v: number) => void;
  onVoice: (on: boolean) => void;
  onClose: () => void;
}

export function showOptions(parent: HTMLElement, deps: OptionsDeps): HTMLElement {
  const root = document.createElement("div");
  root.className = "menu overlay";
  const s = deps.settings;
  root.innerHTML = `
    <div class="menu-card wide">
      <h2>Options</h2>
      <div class="menu-grid">
        <label>Sound volume <input id="o-vol" type="range" min="0" max="1" step="0.05" value="${s.volume}"></label>
        <label>Music volume <input id="o-mvol" type="range" min="0" max="1" step="0.05" value="${deps.music.volume}"></label>
        <label>Music track <select id="o-track">${TRACKS.map((t) => `<option value="${t.id}" ${t.id === deps.music.track.id ? "selected" : ""}>${t.name}</option>`).join("")}<option value="off" ${deps.music.playing ? "" : "selected"}>Off</option></select></label>
        <label>Voice cues <select id="o-voice"><option value="1" ${s.voice ? "selected" : ""}>On</option><option value="0" ${s.voice ? "" : "selected"}>Off</option></select></label>
        <label>Subtitles <select id="o-sub"><option value="1" ${s.subtitles ? "selected" : ""}>On</option><option value="0" ${s.subtitles ? "" : "selected"}>Off</option></select></label>
        <label>Scroll speed <input id="o-scroll" type="range" min="0.4" max="2.5" step="0.1" value="${s.scrollSpeed}"></label>
        <label>Edge scrolling <select id="o-edge"><option value="1" ${s.edgeScroll ? "selected" : ""}>On</option><option value="0" ${s.edgeScroll ? "" : "selected"}>Off</option></select></label>
        <label>Colour-blind team colours <select id="o-cb"><option value="0" ${s.colourblind ? "" : "selected"}>Off</option><option value="1" ${s.colourblind ? "selected" : ""}>On</option></select></label>
      </div>
      <h3>Hotkeys <span class="fine">(click a key, then press the new one)</span></h3>
      <div class="keys" id="o-keys"></div>
      <div class="menu-actions">
        <button id="o-reset">Reset hotkeys</button>
        <button id="o-close" class="primary">Done</button>
      </div>
    </div>`;
  parent.appendChild(root);
  const q = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`) as T;
  const persist = () => saveSettings(s);
  q<HTMLInputElement>("o-vol").addEventListener("input", (e) => {
    s.volume = Number((e.target as HTMLInputElement).value);
    deps.onVolume(s.volume);
    persist();
  });
  q<HTMLInputElement>("o-mvol").addEventListener("input", (e) => deps.music.setVolume(Number((e.target as HTMLInputElement).value)));
  q<HTMLSelectElement>("o-track").addEventListener("change", (e) => {
    const v = (e.target as HTMLSelectElement).value;
    if (v === "off") deps.music.stop();
    else {
      deps.music.stop();
      deps.music.play(v);
    }
  });
  q<HTMLSelectElement>("o-voice").addEventListener("change", (e) => {
    s.voice = (e.target as HTMLSelectElement).value === "1";
    deps.onVoice(s.voice);
    persist();
  });
  q<HTMLSelectElement>("o-sub").addEventListener("change", (e) => {
    s.subtitles = (e.target as HTMLSelectElement).value === "1";
    persist();
  });
  q<HTMLInputElement>("o-scroll").addEventListener("input", (e) => {
    s.scrollSpeed = Number((e.target as HTMLInputElement).value);
    persist();
  });
  q<HTMLSelectElement>("o-edge").addEventListener("change", (e) => {
    s.edgeScroll = (e.target as HTMLSelectElement).value === "1";
    persist();
  });
  q<HTMLSelectElement>("o-cb").addEventListener("change", (e) => {
    s.colourblind = (e.target as HTMLSelectElement).value === "1";
    persist();
  });
  const keysEl = q<HTMLDivElement>("o-keys");
  const renderKeys = () => {
    keysEl.replaceChildren(
      ...(Object.keys(ACTION_LABELS) as Action[]).map((action) => {
        const row = document.createElement("div");
        row.className = "key-row";
        const label = document.createElement("span");
        label.textContent = ACTION_LABELS[action];
        const btn = document.createElement("button");
        btn.className = "key-btn";
        btn.textContent = deps.keys.label(action);
        btn.addEventListener("click", () => {
          btn.textContent = "press a key…";
          const handler = (ev: KeyboardEvent) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (ev.key !== "Escape") deps.keys.set(action, ev.key);
            window.removeEventListener("keydown", handler, true);
            renderKeys();
          };
          window.addEventListener("keydown", handler, true);
        });
        row.appendChild(label);
        row.appendChild(btn);
        return row;
      }),
    );
  };
  renderKeys();
  q<HTMLButtonElement>("o-reset").addEventListener("click", () => {
    deps.keys.reset();
    renderKeys();
  });
  q<HTMLButtonElement>("o-close").addEventListener("click", deps.onClose);
  return root;
}
