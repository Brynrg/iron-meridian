# HANDOFF — Iron Meridian

Supersedes: the v0.3.0 handoff written earlier on 2026-09-05. Written 2026-09-05 (later the same day).

## Canonical project
- Source: `~/Code/games/iron-meridian` (local git repo, **no remote, nothing committed**).
- Intended remote: `Brynrg/iron-meridian` (not created). Live URL when shipped:
  `https://speedrungames.net/games/iron-meridian/` (Not Proven; never deployed).
- Portal: `~/Code/games/speedrungames` (`Brynrg/speedrungames`, Netlify site
  `71683967-2b9c-4227-8fec-0ae0d41ef0d9`). Deploy path: `docs/DEPLOYMENT_PATH.md`.

## Authority exercised / withheld
| Boundary | State |
|---|---|
| Folder creation, implementation, tests | Exercised (local only) |
| `git init` | Exercised; **no commit made** |
| GitHub repo creation, secret set, push, deploy | Withheld (operator-gated; exact commands in `docs/DEPLOYMENT_PATH.md` §3) |
| Portal checkout | Read only; not modified |

## What exists (v1.0.0)
Feature-parity checklist: `docs/PARITY_SPEC.md` (57 rows done, 3 partial: hierarchical
pathfinding, lavish art, keyboard-only play).

- **Sim** (`src/sim`, deterministic 20 Hz, purity-linted): economy with cash/ore split, base
  building with base radius, walls drawn as lines, gates, sell/repair, primary/rally, tech
  gating; full roster of 41 units and 37 structures incl. mines, jammers, gap, phase tank,
  demolition trucks, transports, aircraft with ammo/rearm, submarines with cloak/detect/sonar;
  weapons/warheads/armour with splash, prone, crush; all seven superweapons (phase with
  return, aegis, nuke, recon, paradrop, sonar, GPS); fog/shroud; crates; neutral derricks,
  hospital, civilians; three-difficulty AI with navy and air; short/long game victory;
  save/load; replay log; mission engine with 11 objective kinds and 19 trigger actions.
- **Content**: 28 missions (`src/data/campaign.ts`), 16-map pool with an ASCII map format
  (`src/sim/maps.ts`), original voice lines, three procedural music tracks.
- **View** (`src/view`): renderer with autotiled terrain, decals, fire/smoke, ammo pips;
  classic sidebar; full hotkey scheme, all rebindable; options; menus for skirmish, campaign
  (unlock progression, briefings, next/retry), load/save slots, replay, multiplayer lobby.
- **Multiplayer**: 1v1 WebRTC lockstep with copy/paste signalling (no server), 4-tick input
  delay, per-second hash comparison. Manifest declares `multiplayer: p2p / webrtc`.

## Evidence (2026-09-05, local)
| Check | Result |
|---|---|
| `npm run verify` (typecheck + path lint + sim-purity lint + 16 vitest) | Pass |
| `npm run build` (~280 kB JS) | Pass |
| `npx playwright test` (smoke + 5 liveness gates: skirmish economy, sidebar, mission boot, save/load, menu→campaign→mission) | Pass |
| Visual in the app browser: main menu, mission a02 with objectives panel, River Crossing skirmish | Pass |
| Multiplayer end-to-end between two real browsers | **Not Proven** (needs two machines/tabs and a human to paste codes; the lockstep scheduler and hash check are unit-level only) |
| Full campaign playthrough by a human | Not Proven (every mission boots and runs 3 s in tests; balance and pacing unplayed) |
| Deployed / live | Not Proven |

## Exact next action
1. Operator: create the repo and enable auto-deploy per `docs/DEPLOYMENT_PATH.md` §3.
2. Playtest: a human should play A1–A3 and P1–P3 and log balance notes; then the AI on
   Hard for 20 minutes.
3. Multiplayer: two browsers, exchange codes, confirm no DESYNC toast over 10 minutes.

## Known limitations
- Art is functional vector work; a dedicated art pass (F3) would lift it.
- Pathfinding is flat A* with an 18k-node budget; fine up to 128² but not hierarchical.
- Multiplayer has no reconnect and no spectator; signalling is manual by design (no server).
- Balance numbers approximate the classic and are untuned by play.
- The desktop app's browser pane reports `document.hidden = true`, so the sim only advances
  there when a screenshot forces a paint; real tabs and Playwright are unaffected.

## Dirty files
Everything: no commits yet. `retired/2026-09-05-template-docs/` holds the template's own
status docs (ledger in `retired/README.md`).
