import type { CometStats, DroneStats, LightningStats, RunStats } from './scoring';

export const COUNTDOWN_MS = 3000;
export const IDLE_MS = 25_000;

export type StagePhase = 'STAGE_LIGHTNING' | 'STAGE_DRONES' | 'STAGE_COMET';
export type Phase = 'ATTRACT' | 'COUNTDOWN' | StagePhase | 'RESULTS' | 'INITIALS';

/** True for the three timed stages, whose clocks run while they are on screen. */
export function isStagePhase(phase: Phase): phase is StagePhase {
  return phase === 'STAGE_LIGHTNING' || phase === 'STAGE_DRONES' || phase === 'STAGE_COMET';
}

export interface RunState {
  readonly phase: Phase;
  readonly enteredAt: number;
  readonly idleDeadline: number | null;
  readonly stats: RunStats;
}

export type StageResult = { phase: 'STAGE_LIGHTNING'; stats: LightningStats }
  | { phase: 'STAGE_DRONES'; stats: DroneStats }
  | { phase: 'STAGE_COMET'; stats: CometStats };

export type RunEvent = { type: 'start' | 'tick' | 'input' | 'initials' | 'done' | 'reset'; now: number }
  | { type: 'stageComplete'; now: number; result: StageResult };

export function resetRun(now: number): RunState {
  return {
    phase: 'ATTRACT', enteredAt: now, idleDeadline: null,
    stats: {
      lightning: { reactionsMs: [], falseStarts: 0 },
      drones: { outcomes: [] },
      comet: { elapsedMs: 0, locksMs: [] },
    },
  };
}

function enter(state: RunState, phase: Phase, now: number): RunState {
  return {
    ...state, phase, enteredAt: now,
    idleDeadline: phase === 'RESULTS' || phase === 'INITIALS' ? now + IDLE_MS : null,
  };
}

export function transition(state: RunState, event: RunEvent): RunState {
  const { now } = event;
  if (event.type === 'reset') return resetRun(now);
  if (now < state.enteredAt) return state;
  if (state.idleDeadline !== null && now >= state.idleDeadline) return resetRun(now);

  switch (event.type) {
    case 'start':
      return state.phase === 'ATTRACT' ? enter(resetRun(now), 'COUNTDOWN', now) : state;
    case 'tick':
      return state.phase === 'COUNTDOWN' && now - state.enteredAt >= COUNTDOWN_MS
        ? enter(state, 'STAGE_LIGHTNING', now) : state;
    case 'stageComplete': {
      const { result } = event;
      if (state.phase !== result.phase) return state;
      switch (result.phase) {
        case 'STAGE_LIGHTNING':
          return enter({ ...state, stats: { ...state.stats, lightning: result.stats } }, 'STAGE_DRONES', now);
        case 'STAGE_DRONES':
          return enter({ ...state, stats: { ...state.stats, drones: result.stats } }, 'STAGE_COMET', now);
        case 'STAGE_COMET':
          return enter({ ...state, stats: { ...state.stats, comet: result.stats } }, 'RESULTS', now);
      }
      break;
    }
    case 'initials':
      return state.phase === 'RESULTS' ? enter(state, 'INITIALS', now) : state;
    case 'done':
      return state.phase === 'INITIALS' ? resetRun(now) : state;
    case 'input':
      return state.idleDeadline === null ? state
        : { ...state, idleDeadline: Math.max(state.idleDeadline, now + IDLE_MS) };
  }
  return state;
}
