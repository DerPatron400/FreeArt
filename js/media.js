// Showing the process: pictures, film, sound, 3D, and things made right here
// (sketches, melodies, sculptures). Every item is plain data, so humans and
// machines make the same things, and everything is checked before it is shown.
import { el, clamp } from './util.js';
import { normalizeBuild } from './build.js';
import { t } from './i18n.js';
import { normalizeGlow } from './glow.js';

export const KINDS = [
  { id: 'image', name: 'Image', note: 'photo, scan, painting' },
  { id: 'video', name: 'Video', note: 'film, YouTube, Vimeo' },
  { id: 'audio', name: 'Sound', note: 'recording, SoundCloud' },
  { id: 'model', name: '3D model', note: '.glb file or Sketchfab' },
  { id: 'splat', name: 'Splat', note: 'a Gaussian splat: .spz, .ply, .splat' },
  { id: 'sketch', name: 'Sketch', note: 'draw it here' },
  { id: 'melody', name: 'Melody', note: 'compose it here' },
  { id: 'sculpture', name: 'Sculpture', note: 'build it from pieces' },
  { id: 'poem', name: 'Poem', note: 'words that drift and gather' },
  { id: 'constellation', name: 'Constellation', note: 'how things connect' },
];
// What can stand in a plot and be seen from the street.
export const SHOWABLE = ['image', 'video', 'audio', 'model', 'splat', 'sketch', 'melody', 'sculpture', 'poem', 'constellation'];
export const MAX_MEDIA = 40;
const SCALES = {
  pentatonic: [0, 2, 4, 7, 9], major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
};

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// A source we are willing to load: https, a path inside the site, or (images only) inline data.
// Files people add from their own device travel inside the world as data URLs.
const DATA_MAX = { image: 6e6, audio: 16e6, video: 80e6, model: 34e6, splat: 41e6 };
const DATA_TYPES = { image: /^data:image\/(png|jpeg|webp|gif);base64,/i, audio: /^data:audio\/(webm|ogg|mpeg|mp3|mp4|aac|wav|x-wav|x-m4a);(codecs=[\w.]+;)?base64,/i, video: /^data:video\/(mp4|webm|ogg|quicktime);(codecs=[\w.,]+;)?base64,/i,
  model: /^data:model\/gltf-binary;base64,/i, splat: /^data:application\/x-(spz|ply|splat|ksplat|sog);base64,/i };
export function safeSrc(src, kind) {
  if (typeof src !== 'string') return '';
  if (src.startsWith('data:')) {
    // Checked by its header and by the characters base64 can hold, without scanning megabytes with a regex.
    if (!DATA_TYPES[kind] || src.length > DATA_MAX[kind] || !DATA_TYPES[kind].test(src.slice(0, 80))) return '';
    return /[\s"'<>]/.test(src.slice(-200)) || src.includes('"') || src.includes('<') ? '' : src;
  }
  const s = str(src, 1000);
  if (!s) return '';
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s;
  if (/^(worlds|media)\/[\w./-]+$/.test(s) && !s.includes('..')) return s;
  return '';
}

// Known players we embed in a sandboxed frame; anything else plays as a plain file.
export function embedFor(src) {
  let u;
  try { u = new URL(src); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let m;
  if (host === 'youtu.be' && (m = u.pathname.match(/^\/([\w-]{6,20})/))) return { url: `https://www.youtube-nocookie.com/embed/${m[1]}`, ratio: 16 / 9 };
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,20})/) || [])[1];
    if (id && /^[\w-]{6,20}$/.test(id)) return { url: `https://www.youtube-nocookie.com/embed/${id}`, ratio: 16 / 9 };
  }
  if (host === 'vimeo.com' && (m = u.pathname.match(/^\/(\d{5,12})/))) return { url: `https://player.vimeo.com/video/${m[1]}`, ratio: 16 / 9 };
  if (host === 'soundcloud.com' && u.pathname.length > 1) return { url: `https://w.soundcloud.com/player/?url=${encodeURIComponent(u.origin + u.pathname)}&color=%23c9a46a&visual=false`, height: 140 };
  if (host === 'sketchfab.com' && (m = u.pathname.match(/([0-9a-f]{32})\/?$/))) return { url: `https://sketchfab.com/models/${m[1]}/embed?autostart=1&ui_theme=dark`, ratio: 4 / 3 };
  return null;
}

