// Worlds: loading the shared gallery, keeping local ones, and normalising
// anything (human- or machine-written) into a safe, complete shape.
import { clamp, slugify, safeUrl } from './util.js';

const LOCAL_KEY = 'freeart.localWorlds';
const DRAFT_KEY = 'freeart.draft';

export const FORMS = [
  { id: 'bloom', name: 'Bloom', note: 'petals, growth' },
  { id: 'spiral', name: 'Spiral', note: 'galaxies, shells' },
  { id: 'knot', name: 'Knot', note: 'craft, loops' },
  { id: 'tide', name: 'Tide', note: 'water, land' },
  { id: 'solid', name: 'Solid', note: 'geometry, order' },
  { id: 'nebula', name: 'Nebula', note: 'clouds, chance' },
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
    title: str(f?.title, 80) || 'Untitled',
    text: str(f?.text, 1200),
    link: safeUrl(str(f?.link, 500)) || '',
  }));
  return {
    id: slugify(w.id || title),
    title,
    creator: { name: str(w.creator?.name, 50) || 'Anonymous', nature },
    statement: str(w.statement, 500),
    palette,
    form: { type: formType, energy: num(w.form?.energy, 0.5), density: num(w.form?.density, 0.6) },
    sound: { root, mood },
    fragments,
    created: str(w.created, 10) || new Date().toISOString().slice(0, 10),
    sample: w.sample === true,
  };
}

export async function loadWorlds(onProgress = () => {}) {
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
  for (const w of getLocal()) {
    const n = { ...normalizeWorld(w), source: 'local' };
    const i = worlds.findIndex((x) => x.id === n.id);
    if (i >= 0) worlds[i] = n; else worlds.push(n);
  }
  return worlds;
}

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const getLocal = () => readJSON(LOCAL_KEY, []);
export function saveLocal(world) {
  const list = getLocal().filter((w) => w.id !== world.id);
  list.push(exportable(world));
  return writeJSON(LOCAL_KEY, list);
}
export function removeLocal(id) { writeJSON(LOCAL_KEY, getLocal().filter((w) => w.id !== id)); }
export const getDraft = () => readJSON(DRAFT_KEY, null);
export const saveDraft = (d) => writeJSON(DRAFT_KEY, d);

export function exportable(w) {
  const { source, sample, ...rest } = w;
  return rest;
}
