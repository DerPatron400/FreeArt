// Building on a plot: a vocabulary of pieces drawn as lines. Some are Renaissance
// architecture, the rest are free shapes (paths, spirals, rings, bursts, lattices,
// waves), so a plot can hold a building, a sculpture, a drawing in the air, or nothing.
// A build is plain data, so humans (in the workshop) and machines (in JSON) make
// the same things. Units: 1 = the width of the plot, measured from its centre on
// the ground; x and z run from -0.5 to 0.5, y goes up (up to 2).
import * as THREE from 'three';
import { clamp } from './util.js';

export const PIECES = [
  { id: 'block', name: 'Block', note: 'a plain volume', count: null },
  { id: 'roof', name: 'Roof', note: 'a pitched gable', count: null },
  { id: 'column', name: 'Column', note: 'base, shaft, capital', count: null },
  { id: 'colonnade', name: 'Colonnade', note: 'columns in a ring', count: [4, 24, 12] },
  { id: 'arcade', name: 'Arcade', note: 'a row of arches', count: [1, 9, 3] },
  { id: 'drum', name: 'Drum', note: 'a cylinder', count: [6, 32, 16] },
  { id: 'dome', name: 'Dome', note: 'ribbed cupola', count: [6, 32, 12] },
  { id: 'podium', name: 'Podium', note: 'round steps', count: [1, 6, 3] },
  { id: 'stair', name: 'Stair', note: 'straight flight', count: [2, 24, 8] },
  { id: 'obelisk', name: 'Obelisk', note: 'tapering needle', count: null },
  { id: 'cypress', name: 'Cypress', note: 'a Tuscan tree', count: null },
  { id: 'sphere', name: 'Sphere', note: 'the perfect form', count: [6, 24, 10] },
  { id: 'path', name: 'Path', note: 'a line through your own points', count: null },
  { id: 'helix', name: 'Helix', note: 'a rising spiral', count: [1, 24, 4] },
  { id: 'ring', name: 'Rings', note: 'hoops spread along the height', count: [1, 24, 1] },
  { id: 'cone', name: 'Cone', note: 'lines from a circle to a point', count: [3, 48, 16] },
  { id: 'burst', name: 'Burst', note: 'rays from a centre', count: [3, 96, 24] },
  { id: 'lattice', name: 'Lattice', note: 'a 3D grid', count: [1, 12, 4] },
  { id: 'wave', name: 'Wave', note: 'a rippling surface', count: [2, 32, 12] },
];
const BY_ID = new Map(PIECES.map((p) => [p.id, p]));
export const MAX_PIECES = 60;

// Defaults for a newly added piece: a sensible size for each kind.
export const PIECE_DEFAULTS = {
  block: [0.5, 0.4, 0.5], roof: [0.5, 0.18, 0.5], column: [0.08, 0.6, 0.08], colonnade: [0.6, 0.45, 0.05],
  arcade: [0.8, 0.45, 0.2], drum: [0.4, 0.3, 0.4], dome: [0.5, 0.25, 0.5], podium: [0.8, 0.12, 0.8],
  stair: [0.3, 0.2, 0.4], obelisk: [0.08, 0.8, 0.08], cypress: [0.1, 0.55, 0.1], sphere: [0.3, 0.3, 0.3],
  path: [0.5, 0.5, 0.5], helix: [0.4, 0.8, 0.4], ring: [0.5, 0.3, 0.5], cone: [0.4, 0.5, 0.4], burst: [0.6, 0.6, 0.6],
  lattice: [0.5, 0.5, 0.5], wave: [0.8, 0.12, 0.8],
};
export const MAX_PATH_POINTS = 240;
const PATH_DEFAULT = [[-0.3, 0.1, 0], [-0.1, 0.4, 0.1], [0.1, 0.2, -0.1], [0.3, 0.6, 0]];

const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? clamp(v, lo, hi) : d);
const round = (v) => Math.round(v * 1000) / 1000;