function normalizeSketch(s) {
  const view = Array.isArray(s?.view) ? s.view : [];
  const paths = (Array.isArray(s?.paths) ? s.paths : []).slice(0, 400).map((p) => ({
    d: str(p?.d, 20000).replace(/[^MmLlHhVvCcSsQqTtAaZz0-9.,\-\s]/g, ''),
    tone: [0, 1, 2].includes(p?.tone) ? p.tone : 2,
    width: clamp(typeof p?.width === 'number' ? p.width : 2, 0.2, 40),
    fill: p?.fill === true,
  })).filter((p) => p.d);
  if (!paths.length) return null;
  const w = clamp(+view[0] || 400, 10, 4000), h = clamp(+view[1] || 300, 10, 4000);
  return { view: [w, h], paths };
}

function normalizeMelody(m) {
  const steps = clamp(Math.round(+m?.steps || 16), 4, 64);
  const notes = (Array.isArray(m?.notes) ? m.notes : []).slice(0, 512)
    .filter((n) => Array.isArray(n) && n.every((v) => typeof v === 'number' && isFinite(v)))
    .map(([s, d, l = 1]) => [clamp(Math.round(s), 0, steps - 1), clamp(Math.round(d), 0, 20), clamp(Math.round(l), 1, 16)]);
  if (!notes.length) return null;
  return {
    steps, notes, tempo: clamp(Math.round(+m?.tempo || 84), 40, 200),
    scale: SCALES[m?.scale] ? m.scale : 'pentatonic',
    root: clamp(+m?.root || 220, 55, 880),
    loop: m?.loop !== false,
  };
}

function normalizePoem(p) {
  const lines = (Array.isArray(p?.lines) ? p.lines : []).slice(0, 24).map((l) => str(l, 120)).filter(Boolean);
  if (!lines.length) return null;
  return {
    lines,
    motion: ['gather', 'drift', 'still', 'presence'].includes(p?.motion) ? p.motion : 'gather',
    layout: p?.layout === 'helix' ? 'helix' : 'lines',
  };
}

function normalizeConstellation(c) {
  const nodes = (Array.isArray(c?.nodes) ? c.nodes : []).slice(0, 48).map((n) => {
    const out = { label: str(n?.label, 48), tone: [0, 1, 2].includes(n?.tone) ? n.tone : 2 };
    if (Array.isArray(n?.at) && n.at.length === 3 && n.at.every((v) => typeof v === 'number' && isFinite(v))) out.at = n.at.map((v) => Math.round(clamp(v, -1, 1) * 1000) / 1000);
    return out;
  });
  if (!nodes.length) return null;
  const edges = (Array.isArray(c?.edges) ? c.edges : []).slice(0, 120)
    .filter((e) => Array.isArray(e) && Number.isInteger(e[0]) && Number.isInteger(e[1]) && e[0] !== e[1] && nodes[e[0]] && nodes[e[1]])
    .map((e) => [e[0], e[1]]);
  return { nodes, edges };
}

// How a placed thing moves, and what it does when a visitor comes near the plot.
export const MOTIONS = ['still', 'float', 'sway', 'spin', 'breathe', 'orbit'];
export const NEAR = ['none', 'appear', 'rise', 'wake', 'turn'];

// Where an item stands in the plot, in plot widths (see build.js): true = let the plot arrange it.
function normalizeShow(v) {
  if (v === true) return true;
  if (!v || typeof v !== 'object') return false;
  const at = Array.isArray(v.at) && v.at.length === 3 ? [clamp(+v.at[0] || 0, -1, 1), clamp(+v.at[1] || 0, 0, 3), clamp(+v.at[2] || 0, -1, 1)] : null;
  const out = { size: clamp(typeof v.size === 'number' ? v.size : 0.32, 0.05, 1.5), motion: MOTIONS.includes(v.motion) ? v.motion : 'float' };
  if (at) out.at = at.map((x) => Math.round(x * 1000) / 1000);
  // A fixed facing (radians about the vertical); without it flat things face whoever looks.
  if (typeof v.turn === 'number' && isFinite(v.turn)) out.turn = Math.round(Math.atan2(Math.sin(v.turn), Math.cos(v.turn)) * 1000) / 1000;
  if (NEAR.includes(v.near) && v.near !== 'none') out.near = v.near;
  if (v.flip === true) out.flip = true;
  return out;
}

