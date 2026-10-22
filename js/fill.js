// Particles that fill a plot by themselves: a handful of flowing strokes (waves,
// helices, loops, arcs, drifting mist) drawn through the plot's box, spilling a
// little over its edges. They are ordinary hand strokes, so they can be undone,
// drawn over, or cleared like any others. Every call gives a new variation.

const TAU = Math.PI * 2;

// Each shape is a curve in a unit box (-1..1 on every side), t from 0 to 1.
const SHAPES = {
  wave(R) {
    const k = 1 + R() * 2, p = R() * TAU, y = R() * 1.2 - 0.6, a = 0.25 + R() * 0.4, z = R() * 1.4 - 0.7, b = 0.2 + R() * 0.5;
    return { style: R() < 0.6 ? 'ribbon' : 'stream', at: (t) => { const x = t * 2.2 - 1.1; return [x, y + a * Math.sin(k * x * Math.PI + p), z + b * Math.cos(k * 0.7 * x * Math.PI + p)]; } };
  },
  helix(R) {
    const cx = R() * 1.2 - 0.6, cz = R() * 1.2 - 0.6, r = 0.25 + R() * 0.45, turns = 1.5 + R() * 2, p = R() * TAU, dir = R() < 0.5 ? 1 : -1;
    return { style: 'stream', at: (t) => { const a = p + dir * t * turns * TAU, rr = r * (0.7 + 0.5 * t); return [cx + Math.cos(a) * rr, t * 2.1 - 1.05, cz + Math.sin(a) * rr]; } };
  },
  loop(R) {
    const a = 1 + Math.floor(R() * 3), b = 2 + Math.floor(R() * 2), c = 1 + Math.floor(R() * 3), d = R() * TAU, s = 0.6 + R() * 0.35;
    const cy = R() * 0.6 - 0.3;
    return { style: R() < 0.5 ? 'stream' : 'stars', closed: true, at: (t) => { const u = t * TAU; return [Math.sin(a * u + d) * s, cy + Math.sin(b * u) * s * 0.55, Math.sin(c * u + d * 0.5) * s]; } };
  },
  arc(R) {
    const a0 = R() * TAU, span = Math.PI * (0.6 + R() * 0.7), r = 0.6 + R() * 0.5, lift = 0.4 + R() * 0.6, y0 = -0.8 + R() * 0.4;
    return { style: 'comet', at: (t) => { const a = a0 + span * t; return [Math.cos(a) * r, y0 + Math.sin(t * Math.PI) * lift * 1.6, Math.sin(a) * r]; } };
  },
  floor(R) {
    const turns = 2 + R() * 2, p = R() * TAU, y = -0.95 + R() * 0.2;
    return { style: 'stars', at: (t) => { const a = p + t * turns * TAU, r = 0.1 + t * 0.95; return [Math.cos(a) * r, y + Math.sin(a * 3) * 0.04, Math.sin(a) * r]; } };
  },
  mist(R) {
    const c = [R() * 1.4 - 0.7, R() * 1.4 - 0.7, R() * 1.4 - 0.7], r = 0.2 + R() * 0.3, p = R() * TAU;
    return { style: 'mist', at: (t) => { const a = p + t * TAU * 1.3; return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a * 2) * r * 0.5, c[2] + Math.sin(a) * r]; } };
  },
};

// box: { min: [x, y, z], max: [x, y, z] } in the form's own space; limit: the largest coordinate allowed.
export function fillStrokes(box, { limit = 2.2, spill = 0.08 } = {}) {
  const R = Math.random;
  const c = [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2);
  const h = [0, 1, 2].map((i) => ((box.max[i] - box.min[i]) / 2) * (1 + spill));
  const small = Math.min(...h);
  // Always something that flows across and something that rises, then a free mix.
  const names = ['wave', R() < 0.5 ? 'helix' : 'arc'];
  const pool = ['wave', 'helix', 'loop', 'arc', 'floor', 'mist', 'loop', 'wave'];
  const n = 5 + Math.floor(R() * 4);
  while (names.length < n) names.push(pool[Math.floor(R() * pool.length)]);
  return names.map((name, i) => {
    const s = SHAPES[name](R);
    const steps = s.closed ? 140 : 90;
    const pts = [];
    for (let k = 0; k <= steps; k++) {
      const u = s.at(k / steps);
      pts.push(u.map((v, j) => Math.round(Math.max(-limit, Math.min(limit, c[j] + v * h[j])) * 1000) / 1000));
    }
    const spread = Math.max(0.005, Math.min(0.5, small * (s.style === 'mist' ? 0.12 : s.style === 'ribbon' ? 0.035 : 0.025 + R() * 0.03)));
    const st = { pts, spread: Math.round(spread * 1000) / 1000, tone: i === 0 ? 2 : Math.floor(R() * 3) };
    if (s.style !== 'stars') st.style = s.style;
    return st;
  });
}
