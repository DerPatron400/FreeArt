// The living form of a world: tens of thousands of particles arranged by a
// generator, then breathed on by noise in the vertex shader.
import * as THREE from 'three';
import { rng, gauss } from './util.js';

const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

const generators = {
  bloom(n, r, out) {
    const petals = 4 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      if (r() < 0.14) { // seed core
        const d = 0.28 * Math.cbrt(r());
        const v = randomDir(r);
        out(i, v[0] * d, v[1] * d, v[2] * d);
        continue;
      }
      const y = 1 - (2 * (i + 0.5)) / n;
      const rad = Math.sqrt(1 - y * y);
      const th = i * GOLDEN;
      const x = Math.cos(th) * rad, z = Math.sin(th) * rad;
      const petal = 0.75 * Math.pow(0.5 + 0.5 * Math.cos(petals * Math.atan2(z, x) + y * 1.5), 3) * (1 - Math.abs(y) * 0.7);
      const R = 0.75 + petal + gauss(r) * 0.025;
      out(i, x * R, y * R * 0.85, z * R);
    }
  },
  spiral(n, r, out) {
    const arms = 2 + Math.floor(r() * 3);
    const twist = 2.2 + r() * 1.6;
    for (let i = 0; i < n; i++) {
      if (r() < 0.12) { // bulge
        const d = 0.35 * Math.abs(gauss(r));
        const v = randomDir(r);
        out(i, v[0] * d, v[1] * d * 0.6, v[2] * d);
        continue;
      }
      const d = Math.pow(r(), 0.65) * 2.1;
      const a = (i % arms) * (TAU / arms) + d * twist + (gauss(r) * 0.28) / (d + 0.35);
      const spread = 0.05 + 0.08 * d;
      out(i, Math.cos(a) * d + gauss(r) * spread, gauss(r) * 0.07 * (2.2 - d), Math.sin(a) * d + gauss(r) * spread);
    }
  },
  knot(n, r, out) {
    const p = 2 + Math.floor(r() * 2), q = p === 2 ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const t = r() * TAU;
      const rr = Math.cos(q * t) + 2;
      const s = 0.48;
      const tube = 0.1 + 0.05 * Math.sin(t * 7);
      out(i, rr * Math.cos(p * t) * s + gauss(r) * tube, -Math.sin(q * t) * s + gauss(r) * tube, rr * Math.sin(p * t) * s + gauss(r) * tube);
    }
  },
  tide(n, r, out) {
    const k1 = 1.5 + r() * 1.5, k2 = 1 + r() * 2;
    for (let i = 0; i < n; i++) {
      const d = Math.sqrt(r()) * 2.4;
      const a = r() * TAU;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const y = 0.22 * Math.sin(x * k1) * Math.cos(z * k2) + 0.1 * Math.sin(d * 4) - 0.15;
      out(i, x, y + gauss(r) * 0.015, z);
    }
  },
  solid(n, r, out) {
    // Nested Platonic solids after Leonardo's drawings for De divina proportione,
    // wrapped in the rings of an armillary sphere.
    const shells = [new THREE.IcosahedronGeometry(1.25, 0), new THREE.DodecahedronGeometry(0.8, 0), new THREE.OctahedronGeometry(0.42, 0)];
    const edges = [];
    for (const g of shells) {
      const pos = new THREE.EdgesGeometry(g).attributes.position.array;
      for (let i = 0; i < pos.length; i += 6) edges.push(pos.slice(i, i + 6));
      g.dispose();
    }
    const tilts = [0, 1.1, 2.2].map((t) => new THREE.Euler(t * 0.7, t, 0));
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      if (r() < 0.25) {
        const a = r() * TAU;
        v.set(Math.cos(a) * 1.65, gauss(r) * 0.006, Math.sin(a) * 1.65).applyEuler(tilts[i % 3]);
        out(i, v.x, v.y, v.z);
        continue;
      }
      const e = edges[Math.floor(r() * edges.length)];
      const t = r();
      const j = 0.012;
      out(i, e[0] + (e[3] - e[0]) * t + gauss(r) * j, e[1] + (e[4] - e[1]) * t + gauss(r) * j, e[2] + (e[5] - e[2]) * t + gauss(r) * j);
    }
  },
  nebula(n, r, out) {
    const clumps = Array.from({ length: 6 + Math.floor(r() * 5) }, () => ({
      c: [gauss(r) * 0.8, gauss(r) * 0.5, gauss(r) * 0.8], s: 0.18 + r() * 0.38,
    }));
    for (let i = 0; i < n; i++) {
      if (r() < 0.12) { out(i, gauss(r) * 1.1, gauss(r) * 0.6, gauss(r) * 1.1); continue; }
      const k = clumps[i % clumps.length];
      const s = k.s * Math.pow(r(), 0.5);
      out(i, k.c[0] + gauss(r) * s, k.c[1] + gauss(r) * s * 0.8, k.c[2] + gauss(r) * s);
    }
  },
};

function randomDir(r) {
  const u = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - u * u);
  return [Math.cos(a) * s, u, Math.sin(a) * s];
}

