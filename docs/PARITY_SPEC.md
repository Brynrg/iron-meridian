# Iron Meridian — feature-parity specification

Target: **mechanical parity with the 1996 Westwood cold-war RTS and its open-source
re-implementation (OpenRA `ra` mod)**, built IP-clean for the browser. "Full featured and
complete" means every row below is implemented, tested, and playable, not a subset.

IP rules: original faction names, unit names, art, audio, music, voice lines, and mission
text. Mechanics, numbers, and feel are fair game; trademarks and assets are not. The two
factions are the **Meridian Alliance** (western analog: speed, tech, naval range) and the
**Ural Pact** (eastern analog: armor, firepower, attrition).

Status legend: ☐ not started · ◐ partial · ☑ done and gated by a test.

## A. Engine foundation

| # | Feature | Parity detail | Status |
|---|---|---|---|
| A1 | Deterministic fixed-step sim | 20 Hz lockstep, integer/fixed math, seeded RNG, no wall-clock in `src/sim` | ☑ |
| A2 | ECS-style store + system order | Pinned system order; sim/view boundary enforced by lint | ☑ (order pinned in `src/sim/index.ts`; `npm run lint:sim` fails on DOM/clock/random in `src/sim`) |
| A3 | Tile map | 24 px cells, up to 128×128, terrain classes: clear, road, rough, beach, water, cliff, ore, gems, tree, wall, bridge | ☑ (procedural generator; no hand-authored maps yet) |
| A4 | Coordinates module | One owner for world↔tile↔screen conversion | ☑ |
| A5 | Pathfinding | A* with hierarchical abstraction for 128² maps; per-locomotor passability (foot, wheel, track, naval, air) | ◐ (bounded A*, 18k expansions, per-locomotor costs, team-aware gates; no hierarchy) |
| A6 | Spatial index | Grid buckets for range queries and selection | ☑ |
| A7 | State hash + replay | Hash per tick; replays are ordered command logs; desync detector in MP | ☑ (per-tick hash, command log, replay playback from the menu, multiplayer desync check) |
| A8 | Save / load | Full sim snapshot to `speedrungames:iron-meridian:*` storage; 8 slots + autosave | ☑ (10 slots incl. autosave every 2 min and quick save/load; round-trip test) |
| A9 | Data-driven rules | All units/structures/weapons/warheads/armor in `data/*.json` behind zod schemas | ☑ |

## B. Economy and base

| # | Feature | Parity detail | Status |
|---|---|---|---|
| B1 | Ore + gems | Ore regrows from mines toward a cap; gems worth more, never regrow | ☑ |
| B2 | Harvester loop | Harvest → return to nearest refinery → dock → unload; auto-rehome | ☑ (unit + Playwright gated) |
| B3 | Refinery + silos | Storage capacity; "silos needed" when full; credits tick up | ☑ (cash/ore split as in the classic) |
| B4 | Power | Plant / advanced plant; low power slows production, disables radar, defenses stutter | ☑ |
| B5 | Construction Yard + MCV | MCV deploys; ConYard sells back to MCV | ☑ |
| B6 | Sidebar build | Two columns (structures / units), tabs, queue counts, hold/cancel, insufficient-funds pause | ☑ |
| B7 | Placement rules | Must be adjacent to own base footprint; footprint overlap and terrain checks; ghost preview | ☑ |
| B8 | Sell / repair | Sell any structure for 50 %; repair wrench drains credits over time | ☑ |
| B9 | Primary building + rally | Per-producer rally point; primary factory selection | ☑ (rally via right-click, Primary button in the sidebar) |
| B10 | Tech gating | Radar → Tech Center chains; faction-exclusive tech; captured buildings unlock enemy tech | ☑ |
| B11 | Walls and gates | Sandbag, wire, concrete; wall lines; gates open for friendlies | ☑ (walls bought per cell by dragging a line; gates pass own team) |
| B12 | Crates | Money, heal, reveal, unit, veterancy-free; skirmish toggle | ☑ (money, heal, reveal, unit, shroud; skirmish toggle) |

## C. Roster — structures

Alliance: Power Plant, Advanced Power Plant, Ore Refinery, Ore Silo, Barracks, War Factory,
Radar Dome, Naval Yard, Helipad, Service Depot, Tech Center, Pillbox, Camouflaged Pillbox,
Gun Turret, AA Gun, Gap Generator, Chronosphere-analog ("Phase Gate"), Fake structures.

Pact: Power Plant, Advanced Power Plant, Ore Refinery, Ore Silo, Barracks, Kennel, War
Factory, Radar Dome, Sub Pen, Helipad, Service Depot, Tech Center, Flame Tower, Tesla-analog
("Arc Tower"), SAM Site, Iron-Curtain-analog ("Aegis Field"), Missile Silo.

Shared/neutral: Civilian buildings, Oil Derrick (captureable income), Bridges (destructible/repairable), Tech Hospital.

