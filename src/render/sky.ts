import { Color, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import type { Theme } from '../game/stages/stage';

interface Look { top: string; mid: string; bottom: string; cloud: string; shade: string; density: number; stars: number }

// Each look is one altitude band of the climb: storm below, dusk above the
// cloud deck, night near space. "high" is the calm sky used between runs.
const looks: Record<Theme, Look> = {
  high: { top: '#081a45', mid: '#1f5fb8', bottom: '#8ccbff', cloud: '#ffffff', shade: '#8fb0de', density: 0.6, stars: 0 },
  storm: { top: '#06080d', mid: '#161e2b', bottom: '#2a3546', cloud: '#56657c', shade: '#0e131c', density: 1, stars: 0 },
  dusk: { top: '#120c38', mid: '#46348a', bottom: '#ff9466', cloud: '#ffd4b8', shade: '#5b3f86', density: 0.5, stars: 0.25 },
  night: { top: '#02040e', mid: '#0b1236', bottom: '#2a3a78', cloud: '#4a5c9a', shade: '#121a40', density: 0.36, stars: 1 },
};

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime, uAspect, uDensity, uStars, uFlash, uRise;
uniform vec3 uTop, uMid, uBottom, uCloud, uShade;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
// Lattice indices wrap at 289, so noise(p) is exactly periodic (no seams) and the
// hash input stays small: a sky that has scrolled for hours keeps full precision.
float lattice(vec2 i) { return hash(mod(i, 289.0)); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lattice(i), lattice(i + vec2(1.0, 0.0)), u.x),
             mix(lattice(i + vec2(0.0, 1.0)), lattice(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
void main() {
  vec2 uv = vUv;
  vec3 col = uv.y > 0.5 ? mix(uMid, uTop, (uv.y - 0.5) * 2.0) : mix(uBottom, uMid, uv.y * 2.0);

  if (uStars > 0.0) {
    vec2 g = uv * vec2(uAspect, 1.0) * 70.0 + vec2(0.0, uRise * 6.0);
    vec2 id = floor(g);
    id = mod(id, 289.0);
    float h = hash(id);
    vec2 c = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
    float d = length(fract(g) - 0.5 - c * 0.6);
    float twinkle = 0.65 + 0.35 * sin(uTime * 2.3 + h * 40.0);
    col += uStars * 1.6 * step(0.978, h) * smoothstep(0.11, 0.0, d) * twinkle * vec3(0.85, 0.9, 1.0);
  }

  // Three parallax cloud layers; the far ones drift slower and sit lower.
  for (int l = 0; l < 3; l++) {
    float fl = float(l);
    float scale = 1.4 + fl * 1.2;
    vec2 p = vec2(uv.x * uAspect * scale + uTime * (0.008 + fl * 0.014),
                  (uv.y + uRise * (0.5 + fl * 0.45)) * scale * 1.7);
    float n = fbm(p + fl * 13.1);
    float band = uDensity * clamp(1.15 - uv.y * (1.25 - fl * 0.2), 0.0, 1.0);
    float cover = smoothstep(0.62 - band * 0.4, 0.92 - band * 0.4, n);
    vec3 tint = mix(uShade, uCloud, smoothstep(0.35, 0.95, n));
    col = mix(col, tint, cover * (0.38 + fl * 0.2));
  }

  col += uFlash * vec3(0.72, 0.82, 1.0);
  gl_FragColor = vec4(col, 1.0);
}`;

const colorKeys = ['top', 'mid', 'bottom', 'cloud', 'shade'] as const;
const uniformName = { top: 'uTop', mid: 'uMid', bottom: 'uBottom', cloud: 'uCloud', shade: 'uShade' } as const;

export function sky() {
  const material = new ShaderMaterial({
    vertexShader, fragmentShader, depthTest: false, depthWrite: false,
    uniforms: {
      uTime: { value: 0 }, uAspect: { value: 1 }, uDensity: { value: looks.high.density },
      uStars: { value: 0 }, uFlash: { value: 0 }, uRise: { value: 0 },
      uTop: { value: new Color(looks.high.top) }, uMid: { value: new Color(looks.high.mid) },
      uBottom: { value: new Color(looks.high.bottom) }, uCloud: { value: new Color(looks.high.cloud) },
      uShade: { value: new Color(looks.high.shade) },
    },
  });
  const geometry = new PlaneGeometry(1, 1);
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;

  const targets = Object.fromEntries(colorKeys.map(key => [key, new Color(looks.high[key])])) as Record<typeof colorKeys[number], Color>;
  let density = looks.high.density;
  let stars = 0;
  let flash = 0;
  let flashHold = 0;
  let rise = 0;
  let riseVelocity = 0;
  let punchLeft = 0;

  return {
    mesh,
    theme(theme: Theme) {
      const look = looks[theme];
      for (const key of colorKeys) targets[key].set(look[key]);
      density = look.density;
      stars = look.stars;
    },
    /** A bright strike that settles to a steady glow until released. */
    flash() { flash = 1; flashHold = 0.42; },
    releaseFlash() { flashHold = 0; },
    /** The climb through a cloud layer between stages. */
    punch() { punchLeft = 0.8; },
    resize(width: number, height: number) {
      mesh.scale.set(width, height, 1);
      mesh.position.set(width / 2, height / 2, -5);
      material.uniforms.uAspect.value = width / Math.max(1, height);
    },
    update(time: number, dt: number) {
      const u = material.uniforms;
      const blend = 1 - Math.exp(-dt * 3);
      for (const key of colorKeys) (u[uniformName[key]].value as Color).lerp(targets[key], blend);
      u.uDensity.value += (density - u.uDensity.value) * blend;
      u.uStars.value += (stars - u.uStars.value) * blend;
      flash = Math.max(flashHold, flash - dt * 3.2);
      u.uFlash.value = flash;
      // Always drifting upward a little; a punch adds a fast burst that eases out.
      if (punchLeft > 0) {
        punchLeft = Math.max(0, punchLeft - dt);
        riseVelocity = 1.4 * Math.sin((punchLeft / 0.8) * Math.PI);
      } else riseVelocity = 0;
      rise += dt * (0.012 + riseVelocity);
      u.uRise.value = rise;
      u.uTime.value = time;
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
