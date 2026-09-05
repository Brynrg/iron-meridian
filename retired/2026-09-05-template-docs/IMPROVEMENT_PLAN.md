# Improvement Plan

> Executable backlog for `Brynrg/speedrungames-game-template`. Work top-to-bottom.

## P0 — Blockers / safety

### Task 1: Add REPLACE_ME guard to CI
**Effort:** S
**Files:** `.github/workflows/ci.yml`, `scripts/check-no-replace-me.mjs` (new)
**What:** Fail CI if any tracked file contains the string `REPLACE_ME` outside of `AGENTS.md`, `README.md`, and the script itself. The intent: forks that haven't done the mandatory edits cannot land a PR or push to main.
**Why:** Right now an agent can leave `SLUG = "REPLACE_ME"` and ship a broken leaderboard submission to Netlify. The runtime check in `src/main.ts:73` silently no-ops; no human or robot will catch it.
**Steps:**
1. Create `scripts/check-no-replace-me.mjs` that walks the repo (skipping `node_modules`, `dist`, `.git`), reads tracked files, allowlists `AGENTS.md`, `README.md`, and itself, and exits 1 with a clear "found REPLACE_ME at file:line" listing if any matches remain.
2. Add `"lint:placeholders": "node scripts/check-no-replace-me.mjs"` to `package.json` scripts.
3. Add a "Verify no REPLACE_ME sentinels" step to `.github/workflows/ci.yml` between Typecheck and Build.
4. Update AGENTS.md's "Common tasks" table to reference the new script.
**Acceptance:**
- [ ] In the template repo (where REPLACE_ME sentinels exist), CI must be opted out OR the allowlist must cover the template's own sentinels — explicitly: only fail when the repo is *not* the template (e.g. detect by name in `package.json` or via env var `SPEEDRUN_TEMPLATE_REPO=true` set in this repo's GitHub Actions secrets). Document the chosen mechanism.
- [ ] In a forked repo with `SLUG = "REPLACE_ME"`, `npm run lint:placeholders` exits 1 with the file:line.
- [ ] After replacing the sentinel, `npm run lint:placeholders` exits 0.
- [ ] CI logs show the new step running and passing on a clean fork.

### Task 2: Fix stale README content
**Effort:** S
**Files:** `README.md`
**What:** Reconcile README with reality and with the umbrella.
**Why:** Three lies in one file mislead every new contributor.
**Steps:**
1. Delete `README.md:60-62` (`game.ts`, `speedrun.ts`, `storage.ts`, `ui.ts` lines) — those files don't exist; their functionality is in `speedrungames-sdk`. Replace the Layout block with what's actually in `src/`: just `main.ts` and `styles.css`.
2. Fix `README.md:26`: change `In src/storage.ts, replace SLUG = "REPLACE_ME"` to `In src/main.ts, replace SLUG = "REPLACE_ME"`.
3. Replace `README.md:36` ("add one entry to apps/web/src/lib/games.data.json") with: "The umbrella auto-discovers games via `speedrungames.json` — no umbrella commit needed once your Netlify deploy URL is in the manifest."
4. Add a one-line pointer to AGENTS.md at the top: "AI agents should read [AGENTS.md](AGENTS.md) first — it is the canonical playbook."
**Acceptance:**
- [ ] README no longer references files that don't exist in `src/`.
- [ ] README's quickstart points at `src/main.ts` for the SLUG edit.
- [ ] README mentions auto-discovery, not manual `games.data.json` edits.

## P1 — High-value

