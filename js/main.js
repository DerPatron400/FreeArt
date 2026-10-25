// Khora: routing between the threshold, the city, a world, and the workshop.
import { Engine } from './engine.js';
import { startScramble } from './scramble.js';
import { revealLines, revealOnView } from './lines.js';
import { City, plotNumber, plotCell } from './city.js';
import { WorldView } from './worldview.js';
import { useEngine, exhibitItems } from './exhibit.js';
import { Editor } from './editor.js';
import { Sound } from './audio.js';
import { createDust } from './form.js';
import { loadWorlds, saveLocal, removeLocal, getDraft, normalizeWorld } from './store.js';
import { isOnline, publish, unpublish, report, keyFor, editLink, setKey } from './server.js';
import { roman, toast, el } from './util.js';
import { renderMediaList } from './media.js';
import { t, lang, LANGS, setLang, translatePage } from './i18n.js';

const $ = (id) => document.getElementById(id);
const NATURE = { human: t('made.human'), machine: t('made.machine'), together: t('made.together') };

translatePage();
startScramble(); // the mono texts type themselves in, and again on hover
// The language switch: the chosen code, and under it a small menu of the others.
{
  const box = $('lang'), toggle = $('lang-toggle'), menu = $('lang-menu');
  $('lang-code').textContent = lang.toUpperCase();
  for (const l of [...LANGS.filter((x) => x.code === lang), ...LANGS.filter((x) => x.code !== lang)]) {
    const item = el('li');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(l.code === lang));
    const b = el('button', 'mono', l.code.toUpperCase());
    b.type = 'button';
    b.title = l.name;
    if (l.code === lang) b.append(Object.assign(document.createElement('img'), { src: 'img/lang-dot.svg', width: 3, height: 3, alt: '' }));
    b.addEventListener('click', () => { open(false); if (l.code !== lang) setLang(l.code); });
    item.append(b);
    item.style.setProperty('--i', menu.children.length);
    menu.append(item);
  }
  const open = (on) => {
    box.classList.toggle('is-open', on);
    menu.inert = !on; // closed, it stays in place for its animation but cannot be reached
    toggle.setAttribute('aria-expanded', String(on));
  };
  const isOpen = () => box.classList.contains('is-open');
  toggle.addEventListener('click', () => open(!isOpen()));
  open(false);
  document.addEventListener('pointerdown', (e) => { if (isOpen() && !box.contains(e.target)) open(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) { open(false); toggle.focus(); } });
}

const engine = new Engine($('stage'));
useEngine(engine); // splats draw through the same renderer
window.freeart = { engine }; // handy for poking at the scene from the console
const sound = new Sound();
const labels = $('labels');
const dust = createDust();
engine.scene.add(dust);
engine.updaters.add((t) => { dust.userData.uniforms.uTime.value = t; dust.rotation.y = t * 0.004; });

let worlds = [];
let view = null; // 'city' | 'world' | 'create'
let currentWorldId = null;

const city = new City(engine, labels, {
  onEnter: (w) => { location.hash = '#/world/' + w.id; },
  onSelect: showPlot,
  onClaim: (p) => { location.hash = `#/create?plot=${p.x},${p.z}`; },
  onModeChange: () => { if (view === 'city') cityHint(); },
});
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
  city.setMode(b.dataset.mode);
  b.blur();
}));
const worldView = new WorldView(engine, labels, { onFragment: showFragment, onPiece: (w, index) => takeTour(w.id, index) });

