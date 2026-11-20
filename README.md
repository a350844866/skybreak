# Skybreak

**A 60-second, mouse-only reflex challenge built for a Cloud9 event booth.**
A fan walks up, plays one run, and walks away with a *skill card* that rates the three skills competitive shooters train (reaction, flick aim and tracking). Their score then climbs a live daily leaderboard on a second monitor. Everything runs offline on one booth PC.

Entry for the **Cloud9 × JetBrains "Sky's The Limit" Hackathon 2026, Category 3 (Event Mini Game)**.

- **Play it:** https://a350844866.github.io/skybreak/ (the leaderboard screen is `?view=board`)
- **Demo video:** https://youtu.be/GekRpsC8CgY
- **How it was built with WebStorm + Junie:** [AI_SHOWCASE.md](AI_SHOWCASE.md)

## The problem

Booth games have to work for strangers, in a queue, on loud show floors:

- **Short.** A run has to be quick enough that the line keeps moving.
- **No tutorial.** People skip instructions.
- **Replayable.** There needs to be a reason to come back later.
- **Reliable.** It runs all day on one PC, often without Wi-Fi.

Most aim trainers are made for long, solo practice. Skybreak is made for that one minute at the booth.

## How a run works

`ATTRACT → 3-2-1 → Lightning (≈15 s) → Drones (20 s) → Comet (20 s) → skill card → initials → back to ATTRACT`

| Stage | Skill | What you do | Measured as |
|---|---|---|---|
| **Lightning** | Reaction | Click the moment the sky flashes (5 strikes). | ms, from the flash frame to `pointerdown` |
| **Drones** | Flick | Click each drone before it escapes (1.4 s each); a streak multiplier rewards consecutive hits. | time-to-kill (ms), accuracy (%) |
| **Comet** | Tracking | Keep the cursor inside the comet's halo; every 3 s of lock is a +300 m bonus. | on-target time (%) |

- **Scoring:** your score is shown as **altitude in metres** ("Sky's the limit").
- **Skill card:** four 0–100 ratings (Reaction, Flick, Precision, Tracking), a title from your strongest skill, and a tier from *Cumulus* to *Sky's The Limit*.

## Booth features

- **Attract mode:** a ghost cursor plays the game, and today's top 3 is shown on screen.
- **Live leaderboard on a second monitor** (`?view=board`):
  - shows today's top 10 and the all-time top 5
  - highlights the newest run and shows a LIVE indicator while someone is playing
  - is kept in sync across windows with `BroadcastChannel` and IndexedDB
- **Arcade-style 3-letter initials:** mouse wheels or keyboard, with a profanity filter. After 25 s of idle the run is saved automatically.
- **Operator panel** (`Ctrl+Shift+O`, PIN `0909`, changeable):
  - pause
  - start a new event day, clear today's runs
  - export the runs as CSV
  - toggle sound and fullscreen
  - live diagnostics (fps, frame-time p95)
- **Works offline:** a service worker precaches the build, so once the page has loaded the game and the board run with the network cable pulled.
- **Original assets:** all art is procedural (three.js geometry and shaders) and all sound is synthesised with WebAudio at runtime. There are no third-party assets, fonts or Riot content.

## Methodology

- **Reaction time** is measured from the `requestAnimationFrame` timestamp of the first frame that shows the flash to the `pointerdown` event timestamp. A click less than 100 ms after the flash counts as an anticipation guess (a false start), as in standard reaction testing.
- **Simulation:** gameplay runs on a fixed 10 ms step driven by `performance.now()` and input event timestamps, separate from rendering, so the frame rate cannot change a score.
- **Precision** is hits ÷ (hits + misses). Escapes already cost score and break the streak, so they are not counted against precision a second time.
- **Ratings** use fixed reference curves (`src/game/rating.ts`), so a card means the same thing at every event.
- **Comet path:** a sum of three sines with random phases. It is a pure function of stage time and the run's seed. It speeds up from 0.45× to 0.75× over the stage and turns with eased 400 ms reversals, so it is unpredictable but always followable. Leaving the halo for 150 ms or less keeps your lock, but time outside the halo is never credited.
- **Fairness on the first run:** every shader is compiled on the first attract-mode frame, and the audio context is created at load. So the first player after a page load is not timed against a stalled frame.

## Reliability and performance

| Check | Result |
|---|---|
| Unit tests (Vitest) | 42 tests: scoring, ratings, state machine, stages, leaderboard, initials |
| Browser tests (Playwright, run on every push in CI) | 8 end-to-end tests: full run; reaction-time honesty; false starts; abandoned run; resize mid-stage; operator pause; operator tools; offline. CI treats a test that only passes on retry as a failure. |
| Soak harness | `npm run soak` plays up to 300 runs back to back. It checks heap, DOM nodes and listeners, and fails on any page error. |
| Real GPU (MacBook Pro M2 Pro, Chrome, 1080p) | No frame over 25 ms in any stage. JS time per frame p95 ≤ 0.8 ms, against a 12 ms budget. At 120 Hz no stage dropped a frame. |
| 10-run soak on real GPU | Heap after GC stayed flat (5.7–6.2 MB), DOM nodes constant, 0 page errors |

The real-GPU numbers come from [`playtest/bot_mbp.py`](playtest/bot_mbp.py), a bot that plays the game in a real browser through the `?hook` event stream. The reports are in [`playtest/`](playtest/).

## Run it locally

Requires Node 22.

```bash
npm ci
npm run dev        # http://localhost:5200
npm run build && npm run preview   # production build on http://localhost:5201
npm test           # unit tests
npm run e2e        # browser tests (first time: npx playwright install chromium)
```

### Booth setup

1. Open the game full screen on the main monitor.
2. Open `?view=board` in a second window on the second monitor.
3. Press `Ctrl+Shift+O` for the operator panel.

## Built with

TypeScript (strict), Vite, three.js, WebAudio, IndexedDB, BroadcastChannel and a service worker. Tests use Vitest and Playwright.

**JetBrains tools:**

- **WebStorm**: the project's IDE (`.idea/` is committed).
- **Junie**, JetBrains' AI coding agent, with **JetBrains AI Ultimate**: Junie implemented the gameplay iteration that came out of the first human playtest. Its commits carry a `Generated-by: Junie (JetBrains)` trailer.

The whole agent workflow, including what Claude Code did and what Junie did, is described honestly in [AI_SHOWCASE.md](AI_SHOWCASE.md).

## License

[MIT](LICENSE)
