import { filterInitials, rotateLetter } from '../game/initials';

export function initialsScreen(panel: HTMLElement, signal: AbortSignal,
  accept: (initials: string) => void, done: () => void) {
  panel.innerHTML = `<h1>Enter initials</h1><div class="wheels"></div>
    <p role="status" class="initials-hint"></p><button type="button" id="initials-done">Done</button>`;
  const wheels = panel.querySelector('.wheels')!;
  const hint = panel.querySelector('.initials-hint')!;
  const letters = ['A', 'A', 'A'];
  let next = 0;
  const options = { signal };

  function update() {
    const valid = filterInitials(letters.join(''));
    if (valid) accept(valid);
    hint.textContent = valid ? 'Use the arrows or type three letters.' : 'Choose a different combination.';
    outputs.forEach((output, index) => { output.textContent = letters[index]; });
  }

  const outputs = letters.map((_, index) => {
    const wheel = document.createElement('div');
    const output = document.createElement('output');
    output.setAttribute('aria-label', `Letter ${index + 1}`);
    const arrow = (step: -1 | 1) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = step === 1 ? '▲' : '▼';
      button.setAttribute('aria-label', `${step === 1 ? 'Next' : 'Previous'} letter ${index + 1}`);
      button.addEventListener('click', () => {
        letters[index] = rotateLetter(letters[index], step);
        next = index;
        update();
      }, options);
      return button;
    };
    wheel.append(arrow(1), output, arrow(-1));
    wheels.append(wheel);
    return output;
  });

  panel.querySelector('#initials-done')!.addEventListener('click', event => {
    event.stopPropagation();
    if (filterInitials(letters.join(''))) done();
  }, options);
  document.addEventListener('keydown', event => {
    if (document.querySelector('dialog[open]') || event.ctrlKey || event.metaKey || event.altKey ||
      event.repeat || !/^[a-z]$/i.test(event.key)) return;
    event.preventDefault();
    letters[next] = event.key.toUpperCase();
    next = (next + 1) % letters.length;
    update();
  }, options);
  update();
}
