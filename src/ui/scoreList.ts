import type { Run } from '../store/ranking';

export function scoreList(runs: readonly Run[], highlight?: string): HTMLElement {
  if (!runs.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No runs yet';
    return empty;
  }
  const list = document.createElement('ol');
  list.className = 'score-list';
  for (const [index, run] of runs.entries()) {
    const row = document.createElement('li');
    row.classList.toggle('newest', run.id === highlight);
    for (const text of [`#${index + 1}`, run.initials, `${Math.round(run.altitude).toLocaleString()} m`]) {
      const cell = document.createElement('span');
      cell.textContent = text;
      row.append(cell);
    }
    list.append(row);
  }
  return list;
}
