// Defeat and victory. Short game: a player with no non-wall structures and no
// MCV is defeated. Long game: also requires losing every combat unit. When all
// surviving players share a team, that team wins.

import { emit, removeActor, structDef, unitDef } from "../state";
import type { SimState } from "../types";

export function runVictory(state: SimState): void {
  if (state.finished) return;
  if (state.tick % 20 !== 0) return;
  const counts = state.players.map(() => ({ structures: 0, mcv: 0, units: 0 }));
  for (const a of state.actorList) {
    if (a.owner < 0) continue;
    const c = counts[a.owner];
    if (!c) continue;
    if (a.kind === "structure") {
      const sd = structDef(state, a.type);
      if (sd && !sd.wall && sd.factions.length > 0) c.structures++;
    } else if (a.kind === "unit") {
      const ud = unitDef(state, a.type);
      if (ud?.deploysTo) c.mcv++;
      else if (ud && ud.weapons.length > 0) c.units++;
    }
  }
  for (const p of state.players) {
    if (p.defeated) continue;
    const c = counts[p.id];
    if (!c) continue;
    const short = state.options.shortGame;
    // In missions a side is only out when it has nothing left at all; objectives decide the rest.
    const out = state.mission ? c.structures === 0 && c.mcv === 0 && c.units === 0 && !state.actorList.some((a) => a.owner === p.id) : c.structures === 0 && c.mcv === 0 && (short || c.units === 0);
    if (out && state.tick > 20) {
      p.defeated = true;
      p.alive = false;
      emit(state, { kind: "defeat", player: p.id });
      emit(state, { kind: "eva", cue: "playerDefeated", player: -1 });
      // Remaining assets are abandoned.
      for (const a of [...state.actorList]) if (a.owner === p.id && !a.dead) removeActor(state, a);
    }
  }
  if (state.mission) {
    // Missions decide victory through objectives; only the human's defeat ends it here.
    const me = state.players[0];
    if (me?.defeated) state.finished = true;
    return;
  }
  const alive = state.players.filter((p) => !p.defeated);
  if (alive.length === 0) {
    state.finished = true;
    return;
  }
  const team = (alive[0] as { team: number }).team;
  if (alive.every((p) => p.team === team)) {
    state.winner = team;
    state.finished = true;
    for (const p of alive) emit(state, { kind: "victory", player: p.id });
  }
}
