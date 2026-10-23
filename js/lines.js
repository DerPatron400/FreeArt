// Text in Geist comes in a line at a time, rising out of a soft blur, like the rows of How
// to move. Each word is wrapped for the moment and given its line's delay, so bold words and
// line breaks keep their place; once all have arrived, the text is put back as it was.
const quiet = matchMedia('(prefers-reduced-motion: reduce)');
const STEP = 0.06; // seconds between lines
const LENGTH = 0.6; // one line's rise

// Returns when the next text should start, so several can follow on from each other.
export function revealLines(el, { delay = 0.1, step = STEP } = {}) {
  if (!el || quiet.matches || !el.textContent.trim()) return delay;
  const prev = el._reveal;
  if (prev) { clearTimeout(prev.timer); if (el.contains(prev.first)) el.innerHTML = prev.html; }
  const html = el.innerHTML;
  const words = [];
  const split = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        const frag = document.createDocumentFragment();
        for (const part of child.data.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { frag.append(part); continue; }
          const w = document.createElement('span');
          w.className = 'reveal-word';
          w.textContent = part;
          frag.append(w);
          words.push(w);
        }
        child.replaceWith(frag);
      } else if (child.nodeType === 1 && child.tagName !== 'BR') split(child);
    }
  };
  split(el);
  if (!words.length) return delay;
  let line = -1, top = null;
  for (const w of words) {
    const y = w.offsetTop;
    if (top === null || Math.abs(y - top) > 2) { line++; top = y; }
    w.style.animationDelay = `${delay + line * step}s`;
  }
  const state = { html, first: words[0] };
  // Put the plain text back afterwards (so it reflows freely), unless it has been replaced meanwhile.
  state.timer = setTimeout(() => {
    if (el._reveal === state && el.contains(state.first)) el.innerHTML = html;
    if (el._reveal === state) el._reveal = null;
  }, (delay + line * step + LENGTH) * 1000 + 50);
  el._reveal = state;
  return delay + (line + 1) * step;
}

// For long pages: each block rises in as it scrolls into view (blocks arriving together follow on).
export function revealOnView(blocks) {
  const io = new IntersectionObserver((entries) => {
    let delay = 0.1;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      delay = revealLines(e.target, { delay });
    }
  });
  blocks.forEach((b) => io.observe(b));
  return () => io.disconnect();
}
