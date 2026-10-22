// The studio: the gentle way in. Everything can, nothing must. A shelf of tools,
// large and plain, and whatever you make appears beside you as you make it.
// It edits the same world as the full workshop, so anyone can switch at any moment.
import { el, toast } from './util.js';
import { t as tr } from './i18n.js';
import { MAX_MEDIA, SHOWABLE, MOTIONS, NEAR, sketchSvg, melodyPlayer } from './media.js';
import { exhibitItems } from './exhibit.js';
import { sketchPad, melodyGrid } from './tools.js';
import { imageToData } from './editor.js';
import { FORMS, MAX_STROKES, BRUSHES } from './store.js';
import { isOnline, space } from './server.js';

// Each feeling sets colours, form, movement and sound together.
export const FEELINGS = [
  { id: 'calm', name: 'Calm', palette: ['#0d2a3a', '#3f8fa8', '#dff4f7'], form: { type: 'tide', energy: 0.28, density: 0.62 }, sound: { root: 82.41, mood: 'warm' } },
  { id: 'warm', name: 'Warm', palette: ['#4a1f10', '#c46a32', '#f6d9a8'], form: { type: 'bloom', energy: 0.42, density: 0.66 }, sound: { root: 98, mood: 'warm' } },
  { id: 'growing', name: 'Growing', palette: ['#14301f', '#5d9a55', '#e3f0c8'], form: { type: 'bloom', energy: 0.22, density: 0.72 }, sound: { root: 73.42, mood: 'warm' } },
  { id: 'bright', name: 'Bright', palette: ['#3a2410', '#d9a03c', '#fff4cf'], form: { type: 'spiral', energy: 0.72, density: 0.6 }, sound: { root: 130.81, mood: 'bright' } },
  { id: 'precise', name: 'Precise', palette: ['#2a2420', '#a88a5c', '#f1e6d0'], form: { type: 'solid', energy: 0.5, density: 0.55 }, sound: { root: 110, mood: 'bright' } },
  { id: 'deep', name: 'Night', palette: ['#120c2e', '#6a4fc0', '#ecdcff'], form: { type: 'nebula', energy: 0.38, density: 0.7 }, sound: { root: 65.41, mood: 'dark' } },
];

const SHOW_FIRST = 6; // the first few things float in the city on their own
const AUDIO_MAX = 8e6, VIDEO_MAX = 40e6, MODEL_MAX = 25e6, SPLAT_MAX = 30e6; // bytes, for files from the device (the server's limits)
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

