// The exhibition you can see from the street: a world's media standing and
// playing inside its plot. Pictures and sketches hang in the air, melodies
// light up as they play, sculptures and models turn, poems drift apart and
// gather into lines, constellations of ideas slowly rotate.
// Units: U = plot width in world units (see build.js). Everything is on layer 1.
import * as THREE from 'three';
import { createBuild } from './build.js';
import { SHOWABLE, inkColors, embedFor, constellationLayout, melodyFreq, ctx, pluck } from './media.js';

const PAPER = '#ece4d4';
const FONT = '"Cormorant Garamond", Georgia, serif';
// Every exhibition keeps its own textures and media so it can free them all when it
// goes. Pieces are made synchronously inside createExhibit, so they pick up the
// current bag then; loads that finish after the exhibition is gone are freed on arrival.
let bag = { textures: new Set(), media: new Set(), gone: false };
const keep = (t) => { bag.textures.add(t); return t; };

function freeObject(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.uniforms?.map?.value?.dispose?.();
      m.dispose();
    }
  });
}

function onLayer(obj) {
  obj.traverse((o) => o.layers.set(1));
  return obj;
}

function tex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return keep(t);
}

// Words as textures, measured so planes keep their proportions.
function textTexture(text, { size = 72, italic = true, color = PAPER } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `${italic ? 'italic ' : ''}300 ${size}px ${FONT}`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + size * 0.4, h = Math.ceil(size * 1.35);
  c.width = w; c.height = h;
  g.font = font;
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, size * 0.2, h / 2);
  return { texture: tex(c), aspect: w / h };
}

function plane(texture, w, h, opacity = 1) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
    map: texture, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
  }));
  return m;
}

function frameLines(w, h, color, opacity = 0.5) {
  const a = w / 2, b = h / 2;
  const g = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-a, -b, 0), new THREE.Vector3(a, -b, 0), new THREE.Vector3(a, b, 0), new THREE.Vector3(-a, b, 0), new THREE.Vector3(-a, -b, 0),
  ]);
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
}

// ---- one piece of the exhibition per media kind -------------------------------

// Pictures hang a few paces away; anything over 1024 px only costs graphics memory.
const MAX_SIDE = 1024;
function fit(t) {
  const img = t.image, w = img.width, h = img.height;
  if (Math.max(w, h) <= MAX_SIDE) return t;
  const k = MAX_SIDE / Math.max(w, h);
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  t.dispose();
  return new THREE.CanvasTexture(c);
}

function imagePiece(src, size, ink) {
  const group = new THREE.Group();
  const holder = frameLines(size, size * 0.75, ink[1], 0.4);
  group.add(holder);
  const b = bag;
  new THREE.TextureLoader().load(src, (t) => {
    if (b.gone) { t.dispose(); return; }
    t = fit(t);
    t.colorSpace = THREE.SRGBColorSpace;
    b.textures.add(t);
    const k = t.image.height / t.image.width;
    const w = k > 1 ? size / k : size, h = w * k;
    group.remove(holder); holder.geometry.dispose(); holder.material.dispose();
    group.add(onLayer(plane(t, w, h, 0.92)), onLayer(frameLines(w * 1.04, h * 1.04, ink[1], 0.35)));
  });
  return { group };
}

