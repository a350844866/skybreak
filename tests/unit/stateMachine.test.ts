import { expect, it } from 'vitest';
import { COUNTDOWN_MS, IDLE_MS, resetRun, transition } from '../../src/game/stateMachine';
import type { RunState, StageResult } from '../../src/game/stateMachine';

const lightning: StageResult = { phase: 'STAGE_LIGHTNING', stats: { reactionsMs: [203], falseStarts: 1 } };
const drones: StageResult = { phase: 'STAGE_DRONES', stats: { outcomes: [{ kind: 'hit', ttkMs: 415 }] } };
const comet: StageResult = { phase: 'STAGE_COMET', stats: { elapsedMs: 20_000, locksMs: [3200] } };
const complete = (state: RunState, result: StageResult, now: number) => transition(state, { type: 'stageComplete', result, now });
const tick = (state: RunState, now: number) => transition(state, { type: 'tick', now });
const start = (state: RunState, now: number) => transition(state, { type: 'start', now });

function results() {
  const first = tick(start(resetRun(0), 1), 3001);
  return complete(complete(complete(first, lightning, 18_001), drones, 38_001), comet, 58_001);
}

it('follows the stage order and keeps completed raw stats', () => {
  const countdown = start(resetRun(0), 100);
  expect(countdown.phase).toBe('COUNTDOWN');
  expect(tick(countdown, 100 + COUNTDOWN_MS - 1)).toBe(countdown);
  const first = tick(countdown, 100 + COUNTDOWN_MS);
  expect(first.phase).toBe('STAGE_LIGHTNING');
  expect(complete(first, drones, 4000)).toBe(first);
  expect(start(first, 4000)).toBe(first);
  const second = complete(first, lightning, 4000);
  expect(second.phase).toBe('STAGE_DRONES');
  expect(complete(second, lightning, 4001)).toBe(second);
  const third = complete(second, drones, 24_000);
  expect(third.phase).toBe('STAGE_COMET');
  const end = complete(third, comet, 44_000);
  expect(end.phase).toBe('RESULTS');
  expect(end.stats).toEqual({ lightning: lightning.stats, drones: drones.stats, comet: comet.stats });
  expect(end.idleDeadline).toBe(44_000 + IDLE_MS);
});

it.each(['RESULTS', 'INITIALS'] as const)('returns from %s after 25 seconds without input', phase => {
  const end = results();
  const screen = phase === 'RESULTS' ? end : transition(end, { type: 'initials', now: end.enteredAt + 50 });
  expect(screen.phase).toBe(phase);
  const lastInput = screen.enteredAt + 10_000;
  const active = transition(screen, { type: 'input', now: lastInput });
  expect(active.idleDeadline).toBe(lastInput + IDLE_MS);
  expect(tick(active, lastInput + IDLE_MS - 1)).toBe(active);
  expect(tick(active, lastInput + IDLE_MS)).toEqual(resetRun(lastInput + IDLE_MS));
  expect(transition(active, { type: 'input', now: lastInput + IDLE_MS }).phase).toBe('ATTRACT');
});

it('resets explicitly or on Done, creating independent run stats', () => {
  const end = results();
  const now = end.enteredAt + 200;
  expect(transition(end, { type: 'done', now })).toBe(end);
  const initials = transition(end, { type: 'initials', now });
  const done = transition(initials, { type: 'done', now });
  const reset = transition(end, { type: 'reset', now });
  expect(done).toEqual(resetRun(now));
  expect(reset).toEqual(done);
  expect(reset.stats.lightning.reactionsMs).not.toBe(done.stats.lightning.reactionsMs);
  expect(reset.stats.drones.outcomes).not.toBe(done.stats.drones.outcomes);
  expect(reset.stats.comet.locksMs).not.toBe(done.stats.comet.locksMs);
  expect(start(done, now + 1).stats).toEqual(reset.stats);
  expect(end.stats.lightning.falseStarts).toBe(1);
});
