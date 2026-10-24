// The exhibition you can see from the street: a world's media standing and
// playing inside its plot. Pictures and sketches hang in the air, melodies
// light up as they play, sculptures and models turn, poems drift apart and
// gather into lines, constellations of ideas slowly rotate.
// Units: U = plot width in world units (see build.js). Everything is on layer 1.
import * as THREE from 'three';
import { createBuild } from './build.js';
import { SHOWABLE, inkColors, embedFor, constellationLayout, melodyFreq, ctx, pluck } from './media.js';
import { glowTint, glowQuads, createHaze, HAZE_MAX, knownGlow, keepGlow, glowImage, glowColour, glowModel, glowSplat } from './glow.js';

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

function onLayer(obj, layer = 1) {
  obj.traverse((o) => o.layers.set(layer));
  return obj;
}

// Seen through a plot's open doorway from outside (see city.js), a plot's pieces are drawn
// on a layer of their own into the doorway's view, never into the city around it; and only
// a few of them, never point clouds, so looking in costs little.
export const PEEK_LAYER = 2, PEEK_MAX = 4;

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

// Pictures load only when someone comes near (like models), so a city full of
// worlds does not fetch and decode every picture at once.
function imagePiece(m, size, ink) {
  const src = m.src;
  return lazyPiece(size, (learn) => new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(src, (t) => {
      t = fit(t);
      t.colorSpace = THREE.SRGBColorSpace;
      const k = t.image.height / t.image.width;
      const w = k > 1 ? size / k : size, h = w * k;
      learn?.(glowImage(t.image));
      const g = new THREE.Group();
      const pic = plane(t, w, h, 0.92), frame = frameLines(w * 1.04, h * 1.04, ink[1], 0.35);
      g.add(pic, frame);
      resolve({ object: g, setOpacity(a) { pic.material.opacity = 0.92 * a; frame.material.opacity = 0.35 * a; }, free() { freeObject(g); t.dispose(); } });
    }, undefined, reject);
  }), { src, glow: m.glow, solid: false, what: 'picture' });
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

// Films too: the video (and its decoder) exists only while someone is near.
function videoPiece(m, size, ink) {
  const src = m.src;
  const embed = embedFor(src);
  const h = size * 9 / 16;
  const file = !embed && (/\.(mp4|webm|mov)(\?|$)/i.test(src) || src.startsWith('data:video/'));
  const id = embed?.url.match(/youtube-nocookie\.com\/embed\/([\w-]+)/)?.[1];
  return lazyPiece(size, (learn) => new Promise((resolve) => {
    const g = new THREE.Group();
    const mats = [];
    const frame = frameLines(size * 1.04, h * 1.04, ink[1], 0.35);
    g.add(frame);
    const fades = (list) => (a) => list.forEach(([mat, o]) => { mat.opacity = o * a; });
    if (file) {
      // A first frame and a little of the film; it buffers as you come nearer and plays up close.
      const v = Object.assign(document.createElement('video'), { src: src.startsWith('data:') ? src : src + '#t=0.1', muted: true, loop: true, playsInline: true, crossOrigin: 'anonymous', preload: 'metadata' });
      const t = new THREE.VideoTexture(v);
      t.colorSpace = THREE.SRGBColorSpace;
      const pic = plane(t, size, h, 0.92);
      g.add(pic);
      // Without a glow yet: take its colours from a later frame (well into the film, past
      // any title or fade from black). Three are looked at, and the most colourful kept,
      // so a white flash or a dark cut does not stand for the whole film.
      if (learn) {
        const still = Object.assign(document.createElement('video'), { src, muted: true, playsInline: true, crossOrigin: 'anonymous', preload: 'auto' });
        const at = [0.4, 0.6, 0.8];
        let best = null;
        const next = () => { still.currentTime = (still.duration || 2) * at.shift(); };
        still.addEventListener('loadedmetadata', next, { once: true });
        still.addEventListener('seeked', () => {
          const o = glowImage(still);
          if (glowColour(o) > glowColour(best)) best = o;
          if (at.length) return next();
          learn(best);
          still.removeAttribute('src'); still.load();
        });
      }
      return resolve({
        object: g,
        setOpacity: fades([[pic.material, 0.92], [frame.material, 0.35]]),
        update(dt, { near = 1 } = {}) {
          if (near > 0.1 && v.preload !== 'auto') v.preload = 'auto';
          if (near > 0.2 && v.paused && !v.ended) v.play().catch(() => {});
          else if (near < 0.12 && !v.paused) v.pause();
        },
        // A paused video still holds its decoder and buffers; letting go of the source frees them.
        free() { v.pause(); v.removeAttribute('src'); v.load(); freeObject(g); t.dispose(); },
      });
    }
    // A play mark, drawn in lines, over the film's still where there is one.
    const s = size * 0.08;
    const tri = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-s * 0.6, -s, 0.01), new THREE.Vector3(s, 0, 0.01), new THREE.Vector3(-s * 0.6, s, 0.01), new THREE.Vector3(-s * 0.6, -s, 0.01),
    ]), new THREE.LineBasicMaterial({ color: ink[2], transparent: true, opacity: 0.9, depthWrite: false }));
    g.add(tri);
    mats.push([frame.material, 0.35], [tri.material, 0.9]);
    const done = () => resolve({ object: g, setOpacity: fades(mats), free() { freeObject(g); } });
    if (!id) return done();
    new THREE.TextureLoader().load(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      const pic = plane(t, size, h, 0.85);
      g.add(pic);
      mats.push([pic.material, 0.85]);
      learn?.(glowImage(t.image));
      done();
    }, undefined, done);
  }), { src, glow: m.glow, solid: false, what: 'film' });
}

