# Assets

Iron Meridian ships **no binary assets**. Everything the player sees and hears is generated
at runtime from code in this repository:

| Category | Source | Licence |
|---|---|---|
| Unit, structure, terrain, and effect graphics | Canvas 2D vector drawing in `src/view/sprites.ts` and `src/view/renderer.ts` | Original, same licence as the repo |
| Sound effects | Web Audio synthesis in `src/view/audio.ts` | Original |
| Music | Procedural sequencer in `src/view/music.ts` (three original tracks) | Original |
| Voice cues | Browser `SpeechSynthesis` reading original lines from `src/view/audio.ts` | Original text; voice provided by the player's OS |
| Fonts | System font stack (`system-ui`, `ui-monospace`) | Player's OS |
| Maps | ASCII maps in `src/sim/maps.ts` and the procedural generator in `src/sim/mapgen.ts` | Original |
| Mission text | `src/data/campaign.ts` | Original |

Nothing is copied from Command & Conquer, Red Alert, OpenRA, or any other game. Faction,
unit, structure, and mission names are original. Because no files are shipped under
`public/` or `dist/assets/` other than the compiled bundle, the portal manifest declares no
`expectedAssets`.