const NOISE = /* glsl */ `
vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}`;

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uEnergy;
uniform float uSize;
uniform float uReveal;
uniform float uHover;
uniform float uPixelRatio;
uniform float uWave;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
attribute vec4 aRand;
varying vec3 vColor;
varying float vAlpha;
${NOISE}
void main() {
  vec3 p = position;
  float t = uTime * (0.06 + 0.12 * uEnergy);
  vec3 q = p * 0.75;
  vec3 n = vec3(snoise(q + vec3(t, 0.0, 0.0)), snoise(q + vec3(0.0, t + 31.0, 0.0)), snoise(q + vec3(0.0, 0.0, t + 67.0)));
  p += n * (0.03 + 0.28 * uEnergy) * (0.35 + aRand.z);
  p.y += uWave * 0.12 * sin(p.x * 2.0 + uTime * 0.8) * cos(p.z * 1.6 + uTime * 0.6);
  p *= 1.0 + 0.015 * sin(uTime * 0.7 + aRand.w * 6.2831) + uHover * 0.06;

  vec3 scatter = normalize(aRand.xyz - 0.5 + 1e-4) * (5.0 + aRand.w * 9.0);
  float r = smoothstep(aRand.w * 0.55, aRand.w * 0.55 + 0.45, uReveal);
  p = mix(scatter, p, r);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = uSize * (0.3 + aRand.y * aRand.y * 1.7);
  gl_PointSize = min(s * uPixelRatio * (10.0 / -mv.z), 48.0 * uPixelRatio);

  float m = n.x * 0.5 + 0.5;
  vec3 c = mix(uC0, uC1, smoothstep(0.05, 0.6, aRand.x * 0.8 + m * 0.35));
  c = mix(c, uC2, smoothstep(0.78, 1.05, aRand.x * 0.9 + m * 0.25));
  vColor = c;
  vAlpha = (0.25 + 0.75 * r) * (0.45 + 0.55 * aRand.z) * (1.0 + uHover * 0.8);
  vAlpha *= smoothstep(0.4, 2.5, -mv.z); // fade motes that drift past the lens
}`;

const fragmentShader = /* glsl */ `
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vColor, a * a * vAlpha * uOpacity);
}`;

export function densityToCount(density, lod = 1) {
  return Math.round((18000 + density * 72000) * lod);
}

export function buildGeometry(type, count, seed) {
  const r = rng(seed + ':' + type);
  const pos = new Float32Array(count * 3);
  const rand = new Float32Array(count * 4);
  (generators[type] || generators.bloom)(count, r, (i, x, y, z) => {
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
  });
  for (let i = 0; i < rand.length; i++) rand[i] = r();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
  g.computeBoundingSphere();
  return g;
}

export function createForm(world, { lod = 1, size = 1 } = {}) {
  const count = densityToCount(world.form.density, lod);
  const geometry = buildGeometry(world.form.type, count, world.id);
  const uniforms = {
    uTime: { value: 0 },
    uEnergy: { value: world.form.energy },
    uSize: { value: size * sizeFor(count) },
    uReveal: { value: 0 },
    uHover: { value: 0 },
    uOpacity: { value: 1 },
    uWave: { value: world.form.type === 'tide' ? 1 : 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    uC0: { value: new THREE.Color(world.palette[0]) },
    uC1: { value: new THREE.Color(world.palette[1]) },
    uC2: { value: new THREE.Color(world.palette[2]) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.userData.uniforms = uniforms;
  return points;
}

// Fewer particles get larger sprites so sparse worlds still read as solid.
function sizeFor(count) {
  return 1.4 * Math.sqrt(40000 / count);
}

export function updateFormLook(points, world) {
  const u = points.userData.uniforms;
  u.uEnergy.value = world.form.energy;
  u.uC0.value.set(world.palette[0]);
  u.uC1.value.set(world.palette[1]);
  u.uC2.value.set(world.palette[2]);
}

export function disposeForm(points) {
  if (!points) return;
  points.parent?.remove(points);
  points.geometry.dispose();
  points.material.dispose();
}

// Faint motes of dust filling the space between worlds.
export function createDust(count = 3000) {
  const r = rng('dust');
  const pos = new Float32Array(count * 3);
  const rand = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const d = 12 + r() * 60;
    const v = randomDir(r);
    pos.set([v[0] * d, v[1] * d * 0.6, v[2] * d], i * 3);
  }
  for (let i = 0; i < rand.length; i++) rand[i] = r();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
  const uniforms = {
    uTime: { value: 0 }, uEnergy: { value: 0.2 }, uSize: { value: 3.2 }, uReveal: { value: 1 }, uHover: { value: 0 },
    uOpacity: { value: 0.5 }, uWave: { value: 0 }, uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    uC0: { value: new THREE.Color('#3a3128') }, uC1: { value: new THREE.Color('#8f8677') }, uC2: { value: new THREE.Color('#ece4d4') },
  };
  const m = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.userData.uniforms = uniforms;
  return p;
}
