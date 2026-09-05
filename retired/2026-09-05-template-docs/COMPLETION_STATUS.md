# Completion Status

> Status doc for AI agents. Updated 2026-05-19.

**Score:** 74 / 100
**State:** Stable scaffold used as `gh repo create --template` source. Ships a working playable demo on fork.
**Last commit:** 2026-05-19 (`2741057` "Add COMPLETION_STATUS.md for AI agents")
**Stack:** Vite 5 + TypeScript 5 (strict, `verbatimModuleSyntax`, `noEmit`), Node 22, Netlify auto-deploy. Consumes `speedrungames-sdk#v0.1.0` from GitHub as the runtime. 15 files, ~13 KB authored source (excludes `package-lock.json`).

## Architecture
- Vite SPA: `index.html` → `src/main.ts` → SDK modules. No framework, no router. Single `<canvas>` in `#app`.
- Runtime substrate lives in `speedrungames-sdk` (timer, storage, HUD, game loop, leaderboard). This repo owns only the game-specific glue and gameplay code in `src/main.ts`.
- `base: "./"` in `vite.config.ts` makes built asset URLs relative, so `dist/` works under the umbrella's `/games/<slug>/` proxy. Enforced post-build by `scripts/check-relative-paths.mjs`.
- `speedrungames.json` is a v1 manifest (slug/title/description/emoji/deployUrl/hidden) read by the umbrella's `discover-games.mjs` for auto-discovery — no umbrella commit needed once slug is wired.
- CI (`.github/workflows/ci.yml`): on PR + push-to-main, runs `npm ci`, `tsc --noEmit`, `vite build`, `lint:paths`, asserts `dist/index.html` exists. Node 22 with npm cache.
- Netlify (`netlify.toml`): `npm ci && npm run build` → `dist/`. Sets Node 22, security headers (`X-Frame-Options=SAMEORIGIN`, `X-Content-Type-Options=nosniff`, `Referrer-Policy=strict-origin-when-cross-origin`).

## What works (verified by reading code)
- Playable click-5-targets demo runs day one — `src/main.ts:38-109`
- Demo wires every SDK piece: Game canvas loop, SpeedrunTimer, createHUD, createStorage, submitRun — `src/main.ts:7-12,22-34`
- Demo gracefully no-ops leaderboard submission while slug is `REPLACE_ME` and uses `"template-demo"` storage namespace so demo PBs don't collide — `src/main.ts:28,73-76`
- Splits tracked per target hit (`timer.split(\`hit \${n}\`)`) and persisted with PB — `src/main.ts:65,70`
- `scripts/check-relative-paths.mjs` walks `dist/` for `.html|.css|.js|.mjs|.cjs`, regex-scans `src=`, `href=`, `url()` for leading `/` (not `//`), errors with file:offender list and clear remediation — `scripts/check-relative-paths.mjs:14-62`
- `vite.config.ts` is minimal but correct: `base: "./"`, `target: "es2022"`, sourcemaps off — `vite.config.ts:6-12`
- `tsconfig.json` is strict + bundler resolution + `allowImportingTsExtensions` + `verbatimModuleSyntax` (catches type-import bugs) — `tsconfig.json:7-18`
- AGENTS.md is a thorough 89-line playbook: file roles table, SDK module API quick-reference, mandatory edits, 6 hard rules, done-checklist — `AGENTS.md:9-89`
- `index.html` viewport already has `user-scalable=no` and theme-color set — good defaults for game pages — `index.html:5-7`
- `.gitignore` covers all common bundler caches (vite, parcel, next, netlify, dotenv, OS junk) — `.gitignore:1-13`

