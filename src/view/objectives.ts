// Mission objectives HUD: a small always-on panel listing active objectives,
// their status, and the mission timer.

import type { MissionDef } from "../sim/mission";
import type { GameView } from "./game";

export class ObjectivesPanel {
  root: HTMLDivElement;
  private last = "";

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "objectives";
    this.root.hidden = true;
    parent.appendChild(this.root);
  }

  refresh(view: GameView, def: MissionDef | null): void {
    const rt = view.state.mission;
    if (!rt || !def) {
      this.root.hidden = true;
      return;
    }
    const lines: string[] = [`<b>${def.title}</b>`];
    for (const o of def.objectives) {
      const st = rt.status[o.id];
      if (!st || st === "hidden") continue;
      const cls = st === "done" ? "done" : st === "failed" ? "failed" : "";
      lines.push(`<div class="${cls}">${st === "done" ? "✓" : st === "failed" ? "✗" : "•"} ${o.text}${o.optional ? " (optional)" : ""}</div>`);
    }
    if (rt.timerEnd >= 0) {
      const left = Math.max(0, Math.ceil((rt.timerEnd - view.state.tick) / 20));
      const mm = Math.floor(left / 60);
      const ss = (left % 60).toString().padStart(2, "0");
      lines.push(`<div class="timer">${rt.timerLabel}: ${mm}:${ss}</div>`);
    }
    const html = lines.join("");
    if (html !== this.last) {
      this.last = html;
      this.root.innerHTML = html;
    }
    this.root.hidden = false;
  }
}
