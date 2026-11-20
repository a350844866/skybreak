# Skybreak — design spec

Entry for **Cloud9 × JetBrains "Sky's The Limit" Hackathon 2026, Category 3: Event Mini Game**.

A 60-second browser arcade game for an esports booth. A fan walks up, plays one
run with the mouse only, and walks away with a "skill card" that rates the
three skills competitive shooters train: **reaction, flick aim, tracking**.
Their score climbs a daily leaderboard shown on a second monitor at the booth.
Everything runs offline on one booth PC.

## 1. Design goals (from the Category 3 brief)

| Brief says | How Skybreak answers |
|---|---|
| One session ideally under 3 minutes, high replayability | One run is exactly 60 s of play (+ ~5 s countdown + results). Score spread is wide, so "beat the top score" keeps people coming back |
| Simple controls, no tutorial | Mouse only: move and click (stage 3: just keep the cursor on the comet). Each stage shows a one-line instruction with an icon for 1.5 s |
| Booth-ready: resets cleanly, stays responsive under sustained use | Strict state machine, every run rebuilds its state from scratch, objects are pooled, no listeners leak. A scripted soak test plays 300 runs back to back and checks frame time and heap stay flat |
| Showcase a useful gamer skill | The three stages are real training drills: reaction time (ms), flick time-to-kill and accuracy, tracking on-target %. The results card reports them in the units players already know |
| Local live leaderboard on a separate monitor, works without Wi-Fi | `?view=board` opens the leaderboard view in a second window on the second monitor. It updates live through `BroadcastChannel` (same machine, no network). Scores are stored in IndexedDB. A service worker caches the app, so it starts with the network cable pulled |
| Original names/art/assets, no Riot content | All art is procedural (three.js geometry + shaders), all sound is synthesized with WebAudio at runtime. No third-party logos, fonts are system/OFL |

## 2. The run

```
ATTRACT ──click──▶ COUNTDOWN (3-2-1) ──▶ STAGE 1 Lightning (≈15 s)
   ▲                                          │
   │                                          ▼
   │                                     STAGE 2 Drones (20 s)
   │                                          │
   │                                          ▼
   │                                     STAGE 3 Comet (20 s)
   │                                          │
   │                                          ▼
   └──── 25 s idle / "Done" ◀── INITIALS ◀── RESULTS (skill card)
```

Theme: the player is a sky scout punching up through layers of cloud. Each
stage is one layer higher; the background shifts from storm grey (stage 1) to
dusk blue (stage 2) to starfield (stage 3). Total score is shown as
**altitude in metres**: "Sky's the limit".

### Stage 1 — Lightning (reaction)
- Screen is a dark storm cloud. After a random delay of 0.9–2.2 s a lightning
  flash lights the sky; the player clicks anywhere as fast as possible.
- 5 trials. Clicking before the flash is a **false start**: the trial is
  re-rolled and costs a penalty (counted in the stats). A click less than
  **100 ms** after the flash is also a false start: no human reacts that fast,
  so it is an anticipation guess (standard rule in reaction testing).
- Measure: reaction time per trial in ms (from flash render, i.e. the
  `requestAnimationFrame` timestamp of the first frame that shows the flash, to
  the `pointerdown` event timestamp). The flash becomes visible on the next
  display refresh, so every reaction includes about one frame of display
  latency; it is the same for every player and is stated in the methodology.
- Score: per trial `max(0, 600 - ms) * 2` metres, false start −150 m.
- Stage ends after 5 valid trials or 15 s, whichever first.

### Stage 2 — Drones (flick)
- Small glowing drones pop up one at a time at random positions, at least 25 %
  of the screen diagonal away from the previous one (forces a flick). Drone
  hit radius: `min(28 px, 4.5 % of the shorter screen side)`, sized for
  first-time players on a 1080p booth monitor.
- Click to destroy. A drone lives 1.4 s, then escapes (counted as a miss).
- Measure: time-to-kill per drone (spawn → hit), hits, misses (clicks that hit
  nothing), escapes. Accuracy = hits / (hits + misses): it rates clicking
  discipline only. Escapes already cost score and break the streak, so they do
  not count against accuracy a second time; with no clicks at all accuracy is 0.
- Score: per hit `150 + max(0, 1400 - ttk_ms) / 4` metres, × accuracy streak
  multiplier (1.0 → 2.0 in steps of 0.1 for consecutive hits, reset on miss or
  escape).
- 20 s.

### Stage 3 — Comet (tracking)
- One comet flies a smooth but unpredictable path: a sum of 3 sines with
  random phase. Path time advances at a rate that ramps linearly from 0.45× at
  stage start to 0.75× at 20 s, so the comet starts slow and speeds up.
- Every 3–5 s the path reverses. A reversal is eased: over 400 ms the direction
  factor goes from ±1 to ∓1 on a cosine curve, so the comet slows, turns and
  accelerates instead of snapping back. The path is a pure function of stage
  time and the run's random seed.
- The player keeps the cursor inside the comet's halo. No clicking. Halo
  radius: `min(64 px, 10 % of the shorter screen side)`; the drawn halo and
  the hit test use the same value.
- Lock grace: a lock survives the cursor leaving the halo for up to 150 ms.
  Time outside is never credited (not to on-target time, not to the 3 s
  bonus). After more than 150 ms outside, the lock ends at the moment the
  cursor left.
- Measure: on-target % of frames (time-weighted), longest lock streak in s
  (on-target time within one lock).
- Score: `on_target_seconds * 120` metres, + a 300 m bonus for each full 3 s lock.
- 20 s.