## Known gaps
- **`REPLACE_ME` sentinel is runtime-only.** Forgetful agent can ship `slug: "REPLACE_ME"` to Netlify — neither CI nor build fails. Manifested in `src/main.ts:16` and four fields of `speedrungames.json`. No grep-for-REPLACE_ME step in `ci.yml`.
- **No eslint / prettier config.** Style drift across forked games is guaranteed.
- **README is out of sync with itself and with the umbrella.**
  - `README.md:60-62` claims `src/game.ts`, `src/speedrun.ts`, `src/storage.ts`, `src/ui.ts` exist — they don't. The actual `src/` is just `main.ts` + `styles.css` (those modules now live in `speedrungames-sdk`).
  - `README.md:26` says "In `src/storage.ts`, replace `SLUG = "REPLACE_ME"`" — wrong file. The sentinel lives in `src/main.ts:16`.
  - `README.md:36` instructs editing `apps/web/src/lib/games.data.json` in the umbrella; the umbrella now uses `discover-games.mjs` auto-discovery via the manifest — that manual edit is obsolete.
- **"Plain-static" alternative path bypasses SDK and path lint.** `README.md:72-80` + `netlify.toml:2-5` comment block document a no-bundler fork. If someone follows it, they lose typecheck, lint:paths, AND the SDK — three layers of safety at once. Either remove this option or make it a separate template repo.
- **No README in `src/`** explaining the "replace gameplay between `─── Gameplay` comments" idiom. The marker exists at `src/main.ts:36-111` but the convention is only documented in AGENTS.md.
- **`speedrungames.json` has no JSON schema available at the `$schema` URL.** Line 2 points at `https://speedrungames.net/schema/speedrungames.v1.json` — if not actually published, editor tooling won't validate manifests.
- **SDK pin is at v0.1.0** (`package.json:14`). Repo has no mechanism (renovate, dependabot, CI job) for noticing new SDK tags. AGENTS.md tells the agent to do this manually, but only on demand.
- **No HTML smoke test in CI.** Build passing doesn't mean the page boots in a real browser. A headless-Chrome boot check could catch a broken import/typo before the deploy.
- **`netlify.toml` lacks `[[redirects]]` for SPA fallback** — fine for canvas games today, but a footgun if a game ever uses History API routing.

## Hot paths
- `src/main.ts` — the only file an agent edits. Lines 36-111 (the "Gameplay" section) are what gets replaced. Lines 1-35 + 113 (boot + SDK wiring) should stay intact.
- `speedrungames.json` — manifest the umbrella reads. Four `REPLACE_ME` fields. `deployUrl` should match Netlify site URL.
- `vite.config.ts` — `base: "./"` is the single most important byte. Removal breaks proxied games.
- `scripts/check-relative-paths.mjs` — the only gate that catches a missing `base: "./"`. Don't disable, don't loosen.
- `AGENTS.md` — single source of truth for the build workflow. README is partly stale; AGENTS is current.
- `index.html` — just update the `<title>` after fork.

## Notes for AI agents
- **Canonical:** this repo *is* the template; do not edit downstream forks here.
- **Related repos:**
  - `Brynrg/speedrungames-sdk` — runtime modules (timer/storage/hud/game/leaderboard). Bump pin in `package.json` when new tags ship.
  - `Brynrg/speedrungames` — umbrella that proxies forked games under `/games/<slug>/`. Auto-discovers via `speedrungames.json`.
- **Always:** keep `base: "./"`, keep `npm run typecheck && npm run build && npm run lint:paths` green, use relative paths only.
- **Do not:** add absolute paths anywhere in source HTML/CSS/JS. Add external CDN dependencies without a fallback. Reinvent SDK functionality inline (open a PR on the SDK instead).
- **When forking:** replace `REPLACE_ME` in three places (`src/main.ts:16`, `speedrungames.json:3-7`, `index.html:7`), then either delete or rewrite the gameplay block in `src/main.ts:36-111`. Verify `npm run build && npm run lint:paths` before pushing.
- **README is partially stale** — prefer AGENTS.md for current state; either fix README in this repo or treat AGENTS.md as authoritative when they conflict.
