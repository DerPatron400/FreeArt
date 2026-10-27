// The studio, as the design has it: the world fills the screen; on the left the
// world's story, its background and the shelf of things to add; on the right the
// settings of the piece in hand; along the bottom the timeline, which is the tour.
// It edits the same world as the full workshop, so anyone can switch at any moment.
import { el, toast } from './util.js';
import { t as tr } from './i18n.js';
import { MAX_MEDIA, SHOWABLE, MOTIONS, NEAR, sketchSvg, melodyPlayer } from './media.js';
import { exhibitItems } from './exhibit.js';
import { sketchPad, melodyGrid } from './tools.js';
import { imageToData } from './editor.js';
import { FORMS, MAX_STROKES, BRUSHES, STROKE_REACH, MAX_LIGHTS, saveDraft, exportable, normalizeWorld } from './store.js';
import { fillStrokes } from './fill.js';
import { isOnline, space } from './server.js';
import { ICONS, KIND_ICON, ring } from './icons.js';

// Each feeling sets colours, form, movement and sound together.
export const FEELINGS = [
  { id: 'calm', name: 'Calm', palette: ['#0d2a3a', '#3f8fa8', '#dff4f7'], form: { type: 'tide', energy: 0.28, density: 0.62 }, sound: { root: 82.41, mood: 'warm' } },
  { id: 'warm', name: 'Warm', palette: ['#4a1f10', '#c46a32', '#f6d9a8'], form: { type: 'bloom', energy: 0.42, density: 0.66 }, sound: { root: 98, mood: 'warm' } },
  { id: 'growing', name: 'Growing', palette: ['#14301f', '#5d9a55', '#e3f0c8'], form: { type: 'bloom', energy: 0.22, density: 0.72 }, sound: { root: 73.42, mood: 'warm' } },
  { id: 'bright', name: 'Bright', palette: ['#3a2410', '#d9a03c', '#fff4cf'], form: { type: 'spiral', energy: 0.72, density: 0.6 }, sound: { root: 130.81, mood: 'bright' } },
  { id: 'precise', name: 'Precise', palette: ['#2a2420', '#a88a5c', '#f1e6d0'], form: { type: 'solid', energy: 0.5, density: 0.55 }, sound: { root: 110, mood: 'bright' } },
  { id: 'deep', name: 'Night', palette: ['#120c2e', '#6a4fc0', '#ecdcff'], form: { type: 'nebula', energy: 0.38, density: 0.7 }, sound: { root: 65.41, mood: 'dark' } },
];

const SHOW_FIRST = 16; // the first things added stand in the plot (and on the tour) on their own
const AUDIO_MAX = 8e6, VIDEO_MAX = 40e6, MODEL_MAX = 25e6, SPLAT_MAX = 30e6; // bytes, for files from the device (the server's limits)

// The shelf, in the design's order: what each tile adds, and its icon.
const SHELF = [['text', 'text'], ['draw', 'draw'], ['picture', 'picture'], ['video', 'video'], ['3d', 'd3'], ['sound', 'sound']];

// A copy of a world for the history: objects and lists are new, the text inside (pictures
// and sounds are long text) is shared, so keeping many steps back costs little.
function snapshot(v) {
  if (Array.isArray(v)) return v.map(snapshot);
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = snapshot(v[k]); return o; }
  return v;
}
const HISTORY = 60;

function button(text, cls = 'g-btn') {
  const b = el('button', cls, text);
  b.type = 'button';
  return b;
}

function iconButton(icon, label, cls = 'st-icon') {
  const b = button('', cls);
  b.innerHTML = ICONS[icon];
  b.setAttribute('aria-label', label);
  b.title = label;
  return b;
}

const round = (v) => Math.round(v * 1000) / 1000;

function fileToData(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// A file as a data URL with the type the server expects (splats have no registered one).
async function fileAs(file, type) {
  const data = await fileToData(file);
  return 'data:' + type + data.slice(data.indexOf(';base64,'));
}

// FBX is turned into .glb right here, so the city only ever loads one kind of model.
// Textures packed inside the FBX come along; animations are kept.
async function fbxToGlb(file) {
  const [{ FBXLoader }, { GLTFExporter }] = await Promise.all([
    import('three/addons/loaders/FBXLoader.js'), import('three/addons/exporters/GLTFExporter.js')]);
  const obj = new FBXLoader().parse(await file.arrayBuffer(), '');
  // Embedded pictures decode in the background; wait for them (briefly) before packing.
  const maps = [];
  obj.traverse((o) => { for (const m of [].concat(o.material || [])) for (const v of Object.values(m)) if (v?.isTexture) maps.push(v); });
  for (let i = 0; i < 40 && maps.some((t) => !t.image || t.image.complete === false); i++) await new Promise((r) => setTimeout(r, 100));
  for (const t of maps) if (!t.image || t.image.complete === false || t.image.naturalWidth === 0) for (const k in t) if (k === 'image') t.image = null;
  obj.traverse((o) => { for (const m of [].concat(o.material || [])) for (const [k, v] of Object.entries(m)) if (v?.isTexture && !v.image) m[k] = null; });
  const glb = await new GLTFExporter().parseAsync(obj, { binary: true, animations: obj.animations || [], maxTextureSize: 2048 });
  return new File([glb], file.name.replace(/\.fbx$/i, '.glb'), { type: 'model/gltf-binary' });
}

// A 3D file from the device as a piece: models as .glb, splats packed into .spz (often ten
// times smaller). Resolves to { kind, src } or null (and says why).
async function objectFile(f) {
  const ext = (f.name.match(/\.(\w+)$/) || [])[1]?.toLowerCase();
  if (ext === 'glb' || ext === 'gltf' || ext === 'fbx') {
    if (ext === 'fbx') {
      toast(tr('g.packing', { name: f.name }), 8000);
      try { f = await fbxToGlb(f); } catch { toast(tr('g.badObject', { name: f.name })); return null; }
    }
    if (f.size > MODEL_MAX) { toast(tr('g.objectLarge', { name: f.name, mb: MODEL_MAX / 1e6 })); return null; }
    return { kind: 'model', src: await fileAs(f, 'model/gltf-binary') };
  }
  let file = f;
  if (ext !== 'spz' && ext !== 'sog') {
    toast(tr('g.packing', { name: f.name }), 8000);
    try {
      const { transcodeSpz } = await import('@sparkjsdev/spark');
      const { fileBytes } = await transcodeSpz({ inputs: [{ fileBytes: new Uint8Array(await f.arrayBuffer()), pathOrUrl: f.name }] });
      file = new File([fileBytes], f.name.replace(/\.\w+$/, '.spz'));
    } catch { toast(tr('g.badObject', { name: f.name })); return null; }
  }
  if (file.size > SPLAT_MAX) { toast(tr('g.objectLarge', { name: f.name, mb: SPLAT_MAX / 1e6 })); return null; }
  return { kind: 'splat', src: await fileAs(file, 'application/x-' + (file.name.endsWith('.sog') ? 'sog' : 'spz')) };
}

// A link to a world on dndai.app becomes the link to its splat (the 500k version:
// detailed, and light enough for the city).
function objectLink(src) {
  const w = src.match(/^https:\/\/(?:www\.)?dndai\.app\/worlds\/([a-z0-9]+)/i);
  return w ? `https://dzjg7lvewk7ln.cloudfront.net/worlds/${w[1]}/splats_500k.spz` : src;
}

function pickFiles(accept, multiple = false) {
  return new Promise((resolve) => {
    const input = el('input');
    Object.assign(input, { type: 'file', accept, multiple });
    input.addEventListener('change', () => resolve([...input.files]));
    input.click();
  });
}

// Record a voice or a sound with the microphone. Resolves to a data URL, or null.
function recordSound() {
  return new Promise((resolve) => {
    const root = el('div', 'tool');
    const box = el('div', 'tool__box g-rec');
    const status = el('p', 'g-rec__status', tr('g.ready'));
    const go = button(tr('g.startRec'), 'g-btn g-btn--main');
    const cancel = button(tr('ui.cancel'), 'g-btn g-btn--soft');
    box.append(el('h3', 'tool__title', tr('g.recordTitle')), status, el('div', 'guide__nav', null));
    box.lastChild.append(cancel, go);
    root.append(box);
    document.body.append(root);
    let rec = null, stream = null, chunks = [], t0 = 0, timer = null;
    const close = (v) => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); root.remove(); resolve(v); };
    cancel.addEventListener('click', () => { if (rec?.state === 'recording') { rec.onstop = null; rec.stop(); } close(null); });
    go.addEventListener('click', async () => {
      if (rec?.state === 'recording') { rec.stop(); return; }
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { toast(tr('g.noMic')); return close(null); }
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'].find((t) => window.MediaRecorder?.isTypeSupported?.(t));
      rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 48000 } : undefined);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => close(await fileToData(new Blob(chunks, { type: rec.mimeType })));
      rec.start();
      t0 = Date.now();
      go.textContent = tr('g.stop');
      timer = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); status.textContent = tr('g.recording', { time: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }); if (s >= 600) rec.stop(); }, 250);
    });
  });
}

// ---- small parts of the panels, as the design draws them ----

// A card: a title, a quiet line under it, then its content.
function card(title, help, cls = '') {
  const c = el('section', 'st-card' + (cls ? ' ' + cls : ''));
  const head = el('div', 'st-card__head');
  head.append(el('h3', 'st-card__title', title));
  if (help) head.append(el('p', 'st-card__help', help));
  c.append(head);
  return c;
}

// A labelled field: the small mono label above, the control below.
function field(label, control) {
  const f = el('label', 'st-field');
  f.append(el('span', 'st-label', label), control);
  return f;
}

