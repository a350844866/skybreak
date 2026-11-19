import { CircleGeometry, Color, Mesh, MeshBasicMaterial, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import type { StageSurface } from '../game/stages/stage';

export function gameView(canvas: HTMLCanvasElement) {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  const scene = new Scene();
  const background = new Color();
  scene.background = background;
  const camera = new OrthographicCamera(0, 1, 1, 0, 0.1, 10);
  camera.position.z = 5;
  const geometry = new CircleGeometry(1, 32);
  const viewport = () => ({ width: Math.max(1, canvas.clientWidth), height: Math.max(1, canvas.clientHeight) });

  const surface: StageSurface = {
    canvas,
    viewport,
    color: value => { background.set(value); },
    disc(color, opacity = 1, layer = 0) {
      const material = new MeshBasicMaterial({ color, opacity, transparent: opacity < 1, depthTest: false, depthWrite: false });
      const mesh = new Mesh(geometry, material);
      mesh.visible = false;
      mesh.renderOrder = layer;
      // Three draws transparent objects after opaque ones, so both comet layers share the transparent pass.
      if (layer > 0) material.transparent = true;
      scene.add(mesh);
      return {
        show(point, radiusPx) {
          const { width, height } = viewport();
          mesh.position.set(point.x, 1 - point.y, 0);
          mesh.scale.set(radiusPx / width, radiusPx / height, 1);
          mesh.visible = true;
        },
        hide() { mesh.visible = false; },
        dispose() {
          scene.remove(mesh);
          material.dispose();
        },
      };
    },
  };

  const draw = () => renderer.render(scene, camera);
  function resize() {
    const { width, height } = viewport();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
  }

  resize();
  return {
    surface, draw, resize,
    dispose() {
      geometry.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
