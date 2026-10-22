// Files people uploaded to their worlds: /media/<world id>/<name>.<ext>
// Served from R2 (with byte ranges, so video can seek), or from D1 chunks before R2 is on.
import { TYPES } from '../_lib/core.js';

const KEY = /^media\/[a-z0-9-]{1,64}\/[a-z0-9]+\.[a-z0-9]+$/;

export async function onRequestGet({ request, env, params }) {
  const key = 'media/' + [].concat(params.path || []).join('/');
  if (!KEY.test(key)) return new Response('Not found', { status: 404 });
  const headers = new Headers({ 'cache-control': 'public, max-age=31536000, immutable', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff' });

  if (env.MEDIA) {
    const range = parseRange(request.headers.get('range'));
    const obj = await env.MEDIA.get(key, range ? { range } : undefined);
    if (obj) {
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      if (range && obj.range) {
        const start = obj.range.offset ?? 0, len = obj.range.length ?? obj.size - start;
        headers.set('content-range', `bytes ${start}-${start + len - 1}/${obj.size}`);
        headers.set('content-length', String(len));
        return new Response(obj.body, { status: 206, headers });
      }
      headers.set('content-length', String(obj.size));
      return new Response(obj.body, { headers });
    }
    // Not in R2: it may be a file kept in D1 from before R2 was switched on.
  }

  const meta = await env.DB.prepare('SELECT type, size FROM media WHERE key = ?').bind(key).first();
  if (!meta || !TYPES[meta.type]) return new Response('Not found', { status: 404 });
  const { results } = await env.DB.prepare('SELECT data FROM chunks WHERE key = ? ORDER BY n').bind(key).all();
  const out = new Uint8Array(meta.size);
  let at = 0;
  for (const r of results) { const b = new Uint8Array(r.data); out.set(b, at); at += b.length; }
  headers.set('content-type', meta.type);
  const range = parseRange(request.headers.get('range'));
  if (range) {
    const start = range.offset, end = Math.min(meta.size, range.length ? start + range.length : meta.size);
    headers.set('content-range', `bytes ${start}-${end - 1}/${meta.size}`);
    return new Response(out.slice(start, end), { status: 206, headers });
  }
  return new Response(out, { headers });
}

function parseRange(h) {
  const m = /^bytes=(\d+)-(\d*)$/.exec(h || '');
  if (!m) return null;
  const offset = +m[1];
  return m[2] ? { offset, length: +m[2] - offset + 1 } : { offset };
}
