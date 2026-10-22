// The Free Art API.
//   GET    /api/worlds                 every shared world
//   POST   /api/worlds                 raise a new world → { id, key }
//   PUT    /api/worlds/:id             change it (edit key)
//   DELETE /api/worlds/:id             remove it and its files (edit key, or the admin key)
//   POST   /api/worlds/:id/media       upload a file (edit key) → { src, used, quota }
//   GET    /api/worlds/:id/space       how much of the plot's space is used (edit key)
//   POST   /api/worlds/:id/report      tell the keeper something is wrong
import {
  json, fail, sha256, newKey, randomName, ID, access, quota, putFile, deleteFiles, reservedPlots,
  referenced, checkWorld, hashIp, TYPES, FILE_MAX, CREATES_PER_DAY,
} from '../_lib/core.js';

const LIST_CACHE = 'https://freeart.internal/api/worlds';

export async function onRequest(context) {
  const { request, env, params } = context;
  if (!env.DB) return fail(503, 'The shared city is not connected yet.');
  const parts = [].concat(params.path || []);
  const method = request.method;
  try {
    if (parts[0] !== 'worlds') return fail(404, 'Not found.');
    if (parts.length === 1 && method === 'GET') return list(context);
    if (parts.length === 1 && method === 'POST') return create(context);
    const id = parts[1];
    if (!ID.test(id || '')) return fail(404, 'No such world.');
    const row = await env.DB.prepare('SELECT * FROM worlds WHERE id = ?').bind(id).first();
    if (parts.length === 2 && method === 'PUT') return update(context, id, row);
    if (parts.length === 2 && method === 'DELETE') return remove(context, id, row);
    if (parts[2] === 'media' && method === 'POST') return upload(context, id, row);
    if (parts[2] === 'space' && method === 'GET') return space(context, id, row);
    if (parts[2] === 'report' && method === 'POST') return report(context, id, row);
    return fail(405, 'Not allowed.');
  } catch (e) {
    console.error(e);
    return fail(500, 'Something went wrong on the server.');
  }
}

async function list({ env, waitUntil }) {
  const cache = caches.default;
  const hit = await cache.match(LIST_CACHE);
  if (hit) return hit;
  const { results } = await env.DB.prepare('SELECT data FROM worlds WHERE hidden = 0 ORDER BY created').all();
  const body = '{"worlds":[' + results.map((r) => r.data).join(',') + ']}';
  const res = new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=15' } });
  waitUntil(cache.put(LIST_CACHE, res.clone()));
  return res;
}
const changed = () => caches.default.delete(LIST_CACHE);

async function plotFree(env, origin, plot, id) {
  if ((await reservedPlots(env, origin)).has(plot.x + ',' + plot.z)) return false;
  const other = await env.DB.prepare('SELECT id FROM worlds WHERE plot_x = ? AND plot_z = ?').bind(plot.x, plot.z).first();
  return !other || other.id === id;
}