### Task 3: Wire up eslint + prettier with shared config
**Effort:** M
**Files:** `package.json`, `.eslintrc.json` (new), `.prettierrc.json` (new), `.github/workflows/ci.yml`
**What:** Add a minimal-but-strict TypeScript-aware lint + format setup so every forked game inherits identical style.
**Why:** Forks will diverge in style fast. Bake the style in at template creation time, before any drift.
**Steps:**
1. Install `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `prettier`, `eslint-config-prettier` as devDependencies (pin to current stable majors).
2. Write `.eslintrc.json` extending `eslint:recommended`, `plugin:@typescript-eslint/recommended`, and `prettier`. Parser: `@typescript-eslint/parser`. Add `no-console: ["warn", { allow: ["warn", "error"] }]`.
3. Write `.prettierrc.json` with project conventions (printWidth 100, semi true, singleQuote false, trailingComma "all").
4. Add `"lint": "eslint src --ext .ts"` and `"format": "prettier --write \"src/**/*.{ts,css,html}\""` to `package.json` scripts.
5. Run `npm run lint` and `npm run format` against the current `src/`; fix any new findings (likely none for this small file set).
6. Add `npm run lint` as a CI step in `ci.yml` between Typecheck and Build.
7. Add a "Code style" subsection to AGENTS.md pointing at the new scripts.
**Acceptance:**
- [ ] `npm run lint` exits 0 on a fresh clone.
- [ ] `npm run format` is idempotent (running twice produces no diff).
- [ ] CI runs lint and the build step still passes.

### Task 4: Add headless boot smoke test to CI
**Effort:** M
**Files:** `.github/workflows/ci.yml`, `scripts/smoke-boot.mjs` (new), `package.json`
**What:** After `vite build`, serve `dist/` and load it in headless Chrome. Fail if any `console.error` fires during the first 3 seconds, or if `document.querySelector("canvas")` returns null.
**Why:** Today `npm run build` passing only means the bundle compiled; it does not mean the SDK imports resolved at runtime or that the canvas mounted. A two-line typo in `main.ts` can pass typecheck and break the live site.
**Steps:**
1. Add `puppeteer` as a devDependency (or `playwright-chromium` — choose one, justify in the file's docstring).
2. Write `scripts/smoke-boot.mjs`: spawn `vite preview --port 4173`, wait for the port, launch puppeteer, navigate to `http://localhost:4173/`, attach a `page.on('pageerror')` and `page.on('console')` collector, wait 3000 ms, assert no `error`-level entries and `await page.$('canvas')` is non-null. Tear down preview + browser.
3. Add `"smoke": "node scripts/smoke-boot.mjs"` to scripts.
4. Add a CI step "Boot smoke test" after the existing build step, running `npm run smoke`.
5. Document in AGENTS.md under "Common tasks".
**Acceptance:**
- [ ] `npm run build && npm run smoke` exits 0 on a clean checkout.
- [ ] Introducing a syntax error in `src/main.ts` causes `npm run smoke` to exit non-zero.
- [ ] CI takes < 90s extra wall-clock for the smoke step.

### Task 5: Publish (or remove) the `$schema` URL in `speedrungames.json`
**Effort:** S
**Files:** `speedrungames.json`, optionally `schema/speedrungames.v1.json` (new)
**What:** Either publish a real JSON schema at the URL or remove the dangling `$schema` reference.
**Why:** `speedrungames.json:2` references `https://speedrungames.net/schema/speedrungames.v1.json`. If that URL 404s, editor tooling silently fails to validate the manifest, and a forked agent gets no autocomplete or required-field warnings.
**Steps (pick one path):**
- Path A: in the **umbrella** repo, add `apps/web/public/schema/speedrungames.v1.json` defining slug/title/description/emoji/deployUrl/hidden (with patterns, descriptions, required arrays). Confirm the umbrella serves static files from `public/`. Smoke-test the URL.
- Path B: remove the `$schema` line entirely from `speedrungames.json` until the schema actually exists.
**Acceptance:**
- [ ] Either `curl -fs https://speedrungames.net/schema/speedrungames.v1.json` returns the schema, or `speedrungames.json` no longer references it.
- [ ] If Path A: opening `speedrungames.json` in VS Code with the JSON extension shows live validation on the `slug` field.

## P2 — Quality / polish

### Task 6: Decide on the "plain-static" fork option
**Effort:** S–M
**Files:** `README.md`, `netlify.toml`, `AGENTS.md`, possibly a new `Brynrg/speedrungames-static-template` repo
**What:** The current "Going plain-static (no bundler)" instructions in `README.md:72-80` and the commented block in `netlify.toml:2-5` bypass three safety layers at once (typecheck, lint:paths, SDK). Decide: kill the path or formalize it.
**Why:** Documented foot-guns are still foot-guns. Either commit to supporting plain-static or stop pretending we do.
**Steps:**
- Kill path: delete the README section, the netlify.toml comments, and any AGENTS.md references. State that this template is Vite-only.
- Formalize path: create a sibling repo `Brynrg/speedrungames-static-template` (just `index.html`, `styles.css`, `game.js`, `speedrungames.json`, a relative-paths lint, a CI workflow). Link it from this README. Mention in the umbrella that both templates exist.
**Acceptance:**
- [ ] No mixed messaging — README, AGENTS.md, and netlify.toml agree on whether plain-static is supported.
- [ ] If formalized: the new repo exists, has CI, and is referenced from both AGENTS.md tables.