function button(text, cls = 'g-btn') {
  const b = el('button', cls, text);
  b.type = 'button';
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

// A text box with an optional "speak" button underneath.
function writeBox(value, placeholder, rows, onInput, cls = 'g-text') {
  const wrap = el('div', 'g-write');
  const ta = el('textarea', cls);
  Object.assign(ta, { value: value || '', placeholder, rows });
  ta.addEventListener('input', () => onInput(ta.value));
  wrap.append(ta);
  if (SpeechRec) {
    const mic = button(tr('g.speak'), 'g-btn g-btn--soft g-mic');
    let rec = null;
    mic.addEventListener('click', () => {
      if (rec) { rec.stop(); return; }
      rec = new SpeechRec();
      rec.lang = navigator.language || 'en';
      rec.continuous = true;
      rec.onresult = (e) => {
        const said = [...e.results].slice(e.resultIndex).filter((r) => r.isFinal).map((r) => r[0].transcript).join(' ').trim();
        if (!said) return;
        ta.value = (ta.value.trim() ? ta.value.trim() + ' ' : '') + said[0].toUpperCase() + said.slice(1);
        onInput(ta.value);
      };
      rec.onend = () => { rec = null; mic.textContent = tr('g.speak'); mic.classList.remove('is-on'); };
      rec.onerror = () => toast(tr('g.noHear'));
      rec.start();
      mic.textContent = tr('g.listening');
      mic.classList.add('is-on');
    });
    wrap.append(mic);
  }
  return { wrap, ta };
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

export class Guide {
  constructor(root, { onChange, onRelease, onWorkshop, onPaint, onDelete, onImport, onPlace = () => {}, onNear = () => {}, getRoom = () => null }) {
    this.onPlace = onPlace;
    this.onNear = onNear;
    this.getRoom = getRoom;
    this.onDelete = onDelete;
    this.onImport = onImport;
    this.onChange = onChange;
    this.onRelease = onRelease;
    this.onWorkshop = onWorkshop;
    this.onPaint = onPaint;
    this.syncs = new Map(); // panel → functions that bring its controls up to date
    this.brush = { tone: 2, spread: 0.06, style: 'stream' };
    this.root = el('div', 'guide');
    this.root.hidden = true;
    root.prepend(this.root);
  }

  load(world, plotLabel, { editing = false } = {}) {
    this.placing = null;
    this.onPlace(null);
    this.w = structuredClone(world);
    this.plotLabel = plotLabel;
    this.editing = editing;
    this.render();
  }

  show(on) {
    this.root.hidden = !on;
    if (!on) { this.stopPaint(); this.stopPlace(); }
  }

  changed() {
    this.onChange(this.w);
    this.showSpace?.();
    for (const list of this.syncs.values()) for (const sync of list) sync();
    if (this.placing) this.syncPlace();
  }

  // The things people add live in the first chapter of the story.
  things() {
    const steps = (this.w.process ||= { steps: [] }).steps;
    if (!steps.length) steps.push({ when: '', title: tr('g.stepTitle'), text: '', media: [] });
    return (steps[0].media ||= []);
  }

  render() {
    this.stopPaint();
    const page = el('div', 'guide__page');
    const top = el('div', 'guide__top');
    top.append(el('p', 'guide__kicker', this.plotLabel ? tr('g.yourPlot', { plot: this.plotLabel }) : tr('g.yourWorld')));
    const full = button(tr('g.workshop'), 'guide__full');
    full.addEventListener('click', () => this.onWorkshop(this.w));
    top.append(full);

    const name = el('input', 'g-input g-input--name');
    Object.assign(name, { value: this.w.title === 'Untitled world' ? '' : this.w.title, placeholder: tr('g.untitled'), maxLength: 60 });
    name.setAttribute('aria-label', tr('g.nameAria'));
    name.addEventListener('input', () => { this.w.title = name.value; this.changed(); });
    const by = el('div', 'g-by');
    const who = el('input', 'g-input g-input--small');
    Object.assign(who, { value: this.w.creator.name === 'Anonymous' ? '' : this.w.creator.name, placeholder: tr('g.byPh'), maxLength: 50 });
    who.setAttribute('aria-label', tr('ws.creatorPh'));
    who.addEventListener('input', () => { this.w.creator.name = who.value; this.changed(); });
    const made = el('div', 'g-choice g-choice--small');
    for (const [v, label] of [['human', tr('g.me')], ['together', tr('g.meAi')], ['machine', tr('g.ai')]]) {
      const b = button(label, 'g-pill' + (this.w.creator.nature === v ? ' is-on' : ''));
      b.addEventListener('click', () => { this.w.creator.nature = v; made.querySelectorAll('.g-pill').forEach((x) => x.classList.toggle('is-on', x === b)); this.changed(); });
      made.append(b);
    }
    by.append(who, made);

    const { wrap: words } = writeBox(this.w.statement, tr('g.statementPh'), 4, (v) => { this.w.statement = v.slice(0, 500); this.changed(); });

    page.append(top, name, by, words, this.shelf(), this.thingsList(), this.textsList(), this.looks(), this.finish());
    this.root.replaceChildren(page);
  }

  // ---- the shelf of tools ----

  shelf() {
    const wrap = el('section', 'g-shelf');
    wrap.append(el('h3', 'g-h', tr('g.add')));
    const tiles = el('div', 'g-tiles');
    const tools = [
      [tr('g.text'), () => this.addText()],
      [tr('g.pictures'), () => this.addPictures()],
      [tr('g.drawing'), () => this.addDrawing()],
      [tr('g.sound'), () => this.addSound()],
      [tr('g.video'), () => this.addVideo()],
      [tr('g.tune'), () => this.addTune()],
      [tr('g.words'), () => this.addThing({ kind: 'poem', poem: { lines: [], motion: 'gather' } })],
      [tr('g.stars'), () => this.togglePaint()],
      [tr('g.objects'), () => this.addObject()],
    ];
    for (const [label, fn] of tools) {
      const t = button(label, 'g-tile');
      t.addEventListener('click', fn);
      tiles.append(t);
    }
    this.paintPanel = el('div', 'g-paint');
    this.paintPanel.hidden = true;
    wrap.append(tiles, this.paintPanel);
    return wrap;
  }

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
    this.drawThings();
    return true;
  }

  addText() {
    if (this.w.fragments.length >= 9) return toast(tr('g.maxTexts'));
    this.w.fragments.push({ title: '', text: '', link: '', media: [] });
    this.drawTexts(true);
    this.changed();
  }

  async addPictures() {
    const files = await pickFiles('image/*', true);
    for (const f of files) {
      try { if (!this.addThing({ kind: 'image', src: await imageToData(f, 1600) })) break; } catch { toast(tr('g.badPicture')); }
    }
  }

  async addDrawing() {
    const sk = await sketchPad(this.w.palette);
    if (sk) this.addThing({ kind: 'sketch', sketch: sk });
  }

  async addTune() {
    const mel = await melodyGrid(this.w.palette);
    if (mel) this.addThing({ kind: 'melody', melody: mel });
  }

  addSound() {
    this.choose(tr('g.sound'), [
      [tr('g.recordMic'), async () => { const src = await recordSound(); if (src) this.addThing({ kind: 'audio', src }); }],
      [tr('g.soundFile'), async () => {
        for (const f of await pickFiles('audio/*', true)) {
          if (f.size > AUDIO_MAX) { toast(tr('g.audioLarge', { name: f.name })); continue; }
          if (!this.addThing({ kind: 'audio', src: await fileToData(f) })) break;
        }
      }],
      [tr('g.pasteLink'), () => this.addThing({ kind: 'audio', src: '' })],
    ]);
  }

  addVideo() {
    this.choose(tr('g.video'), [
      [tr('g.videoFile'), async () => {
        for (const f of await pickFiles('video/*', true)) {
          if (f.size > VIDEO_MAX) { toast(tr('g.videoLarge', { name: f.name })); continue; }
          if (!this.addThing({ kind: 'video', src: await fileToData(f) })) break;
        }
      }],
      [tr('g.pasteVideo'), () => this.addThing({ kind: 'video', src: '' })],
    ]);
  }

  // 3D models (.glb) and Gaussian splats (World Labs and others). Splats that are not
  // .spz yet are packed into .spz right here, often ten times smaller.
  addObject() {
    this.choose(tr('g.objects'), [
      [tr('g.splatFile'), async () => {
        for (const f of await pickFiles('.spz,.ply,.splat,.ksplat,.sog', true)) {
          const ext = (f.name.match(/\.(\w+)$/) || [])[1]?.toLowerCase();
          let file = f;
          if (ext !== 'spz' && ext !== 'sog') {
            toast(tr('g.packing', { name: f.name }), 8000);
            try {
              const { transcodeSpz } = await import('@sparkjsdev/spark');
              const { fileBytes } = await transcodeSpz({ inputs: [{ fileBytes: new Uint8Array(await f.arrayBuffer()), pathOrUrl: f.name }] });
              file = new File([fileBytes], f.name.replace(/\.\w+$/, '.spz'));
            } catch { toast(tr('g.badObject', { name: f.name })); continue; }
          }
          if (file.size > SPLAT_MAX) { toast(tr('g.objectLarge', { name: f.name, mb: SPLAT_MAX / 1e6 })); continue; }
          const type = 'application/x-' + (file.name.endsWith('.sog') ? 'sog' : 'spz');
          if (!this.addThing({ kind: 'splat', src: await fileAs(file, type), caption: f.name.replace(/\.\w+$/, '') }, true)) break;
        }
      }],
      [tr('g.modelFile'), async () => {
        for (let f of await pickFiles('.glb,.fbx', true)) {
          if (/\.fbx$/i.test(f.name)) {
            toast(tr('g.packing', { name: f.name }), 8000);
            try { f = await fbxToGlb(f); } catch { toast(tr('g.badObject', { name: f.name })); continue; }
          }
          if (f.size > MODEL_MAX) { toast(tr('g.objectLarge', { name: f.name, mb: MODEL_MAX / 1e6 })); continue; }
          if (!this.addThing({ kind: 'model', src: await fileAs(f, 'model/gltf-binary'), caption: f.name.replace(/\.\w+$/, '') }, true)) break;
        }
      }],
      [tr('g.objectLink'), () => this.addThing({ kind: 'splat', src: '' }, true)],
    ]);
  }

  // A small sheet of choices under the shelf.
  choose(title, options) {
    const sheet = el('div', 'g-sheet');
    sheet.append(el('p', 'g-card__kind', title));
    for (const [label, fn] of options) {
      const b = button(label, 'g-btn g-btn--soft');
      b.addEventListener('click', () => { sheet.remove(); fn(); });
      sheet.append(b);
    }
    const x = button(tr('ui.closeWord'), 'g-card__remove');
    x.addEventListener('click', () => sheet.remove());
    sheet.append(x);
    this.root.querySelector('.g-sheet')?.remove();
    this.root.querySelector('.g-shelf').append(sheet);
  }

  // ---- stars by hand ----

  togglePaint() {
    if (this.painting) return this.stopPaint();
    this.stopPlace();
    this.painting = true;
    const p = this.paintPanel;
    p.hidden = false;
    const tones = el('div', 'g-choice');
    this.w.palette.forEach((c, i) => {
      const b = button('', 'g-dot' + (this.brush.tone === i ? ' is-on' : ''));
      b.style.background = c;
      b.setAttribute('aria-label', tr('g.starsTone' + i));
      b.addEventListener('click', () => { this.brush.tone = i; tones.querySelectorAll('.g-dot').forEach((x) => x.classList.toggle('is-on', x === b)); this.paint(); });
      tones.append(b);
    });
    const soft = el('input');
    Object.assign(soft, { type: 'range', min: 0.01, max: 0.3, step: 0.005, value: this.brush.spread });
    soft.addEventListener('input', () => { this.brush.spread = +soft.value; this.paint(); });
    const brushes = el('div', 'g-choice');
    for (const id of BRUSHES) {
      const b = button(tr('brush.' + id), 'g-pill' + (this.brush.style === id ? ' is-on' : ''));
      b.addEventListener('click', () => { this.brush.style = id; brushes.querySelectorAll('.g-pill').forEach((x) => x.classList.toggle('is-on', x === b)); this.paint(); });
      brushes.append(b);
    }
    const softL = el('label', 'g-range');
    softL.append(el('span', null, tr('g.fine')), soft, el('span', null, tr('g.soft')));
    // The star colours are the world's colours: change them here and the brush follows.
    this.syncs.set('paint', []);
    this.syncs.get('paint').push(() => tones.querySelectorAll('.g-dot').forEach((b, i) => { b.style.background = this.w.palette[i]; }));
    const look = this.lookControls('paint');
    const undo = button(tr('g.undo'), 'g-btn g-btn--soft');
    undo.addEventListener('click', () => { this.w.form.strokes?.pop(); if (!this.w.form.strokes?.length) delete this.w.form.strokes; this.changed(); });
    const clear = button(tr('g.clear'), 'g-btn g-btn--soft');
    clear.addEventListener('click', () => { delete this.w.form.strokes; this.changed(); });
    const turn = button(tr('g.turn'), 'g-btn g-btn--soft');
    turn.addEventListener('click', () => {
      this.turning = !this.turning;
      turn.textContent = this.turning ? tr('g.backDrawing') : tr('g.turn');
      this.turning ? this.onPaint(false) : this.paint();
    });
    const done = button(tr('ui.done'), 'g-btn g-btn--main');
    done.addEventListener('click', () => this.stopPaint());
    const row = el('div', 'g-choice');
    row.append(undo, clear, turn, done);
    p.replaceChildren(el('p', 'g-help', tr('g.paintHelp')), el('p', 'g-help', tr('brush.label')), brushes, tones, softL,
      el('p', 'g-help', tr('g.ownColours')), look.colours, el('p', 'g-help', tr('g.shape')), look.shapes, look.energy, look.density, row);
    this.paint();
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
    this.syncs.delete('paint');
    this.paintPanel.hidden = true;
    this.onPaint(false);
  }

  // ---- placing things by hand ----

  // The thing's place in the plot, made explicit so it can be moved.
  placed(m) {
    const room = this.getRoom() || { ax: 0.5, az: 0.5, h: 1 };
    if (!m.show || m.show === true) m.show = { at: [0, Math.min(0.5, room.h * 0.45), 0], size: 0.32, motion: 'float' };
    if (!m.show.at) m.show.at = [0, Math.min(0.5, room.h * 0.45), 0];
    return m.show;
  }

  startPlace(m) {
    this.stopPaint();
    this.placed(m);
    this.placing = { m, turning: false };
    this.changed();
    this.drawThings();
    this.syncPlace();
  }

  // Tell the view which thing is being placed (its position among what the plot shows).
  syncPlace() {
    if (!this.placing) return this.onPlace(null);
    const { m, turning } = this.placing;
    const index = exhibitItems(this.w).indexOf(m);
    this.onPlace(index < 0 ? null : {
      index, turning,
      onMove: (x, z) => { const s = this.placed(m); s.at = [round(x), s.at[1], round(z)]; this.changed(); },
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
    const height = slider(tr('g.height'), 0, Math.max(0.2, room.h), 0.01, s.at[1], (v) => { s.at = [s.at[0], round(v), s.at[2]]; });
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
    const done = button(tr('ui.done'), 'g-btn g-btn--main');
    done.addEventListener('click', () => this.stopPlace());
    const row = el('div', 'g-choice');
    row.append(view, done);
    p.append(el('p', 'g-help', tr('g.placeHelp')), height, size, turn, face,
      el('p', 'g-help', tr('g.motion')), motion, el('p', 'g-help', tr('g.whenNear')), near, el('p', 'g-help', tr('g.preview')), preview);
    if (m.kind === 'splat') {
      const flip = el('label', 'g-check');
      const f = el('input');
      Object.assign(f, { type: 'checkbox', checked: !!s.flip });
      f.addEventListener('change', () => { if (f.checked) s.flip = true; else delete s.flip; this.changed(); });
      flip.append(f, ' ' + tr('g.flip'));
      p.append(flip);
    }
    p.append(row);
    return p;
  }

  // Ready-made arrangements for everything the plot shows.
  arrangeBar() {
    const bar = el('div', 'g-arrange');
    bar.append(el('p', 'g-help', tr('g.arrange')));
    const row = el('div', 'g-choice');
    for (const id of ['centre', 'ring', 'row', 'stack', 'orbit', 'floor', 'street']) {
      const b = button(tr('arrange.' + id), 'g-pill');
      b.addEventListener('click', () => this.arrange(id));
      row.append(b);
    }
    bar.append(row);
    return bar;
  }

  arrange(id) {
    const room = this.getRoom() || { ax: 0.5, az: 0.5, h: 1, front: 1 };
    const list = this.things().filter((m) => m.show && SHOWABLE.includes(m.kind));
    const n = list.length;
    if (!n) return;
    const mid = Math.min(room.h * 0.45, 0.6), r = Math.min(room.ax, room.az) * 0.62;
    list.forEach((m, i) => {
      const s = this.placed(m);
      const size = Math.min(s.size, 1.2 * Math.min(room.ax, room.az) / Math.max(1, Math.sqrt(n)));
      let at = [0, mid, 0], turn, motion = s.motion === 'orbit' ? 'float' : s.motion || 'float';
      if (id === 'centre') {
        if (i === 0) { at = [0, mid, 0]; s.size = round(Math.min(0.55, room.ax)); }
        else { const a = ((i - 1) / Math.max(1, n - 1)) * Math.PI * 2; at = [Math.cos(a) * r, mid * 0.8, Math.sin(a) * r]; s.size = round(Math.min(size, 0.22)); }
      } else if (id === 'ring') {
        const a = (i / n) * Math.PI * 2 + Math.PI / 2;
        at = [Math.cos(a) * r, mid, Math.sin(a) * r];
        turn = Math.atan2(at[0], at[2]); // facing outwards, to the street on every side
        s.size = round(Math.min(size, 0.3));
      } else if (id === 'row' || id === 'street') {
        const x = n === 1 ? 0 : (-1 + (2 * i) / (n - 1)) * room.ax * 0.72;
        const z = id === 'street' ? room.front * (room.az - Math.min(size, 0.3) / 2 - 0.04) : 0;
        at = [x, mid, z];
        turn = room.front > 0 ? 0 : Math.PI;
        s.size = round(Math.min(size, (room.ax * 1.5) / n, 0.35));
      } else if (id === 'stack') {
        const each = Math.min(0.3, (room.h * 0.9) / n);
        s.size = round(Math.min(s.size, each * 0.9));
        at = [0, each * (i + 0.5), 0];
      } else if (id === 'orbit') {
        const a = (i / n) * Math.PI * 2;
        at = [Math.cos(a) * r, mid + (i % 2 ? 0.08 : -0.04), Math.sin(a) * r];
        motion = 'orbit';
        s.size = round(Math.min(size, 0.28));
      } else if (id === 'floor') {
        const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
        const cx = i % cols, cz = Math.floor(i / cols);
        s.size = round(Math.min(size, (room.ax * 1.6) / cols, 0.4));
        at = [(cols === 1 ? 0 : (-1 + (2 * cx) / (cols - 1)) * room.ax * 0.65), s.size / 2, (rows === 1 ? 0 : (-1 + (2 * cz) / (rows - 1)) * room.az * 0.65)];
        motion = 'still';
      }
      s.at = at.map(round);
      s.motion = motion;
      if (turn === undefined) delete s.turn; else s.turn = round(turn);
    });
    this.changed();
    this.drawThings();
  }

  // ---- what has been made ----

  thingsList() {
    this.thingsEl = el('div', 'g-cards');
    this.arrangeEl = this.arrangeBar();
    this.drawThings();
    const wrap = el('div');
    wrap.append(this.arrangeEl, this.thingsEl);
    return wrap;
  }

  drawThings() {
    const list = this.things();
    if (this.arrangeEl) this.arrangeEl.hidden = list.filter((m) => m.show && SHOWABLE.includes(m.kind)).length < 1;
    this.thingsEl.replaceChildren(...list.map((m, k) => this.card(m, k, list)));
  }

  card(m, k, list) {
    const c = el('div', 'g-card');
    const redraw = () => this.drawThings();
    if (m.kind === 'image' && m.src) { const img = el('img'); img.src = m.src; img.alt = ''; c.append(img); }
    if (m.kind === 'sketch') {
      c.append(sketchSvg(m.sketch, this.w.palette, { animate: false }));
      const b = button(tr('g.keepDrawing'), 'g-btn g-btn--soft');
      b.addEventListener('click', async () => { const sk = await sketchPad(this.w.palette, m.sketch); if (sk) { m.sketch = sk; this.changed(); redraw(); } });
      c.append(b);
    }
    if (m.kind === 'melody') {
      c.append(melodyPlayer(m.melody, this.w.palette));
      const b = button(tr('g.changeTune'), 'g-btn g-btn--soft');
      b.addEventListener('click', async () => { const mel = await melodyGrid(this.w.palette, m.melody); if (mel) { m.melody = mel; this.changed(); redraw(); } });
      c.append(b);
    }
    if (m.kind === 'poem') {
      const { wrap } = writeBox((m.poem?.lines || []).join('\n'), tr('g.wordsPh'), 3, (v) => {
        m.poem = { ...m.poem, lines: v.split('\n').map((l) => l.trim()).filter(Boolean) };
        this.changed();
      });
      c.append(wrap);
    }
    if ((m.kind === 'audio' || m.kind === 'video') && m.src?.startsWith('data:')) {
      const player = el(m.kind);
      Object.assign(player, { src: m.src, controls: true, playsInline: true, preload: 'metadata' });
      c.append(player);
    } else if (m.kind === 'audio' || m.kind === 'video') {
      const u = el('input', 'g-input g-input--small');
      Object.assign(u, { type: 'url', value: m.src || '', placeholder: m.kind === 'video' ? tr('g.videoLinkPh') : tr('g.soundLinkPh') });
      u.addEventListener('input', () => { m.src = u.value.trim(); this.changed(); });
      c.append(u);
    }
    if (m.kind === 'model' || m.kind === 'splat') {
      c.append(el('p', 'g-help', tr(m.kind === 'splat' ? 'g.isSplat' : 'g.isModel')));
      if (!m.src?.startsWith('data:')) {
        const u = el('input', 'g-input g-input--small');
        Object.assign(u, { type: 'url', value: m.src || '', placeholder: tr('g.objectLinkPh') });
        // A pasted link takes effect at once (a moment after typing stops), not only on leaving the field.
        let wait;
        const take = () => {
          const src = objectLink(u.value.trim());
          if (src === m.src) return;
          const kind = /\.(glb|gltf|fbx)(\?|#|$)/i.test(src) ? 'model' : 'splat';
          const was = m.kind;
          Object.assign(m, { src, kind });
          if (src !== u.value.trim()) u.value = src;
          this.changed();
          if (kind !== was) redraw();
        };
        u.addEventListener('input', () => { clearTimeout(wait); wait = setTimeout(take, 600); });
        u.addEventListener('change', () => { clearTimeout(wait); take(); });
        c.append(u);
      }
    }
    const cap = el('input', 'g-input g-input--small');
    Object.assign(cap, { value: m.caption || '', placeholder: tr('g.captionPh') });
    cap.addEventListener('input', () => { m.caption = cap.value; this.changed(); });
    c.append(cap);

    const tools = el('div', 'g-card__tools');
    const show = el('label', 'g-check');
    const cb = el('input');
    Object.assign(cb, { type: 'checkbox', checked: !!m.show });
    cb.addEventListener('change', () => { m.show = cb.checked; this.changed(); });
    show.append(cb, ' ' + tr('g.float'));
    tools.append(show);
    if (SHOWABLE.includes(m.kind)) {
      const place = button(this.placing?.m === m ? tr('ui.done') : tr('g.place'), 'g-btn g-btn--soft');
      place.addEventListener('click', () => (this.placing?.m === m ? this.stopPlace() : this.startPlace(m)));
      tools.append(place);
    }
    const move = (d) => { const j = k + d; if (j < 0 || j >= list.length) return; [list[k], list[j]] = [list[j], list[k]]; this.changed(); redraw(); };
    const up = button('↑', 'g-icon'); up.setAttribute('aria-label', tr('g.moveUp')); up.disabled = k === 0; up.addEventListener('click', () => move(-1));
    const down = button('↓', 'g-icon'); down.setAttribute('aria-label', tr('g.moveDown')); down.disabled = k === list.length - 1; down.addEventListener('click', () => move(1));
    const rm = button(tr('g.remove'), 'g-card__remove');
    rm.addEventListener('click', () => { if (this.placing?.m === m) this.stopPlace(); list.splice(k, 1); this.changed(); redraw(); });
    tools.append(up, down, rm);
    c.append(tools);
    if (this.placing?.m === m) c.append(this.placePanel(m));
    return c;
  }

  textsList() {
    this.textsEl = el('div', 'g-cards');
    this.drawTexts();
    return this.textsEl;
  }

  drawTexts(focusLast = false) {
    const frs = this.w.fragments;
    this.textsEl.replaceChildren(...frs.map((fr, k) => {
      const box = el('div', 'g-card g-card--text');
      const t = el('input', 'g-input g-input--title');
      Object.assign(t, { value: fr.title === 'Untitled' ? '' : fr.title, placeholder: tr('g.titlePh'), maxLength: 80 });
      t.addEventListener('input', () => { fr.title = t.value; this.changed(); });
      const { wrap } = writeBox(fr.text, tr('g.text'), 4, (v) => { fr.text = v; this.changed(); });
      const tools = el('div', 'g-card__tools');
      tools.append(el('span', 'g-help', tr('g.textHelp')));
      const rm = button(tr('g.remove'), 'g-card__remove');
      rm.addEventListener('click', () => { frs.splice(k, 1); this.changed(); this.drawTexts(); });
      tools.append(rm);
      box.append(t, wrap, tools);
      return box;
    }));
    if (focusLast) this.textsEl.lastChild?.querySelector('textarea')?.focus();
  }

  // ---- look and feel ----

  looks() {
    const sec = el('details', 'g-looks');
    sec.append(el('summary', 'g-h', tr('g.looks')));
    const grid = el('div', 'g-feel');
    this.syncs.set('looks', []);
    const look = this.lookControls('looks');
    for (const f of FEELINGS) {
      const b = button('', 'g-feel__card');
      const sw = el('span', 'g-feel__swatch');
      for (const c of f.palette) { const s = el('i'); s.style.background = c; sw.append(s); }
      b.append(sw, el('b', null, tr('feel.' + f.id)));
      b.addEventListener('click', () => {
        const keep = this.w.form.type === 'hand';
        Object.assign(this.w, { palette: f.palette.slice(), form: { ...f.form, type: keep ? 'hand' : f.form.type, strokes: this.w.form.strokes }, sound: { ...f.sound } });
        if (!this.w.form.strokes) delete this.w.form.strokes;
        this.changed();
      });
      grid.append(b);
    }
    sec.append(grid, el('p', 'g-help', tr('g.ownColours')), look.colours, el('p', 'g-help', tr('g.shape')), look.shapes, look.energy, look.density);
    return sec;
  }

  // Colours, shape, movement and number of stars. The same controls appear under
  // "Colours, shape and movement" and while placing stars by hand; every copy stays in step.
  lookControls(panel) {
    const colours = el('div', 'g-colours');
    [0, 1, 2].forEach((i) => {
      const c = el('input');
      Object.assign(c, { type: 'color', value: this.w.palette[i] });
      c.setAttribute('aria-label', tr('colour.' + i));
      c.addEventListener('input', () => { this.w.palette[i] = c.value; this.changed(); });
      colours.append(c);
    });
    const shapes = el('div', 'g-choice');
    for (const f of FORMS) {
      const b = button(tr('form.' + f.id), 'g-pill' + (this.w.form.type === f.id ? ' is-on' : ''));
      b.dataset.id = f.id;
      b.addEventListener('click', () => { this.w.form.type = f.id; this.changed(); });
      shapes.append(b);
    }
    const slider = (label, a, z, key) => {
      const l = el('label', 'g-range');
      const r = el('input');
      Object.assign(r, { type: 'range', min: 0, max: 1, step: 0.01, value: this.w.form[key] });
      r.setAttribute('aria-label', label);
      r.addEventListener('change', () => { this.w.form[key] = +r.value; this.changed(); });
      l.append(el('span', null, a), r, el('span', null, z));
      return [l, r];
    };
    const [energy, er] = slider(tr('g.movement'), tr('g.still'), tr('g.lively'), 'energy');
    const [density, dr] = slider(tr('g.starCount'), tr('g.few'), tr('g.many'), 'density');
    this.syncs.get(panel).push(() => {
      colours.querySelectorAll('input').forEach((x, i) => { if (x !== document.activeElement) x.value = this.w.palette[i]; });
      shapes.querySelectorAll('.g-pill').forEach((x) => x.classList.toggle('is-on', x.dataset.id === this.w.form.type));
      er.value = this.w.form.energy; dr.value = this.w.form.density;
    });
    return { colours, shapes, energy, density };
  }

  finish() {
    const wrap = el('div', 'g-finish');
    const raise = button(this.editing ? tr('g.save') : tr('g.put'), 'g-btn g-btn--main g-btn--big');
    raise.addEventListener('click', () => { this.stopPaint(); this.onRelease(this.w); });
    // Each plot has its fair share of the city's free space for pictures, sounds and videos.
    const meter = el('p', 'guide__calm');
    let uploaded = 0;
    this.showSpace = () => {
      if (!isOnline()) { meter.textContent = tr('g.savesItself'); return; }
      let fresh = 0;
      const visit = (list) => (list || []).forEach((m) => { if (m.src?.startsWith('data:')) fresh += m.src.length * 0.75; });
      this.w.fragments.forEach((f) => visit(f.media));
      (this.w.process?.steps || []).forEach((st) => visit(st.media));
      const mb = (v) => (v / 1e6).toFixed(v < 10e6 ? 1 : 0);
      meter.textContent = tr('g.space', { quota: mb(this.quota || 75e6), used: mb(uploaded + fresh) });
    };
    if (this.editing) space(this.w.id).then((r) => { if (r) { uploaded = r.used; this.quota = r.quota; this.showSpace(); } }).catch(() => {});
    this.showSpace();
    wrap.append(raise, meter);
    if (!this.editing) {
      // An AI can write a whole world as text; this takes it in as it is.
      const ai = el('details', 'g-looks');
      ai.append(el('summary', null, tr('g.aiPaste')));
      const box = el('textarea', 'g-text');
      Object.assign(box, { rows: 5, placeholder: '{ "title": … }' });
      const use = button(tr('g.useIt'));
      use.addEventListener('click', () => {
        const t = box.value, a = t.indexOf('{'), b = t.lastIndexOf('}');
        try { this.onImport(JSON.parse(t.slice(a, b + 1))); } catch { toast(tr('g.aiBad')); }
      });
      ai.append(box, use);
      wrap.append(ai);
    }
    if (this.editing) {
      const rm = button(tr('ws.remove'), 'g-card__remove');
      rm.addEventListener('click', () => { if (confirm(tr('g.confirmRemove'))) this.onDelete(this.w.id); });
      wrap.append(rm);
    }
    return wrap;
  }
}
