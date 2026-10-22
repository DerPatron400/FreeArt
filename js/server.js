// Talking to the shared city. Worlds live on the server; each one is opened for
// editing by a private key that only its maker holds (kept in this browser, and
// in the edit link they can save). Without a server, the site still works alone.
import { getKeys, setKey, forgetKey } from './store.js';
import { t } from './i18n.js';

let online = null; // null: not asked yet; true/false after the first answer

export async function fetchShared() {
  try {
    const r = await fetch('api/worlds', { headers: { accept: 'application/json' } });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error(r.status);
    online = true;
    return (await r.json()).worlds || [];
  } catch {
    online = false;
    return null;
  }
}

export const isOnline = () => online === true;
export const keyFor = (id) => getKeys()[id] || null;
export const editLink = (id, key) => `${location.origin}${location.pathname}#/key/${encodeURIComponent(id)}/${encodeURIComponent(key)}`;

async function call(method, path, { key, body, type } = {}) {
  const headers = {};
  if (key) headers.authorization = 'Bearer ' + key;
  if (type) headers['content-type'] = type;
  else if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch('api/' + path, { method, headers, body: type ? body : body !== undefined ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error ? local(data.error) : t('srv.noAnswer')), { status: r.status });
  return data;
}

// The server answers in English (machines use it too); people read it in their language.
const local = (msg) => { const s = t('srv:' + msg); return s === 'srv:' + msg ? msg : s; };

// Every file still inside the world (from this device) goes up first, then the world itself.
function inlineMedia(w) {
  const out = [];
  const visit = (list) => (list || []).forEach((m) => { if (typeof m.src === 'string' && m.src.startsWith('data:')) out.push(m); });
  w.fragments.forEach((f) => visit(f.media));
  (w.process?.steps || []).forEach((s) => visit(s.media));
  return out;
}

// Publish a world: create it the first time, update it after. Returns
// { world, key, created, skipped }: a file the city will not take (too large, or
// the plot is full) is left out and named, so everything else still goes up.
export async function publish(world, { onProgress = () => {} } = {}) {
  const w = structuredClone(world);
  const files = inlineMedia(w);
  let key = keyFor(w.id), created = false;
  if (!key) {
    // Raise it first without its files, so they have somewhere to go.
    const bare = structuredClone(w);
    inlineMedia(bare).forEach((m) => { m.src = ''; });
    const res = await call('POST', 'worlds', { body: { world: bare } });
    key = res.key;
    await setKey(w.id, key);
    created = true;
  }
  const skipped = [];
  let i = 0;
  for (const m of files) {
    onProgress(++i, files.length);
    try {
      const blob = await (await fetch(m.src)).blob();
      const res = await call('POST', `worlds/${encodeURIComponent(w.id)}/media`, { key, body: blob, type: blob.type.split(';')[0] });
      m.src = res.src;
    } catch (e) {
      if (!e.status) throw e;
      skipped.push(`${m.caption || KIND_NAMES[m.kind] || t('kind.aFile')}: ${e.message}`);
      m.src = '';
    }
  }
  await call('PUT', `worlds/${encodeURIComponent(w.id)}`, { key, body: { world: w } });
  return { world: w, key, created, skipped };
}

const KIND_NAMES = { image: t('kind.aPicture'), audio: t('kind.aSound'), video: t('kind.aVideo') };

export async function unpublish(id) {
  const key = keyFor(id);
  if (!key) throw new Error(t('srv.noKey'));
  await call('DELETE', `worlds/${encodeURIComponent(id)}`, { key });
  await forgetKey(id);
}

export async function space(id) {
  const key = keyFor(id);
  return key ? call('GET', `worlds/${encodeURIComponent(id)}/space`, { key }) : null;
}

export const report = (id, reason) => call('POST', `worlds/${encodeURIComponent(id)}/report`, { body: { reason } });
export { setKey };
