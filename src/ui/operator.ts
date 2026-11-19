import { store } from '../store';

interface OperatorHooks {
  pause(): void;
  resume(): void;
  boardChanged(): void;
  soundChanged(enabled: boolean): void;
  diagnostics(): { fps: number; p95: number; runsThisSession: number };
}

const validPin = (pin: string) => /^\d{4}$/.test(pin);

export function operatorPanel(hooks: OperatorHooks) {
  const app = new AbortController();
  let closePanel: (() => void) | undefined;

  function open() {
    const dialog = document.createElement('dialog');
    dialog.className = 'operator';
    dialog.setAttribute('aria-labelledby', 'operator-heading');
    dialog.innerHTML = `
      <h2 id="operator-heading">Operator panel</h2>
      <form id="operator-login">
        <label>Operator PIN <input type="password" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" required autofocus></label>
        <button>Unlock</button>
      </form>
      <div id="operator-controls" hidden>
        <div class="operator-actions">
          <button type="button" id="new-day">Start new event day</button>
          <button type="button" id="clear-day">Clear today</button>
          <button type="button" id="export-csv">Export CSV</button>
          <button type="button" id="fullscreen">Toggle fullscreen</button>
        </div>
        <div id="confirm-clear" hidden>
          <p>Delete all runs from the current event day?</p>
          <button type="button" id="confirm-delete">Delete today’s runs</button>
          <button type="button" id="cancel-delete">Cancel</button>
        </div>
        <p><label><input id="sound" type="checkbox"> Sound</label></p>
        <form id="change-pin">
          <label>New PIN <input type="password" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" required></label>
          <button>Change PIN</button>
        </form>
        <p id="diagnostics"></p>
      </div>
      <p id="operator-status" role="status"></p>
      <button type="button" id="close-operator">Close</button>`;
    const session = new AbortController();
    const options = { signal: session.signal };
    const get = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
    const status = get('#operator-status');
    const controls = get('#operator-controls');
    const login = get<HTMLFormElement>('#operator-login');
    const pinInput = login.querySelector('input')!;
    const sound = get<HTMLInputElement>('#sound');
    const confirmation = get('#confirm-clear');
    const changePin = get<HTMLFormElement>('#change-pin');
    const newPin = changePin.querySelector('input')!;
    let busy = false;
    let diagnosticsTimer: number | undefined;

    function close() {
      session.abort();
      window.clearInterval(diagnosticsTimer);
      dialog.close();
      dialog.remove();
      closePanel = undefined;
      hooks.resume();
    }

    async function action(work: () => Promise<void>) {
      if (busy) return;
      busy = true;
      status.textContent = '';
      try {
        await work();
      } catch {
        status.textContent = 'Action failed. Try again.';
      } finally {
        busy = false;
      }
    }

    function diagnostics() {
      const { fps, p95, runsThisSession } = hooks.diagnostics();
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      const heap = memory ? ` · ${(memory.usedJSHeapSize / 2 ** 20).toFixed(1)} MiB JS heap` : '';
      get('#diagnostics').textContent = `${fps.toFixed(1)} fps · ${p95.toFixed(1)} ms p95 · ${runsThisSession} runs this session${heap}`;
    }

    function click(selector: string, handler: () => void) {
      get(selector).addEventListener('click', handler, options);
    }

    login.addEventListener('submit', event => {
      event.preventDefault();
      void action(async () => {
        if (!validPin(pinInput.value) || pinInput.value !== await store.getSetting('pin')) {
          status.textContent = 'Incorrect PIN.';
          pinInput.select();
          return;
        }
        sound.checked = await store.getSetting('sound');
        if (session.signal.aborted) return;
        pinInput.value = '';
        login.hidden = true;
        controls.hidden = false;
        get('#new-day').focus();
        diagnostics();
        diagnosticsTimer = window.setInterval(diagnostics, 1000);
      });
    }, options);
    click('#new-day', () => void action(async () => {
      const day = await store.startNewEventDay();
      confirmation.hidden = true;
      status.textContent = `Event day ${day} started.`;
      hooks.boardChanged();
    }));
    click('#clear-day', () => {
      confirmation.hidden = false;
      get('#cancel-delete').focus();
    });
    click('#cancel-delete', () => {
      confirmation.hidden = true;
      get('#clear-day').focus();
    });
    click('#confirm-delete', () => void action(async () => {
      await store.clearDay();
      confirmation.hidden = true;
      status.textContent = 'Today’s runs cleared.';
      hooks.boardChanged();
      get('#clear-day').focus();
    }));
    click('#export-csv', () => void action(async () => {
      const csv = await store.exportCsv();
      if (session.signal.aborted) return;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      link.download = 'skybreak-runs.csv';
      link.click();
      URL.revokeObjectURL(link.href);
      status.textContent = 'CSV exported.';
    }));
    click('#fullscreen', () => void action(async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    }));
    sound.addEventListener('change', () => {
      const enabled = sound.checked;
      if (busy) { sound.checked = !enabled; return; }
      void action(async () => {
        try {
          await store.setSetting('sound', enabled);
          hooks.soundChanged(enabled);
        } catch (error) {
          sound.checked = !enabled;
          throw error;
        }
      });
    }, options);
    changePin.addEventListener('submit', event => {
      event.preventDefault();
      if (!validPin(newPin.value)) return;
      void action(async () => {
        await store.setSetting('pin', newPin.value);
        newPin.value = '';
        status.textContent = 'PIN changed.';
      });
    }, options);
    get('#close-operator').addEventListener('click', event => {
      event.stopPropagation();
      close();
    }, options);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }, options);
    document.body.append(dialog);
    dialog.showModal();
    closePanel = close;
    hooks.pause();
  }

  document.addEventListener('keydown', event => {
    if (event.ctrlKey && event.shiftKey && event.code === 'KeyO' && !event.repeat) {
      event.preventDefault();
      if (!closePanel) open();
    }
  }, { signal: app.signal });
  return () => {
    app.abort();
    closePanel?.();
  };
}
