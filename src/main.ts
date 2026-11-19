import './style.css';

const board = new URLSearchParams(location.search).get('view') === 'board';
const mounted = board ? import('./board').then(({ mountBoard }) => mountBoard())
  : import('./game/mount').then(({ mountGame }) => mountGame());
import.meta.hot?.dispose(() => { void mounted.then(dispose => dispose?.()); });

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const worker = new URL(`${import.meta.env.BASE_URL}sw.js`, location.href);
  void navigator.serviceWorker.register(worker).catch(error => {
    console.warn('Skybreak offline cache could not be installed.', error);
  });
}