export function normalizeMedia(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_MEDIA).map((m) => {
    if (!m || !KINDS.some((k) => k.id === m.kind)) return null;
    const out = { kind: m.kind };
    const caption = str(m.caption, 200);
    if (caption) out.caption = caption;
    if (['image', 'video', 'audio', 'model', 'splat'].includes(m.kind)) {
      out.src = safeSrc(m.src, m.kind);
      if (!out.src) return null;
      if (m.kind === 'image') out.alt = str(m.alt, 200);
      if (m.kind !== 'audio') { const o = normalizeGlow(m.glow); if (o) out.glow = o; } // its glow from afar
    } else if (m.kind === 'sketch') {
      out.sketch = normalizeSketch(m.sketch);
      if (!out.sketch) return null;
    } else if (m.kind === 'melody') {
      out.melody = normalizeMelody(m.melody);
      if (!out.melody) return null;
    } else if (m.kind === 'sculpture') {
      out.build = normalizeBuild(m.build);
      if (!out.build?.pieces?.length) return null;
    } else if (m.kind === 'poem') {
      out.poem = normalizePoem(m.poem);
      if (!out.poem) return null;
    } else if (m.kind === 'constellation') {
      out.constellation = normalizeConstellation(m.constellation);
      if (!out.constellation) return null;
    }
    const show = normalizeShow(m.show);
    if (show) out.show = show;
    return out;
  }).filter(Boolean);
}

// ---- showing -------------------------------------------------------------

const SVG = 'http://www.w3.org/2000/svg';

// The deep colour is lifted towards paper so it still reads on near-black.
export function inkColors(palette) {
  const mix = (a, b, t) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
  return [mix(palette[0], '#ece4d4', 0.45), mix(palette[1], '#ece4d4', 0.12), palette[2]];
}

