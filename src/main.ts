import './style.css';
import { scoreLightning, scoreRun, summarizeComet, summarizeDrones } from './game/scoring';
import { comet } from './game/stages/comet';
import { drones } from './game/stages/drones';
import { lightning } from './game/stages/lightning';
import { pointerPoint } from './game/stages/stage';
import type { Point, Stage } from './game/stages/stage';
import { COUNTDOWN_MS, resetRun, transition } from './game/stateMachine';
import type { RunEvent } from './game/stateMachine';
import { gameView } from './render/gameView';
import { screens } from './ui/screens';

const canvas = document.querySelector<HTMLCanvasElement>('#playfield')!;
const ui = screens();

function mount(view: ReturnType<typeof gameView>) {
  const { surface, draw } = view;
  const app = new AbortController();
  let screen = new AbortController();
  let state = resetRun(performance.now());
  let frame = 0;
  let idleTimer: number | undefined;
  let stage: Stage | undefined;
  let pointer: Point | null = null;

  function leave() {
    screen.abort();
    cancelAnimationFrame(frame);
    window.clearTimeout(idleTimer);
    stage?.dispose();
    stage = undefined;
  }

  function dispatch(event: RunEvent) {
    const previous = state.phase;
    state = transition(state, event);
    if (state.phase !== previous) {
      leave();
      screen = new AbortController();
      enter();
    }
  }

  function enter() {
    const options = { signal: screen.signal };
    const { enteredAt, phase } = state;
    if (phase === 'ATTRACT') {
      surface.color(0x101828);
      ui.attract();
      draw();
      document.addEventListener('click', () => dispatch({ type: 'start', now: performance.now() }), options);
      return;
    }

    if (phase === 'COUNTDOWN') {
      let seconds = 3;
      ui.countdown(seconds);
      function countdown(now: number) {
        dispatch({ type: 'tick', now });
        if (state.phase !== 'COUNTDOWN') return;
        const remaining = Math.min(3, Math.ceil((COUNTDOWN_MS - now + enteredAt) / 1000));
        if (seconds !== remaining) ui.countdown(seconds = remaining);
        frame = requestAnimationFrame(countdown);
      }
      frame = requestAnimationFrame(countdown);
      return;
    }

    if (phase === 'RESULTS' || phase === 'INITIALS') {
      surface.color(0x101828);
      ui.results(state.stats);
      draw();
      function armIdle() {
        window.clearTimeout(idleTimer);
        if (state.idleDeadline === null) return;
        idleTimer = window.setTimeout(() => {
          dispatch({ type: 'tick', now: performance.now() });
          if (!options.signal.aborted) armIdle();
        }, Math.ceil(state.idleDeadline - performance.now()));
      }
      function activity() {
        dispatch({ type: 'input', now: performance.now() });
        if (!options.signal.aborted) armIdle();
      }
      document.addEventListener('click', () => dispatch({ type: 'done', now: performance.now() }), options);
      document.addEventListener('pointermove', activity, options);
      document.addEventListener('pointerdown', activity, options);
      document.addEventListener('keydown', activity, options);
      document.addEventListener('wheel', activity, { ...options, passive: true });
      armIdle();
      return;
    }

    const active = phase === 'STAGE_LIGHTNING' ? lightning(surface)
      : phase === 'STAGE_DRONES' ? drones(surface) : comet(surface, pointer);
    stage = active;
    ui.stage(phase);
    active.start(enteredAt);
    let previousFrame = enteredAt;
    const carriedAltitude = scoreRun(state.stats);

    function play(now: number) {
      const done = active.update(now - previousFrame, now);
      previousFrame = now;
      const result = active.result();
      if (done) {
        dispatch({ type: 'stageComplete', now, result });
        return;
      }
      const score = result.phase === 'STAGE_LIGHTNING' ? scoreLightning(result.stats)
        : result.phase === 'STAGE_DRONES' ? summarizeDrones(result.stats).altitude
          : summarizeComet(result.stats).altitude;
      const elapsed = now - enteredAt;
      ui.update(elapsed, active.durationMs - elapsed, carriedAltitude + score);
      draw();
      frame = requestAnimationFrame(play);
    }
    play(enteredAt);
  }

  // Preserve a stationary cursor when the stage changes under it.
  const appOptions = { signal: app.signal };
  const rememberPointer = (event: PointerEvent) => { pointer = pointerPoint(canvas, event); };
  window.addEventListener('pointermove', rememberPointer, appOptions);
  window.addEventListener('pointerdown', rememberPointer, appOptions);
  document.documentElement.addEventListener('pointerleave', () => { pointer = null; }, appOptions);
  window.addEventListener('resize', () => {
    view.resize();
    if (!stage) draw();
  }, appOptions);
  enter();

  return () => {
    leave();
    app.abort();
    view.dispose();
  };
}

let view: ReturnType<typeof gameView> | undefined;
try {
  view = gameView(canvas);
} catch {
  ui.unavailable();
}
if (view) {
  const dispose = mount(view);
  import.meta.hot?.dispose(dispose);
}
