// The portal you step through into a plot: the moment you cross its glass walls, the
// city as it was is held still and a white opening grows out of the middle of the view,
// a breathing, uneven rim that draws itself on, sheds sparks and eats its way outward,
// until it has passed the edges and you stand inside. Only white and grey, no colour.
// It is a step in the engine's chain of passes (after the scene, before the output), so
// it costs nothing while it is not playing.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const NOISE = /* glsl */`
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }`;

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COPY = /* glsl */`
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`;

// p: the view in units of half its height, centred. R: the opening's size in those units.
const FRAG = /* glsl */`
uniform sampler2D tDiffuse; // the city now
uniform sampler2D tBefore;  // the city as it was when you stepped in
uniform float uAspect, uTime, uRadius, uArc, uGlow, uFlash, uPush;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0;
  float R = max(uRadius, 1e-4), len = length(p), ang = atan(p.y, p.x);
  vec2 circ = vec2(cos(ang), sin(ang));
  // An uneven, breathing outline.
  float n1 = fbm(circ * 1.25 + vec2(uTime * 0.13, -uTime * 0.09));
  float n2 = noise(circ * 3.4 + vec2(-uTime * 0.6, uTime * 0.45));
  float d = len - R * (1.0 + 0.30 * (n1 - 0.5) + 0.08 * (n2 - 0.5)); // < 0 inside
  float aa = fwidth(len) * 1.5 + R * 0.006;
  float inside = 1.0 - smoothstep(-aa - R * 0.03, aa, d);
  // The rim draws itself on, clockwise from the top.
  float a01 = fract(0.25 - ang / 6.28318);
  float arc = uArc >= 0.999 ? 1.0 : 1.0 - smoothstep(uArc - 0.002, uArc + 0.02, a01);
  float head = uArc >= 0.999 ? 0.0 : exp(-abs(a01 - uArc) * 60.0) * step(0.001, uArc);
  // Inside: the city now, drawn a little toward the rim like through a lens.
  float bend = inside * exp(min(d, 0.0) / (0.22 * R));
  vec3 now = texture2D(tDiffuse, vUv + (vUv - 0.5) * (-0.10 * bend)).rgb * (1.0 + 0.5 * bend);
  // Outside: the moment you crossed, held, and slowly pushed past.
  vec3 before = texture2D(tBefore, 0.5 + (vUv - 0.5) / uPush).rgb;
  // The inner edge is eaten away into grain.
  vec2 gp = p / R;
  float grain = noise(gp * 34.0 + vec2(uTime * 1.7, -uTime * 1.1)) * 0.65 + noise(gp * 90.0 - uTime * 2.3) * 0.35;
  float edge = smoothstep(-0.28 * R, 0.0, d) * inside;
  float eaten = smoothstep(0.5, 0.72, grain + edge * 0.6 - 0.28) * edge;
  float speck = eaten * smoothstep(0.62, 0.9, grain);
  float open = inside * (1.0 - eaten * 0.85);
  // A thin rim, the faintest light beside it (never a glow), and glitter drifting outward in rings.
  float rimW = 0.012 * R + 0.002;
  float rim = exp(-abs(d) / rimW);
  float halo = exp(-abs(d) / (0.08 * R));
  vec2 g = vec2(ang / 6.28318 * 150.0, len / R * 26.0 - uTime * 1.4);
  float h = hash(vec2(mod(floor(g.x), 150.0), floor(g.y)));
  float glitter = smoothstep(0.42, 0.0, length(fract(g) - 0.5)) * pow(0.5 + 0.5 * sin(uTime * (6.0 + h * 10.0) + h * 40.0), 6.0)
                * exp(-abs(d) / (0.2 * R)) * step(0.82, h);
  // While small it is a turning seed of light, not an empty ring.
  float seed = (1.0 - smoothstep(0.08, 0.3, R)) * exp(-len / (R * 0.7)) * (0.6 + 0.4 * sin(ang * 3.0 - uTime * 4.0 + len / R * 6.0));
  float lit = uGlow * arc;
  vec3 col = mix(before, now, open);
  col += vec3(speck * 1.1 + rim * 1.4 + halo * 0.04 + glitter * 1.4) * lit;
  col += vec3(seed * 1.2 + head * 2.2 * exp(-abs(d) / (rimW * 3.0))) * uGlow;
  // The crossing: a brief white breath from the middle, in streaks.
  float r = length(p) * 0.5;
  float streak = pow(noise(circ * 14.0 + vec2(uTime * 3.0, -uTime * 2.1)), 3.0) * smoothstep(0.05, 0.7, r);
  col += vec3(uFlash * uFlash * (1.0 - smoothstep(0.0, 0.9, r)) * 0.8 + streak * uFlash * 0.5);
  gl_FragColor = vec4(col, 1.0);
}`;

const SPARK_VERT = /* glsl */`
attribute float aAge, aSize;
varying float vAge;
uniform float uScale;
void main() {
  vAge = aAge;
  gl_PointSize = aAge < 0.0 ? 0.0 : aSize * uScale * (1.0 - aAge);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SPARK_FRAG = /* glsl */`
varying float vAge;
void main() {
  if (vAge < 0.0) discard;
  vec2 q = gl_PointCoord - 0.5;
  float core = smoothstep(0.5, 0.0, length(q));
  float a = (core * core + 0.35 * smoothstep(0.06, 0.0, min(abs(q.x), abs(q.y))) * core) * (1.0 - vAge);
  gl_FragColor = vec4(vec3(a * 0.9), a);
}`;

const ease = { in3: (x) => x * x * x, out3: (x) => 1 - Math.pow(1 - x, 3), io: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2) };
const DURATION = 2.5;