### Task 7: Add a fork-helper script
**Effort:** M
**Files:** `scripts/init-fork.mjs` (new), `package.json`, `AGENTS.md`
**What:** A one-shot interactive script (or arg-driven, for AI use) that prompts for slug/title/description/emoji and rewrites `src/main.ts:16`, the four fields in `speedrungames.json`, and the `<title>` in `index.html`.
**Why:** Removes the manual REPLACE_ME ritual entirely. AI agents can invoke it non-interactively with flags.
**Steps:**
1. Create `scripts/init-fork.mjs` accepting `--slug`, `--title`, `--description`, `--emoji` (with prompts as fallback).
2. Read each target file, do precise string replacement on the four known REPLACE_ME sites, write back.
3. Add `"init": "node scripts/init-fork.mjs"` to scripts.
4. Document in README quickstart and AGENTS.md "Mandatory edits before shipping" — the script becomes the recommended path; the manual instructions become the fallback.
**Acceptance:**
- [ ] `npm run init -- --slug snake --title Snake --description "a snake game" --emoji 🐍` modifies exactly three files.
- [ ] Running `npm run lint:placeholders` (from Task 1) after `init` exits 0.

### Task 8: Renovate / dependabot for SDK pin bumps
**Effort:** S
**Files:** `.github/renovate.json` (new) OR `.github/dependabot.yml` (new)
**What:** Watch `github:Brynrg/speedrungames-sdk#vX.Y.Z` and open a PR when a newer tag exists.
**Why:** Today AGENTS.md tells the agent "When the SDK tags a new version, bump the pin here" — but no automation surfaces new tags. The pin will rot.
**Steps:**
1. Dependabot does not handle GitHub-URL git deps for npm well; prefer Renovate. Add `.github/renovate.json` with `enabledManagers: ["npm"]` and an explicit rule for the `speedrungames-sdk` `github:` URL using the `gitTags` data source.
2. Install Renovate bot on the repo via GitHub App.
3. Verify it opens a test PR (you can trigger by manually pinning to an older tag temporarily).
**Acceptance:**
- [ ] A new tag in `Brynrg/speedrungames-sdk` results in an automated PR within 24 hours.
- [ ] PR includes the version diff link.

## P3 — Nice-to-haves

### Task 9: PWA manifest + icon stubs
**Effort:** M
**Files:** `public/manifest.webmanifest` (new), `public/icon-192.png` (new), `public/icon-512.png` (new), `index.html`
**What:** Give every forked game an installable Web App stub by default. Forked agents only have to swap the icons and title; theme color and manifest skeleton come for free.
**Why:** Speedrun games benefit from "Add to Home Screen" on mobile. Doing it once at the template level beats doing it in every fork.
**Acceptance:**
- [ ] `<link rel="manifest" href="./manifest.webmanifest">` in `index.html`.
- [ ] Lighthouse "Installable" passes on a built+served fork.

### Task 10: Lighthouse-CI as an optional GitHub Action
**Effort:** M
**Files:** `.github/workflows/lighthouse.yml` (new)
**What:** On PR, run Lighthouse against a preview deploy and post performance + accessibility scores as a check.
**Why:** Speedrun games live or die on input latency. Catching a regression at PR time is much cheaper than after the live game ships.

### Task 11: Document the SDK module API in this repo
**Effort:** S
**Files:** `AGENTS.md`
**What:** Expand the "SDK API quick reference" block in AGENTS.md (currently lines 55-78) to cover edge cases: what does `submitRun` do on network failure, when is HUD `destroy` necessary, can `SpeedrunTimer.pause` be called from `idle`, etc. Cross-reference the SDK repo's own docs once it has them.

### Task 12: GitHub repo template hygiene
**Effort:** S
**Files:** `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`, `LICENSE`
**What:** Add an issue template (bug / feature), a PR template that references the AGENTS.md done-checklist, and a LICENSE (probably MIT to match the umbrella's stance — confirm with owner).