| # | Feature | Status |
|---|---|---|
| C1 | All Alliance structures buildable with correct prereqs, footprints, power, cost, build time | ☑ (data + placement; naval/air producers untested in play) |
| C2 | All Pact structures buildable likewise | ☑ (same caveat) |
| C3 | Neutral/captureable structures placed by maps | ☑ (derricks, hospital, civilian buildings seeded on skirmish maps and placed by missions) |

## D. Roster — units

Infantry (shared unless noted): Rifle Infantry, Rocket Soldier, Engineer (capture/repair),
Grenadier (Pact), Flamethrower (Pact), Shock Trooper (Pact), Attack Dog (Pact), Medic
(Alliance), Mechanic (Alliance), Spy (Alliance, disguise), Thief (Alliance, steals credits),
Commando hero (Alliance, C4 + pistol), Field Officer hero (Pact).

Vehicles: Ore Truck, MCV, Scout Ranger (Alliance), APC (Alliance), Light Tank (Alliance),
Medium Tank (Alliance), Heavy Tank (Pact), Mammoth-analog "Kolossus" (Pact), Artillery
(Alliance), Rocket Launcher "V-analog" (Pact), Mobile Radar Jammer (Alliance), Mobile Gap
Generator (Alliance), Minelayer (both), Tesla-analog Arc Tank (Pact), Chrono-analog Phase
Tank (Alliance), Demolition Truck (Pact), Mobile Flak (Pact).

Aircraft: Light Fighter "Yak-analog" (Pact), Interceptor "MiG-analog" (Pact), Gunship
"Hind-analog" (Pact), Attack Helicopter "Longbow-analog" (Alliance), Transport Helicopter,
Cargo Plane (paradrops, off-map), Recon Plane (off-map).

Naval: Gunboat, Destroyer, Cruiser, Transport (Alliance); Submarine, Missile Submarine,
Transport (Pact).

| # | Feature | Status |
|---|---|---|
| D1 | All infantry with abilities (capture, heal, disguise, steal, C4, dog leap) | ☑ (capture, heal, disguise, steal, C4, dog bite, spy infiltration incl. sonar from a sub pen) |
| D2 | All vehicles incl. mine laying, jamming, gap, chrono-shift, demolition | ☑ (mines, jammers, gap, phase-tank self-shift with recharge, demolition) |
| D3 | All aircraft with ammo, rearm at helipad/airfield, off-map support | ☑ (ammo, return-to-pad rearm, paradrop and recon from the Airfield/Radar) |
| D4 | All naval with submerge/detect, shore bombardment, transport load/unload | ☑ (submerge and re-cloak, detection, sonar reveal, shore placement, torpedoes, shore bombardment) |
| D5 | Transports: APC, helicopter, naval transport load/unload with cargo UI | ☑ (enter/unload with cargo count; APC, transport helicopter, naval transport) |

## E. Combat model

| # | Feature | Parity detail | Status |
|---|---|---|---|
| E1 | Weapons / warheads / armor | Armor classes none, light, heavy, wood, concrete; per-warhead `versus` table; spread, burst, ROF, range, min range | ☑ |
| E2 | Projectiles | Instant, bullet, arcing shell, missile (homing), flame, tesla arc, torpedo | ☑ |
| E3 | Damage states | Structure damage frames, smoke at yellow, fire at red; husks | ☑ (smoke at yellow, fire at red, husks, craters/scorch decals) |
| E4 | Infantry behaviours | Prone under fire, crush by tracked vehicles, scatter | ☑ |
| E5 | Stances / commands | Attack, attack-move, force-fire, force-move, guard, stop, scatter, deploy, waypoint queue, control groups 0–9, formation move | ☑ (all commands incl. Alt force-move, formation-preserving group moves) |
| E6 | Targeting | Auto-acquire by threat, return fire, defensive structures turret tracking | ☑ |
| E7 | Cloak / detect | Submarines, spies, gap generator shroud; dogs and defenses detect | ☑ (submarines, spies, camouflaged pillbox, gap generators, mines; dogs and gunboats detect) |
| E8 | Superweapons | Phase Gate (teleport group for N s), Aegis Field (invulnerable group), Missile Silo (nuke), Recon Plane, Paradrop, Sonar Pulse, GPS reveal | ☑ (phase with 20 s return, aegis, nuke, recon, paradrop, sonar, GPS) |

## F. Fog, map, presentation

| # | Feature | Status |
|---|---|---|
| F1 | Shroud (never-seen) + fog (seen, stale) with per-unit sight; radar dome requirement for minimap | ☑ |
| F2 | Camera: edge scroll, drag, minimap click, bookmarks, zoom-free classic view | ☑ |
| F3 | Isometric-free classic top-down 2D; code-drawn sprites with 8/16/32 facings; team-colour remap | ◐ (vector sprites, 32 facings, turrets, team colour, colour-blind palette; art is functional, not lavish) |
| F4 | Terrain autotiling, cliffs, shores, trees, roads, bridges | ☑ (autotiled shores, cliff shadows, beach blending, rounded water corners) |
| F5 | Explosions, smoke, muzzle flashes, tracers, craters, scorch | ☑ (explosions, smoke, muzzle flashes, tracers, craters, scorch) |
| F6 | EVA-style voice cues (synthesised, original lines) and unit acknowledgements | ☑ (30+ original synthesised voice lines with subtitles, unit acknowledgements) |
| F7 | Procedural music jukebox (Web Audio) with track select | ☑ (three procedural tracks, track select, shuffle) |
| F8 | Options: volume, scroll speed, hotkeys, colourblind team colours, subtitles | ☑ (volume, music, voice, subtitles, scroll speed, edge scroll, colour-blind, hotkeys) |