// Heavy pieces (pictures, films, 3D models, splats) load only while someone is near the
// plot and are freed again when they leave; from afar a soft glow in their colours keeps their place.
// Heavy pieces take turns: one loads and is set up at a time, with a breath between,
// so arriving at a plot never stacks several parses into one long frame.
let turn = Promise.resolve();
// A colour as light for the haze: never too dark to be seen, a little richer than it is.
function vivid([r, g, b]) {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b, k = l < 0.22 ? 0.22 / Math.max(l, 0.01) : 1;
  return [r, g, b].map((v) => Math.max(0, l * k + (v * k - l * k) * 1.5));
}
// Light (linear) back to an ink colour (#rrggbb), for the studio's light to start from.
const toHex = (c) => '#' + c.map((v) => Math.round(Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2) * 255).toString(16).padStart(2, '0')).join('');
// How the light of a plot moves (the maker's choice), as the haze shader knows it.
export const LIGHT_FLOWS = ['drift', 'rise', 'swirl'];
// An ink colour (#rrggbb) as light for the haze, in linear light.
const inkTint = (hex) => [1, 3, 5].map((i) => Math.pow(parseInt(hex.slice(i, i + 2), 16) / 255, 2.2));
const STAGGER = 0.28; // seconds between one piece starting to load and the next
const breathe = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 300 }) : setTimeout(r, 60)));
function inTurn(load) {
  const go = turn.then(breathe).then(load);
  turn = go.catch(() => {});
  return go;
}