### Results (skill card)
- Big altitude number, rank today ("#3 today"), rank all-time.
- Four bars rated 0–100 with the raw stat next to each:
  Reaction (avg ms), Flick (avg TTK ms), Precision (accuracy %),
  Tracking (on-target %). Ratings use fixed reference curves (documented in
  `src/game/rating.ts`) so a card means the same thing at every event.
- A title from the strongest skill: "Storm Reflexes", "Drone Hunter",
  "Dead-Eye", "Comet Rider"; and an overall tier: Cumulus → Stratus →
  Cirrus → Stratosphere → Sky's The Limit.

Stray clicks must not throw a result away: on RESULTS the only way forward is
the "Enter initials" button (or the idle timeout). Clicks elsewhere do nothing.

### Initials
- Arcade-style 3-letter entry, mouse only: three letter wheels, click up/down,
  then "Done". Keyboard typing also works. Default "AAA" if skipped.
- A basic profanity filter on the 3-letter combination (small blocklist).
- 25 s with no input anywhere on results/initials → save with current initials
  and return to ATTRACT.

### Attract mode
- Autoplay demo: a ghost cursor plays a short sequence of the three stages,
  with "CLICK TO PLAY" and today's top 3 overlaid. Any click starts a run.

## 3. Leaderboard / booth operation

- Storage: IndexedDB database `skybreak`, store `runs`
  (`{id, initials, altitude, stats, createdAt, eventDay}`). `eventDay` is the
  local calendar date; "today" boards filter on it.
- Board view `?view=board`: Today top 10 + All-time top 5, the newest run
  highlighted for 10 s, a "LIVE" pulse when a run is in progress (the game
  window broadcasts `run-started` / `stage` / `run-finished`).
- Sync: `BroadcastChannel('skybreak')`; board also re-reads IndexedDB every
  10 s as a fallback.
- Operator panel: `Ctrl+Shift+O` on the game window. Actions: start new event
  day (archive), clear today, export all runs as CSV, toggle sound, toggle
  fullscreen, show diagnostics (fps, frame time p95, JS heap, runs this
  session). Needs a 4-digit PIN (default `0909`, changeable in the panel).
- Offline: Vite build + a small hand-written service worker that precaches the
  built assets. After first load the game and board work with no network.

## 4. Tech

- Vite + TypeScript (strict) + three.js. No UI framework; the HUD is plain DOM
  over the WebGL canvas.
- Input: Pointer Events with `event.timeStamp`; hit tests by raycasting
  against target meshes (or screen-space distance for small targets).
- Timing: a fixed-step simulation clock (`performance.now()` based), rendering
  decoupled. Reaction time measured against the actual presented frame.
  The adaptive resolution (a booth safeguard that lowers the pixel ratio when
  the GPU cannot hold the frame rate) measures in every phase, but only
  applies changes outside timed stages.
- Audio: WebAudio synthesized SFX (thunder, zap, lock-on hum), master volume
  in the operator panel. Audio starts on the first click (browser policy).
- Tests: Vitest for pure logic (scoring, rating, state machine, leaderboard
  ranking, initials filter). Playwright for an end-to-end run and the soak test.
- Repo layout:
  ```
  src/main.ts             entry, routes ?view=board
  src/game/               state machine, stages, scoring, rating
  src/render/             three.js scene, sky shaders, target meshes, pools
  src/ui/                 HUD, results card, initials, operator panel
  src/board/              leaderboard view
  src/store/              IndexedDB + BroadcastChannel
  src/audio/              WebAudio synth
  public/sw.js            service worker
  tests/unit/             vitest
  tests/e2e/              playwright: run, soak
  ```

## 5. Non-goals
- No accounts, no network backend, no analytics.
- No GRID data (optional per rules; it does not help a reflex game).
- No touch-specific mechanics (booth PCs have mice); touch still works for
  clicking.

## 6. Milestones
1. Scaffold + state machine + three stages playable with placeholder visuals +
   scoring/rating with unit tests.
2. Leaderboard store, board view, BroadcastChannel, initials, operator panel,
   service worker.
3. Visual and audio pass: sky shaders, cloud layers, drone/comet meshes,
   transitions, results card design, attract mode.
4. Booth hardening: Playwright e2e + 300-run soak test, perf budget (p95 frame
   time < 12 ms at 1080p on integrated graphics), memory flat.
   - `npm run e2e` (tests/e2e, also in CI): full run with initials reaching the
     game and board screens, streak rule, false-start and anticipation rules,
     reported reaction never shorter than the flash-timestamp-to-click delay and
     no more than harness latency above it (presentation latency is not
     visible to this check), comet locking, idle save, stray-click guard,
     resize mid-stage, operator panel (PIN, pause, CSV, clear, PIN change),
     offline. Runs on SwiftShader, so it guards the JavaScript side of the
     frame budget (stage JS p95 < 8 ms with CI headroom) but says nothing
     about GPU time.
   - `npm run soak` (tests/soak): 300 runs back to back in one page, rotating
     skilled / sloppy / no-input play, every tenth run saved by the idle timeout;
     asserts heap slope < 15 KB/run, DOM nodes and listeners flat, no errors.
   - GPU frame time is measured on real hardware with `playtest/bot_mbp.py`
     (branch `playtest-mbp`; Apple M2 Pro, 2026-11-20: frame interval p95
     9.2 ms at 120 Hz, stage JS p95 ≤ 0.6 ms, 0 dropped frames in stages).
     Integrated graphics on Windows is still unmeasured.
5. Submission: README, methodology, JetBrains tooling write-up, AI workflow
   case study, demo video, GitHub Pages deploy.