// Anything (human- or machine-written) into a safe, complete build.
export function normalizeBuild(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const pieces = (Array.isArray(raw.pieces) ? raw.pieces : []).filter((p) => BY_ID.has(p?.type)).slice(0, MAX_PIECES).map((p) => {
    const def = PIECE_DEFAULTS[p.type];
    const at = Array.isArray(p.at) ? p.at : [];
    const size = Array.isArray(p.size) ? p.size : [];
    const c = BY_ID.get(p.type).count;
    const out = {
      type: p.type,
      at: [round(num(at[0], -0.5, 0.5, 0)), round(num(at[1], 0, 2, 0)), round(num(at[2], -0.5, 0.5, 0))],
      size: [0, 1, 2].map((i) => round(num(size[i], 0.01, i === 1 ? 2 : 1, def[i]))),
      turn: round(num(p.turn, 0, 1, 0)),
      tone: [0, 1, 2].includes(p.tone) ? p.tone : 2,
    };
    const tilt = round(num(p.tilt, -0.5, 0.5, 0));
    if (tilt) out.tilt = tilt;
    if (c) out.count = Math.round(num(p.count, c[0], c[1], c[2]));
    if (p.type === 'path') {
      // Points are in plot widths, measured from `at`.
      const pts = (Array.isArray(p.points) ? p.points : []).slice(0, MAX_PATH_POINTS)
        .filter((q) => Array.isArray(q) && q.length >= 3)
        .map((q) => [round(num(q[0], -1, 1, 0)), round(num(q[1], -1, 2, 0)), round(num(q[2], -1, 1, 0))]);
      out.points = pts.length >= 2 ? pts : PATH_DEFAULT;
      if (p.closed === true) out.closed = true;
    }
    return out;
  });
  const f = raw.form && typeof raw.form === 'object' ? raw.form : null;
  const form = f ? {
    at: [0, 1, 2].map((i) => round(num(f.at?.[i], i === 1 ? 0 : -0.5, i === 1 ? 2 : 0.5, i === 1 ? 0.5 : 0))),
    scale: round(num(f.scale, 0.1, 1.5, 0.8)),
  } : null;
  if (!pieces.length && !form) return null;
  return form ? { pieces, form } : { pieces };
}

// Where the world's particle form floats in a plot of width U and height H.
export function formPlacement(world, U, H) {
  const f = world.build?.form;
  if (f) return { pos: new THREE.Vector3(f.at[0] * U, f.at[1] * U, f.at[2] * U), scale: (U * f.scale) / 3.8 };
  return { pos: new THREE.Vector3(0, H * 0.5, 0), scale: Math.min(U, H * 1.2) / 3.8 };
}

// The highest point of a build, in plot widths.
export function buildTop(build) {
  if (!build) return 0;
  let top = 0;
  for (const p of build.pieces) {
    const h = p.type === 'path' ? Math.max(0, ...p.points.map((q) => q[1])) : p.size[1] * (p.type === 'colonnade' ? 1.1 : p.type === 'burst' ? 0.5 : 1);
    top = Math.max(top, p.at[1] + h);
  }
  if (build.form) top = Math.max(top, build.form.at[1] + build.form.scale * 0.5);
  return top;
}

// ---- drawing -------------------------------------------------------------

function circle(out, cx, cy, cz, rx, rz, n, a0 = 0, a1 = Math.PI * 2) {
  for (let i = 0; i < n; i++) {
    const t0 = a0 + (a1 - a0) * (i / n), t1 = a0 + (a1 - a0) * ((i + 1) / n);
    out.push(cx + Math.cos(t0) * rx, cy, cz + Math.sin(t0) * rz, cx + Math.cos(t1) * rx, cy, cz + Math.sin(t1) * rz);
  }
}

function box(out, cx, cy, cz, sx, sy, sz) {
  const a = sx / 2, b = sz / 2;
  const c = [[-a, -b], [a, -b], [a, b], [-a, b]];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = c[i], [x1, z1] = c[(i + 1) % 4];
    out.push(cx + x0, cy, cz + z0, cx + x1, cy, cz + z1);
    out.push(cx + x0, cy + sy, cz + z0, cx + x1, cy + sy, cz + z1);
    out.push(cx + x0, cy, cz + z0, cx + x0, cy + sy, cz + z0);
  }
}

function column(out, cx, cz, r, h) {
  const plinth = Math.min(h * 0.06, r * 0.8);
  box(out, cx, 0, cz, r * 2.5, plinth, r * 2.5);
  circle(out, cx, plinth, cz, r, r, 12);
  circle(out, cx, h - plinth, cz, r * 0.86, r * 0.86, 12);
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2;
    out.push(cx + Math.cos(t) * r, plinth, cz + Math.sin(t) * r, cx + Math.cos(t) * r * 0.86, h - plinth, cz + Math.sin(t) * r * 0.86);
  }
  box(out, cx, h - plinth, cz, r * 2.5, plinth, r * 2.5);
}

