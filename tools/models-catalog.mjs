// Builds models.txt and models.json: ready-to-use 3D models for makers, with
// direct links, so a machine never has to guess an asset id.
// Run with Node 18+ from the repo root:  node tools/models-catalog.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Short labels written by looking at each preview, for rows whose prompt is
// empty or an edit instruction: { "assets/.../output.glb": "a red paper lantern" }.
const LABELS = existsSync('tools/model-labels.json') ? JSON.parse(readFileSync('tools/model-labels.json', 'utf8')) : {};

const DS = 'scenario-labs/3d-collection';
const BASE = `https://huggingface.co/datasets/${DS}/resolve/main/`;
const MAX_MB = 25;

// Animated figures: each is checked below, and dropped if it does not load cross-origin.
const FIGURES = [
  ['A robot that walks, waves, dances and jumps (three.js examples)', 'https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb'],
  ['A soldier, idling and walking (three.js examples)', 'https://threejs.org/examples/models/gltf/Soldier.glb'],
  ['A plain humanoid figure in motion (three.js examples)', 'https://threejs.org/examples/models/gltf/Xbot.glb'],
  ['A dancing woman (three.js examples)', 'https://threejs.org/examples/models/gltf/Michelle.glb'],
  ['A galloping horse (three.js examples, by mirada from ro.me)', 'https://threejs.org/examples/models/gltf/Horse.glb'],
  ['A flamingo in flight (three.js examples, by mirada from ro.me)', 'https://threejs.org/examples/models/gltf/Flamingo.glb'],
  ['A parrot in flight (three.js examples, by mirada from ro.me)', 'https://threejs.org/examples/models/gltf/Parrot.glb'],
  ['A stork in flight (three.js examples, by mirada from ro.me)', 'https://threejs.org/examples/models/gltf/Stork.glb'],
  ['A whole tiny city alive with a moving train (Littlest Tokyo by Glen Fox, CC BY 4.0)', 'https://threejs.org/examples/models/gltf/LittlestTokyo.glb'],
  ['A fox that walks and runs (Khronos sample, CC BY 4.0, PixelMannen and tomkranis)', 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb'],
  ['A walking man (Khronos sample CesiumMan, CC BY 4.0, Cesium)', 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CesiumMan/glTF-Binary/CesiumMan.glb'],
  ['A dancing robot figure (Khronos sample BrainStem, Keith Hunter)', 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/BrainStem/glTF-Binary/BrainStem.glb'],
  ['A milk truck with turning wheels (Khronos sample, CC BY 4.0, Cesium)', 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CesiumMilkTruck/glTF-Binary/CesiumMilkTruck.glb'],
];

async function json(url) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url);
    if (r.ok) return { data: await r.json(), link: r.headers.get('link') };
    await new Promise((ok) => setTimeout(ok, 2000 * (i + 1)));
  }
  throw new Error('failed: ' + url);
}

// Every file's size, from the repository tree.
const size = new Map();
let next = `https://huggingface.co/api/datasets/${DS}/tree/main/assets?recursive=true&expand=false`;
while (next) {
  const { data, link } = await json(next);
  for (const f of data) if (f.type === 'file') size.set(f.path, f.lfs?.size ?? f.size);
  next = /<([^>]+)>;\s*rel="next"/.exec(link || '')?.[1] || null;
}
console.log('files', size.size);

// Every row: prompt, generator and output path.
const rows = [];
for (let off = 0; ; off += 100) {
  const { data } = await json(`https://datasets-server.huggingface.co/rows?dataset=${DS}&config=default&split=train&offset=${off}&length=100`);
  rows.push(...data.rows.map((r) => r.row));
  if (data.rows.length < 100) break;
}
console.log('rows', rows.length);

const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
const models = [];
const seen = new Set();
for (const row of rows) {
  const text = JSON.stringify(row);
  const path = /assets\/[^"\\]+?\.(glb|spz)/.exec(text)?.[0];
  if (!path || seen.has(path) || !size.has(path)) continue;
  seen.add(path);
  const mb = size.get(path) / 1048576;
  if (mb > MAX_MB) continue;
  const preview = /assets\/[^"\\]+?preview\.(jpg|jpeg|png|webp)/.exec(text)?.[0];
  models.push({
    prompt: clean(LABELS[path] || row.prompt).slice(0, 180) || '(no description)',
    kind: path.endsWith('.spz') ? 'splat' : 'model',
    mb: Math.round(mb * 10) / 10,
    src: BASE + path,
    preview: preview ? BASE + preview : undefined,
    generator: clean(row.model) || undefined,
  });
}
models.sort((a, b) => a.prompt.localeCompare(b.prompt));
console.log('models under', MAX_MB, 'MB:', models.length);

const figures = [];
for (const [what, src] of FIGURES) {
  try {
    const r = await fetch(src, { headers: { Origin: 'https://freeart.pages.dev' } });
    const buf = new Uint8Array(await r.arrayBuffer());
    const cors = r.headers.get('access-control-allow-origin');
    const magic = String.fromCharCode(...buf.slice(0, 4));
    if (r.ok && (cors === '*' || cors === 'https://freeart.pages.dev') && magic === 'glTF') {
      figures.push({ what, src, mb: Math.round((buf.length / 1048576) * 10) / 10 });
    } else console.log('dropped', src, r.status, cors, magic);
  } catch (e) { console.log('dropped', src, e.message); }
}
console.log('figures', figures.length);

writeFileSync('models.json', JSON.stringify({ figures, collection: models }, null, 1) + '\n');
const lines = [
  '# Ready-made 3D models for Khora worlds',
  '#',
  '# Every link below loads directly in the city: use it as the `src` of a',
  '# `kind: "model"` piece (or `kind: "splat"` where marked). Credit the source in',
  '# the caption. Search this file for words that fit your subject.',
  '# The same list as JSON: https://freeart.pages.dev/models.json',
  '',
  '## Animated figures (their first animation plays in a loop)',
  '# size | what | src',
  ...figures.map((f) => `${f.mb} MB | ${f.what} | ${f.src}`),
  '',
  `## Scenario 3D collection: ${models.length} generated models under ${MAX_MB} MB`,
  '# CC BY 4.0: credit "Scenario" in the caption. Most are still (not animated);',
  '# give them a `show.motion` such as float, spin, sway or breathe.',
  '# The picture of each is preview.jpg in the same folder as its file.',
  '# size | kind | description | src',
  ...models.map((m) => `${m.mb} MB | ${m.kind} | ${m.prompt} | ${m.src}`),
  '',
];
writeFileSync('models.txt', lines.join('\n'));
console.log('wrote models.txt and models.json');
