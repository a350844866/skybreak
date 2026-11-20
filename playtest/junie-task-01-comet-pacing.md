# Junie task #1 — Comet fairness, Lightning pacing, first-click hitch, console cleanup

Branch: `junie/comet-pacing`, cut from the latest `main` once M4 has landed. Read `AGENTS.md` and `DESIGN.md` first; their rules apply. This task explicitly authorises the `DESIGN.md` edits listed in §E.

## Why

The MBP playtest on 2026-11-20 ([2026-11-20-mbp.md](2026-11-20-mbp.md)) found that performance is fine, but the human player rated fun 0/5 and said of the Comet stage: "I can't keep up with the speed". Simulating `src/game/stages/comet.ts` at 1920×1080 gives these numbers:

- Comet speed: p50 572 px/s, p95 1223 px/s, max 1596 px/s.
- The halo radius is only 46 px.
- Every 1.5–3 s the path reverses **instantly**. One 10 ms step can change the velocity by up to 3134 px/s.
- A 3 s continuous lock almost always contains a reversal, so the +300 m bonus is out of reach for humans.

Separately, a Chrome trace shows that the first "Click to play" on a fresh page blocks the main thread for about 220 ms. The cause is `new AudioContext()` inside the pointerdown unlock: `AudioOutputDevice::GetOutputDeviceInfo` runs synchronously.

## A. Comet (`src/game/stages/comet.ts`, plus the renderer if the radius changes how it looks)

1. **Speed ramp.** Path time advances at a multiplier that rises linearly from 0.45 at stage start to 0.75 at 20 s. The path shape (the three sines and their random phases) stays as it is.
2. **Smooth reversals.** Reversals happen every 3–5 s instead of every 1.5–3 s. Each reversal eases the direction factor from ±1 to ∓1 over 400 ms with a cosine curve, so the comet slows, turns and accelerates instead of snapping back. The path must stay a pure function of elapsed stage time and the injected `random`, so tests stay deterministic.
3. **Bigger halo.** `cometRadius = min(64, 10 % of the shorter side)` (was `min(46, 7.5 %)`). The rendered halo and the hit test must keep using the same value.
4. **Lock grace.**
   - A lock survives exits of up to 150 ms. Leaving the halo and coming back within 150 ms keeps the same lock.
   - Time spent outside is never credited to on-target time, and does not count toward the 3 s bonus.
   - Once the cursor has been outside for more than 150 ms, the lock ends at the moment it left.
5. Keep the scoring constants: 120 m per on-target second, +300 m per full 3 s of lock, `BONUS_LOCK_MS = 3000`.

## B. Lightning (`src/game/stages/lightning.ts`)

- The random delay before each flash goes from 1.2–3.0 s to **0.9–2.2 s**.
- Keep everything else: 5 trials, the 15 s cap, `ANTICIPATION_MS = 100`.

## C. First-click hitch (`src/audio/synth.ts`, `src/game/mount.ts`)

- Create the `AudioContext` before the first click: at mount, or on the first `pointermove` in ATTRACT, so the ~200 ms device query runs while nobody is interacting.
- After that, `unlock()` only calls `resume()`.
- Audio must still start reliably on the first gesture. A single autoplay-policy console *warning* at load is acceptable.

## D. Console cleanup

- Add an inline favicon in `index.html`, for example `<link rel="icon" href="data:,">` or a small inline SVG. No network requests, per AGENTS.md. This removes the two `/favicon.ico` 404 errors on every load.
- In `src/render/fx.ts`, `flat()` passes `blending: undefined` for non-additive materials, which logs `THREE.Material: parameter 'blending' has value of undefined.` 8 times per load. Pass `NormalBlending`, or omit the key.

## E. Docs and tests

- Update `DESIGN.md`:
  - §Stage 1: the flash delay is 0.9–2.2 s.
  - §Stage 3: describe the speed ramp, eased reversals every 3–5 s, the 64 px halo and the 150 ms lock grace.
- Add or adjust tests in `tests/unit/stages.test.ts`, all with a seeded `random`:
  - At 1920×1080 the Comet radius is 64.
  - Over a 20 s run sampled every 10 ms, the comet's velocity never changes by more than 120 px/s between consecutive steps (no snap reversals).
  - Lock grace: a 100 ms exit keeps the lock and its bonus progress; a 200 ms exit ends the lock at the exit time; outside time is not credited.
  - Lightning delays fall within 900–2200 ms.
- Existing tests that encode the old numbers should be updated, not deleted.

## Acceptance

1. `npm test` passes; check the `Tests` line, not just the end of the output. `npm run build` passes.
2. Comet speed at 1920×1080, measured with any 300 seeds: p50 ≤ 360 px/s, p95 ≤ 800 px/s, max ≤ 1250 px/s. The reference simulation of this spec gives 328 / 746 / 1193.
3. MBP real-GPU regression with `playtest/bot_mbp.py` (run by MBP Claude):
   - 0 frames over 1.5× the refresh period in any stage.
   - On the first run of a fresh page, no frame over 50 ms at the start of COUNTDOWN.
   - Exactly 0 console errors.
4. Human playtest round 2 (the user): the comet feels followable. Targets are Tracking ≈ 40–70 % and at least one +300 bonus in 3 runs.

## Out of scope

- New mechanics or "fun" features (task #2, after round 2).
- Drones.
- Leaderboard, operator panel, service worker.

Report back with what you changed, what you verified (paste the `Tests` line), and anything left undone.