// Front and back faces of a row of round arches on piers, joined at the corners.
function arcade(out, sx, sy, sz, n) {
  const bay = sx / n, pier = bay * 0.18, r = (bay - pier) / 2;
  const spring = Math.max(sy - r - sy * 0.12, sy * 0.25);
  for (const z of [-sz / 2, sz / 2]) {
    out.push(-sx / 2, 0, z, -sx / 2, sy, z, sx / 2, 0, z, sx / 2, sy, z, -sx / 2, sy, z, sx / 2, sy, z);
    for (let i = 0; i < n; i++) {
      const x0 = -sx / 2 + i * bay + pier / 2, cxa = x0 + r;
      out.push(x0, 0, z, x0, spring, z, x0 + 2 * r, 0, z, x0 + 2 * r, spring, z);
      for (let k = 0; k < 12; k++) {
        const t0 = Math.PI - (k / 12) * Math.PI, t1 = Math.PI - ((k + 1) / 12) * Math.PI;
        out.push(cxa + Math.cos(t0) * r, spring + Math.sin(t0) * r, z, cxa + Math.cos(t1) * r, spring + Math.sin(t1) * r, z);
      }
    }
  }
  for (const x of [-sx / 2, sx / 2]) for (const y of [0, sy]) out.push(x, y, -sz / 2, x, y, sz / 2);
  // Under each arch, the soffit lines through the depth.
  for (let i = 0; i < n; i++) {
    const x0 = -sx / 2 + i * bay + pier / 2;
    out.push(x0, spring, -sz / 2, x0, spring, sz / 2, x0 + 2 * r, spring, -sz / 2, x0 + 2 * r, spring, sz / 2);
    out.push(x0 + r, spring + r, -sz / 2, x0 + r, spring + r, sz / 2);
  }
}

function ribs(out, rx, ry, rz, n, rings, y0 = 0, profile = (t) => Math.cos(t)) {
  // Meridians from the base to the top, and a few parallels.
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    for (let k = 0; k < 10; k++) {
      const t0 = (k / 10) * Math.PI / 2, t1 = ((k + 1) / 10) * Math.PI / 2;
      const p0 = profile(t0), p1 = profile(t1);
      out.push(Math.cos(a) * rx * p0, y0 + Math.sin(t0) * ry, Math.sin(a) * rz * p0, Math.cos(a) * rx * p1, y0 + Math.sin(t1) * ry, Math.sin(a) * rz * p1);
    }
  }
  for (let j = 0; j < rings; j++) {
    const t = (j / rings) * Math.PI / 2, p = profile(t);
    circle(out, 0, y0 + Math.sin(t) * ry, 0, rx * p, rz * p, 32);
  }
}

