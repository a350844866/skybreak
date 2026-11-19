# AGENTS.md — guidelines for coding agents (Junie) in this repo

You are implementing **Skybreak**, a 60-second booth arcade game. The full spec
is in `DESIGN.md`; read it before every task and do not contradict it. If a task
seems to conflict with the spec, follow the task and note the conflict in your
final summary.

## Stack
- Vite + TypeScript (`strict: true`, no `any` unless commented why) + three.js.
- No UI framework. HUD/overlays are plain DOM + CSS over the WebGL canvas.
- Tests: Vitest (`npm test`), Playwright for e2e (`npm run e2e`).
- Node 22. Use `npm`, not yarn/pnpm.

## Rules
- Keep pure game logic (scoring, rating, state machine, leaderboard ranking,
  initials filter) in plain TS modules with no DOM/three imports, and cover it
  with unit tests.
- Booth reliability matters more than features: every run must start from a
  fresh state. Remove every event listener / timer / animation you add when a
  stage or screen exits. Reuse geometries and materials; dispose anything you
  create per run.
- All art is procedural or original. Never add third-party logos, Riot Games
  names/assets, copyrighted music or fonts with unclear licenses.
- No network requests at runtime (no CDNs, no analytics, no web fonts). The
  game must work fully offline.
- Measure time with `performance.now()` / event `timeStamp`, never `Date.now()`
  for gameplay timing.
- Before finishing a task: `npm run build` and `npm test` must pass. Report
  what you changed, what you verified, and anything left undone.
- Do not edit `DESIGN.md`, `AGENTS.md`, or files under `docs/` unless the task
  says so.
- Small, readable modules; comments explain *why*, not *what*.
