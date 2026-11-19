import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CircleGeometry, Color, Group, Mesh,
  MeshBasicMaterial, PlaneGeometry, Points, RingGeometry, ShaderMaterial,
} from 'three';

// Everything here works in CSS pixels with y pointing up (three.js world space
// under an orthographic camera that spans the canvas). All buffers are
// allocated once; per-frame work only rewrites numbers in place.

const glowVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

function glowMaterial(color: string, alpha: number) {
  return new ShaderMaterial({
    vertexShader: glowVertex,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform vec3 uColor; uniform float uAlpha;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        gl_FragColor = vec4(uColor, pow(max(0.0, 1.0 - d), 2.2) * uAlpha);
      }`,
    uniforms: { uColor: { value: new Color(color) }, uAlpha: { value: alpha } },
    transparent: true, blending: AdditiveBlending, depthTest: false, depthWrite: false,
  });
}

const flat = (color: string, opacity = 1, additive = false) => new MeshBasicMaterial({
  color, opacity, transparent: true, depthTest: false, depthWrite: false,
  blending: additive ? AdditiveBlending : undefined,
});

/* ---------------------------------------------------------------- particles */

export interface Burst {
  count: number; color: string; speed: [number, number]; life: [number, number];
  size: [number, number]; angle?: number; spread?: number; drag?: number;
}

const animatedAttributes = ['position', 'aSize', 'aAlpha', 'aColor'] as const;

export function particles(capacity = 720) {
  const position = new Float32Array(capacity * 3);
  const color = new Float32Array(capacity * 3);
  const size = new Float32Array(capacity);
  const alpha = new Float32Array(capacity);
  const velocity = new Float32Array(capacity * 2);
  const life = new Float32Array(capacity);
  const maxLife = new Float32Array(capacity);
  const baseSize = new Float32Array(capacity);
  const drag = new Float32Array(capacity);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('aColor', new BufferAttribute(color, 3));
  geometry.setAttribute('aSize', new BufferAttribute(size, 1));
  geometry.setAttribute('aAlpha', new BufferAttribute(alpha, 1));
  const material = new ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
      uniform float uPixelRatio;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vColor = aColor; vAlpha = aAlpha;
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        gl_FragColor = vec4(vColor, pow(1.0 - d, 1.6) * vAlpha);
      }`,
    uniforms: { uPixelRatio: { value: 1 } },
    transparent: true, blending: AdditiveBlending, depthTest: false, depthWrite: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 5;
  const tint = new Color();
  let cursor = 0;
  let alive = 0;

  return {
    points,
    setPixelRatio(ratio: number) { material.uniforms.uPixelRatio.value = ratio; },
    emit(x: number, y: number, burst: Burst) {
      tint.set(burst.color);
      for (let n = 0; n < burst.count; n++) {
        const i = cursor;
        cursor = (cursor + 1) % capacity;
        if (life[i] <= 0) alive++;
        const angle = burst.angle === undefined ? Math.random() * Math.PI * 2
          : burst.angle + (Math.random() - 0.5) * (burst.spread ?? 0.6);
        const speed = burst.speed[0] + Math.random() * (burst.speed[1] - burst.speed[0]);
        position[i * 3] = x; position[i * 3 + 1] = y; position[i * 3 + 2] = 0;
        velocity[i * 2] = Math.cos(angle) * speed; velocity[i * 2 + 1] = Math.sin(angle) * speed;
        color[i * 3] = tint.r; color[i * 3 + 1] = tint.g; color[i * 3 + 2] = tint.b;
        life[i] = maxLife[i] = burst.life[0] + Math.random() * (burst.life[1] - burst.life[0]);
        baseSize[i] = burst.size[0] + Math.random() * (burst.size[1] - burst.size[0]);
        drag[i] = burst.drag ?? 3.5;
      }
    },
    update(dt: number) {
      if (!alive) return;
      for (let i = 0; i < capacity; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) { alive--; alpha[i] = 0; size[i] = 0; continue; }
        const k = Math.exp(-drag[i] * dt);
        velocity[i * 2] *= k; velocity[i * 2 + 1] *= k;
        position[i * 3] += velocity[i * 2] * dt; position[i * 3 + 1] += velocity[i * 2 + 1] * dt;
        const t = life[i] / maxLife[i];
        alpha[i] = t;
        size[i] = baseSize[i] * (0.4 + 0.6 * t);
      }
      for (const name of animatedAttributes) geometry.getAttribute(name).needsUpdate = true;
    },
    clear() {
      life.fill(0); alpha.fill(0); size.fill(0); alive = 0;
      for (const name of ['aSize', 'aAlpha']) geometry.getAttribute(name).needsUpdate = true;
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

/* --------------------------------------------------------------- lightning */

const maxSegments = 400;

function ribbon(color: string, opacity: number) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(maxSegments * 4 * 3), 3));
  const index = new Uint16Array(maxSegments * 6);
  for (let s = 0; s < maxSegments; s++) index.set([s * 4, s * 4 + 1, s * 4 + 2, s * 4 + 2, s * 4 + 1, s * 4 + 3], s * 6);
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.setDrawRange(0, 0);
  const material = flat(color, opacity, true);
  return { mesh: new Mesh(geometry, material), geometry, material };
}