function drawPiece(p, out) {
  const [sx, sy, sz] = p.size;
  const n = p.count;
  switch (p.type) {
    case 'block': box(out, 0, 0, 0, sx, sy, sz); break;
    case 'roof': {
      const a = sx / 2, b = sz / 2;
      out.push(-a, 0, -b, a, 0, -b, a, 0, -b, a, 0, b, a, 0, b, -a, 0, b, -a, 0, b, -a, 0, -b);
      out.push(-a, sy, 0, a, sy, 0);
      for (const x of [-a, a]) out.push(x, 0, -b, x, sy, 0, x, 0, b, x, sy, 0);
      break;
    }
    case 'column': column(out, 0, 0, Math.min(sx, sz) / 2, sy); break;
    case 'colonnade': {
      const R = sx / 2, r = Math.min(sz / 2, R * 0.2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        column(out, Math.cos(a) * R, Math.sin(a) * R, r, sy);
      }
      // Entablature: two rings with a band between them.
      circle(out, 0, sy, 0, R + r * 1.3, R + r * 1.3, 48);
      circle(out, 0, sy + sy * 0.1, 0, R + r * 1.3, R + r * 1.3, 48);
      break;
    }
    case 'arcade': arcade(out, sx, sy, sz, n); break;
    case 'drum': {
      circle(out, 0, 0, 0, sx / 2, sz / 2, 48);
      circle(out, 0, sy, 0, sx / 2, sz / 2, 48);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        out.push(Math.cos(a) * sx / 2, 0, Math.sin(a) * sz / 2, Math.cos(a) * sx / 2, sy, Math.sin(a) * sz / 2);
      }
      break;
    }
    case 'dome': ribs(out, sx / 2, sy, sz / 2, n, 4); break;
    case 'sphere': {
      const r = sx / 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI;
        for (let k = 0; k < 24; k++) {
          const t0 = (k / 24) * Math.PI * 2, t1 = ((k + 1) / 24) * Math.PI * 2;
          out.push(Math.cos(a) * Math.cos(t0) * r, r + Math.sin(t0) * r, Math.sin(a) * Math.cos(t0) * r,
            Math.cos(a) * Math.cos(t1) * r, r + Math.sin(t1) * r, Math.sin(a) * Math.cos(t1) * r);
        }
      }
      for (let j = 1; j < 4; j++) {
        const t = (j / 4) * Math.PI - Math.PI / 2;
        circle(out, 0, r + Math.sin(t) * r, 0, Math.cos(t) * r, Math.cos(t) * r, 32);
      }
      break;
    }
    case 'podium': {
      for (let i = 0; i < n; i++) {
        const k = 1 - i / (n + 1) * 0.5, y0 = (i / n) * sy, y1 = ((i + 1) / n) * sy;
        circle(out, 0, y0, 0, sx / 2 * k, sz / 2 * k, 48);
        circle(out, 0, y1, 0, sx / 2 * k, sz / 2 * k, 48);
      }
      break;
    }
    case 'stair': {
      const a = sx / 2;
      for (let i = 0; i < n; i++) {
        const z0 = -sz / 2 + (i / n) * sz, z1 = -sz / 2 + ((i + 1) / n) * sz;
        const y0 = (i / n) * sy, y1 = ((i + 1) / n) * sy;
        for (const x of [-a, a]) out.push(x, y0, z0, x, y1, z0, x, y1, z0, x, y1, z1);
        out.push(-a, y1, z0, a, y1, z0);
      }
      for (const x of [-a, a]) out.push(x, 0, -sz / 2, x, 0, sz / 2, x, 0, sz / 2, x, sy, sz / 2);
      break;
    }
    case 'obelisk': {
      const b = sx / 2, t = b * 0.6, hs = sy * 0.9;
      box(out, 0, 0, 0, sx * 1.6, sy * 0.05, sz * 1.6);
      const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let i = 0; i < 4; i++) {
        const [x0, z0] = c[i], [x1, z1] = c[(i + 1) % 4];
        out.push(x0 * b, sy * 0.05, z0 * b, x0 * t, hs, z0 * t);
        out.push(x0 * t, hs, z0 * t, x1 * t, hs, z1 * t);
        out.push(x0 * t, hs, z0 * t, 0, sy, 0);
      }
      break;
    }
    case 'cypress': {
      const r = sx / 2, trunk = sy * 0.08;
      out.push(0, 0, 0, 0, trunk, 0);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        for (let k = 0; k < 12; k++) {
          const t0 = k / 12, t1 = (k + 1) / 12;
          const w0 = Math.pow(Math.sin(Math.PI * Math.pow(t0, 0.8)), 0.9) * r, w1 = Math.pow(Math.sin(Math.PI * Math.pow(t1, 0.8)), 0.9) * r;
          out.push(Math.cos(a) * w0, trunk + t0 * (sy - trunk), Math.sin(a) * w0, Math.cos(a) * w1, trunk + t1 * (sy - trunk), Math.sin(a) * w1);
        }
      }
      break;
    }
    case 'path': {
      const q = p.points, end = p.closed ? q.length : q.length - 1;
      for (let i = 0; i < end; i++) { const a = q[i], b = q[(i + 1) % q.length]; out.push(a[0], a[1], a[2], b[0], b[1], b[2]); }
      break;
    }
    case 'helix': {
      const steps = n * 48;
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps, t1 = (i + 1) / steps;
        const a0 = t0 * n * Math.PI * 2, a1 = t1 * n * Math.PI * 2;
        out.push(Math.cos(a0) * sx / 2, t0 * sy, Math.sin(a0) * sz / 2, Math.cos(a1) * sx / 2, t1 * sy, Math.sin(a1) * sz / 2);
      }
      break;
    }
    case 'ring': for (let i = 0; i < n; i++) circle(out, 0, n > 1 ? (i / (n - 1)) * sy : sy / 2, 0, sx / 2, sz / 2, 64); break;
    case 'cone': {
      circle(out, 0, 0, 0, sx / 2, sz / 2, 48);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        out.push(Math.cos(a) * sx / 2, 0, Math.sin(a) * sz / 2, 0, sy, 0);
      }
      break;
    }
    case 'burst': {
      // Rays from the centre, spread evenly over a sphere (a golden-angle spiral).
      for (let i = 0; i < n; i++) {
        const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * 2.39996;
        out.push(0, sy / 2, 0, Math.cos(a) * r * sx / 2, sy / 2 + y * sy / 2, Math.sin(a) * r * sz / 2);
      }
      break;
    }
    case 'lattice': {
      const g = (i) => i / n - 0.5;
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
        out.push(g(i) * sx, 0, g(j) * sz, g(i) * sx, sy, g(j) * sz);
        out.push(-sx / 2, (i / n) * sy, g(j) * sz, sx / 2, (i / n) * sy, g(j) * sz);
        out.push(g(i) * sx, (j / n) * sy, -sz / 2, g(i) * sx, (j / n) * sy, sz / 2);
      }
      break;
    }
    case 'wave': {
      const k = 24, h = (x, z) => sy / 2 + Math.sin(x * 9) * Math.cos(z * 7) * sy / 2;
      for (let i = 0; i < n; i++) {
        const z = ((i / (n - 1)) - 0.5) * sz;
        for (let j = 0; j < k; j++) {
          const x0 = (j / k - 0.5) * sx, x1 = ((j + 1) / k - 0.5) * sx;
          out.push(x0, h(x0, z), z, x1, h(x1, z), z);
        }
      }
      break;
    }
  }
}

