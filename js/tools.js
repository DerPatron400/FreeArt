// Making tools for the workshop: a sketch pad and a melody grid. Each opens in
// a dialog and resolves to plain data (the same format machines write), or null.
import { el } from './util.js';
import { melodyFreq, melodyPlayer, inkColors } from './media.js';
import { t } from './i18n.js';

function dialog(title) {
  const root = el('div', 'tool');
  const box = el('div', 'tool__box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', title);
  box.append(el('h3', 'tool__title', title));
  root.append(box);
  document.body.append(root);
  return { root, box };
}

function button(text, cls = 'tool-btn mono') {
  const b = el('button', cls, text);
  b.type = 'button';
  return b;
}

const r1 = (v) => Math.round(v * 10) / 10;

// Freehand drawing with the world's three colours. Strokes become smooth SVG paths.
export function sketchPad(palette, existing) {
  palette = inkColors(palette);
  return new Promise((resolve) => {
    const { root, box } = dialog(t('tool.sketch'));
    // Re-editing keeps the sketch's own coordinate space, so machine-made paths stay intact.
    const [W, H] = existing?.view || [800, 600];
    const canvas = el('canvas', 'pad');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const paths = existing?.paths ? existing.paths.map((p) => ({ ...p })) : [];
    let tone = 2, width = 3;

    const bar = el('div', 'tool__bar');
    const swatches = palette.map((c, i) => {
      const s = button('', 'swatch');
      s.style.background = c;
      s.title = t('colour.' + i);
      s.addEventListener('click', () => { tone = i; swatches.forEach((x, j) => x.classList.toggle('is-on', j === i)); });
      return s;
    });
    swatches[2].classList.add('is-on');
    const size = el('input');
    Object.assign(size, { type: 'range', min: 1, max: 16, step: 0.5, value: width });
    size.addEventListener('input', () => { width = +size.value; });
    const sizeLabel = el('label', 'mono', t('tool.line'));
    sizeLabel.append(size);
    const undo = button(t('g.undo')), clear = button(t('g.clear'));
    bar.append(...swatches, sizeLabel, undo, clear);

    const draw = () => {
      g.clearRect(0, 0, W, H);
      g.lineCap = g.lineJoin = 'round';
      for (const p of paths) {
        g.save();
        const path = new Path2D(p.d);
        g.strokeStyle = palette[p.tone];
        g.lineWidth = p.width;
        if (p.fill) { g.globalAlpha = 0.35; g.fillStyle = palette[p.tone]; g.fill(path); g.globalAlpha = 1; }
        g.stroke(path);
        g.restore();
      }
    };

    let pts = null;
    const at = (e) => {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
    };
    const toD = (ps) => {
      if (ps.length < 2) return `M${r1(ps[0][0])} ${r1(ps[0][1])}l0.1 0`;
      let d = `M${r1(ps[0][0])} ${r1(ps[0][1])}`;
      for (let i = 1; i < ps.length - 1; i++) {
        const [x, y] = ps[i], [nx, ny] = ps[i + 1];
        d += `Q${r1(x)} ${r1(y)} ${r1((x + nx) / 2)} ${r1((y + ny) / 2)}`;
      }
      const [lx, ly] = ps[ps.length - 1];
      return d + `L${r1(lx)} ${r1(ly)}`;
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pts = [at(e)];
      paths.push({ d: toD(pts), tone, width: width * (W / 800) });
      draw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!pts) return;
      const p = at(e), q = pts[pts.length - 1];
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 3 * (W / 800)) return;
      pts.push(p);
      paths[paths.length - 1].d = toD(pts);
      draw();
    });
    const end = () => { pts = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    undo.addEventListener('click', () => { paths.pop(); draw(); });
    clear.addEventListener('click', () => { paths.length = 0; draw(); });

    const actions = el('div', 'tool__bar');
    const done = button(t('tool.keepSketch'), 'btn btn--primary btn--small'), cancel = button(t('ui.cancel'));
    actions.append(done, cancel);
    box.append(bar, canvas, actions);
    draw();

    const close = (value) => { root.remove(); resolve(value); };
    cancel.addEventListener('click', () => close(null));
    done.addEventListener('click', () => {
      if (!paths.length) return close(null);
      const out = paths.map((p) => ({ d: p.d, tone: p.tone, width: r1(p.width), ...(p.fill ? { fill: true } : {}) }));
      close({ view: [W, H], paths: out });
    });
  });
}

