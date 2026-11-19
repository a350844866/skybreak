import { rateRun } from '../game/rating';
import { averageMs, scoreRun, summarizeComet, summarizeDrones } from '../game/scoring';
import type { RunStats } from '../game/scoring';
import type { StageFx } from '../game/stages/stage';
import type { StagePhase } from '../game/stateMachine';
import type { Run, Ranks } from '../store/ranking';
import { scoreList } from './scoreList';

const icons = {
  bolt: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M27 3 9 27h13l-3 18 20-26H26z" fill="currentColor"/></svg>',
  target: '<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="4"><circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="6"/><path d="M24 0v10M24 38v10M0 24h10M38 24h10"/></g></svg>',
  comet: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="30" cy="18" r="13" fill="none" stroke="currentColor" stroke-width="3.5"/><circle cx="30" cy="18" r="4.5" fill="currentColor"/><path d="M19 27 4 42M23 31l-9 9M15 23l-9 9" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>',
};

const stages: Record<StagePhase, { name: string; skill: string; text: string; icon: string; index: number }> = {
  STAGE_LIGHTNING: { name: 'Lightning', skill: 'Reaction', text: 'Click the moment the sky flashes.', icon: icons.bolt, index: 0 },
  STAGE_DRONES: { name: 'Drones', skill: 'Flick', text: 'Click each drone before it escapes.', icon: icons.target, index: 1 },
  STAGE_COMET: { name: 'Comet', skill: 'Tracking', text: 'Keep your cursor inside the halo.', icon: icons.comet, index: 2 },
};

const metreFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const metres = (altitude: number) => metreFormat.format(Math.round(altitude) || 0);
const ms = (value: number | null) => value === null ? '—' : `${Math.round(value)} ms`;
const percent = (ratio: number) => `${(ratio * 100).toFixed(0)}%`;