// One plot's build as line drawings: one LineSegments per palette tone.
// U is the plot width in world units.
export function createBuild(build, palette, U, { opacity = 0.6 } = {}) {
  const group = new THREE.Group();
  if (!build?.pieces?.length) return group;
  const byTone = [[], [], []];
  const m = new THREE.Matrix4(), tiltM = new THREE.Matrix4(), v = new THREE.Vector3();
  for (const p of build.pieces) {
    const local = [];
    drawPiece(p, local);
    m.makeRotationY(-p.turn * Math.PI * 2);
    if (p.tilt) m.multiply(tiltM.makeRotationX(p.tilt * Math.PI * 2));
    m.setPosition(p.at[0], p.at[1], p.at[2]);
    const out = byTone[p.tone];
    for (let i = 0; i < local.length; i += 3) {
      v.set(local[i], local[i + 1], local[i + 2]).applyMatrix4(m).multiplyScalar(U);
      out.push(v.x, v.y, v.z);
    }
  }
  const paper = new THREE.Color('#ece4d4');
  byTone.forEach((pos, tone) => {
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // The deep colour is lifted towards paper so it still reads on near-black.
    const color = new THREE.Color(palette[tone]).lerp(paper, tone === 0 ? 0.45 : 0.12);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const lines = new THREE.LineSegments(g, mat);
    lines.layers.set(1); // drawn after the bloom pass: crisp lines, no glow
    group.add(lines);
  });
  return group;
}

export function disposeBuild(group) {
  if (!group) return;
  group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  group.removeFromParent();
}