// A step grid: columns are time, rows are notes of a scale. Plays with a soft pluck.
export function melodyGrid(palette, existing) {
  return new Promise((resolve) => {
    const { root, box } = dialog(t('tool.melody'));
    const m = existing ? structuredClone(existing) : { steps: 16, notes: [], tempo: 84, scale: 'pentatonic', root: 220, loop: true };
    const ROWS = 12;
    const bar = el('div', 'tool__bar');
    const scale = el('select', 'mono');
    for (const s of ['pentatonic', 'major', 'minor', 'dorian']) { const o = el('option', null, t('scale.' + s)); o.value = s; scale.append(o); }
    scale.value = m.scale;
    const length = el('select', 'mono');
    for (const n of [8, 16, 32]) { const o = el('option', null, t('tool.steps', { n })); o.value = n; length.append(o); }
    length.value = m.steps;
    const tempo = el('input');
    Object.assign(tempo, { type: 'range', min: 40, max: 180, value: m.tempo });
    const tl = el('label', 'mono', t('tool.tempo'));
    tl.append(tempo);
    const sl = el('label', 'mono', t('tool.scale')); sl.append(scale);
    const ll = el('label', 'mono', t('tool.length')); ll.append(length);
    const play = button(t('ui.play')), clear = button(t('g.clear'));
    bar.append(sl, ll, tl, play, clear);
    const grid = el('div', 'grid-roll');

    const has = (s, d) => m.notes.some((n) => n[0] === s && n[1] === d);
    const render = () => {
      grid.style.gridTemplateColumns = `repeat(${m.steps}, 1fr)`;
      grid.replaceChildren();
      for (let d = ROWS - 1; d >= 0; d--) for (let s = 0; s < m.steps; s++) {
        const c = button('', has(s, d) ? 'is-on' : '');
        if (s % 4 === 0) c.classList.add('is-beat');
        c.dataset.step = s;
        c.addEventListener('click', () => {
          if (has(s, d)) m.notes = m.notes.filter((n) => !(n[0] === s && n[1] === d));
          else { m.notes.push([s, d, 1]); preview(d); }
          c.classList.toggle('is-on');
        });
        grid.append(c);
      }
    };
    let ac;
    const preview = (d) => {
      ac ||= new (window.AudioContext || window.webkitAudioContext)();
      const t = ac.currentTime, o = ac.createOscillator(), gn = ac.createGain();
      o.type = 'triangle'; o.frequency.value = melodyFreq(m, d);
      gn.gain.setValueAtTime(0.14, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.connect(gn).connect(ac.destination); o.start(t); o.stop(t + 0.55);
    };
    let timer = null;
    const stop = () => { clearInterval(timer); timer = null; play.textContent = t('ui.play'); grid.querySelectorAll('.is-now').forEach((x) => x.classList.remove('is-now')); };
    play.addEventListener('click', () => {
      if (timer) return stop();
      let step = 0;
      play.textContent = t('ui.stop');
      const tick = () => {
        grid.querySelectorAll('.is-now').forEach((x) => x.classList.remove('is-now'));
        grid.querySelectorAll(`[data-step="${step}"]`).forEach((x) => x.classList.add('is-now'));
        for (const [s, d] of m.notes) if (s === step) preview(d);
        step = (step + 1) % m.steps;
      };
      tick();
      timer = setInterval(tick, (60 / m.tempo / 2) * 1000);
    });
    scale.addEventListener('change', () => { m.scale = scale.value; });
    length.addEventListener('change', () => { m.steps = +length.value; m.notes = m.notes.filter((n) => n[0] < m.steps); stop(); render(); });
    tempo.addEventListener('input', () => { m.tempo = +tempo.value; if (timer) { stop(); play.click(); } });
    clear.addEventListener('click', () => { m.notes = []; render(); });

    const actions = el('div', 'tool__bar');
    const done = button(t('tool.keepMelody'), 'btn btn--primary btn--small'), cancel = button(t('ui.cancel'));
    actions.append(done, cancel);
    box.append(bar, grid, actions);
    render();
    const close = (v) => { stop(); root.remove(); resolve(v); };
    cancel.addEventListener('click', () => close(null));
    done.addEventListener('click', () => close(m.notes.length ? m : null));
  });
}

export { melodyPlayer };