function input(value, placeholder, onInput, max = 200) {
  const x = el('input', 'st-input');
  Object.assign(x, { value: value || '', placeholder, maxLength: max });
  x.addEventListener('input', () => onInput(x.value));
  return x;
}

function textarea(value, placeholder, onInput, max = 500, rows = 4) {
  const x = el('textarea', 'st-input st-input--area');
  Object.assign(x, { value: value || '', placeholder, maxLength: max, rows });
  x.addEventListener('input', () => onInput(x.value));
  return x;
}

// A slider drawn as a thin line with a dot, in the design's manner.
function slider(label, min, max, step, value, onInput, onChange = onInput) {
  const f = el('label', 'st-field');
  const r = el('input', 'st-range');
  Object.assign(r, { type: 'range', min, max, step, value });
  const fillIt = () => r.style.setProperty('--k', ((+r.value - min) / (max - min)) * 100 + '%');
  fillIt();
  r.addEventListener('input', () => { fillIt(); onInput(+r.value); });
  r.addEventListener('change', () => onChange(+r.value));
  f.append(el('span', 'st-label', label), r);
  f.set = (v) => { if (document.activeElement !== r) { r.value = v; fillIt(); } };
  return f;
}

// Chips: one of several, the chosen one light.
function chips(items, current, onPick, cls = 'st-chips') {
  const row = el('div', cls);
  for (const [id, label] of items) {
    const b = button(label, 'st-chip' + (current === id ? ' is-on' : ''));
    b.dataset.id = id;
    b.addEventListener('click', () => { onPick(id); row.querySelectorAll('.st-chip').forEach((x) => x.classList.toggle('is-on', x === b)); });
    row.append(b);
  }
  row.set = (id) => row.querySelectorAll('.st-chip').forEach((x) => x.classList.toggle('is-on', x.dataset.id === id));
  return row;
}

// A place to drop a file, or to tap to choose one.
function dropzone(accept, formats, onFiles, multiple = false) {
  const z = button('', 'st-drop');
  const line = el('span', 'st-drop__line');
  line.append(tr('st.drop') + ' ', el('u', null, tr('st.upload')));
  z.append(line, el('span', 'st-drop__formats', formats));
  z.addEventListener('click', async () => { const files = await pickFiles(accept, multiple); if (files.length) onFiles(files); });
  z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('is-over'); });
  z.addEventListener('dragleave', () => z.classList.remove('is-over'));
  z.addEventListener('drop', (e) => { e.preventDefault(); z.classList.remove('is-over'); const files = [...e.dataTransfer.files]; if (files.length) onFiles(files); });
  return z;
}

// ---- a colour picker: saturation and brightness in a square, hue below, HSB in numbers ----

function hexToHsb(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(((h * 60) + 360) % 360), Math.round(max ? (d / max) * 100 : 0), Math.round(max * 100)];
}
function hsbToHex(h, s, v) {
  s /= 100; v /= 100;
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

function colourPicker(hex, onInput) {
  const box = el('div', 'st-picker');
  const sq = el('div', 'st-picker__sq');
  const knob = el('i', 'st-picker__knob');
  sq.append(knob);
  const hue = el('input', 'st-picker__hue');
  Object.assign(hue, { type: 'range', min: 0, max: 359, step: 1 });
  hue.setAttribute('aria-label', 'H');
  const row = el('div', 'st-picker__row');
  const mode = el('span', 'st-picker__mode');
  mode.innerHTML = 'HSB ' + ICONS.chevron;
  const nums = ['H', 'S', 'B'].map((k, i) => {
    const n = el('input', 'st-picker__num');
    Object.assign(n, { type: 'number', min: 0, max: i ? 100 : 359 });
    n.setAttribute('aria-label', k);
    return n;
  });
  row.append(mode, ...nums);
  box.append(sq, hue, row);
  let [h, s, v] = hexToHsb(hex);
  const draw = (emit) => {
    sq.style.setProperty('--hue', `hsl(${h} 100% 50%)`);
    knob.style.left = s + '%';
    knob.style.top = 100 - v + '%';
    knob.style.background = hsbToHex(h, s, v);
    hue.value = h;
    nums.forEach((n, i) => { if (document.activeElement !== n) n.value = [h, s, v][i]; });
    if (emit) onInput(hsbToHex(h, s, v));
  };
  const at = (e) => {
    const r = sq.getBoundingClientRect();
    s = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 100);
    v = Math.round((1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))) * 100);
    draw(true);
  };
  sq.addEventListener('pointerdown', (e) => {
    sq.setPointerCapture(e.pointerId);
    at(e);
    const move = (ev) => at(ev);
    const up = () => { sq.removeEventListener('pointermove', move); sq.removeEventListener('pointerup', up); };
    sq.addEventListener('pointermove', move);
    sq.addEventListener('pointerup', up);
  });
  hue.addEventListener('input', () => { h = +hue.value; draw(true); });
  nums.forEach((n, i) => n.addEventListener('change', () => {
    const val = Math.max(0, Math.min(i ? 100 : 359, Math.round(+n.value || 0)));
    if (i === 0) h = val; else if (i === 1) s = val; else v = val;
    draw(true);
  }));
  box.set = (x) => { [h, s, v] = hexToHsb(x); draw(false); };
  draw(false);
  return box;
}

