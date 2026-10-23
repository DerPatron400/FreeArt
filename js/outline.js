// Every placed piece also exists as a light drawing in white lines: a picture traced
// from what is in it, a film from one of its first frames, a 3D model from its edges,
// a splat as a scatter of points. The drawing is saved with the world, so it stands in
// the city at once and costs almost nothing; the real piece only loads when someone
// comes close, and fades in over its drawing.
//
// Stored on the media item as { t: 'l' | 'p', d: base64 }: line segments (pairs of
// points) or points, each coordinate one signed byte, in units of the piece's size.
import * as THREE from 'three';

const MAX_LINES = 1400, MAX_POINTS = 2400, MAX_TEXT = 20000;

function encode(t, xyz) {
  const q = new Int8Array(xyz.length);
  for (let i = 0; i < xyz.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(xyz[i] * 127)));
  let s = '';
  for (let i = 0; i < q.length; i++) s += String.fromCharCode(q[i] & 255);
  return { t, d: btoa(s) };
}

function decode(o) {
  const s = atob(o.d), out = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = ((s.charCodeAt(i) << 24) >> 24) / 127;
  return out;
}

export function normalizeOutline(o) {
  if (!o || (o.t !== 'l' && o.t !== 'p') || typeof o.d !== 'string' || o.d.length > MAX_TEXT || !/^[A-Za-z0-9+/]*={0,2}$/.test(o.d)) return null;
  return { t: o.t, d: o.d };
}

// The drawing as something to show, scaled to the piece.
export function outlineObject(o, size, color = '#ece4d4') {
  let xyz;
  try { xyz = decode(o); } catch { return null; }
  if (xyz.length < 6) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(xyz, 3));
  g.scale(size, size, size);
  const obj = o.t === 'p'
    ? new THREE.Points(g, new THREE.PointsMaterial({ color, size: Math.max(0.012, size * 0.012), transparent: true, opacity: 0.8, depthWrite: false }))
    : new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false }));
  obj.userData.baseOpacity = obj.material.opacity;
  return obj;
}

// Drawings made in this visit, so a piece seen once keeps its drawing when it unloads.
const made = new Map();
export const knownOutline = (src) => made.get(src) || null;
export function keepOutline(src, o) {
  if (!src || !o) return;
  made.set(src, o);
  // The studio listens, and saves it with the world.
  window.dispatchEvent(new CustomEvent('freeart:outline', { detail: { src, outline: o } }));
}

// ---- pictures and frames of film ----

// Trace what is in a picture: edges found on a small copy, thinned, and joined
// pixel to pixel into short lines. w, h: the picture's shown size, in piece sizes.
export function traceImage(source, w, h) {
  const sw = source.videoWidth || source.naturalWidth || source.width, sh = source.videoHeight || source.naturalHeight || source.height;
  if (!sw || !sh) return null;
  const W = sw >= sh ? 120 : Math.max(8, Math.round(120 * sw / sh)), H = sw >= sh ? Math.max(8, Math.round(120 * sh / sw)) : 120;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(source, 0, 0, W, H);
  let px;
  try { px = g.getImageData(0, 0, W, H).data; } catch { return null; } // a picture from elsewhere that may not be read
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  // A soft blur first, so grain and noise are not mistaken for shapes.
  const soft = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H) { const k = (dx ? 1 : 2) * (dy ? 1 : 2); s += lum[yy * W + xx] * k; n += k; }
    }
    soft[y * W + x] = s / n;
  }
  const mag = new Float32Array(W * H), dir = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const a = (dx, dy) => soft[(y + dy) * W + x + dx];
    const gx = -a(-1, -1) - 2 * a(-1, 0) - a(-1, 1) + a(1, -1) + 2 * a(1, 0) + a(1, 1);
    const gy = -a(-1, -1) - 2 * a(0, -1) - a(1, -1) + a(-1, 1) + 2 * a(0, 1) + a(1, 1);
    mag[y * W + x] = Math.hypot(gx, gy);
    dir[y * W + x] = Math.abs(gx) > Math.abs(gy) ? 0 : 1;
  }
  // Keep the strongest edges (a share of the picture, never faint ones), thinned to one pixel.
  const sorted = Float32Array.from(mag).sort();
  const cut = Math.max(48, sorted[Math.floor(sorted.length * 0.85)]);
  const on = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, m = mag[i];
    if (m < cut) continue;
    const [p, q] = dir[i] === 0 ? [mag[i - 1], mag[i + 1]] : [mag[i - W], mag[i + W]];
    if (m >= p && m >= q) on[i] = 1;
  }
  const xyz = [];
  const at = (x, y) => [((x + 0.5) / W - 0.5) * w, (0.5 - (y + 0.5) / H) * h, 0.002];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!on[y * W + x]) continue;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
      if (on[(y + dy) * W + x + dx]) xyz.push(...at(x, y), ...at(x + dx, y + dy));
    }
  }
  return xyz.length ? encode('l', thin(xyz, 6, MAX_LINES)) : null;
}

