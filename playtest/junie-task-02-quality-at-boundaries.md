# Junie task #2 — Never change render resolution during a timed stage

Branch: `junie/quality-at-boundaries`, cut from the latest `main`. Read `AGENTS.md` and `DESIGN.md` first; their rules apply. This task explicitly authorises the `DESIGN.md` edit in §D.

## Why

`src/render/gameView.ts` has a booth safeguard, `adaptQuality()`:

- It samples frames in windows of 180.
- If more than 30 frames in a window are slower than 1/45 s, it lowers the pixel ratio by 0.25, down to a floor of 0.75.
- It then calls `resize()` at once, whatever the game is doing.

Your task #1 report found the problem. That `resize()` (`renderer.setSize`) stalls the main thread for **66–240 ms** on SwiftShader, and it can fire in the middle of a stage:

- If it lands on a flash frame, the flash appears late while the reaction clock is already running.
- If it lands on a drone-spawn frame, the drone appears late while its time-to-kill clock is already running.

This only happens on the slow machines the safeguard exists for, such as integrated-graphics booth PCs. Those are exactly where fairness matters. Because of this stall, task #1 had to narrow its e2e frame check to first-use frames.

## A. Defer quality changes to non-stage phases

1. **Keep measuring in every phase**, with the same thresholds: a 180-frame window, more than 30 frames over 1/45 s, steps of 0.25, a floor of 0.75. Slow frames during a stage still count.
2. **Never apply a pixel-ratio change during a timed stage** (`STAGE_LIGHTNING`, `STAGE_DRONES`, `STAGE_COMET`).
   - If a window decides to drop during a stage, record the drop as pending.
   - Apply it when the game next enters a phase that is not a stage: `RESULTS`, `INITIALS`, `ATTRACT` or `COUNTDOWN`. A drop decided outside a stage applies at once, as it does today.
   - Several pending decisions collapse into one step per window. Do not drop by more than one step per window just because the drops were deferred.
3. **Give the view a phase signal.** For example, `view.setStageActive(active: boolean)`, called from `mount.ts` `enter()`. Switching to inactive applies any pending drop. Keep gameplay code free of renderer details.
4. **Leave real window resizes alone.** Window `resize` and fullscreen toggles must still resize at once, because hit-testing depends on the real canvas size.
5. **Make the decision logic a pure module.** Following AGENTS.md, move it into a plain TS module (for example `src/render/quality.ts`) with no three.js or DOM imports, so it can be unit-tested. `gameView.ts` only applies the result.

## B. Tests

**Unit tests** for the pure module:

- The thresholds and the floor are unchanged.
- A drop decided while a stage is active is not applied until the stage becomes inactive.
- A drop decided while no stage is active applies at once.
- Repeated slow windows during one stage still produce at most one step per window, never below 0.75.

**e2e tests:**

- Extend the frame tap in `tests/e2e/support.ts` to also record the canvas drawing-buffer width (`#playfield` `width`) per frame.
- In the full-run test, assert that the drawing-buffer width never changes inside any `STAGE_*` phase. The full run does not resize the window.
- Try asserting again that **every** frame of each stage stays under 50 ms of JS (`workMax` over all of the stage's frames, not just first-use frames). This is the check that failed in task #1.
  - Keep it only if it passes reliably: run the full-run test locally at least 3 times in CI mode (`CI=1`, one worker, e.g. `--repeat-each=3`).
  - If some other stall still breaks it, keep the first-use check, do not add the whole-stage check, and report what the stall is.
- Keep every e2e interface in `playtest/2026-11-20-home-m4.md` §3.3 working.

## C. Out of scope

- Do not change the thresholds, the floor or the step.
- Do not add a way to raise quality back up.
- Do not change gameplay, scoring or visuals.

## D. Docs

In `DESIGN.md`, where rendering, performance or booth safeguards are described, add one sentence: the adaptive resolution measures in every phase, but only applies changes outside timed stages.

## Acceptance

1. `npm test` passes; paste the `Tests` line. `npm run build` passes. `CI=1 npm run e2e` passes, and CI on the pushed branch is green.
2. The new unit tests fail on the old behaviour; state how you checked this.
3. The drawing-buffer width is constant within every stage of the full-run e2e. Also report the whole-stage `workMax` per stage that you measured.
4. The MBP real-GPU regression with `playtest/bot_mbp.py` (run by Claude) shows no change in stage frame timing.

## Rules

- Commit to this branch only. End every commit message with the trailer line `Generated-by: Junie (JetBrains)`.
- Do not push. Do not touch `playtest/`.
- Report what you changed (by file), what you verified, and anything left undone.

## Outcome (2026-11-20, added by the orchestrator)

**Merged in `d7ecd15`.**

The independent review led to a follow-up (commits `8148aa5` and `7515dc2`). It changed one thing from §A.2: a deferred drop is no longer applied inside `enter()`. `setStageActive(false)` only marks the drop as due, and the next `render()` applies it through `takeDue()`, unless a stage is active again by then.

**4 CI re-runs, all green.**

- Whole-stage worst frame (JS):
  - Lightning 2.7–3.9 ms
  - Drones 4.1–6.7 ms
  - Comet 4.5–7.1 ms
- The 960 → 720 drop landed in RESULTS every time.
- The 50 ms whole-stage check stays.