export class Guide {
  constructor(root, { onChange, onRelease, onWorkshop, onPaint, onDelete, onImport, onPlace = () => {}, onNear = () => {}, getRoom = () => null, onLight = () => {}, getAutoLight = () => [], getPictureLight = async () => null, getSettingView = () => null, onSettingLook = () => {} }) {
    this.getSettingView = getSettingView;
    this.onSettingLook = onSettingLook;
    this.onLight = onLight;
    this.getAutoLight = getAutoLight;
    this.getPictureLight = getPictureLight;
    this.onPlace = onPlace;
    this.onNear = onNear;
    // A piece's glow made for the first time: keep it with the world,
    // so every visitor sees it at once from afar.
    window.addEventListener('freeart:glow', (e) => {
      if (!this.root.isConnected || !this.w) return;
      let got = false;
      for (const m of [...(this.w.process?.steps || []).flatMap((st) => st.media || []), ...this.w.fragments.flatMap((f) => f.media || [])]) {
        if (m.src === e.detail.src && !m.glow) { m.glow = e.detail.glow; got = true; }
      }
      if (got) this.changed();
    });
    // A model or splat that cannot be drawn here (an old browser, a blocked link) is named, not hidden.
    window.addEventListener('freeart:piecefail', (e) => { if (!this.root.hidden) toast(tr('g.pieceFail', { why: e.detail.slice(0, 120) }), 9000); });
    this.getRoom = getRoom;
    this.onDelete = onDelete;
    this.onImport = onImport;
    this.onChange = onChange;
    this.onRelease = onRelease;
    this.onWorkshop = onWorkshop;
    this.onPaint = onPaint;
    this.syncs = new Map(); // panel → functions that bring its controls up to date
    this.brush = { tone: 2, spread: 0.06, style: 'stream' };
    this.tab = 'story';
    this.sel = -1; // the piece in hand: its place in the list of things
    this.root = el('div', 'guide');
    this.root.hidden = true;
    root.prepend(this.root);
    // Undo and redo, with the usual keys (inside a text field the field's own undo comes first).
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox') return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); this.redo(); }
    });
    // A tap outside the colour picker closes it.
    document.addEventListener('pointerdown', (e) => {
      if (this.pickerEl && !this.pickerEl.contains(e.target) && !e.target.closest?.('.st-swatch, .st-pick-own')) this.closePicker();
    });
  }

  // ---- undo ----

  // Every change is remembered once things settle (a word typed, a piece dragged): the
  // state before it goes into the past, so one Undo takes back one whole action.
  remember() {
    clearTimeout(this.settle);
    this.settle = setTimeout(() => this.commit(), 450);
  }

  commit() {
    clearTimeout(this.settle);
    this.settle = null;
    const now = snapshot(this.w);
    if (JSON.stringify(now) === this.lastText) return;
    if (this.last) { this.past.push(this.last); if (this.past.length > HISTORY) this.past.shift(); }
    this.last = now;
    this.lastText = JSON.stringify(now);
    this.future = [];
    this.syncUndo();
  }

  undo() {
    if (this.settle) this.commit();
    if (!this.past.length) return;
    this.future.push(this.last);
    this.restore(this.past.pop());
  }

  redo() {
    if (this.settle) this.commit();
    if (!this.future.length) return;
    this.past.push(this.last);
    this.restore(this.future.pop());
  }

  restore(state) {
    this.last = state;
    this.lastText = JSON.stringify(state);
    this.w = snapshot(state);
    this.stopPlace();
    if (this.sel >= this.things().length) this.sel = -1;
    this.onChange(this.w);
    this.render();
    this.syncUndo();
  }

  syncUndo() {
    if (!this.undoBtn) return;
    this.undoBtn.disabled = !this.past.length && !this.settle;
    this.redoBtn.disabled = !this.future.length;
  }

  load(world, plotLabel, { editing = false } = {}) {
    this.placing = null;
    this.onPlace(null);
    this.w = structuredClone(world);
    this.plotLabel = plotLabel;
    this.editing = editing;
    this.past = []; this.future = [];
    this.sel = -1;
    this.tab = 'story';
    this.last = snapshot(this.w);
    this.lastText = JSON.stringify(this.last);
    clearTimeout(this.settle); this.settle = null;
    this.quota = null; this.uploaded = 0;
    if (editing) space(this.w.id).then((r) => { if (r) { this.uploaded = r.used; this.quota = r.quota; this.showSpace(); } }).catch(() => {});
    this.render();
  }

  show(on) {
    this.root.hidden = !on;
    document.body.classList.toggle('in-studio', on);
    if (!on) { this.stopPaint(); this.stopPlace(); this.stopLight(); this.closePicker(); document.body.classList.remove('studio-preview'); }
  }

  changed() {
    this.remember();
    this.onChange(this.w);
    this.syncUndo();
    this.showSpace();
    for (const list of this.syncs.values()) for (const sync of list) sync();
    if (this.placing) this.syncPlace();
  }

  // The things people add live in the first chapter of the story: that is the tour.
  things() {
    const steps = (this.w.process ||= { steps: [] }).steps;
    if (!steps.length) steps.push({ when: '', title: tr('g.stepTitle'), text: '', media: [] });
    return (steps[0].media ||= []);
  }

  // Older code paths (arranging, settings) redraw "the things": here that is the timeline,
  // and the settings of the piece in hand.
  drawThings() {
    this.drawTimeline();
  }

  // ---- the whole studio ----

  render() {
    this.stopPaint();
    this.stopLight();
    this.closePicker();
    this.syncs.clear();
    const back = el('a', 'st-btn st-back');
    back.href = '#/';
    back.innerHTML = ICONS.back;
    back.append(el('span', null, tr('st.back')));
    this.leftEl = el('div', 'st-left');
    this.rightEl = el('aside', 'st-panel st-right');
    this.timelineEl = el('div', 'st-timeline');
    this.storageEl = el('div', 'st-storage');
    this.root.replaceChildren(back, this.topBar(), this.leftEl, this.rightEl, this.timelineEl, this.storageEl);
    this.drawLeft();
    this.drawTimeline();
    this.drawInspector();
    this.showSpace();
    this.syncUndo();
  }

  topBar() {
    const bar = el('div', 'st-top');
    // Sound, as in the city's own bar: five small bars that dance while it plays.
    const snd = button('', 'sound-toggle mono st-sound');
    snd.append(el('span', null, tr('nav.soundLabel')), el('span', 'bars'));
    for (let i = 0; i < 5; i++) snd.lastChild.append(el('i'));
    snd.addEventListener('click', () => document.getElementById('sound-toggle')?.click());
    const tools = el('div', 'st-top__tools');
    const eye = iconButton('eye', tr('st.preview'), 'st-icon st-eye');
    eye.addEventListener('click', () => {
      const on = document.body.classList.toggle('studio-preview');
      eye.classList.toggle('is-on', on);
      if (on) { this.stopPaint(); this.closePicker(); }
    });
    this.undoBtn = iconButton('undo', tr('g.undoIt') + ' · ' + tr('g.undoKeys'));
    this.redoBtn = iconButton('undo', tr('g.redo'), 'st-icon st-redo');
    this.undoBtn.addEventListener('click', () => this.undo());
    this.redoBtn.addEventListener('click', () => this.redo());
    const draft = button(tr('st.saveDraft'), 'st-btn');
    draft.addEventListener('click', () => { this.commit(); saveDraft(exportable(normalizeWorld({ ...this.w }))); toast(tr('st.draftSaved')); });
    const publish = button(this.editing ? tr('st.update') : tr('st.publish'), 'st-btn st-btn--main');
    publish.addEventListener('click', () => { this.stopPaint(); this.onRelease(this.w); });
    tools.append(eye, this.undoBtn, this.redoBtn, draft, publish);
    bar.append(snd, tools);
    return bar;
  }

  // ---- the left: story, background, media ----

  drawLeft() {
    this.syncs.delete('left');
    this.syncs.set('left', []);
    const tabs = el('div', 'st-tabs');
    for (const id of ['story', 'background', 'media']) {
      const b = button(tr('st.tab.' + id), 'st-tab' + (this.tab === id ? ' is-on' : ''));
      b.addEventListener('click', () => { if (this.tab === id) return; this.stopPaint(); this.closePicker(); this.tab = id; this.drawLeft(); });
      tabs.append(b);
    }
    const body = el('div', 'st-left__body');
    if (this.tab === 'story') body.append(...this.storyCards());
    if (this.tab === 'background') body.append(...this.backgroundCards());
    if (this.tab === 'media') body.append(this.mediaCard());
    this.leftEl.replaceChildren(tabs, body);
  }

  storyCards() {
    const c = card(tr('st.storyTitle'), tr('st.storyHelp'));
    const name = input(this.w.title === 'Untitled world' ? '' : this.w.title, tr('st.namePh'), (v) => { this.w.title = v; this.changed(); }, 60);
    const by = input(this.w.creator.name === 'Anonymous' ? '' : this.w.creator.name, tr('st.byPh'), (v) => { this.w.creator.name = v; this.changed(); }, 50);
    const made = chips([['human', tr('g.me')], ['together', tr('g.meAi')], ['machine', tr('g.ai')]], this.w.creator.nature, (v) => { this.w.creator.nature = v; this.changed(); }, 'st-chips st-chips--small');
    const byField = field(tr('st.by'), by);
    byField.append(made);
    const story = textarea(this.w.statement, tr('st.storyPh'), (v) => { this.w.statement = v.slice(0, 500); this.changed(); }, 500, 5);
    c.append(field(tr('st.name'), name), byField, field(tr('st.story'), story));
    const out = [c];
    if (!this.editing) {
      // An AI can write a whole world as text; this takes it in as it is.
      const ai = el('details', 'st-card st-more');
      ai.append(el('summary', 'st-label', tr('g.aiPaste')));
      const box = textarea('', '{ "title": … }', () => {}, 400000, 5);
      const use = button(tr('g.useIt'), 'st-btn');
      use.addEventListener('click', () => {
        const t = box.value, a = t.indexOf('{'), b = t.lastIndexOf('}');
        try { this.onImport(JSON.parse(t.slice(a, b + 1))); } catch { toast(tr('g.aiBad')); }
      });
      ai.append(box, use);
      out.push(ai);
    } else {
      const rm = button(tr('ws.remove'), 'st-btn st-btn--danger st-remove-world');
      rm.addEventListener('click', () => { if (confirm(tr('g.confirmRemove'))) this.onDelete(this.w.id); });
      out.push(rm);
    }
    return out;
  }

  backgroundCards() {
    const sync = this.syncs.get('left');
    // Particles: one press fills the plot; or draw them by hand.
    const p = card(tr('st.particles'), tr('st.particlesHelp'));
    const fill = button(tr('st.randomFill'), 'st-btn st-btn--main');
    fill.addEventListener('click', () => {
      const box = this.getRoom()?.form;
      if (!box) return;
      this.stopPaint();
      this.w.form = { ...this.w.form, type: 'hand', strokes: fillStrokes(box, { limit: STROKE_REACH }), density: Math.max(this.w.form.density, 0.75) }; // a whole plot wants plenty of particles
      delete this.w.form.hidden;
      this.changed();
    });
    const draw = button(tr('st.drawHand'), 'st-btn' + (this.painting ? ' is-on' : ''));
    draw.addEventListener('click', () => this.togglePaint());
    const two = el('div', 'st-two');
    two.append(fill, draw);
    // The shapes the particles can take by themselves (or none at all).
    const shapes = chips([...FORMS.map((f) => [f.id, tr('form.' + f.id)]), ['none', tr('form.none')]],
      this.w.form.hidden ? 'none' : this.w.form.type,
      (id) => { if (id === 'none') this.w.form.hidden = true; else { this.w.form.type = id; delete this.w.form.hidden; } this.changed(); });
    // The world's three colours: tap one to change it.
    const colours = el('div', 'st-swatches');
    const swatches = [0, 1, 2].map((i) => {
      const b = button('', 'st-swatch' + (this.painting && this.brush.tone === i ? ' is-on' : ''));
      b.style.background = this.w.palette[i];
      b.setAttribute('aria-label', tr('colour.' + i));
      b.addEventListener('click', () => {
        if (this.painting) { this.brush.tone = i; this.paint(); swatches.forEach((x, j) => x.classList.toggle('is-on', j === i)); }
        this.openPicker(i, b);
      });
      colours.append(b);
      return b;
    });
    const energy = slider(tr('st.energy'), 0, 1, 0.01, this.w.form.energy, () => {}, (v) => { this.w.form.energy = v; this.changed(); });
    const density = slider(tr('st.density'), 0, 1, 0.01, this.w.form.density, () => {}, (v) => { this.w.form.density = v; this.changed(); });
    p.append(two, shapes, field(tr('st.color'), colours), energy, density);
    // While drawing: the brush, and the ways out.
    if (this.painting) {
      const brushes = chips(BRUSHES.map((id) => [id, tr('brush.' + id)]), this.brush.style, (id) => { this.brush.style = id; this.paint(); });
      const soft = slider(tr('g.soft'), 0.01, 0.3, 0.005, this.brush.spread, (v) => { this.brush.spread = v; this.paint(); });
      const undo = button(tr('g.undo'), 'st-btn');
      undo.addEventListener('click', () => { this.w.form.strokes?.pop(); if (!this.w.form.strokes?.length) delete this.w.form.strokes; this.changed(); });
      const clear = button(tr('g.clear'), 'st-btn');
      clear.addEventListener('click', () => { delete this.w.form.strokes; this.changed(); });
      const turn = button(tr('g.turn'), 'st-btn');
      turn.addEventListener('click', () => {
        this.turning = !this.turning;
        turn.textContent = this.turning ? tr('g.backDrawing') : tr('g.turn');
        this.turning ? this.onPaint(false) : this.paint();
      });
      const done = button(tr('ui.done'), 'st-btn st-btn--main');
      done.addEventListener('click', () => this.stopPaint());
      const row = el('div', 'st-row st-row--end');
      row.append(undo, clear, turn, done);
      p.append(el('p', 'st-card__help', tr('g.paintHelp')), field(tr('brush.label'), brushes), soft, row);
    }
    sync.push(() => {
      shapes.set(this.w.form.hidden ? 'none' : this.w.form.type);
      swatches.forEach((b, i) => { b.style.background = this.w.palette[i]; });
      energy.set(this.w.form.energy);
      density.set(this.w.form.density);
    });
    // Mood: colours, movement and sound together; or your own colours.
    const m = card(tr('st.mood'), tr('st.moodHelp'));
    const grid = el('div', 'st-grid');
    const moodOf = () => FEELINGS.find((f) => f.palette.every((c, i) => c === this.w.palette[i]))?.id;
    const cards = FEELINGS.map((f) => {
      const b = button('', 'st-tile st-mood' + (moodOf() === f.id ? ' is-on' : ''));
      const sw = el('span', 'st-mood__swatch');
      for (const c of f.palette) { const s = el('i'); s.style.background = c; sw.append(s); }
      b.append(sw, el('span', null, tr('feel.' + f.id)));
      // A mood brings colours, sound and movement; particles already shaped by hand or filled stay.
      b.addEventListener('click', () => {
        const keep = this.w.form.type === 'hand';
        Object.assign(this.w, { palette: f.palette.slice(), form: { ...f.form, type: keep ? 'hand' : f.form.type, strokes: this.w.form.strokes, ...(this.w.form.hidden ? { hidden: true } : {}) }, sound: { ...f.sound } });
        if (!this.w.form.strokes) delete this.w.form.strokes;
        this.changed();
      });
      b.dataset.id = f.id;
      grid.append(b);
      return b;
    });
    const own = button(tr('st.pickOwn'), 'st-btn st-btn--main st-pick-own');
    own.addEventListener('click', () => this.openPicker(1, own));
    grid.append(own);
    sync.push(() => { const id = moodOf(); cards.forEach((b) => b.classList.toggle('is-on', b.dataset.id === id)); });
    m.append(grid);
    return [p, m];
  }

  // The colour picker floats beside the panel, for one of the world's three colours.
  openPicker(i, from) {
    this.closePicker();
    const pop = el('div', 'st-panel st-pop');
    const which = el('div', 'st-swatches st-swatches--pop');
    const tabs = [0, 1, 2].map((j) => {
      const b = button('', 'st-swatch st-swatch--small' + (j === i ? ' is-on' : ''));
      b.style.background = this.w.palette[j];
      b.setAttribute('aria-label', tr('colour.' + j));
      b.addEventListener('click', () => { i = j; tabs.forEach((x, k) => x.classList.toggle('is-on', k === j)); picker.set(this.w.palette[j]); });
      which.append(b);
      return b;
    });
    const picker = colourPicker(this.w.palette[i], (hex) => { this.w.palette[i] = hex; tabs[i].style.background = hex; this.changed(); });
    pop.append(which, picker);
    const r = from.getBoundingClientRect(), left = this.leftEl.getBoundingClientRect();
    pop.style.top = Math.max(16, Math.min(innerHeight - 340, r.top - 120)) + 'px';
    pop.style.left = left.right + 12 + 'px';
    this.root.append(pop);
    this.pickerEl = pop;
  }

  closePicker() {
    this.pickerEl?.remove();
    this.pickerEl = null;
  }

  mediaCard() {
    const c = card(tr('st.mediaTitle'), tr('st.mediaHelp'));
    const grid = el('div', 'st-grid');
    for (const [id, icon] of SHELF) {
      const b = button('', 'st-tile st-add');
      const ic = el('span', 'st-tile__icon');
      ic.innerHTML = ICONS[icon];
      const plus = el('span', 'st-add__plus');
      plus.innerHTML = ICONS.plus;
      b.append(ic, el('span', null, tr('st.k.' + id)), plus);
      b.addEventListener('click', () => this.add(id));
      grid.append(b);
    }
    c.append(grid);
    return c;
  }

  // ---- adding things ----

  addThing(m, solid = false) {
    const list = this.things();
    if (list.length >= MAX_MEDIA) { toast(tr('g.maxThings', { n: MAX_MEDIA })); return false; }
    const room = this.getRoom();
    // A splat is often a whole place: it starts as wide as the plot, low, and simply there.
    const wide = Math.round(Math.min(0.95, 1.9 * Math.min(room?.ax ?? 0.5, room?.az ?? 0.5)) * 100) / 100;
    m.show = solid && m.kind === 'splat' ? { at: [0, Math.min(0.3, (room?.h ?? 1) * 0.35), 0], size: wide, motion: 'still', near: 'rise' }
      : solid ? { at: [0, Math.min(0.5, (room?.h ?? 1) * 0.4), 0], size: 0.45, motion: 'still', near: 'appear' } : list.filter((x) => x.show).length < SHOW_FIRST;
    list.push(m);
    this.changed();
    this.select(list.length - 1);
    return true;
  }

  // A new piece from the shelf: it joins the end of the timeline and opens in the panel on
  // the right, where its file, words and place are chosen.
  async add(id) {
    if (id === 'text') return this.addThing({ kind: 'poem', poem: { lines: [], motion: 'gather' } });
    if (id === 'draw') { const sk = await sketchPad(this.w.palette); if (sk) this.addThing({ kind: 'sketch', sketch: sk }); return; }
    if (id === 'picture') return this.addThing({ kind: 'image', src: '' });
    if (id === 'video') return this.addThing({ kind: 'video', src: '' });
    if (id === '3d') return this.addThing({ kind: 'splat', src: '' }, true);
    if (id === 'sound') return this.addThing({ kind: 'audio', src: '' });
  }

  // ---- the piece in hand ----

  select(i, { quiet = false } = {}) {
    const list = this.things();
    this.sel = i >= 0 && i < list.length ? i : -1;
    const m = list[this.sel];
    if (m && SHOWABLE.includes(m.kind) && m.show) { this.stopPaint(); this.placing = null; this.startPlace(m, { quiet: true }); }
    else this.stopPlace();
    this.drawTimeline();
    if (!quiet) this.drawInspector();
  }

  drawInspector() {
    this.syncs.delete('right');
    const m = this.things()[this.sel];
    this.rightEl.hidden = !m;
    document.body.classList.toggle('studio-has-piece', !!m);
    if (!m) { this.rightEl.replaceChildren(); return; }
    const kindName = tr('st.i.' + m.kind);
    const head = el('div', 'st-card__head st-right__head');
    head.append(el('h3', 'st-card__title', kindName));
    const close = button('', 'st-close');
    close.innerHTML = '<img src="img/close.svg" width="7" height="7" alt="">';
    close.prepend(el('span', 'mono', tr('ui.close')));
    close.addEventListener('click', () => this.select(-1));
    head.append(close);
    const body = el('div', 'st-right__body');
    body.append(...this.pieceControls(m));
    // Its name and its words: what the tour says at this stop.
    const title = input(m.title, tr('st.titlePh'), (v) => { if (v) m.title = v; else delete m.title; this.changed(); }, 80);
    const desc = textarea(m.caption, tr('st.descPh'), (v) => { if (v) m.caption = v; else delete m.caption; this.changed(); }, 200, 3);
    body.append(field(tr('st.titleL'), title), field(tr('st.descL'), desc));
    if (SHOWABLE.includes(m.kind)) {
      if (!m.show) {
        const show = el('label', 'g-check');
        const cb = el('input');
        Object.assign(cb, { type: 'checkbox', checked: false });
        cb.addEventListener('change', () => { m.show = true; this.changed(); this.select(this.sel); });
        show.append(cb, ' ' + tr('g.float'));
        body.append(show);
      } else {
        const pos = el('details', 'st-more st-position');
        pos.open = true;
        pos.append(el('summary', 'st-label', tr('st.position')), this.placePanel(m));
        body.append(pos);
      }
    }
    // Removing needs no question: Undo brings it back.
    const rm = button('', 'st-btn st-btn--danger');
    rm.innerHTML = ICONS.remove;
    rm.append(el('span', null, tr('st.remove')));
    rm.addEventListener('click', () => {
      const list = this.things();
      this.stopPlace();
      list.splice(this.sel, 1);
      this.sel = -1;
      this.changed();
      this.drawTimeline();
      this.drawInspector();
      toast(tr('g.removedUndo'), 5000);
    });
    body.append(rm);
    this.rightEl.replaceChildren(head, body);
  }

  // What is particular to each kind: its file or link, its words, its drawing or tune.
  pieceControls(m) {
    const out = [];
    const redraw = () => { this.drawTimeline(); this.drawInspector(); };
    const setSrc = (src) => { m.src = src; delete m.glow; this.changed(); redraw(); };
    const linkField = (ph, take) => {
      const u = el('input', 'st-input');
      Object.assign(u, { type: 'url', value: m.src && !m.src.startsWith('data:') ? m.src : '', placeholder: ph });
      let wait;
      u.addEventListener('input', () => { clearTimeout(wait); wait = setTimeout(() => take(u.value.trim()), 600); });
      u.addEventListener('change', () => { clearTimeout(wait); take(u.value.trim()); });
      return field(tr('st.link'), u);
    };
    // A picture shows itself, with a button over it to change it.
    const preview = (node, accept, onFiles) => {
      const box = el('div', 'st-preview');
      box.append(node);
      const change = button(tr('st.change'), 'st-preview__change');
      change.addEventListener('click', async () => { const f = await pickFiles(accept); if (f.length) onFiles(f); });
      box.append(change);
      return field(tr('st.upload'), box);
    };
    if (m.kind === 'image') {
      const take = async (files) => { try { setSrc(await imageToData(files[0], 1600)); } catch { toast(tr('g.badPicture')); } };
      if (m.src) { const img = el('img'); img.src = m.src; img.alt = ''; out.push(preview(img, 'image/*', take)); }
      else out.push(field(tr('st.upload'), dropzone('image/*', '.jpg .png .webp', take)));
      out.push(linkField('https://…', (v) => { if (v !== (m.src?.startsWith('data:') ? '' : m.src)) setSrc(v); }));
    }
    if (m.kind === 'video') {
      const take = async (files) => {
        const f = files[0];
        if (f.size > VIDEO_MAX) return toast(tr('g.videoLarge', { name: f.name }));
        setSrc(await fileToData(f));
      };
      if (m.src?.startsWith('data:')) { const v = el('video'); Object.assign(v, { src: m.src, controls: true, playsInline: true, preload: 'metadata' }); out.push(preview(v, 'video/*', take)); }
      else out.push(field(tr('st.upload'), dropzone('video/*', '.mp4 .webm', take)));
      out.push(linkField(tr('g.videoLinkPh'), (v) => { if (v !== m.src) setSrc(v); }));
    }
    if (m.kind === 'audio') {
      const take = async (files) => {
        const f = files[0];
        if (f.size > AUDIO_MAX) return toast(tr('g.audioLarge', { name: f.name }));
        setSrc(await fileToData(f));
      };
      if (m.src?.startsWith('data:')) { const a = el('audio'); Object.assign(a, { src: m.src, controls: true, preload: 'metadata' }); out.push(preview(a, 'audio/*', take)); }
      else out.push(field(tr('st.upload'), dropzone('audio/*', '.mp3 .ogg .wav .m4a', take)));
      const rec = button(tr('g.recordMic'), 'st-btn');
      rec.addEventListener('click', async () => { const src = await recordSound(); if (src) setSrc(src); });
      // Or a little tune, composed note by note.
      const tune = button(tr('st.compose'), 'st-btn');
      tune.addEventListener('click', async () => {
        const mel = await melodyGrid(this.w.palette);
        if (!mel) return;
        delete m.src; delete m.glow;
        Object.assign(m, { kind: 'melody', melody: mel });
        this.changed();
        redraw();
      });
      const row = el('div', 'st-row');
      row.append(rec, tune);
      out.push(row, linkField(tr('g.soundLinkPh'), (v) => { if (v !== m.src) setSrc(v); }));
    }
    if (m.kind === 'model' || m.kind === 'splat') {
      const take = async (files) => {
        const got = await objectFile(files[0]);
        if (!got) return;
        const was = m.kind;
        Object.assign(m, got);
        delete m.glow;
        if (got.kind !== was) this.placed(m);
        this.changed();
        this.select(this.sel);
      };
      const has = m.src?.startsWith('data:');
      if (has) out.push(field(tr('st.upload'), el('p', 'st-note', tr(m.kind === 'splat' ? 'g.isSplat' : 'g.isModel'))));
      out.push(field(has ? tr('st.change') : tr('st.upload'), dropzone('.glb,.gltf,.fbx,.spz,.ply,.splat,.ksplat,.sog', '.glb .fbx .spz .ply .splat', take)));
      out.push(linkField(tr('g.objectLinkPh'), (v) => {
        const src = objectLink(v);
        if (!src || src === m.src) return;
        const kind = /\.(glb|gltf|fbx)(\?|#|$)/i.test(src) ? 'model' : 'splat';
        const was = m.kind;
        Object.assign(m, { src, kind });
        delete m.glow; // a new piece gets its own glow when it loads
        this.changed();
        if (kind !== was) this.select(this.sel); else this.drawTimeline();
      }));
    }
    if (m.kind === 'poem') {
      const words = textarea((m.poem?.lines || []).join('\n'), tr('g.wordsPh'), (v) => {
        m.poem = { ...m.poem, lines: v.split('\n').map((l) => l.trim()).filter(Boolean) };
        this.changed();
        this.drawTimeline();
      }, 2000, 5);
      const motion = chips(['gather', 'drift', 'still'].map((id) => [id, tr('motion.' + id)]), m.poem?.motion || 'gather', (id) => { m.poem = { ...(m.poem || { lines: [] }), motion: id }; this.changed(); });
      out.push(field(tr('st.words'), words), motion);
    }
    if (m.kind === 'sketch') {
      const box = el('div', 'st-preview st-preview--light');
      box.append(sketchSvg(m.sketch, this.w.palette, { animate: false }));
      const b = button(tr('g.keepDrawing'), 'st-preview__change');
      b.addEventListener('click', async () => { const sk = await sketchPad(this.w.palette, m.sketch); if (sk) { m.sketch = sk; this.changed(); redraw(); } });
      box.append(b);
      out.push(box);
    }
    if (m.kind === 'melody') {
      const b = button(tr('g.changeTune'), 'st-btn');
      b.addEventListener('click', async () => { const mel = await melodyGrid(this.w.palette, m.melody); if (mel) { m.melody = mel; this.changed(); redraw(); } });
      out.push(melodyPlayer(m.melody, this.w.palette), b);
    }
    return out;
  }

  // ---- the timeline: the tour, one small square per piece ----

  drawTimeline() {
    if (!this.timelineEl) return;
    const list = this.things();
    const strip = el('div', 'st-strip');
    list.forEach((m, i) => strip.append(this.stripTile(m, i)));
    const add = iconButton('plus', tr('st.addPiece'), 'st-stop st-stop--add');
    add.addEventListener('click', () => { this.stopPaint(); this.closePicker(); this.tab = 'media'; this.drawLeft(); document.body.classList.remove('studio-preview'); });
    strip.append(add);
    this.stripEl = strip;
    this.timelineEl.replaceChildren(el('p', 'st-timeline__label', tr('st.timeline')), strip);
  }

  stripTile(m, i) {
    const tile = button('', 'st-stop' + (this.sel === i ? ' is-on' : '') + (m.show ? '' : ' is-off'));
    tile.setAttribute('aria-label', `${i + 1} · ${tr('st.i.' + m.kind)}${m.title || m.caption ? ' · ' + (m.title || m.caption) : ''}`);
    tile.title = m.title || m.caption || tr('st.i.' + m.kind);
    if (m.kind === 'image' && m.src) { const img = el('img'); img.src = m.src; img.alt = ''; img.draggable = false; tile.append(img); tile.classList.add('has-picture'); }
    else if ((m.kind === 'image' || m.kind === 'video' || m.kind === 'audio' || m.kind === 'model' || m.kind === 'splat') && !m.src) tile.classList.add('is-empty');
    else { const ic = el('span', 'st-stop__icon'); ic.innerHTML = ICONS[KIND_ICON[m.kind] || 'picture']; tile.append(ic); }
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.moveThing(i, i - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); this.moveThing(i, i + 1); }
    });
    tile.addEventListener('pointerdown', (e) => this.dragStop(e, tile, i));
    return tile;
  }

  // A piece moved to another place on the timeline (and so on the tour).
  moveThing(from, to) {
    const list = this.things();
    if (to < 0 || to >= list.length || to === from) return;
    const held = list[this.sel];
    const [m] = list.splice(from, 1);
    list.splice(to, 0, m);
    this.sel = held ? list.indexOf(held) : -1;
    this.changed();
    this.drawTimeline();
    this.stripEl.children[to]?.focus();
  }

  // Drag a square to another place; a tap opens the piece.
  dragStop(e, tile, i) {
    if (e.button > 0) return;
    const tiles = [...this.stripEl.querySelectorAll('.st-stop:not(.st-stop--add)')];
    const boxes = tiles.map((t) => t.getBoundingClientRect());
    const x0 = e.clientX, y0 = e.clientY;
    let dragging = false, to = i;
    tile.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!dragging && Math.hypot(dx, dy) < 6) return;
      dragging = true;
      tile.classList.add('is-dragging');
      tile.style.transform = `translate(${dx}px, ${dy}px)`;
      // The square under the middle of the dragged one is where it goes.
      const cx = boxes[i].left + boxes[i].width / 2 + dx;
      let best = Infinity;
      boxes.forEach((b, j) => { const d = Math.abs(b.left + b.width / 2 - cx); if (d < best) { best = d; to = j; } });
      tiles.forEach((t, j) => t.classList.toggle('is-target', j === to && j !== i));
    };
    const up = () => {
      tile.removeEventListener('pointermove', move);
      tile.removeEventListener('pointerup', up);
      tile.removeEventListener('pointercancel', up);
      tile.style.transform = '';
      tile.classList.remove('is-dragging');
      tiles.forEach((t) => t.classList.remove('is-target'));
      if (dragging) { if (to !== i) this.moveThing(i, to); return; }
      this.select(this.sel === i ? -1 : i);
    };
    tile.addEventListener('pointermove', move);
    tile.addEventListener('pointerup', up);
    tile.addEventListener('pointercancel', up);
  }

  // ---- storage: each plot has its fair share of the city's space ----

  showSpace() {
    const s = this.storageEl;
    if (!s) return;
    if (!isOnline()) { s.replaceChildren(el('span', null, tr('st.local'))); return; }
    let fresh = 0;
    const visit = (list) => (list || []).forEach((m) => { if (m.src?.startsWith('data:')) fresh += m.src.length * 0.75; });
    this.w.fragments.forEach((f) => visit(f.media));
    (this.w.process?.steps || []).forEach((st) => visit(st.media));
    const quota = this.quota || 75e6, used = (this.uploaded || 0) + fresh;
    const mb = (v) => String(Math.round(v / 1e6));
    const icon = el('span', 'st-storage__ring');
    icon.innerHTML = ring(used / quota);
    s.replaceChildren(icon, el('span', null, tr('st.storage', { used: mb(used), quota: mb(quota) })));
    s.classList.toggle('is-full', used > quota);
  }

  // ---- stars by hand ----

  togglePaint() {
    if (this.painting) return this.stopPaint();
    this.stopPlace();
    this.stopLight();
    this.painting = true;
    this.paint();
    if (this.tab === 'background') this.drawLeft();
  }

  paint() {
    this.turning = false;
    this.onPaint(true, {
      tone: this.brush.tone,
      spread: this.brush.spread,
      style: this.brush.style,
      onStroke: (st) => {
        const list = (this.w.form.strokes ||= []);
        if (list.length >= MAX_STROKES) return toast(tr('g.maxStrokes'));
        list.push(st);
        this.changed();
      },
    });
  }

  stopPaint() {
    if (!this.painting) return;
    this.painting = false;
    this.onPaint(false);
    if (this.tab === 'background' && this.leftEl?.isConnected) this.drawLeft();
  }

  // ---- placing things by hand ----

  // The thing's place in the plot, made explicit so it can be moved.
  placed(m) {
    const room = this.getRoom() || { ax: 0.5, az: 0.5, h: 1 };
    if (!m.show || m.show === true) m.show = { at: [0, Math.min(0.5, room.h * 0.45), 0], size: 0.32, motion: 'float' };
    if (!m.show.at) m.show.at = [0, Math.min(0.5, room.h * 0.45), 0];
    return m.show;
  }

  // Quiet: the piece was only chosen, so nothing about the world has changed yet.
  startPlace(m, { quiet = false } = {}) {
    this.stopPaint();
    this.stopLight();
    this.placed(m);
    this.placing = { m, turning: false };
    if (!quiet) { this.changed(); this.drawThings(); }
    this.syncPlace();
  }

  // Tell the view which thing is being placed (its position among what the plot shows).
  syncPlace() {
    if (!this.placing) return this.onPlace(null);
    const { m, turning } = this.placing;
    const index = exhibitItems(this.w).indexOf(m);
    this.onPlace(index < 0 ? null : {
      index, turning,
      onMove: (x, z) => { const s = this.placed(m); s.at = [round(x), s.at[1], round(z)]; this.placeFollow?.(); this.changed(); },
    });
  }

  stopPlace() {
    if (!this.placing) return;
    this.placing = null;
    this.onPlace(null);
    this.onNear(null);
    this.drawThings();
  }

  placePanel(m) {
    const room = this.getRoom() || { ax: 0.5, az: 0.5, h: 1 };
    const s = this.placed(m);
    const p = el('div', 'g-paint g-place');
    const slider = (label, min, max, step, value, fn) => {
      const l = el('label', 'g-range');
      const r = el('input');
      Object.assign(r, { type: 'range', min, max, step, value });
      r.setAttribute('aria-label', label);
      r.addEventListener('input', () => { fn(+r.value); this.changed(); });
      l.append(el('span', 'g-range__name', label), r);
      return l;
    };
    // X, Y and Z: a slider and an exact number for each, always inside the plot (in plot widths).
    const lim = [[-room.ax, room.ax], [0, Math.max(0.2, room.h)], [-room.az, room.az]];
    const axes = ['x', 'y', 'z'].map((k, i) => {
      const l = el('label', 'g-range g-axis');
      const r = el('input'), n = el('input', 'g-axis__num');
      Object.assign(r, { type: 'range', min: lim[i][0], max: lim[i][1], step: 0.005, value: s.at[i] });
      Object.assign(n, { type: 'number', min: lim[i][0].toFixed(2), max: lim[i][1].toFixed(2), step: 0.01, value: s.at[i].toFixed(2) });
      r.setAttribute('aria-label', tr('g.axis.' + k));
      n.setAttribute('aria-label', tr('g.axis.' + k));
      const set = (v) => {
        v = Math.min(lim[i][1], Math.max(lim[i][0], +v || 0));
        const at = [...s.at]; at[i] = round(v); s.at = at;
        r.value = v; if (document.activeElement !== n) n.value = v.toFixed(2);
        this.changed();
      };
      r.addEventListener('input', () => set(r.value));
      n.addEventListener('change', () => set(n.value));
      l.append(el('span', 'g-range__name', k.toUpperCase() + ' · ' + tr('g.axis.' + k)), r, n);
      return { l, r, n };
    });
    // Dragging in the picture moves X and Z; the controls follow.
    this.placeFollow = () => axes.forEach(({ r, n }, i) => { r.value = s.at[i]; n.value = (+s.at[i]).toFixed(2); });
    const centre = button(tr('g.centreIt'), 'g-pill g-centre');
    centre.addEventListener('click', () => { s.at = [0, s.at[1], 0]; this.placeFollow(); this.changed(); });
    const size = slider(tr('g.size'), 0.05, 1.5, 0.01, s.size, (v) => { s.size = round(v); });
    const turn = slider(tr('g.turnIt'), -180, 180, 1, typeof s.turn === 'number' ? Math.round(s.turn * 180 / Math.PI) : 0, (v) => { s.turn = round(v * Math.PI / 180); face.querySelector('input').checked = false; });
    const face = el('label', 'g-check');
    const fc = el('input');
    Object.assign(fc, { type: 'checkbox', checked: typeof s.turn !== 'number' });
    fc.addEventListener('change', () => { if (fc.checked) delete s.turn; else s.turn = 0; this.changed(); });
    face.append(fc, ' ' + tr('g.faceVisitors'));
    const pills = (ids, key, current, set) => {
      const row = el('div', 'g-choice');
      for (const id of ids) {
        const b = button(tr(key + id), 'g-pill' + (current === id ? ' is-on' : ''));
        b.addEventListener('click', () => { set(id); row.querySelectorAll('.g-pill').forEach((x) => x.classList.toggle('is-on', x === b)); this.changed(); });
        row.append(b);
      }
      return row;
    };
    const motion = pills(MOTIONS, 'mo.', s.motion || 'float', (id) => { s.motion = id; });
    const near = pills(NEAR, 'near.', s.near || 'none', (id) => { if (id === 'none') delete s.near; else s.near = id; });
    const preview = pills(['far', 'close'], 'g.seen.', 'close', (id) => this.onNear(id === 'far' ? 0 : 1));
    const view = button(tr('g.turn'), 'g-btn g-btn--soft');
    view.addEventListener('click', () => {
      this.placing.turning = !this.placing.turning;
      view.textContent = this.placing.turning ? tr('g.backPlacing') : tr('g.turn');
      this.syncPlace();
    });
    const row = el('div', 'g-choice');
    row.append(view);
    // What everyone needs first (where, how big, how high); the finer things folded away.
    const fine = el('details', 'g-more');
    fine.append(el('summary', null, tr('g.fineTune')), axes[0].l, axes[2].l, turn, face,
      el('p', 'g-help', tr('g.motion')), motion, el('p', 'g-help', tr('g.whenNear')), near, el('p', 'g-help', tr('g.preview')), preview);
    // A splat can be the place itself: its ground filling the plot, your things inside it,
    // and the tour standing where it was seen from.
    let role = null;
    if (m.kind === 'splat') {
      role = el('div', 'g-setting');
      const as = pills(['thing', 'setting'], 'g.splatAs.', s.setting ? 'setting' : 'thing', (id) => this.setSetting(m, id === 'setting'));
      role.append(el('p', 'g-help', tr('g.splatAs')), as);
      if (s.setting) {
        const fill = button(tr('g.settingFill'), 'g-btn g-btn--main');
        fill.addEventListener('click', () => this.fillSetting(m));
        const look = button(tr('g.settingLook'), 'g-btn g-btn--soft');
        look.addEventListener('click', () => this.onSettingLook(exhibitItems(this.w).indexOf(m)));
        const r2 = el('div', 'g-choice');
        r2.append(fill, look);
        role.append(el('p', 'g-help g-help--quiet', tr('g.settingHelp')), r2);
      }
    }
    if (m.kind === 'splat') {
      const flip = el('label', 'g-check');
      const f = el('input');
      Object.assign(f, { type: 'checkbox', checked: !!s.flip });
      f.addEventListener('change', () => { if (f.checked) s.flip = true; else delete s.flip; this.changed(); });
      flip.append(f, ' ' + tr('g.flip'));
      fine.append(flip);
    }
    if (s.setting) p.append(role, size, centre, fine, row); // a setting stands on the ground, filling the plot
    else p.append(...(role ? [role] : []), el('p', 'g-help', tr('g.placeHelp')), size, axes[1].l, centre, fine, row);
    return p;
  }

  setSetting(m, on) {
    const room = this.getRoom() || { ax: 0.5, az: 0.5, h: 1 }, s = this.placed(m);
    if (on) {
      Object.assign(s, { setting: true, at: [0, 0, 0], size: round(Math.min(3, Math.max(room.ax, room.az) * 2)), motion: 'still' });
      if (typeof s.turn !== 'number') s.turn = 0;
      delete s.near;
    } else {
      delete s.setting;
      Object.assign(s, { at: [0, Math.min(0.5, room.h * 0.45), 0], size: 0.5, motion: 'float' });
    }
    this.changed();
    this.drawThings();
    this.syncPlace();
  }

  // Your things into a setting, in front of where it was seen from: the stops after it on the
  // tour (the first setting also takes those before it, and goes to the front), on a gentle
  // arc across its view, near enough to see well and turned to you.
  fillSetting(m) {
    const tour = this.tourItems(), list = this.things();
    // With several settings: your things shared out among them, each its fair part, in
    // the tour's order (setting, its things, the next setting, its things...).
    const settings = tour.filter((x) => x.show?.setting);
    if (settings.length > 1) {
      const views = settings.map((x) => this.getSettingView(exhibitItems(this.w).indexOf(x)));
      if (views.some((v) => !v)) return toast(tr('g.settingWait'));
      const rest = tour.filter((x) => !x.show?.setting), order = [];
      let from = 0;
      settings.forEach((x, i) => {
        const take = Math.round(((i + 1) * rest.length) / settings.length) - from;
        const part = rest.slice(from, from + take);
        from += take;
        order.push(x, ...part);
        this.arc(x, views[i], part);
      });
      const slots = tour.map((x) => list.indexOf(x));
      slots.forEach((slot, j) => { list[slot] = order[j]; });
      this.changed();
      this.drawThings();
      return toast(tr('g.settingFilled', { n: rest.length }));
    }
    const view = this.getSettingView(exhibitItems(this.w).indexOf(m));
    if (!view) return toast(tr('g.settingWait'));
    let i = tour.indexOf(m);
    if (i > 0 && tour.findIndex((x) => x.show?.setting) === i) {
      const slots = tour.map((x) => list.indexOf(x));
      tour.splice(i, 1);
      tour.unshift(m);
      slots.forEach((slot, j) => { list[slot] = tour[j]; });
      i = 0;
    }
    const members = [];
    for (let j = i + 1; j < tour.length && !tour[j].show?.setting; j++) members.push(tour[j]);
    if (!members.length) return toast(tr('g.settingEmpty'));
    this.arc(m, view, members);
    this.changed();
    this.drawThings();
    toast(tr('g.settingFilled', { n: members.length }));
  }

  // Things on a gentle arc across a setting's view, near enough to see well, turned to you.
  arc(m, view, members) {
    const s = this.placed(m), r = Math.max(0.12, 0.2 * s.size), n = members.length;
    const [fx, fz] = view.forward, [ex, ey, ez] = view.at;
    members.forEach((x, j) => {
      const a = n === 1 ? 0 : -0.75 + (1.5 * j) / (n - 1);
      const dx = fx * Math.cos(a) - fz * Math.sin(a), dz = fx * Math.sin(a) + fz * Math.cos(a);
      const t = this.placed(x);
      t.at = [round(ex + dx * r), round(Math.max(0.02, ey + (j % 2 ? 0.03 : -0.02) * s.size)), round(ez + dz * r)];
      t.size = round(Math.min(t.size, r * 0.55));
      delete t.turn; // facing whoever looks
    });
  }

  // Ready-made arrangements for everything the plot shows.
  // One button: each press tries another arrangement; Undo goes back to the one before.
  arrangeBar() {
    const bar = el('div', 'g-arrange');
    const b = button(tr('g.arrangeMe'), 'g-btn g-btn--soft');
    b.addEventListener('click', () => this.arrange('surprise'));
    bar.append(b, el('p', 'g-help g-help--quiet', tr('g.arrangeHint')));
    return bar;
  }

  // Every press is a new variation: the same idea (a ring, a spiral, a wave...), with its
  // own turn, rhythm and lift, so arranging is a little like composing.
  arrange(id) {
    const room = this.getRoom() || { ax: 0.5, az: 0.5, h: 1, front: 1 };
    const list = this.things().filter((m) => m.show && SHOWABLE.includes(m.kind));
    const n = list.length;
    if (!n) return;
    const rnd = Math.random, wob = (k) => (rnd() * 2 - 1) * k;
    if (id === 'surprise') id = ['spiral', 'wave', 'arch', 'knot', 'bloom', 'ring', 'orbit'][Math.floor(rnd() * 7)];
    const H = Math.max(0.2, room.h), mid = Math.min(H * 0.45, 0.6), r = Math.min(room.ax, room.az) * (0.55 + rnd() * 0.12);
    const phase = rnd() * Math.PI * 2, dir = rnd() < 0.5 ? -1 : 1, lift = 0.6 + rnd() * 0.5;
    const along = (t) => (n === 1 ? 0.5 : t); // a lone piece sits in the middle of the curve
    // Sizes that leave room between neighbours along a curve of the given length.
    const fit = (len, size, cap) => round(Math.max(0.06, Math.min(size, (len / n) * 0.8, cap)));
    // Facing along a curve: the direction from this point to a little further on.
    const tangent = (f, t) => { const a = f(t), b = f(t + 0.01); return Math.atan2(b[0] - a[0], b[2] - a[2]) + Math.PI / 2; };
    list.forEach((m, i) => {
      const s = this.placed(m);
      const size = Math.min(s.size, 1.2 * Math.min(room.ax, room.az) / Math.max(1, Math.sqrt(n)));
      const t = along((i + 0.5) / n);
      let at = [0, mid, 0], turn, motion = s.motion === 'orbit' ? 'float' : s.motion || 'float';
      if (id === 'centre') {
        if (i === 0) { at = [0, mid, 0]; s.size = round(Math.min(0.55, room.ax)); }
        else { const a = phase + ((i - 1) / Math.max(1, n - 1)) * Math.PI * 2; at = [Math.cos(a) * r, mid * (0.7 + wob(0.15)), Math.sin(a) * r]; s.size = round(Math.min(size, 0.22) * (0.85 + rnd() * 0.3)); }
      } else if (id === 'ring') {
        const a = phase + (i / n) * Math.PI * 2;
        at = [Math.cos(a) * r, mid + Math.sin(a * 2 + phase) * H * 0.08, Math.sin(a) * r];
        turn = Math.atan2(at[0], at[2]); // facing outwards, to the street on every side
        s.size = round(Math.min(size, 0.3));
      } else if (id === 'row' || id === 'street') {
        const x = n === 1 ? 0 : (-1 + (2 * i) / (n - 1)) * room.ax * 0.72;
        const z = id === 'street' ? room.front * (room.az - Math.min(size, 0.3) / 2 - 0.04) : 0;
        at = [x, mid + Math.sin(phase + i * 1.1) * H * 0.06, z]; // a gentle melody in the heights
        turn = room.front > 0 ? 0 : Math.PI;
        s.size = round(Math.min(size, (room.ax * 1.5) / n, 0.35));
      } else if (id === 'stack') {
        const each = Math.min(0.3, (H * 0.9) / n);
        s.size = round(Math.min(s.size, each * 0.9));
        const a = phase + i * 0.9 * dir;
        at = [Math.cos(a) * each * 0.25, each * (i + 0.5), Math.sin(a) * each * 0.25]; // a slight twist as it rises
      } else if (id === 'orbit') {
        const a = phase + (i / n) * Math.PI * 2;
        at = [Math.cos(a) * r, mid + Math.sin(a * 3) * H * 0.06, Math.sin(a) * r];
        motion = 'orbit';
        s.size = round(Math.min(size, 0.28));
      } else if (id === 'floor') {
        const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
        const cx = i % cols, cz = Math.floor(i / cols);
        s.size = round(Math.min(size, (room.ax * 1.6) / cols, 0.4));
        const jx = cols === 1 ? 0 : wob(0.12) * room.ax / cols, jz = rows === 1 ? 0 : wob(0.12) * room.az / rows;
        at = [(cols === 1 ? 0 : (-1 + (2 * cx) / (cols - 1)) * room.ax * 0.65) + jx, s.size / 2, (rows === 1 ? 0 : (-1 + (2 * cz) / (rows - 1)) * room.az * 0.65) + jz];
        turn = phase + wob(0.4);
        motion = 'still';
      } else if (id === 'spiral') {
        // A helix that widens as it climbs, turning by the golden angle's rhythm.
        const turns = 1 + rnd() * 1.2;
        const f = (u) => { const a = phase + dir * u * turns * Math.PI * 2, rr = r * (0.35 + 0.65 * u); return [Math.cos(a) * rr * room.ax / Math.min(room.ax, room.az), H * (0.1 + 0.75 * u * lift), Math.sin(a) * rr * room.az / Math.min(room.ax, room.az)]; };
        at = f(t); turn = tangent(f, t);
        s.size = fit(turns * Math.PI * 2 * r * 0.7, size, 0.3);
      } else if (id === 'bloom') {
        // Sunflower seeds: the golden angle spreads them evenly over a disc, lifted like a dome.
        const a = phase + i * 2.39996, rr = Math.sqrt((i + 0.5) / n) * r * 1.05;
        at = [Math.cos(a) * rr * room.ax / Math.min(room.ax, room.az), mid * (1.25 - 0.6 * (rr / r) ** 2) + wob(0.03), Math.sin(a) * rr * room.az / Math.min(room.ax, room.az)];
        turn = Math.atan2(at[0], at[2]);
        s.size = round(Math.max(0.06, Math.min(size, r * 1.6 / Math.sqrt(n), 0.3)));
      } else if (id === 'wave') {
        // A ribbon across the plot, rising and falling like a swell.
        const k = 1 + Math.floor(rnd() * 2), amp = room.az * (0.25 + rnd() * 0.3), angle = phase;
        const f = (u) => { const x = (u * 2 - 1) * room.ax * 0.8, z = Math.sin(u * Math.PI * k + angle) * amp; return [x, mid + Math.sin(u * Math.PI * 2 * k + angle) * H * 0.18 * lift, z]; };
        at = f(t); turn = tangent(f, t);
        s.size = fit(room.ax * 1.8, size, 0.3);
      } else if (id === 'arch') {
        // A crescent: rising from the ground, over the top, and down again.
        const span = Math.PI * (0.55 + rnd() * 0.35), rr = r * 1.1;
        const f = (u) => { const a = phase + (u - 0.5) * span * 2; return [Math.cos(a) * rr * 0.9, H * (0.08 + 0.8 * lift * Math.sin(u * Math.PI)), Math.sin(a) * rr * 0.9]; };
        at = f(t); turn = Math.atan2(at[0], at[2]) + Math.PI; // facing the middle
        s.size = fit(span * 2 * rr, size, 0.3);
      } else if (id === 'knot') {
        // A Lissajous loop through the room, three-dimensional and never quite the same.
        const p = 1 + Math.floor(rnd() * 2), q = p + 1, z0 = rnd() * Math.PI;
        const f = (u) => { const a = u * Math.PI * 2; return [Math.sin(p * a + phase) * room.ax * 0.7, mid + Math.sin(q * a + z0) * H * 0.25, Math.sin(q * a) * room.az * 0.7]; };
        at = f((i + rnd() * 0.3) / n); turn = tangent(f, (i + 0.15) / n);
        s.size = fit(Math.PI * 2 * r * 1.5, size, 0.28);
      }
      // Everything stays inside the plot, whatever the form.
      at = [Math.max(-room.ax, Math.min(room.ax, at[0])), Math.max(s.size * 0.3, Math.min(H, at[1])), Math.max(-room.az, Math.min(room.az, at[2]))];
      s.at = at.map(round);
      s.motion = motion;
      if (turn === undefined) delete s.turn; else s.turn = round(Math.atan2(Math.sin(turn), Math.cos(turn)));
    });
    this.changed();
    this.drawThings();
  }

  // A thing's stop on the tour (1, 2, 3...), or 0 when it does not stand in the plot.
  tourStop(m) {
    return this.tourItems().indexOf(m) + 1;
  }

  // The things on the tour, in its order.
  tourItems() {
    const list = this.things().filter((x) => SHOWABLE.includes(x.kind));
    const marked = list.filter((x) => x.show);
    return marked.length ? marked : list.slice(0, 5);
  }

  // ---- the plot's light ----

  // From afar every plot glows with soft colour. It starts from the colours of the things in
  // it; here you can paint it yourself: tap the plot to add a colour, drag a dot to move it,
  // and choose how it all moves.
  lightSection() {
    const sec = el('section', 'g-light');
    const paint = button(tr('g.lightPaint'), 'g-btn g-btn--main');
    paint.addEventListener('click', () => (this.lightOn ? this.stopLight() : this.startLight()));
    const state = el('p', 'g-help g-help--quiet');
    const sync = () => {
      state.textContent = this.w.light && !this.w.light.auto ? tr('g.lightMine', { n: this.w.light.spots.length }) : tr('g.lightAuto');
      paint.textContent = this.lightOn ? tr('ui.done') : tr('g.lightPaint');
    };
    this.syncs.set('light', [sync]);
    sync();
    this.lightPanel = el('div', 'g-paint');
    this.lightPanel.hidden = true;
    sec.append(paint, state, this.lightPanel);
    return sec;
  }

  startLight() {
    this.stopPaint();
    this.stopPlace();
    // Start from the light the things give now, so only what you change is yours.
    if (this.w.light?.auto) { delete this.w.light.auto; this.lightSeed = JSON.stringify(this.w.light); this.changed(); }
    else if (!this.w.light) {
      const spots = this.getAutoLight().slice(0, MAX_LIGHTS);
      if (!spots.length) {
        // Nothing placed yet: the world's three colours, where they glow by themselves.
        const r = this.getRoom() || { ax: 0.5, az: 0.5, h: 1 }, k = (v) => Math.round(v * 100) / 100;
        const reach = k(Math.max(r.ax * 2, r.az * 2, r.h) * 0.32);
        [[-0.28, 0.22, 0.2], [0.3, 0.55, -0.22], [-0.05, 0.85, 0.05]].forEach(([x, y, z], i) => spots.push({ at: [k(x * r.ax * 2), k(y * r.h), k(z * r.az * 2)], c: this.w.palette[i], r: reach }));
      }
      this.w.light = { spots, flow: 'drift', speed: 0.5 };
      this.lightSeed = JSON.stringify(this.w.light);
      this.changed();
    }
    this.lightOn = true;
    this.lightPick = -1;
    this.lightBrush ||= { c: this.w.light.spots[0]?.c || this.w.palette[1], r: 0.45 };
    this.drawLightPanel();
    this.onLight({
      label: tr('g.lightDot'),
      spots: () => this.w.light?.spots || [],
      selected: () => this.lightPick,
      onSelect: (i) => { this.lightPick = i; const o = this.w.light.spots[i]; if (o) this.lightBrush = { c: o.c, r: o.r }; this.drawLightPanel(); },
      onMove: (i, at) => { const o = this.w.light?.spots[i]; if (o) { o.at = at; this.changed(); } },
      onDrop: () => {},
      onAdd: (at) => {
        const spots = this.w.light.spots;
        if (spots.length >= MAX_LIGHTS) return toast(tr('g.lightMax', { n: MAX_LIGHTS }));
        spots.push({ at, c: this.lightBrush.c, r: this.lightBrush.r });
        this.lightPick = spots.length - 1;
        this.changed();
        this.drawLightPanel();
      },
    });
    this.syncs.get('light')?.forEach((f) => f());
  }

  stopLight() {
    if (!this.lightOn) return;
    this.lightOn = false;
    this.onLight(null);
    // Opened and closed without a change: it stays the light the things give (and follows them).
    if (this.w.light && JSON.stringify(this.w.light) === this.lightSeed) { delete this.w.light; this.changed(); }
    this.lightSeed = null;
    if (this.lightPanel?.isConnected) this.lightPanel.hidden = true;
    this.syncs.get('light')?.forEach((f) => f());
  }

  drawLightPanel() {
    const p = this.lightPanel, L = this.w.light;
    if (!p || !L) return;
    p.hidden = false;
    const picked = L.spots[this.lightPick];
    // Colours: those of your things and your world first, then any colour at all.
    const tones = el('div', 'g-choice');
    const seen = new Set();
    const choices = [...L.spots.map((o) => o.c), ...this.getAutoLight().map((o) => o.c), ...this.w.palette].filter((c) => !seen.has(c) && seen.add(c)).slice(0, 10);
    const setColour = (c) => {
      this.lightBrush.c = c;
      if (picked) { picked.c = c; this.changed(); }
      this.drawLightPanel();
    };
    for (const c of choices) {
      const b = button('', 'g-dot' + (this.lightBrush.c === c ? ' is-on' : ''));
      b.style.background = c;
      b.setAttribute('aria-label', c);
      b.addEventListener('click', () => setColour(c));
      tones.append(b);
    }
    const any = el('input');
    Object.assign(any, { type: 'color', value: this.lightBrush.c });
    any.setAttribute('aria-label', tr('g.lightAny'));
    any.addEventListener('change', () => setColour(any.value));
    tones.append(any);
    // How far a colour reaches.
    const size = el('input');
    Object.assign(size, { type: 'range', min: 0.15, max: 1.2, step: 0.01, value: this.lightBrush.r });
    size.addEventListener('input', () => { this.lightBrush.r = +size.value; if (picked) { picked.r = +size.value; this.changed(); } });
    const sizeL = el('label', 'g-range');
    sizeL.append(el('span', null, tr('g.lightSmall')), size, el('span', null, tr('g.lightWide')));
    // How it all moves, and how fast.
    const flows = el('div', 'g-choice');
    for (const id of ['drift', 'rise', 'swirl']) {
      const b = button(tr('g.flow.' + id), 'g-pill' + (L.flow === id ? ' is-on' : ''));
      b.addEventListener('click', () => { L.flow = id; flows.querySelectorAll('.g-pill').forEach((x) => x.classList.toggle('is-on', x === b)); this.changed(); });
      flows.append(b);
    }
    const speed = el('input');
    Object.assign(speed, { type: 'range', min: 0, max: 1, step: 0.01, value: L.speed });
    speed.addEventListener('input', () => { L.speed = +speed.value; this.changed(); });
    const speedL = el('label', 'g-range');
    speedL.append(el('span', null, tr('g.still')), speed, el('span', null, tr('g.lively')));
    const row = el('div', 'g-choice');
    if (picked) {
      const rm = button(tr('g.lightRemove'), 'g-btn g-btn--soft');
      rm.addEventListener('click', () => { L.spots.splice(this.lightPick, 1); this.lightPick = -1; if (!L.spots.length) return this.lightReset(); this.changed(); this.drawLightPanel(); });
      row.append(rm);
    }
    const reset = button(tr('g.lightReset'), 'g-btn g-btn--soft');
    reset.addEventListener('click', () => this.lightReset());
    const done = button(tr('ui.done'), 'g-btn g-btn--main');
    done.addEventListener('click', () => this.stopLight());
    row.append(reset, done);
    p.replaceChildren(el('p', 'g-help', tr('g.lightHow')), el('p', 'g-help', picked ? tr('g.lightThis') : tr('g.lightNew')), tones, sizeL,
      el('p', 'g-help', tr('g.lightMoves')), flows, speedL, row);
  }

  // Back to the light the world gives by itself: its colours as they show (the plot is
  // shown full again for a moment, so its picture can be taken), to paint on from there.
  lightReset() {
    delete this.w.light;
    this.lightSeed = null;
    this.changed();
    if (!this.lightOn) return;
    this.lightOn = false;
    this.onLight(null);
    const again = () => { if (!this.lightOn) this.startLight(); };
    setTimeout(() => this.getPictureLight().then((light) => { if (light && !this.w.light) this.w.light = light; again(); }, again), 400);
  }
}