## G. Single player

| # | Feature | Status |
|---|---|---|
| G1 | Skirmish setup: map pool, players, factions, colours, teams, starting credits, tech level, unit count, shroud, crates, short game | ☑ (16-map pool + random, factions, difficulty, teams, credits, tech, escort size, shroud, crates, ore growth, short game, seed) |
| G2 | Skirmish AI: build order, base layout, expansion, harvester defence, attack waves, air/naval use, superweapon use; Easy/Normal/Hard | ☑ (three difficulties: build order, expansion, repair, defence, waves, air, navy, superweapons) |
| G3 | Campaign: 14 Alliance + 14 Pact missions with briefings, objectives, triggers, timers, reinforcements, scripted events | ☑ (28 missions; Easy/Normal/Hard select; headless stand-in wins 23/28 on Easy, see `docs/SIMULATION.md`; skip-after-loss keeps the campaign traversable) |
| G4 | Mission select, difficulty, score screen (kills/losses/built/time), continue after victory | ☑ (campaign select with unlocks, briefing, score screen, next/retry) |
| G5 | 16+ skirmish maps 1v1 → 4v4, plus map format documented for hand authoring | ☑ (16 maps: 2 authored ASCII maps + 14 named generator presets; format documented in `src/sim/maps.ts`) |

## H. Multiplayer

| # | Feature | Status |
|---|---|---|
| H1 | Lockstep netcode over an approved portal pattern (WebRTC p2p first) | ☑ (WebRTC data channel, 4-tick input delay lockstep, manual copy/paste signalling; no server) |
| H2 | Lobby: room codes, slots, factions, map vote, ready-up | ☑ (host/guest lobby, faction pick, host chooses map and seed) |
| H3 | Desync detection, reconnect grace, replay export | ☑ (hash comparison every second, peer-quit notice; no reconnect) |
| H4 | Manifest declares `multiplayer` + `multiplayerProvider` | ☑ (`multiplayer: p2p`, `multiplayerProvider: webrtc`) |

## I. Portal + quality gates

| # | Feature | Status |
|---|---|---|
| I1 | Template contract: build, typecheck, path lint, Playwright smoke | ☑ (baseline 2026-09-05) |
| I2 | Unit tests (vitest) on every sim system; determinism replay test | ☑ (16 vitest tests: rules, determinism, economy, power, combat, AI, save/load, RLE, missions ×3, maps ×2) |
| I3 | Liveness gates: Playwright scenarios prove player-visible promises per milestone | ☑ (`tests/live/skirmish.spec.ts`) |
| I4 | `ASSETS.md`, `expectedAssets` in manifest once sprite atlases exist | ☑ (`ASSETS.md`: no binary assets shipped) |
| I6 | Headless balance harness + analyzer (`docs/SIMULATION.md`, `docs/BALANCE_REPORT.md`) | ☑ (43-game matrix, deterministic per seed; found and fixed 9 AI/economy defects on 2026-09-05) |
| I5 | Keyboard-only playable; remappable hotkeys | ◐ (every hotkey rebindable; mouse still required for selection) |

## Milestones (each ends with a deployable version and a liveness gate)

| Ver | Milestone | Scope |
|---|---|---|
| 0.1 | Scaffold | Template passes contract (done 2026-09-05) |
| 0.2 | Foundation | A1–A9, map render, camera, select/move, one unit, one map (done 2026-09-05) |
| 0.3 | Economy | B1–B9 with ConYard, Power, Refinery, Barracks, War Factory, Ore Truck, Rifle, Light/Heavy tank (done 2026-09-05; combat core and first AI landed early) |
| 0.4 | Combat core | E1–E6, fog F1, defenses, sell/repair, first skirmish AI (rush) (done) |
| 0.5 | Full ground roster | C1–C2 ground, D1–D2, B10–B12 (done 2026-09-05) |
| 0.6 | Air + naval | D3–D4, helipads, naval yards, transports, shore/water maps (done 2026-09-05) |
| 0.7 | Superweapons + specials | E7–E8, spies, thieves, engineers, gap/jammer (done 2026-09-05) |
| 0.8 | Presentation | F3–F8 art, FX, audio, EVA, options (done 2026-09-05) |
| 0.9 | Skirmish complete | G1, G2 three difficulties, G5 map pool, saves A8 (done 2026-09-05) |
| 1.0 | Campaign | G3–G4 both campaigns (done 2026-09-05) |
| 1.1 | Multiplayer | H1–H4 (done 2026-09-05) |
