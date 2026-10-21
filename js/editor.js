// The workshop: a form on the left, the world growing live on the right.
import { FORMS, PALETTES, NOTES, normalizeWorld, saveDraft, exportable } from './store.js';
import { el, roman, slugify, toast } from './util.js';

const BLANK = {
  title: '', creator: { name: '', nature: 'human' }, statement: '',
  palette: PALETTES[1].colors.slice(),
  form: { type: 'bloom', energy: 0.45, density: 0.6 },
  sound: { root: 98, mood: 'warm' },
  fragments: [
    { title: 'The first thing I fell for', text: '', link: '' },
    { title: 'A detail nobody notices', text: '', link: '' },
    { title: 'Where it is taking me', text: '', link: '' },
  ],
};

export class Editor {
  constructor({ onChange, onRelease, onDelete }) {
    this.root = document.getElementById('editor');
    this.form = document.getElementById('editor-form');
    this.list = document.getElementById('fragments-list');
    this.onChange = onChange;
    this.onRelease = onRelease;
    this.onDelete = onDelete;
    this.build();
  }

  build() {
    const f = this.form.elements;
    for (const p of [{ name: 'Choose a palette…' }, ...PALETTES]) {
      const o = el('option', null, p.name);
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
      span.append(el('b', null, t.name), el('small', null, t.note));
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
    document.getElementById('add-fragment').addEventListener('click', () => {
      if (this.list.children.length >= 9) return toast('Nine fragments is the limit, for now.');
      this.addFragment({ title: '', text: '', link: '' }, true);
      this.emit();
    });
    document.getElementById('export-json').addEventListener('click', () => this.download());
    document.getElementById('import-json').addEventListener('change', (e) => this.import(e.target.files[0]));
    document.getElementById('delete-world').addEventListener('click', () => {
      if (this.editingId && confirm('Remove this world from your browser?')) this.onDelete(this.editingId);
    });
  }

  open(world, { editingId = null } = {}) {
    this.editingId = editingId;
    document.getElementById('delete-world').hidden = !editingId;
    this.write(world ? normalizeWorld(world) : normalizeWorld(BLANK));
    this.root.hidden = false;
    this.root.scrollTop = 0;
    return this.read();
  }

  close() { this.root.hidden = true; }

  write(w) {
    const f = this.form.elements;
    f.title.value = w.title === 'Untitled world' ? '' : w.title;
    f.creator.value = w.creator.name === 'Anonymous' ? '' : w.creator.name;
    f.nature.value = w.creator.nature;
    f.statement.value = w.statement;
    w.palette.forEach((c, i) => { f['c' + i].value = c; });
    f.preset.value = '';
    f.formType.value = w.form.type;
    f.energy.value = w.form.energy;
    f.density.value = w.form.density;
    const nearest = NOTES.reduce((a, b) => (Math.abs(b[1] - w.sound.root) < Math.abs(a[1] - w.sound.root) ? b : a));
    f.root.value = nearest[1];
    f.mood.value = w.sound.mood;
    this.list.replaceChildren();
    w.fragments.forEach((fr) => this.addFragment(fr));
    this.renumber();
  }

  addFragment(fr, focus = false) {
    const item = el('div', 'fragment-item');
    const num = el('span', 'numeral');
    const title = el('input');
    Object.assign(title, { placeholder: 'Title of the fragment', maxLength: 80, value: fr.title });
    title.dataset.k = 'title';
    const text = el('textarea');
    Object.assign(text, { placeholder: 'Tell it the way you would to a friend who asked why you care.', rows: 3, maxLength: 1200, value: fr.text });
    text.dataset.k = 'text';
    const link = el('input');
    Object.assign(link, { placeholder: 'Optional link (https://…)', type: 'url', value: fr.link || '' });
    link.dataset.k = 'link';
    const remove = el('button', 'remove', 'remove');
    remove.type = 'button';
    remove.addEventListener('click', () => { item.remove(); this.renumber(); this.emit(); });
    item.append(remove, num, title, text, link);
    this.list.append(item);
    this.renumber();
    if (focus) title.focus();
  }

  renumber() {
    [...this.list.children].forEach((c, i) => { c.querySelector('.numeral').textContent = 'Fragment ' + roman(i + 1); });
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
      form: { type: f.formType.value, energy: +f.energy.value, density: +f.density.value },
      sound: { root: +f.root.value, mood: f.mood.value },
      fragments: [...this.list.children].map((c) => ({
        title: c.querySelector('[data-k=title]').value,
        text: c.querySelector('[data-k=text]').value,
        link: c.querySelector('[data-k=link]').value,
      })).filter((x) => x.title.trim() || x.text.trim()),
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
      toast('World imported. Release it to keep it.');
    } catch {
      toast('That file is not a world we can read.');
    }
  }
}
