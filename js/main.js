// Free Art: routing between the threshold, the cosmos, a world, and the workshop.
import { Engine } from './engine.js';
import { Cosmos } from './cosmos.js';
import { WorldView } from './worldview.js';
import { Editor } from './editor.js';
import { Sound } from './audio.js';
import { createDust } from './form.js';
import { loadWorlds, saveLocal, removeLocal, getDraft } from './store.js';
import { roman, toast } from './util.js';

const $ = (id) => document.getElementById(id);
const NATURE = { human: 'Made by a human', machine: 'Made by a machine', together: 'Made by human and machine together' };

const engine = new Engine($('stage'));
window.freeart = { engine }; // handy for poking at the scene from the console
const sound = new Sound();
const labels = $('labels');
const dust = createDust();
engine.scene.add(dust);
engine.updaters.add((t) => { dust.userData.uniforms.uTime.value = t; dust.rotation.y = t * 0.004; });

let worlds = [];
let view = null; // 'cosmos' | 'world' | 'create'
let currentWorldId = null;

const cosmos = new Cosmos(engine, labels, (w) => { location.hash = '#/world/' + w.id; });
const worldView = new WorldView(engine, labels, { onFragment: showFragment });
Object.assign(window.freeart, { cosmos, worldView });
const editor = new Editor({
  onChange: (w) => worldView.setWorld(w),
  onRelease: (w) => {
    if (!saveLocal(w)) return toast('Your browser would not let us keep this world.');
    upsert({ ...w, source: 'local' });
    toast('Released into the cosmos.');
    location.hash = '#/world/' + w.id;
  },
  onDelete: (id) => {
    removeLocal(id);
    worlds = worlds.filter((w) => w.id !== id);
    cosmos.setWorlds(worlds);
    location.hash = '#/';
  },
});

function upsert(w) {
  const i = worlds.findIndex((x) => x.id === w.id);
  if (i >= 0) worlds[i] = w; else worlds.push(w);
  cosmos.setWorlds(worlds);
}

function showFragment(frag, i, world) {
  $('fr-index').textContent = `Fragment ${roman(i + 1)} of ${roman(world.fragments.length)}`;
  $('fr-title').textContent = frag.title;
  $('fr-text').textContent = frag.text;
  const link = $('fr-link');
  link.hidden = !frag.link;
  if (frag.link) link.href = frag.link;
  $('fragment').hidden = false;
  sound.chime(i);
}

function closeFragment() {
  $('fragment').hidden = true;
  worldView.closeFragment();
}
$('fragment-close').addEventListener('click', closeFragment);

function setHint(text) {
  $('hint').textContent = text || '';
  $('hint').hidden = !text;
}

function leave(next) {
  closeFragment();
  $('world-info').hidden = true;
  if (next !== 'create') editor.close();
  if (view === 'cosmos') cosmos.hide();
  if (view === 'world' || view === 'create') worldView.hide();
}

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const [page, id] = [parts[0] || '', decodeURIComponent(parts[1] || '')];
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('is-active', a.dataset.nav === (page || 'cosmos')));

  // The manifesto is an overlay; whatever scene is underneath keeps living.
  $('manifesto').hidden = page !== 'manifesto';
  document.body.classList.toggle('is-manifesto', page === 'manifesto');
  if (page === 'manifesto') {
    if (!view) showCosmos();
    setHint('');
    document.title = 'Manifesto · Free Art';
    return;
  }

  if (page === 'world') {
    const w = worlds.find((x) => x.id === id);
    if (!w) { location.hash = '#/'; return; }
    if (view === 'world' && currentWorldId === id) return;
    leave('world');
    view = 'world';
    currentWorldId = id;
    const i = worlds.indexOf(w);
    $('wi-numeral').textContent = 'World ' + roman(i + 1) + (w.sample ? ' · sample' : '');
    $('wi-nature').textContent = NATURE[w.creator.nature];
    $('wi-title').textContent = w.title;
    $('wi-creator').textContent = w.creator.name;
    $('wi-statement').textContent = w.statement;
    $('wi-edit').href = '#/create/' + encodeURIComponent(w.id);
    $('wi-edit').textContent = w.source === 'local' ? 'Continue shaping this world →' : 'Make a variation of this world →';
    $('world-info').hidden = false;
    worldView.show(w);
    sound.setWorld(w);
    setHint(w.fragments.length ? 'Drag to turn the world · choose a fragment to read' : 'Drag to turn the world');
    document.title = `${w.title} · Free Art`;
    return;
  }

  if (page === 'create') {
    leave('create');
    const from = id ? worlds.find((x) => x.id === id) : null;
    const editingId = from && from.source === 'local' ? from.id : null;
    const seed = from && !editingId ? { ...from, title: from.title + ' (variation)', id: undefined, sample: false } : from || getDraft();
    view = 'create';
    currentWorldId = null;
    const w = editor.open(seed, { editingId });
    worldView.show(w, { preview: true });
    sound.setWorld(w);
    setHint('');
    document.title = 'Shape a world · Free Art';
    return;
  }

  if (view !== 'cosmos') showCosmos();
  else setHint('Drag to wander · choose a world to step inside');
  document.title = 'Free Art';
}

function showCosmos() {
  const from = view === 'world' ? currentWorldId : null;
  leave('cosmos');
  view = 'cosmos';
  currentWorldId = null;
  cosmos.show({ fromWorld: from });
  sound.setWorld(null);
  setHint('Drag to wander · choose a world to step inside');
}

window.addEventListener('hashchange', route);
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || view === 'create') return;
  if (!$('fragment').hidden) closeFragment();
  else if (location.hash.length > 2) location.hash = '#/';
});

$('sound-toggle').addEventListener('click', () => {
  document.body.classList.toggle('sound-on', sound.toggle());
});

// Threshold
async function boot() {
  let shown = 0, target = 0;
  const pct = $('loader-pct');
  const timer = setInterval(() => {
    shown += (target - shown) * 0.2;
    pct.textContent = Math.round(shown);
  }, 40);
  worlds = await loadWorlds((p) => { target = p * 100; });
  target = 100;
  cosmos.setWorlds(worlds);
  engine.start();
  setTimeout(() => {
    clearInterval(timer);
    pct.parentElement.hidden = true;
    $('loader-enter').hidden = false;
  }, 500);
}

document.querySelectorAll('[data-enter]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.enter === 'sound') { sound.enable(); document.body.classList.add('sound-on'); }
  $('loader').classList.add('is-gone');
  $('chrome').hidden = false;
  route();
}));

boot().catch((e) => {
  console.error(e);
  $('loader-pct').textContent = 'Could not open the worlds: ' + e.message;
});
