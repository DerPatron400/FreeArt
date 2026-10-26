// Turns a PLY file into a binary splat PLY off the page's thread (see ply.js).
import { readyPly } from './ply.js';

onmessage = (e) => {
  try {
    const out = readyPly(new Uint8Array(e.data));
    postMessage({ out: out.buffer }, [out.buffer]);
  } catch (err) {
    postMessage({ error: String(err?.message || err) });
  }
};
