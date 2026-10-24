// From afar every placed piece is only light in its own colours, like the light a screen
// throws on the wall behind it, and a plot's pieces run together into one soft haze
// inside the plot's lines (createHaze): a picture or a film frame shrunk to a few pixels,
// a 3D model from the colours of its surfaces, a splat from the colours of its points.
// The glow is saved with the world, so it stands in the city at once and costs almost
// nothing; the real piece only loads when someone comes close, and fades in over it.
//
// Stored on the media item as { t: 'g', d: base64, a }: GRID x GRID colours (RGB bytes,
// row by row from the top) and the piece's aspect (width / height).
import * as THREE from 'three';

const GRID = 4, BYTES = GRID * GRID * 3;

function encode(rgb, a = 1) {
  let s = '';
  for (let i = 0; i < BYTES; i++) s += String.fromCharCode(Math.max(0, Math.min(255, Math.round(rgb[i]))));
  return { t: 'g', d: btoa(s), a: Math.round(Math.max(0.25, Math.min(4, a)) * 100) / 100 };
}

export function normalizeGlow(o) {
  if (!o || o.t !== 'g' || typeof o.d !== 'string' || o.d.length !== Math.ceil(BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(o.d)) return null;
  const a = Number.isFinite(o.a) ? Math.max(0.25, Math.min(4, o.a)) : 1;
  return { t: 'g', d: o.d, a };
}

// A glow's colour as one: the average of its cells in linear light, true to the piece
// (a black and white photograph gives grey light, a bright painting its own colours).
export function glowTint(o) {
  let s;
  try { s = atob(o.d); } catch { return null; }
  if (s.length !== BYTES) return null;
  const c = [0, 0, 0];
  for (let i = 0; i < BYTES; i++) c[i % 3] += linear(s.charCodeAt(i));
  const n = GRID * GRID, l = (c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722) / n;
  return c.map((v) => Math.max(0, l + (v / n - l) * 1.1));
}

// The glow in four: the average of each quarter (top left, top right, bottom left, bottom
// right), so a piece that is half dark sky and half red field lights the plot with both.
export function glowQuads(o) {
  let s;
  try { s = atob(o.d); } catch { return null; }
  if (s.length !== BYTES) return null;
  const q = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], h = GRID / 2, n = h * h;
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    const c = q[(y < h ? 0 : 2) + (x < h ? 0 : 1)];
    for (let k = 0; k < 3; k++) c[k] += linear(s.charCodeAt((y * GRID + x) * 3 + k)) / n;
  }
  return q;
}

// ---- the haze over a plot ----

// From afar a plot is filled, wall to wall, with one soft field of light made of the
// colours of everything placed in it: every point of the box takes the colours of the
// pieces around it, nearer ones more, so they blend across the whole plot, and the field
// drifts slowly. Each view ray is followed through the box in a few steps and the light
// along it gathered; it is smooth from every side and cheap.
export const HAZE_MAX = 16;