export class PortalPass extends Pass {
  constructor() {
    super();
    this.enabled = false;
    this.needsSwap = true;
    const rt = { type: THREE.HalfFloatType };
    this.before = new THREE.WebGLRenderTarget(1, 1, rt);
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null } }, vertexShader: VERT, fragmentShader: COPY, depthTest: false, depthWrite: false }));
    this.u = {
      tDiffuse: { value: null }, tBefore: { value: this.before.texture },
      uAspect: { value: 1 }, uTime: { value: 0 }, uRadius: { value: 0.04 }, uArc: { value: 0 }, uGlow: { value: 1 }, uFlash: { value: 0 }, uPush: { value: 1 },
    };
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false }));
    // Sparks peel off the rim, in the same flat space as the view.
    const N = 600;
    this.N = N; this.cursor = 0; this.carry = 0;
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 2);
    this.age = new Float32Array(N).fill(-1); this.life = new Float32Array(N).fill(1); this.size = new Float32Array(N);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAge', new THREE.BufferAttribute(this.age, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.sparkUniforms = { uScale: { value: 12 } };
    this.sparks = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.sparkUniforms, vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    }));
    this.sparks.frustumCulled = false;
    this.sparkScene = new THREE.Scene();
    this.sparkScene.add(this.sparks);
    this.sparkCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    this.t = 0; this.grab = false; this.last = 0;
  }

  // Play it (again from the start, if it is already playing).
  open() {
    this.enabled = true;
    this.grab = true;
    this.t = 0;
    this.last = performance.now();
    this.age.fill(-1);
  }

  setSize(w, h) {
    this.before.setSize(w, h);
    this.u.uAspect.value = w / Math.max(1, h);
    this.sparkCamera.left = -w / Math.max(1, h); this.sparkCamera.right = w / Math.max(1, h);
    this.sparkCamera.updateProjectionMatrix();
    this.sparkUniforms.uScale.value = 10 * (h / 900) * Math.max(1, window.devicePixelRatio || 1);
  }

  emit(n, R, arc) {
    const { pos, vel, age, life, size } = this;
    for (let k = 0; k < n; k++) {
      const a = (0.25 - Math.random() * arc) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), r = R * (0.92 + Math.random() * 0.22), sp = 0.4 + Math.random();
      const i = this.cursor;
      this.cursor = (i + 1) % this.N;
      pos[i * 3] = c * r; pos[i * 3 + 1] = s * r; pos[i * 3 + 2] = 0;
      vel[i * 2] = (c * 0.5 - s * 0.6) * sp * Math.max(R, 0.3); vel[i * 2 + 1] = (s * 0.5 + c * 0.6) * sp * Math.max(R, 0.3);
      age[i] = 0; life[i] = 0.5 + Math.random() * 1.1; size[i] = 0.4 + Math.random() * 1.1;
    }
  }

  render(renderer, writeBuffer, readBuffer) {
    const now = performance.now(), dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.grab) {
      this.grab = false;
      this.copy.material.uniforms.tDiffuse.value = readBuffer.texture;
      renderer.setRenderTarget(this.before);
      this.copy.render(renderer);
    }
    const t = (this.t += dt), u = this.u;
    // The timeline: a seed, the rim drawing on while it breathes, then it grows past the edges.
    const arc = ease.out3(Math.min(1, Math.max(0, (t - 0.1) / 0.8)));
    let R;
    if (t < 0.25) R = 0.04 + 0.16 * ease.out3(t / 0.25);
    else if (t < 1.0) R = 0.2 + 0.05 * Math.sin((t - 0.25) * 5);
    else R = 0.2 + 0.05 * Math.sin(3.75) + 2.9 * ease.in3(Math.min(1, (t - 1.0) / 0.9));
    u.uTime.value = t;
    u.uRadius.value = R;
    u.uArc.value = arc;
    u.uGlow.value = 1 - ease.io(Math.min(1, Math.max(0, (t - 1.7) / 0.6)));
    u.uFlash.value = t > 1.75 ? 0.6 * Math.exp(-(t - 1.75) * 5) : 0;
    u.uPush.value = 1 + 0.12 * ease.io(Math.min(1, t / 1.9));
    u.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
    // Sparks.
    const { pos, vel, age, life } = this;
    this.carry += (t < 1.9 ? 60 + arc * 260 : 0) * dt;
    const n = Math.floor(this.carry);
    this.carry -= n;
    if (n) this.emit(n, R, Math.max(arc, 0.02));
    const drag = Math.exp(-1.6 * dt);
    for (let i = 0; i < this.N; i++) {
      if (age[i] < 0) continue;
      age[i] += dt / life[i];
      if (age[i] >= 1) { age[i] = -1; continue; }
      vel[i * 2] *= drag; vel[i * 2 + 1] = vel[i * 2 + 1] * drag - 0.1 * dt;
      pos[i * 3] += vel[i * 2] * dt; pos[i * 3 + 1] += vel[i * 2 + 1] * dt;
    }
    const g = this.sparks.geometry;
    g.attributes.position.needsUpdate = g.attributes.aAge.needsUpdate = g.attributes.aSize.needsUpdate = true;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.sparkScene, this.sparkCamera);
    renderer.autoClear = auto;
    if (t >= DURATION) this.enabled = false;
  }

  dispose() {
    this.before.dispose(); this.copy.dispose(); this.quad.dispose();
    this.sparks.geometry.dispose(); this.sparks.material.dispose();
  }
}