async function create({ request, env }) {
  const body = await request.json().catch(() => null);
  const world = body?.world;
  const id = typeof world?.id === 'string' && ID.test(world.id) ? world.id : null;
  if (!id) return fail(400, 'A world needs a simple id.');
  const bad = checkWorld(world, id);
  if (bad) return fail(400, bad);
  if (await env.DB.prepare('SELECT 1 FROM worlds WHERE id = ?').bind(id).first()) return fail(409, 'That name is taken. Try again.');
  if (!(await plotFree(env, new URL(request.url).origin, world.plot, id))) return fail(409, 'Someone just took that plot.');

  // A gentle limit, so nobody fills the city in one evening.
  const ip = await hashIp(request, env), day = new Date().toISOString().slice(0, 10);
  const seen = await env.DB.prepare('SELECT n FROM creations WHERE ip_hash = ? AND day = ?').bind(ip, day).first();
  if (seen && seen.n >= CREATES_PER_DAY) return fail(429, 'That is enough new worlds for today. Come back tomorrow.');

  const key = newKey(), now = new Date().toISOString();
  const data = JSON.stringify({ ...world, id });
  await env.DB.batch([
    env.DB.prepare('INSERT INTO worlds (id, key_hash, data, plot_x, plot_z, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, await sha256(key), data, world.plot.x, world.plot.z, now, now),
    env.DB.prepare('INSERT INTO creations (ip_hash, day, n) VALUES (?, ?, 1) ON CONFLICT (ip_hash, day) DO UPDATE SET n = n + 1').bind(ip, day),
  ]);
  await changed();
  return json({ id, key }, 201);
}

async function update({ request, env }, id, row) {
  if (!row) return fail(404, 'No such world.');
  if ((await access(request, env, row)) !== 'owner') return fail(403, 'This edit link does not open this world.');
  const body = await request.json().catch(() => null);
  const world = body?.world;
  const bad = checkWorld(world, id);
  if (bad) return fail(400, bad);
  if (!(await plotFree(env, new URL(request.url).origin, world.plot, id))) return fail(409, 'That plot is taken.');
  const data = JSON.stringify({ ...world, id });
  await env.DB.prepare('UPDATE worlds SET data = ?, plot_x = ?, plot_z = ?, updated = ? WHERE id = ?')
    .bind(data, world.plot.x, world.plot.z, new Date().toISOString(), id).run();
  // Files the world no longer shows are let go, so the space comes back.
  const keep = referenced(data, id);
  const { results } = await env.DB.prepare('SELECT key FROM media WHERE world_id = ?').bind(id).all();
  await deleteFiles(env, results.map((r) => r.key).filter((k) => !keep.has(k)));
  await changed();
  return json({ ok: true });
}

async function remove({ request, env }, id, row) {
  if (!row) return fail(404, 'No such world.');
  if (!(await access(request, env, row))) return fail(403, 'This edit link does not open this world.');
  const { results } = await env.DB.prepare('SELECT key FROM media WHERE world_id = ?').bind(id).all();
  await deleteFiles(env, results.map((r) => r.key));
  await env.DB.prepare('DELETE FROM worlds WHERE id = ?').bind(id).run();
  await changed();
  return json({ ok: true });
}

async function used(env, id) {
  const r = await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM media WHERE world_id = ?').bind(id).first();
  return r.used;
}

async function upload({ request, env }, id, row) {
  if (!row) return fail(404, 'No such world.');
  if ((await access(request, env, row)) !== 'owner') return fail(403, 'This edit link does not open this world.');
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const kind = TYPES[type];
  if (!kind) return fail(415, 'This kind of file cannot be shown here.');
  const body = await request.arrayBuffer();
  if (!body.byteLength) return fail(400, 'The file is empty.');
  if (body.byteLength > FILE_MAX[kind[0]]) return fail(413, `This ${kind[0]} is too large (up to ${FILE_MAX[kind[0]] / 1e6} MB).`);
  const have = await used(env, id), limit = quota(env);
  if (have + body.byteLength > limit) return fail(413, `Your plot is full (${Math.round(limit / 1e6)} MB). Remove something to make room.`);
  const key = `media/${id}/${randomName()}.${kind[1]}`;
  await putFile(env, key, body, type);
  await env.DB.prepare('INSERT INTO media (key, world_id, type, size, created) VALUES (?, ?, ?, ?, ?)')
    .bind(key, id, type, body.byteLength, new Date().toISOString()).run();
  return json({ src: key, used: have + body.byteLength, quota: limit }, 201);
}

async function space({ request, env }, id, row) {
  if (!row) return fail(404, 'No such world.');
  if (!(await access(request, env, row))) return fail(403, 'This edit link does not open this world.');
  return json({ used: await used(env, id), quota: quota(env) });
}

async function report({ request, env }, id, row) {
  if (!row) return fail(404, 'No such world.');
  const body = await request.json().catch(() => ({}));
  const reason = String(body?.reason || '').slice(0, 500);
  await env.DB.prepare('INSERT INTO reports (world_id, reason, ip_hash, created) VALUES (?, ?, ?, ?)')
    .bind(id, reason, await hashIp(request, env), new Date().toISOString()).run();
  return json({ ok: true });
}