const HAZE_VERT = /* glsl */`
varying vec3 vLocal;
void main() { vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const HAZE_FRAG = /* glsl */`
uniform vec3 uMin;
uniform vec3 uMax;
uniform vec3 uEye;
uniform float uTime;
uniform int uCount;
uniform vec4 uP[${16}];
uniform vec4 uC[${16}];
varying vec3 vLocal;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), u.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), u.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
void main() {
  vec3 ro = uEye, rd = normalize(vLocal - uEye);
  vec3 inv = 1.0 / rd, t0 = (uMin - ro) * inv, t1 = (uMax - ro) * inv;
  vec3 lo = min(t0, t1), hi = max(t0, t1);
  float tn = max(max(lo.x, lo.y), max(lo.z, 0.0)), tf = min(min(hi.x, hi.y), hi.z);
  if (tf <= tn) discard;
  vec3 size = uMax - uMin;
  float scale = max(size.x, max(size.y, size.z));
  const int STEPS = 10;
  float dt = (tf - tn) / float(STEPS);
  vec3 acc = vec3(0.0);
  for (int s = 0; s < STEPS; s++) {
    vec3 x = ro + rd * (tn + (float(s) + 0.5) * dt);
    // The drift: the place a colour is looked up at wanders slowly.
    vec3 q = x / scale * 2.2;
    vec3 wander = vec3(noise(q + vec3(0.0, uTime * 0.05, 0.0)), noise(q + vec3(5.2, -uTime * 0.04, 1.3)), noise(q + vec3(2.7, 0.0, uTime * 0.045))) - 0.5;
    vec3 y = x + wander * scale * 0.35;
    vec3 col = vec3(0.0);
    float wsum = 0.0, lit = 0.0;
    for (int i = 0; i < ${16}; i++) {
      if (i >= uCount) break;
      vec3 d = y - uP[i].xyz;
      float r = uP[i].w;
      float k = r * r / (dot(d, d) + r * r * 0.35); // near pieces weigh more, far ones still a little
      k *= k;
      col += uC[i].rgb * k;
      lit += uC[i].a * k;
      wsum += k;
    }
    col /= max(wsum, 1e-5);
    float strength = lit / max(wsum, 1e-5);
    // A faint, slow breathing in how much light there is, and softness toward the floor.
    float breath = 0.75 + 0.5 * noise(q * 1.7 + vec3(uTime * 0.06));
    acc += col * strength * breath * dt;
  }
  vec3 c = 0.5 * (1.0 - exp(-acc * 0.55 / scale * 3.0)); // never a white glare, however much gathers
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// The haze for a box from min to max (in the space of whatever it is added to).
export function createHaze(min, max) {
  const uniforms = {
    uMin: { value: min.clone() }, uMax: { value: max.clone() }, uEye: { value: new THREE.Vector3() }, uTime: { value: 0 }, uCount: { value: 0 },
    uP: { value: Array.from({ length: HAZE_MAX }, () => new THREE.Vector4()) },
    uC: { value: Array.from({ length: HAZE_MAX }, () => new THREE.Vector4()) },
  };
  const size = max.clone().sub(min), mid = max.clone().add(min).multiplyScalar(0.5);
  const geo = new THREE.BoxGeometry(size.x, size.y, size.z).translate(mid.x, mid.y, mid.z);
  // Back faces, so it still draws when the eye is inside the box.
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: HAZE_VERT, fragmentShader: HAZE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const eye = new THREE.Vector3();
  mesh.onBeforeRender = (r, scene, camera) => { uniforms.uEye.value.copy(mesh.worldToLocal(eye.setFromMatrixPosition(camera.matrixWorld))); };
  return mesh;
}

// Glows made in this visit, so a piece seen once keeps its glow when it unloads.
const made = new Map();
export const knownGlow = (src) => made.get(src) || null;
export function keepGlow(src, o) {
  if (!src || !o) return;
  made.set(src, o);
  // The studio listens, and saves it with the world.
  window.dispatchEvent(new CustomEvent('freeart:glow', { detail: { src, glow: o } }));
}

// ---- pictures and frames of film ----

// A picture shrunk to GRID x GRID: halved step by step (a browser shrinking a lot at once
// only looks at a few pixels), then every pixel of each cell averaged in linear light.
export function glowImage(source) {
  const sw = source.videoWidth || source.naturalWidth || source.width, sh = source.videoHeight || source.naturalHeight || source.height;
  if (!sw || !sh) return null;
  const N = 32, B = N / GRID;
  let from = source, w = sw, h = sh;
  while (w > N * 2 || h > N * 2) {
    w = Math.max(N, Math.round(w / 2)); h = Math.max(N, Math.round(h / 2));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(from, 0, 0, w, h);
    from = c;
  }
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(from, 0, 0, N, N);
  let px;
  try { px = g.getImageData(0, 0, N, N).data; } catch { return null; } // a picture from elsewhere that may not be read
  const rgb = [];
  for (let cy = 0; cy < GRID; cy++) for (let cx = 0; cx < GRID; cx++) {
    const s = [0, 0, 0];
    for (let y = cy * B; y < (cy + 1) * B; y++) for (let x = cx * B; x < (cx + 1) * B; x++) {
      const i = (y * N + x) * 4;
      s[0] += linear(px[i]); s[1] += linear(px[i + 1]); s[2] += linear(px[i + 2]);
    }
    rgb.push(...s.map((v) => Math.pow(v / (B * B), 1 / 2.2) * 255));
  }
  return encode(rgb, sw / sh);
}

// How much colour a glow has, from 0 (white, black or grey) up: to choose between frames.
export function glowColour(o) {
  if (!o) return -1;
  const s = atob(o.d);
  let sum = 0;
  for (let i = 0; i < s.length; i += 3) {
    const r = s.charCodeAt(i), g = s.charCodeAt(i + 1), b = s.charCodeAt(i + 2);
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    sum += (hi - lo) * (1 - Math.abs(hi + lo - 255) / 255); // saturation, weighted toward mid brightness
  }
  return sum;
}

// ---- 3D models and splats ----

// Colours gathered by where they sit (seen from the front), with empty places taking the
// overall colour, then softened once so neighbours blend.
function gridOf(samples, box) {
  const sum = new Float32Array(GRID * GRID * 4), all = [0, 0, 0, 0];
  const ext = box.getSize(new THREE.Vector3());
  for (const [x, y, r, g, b, w] of samples) {
    const ix = Math.min(GRID - 1, Math.max(0, Math.floor(((x - box.min.x) / (ext.x || 1)) * GRID)));
    const iy = Math.min(GRID - 1, Math.max(0, Math.floor(((box.max.y - y) / (ext.y || 1)) * GRID)));
    const k = (iy * GRID + ix) * 4;
    sum[k] += r * w; sum[k + 1] += g * w; sum[k + 2] += b * w; sum[k + 3] += w;
    all[0] += r * w; all[1] += g * w; all[2] += b * w; all[3] += w;
  }
  if (!all[3]) return null;
  const avg = [all[0] / all[3], all[1] / all[3], all[2] / all[3]];
  const cell = [];
  for (let i = 0; i < GRID * GRID; i++) {
    const w = sum[i * 4 + 3];
    cell.push(w ? [sum[i * 4] / w, sum[i * 4 + 1] / w, sum[i * 4 + 2] / w] : avg);
  }
  const rgb = [];
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    const c = [0, 0, 0];
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= GRID || yy >= GRID) continue;
      const k = dx || dy ? 1 : 3, v = cell[yy * GRID + xx];
      c[0] += v[0] * k; c[1] += v[1] * k; c[2] += v[2] * k; n += k;
    }
    rgb.push(...c.map((v) => Math.pow(v / n, 1 / 2.2) * 255)); // gathered in linear light, stored as sRGB
  }
  return encode(rgb, (ext.x || 1) / (ext.y || 1));
}

