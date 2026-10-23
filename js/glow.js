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

// A glow's colour as one: the average of its cells in linear light, a little richer.
export function glowTint(o) {
  let s;
  try { s = atob(o.d); } catch { return null; }
  if (s.length !== BYTES) return null;
  const c = [0, 0, 0];
  for (let i = 0; i < BYTES; i++) c[i % 3] += linear(s.charCodeAt(i));
  const n = GRID * GRID, l = (c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722) / n;
  return c.map((v) => Math.max(0, l + (v / n - l) * 1.4));
}

// ---- the haze over a plot ----

// From afar a plot is one soft cloud of light inside its own lines: every piece that is
// not up close adds a blur of its colour where it stands, and they run into each other.
// Each view ray is followed through the plot's box and the light of every piece summed
// along it (a gaussian, integrated exactly), so it is smooth from every side and cheap.
export const HAZE_MAX = 16;

const HAZE_VERT = /* glsl */`
varying vec3 vLocal;
void main() { vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const HAZE_FRAG = /* glsl */`
uniform vec3 uMin;
uniform vec3 uMax;
uniform vec3 uEye;
uniform int uCount;
uniform vec4 uP[${16}];
uniform vec4 uC[${16}];
varying vec3 vLocal;
float erf1(float x) { float t = x * x; return sign(x) * sqrt(1.0 - exp(-t * (1.2732 + 0.147 * t) / (1.0 + 0.147 * t))); }
void main() {
  vec3 ro = uEye, rd = normalize(vLocal - uEye);
  vec3 inv = 1.0 / rd, t0 = (uMin - ro) * inv, t1 = (uMax - ro) * inv;
  vec3 lo = min(t0, t1), hi = max(t0, t1);
  float tn = max(max(lo.x, lo.y), max(lo.z, 0.0)), tf = min(min(hi.x, hi.y), hi.z);
  if (tf <= tn) discard;
  vec3 col = vec3(0.0);
  for (int i = 0; i < ${16}; i++) {
    if (i >= uCount) break;
    vec3 q = uP[i].xyz - ro;
    float r = uP[i].w, c = dot(q, rd), b = dot(q, q) - c * c;
    float along = erf1((tf - c) / r) - erf1((tn - c) / r);
    // A piece you stand right by gives way, so its light never fills the whole view.
    float by = smoothstep(r * 1.2, r * 4.0, length(q));
    col += uC[i].rgb * uC[i].a * by * exp(-b / (r * r)) * 0.886 * along;
  }
  col = 0.42 * (1.0 - exp(-col * 0.7)); // never a white glare, however much gathers
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// The haze for a box from min to max (in the space of whatever it is added to).
export function createHaze(min, max) {
  const uniforms = {
    uMin: { value: min.clone() }, uMax: { value: max.clone() }, uEye: { value: new THREE.Vector3() }, uCount: { value: 0 },
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
