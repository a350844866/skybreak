import { store } from '../store';
import { skybreakChannel } from '../store/messages';
import { scoreList } from '../ui/scoreList';

const refreshMs = 10_000;

export function mountBoard() {
  delete document.body.dataset.phase;
  const board = document.createElement('main');
  board.className = 'board';
  board.innerHTML = `
    <header><h1>Skybreak</h1><span class="live" hidden>● LIVE</span></header>
    <div class="board-columns">
      <section><h2>Today · Top 10</h2><div id="board-today"></div></section>
      <section><h2>All-time · Top 5</h2><div id="board-all-time"></div><p id="latest-run" class="newest" hidden></p></section>
    </div>
    <p id="board-status" role="status"></p>`;
  document.body.replaceChildren(board);
  const todayList = board.querySelector('#board-today')!;
  const allTimeList = board.querySelector('#board-all-time')!;
  const latestRun = board.querySelector<HTMLElement>('#latest-run')!;
  const live = board.querySelector<HTMLElement>('.live')!;
  const status = board.querySelector('#board-status')!;
  const running = new Set<string>();
  let request = 0;
  let disposed = false;
  let highlightTimer: number | undefined;

  const channel = skybreakChannel(message => {
    switch (message.type) {
      case 'run-started':
      case 'stage':
        running.add(message.runId);
        break;
      case 'run-finished':
        running.delete(message.run.id);
        void refresh();
        break;
      case 'run-ended':
        running.delete(message.runId);
        break;
      case 'board-changed':
        void refresh();
        break;
    }
    live.hidden = !running.size;
  });

  function clearHighlight() {
    window.clearTimeout(highlightTimer);
    board.querySelectorAll('li.newest').forEach(row => row.classList.remove('newest'));
    latestRun.hidden = true;
  }

  async function refresh() {
    const current = ++request;
    try {
      const [today, allTime, latest] = await Promise.all([
        store.topToday(10), store.topAllTime(5), store.latestRun(),
      ]);
      if (disposed || current !== request) return;
      clearHighlight();
      const remaining = latest ? refreshMs - Math.max(0, new Date().getTime() - latest.createdAt) : 0;
      const highlighted = remaining > 0 ? latest : undefined;
      todayList.replaceChildren(scoreList(today, highlighted?.id));
      allTimeList.replaceChildren(scoreList(allTime, highlighted?.id));
      if (highlighted) {
        if (![...today, ...allTime].some(run => run.id === highlighted.id)) {
          latestRun.textContent = `Latest · ${highlighted.initials} · ${Math.round(highlighted.altitude).toLocaleString()} m`;
          latestRun.hidden = false;
        }
        highlightTimer = window.setTimeout(clearHighlight, remaining);
      }
      status.textContent = '';
    } catch {
      if (!disposed && current === request) status.textContent = 'Leaderboard unavailable. Retrying…';
    }
  }

  channel.send({ type: 'status-request' });
  void refresh();
  const poll = window.setInterval(refresh, refreshMs);
  return () => {
    disposed = true;
    window.clearInterval(poll);
    clearHighlight();
    channel.close();
    board.remove();
  };
}