// Ready-made starting points for the workshop (and examples for machines).
export const PRESETS = {
  orrery: {
    name: 'Orrery',
    build: {
      form: { at: [0, 0.55, 0], scale: 0.28 },
      pieces: [
        { type: 'ring', at: [0, 0.25, 0], size: [0.8, 0.6, 0.8], tilt: 0.06, tone: 2 },
        { type: 'ring', at: [0, 0.25, 0], size: [0.62, 0.6, 0.62], tilt: -0.1, turn: 0.3, tone: 1 },
        { type: 'ring', at: [0, 0.25, 0], size: [0.46, 0.6, 0.46], tilt: 0.17, turn: 0.6, tone: 2 },
        { type: 'burst', at: [0, 0.4, 0], size: [0.3, 0.3, 0.3], count: 40, tone: 1 },
        { type: 'path', at: [0, 0, 0], points: [[0, 0, 0], [0, 0.4, 0]], tone: 0 },
      ],
    },
  },
  vine: {
    name: 'Vine',
    build: {
      form: { at: [0.1, 1.05, 0], scale: 0.3 },
      pieces: [
        { type: 'helix', at: [0, 0, 0], size: [0.3, 1, 0.3], count: 5, tone: 1 },
        { type: 'path', at: [0, 0, 0], points: [[0, 0, 0], [0.05, 0.3, 0.1], [-0.08, 0.6, 0.02], [0.1, 0.95, -0.05]], tone: 2 },
        { type: 'wave', at: [0, 0, 0], size: [0.9, 0.05, 0.9], count: 10, tone: 0 },
      ],
    },
  },
  tempietto: {
    name: 'Tempietto',
    build: {
      form: { at: [0, 0.42, 0], scale: 0.3 },
      pieces: [
        { type: 'podium', at: [0, 0, 0], size: [0.82, 0.09, 0.82], count: 3, tone: 2 },
        { type: 'colonnade', at: [0, 0.09, 0], size: [0.56, 0.42, 0.035], count: 16, tone: 2 },
        { type: 'drum', at: [0, 0.552, 0], size: [0.42, 0.2, 0.42], count: 16, tone: 1 },
        { type: 'dome', at: [0, 0.752, 0], size: [0.42, 0.2, 0.42], count: 16, tone: 2 },
        { type: 'drum', at: [0, 0.94, 0], size: [0.07, 0.07, 0.07], count: 8, tone: 1 },
        { type: 'dome', at: [0, 1.01, 0], size: [0.07, 0.04, 0.07], count: 8, tone: 2 },
        { type: 'cypress', at: [-0.41, 0, -0.41], size: [0.07, 0.62, 0.07], tone: 1 },
        { type: 'cypress', at: [0.41, 0, -0.41], size: [0.07, 0.55, 0.07], tone: 1 },
        { type: 'cypress', at: [-0.41, 0, 0.41], size: [0.07, 0.5, 0.07], tone: 1 },
        { type: 'cypress', at: [0.41, 0, 0.41], size: [0.07, 0.6, 0.07], tone: 1 },
      ],
    },
  },
  loggia: {
    name: 'Loggia',
    build: {
      form: { at: [0, 0.75, 0.05], scale: 0.42 },
      pieces: [
        { type: 'block', at: [0, 0, 0], size: [0.9, 0.04, 0.5], tone: 2 },
        { type: 'arcade', at: [0, 0.04, 0], size: [0.9, 0.36, 0.3], count: 5, tone: 2 },
        { type: 'block', at: [0, 0.4, 0], size: [0.9, 0.05, 0.3], tone: 1 },
        { type: 'stair', at: [0, 0, 0.36], size: [0.3, 0.04, 0.14], count: 3, turn: 0.5, tone: 1 },
      ],
    },
  },
  garden: {
    name: 'Garden',
    build: {
      form: { at: [0, 0.38, 0], scale: 0.45 },
      pieces: [
        { type: 'podium', at: [0, 0, 0], size: [0.3, 0.06, 0.3], count: 2, tone: 1 },
        ...[-0.4, -0.2, 0.2, 0.4].flatMap((x) => [-0.4, 0.4].map((z) => ({ type: 'cypress', at: [x, 0, z], size: [0.06, 0.4 + Math.abs(x) * 0.3, 0.06], tone: 1 }))),
        { type: 'obelisk', at: [0, 0.06, 0], size: [0.04, 0.2, 0.04], tone: 2 },
      ],
    },
  },
  tower: {
    name: 'Tower house',
    build: {
      form: { at: [0, 1.15, 0], scale: 0.4 },
      pieces: [
        { type: 'block', at: [0, 0, 0], size: [0.34, 0.9, 0.34], tone: 2 },
        { type: 'arcade', at: [0, 0.9, 0], size: [0.34, 0.14, 0.34], count: 2, tone: 1 },
        { type: 'roof', at: [0, 1.04, 0], size: [0.36, 0.08, 0.36], tone: 2 },
        { type: 'block', at: [0.3, 0, 0.05], size: [0.3, 0.3, 0.6], tone: 1 },
        { type: 'roof', at: [0.3, 0.3, 0.05], size: [0.3, 0.1, 0.6], turn: 0.25, tone: 1 },
      ],
    },
  },
};