export function screens() {
  const panel = document.querySelector<HTMLElement>('#panel')!;
  const hud = document.querySelector<HTMLElement>('#hud')!;
  const name = document.querySelector<HTMLElement>('#stage-name')!;
  const dots = Array.from(document.querySelectorAll<HTMLElement>("#stage-dots i"));
  const instruction = document.querySelector<HTMLElement>('#instruction')!;
  const timer = document.querySelector<HTMLElement>('#timer')!;
  const timerFill = document.querySelector<HTMLElement>('#timer-fill')!;
  const altitude = document.querySelector<HTMLElement>('#altitude')!;
  const streak = document.querySelector<HTMLElement>('#streak')!;
  let shown = 0;
  let shownRounded = Number.NaN;
  let timerSeconds = -1;

  function showPanel(html: string, mode: string) {
    hud.hidden = true;
    panel.className = `panel panel-${mode}`;
    panel.innerHTML = html;
    panel.hidden = false;
  }

  return {
    panel,
    attract() {
      showPanel(`
        <p class="kicker">60-second reflex challenge</p>
        <h1 class="logo">SKYBREAK</h1>
        <p class="skills"><span>Reaction</span><span>Flick</span><span>Tracking</span></p>
        <button type="button" class="cta pulse">Click to play</button>
        <section class="attract-scores"><h2>Top 3 today</h2><div id="today-scores"></div></section>
        <section id="saved-card" aria-live="polite"></section>`, 'attract');
    },
    topToday(runs: Run[]) {
      panel.querySelector('#today-scores')?.replaceChildren(scoreList(runs));
    },
    todayUnavailable() {
      const scores = panel.querySelector('#today-scores');
      if (scores) scores.textContent = 'Leaderboard unavailable.';
    },
    saved(run: Run, ranks: Ranks) {
      const card = panel.querySelector('#saved-card');
      if (!card) return;
      const line = document.createElement('p');
      line.className = 'saved-line';
      const who = document.createElement('b');
      who.textContent = run.initials;
      const today = ranks.today === null ? '' : ` · #${ranks.today} today`;
      const allTime = ranks.allTime === null ? '' : ` · #${ranks.allTime} all-time`;
      line.append(who, ` reached ${metres(run.altitude)} m${today}${allTime}`);
      card.replaceChildren(line);
    },
    notice(message: string) {
      const card = panel.querySelector('#saved-card');
      if (card) card.textContent = message;
    },
    countdown(seconds: number) {
      showPanel(`<p class="kicker">Get ready · mouse only</p><p class="count">${seconds}</p>
        <p class="count-hint">Reaction → Flick → Tracking</p>`, 'countdown');
    },
    stage(phase: StagePhase) {
      const stage = stages[phase];
      panel.hidden = true;
      panel.replaceChildren();
      hud.hidden = false;
      name.textContent = stage.name;
      dots.forEach((dot, i) => {
        dot.classList.toggle('done', i < stage.index);
        dot.classList.toggle('active', i === stage.index);
      });
      instruction.innerHTML = `<div class="instruction-icon">${stage.icon}</div>
        <div><p class="instruction-skill">${stage.skill}</p><p class="instruction-text">${stage.text}</p></div>`;
      instruction.hidden = false;
      instruction.classList.remove('leaving');
      streak.hidden = phase !== 'STAGE_DRONES';
      streak.textContent = '×1.0';
      streak.classList.remove('hot');
    },
    update(elapsedMs: number, remainingMs: number, durationMs: number, score: number) {
      if (elapsedMs >= 1500 && !instruction.hidden) {
        if (!instruction.classList.contains('leaving')) instruction.classList.add('leaving');
        if (elapsedMs >= 1800) instruction.hidden = true;
      }
      const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
      if (seconds !== timerSeconds) timer.textContent = String(timerSeconds = seconds);
      timerFill.style.transform = `scaleX(${Math.max(0, Math.min(1, remainingMs / durationMs))})`;
      // Rolling counter: eases toward the real altitude so gains feel like a climb.
      shown += (score - shown) * 0.22;
      if (Math.abs(score - shown) < 0.5) shown = score;
      const rounded = Math.round(shown);
      if (rounded !== shownRounded) altitude.textContent = metres(shownRounded = rounded);
    },
    resetAltitude(value: number) { shown = value; shownRounded = Number.NaN; timerSeconds = -1; },
    fx(event: StageFx) {
      if (event.type === 'drone-hit') {
        const next = Math.min(2, event.multiplier + 0.1);
        streak.textContent = `×${next.toFixed(1)}`;
        streak.classList.toggle('hot', next >= 1.5);
        streak.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 180 });
      } else if (event.type === 'drone-miss' || event.type === 'drone-escape') {
        streak.textContent = '×1.0';
        streak.classList.remove('hot');
      }
    },
    results(stats: RunStats) {
      showPanel(`${skillCard(stats)}<p class="beat" id="beat-line"></p>
        <button type="button" id="enter-initials" class="cta">Enter initials</button>`, 'results');
    },
    beat(text: string) {
      const line = panel.querySelector('#beat-line');
      if (line) line.textContent = text;
    },
    unavailable: () => showPanel('<h1 class="logo">SKYBREAK</h1><p>WebGL is unavailable. Enable hardware acceleration or try another browser.</p>', 'attract'),
  };
}

function skillCard(stats: RunStats) {
  const drones = summarizeDrones(stats.drones);
  const comet = summarizeComet(stats.comet);
  const { ratings, title, tier } = rateRun(stats);
  const rows: [string, string, number][] = [
    ['Reaction', ms(averageMs(stats.lightning.reactionsMs)), ratings.reaction],
    ['Flick', ms(drones.averageTtkMs), ratings.flick],
    ['Precision', percent(drones.accuracy), ratings.precision],
    ['Tracking', percent(comet.onTarget), ratings.tracking],
  ];
  return `
    <div class="card">
      <p class="kicker">Run complete</p>
      <h2 class="card-altitude">${metres(scoreRun(stats))}<span>m</span></h2>
      <p class="badge"><span class="badge-title">${title}</span><span class="badge-tier">${tier}</span></p>
      <div class="bars">${rows.map(([label, raw, value], i) => `
        <div class="bar">
          <span class="bar-label">${label}</span>
          <span class="bar-raw">${raw}</span>
          <span class="bar-track"><span class="bar-fill" style="--v:${value};--i:${i}"></span></span>
          <span class="bar-score">${value}</span>
        </div>`).join('')}</div>
      <p class="card-detail">${stats.lightning.reactionsMs.length}/5 strikes · ${stats.lightning.falseStarts} too early ·
        ${drones.hits} drones · ${drones.escapes} escaped · ${(comet.longestLockMs / 1000).toFixed(1)} s best lock</p>
    </div>`;
}