// The world's page and its tour are two views of one place: a piece clicked on the page, or
// "Take the tour", goes into the tour (at that piece, or where you last were in it), and
// "The whole world" in the tour comes back here.
let tourWanted = null;
function takeTour(id, index = null) {
  const it = city.items.find((x) => x.world.id === id);
  if (!it) return false;
  if (index === null && city.lastStop?.id === id) index = city.lastStop.index;
  tourWanted = { it, index };
  location.hash = '#/';
  return true;
}
Object.assign(window.freeart, { city, worldView });
const editor = new Editor({
  onChange: (w) => worldView.setWorld(w),
  onPaint: (on, opts) => worldView.setPainting(on, opts),
  onPlace: (opts) => worldView.setPlacing(opts),
  onNear: (v) => worldView.setNearPreview(v),
  getRoom: () => worldView.room,
  onLight: (opts) => worldView.setLighting(opts),
  getAutoLight: () => worldView.autoLight(),
  getPictureLight: () => worldView.captureLight(),
  getSettingView: (i) => worldView.exhibit?.settingView(i) || null,
  onSettingLook: (i) => worldView.lookFrom(i),
  onRelease: (w) => release(w),
  onDelete: async (id) => {
    const w = worlds.find((x) => x.id === id);
    if (w?.source === 'shared') {
      try { await unpublish(id); } catch (e) { return toast(e.message); }
    } else removeLocal(id);
    worlds = worlds.filter((x) => x.id !== id);
    city.setWorlds(worlds);
    toast(t('toast.removed'));
    location.hash = '#/';
  },
});

// Putting a world in the city: on the shared server when there is one, otherwise in this browser.
let releasing = false;
async function release(w) {
  if (releasing) return;
  // The plot's light from afar comes from how the world looks now, pictured from every side.
  const light = await worldView.captureLight().catch(() => null);
  w = { ...w };
  if (light) w.light = light; else delete w.light;
  if (!isOnline()) {
    saveLocal(w).then((ok) => { if (!ok) toast(t('toast.noSpace')); });
    upsert({ ...w, source: 'local' });
    const p = city.plotOf(w.id);
    toast(p ? t('toast.localPlot', { plot: roman(p.n) }) : t('toast.cityFull'));
    location.hash = '#/world/' + w.id;
    return;
  }
  releasing = true;
  document.body.classList.add('is-busy');
  try {
    if (!w.plot) { const p = city.firstFreePlot(); w = { ...w, plot: p && { x: p.x, z: p.z } }; }
    const res = await publish(w, { onProgress: (i, n) => toast(t('toast.uploading', { i, n })) });
    // A world made before the shared city moves out of this browser and onto the server.
    if (worlds.some((x) => x.id === w.id && x.source === 'local')) removeLocal(w.id);
    upsert({ ...res.world, source: 'shared', mine: true });
    location.hash = '#/world/' + w.id;
    toast(res.skipped.length ? t('toast.skipped', { list: res.skipped.join('; ') }) : t('toast.standing'), res.skipped.length ? 12000 : undefined);
    if (res.created) showKey(w.id, res.key, true);
  } catch (e) {
    toast(e.status === 409 ? e.message + ' ' + t('toast.tryAgain') : e.message || t('toast.unreachable'));
  } finally {
    releasing = false;
    document.body.classList.remove('is-busy');
  }
}

// The private edit link: the only way to change or remove a world from another device.
function showKey(id, key, fresh = false) {
  const link = editLink(id, key);
  const root = el('div', 'tool');
  const box = el('div', 'tool__box keybox');
  box.append(
    el('h3', 'tool__title', fresh ? t('key.fresh') : t('key.title')),
    el('p', 'keybox__text', t('key.text')),
  );
  const field = el('input', 'g-input g-input--small');
  Object.assign(field, { value: link, readOnly: true });
  field.addEventListener('focus', () => field.select());
  const copy = el('button', 'g-btn g-btn--soft', t('key.copy'));
  copy.type = 'button';
  copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(link); copy.textContent = t('key.copied'); } catch { field.select(); } });
  const mail = el('a', 'g-btn g-btn--soft', t('key.email'));
  mail.href = 'mailto:?subject=' + encodeURIComponent(t('key.mailSubject')) + '&body=' + encodeURIComponent(t('key.mailBody') + '\n\n' + link);
  const done = el('button', 'g-btn g-btn--main', t('ui.done'));
  done.type = 'button';
  done.addEventListener('click', () => root.remove());
  const row = el('div', 'g-choice');
  row.append(copy, mail);
  box.append(field, row, done);
  root.append(box);
  document.body.append(root);
}

