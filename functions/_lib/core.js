// Shared pieces for the Free Art server: worlds in D1, files in R2 (or, until R2
// is switched on, in D1 in small chunks). No accounts: each world has a private
// edit key, and the server keeps only its SHA-256 hash.

// The free tier, shared fairly between the 120 plots of the city.
export const PLOTS = 120;
export const QUOTA_R2 = 75e6; // 10 GB of R2, 1 GB kept in reserve, / 120 plots
export const QUOTA_D1 = 35e6; // 5 GB of D1, with room for the worlds themselves
export const WORLD_MAX = 1e6; // a world's own JSON (texts, drawings, stars by hand)
export const FILE_MAX = { image: 2e6, audio: 8e6, video: 40e6, model: 25e6, splat: 30e6 };
export const CREATES_PER_DAY = 5; // new worlds per visitor (by hashed IP) per day
const CHUNK = 1.5e6; // D1 values stay well under its 2 MB limit

export const TYPES = {
  'image/jpeg': ['image', 'jpg'], 'image/png': ['image', 'png'], 'image/webp': ['image', 'webp'], 'image/gif': ['image', 'gif'],
  'audio/webm': ['audio', 'webm'], 'audio/ogg': ['audio', 'ogg'], 'audio/mpeg': ['audio', 'mp3'], 'audio/mp4': ['audio', 'm4a'],
  'audio/aac': ['audio', 'aac'], 'audio/wav': ['audio', 'wav'], 'audio/x-wav': ['audio', 'wav'], 'audio/x-m4a': ['audio', 'm4a'],
  'video/mp4': ['video', 'mp4'], 'video/webm': ['video', 'webm'], 'video/quicktime': ['video', 'mov'],
  'model/gltf-binary': ['model', 'glb'],
  // Gaussian splats have no registered types; the studio labels them by file ending.
  'application/x-spz': ['splat', 'spz'], 'application/x-ply': ['splat', 'ply'], 'application/x-splat': ['splat', 'splat'],
  'application/x-ksplat': ['splat', 'ksplat'], 'application/x-sog': ['splat', 'sog'],
};

export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
export const fail = (status, message) => json({ error: message }, status);

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function newKey() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomName() {
  return [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

export const ID = /^[a-z0-9-]{1,64}$/;

// Who is asking: the world's maker (with its key), the keeper of the city (admin key), or nobody.
export async function access(request, env, row) {
  const auth = request.headers.get('authorization') || '';
  const key = auth.replace(/^Bearer\s+/i, '').trim();
  if (!key) return null;
  if (env.ADMIN_KEY && key.length >= 16 && key === env.ADMIN_KEY) return 'admin';
  if (row && (await sha256(key)) === row.key_hash) return 'owner';
  return null;
}

export const quota = (env) => (env.MEDIA ? QUOTA_R2 : QUOTA_D1);

// ---- files ----

export async function putFile(env, key, body, type) {
  if (env.MEDIA) {
    await env.MEDIA.put(key, body, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' } });
    return;
  }
  const bytes = new Uint8Array(body);
  const stmts = [];
  for (let i = 0, n = 0; i < bytes.length; i += CHUNK, n++) {
    stmts.push(env.DB.prepare('INSERT INTO chunks (key, n, data) VALUES (?, ?, ?)').bind(key, n, bytes.slice(i, i + CHUNK)));
  }
  await env.DB.batch(stmts);
}

export async function deleteFiles(env, keys) {
  if (!keys.length) return;
  if (env.MEDIA) await env.MEDIA.delete(keys);
  const stmts = [];
  for (const k of keys) {
    stmts.push(env.DB.prepare('DELETE FROM chunks WHERE key = ?').bind(k));
    stmts.push(env.DB.prepare('DELETE FROM media WHERE key = ?').bind(k));
  }
  await env.DB.batch(stmts);
}

// Plots taken by the worlds that ship with the site (worlds/index.json).
let galleryPlots = null;
export async function reservedPlots(env, origin) {
  if (galleryPlots) return galleryPlots;
  const set = new Set();
  try {
    const idx = await env.ASSETS.fetch(new URL('/worlds/index.json', origin)).then((r) => r.json());
    for (const f of idx.worlds || []) {
      const w = await env.ASSETS.fetch(new URL('/worlds/' + f, origin)).then((r) => r.json()).catch(() => null);
      if (w?.plot && Number.isInteger(w.plot.x) && Number.isInteger(w.plot.z)) set.add(w.plot.x + ',' + w.plot.z);
    }
  } catch {}
  galleryPlots = set;
  return set;
}

// The media keys a world's JSON refers to, like "media/<id>/<name>.jpg".
export function referenced(text, id) {
  const out = new Set();
  const re = new RegExp(`media/${id}/[a-z0-9]+\\.[a-z0-9]+`, 'g');
  for (const m of text.matchAll(re)) out.add(m[0]);
  return out;
}

// A world as the server will keep it: small, without inline files, on a valid plot.
export function checkWorld(world, id) {
  if (!world || typeof world !== 'object') return 'That is not a world.';
  const text = JSON.stringify({ ...world, id });
  if (text.length > WORLD_MAX) return 'This world is too large. Pictures and sounds are uploaded separately.';
  if (text.includes('"data:')) return 'Files must be uploaded, not kept inside the world.';
  const p = world.plot;
  if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.z) || Math.abs(p.x) > 5 || Math.abs(p.z) > 5) return 'Choose a plot in the city.';
  return null;
}

export async function hashIp(request, env) {
  return sha256((request.headers.get('cf-connecting-ip') || 'unknown') + (env.SALT || 'free-art'));
}
