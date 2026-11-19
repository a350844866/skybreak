import { scoreLightning, scoreRun, summarizeComet, summarizeDrones } from './scoring';
import { comet } from './stages/comet';
import { drones } from './stages/drones';
import { lightning } from './stages/lightning';
import { pointerPoint } from './stages/stage';
import type { Point, Stage, StageFx, StageSurface } from './stages/stage';
import { COUNTDOWN_MS, resetRun, transition } from './stateMachine';
import type { RunEvent } from './stateMachine';
import { gameView } from '../render/gameView';
import { synth } from '../audio/synth';
import { attractDemo } from '../ui/demo';
import { screens } from '../ui/screens';
import { initialsScreen } from '../ui/initials';
import { operatorPanel } from '../ui/operator';
import { frameStats } from './frameStats';
import { store } from '../store';
import type { Run } from '../store';
import { skybreakChannel } from '../store/messages';

export function mountGame() {
  const canvas = document.querySelector<HTMLCanvasElement>('#playfield')!;
  const labelRoot = document.querySelector<HTMLElement>('#fx-labels')!;
  const ghost = document.querySelector<HTMLElement>('#ghost-cursor')!;
  const ui = screens();
  document.body.dataset.phase = 'ATTRACT';
  let view: ReturnType<typeof gameView>;
  try {
    view = gameView(canvas, labelRoot);
  } catch {
    ui.unavailable();
    return;
  }

  const audio = synth();
  const subscribers: ((event: StageFx) => void)[] = [
    event => view.fx(event), event => audio.fx(event), event => ui.fx(event),
  ];
  // Opt-in test hook (?hook): exposes the effect stream so e2e/soak tests and the
  // demo recorder can see where targets are. Off for normal play.
  const hook = new URLSearchParams(location.search).has('hook') ? [] as unknown[] : undefined;
  if (hook) {
    Object.assign(window, { __skybreakFx: hook });
    subscribers.push(event => {
      hook.push({ ...event, at: performance.now() });
      if (hook.length > 4000) hook.splice(0, 2000);
    });
  }
  const app = new AbortController();
  const appOptions = { signal: app.signal };
  const metrics = frameStats();
  let screen = new AbortController();
  let pausedAt: number | null = null;
  let pauseOffset = 0;
  const gameTime = (at = performance.now()) => (pausedAt ?? at) - pauseOffset;
  // Stage feedback fans out to the renderer, the sound synth and the HUD.
  const surface: StageSurface = {
    canvas,
    viewport: view.viewport,
    theme: theme => view.theme(theme),
    fx: event => {
      // Feedback is isolated per subscriber: a renderer or audio fault must never
      // interrupt the stage that emitted the event (its state is already updated).
      for (const subscriber of subscribers) {
        try { subscriber(event); } catch (error) { console.error('Skybreak feedback error', error); }
      }
    },
    inputTime: timestamp => pausedAt === null ? gameTime(timestamp) : null,
  };
  let state = resetRun(gameTime());
  let frame = 0;
  let idleTimer: number | undefined;
  let stage: Stage | undefined;
  let onFrame: ((now: number) => void) | undefined;
  let pointer: Point | null = null;
  let runId: string | undefined;
  let initials = 'AAA';
  let runsThisSession = 0;
  let pending: Omit<Run, 'eventDay'> | undefined;
  let saving = false;
  let boardRequest = 0;

  const channel = skybreakChannel(message => {
    if (message.type === 'status-request') {
      if (runId) channel.send({ type: 'stage', runId, phase: state.phase });
      else if (pending) channel.send({ type: 'run-started', runId: pending.id });
    }
    if (message.type === 'board-changed' || message.type === 'run-finished') refreshToday();
  });

  function refreshToday() {
    if (state.phase !== 'ATTRACT') return;
    const { signal } = screen;
    const request = ++boardRequest;
    void store.topToday(3).then(runs => {
      if (!signal.aborted && request === boardRequest) ui.topToday(runs);
    }).catch(() => {
      if (!signal.aborted && request === boardRequest) ui.todayUnavailable();
    });
  }

  async function savePending() {
    if (!pending || saving) return;
    saving = true;
    ui.notice('Saving run…');
    let saved: Run;
    try {
      saved = await store.saveRun(pending);
    } catch {
      saving = false;
      if (!app.signal.aborted) ui.notice('Could not save the run. Click to retry.');
      return;
    }
    pending = undefined;
    saving = false;
    runsThisSession++;
    if (app.signal.aborted) return;
    channel.send({ type: 'run-finished', run: saved });
    refreshToday();
    const { signal } = screen;
    try {
      const ranks = await store.rankOf(saved);
      if (!signal.aborted) ui.saved(saved, ranks);
    } catch {
      if (!signal.aborted) ui.notice('Run saved. Ranks are unavailable.');
    }
  }

  function leave() {
    screen.abort();
    window.clearTimeout(idleTimer);
    onFrame = undefined;
    stage?.dispose();
    stage = undefined;
  }

  function dispatch(event: RunEvent) {
    if (pausedAt !== null) return;
    const previous = state;
    state = transition(state, event);
    if (state.phase === previous.phase) return;
    if (state.phase === 'ATTRACT' && runId && previous.idleDeadline !== null) {
      pending = { id: runId, initials, altitude: scoreRun(previous.stats), stats: previous.stats,
        createdAt: new Date().getTime() };
      runId = undefined;
    }
    if (state.phase === 'COUNTDOWN') {
      runId = Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('');
      initials = 'AAA';
      channel.send({ type: 'run-started', runId });
    }
    leave();
    screen = new AbortController();
    enter();
  }

  function armIdle() {
    window.clearTimeout(idleTimer);
    if (pausedAt !== null || state.idleDeadline === null) return;
    idleTimer = window.setTimeout(() => {
      dispatch({ type: 'tick', now: gameTime() });
      armIdle();
    }, Math.max(0, Math.ceil(state.idleDeadline - gameTime())));
  }

  function enter() {
    const options = { signal: screen.signal };
    const { enteredAt, phase } = state;
    document.body.dataset.phase = phase;
    if (runId) channel.send({ type: 'stage', runId, phase });
    if (phase === 'ATTRACT') {
      view.theme('high');
      ui.attract();
      attractDemo(view, ghost, screen.signal);
      refreshToday();
      void savePending();
      document.addEventListener('click', () => {
        if (pausedAt !== null) return;
        if (pending) void savePending();
        else dispatch({ type: 'start', now: gameTime() });
      }, options);
      return;
    }

    if (phase === 'COUNTDOWN') {
      let seconds = 3;
      view.theme('storm');
      ui.countdown(seconds);
      ui.resetAltitude(0);
      audio.countdown(seconds);
      onFrame = now => {
        dispatch({ type: 'tick', now });
        if (state.phase !== 'COUNTDOWN') return;
        const remaining = Math.min(3, Math.ceil((COUNTDOWN_MS - now + enteredAt) / 1000));
        if (seconds !== remaining) {
          ui.countdown(seconds = remaining);
          audio.countdown(seconds);
        }
      };
      return;
    }

    if (phase === 'RESULTS' || phase === 'INITIALS') {
      view.theme('high');
      if (phase === 'RESULTS') {
        ui.results(state.stats);
        audio.fanfare();
        const altitude = scoreRun(state.stats);
        void store.topToday(1).then(([top]) => {
          if (options.signal.aborted) return;
          const best = top ? Math.round(top.altitude) : null;
          const mine = Math.round(altitude);
          ui.beat(best === null ? 'First run of the day!'
            : mine > best ? 'New #1 today!'
              : mine === best ? 'Tied with today’s #1!'
                : `Beat today’s #1: ${best.toLocaleString('en-US')} m`);
        }).catch(() => undefined);
        ui.panel.querySelector('#enter-initials')!.addEventListener('click', () => {
          dispatch({ type: 'initials', now: gameTime() });
        }, options);
      } else {
        initialsScreen(ui.panel, options.signal, value => { initials = value; }, () => {
          dispatch({ type: 'done', now: gameTime() });
        });
      }
      function activity(event: Event) {
        dispatch({ type: 'input', now: gameTime() });
        if (options.signal.aborted) event.stopPropagation();
        else armIdle();
      }
      for (const type of ['click', 'pointermove', 'pointerdown', 'keydown', 'wheel']) {
        document.addEventListener(type, activity, { ...options, capture: true, passive: true });
      }
      armIdle();
      return;
    }

    const active = phase === 'STAGE_LIGHTNING' ? lightning(surface)
      : phase === 'STAGE_DRONES' ? drones(surface) : comet(surface, pointer);
    stage = active;
    ui.stage(phase);
    view.punch();
    if (phase === 'STAGE_LIGHTNING') audio.go();
    active.start(enteredAt);
    let previousFrame = enteredAt;
    const carriedAltitude = scoreRun(state.stats);
    onFrame = now => {
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
      ui.update(elapsed, active.durationMs - elapsed, active.durationMs, carriedAltitude + score);
    };
    onFrame(enteredAt);
  }

  const operator = operatorPanel({
    pause() {
      pausedAt = performance.now();
      window.clearTimeout(idleTimer);
      audio.suspend();
    },
    resume() {
      if (pausedAt === null) return;
      pauseOffset += performance.now() - pausedAt;
      pausedAt = null;
      audio.resume();
      if (app.signal.aborted) return;
      stage?.syncPointer?.(gameTime(), pointer);
      armIdle();
    },
    soundChanged(enabled) { audio.setEnabled(enabled); },
    boardChanged() {
      if (app.signal.aborted) return;
      channel.send({ type: 'board-changed' });
      refreshToday();
    },
    diagnostics: () => ({ ...metrics.read(), runsThisSession }),
  });

  function animate(now: number) {
    metrics.record(now);
    if (pausedAt === null && now >= pauseOffset) onFrame?.(gameTime(now));
    // Rendered after the stage update, so a flash or spawn set this frame is what gets drawn.
    view.render(now);
    frame = requestAnimationFrame(animate);
  }

  // Preserve a stationary cursor when the stage changes under it.
  const rememberPointer = (event: PointerEvent) => { pointer = pointerPoint(canvas, event); };
  window.addEventListener('pointermove', rememberPointer, appOptions);
  window.addEventListener('pointerdown', rememberPointer, appOptions);
  document.documentElement.addEventListener('pointerleave', () => { pointer = null; }, appOptions);
  window.addEventListener('resize', () => view.resize(), appOptions);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.suspend();
    else if (pausedAt === null) audio.resume();
  }, appOptions);
  // Browsers only allow audio after a gesture; the first click or key unlocks it.
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, () => audio.unlock(), { ...appOptions, capture: true });
  }
  void store.getSetting('sound').then(enabled => audio.setEnabled(enabled)).catch(() => undefined);
  window.addEventListener('pagehide', () => {
    if (runId || pending) channel.send({ type: 'run-ended', runId: runId ?? pending!.id });
  }, appOptions);
  window.addEventListener('pageshow', event => {
    if (event.persisted && runId) channel.send({ type: 'stage', runId, phase: state.phase });
    refreshToday();
  }, appOptions);
  enter();
  frame = requestAnimationFrame(animate);

  return () => {
    leave();
    cancelAnimationFrame(frame);
    app.abort();
    operator();
    if (runId || pending) channel.send({ type: 'run-ended', runId: runId ?? pending!.id });
    channel.close();
    audio.dispose();
    view.dispose();
  };
}