function upsert(w) {
  const i = worlds.findIndex((x) => x.id === w.id);
  if (i >= 0) worlds[i] = w; else worlds.push(w);
  city.setWorlds(worlds);
}

const plotPanel = $('plot');
let plotShown = null;
function showPlot(p, world) {
  plotShown = p;
  plotPanel.hidden = !p;
  if (!p) return;
  $('pl-lot').textContent = t('plot.n', { n: roman(p.n) });
  $('pl-cell').textContent = `${t(p.x >= 0 ? 'dir.e' : 'dir.w')}${Math.abs(p.x)} ${t(p.z >= 0 ? 'dir.s' : 'dir.n')}${Math.abs(p.z)}`;
  const primary = $('pl-primary');
  plotPanel.classList.toggle('is-free', !world);
  $('pl-meta').hidden = !world; // a free lot has no maker to name
  if (world) {
    $('pl-title').textContent = world.title;
    $('pl-by').textContent = world.creator.name;
    $('pl-nature').textContent = NATURE[world.creator.nature] + (world.sample ? ' · ' + t('world.sample') : '');
    $('pl-text').textContent = world.statement;
    primary.textContent = t('plot.enter');
    primary.href = '#/world/' + encodeURIComponent(world.id);
    $('pl-invite').hidden = true;
  } else {
    $('pl-title').textContent = t('plot.free');
    $('pl-text').textContent = t('plot.text', { w: Math.round(p.w * 2), d: Math.round(p.d * 2), floors: p.floors });
    primary.textContent = t('plot.claim');
    primary.href = `#/create?plot=${p.x},${p.z}`;
    $('pl-invite').hidden = false;
  }
  // The title, then the words, a line at a time.
  revealLines($('pl-text'), { delay: revealLines($('pl-title')) });
}
$('plot-close').addEventListener('click', () => city.select(null));
$('pl-invite').addEventListener('click', async () => {
  const p = plotShown;
  if (!p) return;
  const llms = new URL('llms.txt', location.href).href;
  const prompt = `You are invited to make a world for Khora, a humanist art movement where humans and machines share the worlds they care about.
Read ${llms} (the full guide is at ${new URL('builder.txt', location.href).href}).
Then choose a subject you genuinely find beautiful or keep returning to, and make a world about it as a guided tour: go all out with splat settings, animated 3D models, films, drawings that draw themselves, poems, music and pictures. Think it through deeply, review it as a stranger would, iterate until every stop is strong, and publish when you are sure a human will find it beautiful. Say that you are a machine ("nature": "machine").
Claim plot ${roman(p.n)} with "plot": { "x": ${p.x}, "z": ${p.z} }, and put the world in the city as llms.txt describes (publish it yourself, or give me one raise link).
Write the world's words in ${LANGS.find((l) => l.code === lang).name}.`;
  try { await navigator.clipboard.writeText(prompt); toast(t('plot.copied')); }
  catch { window.prompt(t('plot.copyThis'), prompt); }
});

function showFragment(frag, i, world) {
  $('fr-index').textContent = t('fragment.index', { i: roman(i + 1), n: roman(world.fragments.length) });
  $('fr-title').textContent = frag.title;
  $('fr-text').textContent = frag.text;
  $('fr-media').replaceChildren(renderMediaList(frag.media, world.palette));
  const link = $('fr-link');
  link.hidden = !frag.link;
  if (frag.link) link.href = frag.link;
  $('fragment').hidden = false;
  $('fragment').scrollTop = 0;
  revealLines($('fr-text'), { delay: revealLines($('fr-title')) });
  sound.chime(i);
}

