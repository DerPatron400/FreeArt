// The doorway in a plot's glass wall: as you walk up to a plot, a small seed of white
// light appears in the wall just where you are heading, and opens into an uneven,
// breathing rim that sheds sparks, wide enough to pass through; you walk on through it
// without pausing, and behind you it closes again. It is only a ring of light on the
// wall (the view is never held or covered), white and grey with no colour, and one
// doorway serves the whole city, so it costs next to nothing. From outside, you can see
// through it into the plot: its pieces floating in a dark of their own.
import * as THREE from 'three';

const NOISE = /* glsl */`
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }`;

const VERT = /* glsl */`
uniform float uHalf;
varying vec2 vLocal;
void main() {
  vLocal = position.xy * uHalf;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy * uHalf, 0.0, 1.0);
}`;

// Adapted from the showcase portal: the same outline, draw-on, glitter and grain,
// without its colours, its glow or the world behind it.
const FRAG = /* glsl */`
uniform float uTime, uRadius, uArc, uGlow, uHalf, uSee;
uniform sampler2D uView;
uniform vec2 uRes;
varying vec2 vLocal;
${NOISE}
void main() {
  float R = max(uRadius, 1e-4), len = length(vLocal), ang = atan(vLocal.y, vLocal.x);
  vec2 circ = vec2(cos(ang), sin(ang));
  float n1 = fbm(circ * 1.25 + vec2(uTime * 0.13, -uTime * 0.09));
  float n2 = noise(circ * 3.4 + vec2(-uTime * 0.6, uTime * 0.45));
  // While small it stays round; the unevenness grows as it opens.
  float wob = smoothstep(0.25, 0.9, R);
  float d = len - R * (1.0 + wob * (0.30 * (n1 - 0.5) + 0.08 * (n2 - 0.5))); // < 0 inside
  float inside = 1.0 - smoothstep(-R * 0.03, fwidth(len) * 1.5, d);
  float a01 = fract(0.25 - ang / 6.28318);
  float arc = uArc >= 0.999 ? 1.0 : 1.0 - smoothstep(uArc - 0.002, uArc + 0.02, a01);
  float head = uArc >= 0.999 ? 0.0 : exp(-abs(a01 - uArc) * 60.0) * step(0.001, uArc);
  vec2 gp = vLocal / R;
  float grain = noise(gp * 34.0 + vec2(uTime * 1.7, -uTime * 1.1)) * 0.65 + noise(gp * 90.0 - uTime * 2.3) * 0.35;
  float edge = smoothstep(-0.28 * R, 0.0, d) * inside;
  float speck = smoothstep(0.5, 0.72, grain + edge * 0.6 - 0.28) * edge * smoothstep(0.62, 0.9, grain);
  speck *= mix(1.0, smoothstep(-0.1 * R, 0.0, d), uSee); // looking through, the grain keeps to the rim
  float rimW = 0.014 * R + 0.004;
  float rim = exp(-abs(d) / rimW);
  vec2 g = vec2(ang / 6.28318 * 150.0, len / R * 26.0 - uTime * 1.4);
  float h = hash(vec2(mod(floor(g.x), 150.0), floor(g.y)));
  float glitter = smoothstep(0.42, 0.0, length(fract(g) - 0.5)) * pow(0.5 + 0.5 * sin(uTime * (6.0 + h * 10.0) + h * 40.0), 6.0)
                * exp(-abs(d) / (0.2 * R)) * step(0.82, h);
  float seed = (1.0 - smoothstep(0.1, 0.35, R)) * exp(-len / (R * 0.5)) * 0.8;
  float lit = uGlow * arc;
  float a = clamp((rim * 1.2 + speck * 0.9 + glitter * 1.2) * lit + (seed + head * 1.6 * exp(-abs(d) / (rimW * 3.0))) * uGlow, 0.0, 1.0);
  // Nothing may reach the edge of the square it is drawn on.
  a *= 1.0 - smoothstep(0.7, 0.97, max(abs(vLocal.x), abs(vLocal.y)) / uHalf);
  // Through it: the plot's own dark, with its pieces in it (drawn from your eye, see city.js).
  float vis = inside * uSee;
  vec3 view = vis > 0.0 ? texture2D(uView, gl_FragCoord.xy / uRes).rgb : vec3(0.0);
  gl_FragColor = vec4(view * vis * (1.0 - a) + vec3(0.96, 0.94, 0.9) * a, a + vis * (1.0 - a));
}`;

const SPARK_VERT = /* glsl */`
attribute float aAge, aSize;
varying float vAge;
uniform float uScale;
void main() {
  vAge = aAge;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aAge < 0.0 ? 0.0 : aSize * uScale * (1.0 - aAge) / max(0.05, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const SPARK_FRAG = /* glsl */`