export function sketchSvg(sketch, palette, { animate = true } = {}) {
  palette = inkColors(palette);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${sketch.view[0]} ${sketch.view[1]}`);
  svg.setAttribute('class', 'sketch' + (animate ? ' is-drawing' : ''));
  sketch.paths.forEach((p, i) => {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', p.d);
    path.setAttribute('pathLength', '1');
    path.setAttribute('stroke', palette[p.tone]);
    path.setAttribute('stroke-width', p.width);
    path.setAttribute('fill', p.fill ? palette[p.tone] : 'none');
    if (p.fill) path.setAttribute('fill-opacity', '0.35');
    path.style.animationDelay = `${Math.min(i * 0.12, 6)}s`;
    svg.append(path);
  });
  return svg;
}

// Positions for every node: the ones given, the rest spread on a sphere.
export function constellationLayout(c) {
  const n = c.nodes.length;
  return c.nodes.map((node, i) => {
    if (node.at) return node.at;
    const y = n > 1 ? 1 - (i / (n - 1)) * 2 : 0, r = Math.sqrt(1 - y * y), a = i * 2.39996;
    return [Math.cos(a) * r * 0.9, y * 0.7, Math.sin(a) * r * 0.9];
  });
}

export function constellationSvg(c, palette) {
  const ink = inkColors(palette);
  const pos = constellationLayout(c);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '-130 -100 260 200');
  svg.setAttribute('class', 'constellation');
  const P = (p) => [p[0] * 100 + p[2] * 18, -p[1] * 80 + p[2] * 10];
  for (const [a, b] of c.edges) {
    const [x1, y1] = P(pos[a]), [x2, y2] = P(pos[b]);
    const l = document.createElementNS(SVG, 'line');
    Object.entries({ x1, y1, x2, y2, stroke: ink[1], 'stroke-width': 0.6, 'stroke-opacity': 0.7 }).forEach(([k, v]) => l.setAttribute(k, v));
    svg.append(l);
  }
  c.nodes.forEach((node, i) => {
    const [x, y] = P(pos[i]);
    const dot = document.createElementNS(SVG, 'circle');
    Object.entries({ cx: x, cy: y, r: 1.8, fill: ink[node.tone] }).forEach(([k, v]) => dot.setAttribute(k, v));
    const t = document.createElementNS(SVG, 'text');
    Object.entries({ x: x + 4, y: y + 3, fill: ink[node.tone], 'font-size': 9 }).forEach(([k, v]) => t.setAttribute(k, v));
    t.textContent = node.label;
    svg.append(dot, t);
  });
  return svg;
}

let audioCtx;
export function ctx() {
  const C = window.AudioContext || window.webkitAudioContext;
  if (!audioCtx && C) audioCtx = new C();
  return audioCtx;
}

export function melodyFreq(m, degree) {
  const sc = SCALES[m.scale];
  const oct = Math.floor(degree / sc.length), semi = sc[degree % sc.length] + oct * 12;
  return m.root * Math.pow(2, semi / 12);
}

// A small piano roll that plays itself with a soft plucked voice.
export function melodyPlayer(melody, palette) {
  const wrap = el('div', 'melody');
  const rows = Math.max(...melody.notes.map((n) => n[1])) + 1;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${melody.steps} ${Math.max(rows, 5)}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const H = Math.max(rows, 5);
  for (const [s, d, l] of melody.notes) {
    const r = document.createElementNS(SVG, 'rect');
    Object.entries({ x: s + 0.08, y: H - d - 1 + 0.15, width: l - 0.16, height: 0.7, rx: 0.2, fill: palette[2] }).forEach(([k, v]) => r.setAttribute(k, v));
    r.dataset.step = s;
    svg.append(r);
  }
  const head = document.createElementNS(SVG, 'rect');
  Object.entries({ x: 0, y: 0, width: 0.06, height: H, fill: palette[1], opacity: 0 }).forEach(([k, v]) => head.setAttribute(k, v));
  svg.append(head);
  const btn = el('button', 'melody__play mono', t('ui.play'));
  btn.type = 'button';
  let timer = null;
  const stop = () => { clearInterval(timer); timer = null; btn.textContent = t('ui.play'); head.setAttribute('opacity', 0); };
  btn.addEventListener('click', () => {
    if (timer) return stop();
    const ac = ctx();
    if (!ac) return;
    ac.resume();
    const stepDur = 60 / melody.tempo / 2;
    let step = 0;
    btn.textContent = t('ui.stop');
    const tick = () => {
      if (!wrap.isConnected) return stop();
      head.setAttribute('x', step);
      head.setAttribute('opacity', 0.8);
      for (const [s, d, l] of melody.notes) if (s === step) pluck(ac, melodyFreq(melody, d), l * stepDur);
      step++;
      if (step >= melody.steps) { if (melody.loop) step = 0; else stop(); }
    };
    tick();
    timer = setInterval(tick, stepDur * 1000);
  });
  wrap.append(svg, btn);
  return wrap;
}

export function pluck(ac, freq, dur, gain = 0.16) {
  const t = ac.currentTime;
  const o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain();
  o.type = 'triangle'; o.frequency.value = freq;
  o2.type = 'sine'; o2.frequency.value = freq * 2;
  const g2 = ac.createGain(); g2.gain.value = 0.25;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.3, dur * 1.6));
  o.connect(g); o2.connect(g2).connect(g); g.connect(ac.destination);
  o.start(t); o2.start(t); o.stop(t + dur * 1.7 + 0.3); o2.stop(t + dur * 1.7 + 0.3);
}

function frame(embed, title) {
  const box = el('div', 'media__frame');
  if (embed.ratio) box.style.aspectRatio = String(embed.ratio); else box.style.height = embed.height + 'px';
  const f = el('iframe');
  Object.assign(f, { src: embed.url, title: title || 'Embedded media', loading: 'lazy', allowFullscreen: true, referrerPolicy: 'strict-origin-when-cross-origin' });
  f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups');
  f.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture; xr-spatial-tracking');
  box.append(f);
  return box;
}

// One media item as a figure. 3D viewers start lazily (they need WebGL).
export function renderMedia(m, palette) {
  const fig = el('figure', 'media media--' + m.kind);
  const embed = m.src && embedFor(m.src);
  if (m.kind === 'image') {
    const img = el('img');
    Object.assign(img, { src: m.src, alt: m.alt || m.caption || '', loading: 'lazy', decoding: 'async' });
    fig.append(img);
  } else if (embed) {
    fig.append(frame(embed, m.caption));
  } else if (m.kind === 'video') {
    const v = el('video');
    Object.assign(v, { src: m.src, controls: true, playsInline: true, preload: 'metadata' });
    fig.append(v);
  } else if (m.kind === 'audio') {
    const a = el('audio');
    Object.assign(a, { src: m.src, controls: true, preload: 'none' });
    fig.append(a);
  } else if (m.kind === 'sketch') {
    fig.append(sketchSvg(m.sketch, palette));
  } else if (m.kind === 'melody') {
    fig.append(melodyPlayer(m.melody, palette));
  } else if (m.kind === 'poem') {
    const verse = el('div', 'poem');
    for (const line of m.poem.lines) verse.append(el('p', null, line));
    fig.append(verse);
  } else if (m.kind === 'constellation') {
    fig.append(constellationSvg(m.constellation, palette));
  } else if (m.kind === 'splat') {
    fig.append(el('p', 'media__note', t('media.splatNote')));
  } else if (m.kind === 'model' || m.kind === 'sculpture') {
    const canvas = el('canvas', 'media__3d');
    fig.append(canvas);
    import('./viewer3d.js').then(({ MiniViewer }) => {
      new MiniViewer(canvas, m.kind === 'model' ? { url: m.src } : { build: m.build, palette });
    });
  }
  if (m.caption) fig.append(el('figcaption', 'mono', m.caption));
  return fig;
}

export function renderMediaList(list, palette) {
  const wrap = el('div', 'media-list');
  for (const m of list || []) wrap.append(renderMedia(m, palette));
  return wrap;
}
