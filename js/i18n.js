// Languages. Each visitor gets the language their browser asks for first (or the
// one they chose in the menu); the words of each world stay in their maker's own.
// Every language is written for its readers, not translated word for word.
export const LANGS = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'ru', name: 'Русский' },
  { code: 'zh', name: '中文' },
  { code: 'ja', name: '日本語' },
];
const CODES = LANGS.map((l) => l.code);

function choose() {
  try {
    const saved = localStorage.getItem('freeart.lang');
    if (CODES.includes(saved)) return saved;
  } catch {}
  for (const tag of navigator.languages || [navigator.language || 'en']) {
    const code = String(tag).toLowerCase().split('-')[0];
    if (CODES.includes(code)) return code;
  }
  return 'en';
}

export const lang = choose();
const base = (await import('./i18n/en.js')).default;
const dict = lang === 'en' ? base : { ...base, ...(await import(`./i18n/${lang}.js`)).default };

// t('key', { n: 3 }) → the text for this language, with {n} filled in.
export function t(key, vars) {
  let s = dict[key] ?? key;
  if (Array.isArray(s)) return s;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}

export function setLang(code) {
  try {
    localStorage.setItem('freeart.lang', code);
    sessionStorage.setItem('freeart.relang', '1'); // come back where you were, not to the threshold
  } catch {}
  location.reload();
}

// Static text in the page: data-i18n (text), data-i18n-html (trusted markup from
// our own dictionaries), data-i18n-ph (placeholder), data-i18n-aria (aria-label).
export function translatePage(root = document) {
  document.documentElement.lang = lang;
  root.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach((e) => { e.innerHTML = t(e.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-ph]').forEach((e) => { e.placeholder = t(e.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-aria]').forEach((e) => { e.setAttribute('aria-label', t(e.dataset.i18nAria)); });
  if (dict['meta.title']) document.title = t('meta.title');
}