type Segment = [x1: number, y1: number, x2: number, y2: number, width: number];

function jaggedPath(x1: number, y1: number, x2: number, y2: number, depth: number, roughness: number,
  width: number, out: Segment[]) {
  let pts = [[x1, y1], [x2, y2]];
  let offset = Math.hypot(x2 - x1, y2 - y1) * roughness;
  for (let d = 0; d < depth; d++) {
    const next: number[][] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]; const [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const shift = (Math.random() - 0.5) * offset;
      next.push([(ax + bx) / 2 + (-(by - ay) / len) * shift, (ay + by) / 2 + ((bx - ax) / len) * shift], pts[i]);
    }
    pts = next;
    offset *= 0.55;
  }
  for (let i = 1; i < pts.length; i++) {
    const taper = 1 - (i / pts.length) * 0.6;
    out.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], width * taper]);
  }
  return pts;
}

export function bolt() {
  const core = ribbon('#f4f8ff', 1);
  const glow = ribbon('#6fa8ff', 0.35);
  const group = new Group();
  group.add(glow.mesh, core.mesh);
  group.renderOrder = 4;
  const segments: Segment[] = [];
  let intensity = 0;
  let hold = 0;

  function write(target: ReturnType<typeof ribbon>, scale: number) {
    const array = target.geometry.getAttribute('position').array as Float32Array;
    const count = Math.min(segments.length, maxSegments);
    for (let s = 0; s < count; s++) {
      const [x1, y1, x2, y2, w] = segments[s];
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const nx = (-(y2 - y1) / len) * w * scale / 2;
      const ny = ((x2 - x1) / len) * w * scale / 2;
      array.set([x1 + nx, y1 + ny, 0, x1 - nx, y1 - ny, 0, x2 + nx, y2 + ny, 0, x2 - nx, y2 - ny, 0], s * 12);
    }
    target.geometry.getAttribute('position').needsUpdate = true;
    target.geometry.setDrawRange(0, count * 6);
  }

  return {
    group,
    strike(width: number, height: number) {
      segments.length = 0;
      const startX = width * (0.2 + Math.random() * 0.6);
      const endX = startX + (Math.random() - 0.5) * width * 0.35;
      const endY = height * (0.08 + Math.random() * 0.3);
      const main = jaggedPath(startX, height + 20, endX, endY, 6, 0.32, 5, segments);
      for (let b = 0; b < 3 + Math.floor(Math.random() * 3); b++) {
        const from = main[Math.floor(main.length * (0.15 + Math.random() * 0.6))];
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
        const reach = height * (0.12 + Math.random() * 0.22);
        jaggedPath(from[0], from[1], from[0] + Math.cos(angle) * reach, from[1] + Math.sin(angle) * reach,
          4, 0.35, 2.4, segments);
      }
      write(core, 1);
      write(glow, 5);
      intensity = 1;
      hold = 0.45;
    },
    release() { hold = 0; },
    update(dt: number) {
      intensity = Math.max(hold, intensity - dt * 3);
      core.material.opacity = intensity;
      glow.material.opacity = 0.35 * intensity;
      group.visible = intensity > 0.01;
    },
    dispose() {
      for (const part of [core, glow]) { part.geometry.dispose(); part.material.dispose(); }
    },
  };
}

/* ------------------------------------------------------------------ drone */

