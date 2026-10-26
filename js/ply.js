// Spark reads only binary Gaussian-splat PLY files. Many tools (and many machines)
// write text ("ascii") PLY, or plain point clouds with only position and colour.
// readyPly turns any of those into a binary splat PLY: each point becomes a small
// round splat of its own colour. A file that is already a binary splat is left as it is.
// A very dense point cloud keeps an even share of its points (MAX_POINTS), each a
// little larger, so a scan of millions stays light enough to fly through.
// The work runs in a worker (ply-worker.js), so the page never stops while it happens.

const SIZES = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2,
  int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
const GET = { char: 'getInt8', int8: 'getInt8', uchar: 'getUint8', uint8: 'getUint8', short: 'getInt16', int16: 'getInt16',
  ushort: 'getUint16', uint16: 'getUint16', int: 'getInt32', int32: 'getInt32', uint: 'getUint32', uint32: 'getUint32',
  float: 'getFloat32', float32: 'getFloat32', double: 'getFloat64', float64: 'getFloat64' };
const OUT = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
const C0 = 0.28209479177387814;
const MAX_POINTS = 600000;

function header(bytes) {
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const end = head.indexOf('end_header');
  if (!head.startsWith('ply') || end < 0) return null;
  const nl = head.indexOf('\n', end);
  const elements = [];
  let format = '';
  for (const line of head.slice(0, end).split(/\r?\n/)) {
    const w = line.trim().split(/\s+/);
    if (w[0] === 'format') format = w[1];
    else if (w[0] === 'element') elements.push({ name: w[1], count: +w[2], props: [] });
    else if (w[0] === 'property' && elements.length) {
      elements.at(-1).props.push(w[1] === 'list' ? { list: true, count: w[2], type: w[3], name: w[4] } : { type: w[1], name: w[2] });
    }
  }
  return { format, elements, body: new TextEncoder().encode(head.slice(0, nl + 1)).length };
}

// The vertex element's columns, as arrays of numbers by property name.
function readVertices(bytes, h) {
  const vi = h.elements.findIndex((e) => e.name === 'vertex');
  if (vi < 0) return null;
  const v = h.elements[vi], n = v.count, cols = {};
  for (const p of v.props) if (!p.list) cols[p.name] = new Float32Array(n);
  if (h.format === 'ascii') {
    const text = new TextDecoder().decode(bytes.subarray(h.body));
    let at = 0;
    const next = () => {
      const nl = text.indexOf('\n', at);
      const line = text.slice(at, nl < 0 ? text.length : nl);
      at = nl < 0 ? text.length : nl + 1;
      return line;
    };
    for (let e = 0; e < vi; e++) for (let i = 0; i < h.elements[e].count; i++) next();
    for (let i = 0; i < n; i++) {
      const w = next().trim().split(/\s+/);
      let k = 0;
      for (const p of v.props) {
        if (p.list) { k += 1 + +w[k]; continue; }
        cols[p.name][i] = +w[k++];
      }
    }
    return { n, cols, types: Object.fromEntries(v.props.map((p) => [p.name, p.type])) };
  }
  const little = h.format === 'binary_little_endian';
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = h.body;
  for (let e = 0; e < vi; e++) {
    const el = h.elements[e];
    if (el.props.some((p) => p.list)) return null;
    off += el.count * el.props.reduce((s, p) => s + SIZES[p.type], 0);
  }
  for (let i = 0; i < n; i++) {
    for (const p of v.props) {
      if (p.list) {
        const c = dv[GET[p.count]](off, little);
        off += SIZES[p.count] + c * SIZES[p.type];
        continue;
      }
      cols[p.name][i] = dv[GET[p.type]](off, little);
      off += SIZES[p.type];
    }
  }
  return { n, cols, types: Object.fromEntries(v.props.map((p) => [p.name, p.type])) };
}

export function readyPly(bytes) {
  const h = header(bytes);
  if (!h) return bytes;
  const v = h.elements.find((e) => e.name === 'vertex');
  const has = (k) => v?.props.some((p) => p.name === k);
  const splat = has('f_dc_0') && has('scale_0') && has('rot_0') && has('opacity');
  if (h.format === 'binary_little_endian' && splat) return bytes;
  const r = readVertices(bytes, h);
  if (!r || !r.n) return bytes;
  const { n, cols, types } = r;
  const { x, y, z } = cols;
  // Points without a size of their own: about the gap between neighbours on a surface.
  let size = 0;
  if (!splat) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      const p = [x[i], y[i], z[i]];
      for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
    }
    const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
    size = Math.log(Math.max(diag * 1e-4, (diag / Math.sqrt(Math.min(n, MAX_POINTS))) * 0.45));
  }
  const step = splat ? 1 : Math.max(1, n / MAX_POINTS), kept = Math.floor(n / step);
  const colour = (k, alt) => {
    if (cols[k]) return (i) => cols[k][i];
    const c = cols[alt] || cols[alt.replace('red', 'r').replace('green', 'g').replace('blue', 'b')];
    if (!c) return () => (0.8 - 0.5) / C0;
    const scale = /float|double/.test(types[alt] || '') ? 1 : 1 / 255;
    return (i) => (c[i] * scale - 0.5) / C0;
  };
  const dc = [colour('f_dc_0', 'red'), colour('f_dc_1', 'green'), colour('f_dc_2', 'blue')];
  const alpha = cols.alpha, alphaScale = /float|double/.test(types.alpha || '') ? 1 : 1 / 255;
  const opacity = cols.opacity ? (i) => cols.opacity[i]
    : alpha ? (i) => { const a = Math.min(0.999, Math.max(0.001, alpha[i] * alphaScale)); return Math.log(a / (1 - a)); }
      : () => 3;
  const get = (k, fallback) => (cols[k] ? (i) => cols[k][i] : () => fallback);
  const sc = [get('scale_0', size), get('scale_1', size), get('scale_2', size)];
  const rot = [get('rot_0', 1), get('rot_1', 0), get('rot_2', 0), get('rot_3', 0)];

  const head = new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\nelement vertex ${kept}\n${OUT.map((k) => `property float ${k}`).join('\n')}\nend_header\n`);
  const out = new Uint8Array(head.length + kept * OUT.length * 4);
  out.set(head);
  const dv = new DataView(out.buffer);
  let off = head.length;
  for (let j = 0; j < kept; j++) {
    const i = Math.floor(j * step);
    const row = [x[i], y[i], z[i], dc[0](i), dc[1](i), dc[2](i), opacity(i), sc[0](i), sc[1](i), sc[2](i), rot[0](i), rot[1](i), rot[2](i), rot[3](i)];
    for (const val of row) { dv.setFloat32(off, val, true); off += 4; }
  }
  return out;
}