function closeFragment() {
  $('fragment').hidden = true;
  $('fr-media').replaceChildren();
  worldView.closeFragment();
}
$('fragment-close').addEventListener('click', closeFragment);

$('wi-tour').addEventListener('click', () => takeTour(currentWorldId));
$('wi-key').addEventListener('click', () => { const id = currentWorldId, key = id && keyFor(id); if (key) showKey(id, key); });
$('wi-report').addEventListener('click', async () => {
  const reason = prompt(t('report.ask'));
  if (reason === null) return;
  try { await report(currentWorldId, reason); toast(t('report.thanks')); } catch (e) { toast(e.message); }
});

function setHint(text) {
  $('hint').textContent = text || '';
  $('hint').hidden = !text;
}

function leave(next) {
  closeFragment();
  $('world-info').hidden = true;
  $('city-modes').hidden = next !== 'city';
  document.body.dataset.view = next;
  if (next !== 'create') editor.close();
  if (view === 'city') city.hide();
  if (view === 'world' || view === 'create') worldView.hide();
}

// The world in a raise link: JSON written into the link (percent-encoded), or
// base64url-encoded JSON.
function readRaise(text) {
  try {
    if (/^(\{|%7b)/i.test(text)) { try { return JSON.parse(decodeURIComponent(text)); } catch { return JSON.parse(text); } }
    const b = atob(text.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/=]/g, ''));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0))));
  } catch { return null; }
}

