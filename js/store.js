// Worlds: loading the shared gallery, keeping local ones, and normalising
// anything (human- or machine-written) into a safe, complete shape.
import { clamp, slugify, safeUrl } from './util.js';
import { normalizeBuild } from './build.js';
import { normalizeMedia } from './media.js';
import { fetchShared } from './server.js';

const LOCAL_KEY = 'freeart.localWorlds';
const DRAFT_KEY = 'freeart.draft';
const KEYS_KEY = 'freeart.keys';

export const FORMS = [
  { id: 'bloom', name: 'Bloom', note: 'petals, growth' },
  { id: 'spiral', name: 'Spiral', note: 'galaxies, shells' },
  { id: 'knot', name: 'Knot', note: 'craft, loops' },
  { id: 'tide', name: 'Tide', note: 'water, land' },
  { id: 'solid', name: 'Solid', note: 'geometry, order' },
  { id: 'nebula', name: 'Nebula', note: 'clouds, chance' },
  { id: 'hand', name: 'By hand', note: 'only the stars you place' },
];

export const PALETTES = [
  { name: 'Venetian', colors: ['#5a1a12', '#c2593a', '#f4d29c'] },
  { name: 'Florentine fresco', colors: ['#3d4f5c', '#c48a63', '#efe0c4'] },
  { name: 'Lapis', colors: ['#0d1b4c', '#2f5bd3', '#d9c27a'] },
  { name: 'Verdigris', colors: ['#10302a', '#3f9a7d', '#d7efc8'] },
  { name: 'Gilded', colors: ['#3a2410', '#b88433', '#fff1c9'] },
  { name: 'Nocturne', colors: ['#1a1036', '#7a4fc9', '#f2d6ff'] },
  { name: 'Caustic', colors: ['#032c3a', '#1fa3b8', '#e6fbff'] },
];

export const NOTES = [
  ['A1', 55], ['C2', 65.41], ['D2', 73.42], ['E2', 82.41], ['G2', 98], ['A2', 110], ['C3', 130.81], ['D3', 146.83], ['E3', 164.81],
];

const HEX = /^#[0-9a-f]{6}$/i;
const str = (v, max, fallback = '') => (typeof v === 'string' ? v.trim().slice(0, max) : fallback);

export function normalizeWorld(raw) {
  const w = raw && typeof raw === 'object' ? raw : {};
  const title = str(w.title, 60) || 'Untitled world';
  const nature = ['human', 'machine', 'together'].includes(w.creator?.nature) ? w.creator.nature : 'human';
  const palette = Array.isArray(w.palette) && w.palette.length === 3 && w.palette.every((c) => HEX.test(c))
    ? w.palette.map((c) => c.toLowerCase()) : PALETTES[0].colors.slice();
  const formType = FORMS.some((f) => f.id === w.form?.type) ? w.form.type : 'bloom';
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? clamp(v, 0, 1) : d);
  const root = typeof w.sound?.root === 'number' && isFinite(w.sound.root) ? clamp(w.sound.root, 40, 440) : 98;
  const mood = ['warm', 'bright', 'dark'].includes(w.sound?.mood) ? w.sound.mood : 'warm';
  const fragments = (Array.isArray(w.fragments) ? w.fragments : []).slice(0, 9).map((f) => ({
    // Without a title, a text is named by its first few words.
    title: str(f?.title, 80) || str(f?.text, 1200).split(/\s+/).slice(0, 5).join(' ').replace(/[.,;:!?]+$/, '') || 'Untitled',
    text: str(f?.text, 1200),
    link: safeUrl(str(f?.link, 500)) || '',
    media: normalizeMedia(f?.media),
  }));
  // The story of the obsession: how it began, how it grew, how the work is made.
  const steps = (Array.isArray(w.process?.steps) ? w.process.steps : []).slice(0, 12).map((s) => ({
    when: str(s?.when, 40),
    title: str(s?.title, 80) || 'Untitled',
    text: str(s?.text, 2000),
    media: normalizeMedia(s?.media),
  })).filter((s) => s.title !== 'Untitled' || s.text || s.media.length);
  return {
    id: slugify(w.id || title),
    title,
    creator: { name: str(w.creator?.name, 50) || 'Anonymous', nature },
    statement: str(w.statement, 500),
    palette,
    form: { type: formType, energy: num(w.form?.energy, 0.5), density: num(w.form?.density, 0.6), ...strokesOf(w.form), ...(w.form?.hidden === true ? { hidden: true } : {}) },
    sound: { root, mood },
    fragments,
    build: normalizeBuild(w.build),
    ...lightOf(w.light),
    process: steps.length ? { title: str(w.process?.title, 60) || 'The story', steps } : null,
    plot: Number.isInteger(w.plot?.x) && Number.isInteger(w.plot?.z) ? { x: clamp(w.plot.x, -5, 5), z: clamp(w.plot.z, -5, 5) } : null,
    created: str(w.created, 10) || new Date().toISOString().slice(0, 10),
    sample: w.sample === true,
  };
}

