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
const textures = new Set();

function onLayer(obj) {
  obj.traverse((o) => o.layers.set(1));
  return obj;
}

function tex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  textures.add(t);
  return t;
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

function imagePiece(src, size, ink) {
  const group = new THREE.Group();
  const holder = frameLines(size, size * 0.75, ink[1], 0.4);
  group.add(holder);
  new THREE.TextureLoader().load(src, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    textures.add(t);
    const k = t.image.height / t.image.width;
    const w = k > 1 ? size / k : size, h = w * k;
    group.remove(holder);
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
    const t = new THREE.VideoTexture(v);
    t.colorSpace = THREE.SRGBColorSpace;
    textures.add(t);
    group.add(plane(t, size, h, 0.92));
    group.userData.video = v;
  } else {
    const id = embed?.url.match(/youtube-nocookie\.com\/embed\/([\w-]+)/)?.[1];
    if (id) {
      new THREE.TextureLoader().load(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, (t) => {
        t.colorSpace = THREE.SRGBColorSpace; textures.add(t); group.add(onLayer(plane(t, size, h, 0.85)));
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
  return { group, dispose() { group.userData.video?.pause(); } };
}

function modelPiece(src, size) {
  const group = new THREE.Group();
  if (embedFor(src)) return { group }; // Sketchfab pages cannot stand in the city; they play in the panel.
  import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) => new GLTFLoader().loadAsync(src)).then((gltf) => {
    const obj = gltf.scene;
    const box = new THREE.Box3().setFromObject(obj), sz = box.getSize(new THREE.Vector3());
    const k = size / (Math.max(sz.x, sz.y, sz.z) || 1);
    obj.scale.setScalar(k);
    obj.position.copy(box.getCenter(new THREE.Vector3())).multiplyScalar(-k);
    const light = new THREE.HemisphereLight(0xfff4e0, 0x201810, 2.2);
    group.add(onLayer(obj), onLayer(light));
  }).catch(() => {});
  return { group, spin: true };
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
  const group = new THREE.Group();
  const ink = inkColors(world.palette);
  const items = exhibitItems(world);
  const free = items.filter((m) => !m.show?.at);
  const pieces = [];
  items.forEach((m) => {
    const show = m.show === true ? { size: 0.3, motion: 'orbit' } : m.show;
    const size = show.size * U;
    const piece = makePiece(m, size, world.palette, ink);
    if (!piece) return;
    const holder = new THREE.Group();
    holder.add(piece.group);
    let base, angle = 0;
    if (show.at) {
      base = new THREE.Vector3(show.at[0], show.at[1], show.at[2]).multiplyScalar(U);
    } else {
      // Unplaced pieces circle the plot between the ground and the top.
      const i = free.indexOf(m), n = free.length;
      angle = (i / n) * Math.PI * 2 + 0.4;
      base = new THREE.Vector3(0, Math.max(mid, U * 0.25) + (i % 2 ? U * 0.1 : -U * 0.04), 0);
    }
    group.add(onLayer(holder));
    pieces.push({ piece, holder, base, angle, motion: show.at ? show.motion : 'orbit', radius: U * 0.42, seed: Math.random() * 10 });
  });
  const look = new THREE.Vector3();
  return {
    group,
    update(t, dt, camera, { audible = false, presence = 0 } = {}) {
      for (const p of pieces) {
        const h = p.holder;
        if (p.motion === 'orbit') {
          const a = p.angle + t * 0.03;
          h.position.set(Math.cos(a) * p.radius, p.base.y + Math.sin(t * 0.4 + p.seed) * U * 0.02, Math.sin(a) * p.radius);
        } else {
          h.position.copy(p.base);
          if (p.motion === 'float') h.position.y += Math.sin(t * 0.5 + p.seed) * U * 0.015;
        }
        // Flat pieces turn to face you around the vertical axis; solid ones turn on their own.
        if (p.piece.spin || p.motion === 'spin') h.rotation.y = t * 0.25 + p.seed;
        else if (!p.piece.billboardChildren && camera) {
          h.getWorldPosition(look);
          h.rotation.y = Math.atan2(camera.position.x - look.x, camera.position.z - look.z);
        }
        p.piece.update?.(t, dt, { camera, audible, presence });
      }
    },
    dispose() {
      for (const p of pieces) p.piece.dispose?.();
      group.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.uniforms?.map?.value?.dispose(); o.material.dispose(); } });
      group.removeFromParent();
    },
  };
}
