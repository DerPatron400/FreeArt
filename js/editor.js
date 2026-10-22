// The workshop: a form on the left, the world growing live on the right.
import { FORMS, PALETTES, NOTES, normalizeWorld, saveDraft, exportable } from './store.js';
import { el, roman, slugify, toast } from './util.js';
import { PIECES, PIECE_DEFAULTS, PRESETS, MAX_PIECES, normalizeBuild } from './build.js';
import { KINDS, MAX_MEDIA, SHOWABLE, sketchSvg, melodyPlayer, constellationSvg } from './media.js';
import { sketchPad, melodyGrid } from './tools.js';
import { Guide } from './guide.js';
import { t as tr } from './i18n.js';

const STEP_PROMPTS = [0, 1, 2, 3].map((i) => [tr('step.title' + i), tr('step.text' + i)]);

// Shrink a picture to a sensible size and keep it inline, so it travels with the world.
export function imageToData(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

const BLANK = {
  title: '', creator: { name: '', nature: 'human' }, statement: '',
  palette: PALETTES[1].colors.slice(),
  form: { type: 'bloom', energy: 0.45, density: 0.6 },
  sound: { root: 98, mood: 'warm' },
  fragments: [],
};

export class Editor {
  constructor({ onChange, onRelease, onDelete, onPaint = () => {} }) {
    this.root = document.getElementById('editor');
    this.form = document.getElementById('editor-form');
    this.list = document.getElementById('fragments-list');
    this.stepList = document.getElementById('steps-list');
    this.pieceList = document.getElementById('build-list');
    this.buildData = null;
    this.onChange = onChange;
    this.onRelease = onRelease;
    this.onDelete = onDelete;
    this.build();
    // Most people start with the gentle questions; the full workshop is one tap away.
    this.guide = new Guide(this.root, {
      onChange: (w) => {
        const n = normalizeWorld({ ...w, plot: this.plot });
        saveDraft(exportable(n));
        this.onChange(n);
      },
      onRelease: (w) => { this.write(normalizeWorld(w)); this.onRelease(this.read()); },
      onWorkshop: (w) => { this.write(normalizeWorld(w)); this.setMode('workshop'); this.emit(); },
      onPaint,
      onDelete: (id) => this.onDelete(id),
      onImport: (raw) => {
        const w = normalizeWorld({ ...raw, plot: raw.plot || this.plot });
        this.editingId = null;
        this.suffix = null;
        this.write(w);
        this.guide.load(this.read(), this.plotLabel);
        this.emit();
        toast(tr('ws.aiHere'));
      },
    });
    document.getElementById('to-guide').addEventListener('click', () => {
      this.guide.load(this.read(), this.plotLabel, { editing: !!this.editingId });
      this.setMode('guide');
    });
  }

  setMode(mode) {
    this.mode = mode;
    try { localStorage.setItem('freeart.editor', mode); } catch {}
    this.form.hidden = mode === 'guide';
    this.guide.show(mode === 'guide');
    this.root.scrollTop = 0;
  }

  build() {
    const f = this.form.elements;
    for (const [i, p] of [{}, ...PALETTES].entries()) {
      const o = el('option', null, i ? tr('pal.' + (i - 1)) : tr('ws.choosePalette'));
      o.value = p.colors ? p.colors.join(',') : '';
      f.preset.append(o);
    }
    for (const [name, hz] of NOTES) {
      const o = el('option', null, name);
      o.value = hz;
      f.root.append(o);
    }
    const formsRoot = document.getElementById('form-types');
    for (const t of FORMS) {
      const label = el('label', 'form-type');
      const input = el('input');
      Object.assign(input, { type: 'radio', name: 'formType', value: t.id });
      const span = el('span');
      span.append(el('b', null, tr('form.' + t.id)), el('small', null, tr('formNote.' + t.id)));
      label.append(input, span);
      formsRoot.append(label);
    }

    this.form.addEventListener('input', (e) => {
      if (e.target.name === 'preset') {
        if (!e.target.value) return;
        e.target.value.split(',').forEach((c, i) => { f['c' + i].value = c; });
      }
      this.emit();
    });
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!this.form.reportValidity()) return;
      this.onRelease(this.read());
    });
    document.getElementById('add-step').addEventListener('click', () => {
      if (this.stepList.children.length >= 12) return toast(tr('ws.maxSteps'));
      this.addStep({ when: '', title: '', text: '', media: [] }, true);
      this.emit();
    });
    document.getElementById('add-fragment').addEventListener('click', () => {
      if (this.list.children.length >= 9) return toast(tr('ws.maxFragments'));
      this.addFragment({ title: '', text: '', link: '' }, true);
      this.emit();
    });
    this.bindBuild();
    document.getElementById('export-json').addEventListener('click', () => this.download());
    document.getElementById('import-json').addEventListener('change', (e) => this.import(e.target.files[0]));
    document.getElementById('delete-world').addEventListener('click', () => {
      if (this.editingId && confirm(tr('g.confirmRemove'))) this.onDelete(this.editingId);
    });
  }

  open(world, { editingId = null, plot = null, plotLabel = '' } = {}) {
    this.editingId = editingId;
    this.plot = plot;
    document.getElementById('editor-plot').textContent = plotLabel;
    document.getElementById('delete-world').hidden = !editingId;
    this.write(world ? normalizeWorld(world) : normalizeWorld(BLANK));
    this.plotLabel = plotLabel;
    this.root.hidden = false;
    let mode = 'guide';
    try { mode = localStorage.getItem('freeart.editor') || 'guide'; } catch {}
    if (mode === 'guide') this.guide.load(this.read(), plotLabel, { editing: !!editingId });
    this.setMode(mode);
    return this.read();
  }

  close() { this.guide.show(false); this.root.hidden = true; }

  write(w) {
    const f = this.form.elements;
    f.title.value = w.title === 'Untitled world' ? '' : w.title;
    f.creator.value = w.creator.name === 'Anonymous' ? '' : w.creator.name;
    f.nature.value = w.creator.nature;
    f.statement.value = w.statement;
    w.palette.forEach((c, i) => { f['c' + i].value = c; });
    f.preset.value = '';
    f.formType.value = w.form.type;
    this.strokes = w.form.strokes;
    f.energy.value = w.form.energy;
    f.density.value = w.form.density;
    const nearest = NOTES.reduce((a, b) => (Math.abs(b[1] - w.sound.root) < Math.abs(a[1] - w.sound.root) ? b : a));
    f.root.value = nearest[1];
    f.mood.value = w.sound.mood;
    this.setBuild(w.build);
    this.list.replaceChildren();
    w.fragments.forEach((fr) => this.addFragment(fr));
    this.stepList.replaceChildren();
    (w.process?.steps || []).forEach((st) => this.addStep(st));
    this.renumber();
  }

  // ---- building on the plot ----

  bindBuild() {
    const presets = document.getElementById('build-presets');
    for (const [id, p] of [['empty', {}], ...Object.entries(PRESETS)]) {
      const b = el('button', null, tr('preset.' + id));
      b.type = 'button';
      b.addEventListener('click', () => { this.setBuild(id === 'empty' ? null : structuredClone(p.build)); this.emit(); });
      presets.append(b);
    }
    const select = document.getElementById('build-piece');
    for (const p of PIECES) {
      const o = el('option', null, `${tr('piece.' + p.id)} · ${tr('pieceNote.' + p.id)}`);
      o.value = p.id;
      select.append(o);
    }
    document.getElementById('build-add').addEventListener('click', () => {
      const b = this.buildData || { pieces: [] };
      if (b.pieces.length >= MAX_PIECES) return toast(tr('ws.maxPieces', { n: MAX_PIECES }));
      const type = select.value;
      b.pieces.push({ type, at: [0, 0, 0], size: PIECE_DEFAULTS[type].slice(), turn: 0, tone: 2 });
      this.setBuild(b);
      this.emit();
      this.pieceList.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    const fy = document.getElementById('form-y'), fs = document.getElementById('form-s');
    const formInput = () => {
      const b = this.buildData;
      if (!b) return;
      b.form ||= { at: [0, 0.5, 0], scale: 0.8 };
      b.form.at[1] = +fy.value;
      b.form.scale = +fs.value;
    };
    fy.addEventListener('input', formInput);
    fs.addEventListener('input', formInput);
    document.getElementById('build-apply').addEventListener('click', () => {
      try {
        const raw = JSON.parse(document.getElementById('build-json').value);
        const b = normalizeBuild(raw.build || (Array.isArray(raw) ? { pieces: raw } : raw));
        if (!b) throw new Error('empty');
        this.setBuild(b);
        this.emit();
        toast(tr('ws.buildPlaced', { n: b.pieces.length }));
      } catch {
        toast(tr('ws.buildBad'));
      }
    });
  }

  setBuild(build) {
    this.buildData = build ? normalizeBuild(build) : null;
    if (this.buildData && !this.buildData.form) this.buildData.form = { at: [0, 0.5, 0], scale: 0.6 };
    const b = this.buildData;
    document.getElementById('build-form').hidden = !b;
    if (b) {
      document.getElementById('form-y').value = b.form.at[1];
      document.getElementById('form-s').value = b.form.scale;
    }
    this.pieceList.replaceChildren(...(b ? b.pieces.map((p, i) => this.pieceItem(p, i)) : []));
  }

  pieceItem(p, i) {
    const info = PIECES.find((x) => x.id === p.type);
    const item = el('div', 'piece');
    item.append(el('span', 'piece__name', `${roman(i + 1)} · ${tr('piece.' + info.id)}`));
    const slider = (label, min, max, step, get, set) => {
      const l = el('label');
      const input = el('input');
      Object.assign(input, { type: 'range', min, max, step, value: get() });
      input.addEventListener('input', () => set(+input.value));
      l.append(el('span', 'mono', label), input);
      item.append(l);
    };
    slider(tr('sl.x'), -0.5, 0.5, 0.01, () => p.at[0], (v) => { p.at[0] = v; });
    slider(tr('sl.z'), -0.5, 0.5, 0.01, () => p.at[2], (v) => { p.at[2] = v; });
    slider(tr('sl.lift'), 0, 1.5, 0.01, () => p.at[1], (v) => { p.at[1] = v; });
    slider(tr('sl.turn'), 0, 1, 0.01, () => p.turn, (v) => { p.turn = v; });
    slider(tr('sl.tilt'), -0.5, 0.5, 0.01, () => p.tilt || 0, (v) => { p.tilt = v; });
    slider(tr('sl.width'), 0.01, 1, 0.01, () => p.size[0], (v) => { p.size[0] = v; });
    slider(tr('ws.height'), 0.01, 2, 0.01, () => p.size[1], (v) => { p.size[1] = v; });
    slider(tr('sl.depth'), 0.01, 1, 0.01, () => p.size[2], (v) => { p.size[2] = v; });
    if (info.count) slider(tr('sl.count'), info.count[0], info.count[1], 1, () => p.count, (v) => { p.count = v; });
    const tones = el('div', 'tones');
    const f = this.form.elements;
    [0, 1, 2].forEach((t) => {
      const b = el('button');
      b.type = 'button';
      b.title = tr('colour.' + t);
      b.style.background = f['c' + t].value;
      b.classList.toggle('is-on', p.tone === t);
      b.addEventListener('click', () => {
        p.tone = t;
        tones.querySelectorAll('button').forEach((x, j) => x.classList.toggle('is-on', j === t));
        this.emit();
      });
      tones.append(b);
    });
    const tl = el('label');
    tl.append(el('span', 'mono', tr('sl.colour')), tones);
    item.append(tl);
    const remove = el('button', 'remove', tr('ws.removeSmall'));
    remove.type = 'button';
    remove.addEventListener('click', () => {
      this.buildData.pieces.splice(i, 1);
      this.setBuild(this.buildData.pieces.length ? this.buildData : null);
      this.emit();
    });
    item.append(remove);
    return item;
  }

  // ---- the story of the obsession ----

  addStep(st, focus = false) {
    const item = el('div', 'step-item');
    const i = this.stepList.children.length;
    const [ph, phText] = STEP_PROMPTS[Math.min(i, STEP_PROMPTS.length - 1)];
    const num = el('span', 'numeral');
    const when = el('input');
    Object.assign(when, { placeholder: tr('ws.whenPh'), maxLength: 40, value: st.when || '' });
    when.dataset.k = 'when';
    const title = el('input');
    Object.assign(title, { placeholder: ph, maxLength: 80, value: st.title || '' });
    title.dataset.k = 'title';
    const text = el('textarea');
    Object.assign(text, { placeholder: phText, rows: 4, maxLength: 2000, value: st.text || '' });
    text.dataset.k = 'text';
    const remove = el('button', 'remove', tr('ws.removeSmall'));
    remove.type = 'button';
    remove.addEventListener('click', () => { item.remove(); this.renumber(); this.emit(); });
    item._media = (st.media || []).map((m) => structuredClone(m));
    item.append(remove, num, when, title, text, this.mediaEditor(item._media));
    this.stepList.append(item);
    this.renumber();
    if (focus) title.focus();
  }

  // ---- media for fragments and steps ----

  palette() {
    const f = this.form.elements;
    return [f.c0.value, f.c1.value, f.c2.value];
  }

  mediaEditor(list) {
    const wrap = el('div', 'media-edit');
    const rows = el('div', 'media-edit');
    const add = el('div', 'media-edit__add');
    add.append(el('span', 'mono', tr('ws.showIt')));
    for (const k of KINDS) {
      const b = el('button', 'tool-btn mono', '+ ' + tr('kind.' + k.id));
      b.type = 'button';
      b.title = k.note;
      b.addEventListener('click', async () => {
        if (list.length >= MAX_MEDIA) return toast(tr('ws.maxMedia', { n: MAX_MEDIA }));
        const m = { kind: k.id };
        if (k.id === 'sketch') { const sk = await sketchPad(this.palette()); if (!sk) return; m.sketch = sk; }
        if (k.id === 'melody') { const mel = await melodyGrid(this.palette()); if (!mel) return; m.melody = mel; }
        if (k.id === 'sculpture') m.build = structuredClone(PRESETS.tempietto.build);
        if (k.id === 'poem') m.poem = { lines: [], motion: 'gather' };
        if (k.id === 'constellation') m.constellation = { nodes: [], edges: [] };
        list.push(m);
        draw();
        this.emit();
      });
      add.append(b);
    }
    const draw = () => rows.replaceChildren(...list.map((m, i) => this.mediaRow(m, () => { list.splice(i, 1); draw(); this.emit(); }, draw)));
    draw();
    wrap.append(rows, add);
    return wrap;
  }

  mediaRow(m, remove, redraw) {
    const row = el('div', 'media-row');
    const kind = KINDS.find((k) => k.id === m.kind);
    row.append(el('span', 'media-row__kind', kind.name));
    const rm = el('button', 'remove', tr('ws.removeSmall'));
    rm.type = 'button';
    rm.addEventListener('click', remove);
    row.append(rm);
    const input = (type, placeholder, value, on) => {
      const x = el('input');
      Object.assign(x, { type, placeholder, value: value || '' });
      x.addEventListener('input', () => on(x.value.trim()));
      return x;
    };
    if (m.kind === 'image') {
      if (m.src) { const t = el('img', 'thumb'); t.src = m.src; t.alt = ''; row.append(t); }
      const file = el('input');
      Object.assign(file, { type: 'file', accept: 'image/*' });
      file.addEventListener('change', async () => {
        try { m.src = await imageToData(file.files[0]); redraw(); this.emit(); } catch { toast(tr('g.badPicture')); }
      });
      row.append(file, input('url', tr('ws.imageLink'), m.src?.startsWith('data:') ? '' : m.src, (v) => { m.src = v; }));
    } else if (['video', 'audio', 'model'].includes(m.kind)) {
      const hint = tr('ws.link.' + m.kind);
      row.append(input('url', hint, m.src, (v) => { m.src = v; }));
    } else if (m.kind === 'sketch') {
      if (m.sketch) row.append(sketchSvg(m.sketch, this.palette(), { animate: false }));
      const b = el('button', 'tool-btn mono', m.sketch ? tr('g.keepDrawing') : tr('ws.draw1'));
      b.type = 'button';
      b.addEventListener('click', async () => { const sk = await sketchPad(this.palette(), m.sketch); if (sk) { m.sketch = sk; redraw(); this.emit(); } });
      row.append(b);
    } else if (m.kind === 'melody') {
      if (m.melody) row.append(melodyPlayer(m.melody, this.palette()));
      const b = el('button', 'tool-btn mono', tr('ws.compose'));
      b.type = 'button';
      b.addEventListener('click', async () => { const mel = await melodyGrid(this.palette(), m.melody); if (mel) { m.melody = mel; redraw(); this.emit(); } });
      row.append(b);
    } else if (m.kind === 'sculpture') {
      const sel = el('select', 'mono');
      for (const [id, p] of Object.entries(PRESETS)) { const o = el('option', null, tr('ws.startFrom', { name: tr('preset.' + id) })); o.value = id; sel.append(o); }
      sel.addEventListener('change', () => { m.build = structuredClone(PRESETS[sel.value].build); ta.value = JSON.stringify(m.build.pieces); this.emit(); });
      const ta = el('textarea');
      Object.assign(ta, { rows: 3, value: JSON.stringify(m.build?.pieces || []), placeholder: tr('ws.piecesPh') });
      ta.addEventListener('change', () => {
        try { const pieces = JSON.parse(ta.value); m.build = { pieces: Array.isArray(pieces) ? pieces : pieces.pieces }; this.emit(); } catch { toast(tr('ws.piecesBad')); }
      });
      row.append(sel, ta);
    } else if (m.kind === 'poem') {
      const ta = el('textarea');
      Object.assign(ta, { rows: 4, value: (m.poem?.lines || []).join('\n'), placeholder: tr('ws.poemPh') });
      ta.style.fontFamily = 'inherit';
      ta.addEventListener('input', () => { m.poem = { lines: ta.value.split('\n').map((l) => l.trim()).filter(Boolean), motion: m.poem?.motion || 'gather' }; });
      const motion = el('select', 'mono');
      for (const v of ['gather', 'drift', 'still']) { const o = el('option', null, tr('motion.' + v)); o.value = v; motion.append(o); }
      motion.value = m.poem?.motion || 'gather';
      motion.addEventListener('change', () => { m.poem = { ...(m.poem || { lines: [] }), motion: motion.value }; this.emit(); });
      row.append(ta, motion);
    } else if (m.kind === 'constellation') {
      if (m.constellation?.nodes?.length) row.append(constellationSvg(m.constellation, this.palette()));
      const ta = el('textarea');
      const toText = (c) => {
        const seen = new Set(), lines = c.edges.map(([a, b]) => { seen.add(a); seen.add(b); return `${c.nodes[a].label} -> ${c.nodes[b].label}`; });
        c.nodes.forEach((n, i) => { if (!seen.has(i)) lines.push(n.label); });
        return lines.join('\n');
      };
      Object.assign(ta, { rows: 4, value: m.constellation ? toText(m.constellation) : '', placeholder: tr('ws.constPh') });
      ta.addEventListener('change', () => {
        const nodes = [], edges = [], index = new Map();
        const node = (label) => { label = label.trim().slice(0, 48); if (!index.has(label)) { index.set(label, nodes.length); nodes.push({ label, tone: nodes.length ? 2 : 1 }); } return index.get(label); };
        for (const line of ta.value.split('\n')) {
          const parts = line.split(/->|→/).map((x) => x.trim()).filter(Boolean);
          for (let i = 0; i < parts.length; i++) { const a = node(parts[i]); if (i) edges.push([index.get(parts[i - 1]), a]); }
        }
        m.constellation = { nodes, edges };
        setTimeout(redraw); // not during the blur that fired this change
        this.emit();
      });
      row.append(ta);
    }
    if (SHOWABLE.includes(m.kind)) {
      const l = el('label', 'mono media-row__show');
      const cb = el('input');
      Object.assign(cb, { type: 'checkbox', checked: !!m.show });
      cb.addEventListener('change', () => { m.show = cb.checked; this.emit(); });
      l.append(cb, ' ' + tr('ws.showInCity'));
      row.append(l);
    }
    row.append(input('text', tr('ws.captionPh'), m.caption, (v) => { m.caption = v; }));
    return row;
  }

  addFragment(fr, focus = false) {
    const item = el('div', 'fragment-item');
    const num = el('span', 'numeral');
    const title = el('input');
    Object.assign(title, { placeholder: tr('ws.fragTitlePh'), maxLength: 80, value: fr.title });
    title.dataset.k = 'title';
    const text = el('textarea');
    Object.assign(text, { placeholder: tr('ws.fragTextPh'), rows: 3, maxLength: 1200, value: fr.text });
    text.dataset.k = 'text';
    const link = el('input');
    Object.assign(link, { placeholder: tr('ws.linkPh'), type: 'url', value: fr.link || '' });
    link.dataset.k = 'link';
    const remove = el('button', 'remove', tr('ws.removeSmall'));
    remove.type = 'button';
    remove.addEventListener('click', () => { item.remove(); this.renumber(); this.emit(); });
    item._media = (fr.media || []).map((m) => structuredClone(m));
    item.append(remove, num, title, text, link, this.mediaEditor(item._media));
    this.list.append(item);
    this.renumber();
    if (focus) title.focus();
  }

  renumber() {
    [...this.list.children].forEach((c, i) => { c.querySelector('.numeral').textContent = tr('ws.fragmentN', { n: roman(i + 1) }); });
    [...(this.stepList?.children || [])].forEach((c, i) => { c.querySelector('.numeral').textContent = tr('ws.stepN', { n: roman(i + 1) }); });
  }

  read() {
    const f = this.form.elements;
    const title = f.title.value.trim();
    return normalizeWorld({
      id: this.editingId || slugify(title || 'untitled') + '-' + (this.suffix ||= Math.random().toString(36).slice(2, 6)),
      title,
      creator: { name: f.creator.value, nature: f.nature.value },
      statement: f.statement.value,
      palette: [f.c0.value, f.c1.value, f.c2.value],
      form: { type: f.formType.value, energy: +f.energy.value, density: +f.density.value, strokes: this.strokes },
      sound: { root: +f.root.value, mood: f.mood.value },
      fragments: [...this.list.children].map((c) => ({
        title: c.querySelector('[data-k=title]').value,
        text: c.querySelector('[data-k=text]').value,
        link: c.querySelector('[data-k=link]').value,
        media: c._media,
      })).filter((x) => x.title.trim() || x.text.trim() || x.media.length),
      process: { steps: [...this.stepList.children].map((c) => ({
        when: c.querySelector('[data-k=when]').value,
        title: c.querySelector('[data-k=title]').value,
        text: c.querySelector('[data-k=text]').value,
        media: c._media,
      })) },
      build: this.buildData,
      plot: this.plot,
      created: new Date().toISOString().slice(0, 10),
    });
  }

  emit() {
    const f = this.form.elements;
    f.energyOut.value = Math.round(f.energy.value * 100);
    f.densityOut.value = Math.round(f.density.value * 100);
    const w = this.read();
    saveDraft(exportable(w));
    this.onChange(w);
  }

  download() {
    const w = exportable(this.read());
    const blob = new Blob([JSON.stringify(w, null, 2) + '\n'], { type: 'application/json' });
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = w.id + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async import(file) {
    if (!file) return;
    try {
      const w = normalizeWorld(JSON.parse(await file.text()));
      this.editingId = null;
      this.suffix = null;
      this.write(w);
      this.emit();
      toast(tr('ws.imported'));
    } catch {
      toast(tr('ws.importBad'));
    }
  }
}