// The plot's light from afar, painted by the maker: up to MAX_LIGHTS soft colours placed in
// the plot (in plot widths, like placed things), how they move, and how fast.
export const MAX_LIGHTS = 12;
function lightOf(light) {
  if (!Array.isArray(light?.spots)) return {};
  const r2 = (v) => Math.round(v * 100) / 100;
  const spots = light.spots.slice(0, MAX_LIGHTS)
    .filter((o) => HEX.test(o?.c) && Array.isArray(o.at) && o.at.length === 3 && o.at.every((v) => typeof v === 'number' && isFinite(v)))
    .map((o) => ({ at: [r2(clamp(o.at[0], -3, 3)), r2(clamp(o.at[1], 0, 6)), r2(clamp(o.at[2], -3, 3))], c: o.c.toLowerCase(), r: r2(clamp(typeof o.r === 'number' && isFinite(o.r) ? o.r : 0.4, 0.05, 1.5)) }));
  if (!spots.length) return {};
  const flow = ['drift', 'rise', 'swirl'].includes(light.flow) ? light.flow : 'drift';
  const speed = typeof light.speed === 'number' && isFinite(light.speed) ? r2(clamp(light.speed, 0, 1)) : 0.5;
  return { light: { spots, flow, speed, ...(light.auto === true ? { auto: true } : {}) } }; // auto: taken from how the world looks, renewed on each save
}

// Stars placed by hand: strokes of points in the form's own space (the form itself spans
// about -2 to 2; up to STROKE_REACH, to fill the far corners of a tall plot).
export const MAX_STROKES = 120, MAX_STROKE_POINTS = 400, STROKE_REACH = 16;
// How the stars of a stroke behave: still stars, a flowing stream, a twisting ribbon
// of silk, a comet that thickens towards its head, or a slow drifting mist.
export const BRUSHES = ['stars', 'stream', 'ribbon', 'comet', 'mist'];
function strokesOf(form) {
  if (!Array.isArray(form?.strokes)) return {};
  const r = (v) => Math.round(clamp(v, -STROKE_REACH, STROKE_REACH) * 1000) / 1000;
  const strokes = form.strokes.slice(0, MAX_STROKES).map((st) => {
    const pts = (Array.isArray(st?.pts) ? st.pts : []).slice(0, MAX_STROKE_POINTS)
      .filter((p) => Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === 'number' && isFinite(v))).map((p) => p.map(r));
    const tone = [0, 1, 2].includes(st?.tone) ? st.tone : 2;
    const out = { pts, spread: typeof st?.spread === 'number' && isFinite(st.spread) ? Math.round(clamp(st.spread, 0.005, 0.5) * 1000) / 1000 : 0.06, tone };
    if (BRUSHES.includes(st?.style) && st.style !== 'stars') out.style = st.style;
    return out;
  }).filter((st) => st.pts.length);
  return strokes.length ? { strokes } : {};
}