function lazyPiece(size, load, { src, glow: saved, solid = true, what = '3D piece', heavy = solid } = {}) {
  const group = new THREE.Group();
  // From afar, the piece is only its colour in the plot's haze (see createExhibit). Never a
  // stand-in: until its glow exists (made the first time the piece loads), it adds nothing.
  let tint = null, quads = null;
  const shine = (o) => { const c = o && glowTint(o); if (c) { tint = c; quads = glowQuads(o); } };
  const known = saved || knownGlow(src);
  shine(known);
  // A piece loaded without a glow makes one, for this visit and for the studio to keep.
  const learn = known ? null : (o) => { if (!o) return; keepGlow(src, o); shine(o); };
  const b = bag;
  let obj = null, want = false, busy = false, fade = 0, seen = 1, haze = 0;
  const piece = {
    group, solid,
    // Its share of the haze: its colour, and how strongly it still shows there.
    get tint() { return tint; },
    get quads() { return quads; },
    get haze() { return haze; },
    lazy: {
      heavy, // models and splats wait their turn
      get loaded() { return !!obj || busy; },
      get drawn() { return !!tint; },
      load() {
        want = true;
        if (obj || busy) return;
        busy = true;
        (heavy ? inTurn(() => load(learn)) : load(learn)).then((o) => {
          busy = false;
          if (!o) return;
          if (b.gone || !want) return o.free();
          obj = o;
          fade = 0;
          o.setOpacity?.(0);
          group.add(onLayer(o.object));
        }).catch((e) => {
          busy = false;
          // Say so instead of staying silent: the studio shows a note, the console the reason.
          console.warn(`Khora: a ${what} could not load`, e);
          if (solid) window.dispatchEvent(new CustomEvent('freeart:piecefail', { detail: String(e?.message || e) }));
        });
      },
      unload() {
        want = false;
        if (!obj) return;
        obj.object.removeFromParent();
        obj.free();
        obj = null;
        fade = 0;
      },
    },
    setOpacity(a) { seen = a; },
    // A splat used as a setting: where it was seen from (its sharpest view), in its own space.
    get eye() { return obj?.eye || null; },
    update(t, dt, info) {
      obj?.update?.(dt, info);
      // The real piece fades in out of the haze, and its light in the haze gives way.
      if (obj && fade < 1) fade = Math.min(1, fade + dt / 0.9);
      if (obj) obj.setOpacity?.(fade * seen);
      // While it loads, its light breathes, so a visitor knows something is coming.
      haze = tint ? seen * (1 - fade) * (busy ? 0.6 + 0.4 * Math.sin(t * 4) : 1) : 0;
    },
    dispose() { piece.lazy.unload(); },
  };
  return piece;
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

// Parsed models are kept for a while and shared: the city and the world view (or a
// second visit) then neither download nor parse the same file again.
const models = new Map(); // src -> { ready, users, timer }
async function parseModel(src) {
  if (/\.fbx(\?|#|$)/i.test(src)) {
    const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
    const scene = await new FBXLoader().loadAsync(src);
    return { scene, clips: scene.animations };
  }
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(src);
  return { scene: gltf.scene, clips: gltf.animations };
}
// The model's true extent, measured once on the loaded original: skinned meshes need
// their bones posed first, or a fresh copy measures as a point and is blown up to fill the sky.
function measure(scene) {
  scene.updateMatrixWorld(true);
  let skinned = false;
  scene.traverse((o) => { if (o.isSkinnedMesh) { skinned = true; o.skeleton.update(); o.computeBoundingBox(); } });
  return { box: new THREE.Box3().setFromObject(scene), skinned };
}
function useModel(src) {
  let m = models.get(src);
  if (!m) {
    m = { ready: parseModel(src).then((r) => ({ ...r, ...measure(r.scene) })), users: 0, timer: 0 };
    models.set(src, m);
    m.ready.catch(() => models.delete(src));
  }
  clearTimeout(m.timer);
  m.users++;
  return m.ready;
}
function releaseModel(src) {
  const m = models.get(src);
  if (!m || --m.users > 0) return;
  m.timer = setTimeout(() => {
    if (m.users > 0) return;
    models.delete(src);
    m.ready.then(({ scene }) => freeObject(scene), () => {});
  }, 120000);
}

// One light for every model, there from the first one on: a light per model changed the
// number of lights each time one came or went, and every lit material then recompiled.
let modelLight = null;
function lightModels() {
  if (modelLight || !host) return;
  modelLight = new THREE.HemisphereLight(0xfff4e0, 0x201810, 2.2);
  modelLight.layers.set(1);
  modelLight.layers.enable(PEEK_LAYER); // and in the doorway's view
  host.scene.add(modelLight);
}

function modelPiece(m, size) {
  const src = m.src;
  if (embedFor(src)) return { group: new THREE.Group() }; // Sketchfab pages cannot stand in the city; they play in the panel.
  return lazyPiece(size, async (learn) => {
    let base;
    try { base = await useModel(src); } catch (e) { releaseModel(src); throw e; }
    // Skinned models need their skeleton copied too; plain ones are cheaper to copy.
    const scene = base.skinned ? (await import('three/addons/utils/SkeletonUtils.js')).clone(base.scene) : base.scene.clone(true);
    const clips = base.clips;
    const obj = new THREE.Group();
    obj.add(scene);
    lightModels();
    fitInto(scene, base.box, size);
    learn?.(glowModel(obj));
    // Each copy gets its own materials (to fade on its own); shapes and textures stay shared.
    const mats = [];
    scene.traverse((o) => {
      if (!o.material) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      for (const m of [].concat(o.material)) { m.transparent = true; mats.push(m); }
    });
    // A model that comes with its own animation plays its first one, gently looping.
    const mixer = clips?.length ? new THREE.AnimationMixer(scene) : null;
    mixer?.clipAction(clips[0]).play();
    // Ready its shaders without holding up a frame, where the browser can compile in parallel.
    try { onLayer(obj); const cam = host.camera.clone(); cam.layers.set(1); await host.renderer.compileAsync(obj, cam, host.scene); } catch {}
    let freed = false;
    return {
      object: obj,
      free: () => { if (freed) return; freed = true; mats.forEach((m) => m.dispose()); releaseModel(src); },
      setOpacity: (a) => mats.forEach((m) => { m.opacity = a; }),
      update: (dt) => mixer?.update(dt),
    };
  }, { src, glow: m.glow });
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

function splatPiece(m, size) {
  const src = m.src, show = m.show;
  if (!host) return null;
  return lazyPiece(size, async (learn) => {
    const S = await sparkLib();
    const fileType = splatType(src);
    const mesh = new S.SplatMesh(src.startsWith('data:') ? { fileBytes: await bytesOf(src), fileType } : { url: src, fileType });
    await mesh.initialized;
    // Most splat files (World Labs included) are stored upside down for three.js.
    if (!show?.flip) mesh.quaternion.set(1, 0, 0, 0);
    const obj = new THREE.Group();
    obj.add(mesh);
    const core = coreBox(mesh);
    // As a setting it is not a thing on a stand but the place around the others: its ground
    // spread over the plot from edge to edge, floor on the floor, and the point it was seen
    // from (the file's origin, where it is sharpest) kept, for the tour to stand at.
    let eye = null;
    if (show?.setting) {
      const box = (core || mesh.getBoundingBox(true)).clone().applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(mesh.quaternion));
      const sz = box.getSize(new THREE.Vector3()), k = size / (Math.max(sz.x, sz.z) || 1);
      mesh.scale.setScalar(k);
      mesh.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2).multiplyScalar(k);
      eye = mesh.position.clone();
    } else fitInto(mesh, core || mesh.getBoundingBox(true), size);
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
    learn?.(glowSplat(mesh, core));
    return { object: obj, eye, free: () => { mesh.removeFromParent(); mesh.dispose(); sparkForget(S); }, setOpacity: (a) => { mesh.opacity = a; } };
  }, { src, glow: m.glow });
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
    case 'image': return imagePiece(m, size, ink);
    case 'sketch': return sketchPiece(m.sketch, size, ink);
    case 'melody': return melodyPiece(m.melody, size, ink);
    case 'audio': return audioPiece(size, ink);
    case 'video': return videoPiece(m, size, ink);
    case 'model': return modelPiece(m, size);
    case 'splat': return splatPiece(m, size);
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
// room: the plot's box ({ w, d, h }, standing on the ground), which the haze fills.
export function createExhibit(world, U, mid, room = { w: U, d: U, h: Math.max(exhibitTop(world) * U + 0.15, U) }) {
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
    // A piece that needs no loading (words, drawings, melodies...) still stands in the haze
    // from outside, in the world's own colours, and grows into place once you are inside.
    const tint = piece.lazy ? null : inkTint(world.palette?.[[1, 2][index % 2]] || ink[index % 3]); // drawn in the accent and the light colour (the deep one is the dark around them)
    pieces.push({ piece, holder, index, size0: size, seed: index * 1.618, clock: 0, near: 0, tint, show: 1 });
  });
  const roomBox = new THREE.Box3(new THREE.Vector3(-room.w / 2, 0, -room.d / 2), new THREE.Vector3(room.w / 2, room.h, room.d / 2));
  const reveal = Math.max(5, U * 1.2), eye = new THREE.Vector3();
  let revealed = false, nextLoad = 0, ambient = 1, preferred = [];
  const sz = roomBox.getSize(new THREE.Vector3()), palReach = Math.max(sz.x, sz.y, sz.z) * 0.32;
  // The world's light colours (its accent, its light, the accent again); the deep colour is
  // the dark it is drawn on, not a light.
  const palLights = world.palette?.length === 3 ? [1, 2, 1].map((c, i) => {
    const at = [[-0.28, 0.22, 0.2], [0.3, 0.55, -0.22], [-0.05, 0.85, 0.05]][i];
    return [at[0] * sz.x, at[1] * sz.y, at[2] * sz.z, vivid(inkTint(world.palette[c])), c];
  }) : [];
  // From afar the plot's pieces are one haze inside its lines, each a blur of its colour.
  const haze = pieces.length || world.palette?.length ? createHaze(roomBox.min, roomBox.max) : null;
  if (haze) group.add(onLayer(haze));
  // The light the maker painted (if any): it takes the place of the light made from the pieces.
  let painted = null, flow = 0, pace = 1;
  const setLight = (light) => {
    painted = light?.spots?.length ? light.spots.map((o) => [o.at[0] * U, o.at[1] * U, o.at[2] * U, Math.max(0.05, o.r) * U, vivid(inkTint(o.c))]) : null;
    flow = Math.max(0, LIGHT_FLOWS.indexOf(light?.flow));
    pace = typeof light?.speed === 'number' ? light.speed * 2 : 1;
  };
  setLight(world.light);
  // Where each piece stands and how it moves: read again whenever the maker moves it,
  // without rebuilding (and so without reloading) anything.
  let current = items;
  const place = (list) => {
    current = list;
    const free = list.filter((m) => !m.show?.at);
    for (const p of pieces) {
      const m = list[p.index];
      const show = m.show === true ? { size: 0.3, motion: 'orbit' } : m.show;
      p.setting = m.kind === 'splat' && !!show.setting;
      p.motion = p.setting ? 'still' : show.at ? show.motion : 'orbit';
      p.nearMode = p.setting ? 'none' : show.near || 'none';
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
  // The gallery: in a grown plot (the hall) the pieces leave their places and spread out
  // through the dark, one after another in the maker's order, each given room by its size
  // (a big piece stands further from its neighbours), turning left and right and rising
  // and falling, so that going from one to the next is a real journey with depth around it.
  const gallery = () => {
    const hash = (n) => { const x = Math.sin(n * 91.345 + 7.13) * 43758.5453; return x - Math.floor(x); };
    let heading = hash(pieces.length) * Math.PI * 2, prev = 0, room = null;
    const at = new THREE.Vector3(), out = [];
    pieces.forEach((p, i) => {
      // A setting is a room of its own on the way: the pieces after it (in the tour's order)
      // stay inside it just as the maker placed them there, around its point of view.
      if (room && !p.setting) {
        p.gallery = room.gallery.clone().add(p.base).sub(room.base);
        p.room = room.index;
        out.push(p.gallery);
        return;
      }
      p.room = null;
      const s = p.setting ? p.size0 * p.scale * 0.75 : p.size0 * p.scale;
      if (i) {
        heading += (hash(i) - 0.5) * (p.setting || room ? 0.6 : 2.2);
        const step = 1.15 * (prev + s) + U * 0.12;
        at.x += Math.cos(heading) * step;
        at.z += Math.sin(heading) * step;
      }
      if (p.setting) {
        p.gallery = new THREE.Vector3(at.x, 0, at.z).add(p.base);
        room = p;
        prev = s;
        out.push(p.gallery);
        return;
      }
      room = null;
      const side = (i % 2 ? 1 : -1) * (0.35 + hash(i + 40) * 0.5) * s;
      p.gallery = new THREE.Vector3(at.x - Math.sin(heading) * side, Math.max(s * 0.7, mid + (hash(i + 80) - 0.4) * s * 1.6), at.z + Math.cos(heading) * side);
      out.push(p.gallery);
      prev = s;
    });
    // Centred on the plot, so it spreads out evenly around where the plot stood.
    const c = new THREE.Vector3();
    for (const v of out) c.add(v);
    if (out.length) c.divideScalar(out.length).setY(0);
    for (const v of out) v.sub(c);
    const box = new THREE.Box3();
    for (const p of pieces) box.expandByPoint(p.gallery.clone().addScalar(p.size0 * p.scale)).expandByPoint(p.gallery.clone().addScalar(-p.size0 * p.scale));
    return box;
  };
  let galleryBox = gallery(), spread = 0, focusSetting = -1;
  const look = new THREE.Vector3(), cube = new THREE.Box3(), at = new THREE.Vector3(), ws = new THREE.Vector3();
  const ease = (x) => x * x * (3 - 2 * x);
  return {
    group,
    // The same world with pieces moved, resized or given new motion: true if it could be applied in place.
    relayout(w) {
      const list = exhibitItems(w);
      if (list.length !== items.length || list.some((m, i) => m.kind !== items[i].kind || m.src !== items[i].src || !!m.show?.setting !== !!items[i].show?.setting)) return false; // a splat that becomes a setting (or stops being one) loads anew
      place(list);
      galleryBox = gallery();
      return true;
    },
    holderOf(index) { return pieces.find((p) => p.index === index)?.holder; },
    // The piece under a ray: its own surfaces first (so a picture in front of a big poem
    // wins), else the piece whose standing cube the ray passes closest to the middle of.
    pick(raycaster) {
      const ray = raycaster.ray, shown = pieces.filter((p) => p.holder.scale.x >= p.scale * 0.2); // 'appear'/'rise' pieces still far off are skipped
      const holders = new Map(shown.map((p) => [p.holder, p]));
      const result = (p) => {
        const h = p.holder;
        return { index: p.index, holder: h, centre: h.getWorldPosition(new THREE.Vector3()), radius: p.size0 * h.getWorldScale(ws).x * 0.55, item: current[p.index], solid: !!p.piece.solid };
      };
      const layers = raycaster.layers.mask;
      raycaster.layers.enableAll();
      let hits = [];
      // Big meshes and splats are judged by their cube below; everything else by its surfaces.
      try { hits = raycaster.intersectObjects(shown.filter((p) => !['model', 'splat'].includes(current[p.index].kind)).map((p) => p.holder), true); } catch {}
      raycaster.layers.mask = layers;
      // Words and constellations are airy: a picture or film seen through them still wins.
      const airy = (p) => ['poem', 'constellation', 'melody'].includes(current[p.index].kind);
      let first = null;
      for (const hit of hits) {
        if (hit.object.isLine) continue;
        let o = hit.object, ok = true;
        while (o && !holders.has(o)) { if (!o.visible) ok = false; o = o.parent; }
        if (!o || !ok || !o.visible) continue;
        const p = holders.get(o);
        if (!airy(p)) return result(p);
        first ||= p;
      }
      let best = null, score = Infinity;
      for (const p of shown) {
        if (first && airy(p)) continue; // past airy words, look only for a solid piece close to the ray
        const h = p.holder, r = p.size0 * h.getWorldScale(ws).x * 0.55;
        h.getWorldPosition(look);
        if (!ray.intersectBox(cube.setFromCenterAndSize(look, ws.setScalar(r * 2)), at)) continue;
        const k = Math.sqrt(ray.distanceSqToPoint(look)) / r;
        if (k < score && (!first || k < 0.8)) { score = k; best = p; }
      }
      best ||= first;
      return best && result(best);
    },
    // Keep one piece where it is (while someone looks at it closely), or let it move again.
    // Where each piece stands now (in world space), how big it is there, and what it is:
    // for a guided tour through the plot.
    spots() {
      const k = group.getWorldScale(ws).x;
      return pieces.map((p) => {
        const s = { index: p.index, at: p.holder.getWorldPosition(new THREE.Vector3()), size: p.size0 * (p.scale || 1) * k, item: current[p.index], solid: !!p.piece.solid, room: p.room ?? null };
        // A setting: the guide stands where it was seen from, looking the way it looked.
        if (p.setting) {
          s.setting = true;
          const e = p.piece.eye;
          s.eye = e ? p.holder.localToWorld(e.clone()) : null;
          s.forward = new THREE.Vector3(0, 0, -1).applyQuaternion(p.holder.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
        }
        return s;
      });
    },
    // How far the pieces have spread out into the hall (0: in their plot, 1: the gallery),
    // and the room the gallery takes (in the plot's own units).
    spread(v) { spread = v; },
    galleryBox() { return galleryBox; },
    galleryAt(index) { return pieces.find((p) => p.index === index)?.gallery || new THREE.Vector3(); },
    // Which setting shows in the plot (the studio shows the one being worked on).
    showSetting(index) { focusSetting = index; },
    // A setting's point of view in plot units (x, z from the middle, y from the ground) and
    // the way it looks, once it has loaded: for placing things in front of it.
    settingView(index) {
      const p = pieces.find((x) => x.index === index && x.setting), e = p?.piece.eye;
      if (!e) return null;
      const r = p.turn || 0, at = e.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), r).multiplyScalar(p.scale).add(p.base).divideScalar(U);
      return { at: at.toArray(), forward: [-Math.sin(r), -Math.cos(r)] };
    },
    // These pieces load before the others (the one a tour shows now, and the next).
    prefer(list) { preferred = list; },
    hold(index) { for (const p of pieces) p.held = p.index === index; },
    // Far from everyone: let heavy pieces go.
    sleep() { for (const p of pieces) p.piece.lazy?.unload(); },
    setLight,
    // The light as it is made from the pieces now (in plot units), for the studio to start painting from.
    autoLight() {
      const out = [], seen = new Set();
      const add = (at, c, r) => { const hex = toHex(c); if (out.length < 12 && !seen.has(hex)) { seen.add(hex); out.push({ at: at.map((v) => Math.round(v * 100) / 100), c: hex, r: Math.round(Math.min(1, r) * 100) / 100 }); } };
      for (const p of pieces) {
        const q = p.holder.position, s = p.size0 * (p.scale || 1), r = Math.max(0.25, (s * 0.9) / U);
        const quads = !p.tint && p.piece.quads, tint = p.tint || p.piece.tint;
        if (quads) quads.forEach((c, i) => add([(q.x + (i % 2 ? 0.28 : -0.28) * s) / U, Math.max(0.05, (q.y + (i < 2 ? 0.22 : -0.22) * s) / U), q.z / U], c, r * 0.8));
        else if (tint) add([q.x / U, q.y / U, q.z / U], tint, r);
      }
      palLights.forEach(([x, y, z, , c]) => add([x / U, y / U, z / U], inkTint(world.palette[c]), palReach / U));
      return out;
    },
    update(t, dt, camera, { audible = false, presence = 0, wake = true, all = false, come = null, at = false, inside, peek = false, lighting = false } = {}) {
      const tanHalf = camera ? Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) : 1;
      // At the plot (at: chosen, or the visitor stands by it), or the eye close to it from
      // whichever side: the haze lifts and every piece shows as it is. Stepping well back
      // again, the pieces go back into the haze.
      // In the city the plot opens only to someone inside it (inside: true or false).
      let close = at || !!inside;
      if (camera && inside === undefined) {
        const d = roomBox.distanceToPoint(group.worldToLocal(eye.copy(camera.position)));
        if (d < reveal) close = true;
        else if (d < reveal * 1.7 && revealed) close = true;
      }
      revealed = close;
      // Looked into through the doorway: the pieces come as if you were in, but stay out of the city.
      const looking = peek && !revealed, open = revealed || looking;
      let peekLoads = 0;
      if (looking) for (const p of pieces) if (p.piece.lazy?.loaded) peekLoads++;
      const want = [];
      // Settings stand in the same plot, one over the other: until the hall spreads them out
      // into rooms, only one is there (the first, or the one the studio is looking at).
      const firstSetting = pieces.find((p) => p.setting)?.index ?? -1, shownSetting = pieces.some((p) => p.setting && p.index === focusSetting) ? focusSetting : firstSetting;
      for (const p of pieces) {
        const h = p.holder;
        const away = p.setting && spread < 0.3 && p.index !== shownSetting;
        // How much of the view the piece fills (films play once it is large enough).
        // Nothing loads before the visitor has come in (wake); the studio shows everything (all).
        let inView = 1;
        if (camera) { h.getWorldPosition(look); inView = (p.size0 * h.getWorldScale(ws).x) / (2 * Math.max(0.01, camera.position.distanceTo(look)) * tanHalf); }
        p.nearView = inView;
        const lazy = p.piece.lazy;
        // Only at the plot (revealed): from any further it is its light in the haze. A piece
        // with no glow yet (from a world saved before glows) loads from much further, as it
        // used to, and leaves its glow behind for the rest of the visit.
        // In the city nothing loads from outside, glow or not.
        const early = inside === undefined && !lazy?.drawn && inView > (come ? 0.02 : 0.05);
        const peekable = looking && current[p.index].kind !== 'splat'; // point clouds never show from outside
        if (away && !all) { h.visible = false; continue; } // (the studio still loads it, unseen, to know its view)
        if (lazy && p.held) lazy.load(); // looked at closely: at once
        else if (lazy && wake && (all || revealed || early || (peekable && (lazy.loaded || peekLoads < PEEK_MAX)))) want.push(p);
        else if (lazy?.loaded && (lazy.drawn || inside !== undefined) && !all && !p.held && !revealed && !peekable) lazy.unload();
        // Drawn into the city (layer 1) or only into the doorway's view (the peek layer).
        const layer = looking ? PEEK_LAYER : 1;
        if (p.layer !== layer || (looking && lazy?.loaded)) { onLayer(h, layer); p.layer = layer; }
        if (p.held) { p.piece.update?.(t, dt, { camera, audible, presence, near: 1 }); continue; }
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
        // In the hall: drawn out of their places into the gallery, the first ones first.
        if (spread > 0) {
          const g = ease(Math.max(0, Math.min(1, spread * 1.6 - p.index * 0.6 / Math.max(1, pieces.length))));
          h.position.lerp(look.copy(p.gallery).setY(p.gallery.y + (p.setting ? 0 : Math.sin(c * 0.45) * p.size0 * p.scale * 0.04)), g);
        }
        // 'rise': resting low and small until someone comes, then lifting into place.
        if (p.nearMode === 'rise') {
          const ground = p.size0 * p.scale * 0.3;
          h.position.y = ground + (h.position.y - ground) * near;
          k *= 0.55 + 0.45 * near;
        }
        // 'appear': not there from afar; grows and brightens as you come close.
        if (p.nearMode === 'appear') { k *= Math.max(0.001, near); p.piece.setOpacity?.(near); }
        // In the city, a piece without loading grows in after you have come inside, in turn.
        if (p.tint) {
          p.show = inside === undefined ? 1 : Math.max(0, Math.min(1, p.show + (open && t >= (p.due ??= t + p.index * STAGGER) ? dt / 0.9 : -dt / 0.6)));
          if (!open) p.due = undefined;
          k *= Math.max(0.001, ease(p.show));
          h.visible = p.show > 0.001;
        }
        h.scale.setScalar(k);
        if (lighting) h.visible = false; // painting the light: the plot stands empty
        else if (!p.tint) h.visible = true;
        if (p.setting) { h.visible = !away && !lighting; h.rotation.y = p.turn || 0; p.piece.update?.(t, dt, { camera, audible, presence, near: 1 }); continue; } // a setting stays as it was seen
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
        p.piece.update?.(t, dt, { camera, audible, presence, near: open ? Math.max(p.nearView, 0.25) : p.nearView });
      }
      // The pieces come one after another, nearest first, each fading in on its own: never
      // a crowd of loads starting in the same frame.
      if (want.length) {
        for (const p of want) if (p.piece.lazy.loaded) p.piece.lazy.load(); // keep what is already coming
        const rank = (p) => (preferred.includes(p.index) ? 10 - preferred.indexOf(p.index) : 0) + p.nearView;
        const next = want.filter((p) => !p.piece.lazy.loaded && (!looking || peekLoads < PEEK_MAX)).sort((a, b) => rank(b) - rank(a))[0];
        if (next && (all || t >= nextLoad)) { next.piece.lazy.load(); nextLoad = t + STAGGER; }
      }
      if (!haze) return;
      const u = haze.material.uniforms;
      // The plot's light is made of what is in it: every piece lights the space around it in
      // its own colours (a picture or film in its four quarters, when there is room for all),
      // so a plot of black and white photographs glows grey and white, a plot of bright
      // paintings in their colours, each where it hangs.
      let n = 0;
      // The plot's light from afar fades as you come in (and in the hall it is not there).
      ambient += ((revealed && !lighting ? 0 : 1) - ambient) * Math.min(1, dt * (revealed ? 1.5 : 0.8));
      if (lighting) ambient = 1;
      if (painted) {
        // Painted by the maker: their colours, where they put them.
        const w = (lighting ? 1 : ambient) * (1 - spread);
        if (w > 0.01) for (const [x, y, z, r, c] of painted) {
          if (n >= HAZE_MAX) break;
          u.uP.value[n].set(x, y, z, r);
          u.uC.value[n++].set(c[0], c[1], c[2], w);
        }
      } else {
        const lit = [];
        for (const p of pieces) {
          const tint = p.tint || p.piece.tint, w = lighting ? (tint ? 1 : 0) : looking ? (tint ? 1 : 0) : (p.tint ? 1 - p.show : p.piece.haze) * (1 - spread);
          if (tint && w >= 0.01) lit.push([p, tint, w]);
        }
        const own = lit.filter(([p]) => !p.tint).length; // pieces with colours of their own (pictures, films, models...)
        const pal = palLights.length;
        const four = lit.length + own * 3 <= HAZE_MAX - pal;
        for (const [p, tint, w] of lit) {
          if (n >= HAZE_MAX - pal) break;
          // Bigger pieces reach further into the plot's colour.
          const r = Math.max(U * 0.12, palReach * 0.6, p.size0 * (p.scale || 1) * 0.9), q = p.holder.position, quads = !p.tint && four && p.piece.quads;
          if (quads) {
            const s = p.size0 * (p.scale || 1);
            quads.forEach((c, i) => {
              const v = vivid(c);
              u.uP.value[n].set(q.x + (i % 2 ? 0.28 : -0.28) * s, q.y + (i < 2 ? 0.22 : -0.22) * s, q.z, r * 0.75);
              u.uC.value[n++].set(v[0], v[1], v[2], w);
            });
            continue;
          }
          const c = vivid(tint);
          u.uP.value[n].set(q.x, q.y, q.z, r);
          u.uC.value[n].set(c[0], c[1], c[2], w);
          n++;
        }
        // The world's own colours are spread through it too, so the whole box is filled.
        if (ambient > 0.01) for (let i = 0; i < pal && n < HAZE_MAX; i++, n++) {
          const [x, y, z, c] = palLights[i];
          u.uP.value[n].set(x, y, z, palReach);
          u.uC.value[n].set(c[0], c[1], c[2], ambient * (own ? 0.3 : 0.8) * (1 - spread)); // pieces with colours of their own lead
        }
      }
      u.uSpeed.value = pace;
      u.uFlow.value = flow;
      u.uBlend.value = painted ? 1 : 0;
      u.uCount.value = n;
      u.uTime.value = t;
      haze.visible = n > 0 && spread < 0.99 && (!revealed || lighting || ambient > 0.01); // the hall is a black void: only the pieces
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
