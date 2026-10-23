// The small mono texts type themselves in: a block runs from left to right, everything
// ahead of it flickers through symbols, and each letter settles as the block passes. It
// plays once, the first time a text is seen; again only when its words really change, or
// when a link or button under it is hovered. Mono letters are all one width, so nothing shifts while it runs.
const ROOTS = '.mono, .btn, .g-btn, .g-pill, .move-help__body';
const SKIP = 'select, option, input, textarea, [data-no-scramble], [data-no-scramble] *';
const HOVER = 'a, button, label, summary, [role="button"]';
const GLYPHS = '{}[]()<>|#%$*&+=/\\·_';
const BLOCK = '█';
const STEP = 22; // ms per letter as the block passes
const FLICKER = 45; // ms between new symbols

const runs = new WeakMap(); // text node -> { final, timer }
const seen = new WeakSet(); // roots that have played their first appearance
let observer = null, react = () => {};
const quiet = matchMedia('(prefers-reduced-motion: reduce)');

const glyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

function play(node) {
  const run = runs.get(node);
  const final = run ? run.final : node.data;
  if (!final.trim()) return;
  if (run) clearInterval(run.timer);
  const state = { final, timer: 0 };
  runs.set(node, state);
  const len = final.length, total = Math.min(900, Math.max(260, len * STEP));
  const t0 = performance.now();
  // A steady beat rather than every frame: the flicker reads better, and it still ends on
  // time when frames are scarce (a hidden tab).
  const tick = () => {
    const p = Math.min(1, (performance.now() - t0) / total);
    const at = Math.floor(p * len), words = state.final;
    const text = p >= 1 ? words : words.slice(0, at) + (/\s/.test(words[at]) ? words[at] : BLOCK)
      + Array.from(words.slice(at + 1), (c) => (/\s/.test(c) ? c : glyph())).join('');
    write(node, text);
    if (p >= 1) { clearInterval(state.timer); runs.delete(node); }
  };
  state.timer = setInterval(tick, FLICKER);
  tick();
}

// Our own steps must never look like new words: changes already waiting are dealt with
// first, then the records this write makes are dropped.
function write(node, text) {
  if (observer) react(observer.takeRecords());
  node.data = text;
  observer?.takeRecords();
}

// The text nodes a root owns (not those of another root inside it, nor form fields).
function textsOf(root) {
  const out = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const host = n.parentElement;
    if (!host || host.closest(SKIP) || host.closest(ROOTS) !== root || !n.data.trim()) continue;
    out.push(n);
  }
  return out;
}

const scramble = (root) => { if (!quiet.matches) textsOf(root).forEach(play); };

export function startScramble() {
  // The first time a text is seen: play once, and never again just for showing up.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting || seen.has(e.target)) continue;
      seen.add(e.target);
      io.unobserve(e.target);
      scramble(e.target);
    }
  });
  const watch = (el) => { if (el.matches?.(ROOTS) && !el.closest(SKIP)) io.observe(el); };
  document.querySelectorAll(ROOTS).forEach(watch);

  // New texts, and words that really change (our own steps never reach here).
  react = (list) => {
    for (const m of list) {
      if (m.type === 'characterData') {
        const run = runs.get(m.target);
        if (run) { run.final = m.target.data; continue; } // changed mid-effect: it settles on the new words
        if (m.oldValue === m.target.data) continue;
        const root = m.target.parentElement?.closest(ROOTS);
        if (root && !m.target.parentElement.closest(SKIP) && seen.has(root)) play(m.target);
        continue;
      }
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) { watch(n); n.querySelectorAll?.(ROOTS).forEach(watch); }
        else if (n.nodeType === 3) {
          const root = n.parentElement?.closest(ROOTS);
          // textContent = the same words again replaces the node: that is no change.
          const before = [...m.removedNodes].filter((r) => r.nodeType === 3).map((r) => runs.get(r)?.final ?? r.data).join('');
          if (before === n.data) continue;
          if (root && seen.has(root) && !n.parentElement.closest(SKIP) && n.data.trim()) play(n);
        }
      }
    }
  };
  observer = new MutationObserver((list) => react(list));
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });

  // Hovering a link or button plays its own texts again, and only those: the next link in
  // the same row keeps still.
  let over = null;
  document.addEventListener('pointerover', (e) => {
    const hit = e.target.closest?.(HOVER);
    if (hit === over) return;
    over = hit;
    if (!hit || quiet.matches) return;
    const walk = document.createTreeWalker(hit, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const host = n.parentElement;
      if (host && n.data.trim() && host.closest(ROOTS) && !host.closest(SKIP)) play(n);
    }
  });
}