// ---- 3D models ----

// The edges that give a model its shape: the mesh is simplified onto a coarse grid,
// then only the creases (where faces meet at a clear angle) and open borders are kept,
// longest first. root: already fitted to the piece (its coordinates are in world units).
export function traceModel(root, size) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && o.geometry?.attributes.position) meshes.push(o); });
  if (!meshes.length) return null;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const m of meshes) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); }
  const G = 40, ext = box.getSize(new THREE.Vector3()), side = Math.max(ext.x, ext.y, ext.z) || 1;
  const cellOf = (p) => {
    const ix = Math.min(G - 1, Math.floor(((p.x - box.min.x) / side) * G));
    const iy = Math.min(G - 1, Math.floor(((p.y - box.min.y) / side) * G));
    const iz = Math.min(G - 1, Math.floor(((p.z - box.min.z) / side) * G));
    return ix + G * (iy + G * iz);
  };
  const sum = new Map(); // cell -> [x, y, z, n]
  const edges = new Map(); // a * G^3 + b -> { nx, ny, nz, faces, crease }
  const N3 = G * G * G;
  let triangles = 0;
  for (const m of meshes) triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  const stride = Math.max(1, Math.floor(triangles / 250000)); // enormous models: every n-th face is plenty for a drawing
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (const m of meshes) {
    const pos = m.geometry.attributes.position, idx = m.geometry.index, count = idx ? idx.count : pos.count;
    const cells = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const k = cellOf(v);
      cells[i] = k;
      const s = sum.get(k);
      if (s) { s[0] += v.x; s[1] += v.y; s[2] += v.z; s[3]++; } else sum.set(k, [v.x, v.y, v.z, 1]);
    }
    for (let t = 0; t + 2 < count; t += 3 * stride) {
      const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
      const k0 = cells[i0], k1 = cells[i1], k2 = cells[i2];
      if (k0 === k1 || k1 === k2 || k0 === k2) continue; // collapsed by the grid
      a.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
      if (n.lengthSq() < 1e-20) continue;
      n.normalize();
      for (const [p, q] of [[k0, k1], [k1, k2], [k2, k0]]) {
        const key = p < q ? p * N3 + q : q * N3 + p;
        const ed = edges.get(key);
        if (!ed) edges.set(key, { nx: n.x, ny: n.y, nz: n.z, faces: 1, crease: false });
        else { ed.faces++; if (ed.nx * n.x + ed.ny * n.y + ed.nz * n.z < 0.8) ed.crease = true; }
      }
    }
  }
  const centre = (k) => { const s = sum.get(k); return [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; };
  const keep = [];
  for (const [key, ed] of edges) {
    if (!ed.crease && ed.faces !== 1) continue;
    const p = centre(Math.floor(key / N3)), q = centre(key % N3);
    keep.push([Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), p, q]);
  }
  keep.sort((x, y) => y[0] - x[0]);
  const xyz = [];
  for (const [, p, q] of keep.slice(0, MAX_LINES)) xyz.push(p[0] / size, p[1] / size, p[2] / size, q[0] / size, q[1] / size, q[2] / size);
  return xyz.length ? encode('l', xyz) : null;
}

// ---- splats ----

// A splat as a scatter of its brighter points, inside the part of it that is shown.
export function traceSplat(mesh, keepBox, size) {
  const ps = mesh.packedSplats;
  if (!ps?.forEachSplat || !ps.numSplats) return null;
  mesh.updateMatrix();
  const every = Math.max(1, Math.floor(ps.numSplats / (MAX_POINTS * 6)));
  const pts = [], v = new THREE.Vector3();
  let i = 0;
  ps.forEachSplat((k, centre, scale, q, opacity) => {
    if (i++ % every || opacity < 0.35 || (keepBox && !keepBox.containsPoint(centre))) return;
    v.copy(centre).applyMatrix4(mesh.matrix);
    pts.push(v.x / size, v.y / size, v.z / size);
  });
  if (pts.length < 30) return null;
  return encode('p', thin(pts, 3, MAX_POINTS));
}

// At most `max` items of `stride` numbers each, spread evenly over the list.
function thin(xyz, stride, max) {
  const n = xyz.length / stride;
  if (n <= max) return xyz;
  const out = [];
  for (let k = 0; k < max; k++) { const i = Math.floor((k * n) / max) * stride; for (let j = 0; j < stride; j++) out.push(xyz[i + j]); }
  return out;
}