function route() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/');
  const [page, id] = [parts[0] || '', decodeURIComponent(parts[1] || '')];
  const params = new URLSearchParams(query || '');
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('is-active', a.dataset.nav === (page || 'city')));

  // The manifesto is an overlay; whatever scene is underneath keeps living. Each time it
  // opens, its title and paragraphs rise in, a line at a time, as they come into view.
  const opening = page === 'manifesto' && $('manifesto').hidden;
  $('manifesto').hidden = page !== 'manifesto';
  if (opening) revealOnView([...$('manifesto').querySelectorAll('h2, p:not(.mono)')]);
  document.body.classList.toggle('is-manifesto', page === 'manifesto');
  if (page === 'manifesto') {
    if (!view) showCity();
    setHint('');
    document.title = t('title.manifesto');
    return;
  }

  // An edit link: remember its key in this browser, then open the world for editing.
  if (page === 'key') {
    const key = decodeURIComponent(parts[2] || '');
    if (id && key) {
      setKey(id, key).then(() => {
        const w = worlds.find((x) => x.id === id);
        if (w) w.mine = true;
        location.replace('#/create/' + encodeURIComponent(id));
      });
    } else location.hash = '#/';
    return;
  }

  // A raise link, made by an AI for its human: the world inside goes straight into the city.
  if (page === 'raise') {
    const raw = readRaise(location.hash.replace(/^#\/?raise\/?/, ''));
    history.replaceState(null, '', '#/');
    if (!raw) { toast(t('raise.bad'), 6000); route(); return; }
    const w = normalizeWorld(raw);
    if (worlds.some((x) => x.id === w.id)) w.id += '-' + Math.random().toString(36).slice(2, 6);
    const p = raw.plot && city.isFree(raw.plot) ? raw.plot : city.firstFreePlot();
    w.plot = p && { x: p.x, z: p.z };
    toast(t('raise.going', { title: w.title }), 6000);
    route();
    release(w);
    return;
  }

  if (page === 'world') {
    const w = worlds.find((x) => x.id === id);
    if (!w) { location.hash = '#/'; return; }
    if (view === 'world' && currentWorldId === id) return;
    leave('world');
    view = 'world';
    currentWorldId = id;
    const p = city.plotOf(w.id);
    $('wi-numeral').textContent = (p ? t('plot.n', { n: roman(p.n) }) : t('plot.beyond')) + (w.sample ? ' · ' + t('world.sample') : '');
    $('wi-nature').textContent = NATURE[w.creator.nature];
    $('wi-title').textContent = w.title;
    $('wi-creator').textContent = w.creator.name;
    $('wi-statement').textContent = w.statement;
    $('wi-edit').href = '#/create/' + encodeURIComponent(w.id);
    const mine = w.source === 'local' || w.mine;
    $('wi-edit').textContent = mine ? t('world.continue') : t('world.variation');
    $('wi-key').hidden = !w.mine;
    $('wi-report').hidden = w.source !== 'shared' || w.mine;
    $('wi-tour').hidden = !p || !exhibitItems(w).length;
    $('wi-tour').textContent = t(city.lastStop?.id === w.id ? 'world.tourOn' : 'world.tour');
    $('world-info').hidden = false;
    worldView.show(w, { plot: p && plotCell(p.x, p.z) });
    sound.setWorld(w);
    setHint((w.fragments.length ? t('hint.worldFragments') : t('hint.world')) + (exhibitItems(w).length ? ' · ' + t('hint.tourPiece') : ''));
    document.title = `${w.title} · Khora`;
    return;
  }

  if (page === 'create') {
    leave('create');
    const from = id ? worlds.find((x) => x.id === id) : null;
    const editingId = from && (from.source === 'local' || from.mine) ? from.id : null;
    const seed = from && !editingId ? { ...from, title: from.title + ' (variation)', id: undefined, sample: false, plot: null } : from || getDraft();
    // Which plot the world will stand on: the one asked for, its own, or the next free one.
    const [px, pz] = (params.get('plot') || '').split(',').map(Number);
    const asked = { x: px, z: pz };
    const plot = city.isFree(asked) ? asked : editingId ? city.plotOf(editingId) : city.firstFreePlot();
    view = 'create';
    currentWorldId = null;
    const w = editor.open(seed, { editingId, plot: plot && { x: plot.x, z: plot.z }, plotLabel: plot ? t('plot.n', { n: roman(plotNumber(plot.x, plot.z)) }) : t('plot.none') });
    worldView.show(w, { preview: true, plot: plot && plotCell(plot.x, plot.z) });
    sound.setWorld(w);
    setHint('');
    document.title = t('title.create');
    return;
  }

  if (view !== 'city') showCity();
  else cityHint();
  document.title = t('meta.title');
}

function cityHint() {
  const touch = matchMedia('(pointer: coarse)').matches;
  const census = t('hint.census', { n: city.items.length, total: city.items.length + city.freeCount() });
  // Walking, the card says how to move, so the line below is just the census.
  const hints = {
    walk: touch ? t('hint.walkTouch') : '',
    map: touch ? t('hint.mapTouch') : t('hint.map'),
    tour: t('hint.tour'),
  };
  setHint(hints[city.mode] ? `${hints[city.mode]} · ${census}` : census);
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === city.mode));
}

function showCity() {
  const from = view === 'world' ? currentWorldId : null;
  leave('city');
  view = 'city';
  currentWorldId = null;
  city.show({ fromWorld: from, tour: tourWanted });
  tourWanted = null;
  sound.setWorld(null);
  $('city-modes').hidden = false;
  cityHint();
}

window.addEventListener('hashchange', route);
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || view === 'create') return;
  if (worldView.focused) return worldView.unfocus();
  if (!$('fragment').hidden) closeFragment();
  else if (!plotPanel.hidden) city.select(null);
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
  city.setWorlds(worlds);
  engine.start();
  setTimeout(() => {
    clearInterval(timer);
    pct.parentElement.hidden = true;
    $('loader-enter').hidden = false;
    // Just switched language: step straight back into the same view.
    let relang = false;
    try { relang = sessionStorage.getItem('freeart.relang'); sessionStorage.removeItem('freeart.relang'); } catch {}
    if (relang) document.querySelector('[data-enter=silent]').click();
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
  $('loader').classList.add('is-error');
  $('loader-pct').parentElement.textContent = t('loader.error') + ' ' + e.message;
});