export function droneMesh() {
  const group = new Group();
  group.visible = false;
  group.renderOrder = 3;
  const glowGeometry = new PlaneGeometry(1, 1);
  const glow = new Mesh(glowGeometry, glowMaterial('#45e3ff', 0.75));
  glow.scale.set(4.6, 4.6, 1);
  const rim = new Mesh(new RingGeometry(0.97, 1.03, 48), flat('#bff6ff', 0.55));
  const arcs = new Group();
  for (let a = 0; a < 3; a++) {
    arcs.add(new Mesh(new RingGeometry(0.72, 0.9, 16, 1, (a * Math.PI * 2) / 3, 1.25), flat('#63f2ff', 0.95)));
  }
  const core = new Mesh(new CircleGeometry(0.4, 32), flat('#f2feff'));
  group.add(glow, rim, arcs, core);
  let radius = 1;
  let age = 0;

  return {
    group,
    show(x: number, y: number, r: number) {
      group.position.set(x, y, 0);
      radius = r;
      age = 0;
      group.visible = true;
    },
    place(x: number, y: number, r: number) {
      group.position.set(x, y, 0);
      radius = r;
    },
    hide() { group.visible = false; },
    update(dt: number) {
      if (!group.visible) return;
      age += dt;
      arcs.rotation.z -= dt * 4;
      // A quick pop-in (full hit area from the first frame; only the look scales).
      const t = Math.min(1, age / 0.14);
      const pop = 0.7 + 0.3 * (1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2);
      group.scale.set(radius * pop, radius * pop, 1);
      (glow.material as ShaderMaterial).uniforms.uAlpha.value = 0.6 + 0.2 * Math.sin(age * 12);
    },
    dispose() {
      group.traverse(object => {
        if (object instanceof Mesh) { object.geometry.dispose(); (object.material as MeshBasicMaterial).dispose(); }
      });
    },
  };
}

/* ------------------------------------------------------------------ comet */

export function cometMesh() {
  const group = new Group();
  group.visible = false;
  group.renderOrder = 3;
  const fillMaterial = flat('#7f9cff', 0.12);
  const fill = new Mesh(new CircleGeometry(1, 64), fillMaterial);
  const edgeMaterial = flat('#b8c8ff', 0.55);
  const edge = new Mesh(new RingGeometry(0.955, 1, 72), edgeMaterial);
  const progressMaterial = new ShaderMaterial({
    vertexShader: glowVertex,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uProgress; uniform vec3 uColor;
      void main() {
        vec2 c = vUv - 0.5;
        float a = atan(c.x, c.y);
        if (a < 0.0) a += 6.2831853;
        if (a / 6.2831853 > uProgress) discard;
        gl_FragColor = vec4(uColor, 0.95);
      }`,
    uniforms: { uProgress: { value: 0 }, uColor: { value: new Color('#ffd36b') } },
    transparent: true, depthTest: false, depthWrite: false,
  });
  const progress = new Mesh(new RingGeometry(1.07, 1.17, 72), progressMaterial);
  const glowMat = glowMaterial('#a9c1ff', 0.9);
  const glow = new Mesh(new PlaneGeometry(1, 1), glowMat);
  glow.scale.set(1.3, 1.3, 1);
  const core = new Mesh(new CircleGeometry(0.17, 32), flat('#ffffff'));
  group.add(fill, edge, progress, glow, core);
  let locked = 0;
  let lockedTarget = 0;
  const calmEdge = new Color('#b8c8ff');
  const lockedEdge = new Color('#ffe6a3');

  return {
    group,
    set(x: number, y: number, r: number, isLocked: boolean, lock: number) {
      group.position.set(x, y, 0);
      group.scale.set(r, r, 1);
      group.visible = true;
      lockedTarget = isLocked ? 1 : 0;
      progressMaterial.uniforms.uProgress.value = isLocked ? lock : 0;
    },
    hide() { group.visible = false; },
    update(dt: number) {
      locked += (lockedTarget - locked) * (1 - Math.exp(-dt * 14));
      fillMaterial.opacity = 0.1 + 0.16 * locked;
      edgeMaterial.opacity = 0.5 + 0.45 * locked;
      edgeMaterial.color.copy(locked > 0.5 ? lockedEdge : calmEdge);
      glowMat.uniforms.uAlpha.value = 0.75 + 0.5 * locked;
    },
    get locked() { return lockedTarget === 1; },
    dispose() {
      group.traverse(object => {
        if (object instanceof Mesh) { object.geometry.dispose(); (object.material as MeshBasicMaterial).dispose(); }
      });
    },
  };
}
