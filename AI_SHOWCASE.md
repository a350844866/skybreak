# AI-powered workflow: how Skybreak was built

Skybreak was built by AI coding agents working from a written spec. Three things kept the work honest: a human, measurements, and a review step for every change. This page describes who did what, as it actually happened. The numbers come from the commits and reports in this repository.

## The setup

| Role | Who | What it did |
|---|---|---|
| Spec owner | a human | Chose the category and the concept; playtested the game; gave the final yes/no on anything public |
| Builder, milestones 1–4 | Claude Code (Anthropic), on a home server | Wrote the game and test infrastructure from [`DESIGN.md`](DESIGN.md) and [`AGENTS.md`](AGENTS.md) |
| Tester and orchestrator | a second Claude Code session, on a MacBook Pro | Measured on a real GPU, collected human playtest feedback, wrote the task specs for Junie, reviewed Junie's work |
| Implementer, iterations after the first playtest | **Junie** (JetBrains AI coding agent, CLI 26.11.2, signed in with JetBrains AI Ultimate), in the project as opened in **WebStorm** | Implemented the changes that came out of the first playtest, then the render-stall fix it had found itself |

`AGENTS.md` was written for coding agents ("guidelines for coding agents (Junie)") from day one. It holds the rules every agent followed: pure logic kept separate and unit-tested, every listener and timer disposed per run, no network at runtime, and no `Date.now()` for gameplay timing.

## 1. Spec first, then milestones

Milestones 1–4 came straight from `DESIGN.md`:

1. A playable three-stage run, with scoring and ratings
2. Leaderboard, board view and operator panel, working offline
3. Visuals and audio
4. Booth hardening: 8 Playwright e2e tests on CI, a 300-run soak harness, a CI workflow that fails on flaky tests

Every milestone ended with `npm test` and `npm run build` passing. Milestone 4 was also checked by a separate Claude reviewer before it landed.

## 2. Measure on real hardware, then ask a human

The second agent built [`playtest/bot_mbp.py`](playtest/bot_mbp.py). It is a bot that plays the game in a real browser, reads targets from the `?hook` event stream, and logs frame timings. On a MacBook Pro (M2 Pro, Chrome, ANGLE Metal):

- At 1080p on the 120 Hz screen, no stage dropped a frame.
- JS time per frame p95 was ≤ 0.6 ms, against a 12 ms budget.
- Over 10 back-to-back runs the heap stayed flat.

The numbers looked fine, but the human playtest did not ([report](playtest/2026-11-20-mbp.md)):

- **"I can't keep up with the speed."** Simulating the comet path from the source explained it:
  - speed: median 572 px/s, peaks of 1,600 px/s
  - halo radius: 46 px
  - instant reversals every 1.5–3 s
  - The bot scored 99 % on tracking only because it reads exact coordinates every 15 ms.
- **Fun was rated 0 out of 5.**
- **A Chrome trace showed a ~220 ms stall on the first "Click to play".** It came from `new AudioContext()`, which queries the audio device synchronously.

## 3. A spec Junie could run with

The orchestrator turned these findings into [`playtest/junie-task-01-comet-pacing.md`](playtest/junie-task-01-comet-pacing.md). Every change in it has a measurable acceptance criterion, and the targets were checked by simulation before Junie started:

- **Comet:**
  - speed ramps from 0.45× to 0.75×
  - eased 400 ms reversals every 3–5 s
  - 64 px halo
  - 150 ms lock grace
  - targets: median ≤ 360, p95 ≤ 800, max ≤ 1,250 px/s; velocity change ≤ 120 px/s per 10 ms step
- **Lightning:** 0.9–2.2 s between flashes.
- **First-click stall:** move it out of the click.
- **Console:** zero console errors, and remove the e2e favicon allowlist.
- **Shaders:** pre-compile every shader before any stage. The home-server agent added this one; its M4 report measured a 261 ms first-flash stall under SwiftShader.

Junie ran from the command line in the project's WebStorm workspace on a dedicated branch, `junie/comet-pacing`. It produced four commits, each ending in `Generated-by: Junie (JetBrains)`, and checked its own work:

| | Before | After (Junie's measurement, re-checked by Claude) |
|---|---|---|
| Comet speed median / p95 / max | 572 / 1,223 / 1,596 px/s | **335 / 747 / 1,184 px/s** |
| Largest velocity change per 10 ms step | 3,134 px/s (snap reversals) | **81.6 px/s** |
| First comet frame on a fresh page (SwiftShader) | 71.6 ms of JS | **2.4 ms** |
| Stall at the start of the first countdown (real GPU) | 150–242 ms | **none over 25 ms** |
| Console errors per load | 2 (favicon 404) | **0** |
| Unit tests | 32 | **40** |

Junie also reported where it deviated from the spec, and why:

- A whole-stage "no frame over 50 ms" check could not pass. The cause was a different stall: the existing adaptive-resolution fallback resizes the canvas in the middle of a stage.
- So Junie scoped its new e2e check to the first frame each material is used, and flagged the resize as the next thing to fix. That became task #2 (§5).

That is the kind of finding a spec-only workflow would have missed.

## 4. Independent review, then a fix with a failing test first

A separate Claude reviewer read only the code and the spec, not the orchestrator's conclusions. It found one real bug:

- **The bug:** the 150 ms lock grace was checked only on the 10 ms simulation steps. A cursor that came back between steps could keep a lock after up to ~160 ms outside, and earn a +300 m bonus it shouldn't have.
- **The fix:** Junie got a focused follow-up task. It wrote the off-step test first; the test failed on the old code. Then Junie fixed `sample()` (commit `7b65015`).
- **After the fix:** 42 unit tests pass. CI treats a test that only passes on retry as a failure. It was green on both pushes of the branch, before and after the fix.

## 5. Junie's own finding becomes Junie's next task

Junie's deviation note (§3) became [Junie task #2](playtest/junie-task-02-quality-at-boundaries.md): never change the render resolution while a timed stage is running.

**The problem.** The booth safeguard lowers the pixel ratio when a weak GPU can't hold the frame rate. Doing that calls `renderer.setSize`, which stalls the main thread for 66–240 ms under SwiftShader. That stall could land on a flash or drone frame while the reaction or time-to-kill clock was already running.

**Junie's first pass** (3 commits):
- moved the decision into a pure, unit-tested module, `src/render/quality.ts`
- kept measuring in every phase
- deferred any drop decided during a stage until the stage ends
- made the e2e test record the canvas drawing-buffer width on every frame

Junie checked that the work actually tests something:
- swapping the old logic back in made 3 of the new unit tests fail
- forcing the old behaviour in the browser made the new whole-stage check fail at 248 ms

**The review.** A second independent Claude reviewer found nothing critical. It raised two evidence gaps:
- a green CI run could not show that the deferral had ever happened
- a "< 50 ms per frame in every stage" check might be flaky on a slow CI runner

It also flagged two smaller items: a hand-written phase list, and a resize that ran while the results screen was being built.

**Junie's follow-up** (2 commits): the full-run test now prints each stage's frame numbers and where every resolution change happened into the CI log. It also added an `isStagePhase()` helper, and the deferred resize now runs on the next frame instead of inside the phase change.

**Deciding with data.** The orchestrator re-ran CI 4 times (SwiftShader on a 2-vCPU runner, retries count as failures). All 4 runs were green:

| | Lightning | Drones | Comet |
|---|---|---|---|
| Worst frame (JS), across 4 CI runs | 2.7–3.9 ms | 4.1–6.7 ms | 4.5–7.1 ms |
| Drawing-buffer width inside the stage | unchanged | unchanged | unchanged |

On every run the 960 → 720 resolution drop happened in RESULTS, after the stages. So the deferral was exercised for real, and the 50 ms check stays, with a 7× margin. On the MacBook Pro's real GPU, stage frame timing was unchanged.

## 6. What we learned

- **Measured targets make agents reliable.** "Make the comet easier" is a wish. "Median ≤ 360 px/s, velocity change ≤ 120 px/s per 10 ms step" is a contract that Junie could meet and a reviewer could check.
- **Bots measure performance; humans measure fun.** The bot scored 99 % on a stage no human could follow.
- **Reviews need fresh eyes.** The reviewer that had not seen the orchestrator's reasoning found the bug the orchestrator's own reading missed.
- **Let the implementer report deviations.** Junie's note about the mid-stage resize stall was not buried in a weakened test. It became Junie's next task, and that task is now fixed.
- **Decide flaky-or-not with data.** Printing the measured numbers in CI turned "might be flaky" into four runs of evidence.

## Evidence in this repository

- **`.idea/`:** the WebStorm project files.
- **Junie's commits** (`git log --grep "Generated-by: Junie"`):
  - task #1: `5efdd5a`, `97b4d82`, `df7cbe5`, `6d69f07`, `7b65015`
  - task #2: `96c6ff4`, `0059209`, `806b8fe`, `8148aa5`, `7515dc2`
- **[`playtest/`](playtest/):**
  - the real-GPU bot and its data
  - the playtest reports from both machines
  - the hackathon plan
  - the Junie task specs
