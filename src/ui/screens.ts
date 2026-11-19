import { rateRun } from '../game/rating';
import { averageMs, scoreRun, summarizeComet, summarizeDrones } from '../game/scoring';
import type { RunStats } from '../game/scoring';
import type { StagePhase } from '../game/stateMachine';
import type { Run, Ranks } from '../store/ranking';
import { scoreList } from './scoreList';

const instructions: Record<StagePhase, [name: string, icon: string, text: string]> = {
  STAGE_LIGHTNING: ['Lightning', 'ϟ', 'Click as soon as the sky flashes.'],
  STAGE_DRONES: ['Drones', '◎', 'Click each drone before it escapes.'],
  STAGE_COMET: ['Comet', '◌', 'Keep the cursor inside the halo.'],
};
const metres = (altitude: number) => `${(Math.round(altitude) || 0).toLocaleString()} m`;
const ms = (value: number | null) => value === null ? '—' : `${Math.round(value)} ms`;
const percent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

export function screens() {
  const panel = document.querySelector<HTMLElement>('#panel')!;
  const hud = document.querySelector<HTMLElement>('#hud')!;
  const name = document.querySelector<HTMLElement>('#stage-name')!;
  const instruction = document.querySelector<HTMLElement>('#instruction')!;
  const timer = document.querySelector<HTMLElement>('#timer')!;
  const altitude = document.querySelector<HTMLElement>('#altitude')!;

  function showPanel(html: string) {
    hud.hidden = true;
    panel.innerHTML = html;
    panel.hidden = false;
  }

  return {
    panel,
    attract() {
      showPanel('<h1>Skybreak</h1><button type="button">Click to play</button><div class="attract-scores"><h2>Today’s top 3</h2><div id="today-scores"></div></div><section id="saved-card" aria-live="polite"></section>');
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
      card.innerHTML = skillCard(run.stats);
      const rank = document.createElement('p');
      const today = ranks.today === null ? '— today' : `#${ranks.today} today`;
      const allTime = ranks.allTime === null ? '— all-time' : `#${ranks.allTime} all-time`;
      rank.textContent = `${run.initials} · ${today} · ${allTime}`;
      card.prepend(rank);
    },
    notice(message: string) {
      const card = panel.querySelector('#saved-card');
      if (card) card.textContent = message;
    },
    countdown: (seconds: number) => showPanel(`<h1>Get ready</h1><p class="count">${seconds}</p>`),
    stage(phase: StagePhase) {
      panel.hidden = true;
      panel.replaceChildren();
      hud.hidden = false;
      const [title, icon, text] = instructions[phase];
      name.textContent = title;
      instruction.innerHTML = `<span aria-hidden="true">${icon}</span> ${text}`;
    },
    update(elapsedMs: number, remainingMs: number, score: number) {
      instruction.hidden = elapsedMs >= 1500;
      timer.textContent = `${Math.ceil(remainingMs / 1000)} s`;
      altitude.textContent = metres(score);
    },
    results: (stats: RunStats) => showPanel(`${skillCard(stats)}<button type="button" id="enter-initials">Enter initials</button>`),
    unavailable: () => showPanel('<h1>Skybreak</h1><p>WebGL 2 is unavailable. Enable hardware acceleration or try another browser.</p>'),
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
        <h2 class="skill-altitude">${metres(scoreRun(stats))}</h2>
        <p>${title} · ${tier}</p>
        <dl class="ratings">${rows.map(([label, raw, value]) => `
          <dt>${label}</dt><dd>${raw} · ${value}/100
            <meter aria-label="${label} rating" min="0" max="100" value="${value}"></meter>
          </dd>`).join('')}</dl>
        <p>${stats.lightning.reactionsMs.length}/5 trials · ${stats.lightning.falseStarts} false starts<br>
          ${drones.hits} hits · ${drones.misses} missed clicks · ${drones.escapes} escapes<br>
          ${(comet.onTargetMs / 1000).toFixed(2)} s on target · ${(comet.longestLockMs / 1000).toFixed(2)} s longest lock</p>
      `;
}