function sketchPiece(sketch, size, ink) {
  const [vw, vh] = sketch.view;
  const scale = 1024 / Math.max(vw, vh);
  const c = document.createElement('canvas');
  c.width = Math.round(vw * scale); c.height = Math.round(vh * scale);
  const g = c.getContext('2d');
  g.scale(scale, scale);
  g.lineCap = g.lineJoin = 'round';
  for (const p of sketch.paths) {
    const path = new Path2D(p.d);
    g.strokeStyle = ink[p.tone];
    g.lineWidth = p.width;
    if (p.fill) { g.globalAlpha = 0.35; g.fillStyle = ink[p.tone]; g.fill(path); g.globalAlpha = 1; }
    g.stroke(path);
  }
  const w = size, h = size * (vh / vw);
  // The drawing draws itself in from the left, holds, fades, and begins again.
  const uniforms = { map: { value: tex(c) }, uProgress: { value: 0 }, uFade: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D map; uniform float uProgress; uniform float uFade; varying vec2 vUv;
      void main(){ vec4 c = texture2D(map, vUv); float edge = smoothstep(uProgress, uProgress - 0.04, vUv.x);
        gl_FragColor = vec4(c.rgb, c.a * edge * uFade); }`,
  });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat), frameLines(w * 1.04, h * 1.04, ink[1], 0.18));
  const phase = Math.random() * 10;
  return {
    group,
    update(t) {
      const k = ((t + phase) % 14) / 14;
      uniforms.uProgress.value = Math.min(1.05, k / 0.35);
      uniforms.uFade.value = k < 0.85 ? 1 : 1 - (k - 0.85) / 0.15;
    },
  };
}

function melodyPiece(melody, size, ink) {
  const group = new THREE.Group();
  const rows = Math.max(6, Math.max(...melody.notes.map((n) => n[1])) + 1);
  const cw = size / melody.steps, ch = (size * 0.5) / rows;
  const bars = melody.notes.map(([s, d, l]) => {
    const mat = new THREE.MeshBasicMaterial({ color: ink[2], transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(cw * l * 0.86, ch * 0.62), mat);
    m.position.set(-size / 2 + (s + l / 2) * cw, -size * 0.25 + (d + 0.5) * ch, 0);
    group.add(m);
    return { m, s, d, l, glow: 0 };
  });
  group.add(frameLines(size * 1.04, size * 0.54, ink[1], 0.18));
  const head = new THREE.Mesh(new THREE.PlaneGeometry(cw * 0.12, size * 0.5), new THREE.MeshBasicMaterial({ color: ink[1], transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
  group.add(head);
  const stepDur = 60 / melody.tempo / 2;
  let lastStep = -1;
  return {
    group,
    update(t, dt, { audible } = {}) {
      const total = melody.steps * stepDur;
      const pos = (t % total) / stepDur, step = Math.floor(pos);
      head.position.x = -size / 2 + pos * cw;
      if (step !== lastStep) {
        lastStep = step;
        for (const b of bars) if (b.s === step) {
          b.glow = 1;
          if (audible) { const ac = ctx(); if (ac && ac.state === 'running') pluck(ac, melodyFreq(melody, b.d), b.l * stepDur, 0.07); }
        }
      }
      for (const b of bars) {
        b.glow = Math.max(0, b.glow - dt * 1.5);
        b.m.material.opacity = 0.3 + b.glow * 0.7;
        b.m.scale.y = 1 + b.glow * 0.6;
      }
    },
  };
}

function audioPiece(size, ink) {
  // A quiet sign of sound: rings that widen and fade, like a struck bell.
  const group = new THREE.Group();
  const rings = [0, 1, 2].map(() => {
    const pts = [];
    for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0)); }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: ink[2], transparent: true, depthWrite: false }));
    group.add(l);
    return l;
  });
  return {
    group,
    update(t) {
      rings.forEach((l, i) => {
        const k = ((t * 0.25 + i / 3) % 1);
        l.scale.setScalar((0.08 + k * 0.42) * size);
        l.material.opacity = (1 - k) * 0.7;
      });
    },
  };
}

function videoPiece(src, size, ink) {
  const embed = embedFor(src);
  const group = new THREE.Group();
  const h = size * 9 / 16;
  if (!embed && (/\.(mp4|webm|mov)(\?|$)/i.test(src) || src.startsWith('data:video/'))) {
    const v = Object.assign(document.createElement('video'), { src, muted: true, loop: true, playsInline: true, crossOrigin: 'anonymous', autoplay: true });
    v.play().catch(() => {});
    bag.media.add(v);
    const t = keep(new THREE.VideoTexture(v));
    t.colorSpace = THREE.SRGBColorSpace;
    group.add(plane(t, size, h, 0.92));
    group.userData.video = v;
  } else {
    const id = embed?.url.match(/youtube-nocookie\.com\/embed\/([\w-]+)/)?.[1];
    if (id) {
      const b = bag;
      new THREE.TextureLoader().load(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, (t) => {
        if (b.gone) { t.dispose(); return; }
        t.colorSpace = THREE.SRGBColorSpace; b.textures.add(t); group.add(onLayer(plane(t, size, h, 0.85)));
      });
    }
    // A play mark, drawn in lines.
    const s = size * 0.08;
    const tri = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-s * 0.6, -s, 0.01), new THREE.Vector3(s, 0, 0.01), new THREE.Vector3(-s * 0.6, s, 0.01), new THREE.Vector3(-s * 0.6, -s, 0.01),
    ]), new THREE.LineBasicMaterial({ color: ink[2], transparent: true, opacity: 0.9, depthWrite: false }));
    group.add(tri);
  }
  group.add(frameLines(size * 1.04, h * 1.04, ink[1], 0.35));
  return { group };
}

// Heavy pieces (3D models, splats) load only while someone is near the plot and are
// freed again when they leave; from afar a faint frame keeps their place.
function lazyPiece(size, load) {
  const group = new THREE.Group();
  const proxy = boxLines(size);
  group.add(proxy);
  const b = bag;
  let obj = null, want = false, busy = false;
  const piece = {
    group, solid: true,
    lazy: {
      load() {
        want = true;
        if (obj || busy) return;
        busy = true;
        load().then((o) => {
          busy = false;
          if (!o) return;
          if (b.gone || !want) return o.free();
          obj = o;
          group.add(onLayer(o.object));
          proxy.visible = false;
        }).catch((e) => {
          busy = false;
          // Say so instead of staying silent: the studio shows a note, the console the reason.
          console.warn('Free Art: a 3D piece could not load', e);
          window.dispatchEvent(new CustomEvent('freeart:piecefail', { detail: String(e?.message || e) }));
        });
      },
      unload() {
        want = false;
        if (!obj) return;
        obj.object.removeFromParent();
        obj.free();
        obj = null;
        proxy.visible = true;
      },
    },
    setOpacity(a) { obj?.setOpacity?.(a); },
    update(t, dt) {
      obj?.update?.(dt);
      // While it loads, the outline breathes, so a visitor knows something is coming.
      if (busy) proxy.material.opacity = 0.25 + 0.2 * Math.sin(t * 4);
    },
    dispose() { piece.lazy.unload(); },
  };
  return piece;
}

function boxLines(size) {
  const h = size / 2;
  const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: PAPER, transparent: true, opacity: 0.12, depthWrite: false }));
  l.position.y = 0;
  l.userData.h = h;
  return l;
}

// Fit an object into a cube of `size`, centred on the holder.
function fitInto(obj, box, size) {
  const sz = box.getSize(new THREE.Vector3());
  const k = size / (Math.max(sz.x, sz.y, sz.z) || 1);
  obj.scale.multiplyScalar(k);
  const c = box.getCenter(new THREE.Vector3()).applyQuaternion(obj.quaternion).multiplyScalar(k);
  obj.position.sub(c);
}

async function bytesOf(src) {
  return new Uint8Array(await (await fetch(src)).arrayBuffer());
}

function modelPiece(src, size) {
  if (embedFor(src)) return { group: new THREE.Group() }; // Sketchfab pages cannot stand in the city; they play in the panel.
  return lazyPiece(size, async () => {
    let scene, clips;
    if (/\.fbx(\?|#|$)/i.test(src)) {
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
      scene = await new FBXLoader().loadAsync(src);
      clips = scene.animations;
    } else {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(src);
      scene = gltf.scene; clips = gltf.animations;
    }
    const obj = new THREE.Group();
    obj.add(scene, new THREE.HemisphereLight(0xfff4e0, 0x201810, 2.2));
    fitInto(scene, new THREE.Box3().setFromObject(scene), size);
    const mats = [];
    scene.traverse((o) => { for (const m of [].concat(o.material || [])) { m.transparent = true; mats.push(m); } });
    // A model that comes with its own animation plays its first one, gently looping.
    const mixer = clips?.length ? new THREE.AnimationMixer(scene) : null;
    mixer?.clipAction(clips[0]).play();
    return { object: obj, free: () => freeObject(obj), setOpacity: (a) => mats.forEach((m) => { m.opacity = a; }), update: (dt) => mixer?.update(dt) };
  });
}

// Gaussian splats (World Labs exports and the like) through Spark, World Labs' own
// renderer. It joins the scene once, on the layer drawn after the glow.
let host = null, spark = null, sparkView = null;
export function useEngine(engine) { host = engine; }
function sparkLib() {
  spark ||= import('@sparkjsdev/spark').then((S) => {
    sparkView = new S.SparkRenderer({ renderer: host.renderer });
    sparkView.layers.set(1);
    host.scene.add(sparkView);
    return S;
  });
  return spark;
}
// Spark redraws only when the camera or a splat changes, so a splat taken away would
// linger while the view stands still: clear, and let the ones that remain draw again.
function sparkForget(S) {
  sparkView?.clearSplats();
  host.scene.traverse((o) => { if (o instanceof S.SplatMesh) o.updateVersion(); });
}
const SPLAT_TYPES = { 'application/x-spz': 'spz', 'application/x-ply': 'ply', 'application/x-splat': 'splat', 'application/x-ksplat': 'ksplat', 'application/x-sog': 'pcsogszip' };
export function splatType(src) {
  if (src.startsWith('data:')) return SPLAT_TYPES[src.slice(5, src.indexOf(';'))];
  const ext = (src.split(/[?#]/)[0].match(/\.(spz|ply|splat|ksplat|sog)$/i) || [])[1]?.toLowerCase();
  return ext === 'sog' ? 'pcsogszip' : ext;
}

// Whole scenes (a World Labs room, a street) carry far stray splats and sky; fitting
// their full bounds would shrink the place itself to a smear. Fit the dense middle
// instead (10th to 90th percentile of the visible splats, with a margin); the rest may spill out softly.
function coreBox(mesh) {
  const ps = mesh.packedSplats;
  if (!ps?.forEachSplat || !ps.numSplats) return null;
  const every = Math.max(1, Math.floor(ps.numSplats / 20000));
  const xs = [], ys = [], zs = [];
  let i = 0;
  ps.forEachSplat((n, c, sc, q, o) => { if (i++ % every === 0 && o > 0.1) { xs.push(c.x); ys.push(c.y); zs.push(c.z); } });
  if (xs.length < 50) return null;
  const at = (v, f) => v.sort((a, b) => a - b)[Math.floor(f * (v.length - 1))];
  const lo = (v) => at(v, 0.1), hi = (v) => at(v, 0.9);
  // A sky dome above a scene would set its height; keep it no taller than it is wide.
  // (Files differ on which way is up, so the window sits around the middle splat.)
  const wide = Math.max(hi(xs) - lo(xs), hi(zs) - lo(zs)), mid = at(ys, 0.5);
  const y0 = Math.max(lo(ys), mid - wide / 2), y1 = Math.min(hi(ys), mid + wide / 2);
  const box = new THREE.Box3(new THREE.Vector3(lo(xs), y0, lo(zs)), new THREE.Vector3(hi(xs), y1, hi(zs)));
  return box.expandByVector(box.getSize(new THREE.Vector3()).multiplyScalar(0.12));
}

function splatPiece(src, size, show) {
  if (!host) return null;
  return lazyPiece(size, async () => {
    const S = await sparkLib();
    const fileType = splatType(src);
    const mesh = new S.SplatMesh(src.startsWith('data:') ? { fileBytes: await bytesOf(src), fileType } : { url: src, fileType });
    await mesh.initialized;
    // Most splat files (World Labs included) are stored upside down for three.js.
    if (!show?.flip) mesh.quaternion.set(1, 0, 0, 0);
    const obj = new THREE.Group();
    obj.add(mesh);
    const core = coreBox(mesh);
    fitInto(mesh, core || mesh.getBoundingBox(true), size);
    // What lies beyond the scene's middle (sky, stray splats) fades out softly, so a
    // whole place stays inside its plot instead of fogging the street.
    if (core) {
      const edit = new S.SplatEdit({ rgbaBlendMode: S.SplatEditRgbaBlendMode.MULTIPLY, softEdge: core.getSize(new THREE.Vector3()).length() * 0.04 });
      const keep = new S.SplatEditSdf({ type: S.SplatEditSdfType.BOX, invert: true, opacity: 0 });
      core.getCenter(keep.position);
      core.getSize(keep.scale).multiplyScalar(0.5);
      edit.add(keep);
      mesh.add(edit);
    }
    return { object: obj, free: () => { mesh.removeFromParent(); mesh.dispose(); sparkForget(S); }, setOpacity: (a) => { mesh.opacity = a; } };
  });
}

function sculpturePiece(build, size, palette) {
  const b = createBuild(build, palette, size, { opacity: 0.85 });
  const box = new THREE.Box3().setFromObject(b);
  const group = new THREE.Group();
  b.position.y = -box.getCenter(new THREE.Vector3()).y;
  group.add(b);
  return { group, spin: true };
}

// Words drift apart as a loose cloud, then one line at a time gathers into a sentence.
// Layout 'helix' turns the poem into a spiral stair: each line is a step, a little
// higher and further round than the one before, with a faint tread beneath it.
// Motion 'presence' gathers it only while a visitor is near, from the first line upwards.
export const HELIX_RISE = 1.5; // stair height, in piece sizes
function poemPiece(poem, size, ink) {
  const group = new THREE.Group();
  const helix = poem.layout === 'helix';
  const H = size * (helix ? 0.05 : 0.06); // word height
  const words = [], lines = [];
  const n = poem.lines.length, R = size * 0.3;
  poem.lines.forEach((line, li) => {
    const parts = line.split(/\s+/).filter(Boolean);
    const made = parts.map((w) => {
      const { texture, aspect } = textTexture(w, { color: ink[2] });
      const m = plane(texture, H * aspect, H, 0);
      group.add(m);
      return { m, w: H * aspect, line: li, seed: Math.random() * 100, drift: new THREE.Vector3(), order: n > 1 ? li / (n - 1) : 0 };
    });
    // Where each word stands in its gathered line: centred, with a word space between.
    const gap = H * 0.32, total = made.reduce((a, x) => a + x.w, 0) + gap * (made.length - 1);
    let x = -total / 2;
    for (const it of made) { it.dx = x + it.w / 2; it.home = new THREE.Vector3(it.dx, 0, 0); x += it.w + gap; }
    words.push(...made);
    if (helix) {
      // One turn from bottom to top, starting at the front so the first line meets you.
      const a = Math.PI / 2 - (n > 1 ? li / (n - 1) : 0) * Math.PI * 2 * 0.85;
      const centre = new THREE.Vector3(Math.cos(a) * R, (n > 1 ? li / (n - 1) : 0) * size * HELIX_RISE, Math.sin(a) * R);
      const da = (Math.PI * 2 * 0.85) / Math.max(1, n - 1);
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const b = a + da * 0.5 - (k / 8) * da;
        pts.push(new THREE.Vector3(Math.cos(b) * R * 1.25, 0, Math.sin(b) * R * 1.25));
      }
      const tread = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), ...pts, new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: ink[1], transparent: true, opacity: 0, depthWrite: false }));
      tread.position.set(0, centre.y - H * 0.75, 0);
      group.add(tread);
      lines.push({ centre, normal: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), tread, words: made });
    }
  });
  let axis = null;
  if (helix) {
    axis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -H, 0), new THREE.Vector3(0, size * HELIX_RISE, 0)]),
      new THREE.LineBasicMaterial({ color: ink[1], transparent: true, opacity: 0, depthWrite: false }));
    group.add(axis);
  }
  const period = poem.motion === 'still' ? Infinity : 16;
  const toCam = new THREE.Vector3(), here = new THREE.Vector3(), right = new THREE.Vector3();
  let presence = 0;
  return {
    group,
    billboardChildren: true,
    update(t, dt, { camera, presence: near = 0 } = {}) {
      // Arriving takes a few seconds, like a sentence being written; leaving is quicker.
      presence += (near - presence) * Math.min(1, dt * (near > presence ? 0.45 : 0.8));
      const cycle = Math.floor(t / period), k = (t % period) / period;
      const active = isFinite(period) ? cycle % n : 0;
      // 0-0.25 gather, 0.25-0.65 hold, 0.65-0.9 release, then drift.
      const gather = poem.motion === 'still' ? 1 : poem.motion === 'drift' ? 0
        : k < 0.25 ? smooth(k / 0.25) : k < 0.65 ? 1 : k < 0.9 ? 1 - smooth((k - 0.65) / 0.25) : 0;
      if (camera) {
        right.set(1, 0, 0).applyQuaternion(camera.quaternion);
        group.getWorldPosition(here);
        toCam.subVectors(camera.position, here).setY(0).normalize();
      }
      if (helix) {
        for (const l of lines) {
          // Steps on the far side of the stair stay faint so the near ones read.
          l.face = camera ? 0.22 + 0.78 * smooth(Math.max(0, l.normal.dot(toCam) * 0.5 + 0.5)) : 1;
          for (const it of l.words) it.home.copy(l.centre).addScaledVector(right, it.dx);
        }
      }
      let lit = 0;
      for (const it of words) {
        const s = it.seed;
        // Unclaimed words hang low and loose, like breath in cold air.
        it.drift.set(
          Math.sin(t * 0.07 + s) * size * 0.45,
          (helix ? size * 0.2 : 0) + Math.sin(t * 0.05 + s * 1.7) * size * 0.14,
          Math.cos(t * 0.06 + s * 0.6) * size * 0.45,
        );
        let on;
        if (poem.motion === 'presence') on = smooth(Math.min(1, Math.max(0, presence * 1.7 - it.order * 0.7)));
        else on = helix ? gather : it.line === active ? gather : 0;
        it.m.position.lerpVectors(it.drift, it.home, on);
        const face = helix ? lines[it.line].face : 1;
        it.m.material.opacity = 0.12 + on * (face - 0.12);
        if (camera) it.m.quaternion.copy(camera.quaternion);
        if (helix) { lines[it.line].on = on; lit = Math.max(lit, on); }
      }
      if (helix) {
        for (const l of lines) l.tread.material.opacity = (l.on || 0) * 0.35 * l.face;
        axis.material.opacity = lit * 0.25;
      }
    },
  };
}
const smooth = (x) => x * x * (3 - 2 * x);

// Ideas as stars, connections as lines; it turns slowly, labels always face you.
function constellationPiece(c, size, ink) {
  const group = new THREE.Group();
  const pos = constellationLayout(c).map((p) => new THREE.Vector3(p[0], p[1], p[2]).multiplyScalar(size / 2));
  const lineGeo = new THREE.BufferGeometry().setFromPoints(c.edges.flatMap(([a, b]) => [pos[a], pos[b]]));
  group.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: ink[1], transparent: true, opacity: 0.45, depthWrite: false })));
  const labels = [];
  c.nodes.forEach((n, i) => {
    const star = new THREE.Mesh(new THREE.CircleGeometry(size * 0.012, 12), new THREE.MeshBasicMaterial({ color: ink[n.tone], transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    star.position.copy(pos[i]);
    group.add(star);
    if (n.label) {
      const { texture, aspect } = textTexture(n.label, { color: ink[n.tone], size: 64 });
      const h = size * 0.045;
      const m = plane(texture, h * aspect, h, 0.95);
      m.position.copy(pos[i]);
      m.geometry.translate((h * aspect) / 2 + size * 0.02, 0, 0);
      group.add(m);
      labels.push(m);
    }
    labels.push(star);
  });
  return {
    group,
    billboardChildren: true,
    update(t, dt, { camera } = {}) {
      group.rotation.y = t * 0.05;
      if (camera) {
        const q = group.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(camera.quaternion);
        for (const l of labels) l.quaternion.copy(q);
      }
    },
  };
}

function makePiece(m, size, palette, ink) {
  switch (m.kind) {
    case 'image': return imagePiece(m.src, size, ink);
    case 'sketch': return sketchPiece(m.sketch, size, ink);
    case 'melody': return melodyPiece(m.melody, size, ink);
    case 'audio': return audioPiece(size, ink);
    case 'video': return videoPiece(m.src, size, ink);
    case 'model': return modelPiece(m.src, size);
    case 'splat': return splatPiece(m.src, size, m.show);
    case 'sculpture': return sculpturePiece(m.build, size, palette);
    case 'poem': return poemPiece(m.poem, size, ink);
    case 'constellation': return constellationPiece(m.constellation, size, ink);
  }
  return null;
}

// What a world shows from outside: everything marked to be shown, or, if the
// maker marked nothing, the first few things it has to show.
export function exhibitItems(world) {
  const all = [...(world.process?.steps || []).flatMap((s) => s.media), ...world.fragments.flatMap((f) => f.media || [])]
    .filter((m) => SHOWABLE.includes(m.kind));
  const marked = all.filter((m) => m.show);
  return marked.length ? marked : all.slice(0, 5).map((m) => ({ ...m, show: true }));
}

// The highest point the exhibition reaches, in plot widths.
export function exhibitTop(world) {
  let top = 0;
  for (const m of exhibitItems(world)) {
    if (!m.show?.at) continue;
    const size = m.show.size || 0.3;
    top = Math.max(top, m.show.at[1] + (m.poem?.layout === 'helix' ? size * HELIX_RISE : size / 2));
  }
  return top;
}

// `mid` is the height (world units) the unplaced pieces circle at.
export function createExhibit(world, U, mid) {
  const own = bag = { textures: new Set(), media: new Set(), gone: false };
  const group = new THREE.Group();
  const ink = inkColors(world.palette);
  const items = exhibitItems(world);
  const pieces = [];
  items.forEach((m, index) => {
    const size = (m.show === true ? 0.3 : m.show.size) * U;
    const piece = makePiece(m, size, world.palette, ink);
    if (!piece) return;
    const holder = new THREE.Group();
    holder.add(piece.group);
    group.add(onLayer(holder));
    // Every piece keeps its own clock and smoothed sense of a visitor nearby;
    // seeds come from its place in the list, so the motion is the same for everyone.
    pieces.push({ piece, holder, index, size0: size, seed: index * 1.618, clock: 0, near: 0 });
  });
  // Where each piece stands and how it moves: read again whenever the maker moves it,
  // without rebuilding (and so without reloading) anything.
  const place = (list) => {
    const free = list.filter((m) => !m.show?.at);
    for (const p of pieces) {
      const m = list[p.index];
      const show = m.show === true ? { size: 0.3, motion: 'orbit' } : m.show;
      p.motion = show.at ? show.motion : 'orbit';
      p.nearMode = show.near || 'none';
      p.turn = typeof show.turn === 'number' ? show.turn : null;
      p.scale = (show.size * U) / p.size0;
      if (show.at) {
        p.base = new THREE.Vector3(show.at[0], show.at[1], show.at[2]).multiplyScalar(U);
        p.angle = Math.atan2(p.base.z, p.base.x);
        p.radius = Math.hypot(p.base.x, p.base.z) || U * 0.3;
      } else {
        // Unplaced pieces circle the plot between the ground and the top.
        const i = free.indexOf(m), n = free.length;
        p.angle = (i / n) * Math.PI * 2 + 0.4;
        p.radius = U * 0.42;
        p.base = new THREE.Vector3(0, Math.max(mid, U * 0.25) + (i % 2 ? U * 0.1 : -U * 0.04), 0);
      }
    }
  };
  place(items);
  const look = new THREE.Vector3();
  const ease = (x) => x * x * (3 - 2 * x);
  return {
    group,
    // The same world with pieces moved, resized or given new motion: true if it could be applied in place.
    relayout(w) {
      const list = exhibitItems(w);
      if (list.length !== items.length || list.some((m, i) => m.kind !== items[i].kind || m.src !== items[i].src)) return false;
      place(list);
      return true;
    },
    holderOf(index) { return pieces.find((p) => p.index === index)?.holder; },
    // Far from everyone: let heavy pieces go.
    sleep() { for (const p of pieces) p.piece.lazy?.unload(); },
    update(t, dt, camera, { audible = false, presence = 0, dist = 0 } = {}) {
      for (const p of pieces) {
        if (p.piece.lazy && (dist < 45 || presence > 0.5)) p.piece.lazy.load(); // near, or the plot someone chose
        const h = p.holder;
        p.near += (presence - p.near) * Math.min(1, dt * 1.5);
        const near = ease(Math.max(0, Math.min(1, p.near)));
        // 'wake': stillness from afar, motion as you come; the others keep the shared clock.
        p.clock = p.nearMode === 'wake' ? p.clock + dt * (0.04 + 0.96 * near) : t;
        const c = p.clock + p.seed;
        let k = p.scale;
        if (p.motion === 'orbit') {
          const a = p.angle + p.clock * 0.04;
          h.position.set(Math.cos(a) * p.radius, p.base.y + Math.sin(c * 0.4) * U * 0.02, Math.sin(a) * p.radius);
        } else {
          h.position.copy(p.base);
          if (p.motion === 'float') h.position.y += Math.sin(c * 0.55) * U * 0.018;
          if (p.motion === 'breathe') k *= 1 + 0.045 * Math.sin(c * 0.8);
        }
        // 'rise': resting low and small until someone comes, then lifting into place.
        if (p.nearMode === 'rise') {
          const ground = p.size0 * p.scale * 0.3;
          h.position.y = ground + (h.position.y - ground) * near;
          k *= 0.55 + 0.45 * near;
        }
        // 'appear': not there from afar; grows and brightens as you come close.
        if (p.nearMode === 'appear') { k *= Math.max(0.001, near); p.piece.setOpacity?.(near); }
        h.scale.setScalar(k);
        // Facing: a set turn, slowly sway or spin around it, or (unset) face whoever looks.
        let ry;
        if (p.motion === 'spin' || ((p.piece.spin || p.piece.solid) && p.turn === null)) ry = (p.turn || 0) + c * 0.25;
        else if (p.turn !== null) ry = p.turn + (p.motion === 'sway' ? Math.sin(c * 0.5) * 0.35 : 0);
        else if (!p.piece.billboardChildren && camera) {
          h.getWorldPosition(look);
          ry = Math.atan2(camera.position.x - look.x, camera.position.z - look.z);
        } else ry = 0;
        // 'turn': turns to face the visitor as they approach.
        if (p.nearMode === 'turn' && camera) {
          h.getWorldPosition(look);
          const face = Math.atan2(camera.position.x - look.x, camera.position.z - look.z);
          let d = face - ry; d = Math.atan2(Math.sin(d), Math.cos(d));
          ry += d * near;
        }
        h.rotation.y = ry;
        p.piece.update?.(t, dt, { camera, audible, presence });
      }
    },
    dispose() {
      own.gone = true;
      for (const p of pieces) p.piece.dispose?.();
      // A paused video still holds its decoder and buffers; letting go of the source frees them.
      for (const v of own.media) { v.pause(); v.removeAttribute('src'); v.load(); }
      freeObject(group);
      for (const t of own.textures) t.dispose();
      own.textures.clear(); own.media.clear();
      group.removeFromParent();
    },
  };
}