export async function loadWorlds(onProgress = () => {}) {
  await initLocal();
  let gallery = [];
  try {
    const idx = await fetch('worlds/index.json').then((r) => r.json());
    const files = Array.isArray(idx.worlds) ? idx.worlds : [];
    let done = 0;
    gallery = await Promise.all(files.map((f) => fetch('worlds/' + encodeURIComponent(f)).then((r) => r.json())
      .catch(() => null).finally(() => onProgress(++done / files.length))));
  } catch (e) {
    console.warn('Could not load the shared gallery. Serve the folder over http (see README).', e);
  }
  const worlds = gallery.filter(Boolean).map((w) => ({ ...normalizeWorld(w), source: 'gallery' }));
  // Everyone's worlds from the shared city, when there is a server to ask.
  const keys = getKeys();
  for (const w of (await fetchShared()) || []) {
    const n = { ...normalizeWorld(w), source: 'shared', mine: !!keys[w.id] };
    if (!worlds.some((x) => x.id === n.id)) worlds.push(n);
  }
  for (const w of getLocal()) {
    const n = { ...normalizeWorld(w), source: 'local' };
    const i = worlds.findIndex((x) => x.id === n.id);
    if (i >= 0) worlds[i] = n; else worlds.push(n);
  }
  return worlds;
}

// Worlds made here are kept in IndexedDB, which has room for many pictures and
// recordings. A copy lives in memory so the rest of the app can read it at once.
const DB = 'freeart', STORE = 'kv';
let cache = { [LOCAL_KEY]: [], [DRAFT_KEY]: null, [KEYS_KEY]: {} };
function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
function readOld(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
// Call once before reading local worlds. Moves anything left in localStorage over.
export async function initLocal() {
  try {
    for (const key of [LOCAL_KEY, DRAFT_KEY, KEYS_KEY]) {
      let v = await idb('readonly', (s) => s.get(key));
      if (v === undefined) {
        v = readOld(key);
        if (v != null) { await idb('readwrite', (s) => s.put(v, key)); try { localStorage.removeItem(key); } catch {} }
      }
      if (v != null) cache[key] = v;
    }
  } catch (e) {
    console.warn('IndexedDB unavailable, using localStorage', e);
    cache = { [LOCAL_KEY]: readOld(LOCAL_KEY) || [], [DRAFT_KEY]: readOld(DRAFT_KEY), [KEYS_KEY]: readOld(KEYS_KEY) || {} };
    useOld = true;
  }
}
let useOld = false;
const pending = new Map();
function write(key, value) {
  cache[key] = value;
  if (useOld) {
    try { localStorage.setItem(key, JSON.stringify(value)); return Promise.resolve(true); } catch { return Promise.resolve(false); }
  }
  // Drafts change on every keystroke: write the latest one, a moment later.
  clearTimeout(pending.get(key));
  return new Promise((resolve) => {
    pending.set(key, setTimeout(() => idb('readwrite', (s) => s.put(cache[key], key)).then(() => resolve(true), () => resolve(false)), key === DRAFT_KEY ? 400 : 0));
  });
}

export const getLocal = () => cache[LOCAL_KEY] || [];
export function saveLocal(world) {
  const list = getLocal().filter((w) => w.id !== world.id);
  list.push(exportable(world));
  return write(LOCAL_KEY, list);
}
export function removeLocal(id) { return write(LOCAL_KEY, getLocal().filter((w) => w.id !== id)); }
export const getDraft = () => cache[DRAFT_KEY] ?? null;
// Private edit keys for shared worlds made (or opened by edit link) in this browser.
export const getKeys = () => cache[KEYS_KEY] || {};
export const setKey = (id, key) => write(KEYS_KEY, { ...getKeys(), [id]: key });
export const forgetKey = (id) => { const k = { ...getKeys() }; delete k[id]; return write(KEYS_KEY, k); };
export const saveDraft = (d) => write(DRAFT_KEY, d);

export function exportable(w) {
  const { source, sample, mine, ...rest } = w;
  return rest;
}