const linear = (v) => Math.pow(v / 255, 2.2);

// The average colour of a texture's picture, in linear light (null if it cannot be read).
const texAverage = new Map();
function averageOf(image) {
  if (!image) return null;
  if (texAverage.has(image)) return texAverage.get(image);
  let out = null;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(image, 0, 0, 16, 16);
    const px = g.getImageData(0, 0, 16, 16).data;
    out = [0, 0, 0];
    for (let i = 0; i < 256; i++) { out[0] += linear(px[i * 4]); out[1] += linear(px[i * 4 + 1]); out[2] += linear(px[i * 4 + 2]); }
    out = out.map((v) => v / 256);
  } catch { out = null; }
  texAverage.set(image, out);
  return out;
}

// A model from the colours of its surfaces: each mesh's colour (its material's colour,
// times its texture's average, or its vertex colours) placed where the mesh sits.
// root: already fitted to the piece.
export function glowModel(root) {
  root.updateMatrixWorld(true);
  const samples = [], box = new THREE.Box3(), v = new THREE.Vector3(), c = new THREE.Color();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes.position) return;
    const geo = o.geometry, pos = geo.attributes.position, col = geo.attributes.color;
    const mat = [].concat(o.material)[0] || {};
    const base = mat.color ? [mat.color.r, mat.color.g, mat.color.b] : [0.8, 0.8, 0.8];
    const t = averageOf(mat.map?.image);
    const tint = t ? base.map((b, i) => b * t[i]) : base;
    const every = Math.max(1, Math.floor(pos.count / 600));
    for (let i = 0; i < pos.count; i += every) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      box.expandByPoint(v);
      let r = tint[0], g = tint[1], b = tint[2];
      if (col) { c.fromBufferAttribute(col, i); r *= c.r; g *= c.g; b *= c.b; }
      samples.push([v.x, v.y, r, g, b, every]);
    }
  });
  return samples.length ? gridOf(samples, box) : null;
}

// A splat from the colours of its points, inside the part of it that is shown.
export function glowSplat(mesh, keepBox) {
  const ps = mesh.packedSplats;
  if (!ps?.forEachSplat || !ps.numSplats) return null;
  mesh.updateMatrix();
  const every = Math.max(1, Math.floor(ps.numSplats / 20000));
  const samples = [], box = new THREE.Box3(), v = new THREE.Vector3();
  let i = 0;
  ps.forEachSplat((k, centre, scale, q, opacity, color) => {
    if (i++ % every || opacity < 0.2 || !color || (keepBox && !keepBox.containsPoint(centre))) return;
    v.copy(centre).applyMatrix4(mesh.matrix);
    box.expandByPoint(v);
    samples.push([v.x, v.y, color.r * color.r, color.g * color.g, color.b * color.b, opacity]); // roughly into linear light
  });
  return samples.length > 30 ? gridOf(samples, box) : null;
}