varying float vAge;
void main() {
  if (vAge < 0.0) discard;
  vec2 q = gl_PointCoord - 0.5;
  float core = smoothstep(0.5, 0.0, length(q));
  float a = (core * core + 0.3 * smoothstep(0.06, 0.0, min(abs(q.x), abs(q.y))) * core) * (1.0 - vAge);
  gl_FragColor = vec4(vec3(0.95) * a, a);
}`;

export const DOOR_RADIUS = 1.35; // wide enough to walk through
const SEED = 0.08, N = 400;

export function createDoorway() {
  const uniforms = {
    uTime: { value: 0 }, uRadius: { value: SEED }, uArc: { value: 0 }, uGlow: { value: 0 }, uHalf: { value: 1 },
    uSee: { value: 0 }, uView: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
  };
  const blend = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, ...blend }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;

  // Sparks peel off the rim and drift, in the city's own space.
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), age = new Float32Array(N).fill(-1), life = new Float32Array(N).fill(1), size = new Float32Array(N);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAge', new THREE.BufferAttribute(age, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  const sparkUniforms = { uScale: { value: 20 } };
  const sparks = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: sparkUniforms, vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, ...blend, blendDst: THREE.OneFactor }));
  sparks.frustumCulled = false;
  sparks.renderOrder = 11;

  const group = new THREE.Group();
  group.add(mesh, sparks);
  group.visible = false;

  let cursor = 0, carry = 0, radius = SEED, speed = 0, arc = 0, glow = 0, key = null;
  const centre = new THREE.Vector3(), normal = new THREE.Vector3(0, 0, 1), x = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1), NORTH = new THREE.Vector3(0, 0, -1);

  function emit(n) {
    // Its own two directions in the wall (or roof): across, and up it.
    x.crossVectors(Math.abs(normal.y) > 0.9 ? NORTH : up, normal).normalize();
    v.crossVectors(normal, x);
    for (let k = 0; k < n; k++) {
      const a = (0.25 - Math.random() * Math.max(arc, 0.02)) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const r = radius * (0.92 + Math.random() * 0.22), sp = (0.4 + Math.random()) * Math.max(radius, 0.3);
      const i = cursor;
      cursor = (i + 1) % N;
      const ox = c * r, oy = s * r, vx = (c * 0.4 - s * 0.7) * sp, vy = (s * 0.4 + c * 0.7) * sp, vz = (Math.random() - 0.5) * 0.6 * sp;
      pos[i * 3] = centre.x + x.x * ox + v.x * oy; pos[i * 3 + 1] = centre.y + x.y * ox + v.y * oy; pos[i * 3 + 2] = centre.z + x.z * ox + v.z * oy;
      vel[i * 3] = x.x * vx + v.x * vy + normal.x * vz; vel[i * 3 + 1] = x.y * vx + v.y * vy + normal.y * vz; vel[i * 3 + 2] = x.z * vx + v.z * vy + normal.z * vz;
      age[i] = 0; life[i] = 0.5 + Math.random() * 1.1; size[i] = 0.5 + Math.random() * 1.1;
    }
  }

  return {
    group,
    // Each frame: where the doorway stands (a point on a wall, the wall's outward normal,
    // and which wall, so moving to another wall starts a new doorway) and how open it
    // should be (0: shut, 1: wide). Pass open 0 to let it close and fade.
    update(t, dt, { at, facing, wall, open, height = 1 }) {
      if (wall !== key && open > 0) { key = wall; radius = SEED; speed = 0; arc = 0; }
      if (at && open > 0) { centre.copy(at); normal.copy(facing); }
      // A slightly springy opening, so it pops a little as it widens.
      const goal = SEED + (DOOR_RADIUS * height - SEED) * open;
      speed += (70 * (goal - radius) - 10 * speed) * dt;
      radius = Math.max(0.02, radius + speed * dt);
      arc = Math.min(1, arc + dt * (open > 0 ? 1.4 : 0));
      glow += ((open > 0 ? 0.85 + 0.15 * Math.sin(t * 3.2) : 0) - glow) * Math.min(1, dt * (open > 0 ? 4 : 2.5));
      uniforms.uTime.value = t;
      uniforms.uRadius.value = radius;
      uniforms.uArc.value = arc;
      uniforms.uGlow.value = glow;
      uniforms.uHalf.value = Math.max(radius * 2.2, 0.45);
      mesh.position.copy(centre);
      // Turned to face out of its wall, or up out of a roof.
      if (Math.abs(normal.y) > 0.9) mesh.quaternion.setFromUnitVectors(Z, normal);
      else mesh.rotation.set(0, Math.atan2(normal.x, normal.z), 0);
      carry += (open > 0.02 ? 20 + open * 160 : 0) * glow * dt;
      const n = Math.floor(carry);
      carry -= n;
      if (n) emit(n);
      let live = false;
      const drag = Math.exp(-1.6 * dt);
      for (let i = 0; i < N; i++) {
        if (age[i] < 0) continue;
        age[i] += dt / life[i];
        if (age[i] >= 1) { age[i] = -1; continue; }
        live = true;
        vel[i * 3] *= drag; vel[i * 3 + 1] = vel[i * 3 + 1] * drag - 0.12 * dt; vel[i * 3 + 2] *= drag;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      geo.attributes.position.needsUpdate = geo.attributes.aAge.needsUpdate = geo.attributes.aSize.needsUpdate = true;
      group.visible = glow > 0.01 || live;
      if (glow < 0.01 && open <= 0) key = null;
    },
    setViewport(height, pixelRatio) { sparkUniforms.uScale.value = 22 * pixelRatio * (height / 900); },
    // What shows through it (a picture the size of the screen, drawn from the same eye), and
    // how much: 0 is only the rim of light.
    setView(texture, see, width = 1, height = 1) {
      uniforms.uView.value = texture;
      uniforms.uSee.value = texture ? see : 0;
      uniforms.uRes.value.set(width, height);
    },
  };
}
