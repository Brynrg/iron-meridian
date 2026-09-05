// Sidebar production: per-player, per-queue progress with pay-as-you-build
// credits, low-power slowdown, unit spawn at the primary producer, and
// structure "ready to place" handoff.

import { SIM_TICK_RATE } from "../loop";
import { tileToWorldCenter } from "../coords";
import { emit, findExitCell, producersOf, spawnUnit, spend, structDef, unitDef } from "../state";
import type { Actor, SimState } from "../types";
import { QUEUE_KINDS } from "../state";

export function runProduction(state: SimState): void {
  const g = state.rules.general;
  for (const p of state.players) {
    if (p.defeated) continue;
    const lowPower = p.powerDrain > p.powerSupply;
    for (const qk of QUEUE_KINDS) {
      const q = p.queues[qk];
      const item = q.items[0];
      if (!item || q.hold || q.ready) continue;
      const isStructure = qk === "building" || qk === "defense";
      const def = isStructure ? structDef(state, item.type) : unitDef(state, item.type);
      if (!def) {
        q.items.shift();
        continue;
      }
      const producers = isStructure ? producersOf(state, p.id, "building") : producersOf(state, p.id, qk);
      if (producers.length === 0) continue; // producer destroyed: stall, keep progress
      let ticks = def.buildTime * SIM_TICK_RATE;
      if (lowPower) ticks *= g.lowPowerBuildMultiplier;
      // Extra producers speed the queue (classic: each additional factory helps a little).
      ticks /= 1 + (producers.length - 1) * 0.25;
      if (p.isAI) ticks /= p.difficulty === "hard" ? 1.25 : p.difficulty === "easy" ? 0.8 : 1;
      const step = 1 / Math.max(1, ticks);
      const nextProgress = Math.min(1, item.progress + step);
      const owed = Math.ceil(def.cost * nextProgress) - item.paid;
      if (owed > 0) {
        if (p.credits < owed) {
          if (!p.isAI && state.tick % 100 === 0) emit(state, { kind: "eva", cue: "insufficientFunds", player: p.id });
          continue;
        }
        spend(p, owed);
        item.paid += owed;
      }
      item.progress = nextProgress;
      if (item.progress < 1) continue;

      if (isStructure) {
        q.ready = true;
        emit(state, { kind: "eva", cue: "constructionReady", player: p.id });
        continue;
      }
      // Unit complete: spawn at the primary producer (or the first).
      const producer = producers.find((s) => s.primary) ?? (producers[0] as Actor);
      const udef = unitDef(state, item.type);
      if (!udef) {
        q.items.shift();
        continue;
      }
      const [ex, ey] = findExitCell(state, producer, udef.loco);
      const u = spawnUnit(state, item.type, p.id, tileToWorldCenter(ex), tileToWorldCenter(ey), 16);
      u.x = producer.x;
      u.y = producer.y + Math.round((producer.h * 256) / 2) - 40;
      u.moveGoal = { x: tileToWorldCenter(ex), y: tileToWorldCenter(ey) };
      u.order = { kind: "move", x: tileToWorldCenter(ex), y: tileToWorldCenter(ey) };
      if (producer.rally && (Math.abs(producer.rally.x - tileToWorldCenter(ex)) > 256 || Math.abs(producer.rally.y - tileToWorldCenter(ey)) > 256)) {
        u.queuedOrders.push({ kind: "move", x: producer.rally.x, y: producer.rally.y });
      }
      if (u.harvester) u.queuedOrders.push({ kind: "harvest" });
      emit(state, { kind: "unitReady", actor: u.id, player: p.id });
      emit(state, { kind: "eva", cue: "unitReady", player: p.id });
      item.count--;
      item.progress = 0;
      item.paid = 0;
      if (item.count <= 0) q.items.shift();
    }
  }
}
