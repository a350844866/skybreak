import { OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { droneRadius } from '../game/stages/drones';
import type { Point, StageFx, Theme, Viewport } from '../game/stages/stage';
import { bolt, cometMesh, droneMesh, particles } from './fx';
import type { Burst } from './fx';
import { labels } from './labels';
import { qualityGovernor } from './quality';
import { sky } from './sky';

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const trailCalm: Burst = { count: 2, color: '#a7bcff', speed: [10, 60], life: [0.35, 0.7], size: [5, 10] };
const trailLocked: Burst = { ...trailCalm, color: '#ffe7a6' };
const hitBurst: Burst = { count: 26, color: '#7cf4ff', speed: [180, 520], life: [0.3, 0.6], size: [5, 11] };
const hitCore: Burst = { count: 10, color: '#ffffff', speed: [60, 220], life: [0.2, 0.4], size: [8, 14] };
const missPuff: Burst = { count: 6, color: '#8899b8', speed: [30, 90], life: [0.2, 0.35], size: [4, 7] };
const bonusBurst: Burst = { count: 34, color: '#ffd36b', speed: [160, 460], life: [0.4, 0.8], size: [6, 12] };
const warmSpark: Burst = { count: 1, color: '#ffffff', speed: [0, 0], life: [1, 1], size: [12, 12] };

/**
 * The WebGL layer: sky, targets and effects. It never decides anything about
 * gameplay; it renders the StageFx stream the stages emit, once per frame,
 * right after the stage update for that frame.
 */
export function gameView(canvas: HTMLCanvasElement, labelRoot: HTMLElement) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const scene = new Scene();
  const camera = new OrthographicCamera(0, 1, 1, 0, -10, 10);
  camera.position.z = 1;

  const backdrop = sky();
  const sparks = particles();
  const strike = bolt();
  const drone = droneMesh();
  const comet = cometMesh();
  const text = labels(labelRoot);
  scene.add(backdrop.mesh, strike.group, drone.group, comet.group, sparks.points);

  let width = 1;
  let height = 1;
  let shake = 0;
  let last: number | undefined;
  let cometX = 0;
  let cometY = 0;
  // The drone is kept in normalised coordinates and re-projected every frame, so
  // a resize or fullscreen toggle mid-stage can never move it off its hit area.
  let dronePoint: Point | null = null;
  const quality = qualityGovernor(Math.min(window.devicePixelRatio || 1, 1.5));
  let warmedUp = false;

  const viewport = (): Viewport => ({ width: Math.max(1, canvas.clientWidth), height: Math.max(1, canvas.clientHeight) });
  const worldX = (p: Point) => p.x * width;
  const worldY = (p: Point) => (1 - p.y) * height;

  function fx(event: StageFx) {
    switch (event.type) {
      case 'flash':
        backdrop.flash();
        strike.strike(width, height);
        break;
      case 'reaction':
        backdrop.releaseFlash();
        strike.release();
        text.show(`${Math.round(event.ms)} ms`, width / 2, height * 0.42, 'big');
        break;
      case 'false-start':
        backdrop.releaseFlash();
        strike.release();
        text.show('TOO EARLY', width / 2, height * 0.42, 'bad');
        break;
      case 'drone-spawn':
        dronePoint = event.point;
        drone.show(worldX(event.point), worldY(event.point), event.radiusPx);
        break;
      case 'drone-hit': {
        const x = worldX(event.point);
        const y = worldY(event.point);
        drone.hide();
        dronePoint = null;
        sparks.emit(x, y, hitBurst);
        sparks.emit(x, y, hitCore);
        if (!motionQuery.matches) shake = Math.max(shake, 6);
        text.show(`+${Math.round(event.gain)} m`, x, event.point.y * height - 30, event.multiplier > 1 ? 'gold' : 'gain');
        break;
      }
      case 'drone-miss':
        sparks.emit(worldX(event.point), worldY(event.point), missPuff);
        break;
      case 'drone-escape': {
        const x = worldX(event.point);
        const y = worldY(event.point);
        drone.hide();
        dronePoint = null;
        const away = Math.atan2(y - height / 2, x - width / 2);
        sparks.emit(x, y, { count: 16, color: '#ff8a5c', speed: [500, 900], life: [0.2, 0.4], size: [4, 8], angle: away, spread: 0.25, drag: 1 });
        break;
      }
      case 'comet':
        cometX = worldX(event.point);
        cometY = worldY(event.point);
        comet.set(cometX, cometY, event.radiusPx, event.locked, event.lock);
        break;
      case 'comet-bonus':
        sparks.emit(cometX, cometY, bonusBurst);
        text.show('+300 m', cometX, (1 - cometY / height) * height - 70, 'gold');
        break;
      case 'clear':
        drone.hide();
        dronePoint = null;
        comet.hide();
        strike.release();
        backdrop.releaseFlash();
        break;
    }
  }

  /**
   * The first frame that draws a material compiles its program and blocks on
   * the GPU (SwiftShader: up to ~260 ms at 1080p). Unwarmed, that frame can be
   * the first flash, whose reaction clock is already running. So the very first
   * ATTRACT frame draws every effect once, on screen and with real pixels (a
   * skipped or empty draw leaves the shaders cold). The real frame is drawn
   * over it before anything is presented, so the player never sees it. Only
   * render-side state is touched, and all of it is restored.
   */
  function warmUp() {
    warmedUp = true;
    const groups = [strike.group, drone.group, comet.group];
    const saved = groups.map(group => ({ visible: group.visible, position: group.position.clone(), scale: group.scale.clone() }));
    for (const group of groups) group.visible = true;
    for (const group of [drone.group, comet.group]) {
      group.position.set(width / 2, height / 2, 0);
      group.scale.set(40, 40, 1);
    }
    const unprime = strike.prime(width, height);
    sparks.emit(width / 2, height / 2, warmSpark);
    sparks.update(0.001);
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    sparks.clear();
    unprime();
    groups.forEach((group, i) => {
      group.visible = saved[i].visible;
      group.position.copy(saved[i].position);
      group.scale.copy(saved[i].scale);
    });
  }

  function render(now: number) {
    if (!warmedUp) warmUp();
    const dt = last === undefined ? 0 : Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    backdrop.update(now / 1000, dt);
    strike.update(dt);
    if (dronePoint) drone.place(worldX(dronePoint), worldY(dronePoint), droneRadius({ width, height }));
    drone.update(dt);
    comet.update(dt);
    if (comet.group.visible) sparks.emit(cometX, cometY, comet.locked ? trailLocked : trailCalm);
    sparks.update(dt);
    // Shake the sky and sparks only: targets never move away from where they are hit-tested.
    if (shake > 0.05) {
      const dx = (Math.random() - 0.5) * shake;
      const dy = (Math.random() - 0.5) * shake;
      backdrop.mesh.position.x = width / 2 + dx;
      backdrop.mesh.position.y = height / 2 + dy;
      sparks.points.position.set(dx, dy, 0);
      shake *= Math.exp(-dt * 20);
    } else if (shake) {
      shake = 0;
      backdrop.mesh.position.set(width / 2, height / 2, -5);
      sparks.points.position.set(0, 0, 0);
    }
    renderer.render(scene, camera);
    applyQuality(quality.sample(dt));
  }

  // A pixel-ratio change costs a full resize; the governor only asks for one outside timed stages.
  function applyQuality(ratio: number | null) {
    if (ratio !== null) resize();
  }

  /** Real window resizes apply at once: hit-testing depends on the real canvas size. */
  function resize() {
    ({ width, height } = viewport());
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5, quality.ratio);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.right = width;
    camera.top = height;
    camera.updateProjectionMatrix();
    backdrop.resize(width, height);
    sparks.setPixelRatio(ratio);
  }

  resize();
  return {
    viewport,
    theme: (theme: Theme) => backdrop.theme(theme),
    fx,
    punch: () => backdrop.punch(),
    /** Visual-only events (attract demo) use the same pipeline as real play. */
    render,
    resize,
    /** Timed stages defer any resolution drop; leaving them applies it. */
    setStageActive: (active: boolean) => applyQuality(quality.setStageActive(active)),
    clearEffects() { sparks.clear(); text.clear(); fx({ type: 'clear' }); },
    dispose() {
      for (const part of [backdrop, sparks, strike, drone, comet, text]) part.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

export type GameView = ReturnType<typeof gameView>;
