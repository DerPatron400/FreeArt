// The ideal city: a grid of plots around a central piazza. Every world claims a
// plot and stands in it; empty plots wait for a maker, human or machine.
import * as THREE from 'three';
import { createForm, disposeForm } from './form.js';
import { roman, el, lerp, clamp, rng } from './util.js';
import { Walker, Visitors } from './walker.js';
import { createBuild, disposeBuild, formPlacement, buildTop } from './build.js';
import { createOcean } from './ocean.js';
import { createExhibit, exhibitTop } from './exhibit.js';
import { t } from './i18n.js';

// Physical key (layout and shift independent) so keydown and keyup always match.
const keyName = (e) => (/^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase());

export const HALF = 5; // plots run from -HALF to HALF on both axes
const NATURE = { human: t('nat.human'), machine: t('nat.machine'), together: t('nat.together') };

// The plan: lots are packed into city blocks, blocks are separated by streets,
// and the central block is the piazza, crossed by the two grand avenues.
const GROUPS = [[-5, -4, -3], [-2, -1], [0], [1, 2], [3, 4, 5]];
const STREET = 3.4;   // kerb to kerb
const WALK = 0.45;    // pavement between kerb and facades
const GAP = 0.16;     // between neighbouring buildings
const FLOOR = 0.62;   // one storey

function axis(seed) {
  const r = rng(seed);
  const size = new Map();
  for (let i = -HALF; i <= HALF; i++) size.set(i, i === 0 ? 7.2 : 3.4 + r() * 2.2);
  const blocks = GROUPS.map((g) => g.reduce((a, i) => a + size.get(i), 0) + WALK * 2);
  let cur = -(blocks.reduce((a, b) => a + b, 0) + STREET * (GROUPS.length - 1)) / 2;
  const cells = new Map(), spans = [], streets = [cur - STREET / 2];
  GROUPS.forEach((g, k) => {
    spans.push([cur, cur + blocks[k]]);
    let c = cur + WALK;
    for (const i of g) { cells.set(i, [c, c + size.get(i)]); c += size.get(i); }
    cur += blocks[k];
    streets.push(cur + STREET / 2);
    cur += STREET;
  });
  // Centre the plan on the piazza.
  const [p0, p1] = cells.get(0), o = (p0 + p1) / 2;
  const sh = ([a, b]) => [a - o, b - o];
  for (const [i, c] of cells) cells.set(i, sh(c));
  return {
    cells, spans: spans.map(sh), streets: streets.map((v) => v - o),
    lo: streets[0] - o - STREET / 2, hi: streets[streets.length - 1] - o + STREET / 2,
  };
}
const AX = axis('plan:x'), AZ = axis('plan:z');
export const EXTENT = Math.max(-AX.lo, AX.hi, -AZ.lo, AZ.hi);
const cellOf = (ax, v) => { for (const [i, [a, b]] of ax.cells) if (v >= a && v <= b) return i; return null; };

const key = (x, z) => `${x},${z}`;
const center = (x, z) => {
  const p = PLOT_BY_KEY.get(key(x, z));
  return p ? new THREE.Vector3(p.cx, 0, p.cz) : new THREE.Vector3();
};

// Plots ordered from the piazza outwards, so new worlds settle near the centre.
export const PLOTS = (() => {
  const list = [];
  for (let x = -HALF; x <= HALF; x++) for (let z = -HALF; z <= HALF; z++) if (x || z) list.push({ x, z });
  list.sort((a, b) => Math.max(Math.abs(a.x), Math.abs(a.z)) - Math.max(Math.abs(b.x), Math.abs(b.z))
    || Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z) || Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));
  // Buildings fill their lots like houses along a street: shared building lines,
  // storey heights, mostly low with the odd slender tower; the avenues are grander.
  list.forEach((p, i) => {
    const r = rng(`plot:${p.x},${p.z}`);
    const [x0, x1] = AX.cells.get(p.x), [z0, z1] = AZ.cells.get(p.z);
    const lw = x1 - x0, ld = z1 - z0;
    const roll = r();
    const avenue = p.x === 0 || p.z === 0;
    const floors = roll < 0.08 ? 11 + Math.floor(r() * 9)
      : roll < 0.35 ? 5 + Math.floor(r() * 4)
      : 2 + Math.floor(r() * (avenue ? 4 : 3));
    let w = lw - GAP, d = ld - GAP;
    if (floors > 10) { w *= 0.62 + r() * 0.15; d *= 0.62 + r() * 0.15; } // towers stand slim
    else if (r() < 0.25) d *= 0.7 + r() * 0.2;                              // a yard behind
    p.n = i + 1;
    p.w = w; p.d = d; p.h = p.h0 = floors * FLOOR + 0.3;
    p.floors = floors;
    p.cx = (x0 + x1) / 2;
    // Keep the facade on the street: shallow buildings sit at the front of their lot.
    const fz = p.z <= 0 ? -1 : 1; // which side of the block faces outward
    p.cz = (z0 + z1) / 2 + fz * (ld - GAP - d) / 2;
    p.lot = { x0, x1, z0, z1 };
  });
  return list;
})();
const PLOT_BY_KEY = new Map(PLOTS.map((p) => [key(p.x, p.z), p]));
export const plotNumber = (x, z) => PLOT_BY_KEY.get(key(x, z))?.n;
export const plotCell = (x, z) => PLOT_BY_KEY.get(key(x, z));

// The plot under a point on the ground, if any (margin widens its footprint).
export function plotAt(x, z, margin = 0) {
  const p = PLOT_BY_KEY.get(key(cellOf(AX, x), cellOf(AZ, z)));
  if (!p || Math.abs(x - p.cx) > p.w / 2 + margin || Math.abs(z - p.cz) > p.d / 2 + margin) return null;
  return p;
}

// The middle of the street running past the front of a plot.
export function streetBy(p) {
  let best = 0, bd = Infinity;
  for (const s of AZ.streets) if (Math.abs(s - p.cz) < bd) { bd = Math.abs(s - p.cz); best = s; }
  return new THREE.Vector3(p.cx, 0, best);
}

function boxEdges(cx, cz, w, d, h, out) {
  const a = w / 2, b = d / 2;
  const c = [[-a, -b], [a, -b], [a, b], [-a, b]];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = c[i], [x1, z1] = c[(i + 1) % 4];
    out.push(cx + x0, 0, cz + z0, cx + x1, 0, cz + z1);
    out.push(cx + x0, h, cz + z0, cx + x1, h, cz + z1);
    out.push(cx + x0, 0, cz + z0, cx + x0, h, cz + z0);
  }
}

function lines(positions, color, opacity) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  return new THREE.LineSegments(g, m);
}

export class City {
  constructor(engine, labelsRoot, { onEnter, onSelect, onClaim, onModeChange }) {
    this.engine = engine;
    this.labelsRoot = labelsRoot;
    this.onEnter = onEnter;
    this.onSelect = onSelect;
    this.onClaim = onClaim;
    this.onModeChange = onModeChange;
    this.mode = 'walk'; // 'walk' | 'map' | 'tour'
    this.group = new THREE.Group();
    this.group.visible = false;
    this.items = [];
    this.byKey = new Map();
    this.active = false;
    this.hovered = null;
    this.selected = null;
    this.keys = new Set();
    engine.scene.add(this.group);
    this.buildStatic();
    this.walker = new Walker(engine, this, { EXTENT, plotAt });
    this.visitors = new Visitors(this, 4);
    engine.updaters.add((t, dt) => this.update(t, dt));

    engine.canvas.addEventListener('click', () => {
      if (!this.active || engine.flight || engine.dragDistance >= 6) return;
      const fly = this.mode === 'map';
      if (this.hovered) this.select(this.hovered, { fly }); else this.select(null);
    });
    engine.canvas.addEventListener('dblclick', () => {
      const it = this.hovered && this.byKey.get(key(this.hovered.x, this.hovered.z));
      if (this.active && it) this.enter(it);
    });
    engine.canvas.addEventListener('pointerdown', () => { this.engine.controls.autoRotate = false; });
    window.addEventListener('keydown', (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) { this.keys.clear(); return; }
      this.keys.add(keyName(e));
      if (this.active && this.mode === 'walk' && (keyName(e) === 'e' || e.key === 'Enter') && this.selected) this.act(this.selected);
    });
    // A held key must never outlive its keyup: drop everything whenever a keyup could be lost
    // (focus leaves, a shortcut or menu steals it, the tab is hidden).
    window.addEventListener('keyup', (e) => {
      this.keys.delete(keyName(e));
      if (/^(Meta|Control|Alt|OS)$/.test(e.key)) this.keys.clear();
    });
    const clear = () => this.keys.clear();
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    window.addEventListener('contextmenu', clear);
  }

  buildStatic() {
    // Every plot as a faint wireframe volume.
    this.boxes = lines([], 0x8f8677, 0.22);
    this.group.add(this.boxes);

    this.buildStreets();
    this.ocean = createOcean(this.engine.renderer, { height: 18 });
    this.group.add(this.ocean);

    // Invisible volumes for picking.
    this.pickMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false }), PLOTS.length);
    this.group.add(this.pickMesh);
    this.refreshVolumes();

    // Hover and selection outlines.
    const edge = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    edge.translate(0, 0.5, 0);
    this.hoverBox = new THREE.LineSegments(edge, new THREE.LineBasicMaterial({ color: 0xece4d4, transparent: true, opacity: 0.9 }));
    this.selectBox = new THREE.LineSegments(edge, new THREE.LineBasicMaterial({ color: 0xc9a46a, transparent: true, opacity: 1 }));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xc9a46a, transparent: true, opacity: 0.06, depthWrite: false }));
    floor.position.y = 0.005;
    this.selectBox.add(floor);
    this.hoverBox.visible = this.selectBox.visible = false;
    this.group.add(this.hoverBox, this.selectBox);

    // Where you stand in map mode.
    this.you = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff4dc }));
    this.group.add(this.you);
  }

  // The street plan reduced to its marks: kerbs around every block, crossings at the
  // junctions, a paved piazza, and centre lines that drift slowly along the roads.
  buildStreets() {
    const kerbs = [], marks = [];
    const rect = (x0, z0, x1, z1, out) => out.push(x0, 0, z0, x1, 0, z0, x1, 0, z0, x1, 0, z1, x1, 0, z1, x0, 0, z1, x0, 0, z1, x0, 0, z0);
    for (const [x0, x1] of AX.spans) for (const [z0, z1] of AZ.spans) rect(x0, z0, x1, z1, kerbs);
    rect(AX.lo, AZ.lo, AX.hi, AZ.hi, kerbs);

    // Zebra crossings on each road where it leaves a junction.
    const zebra = (along, across, dir, alongAxisX) => {
      for (let k = -3; k <= 3; k++) {
        const c = across + k * (STREET / 8);
        const a0 = along + dir * 0.35, a1 = along + dir * 1.15;
        if (alongAxisX) marks.push(a0, 0, c, a1, 0, c); else marks.push(c, 0, a0, c, 0, a1);
      }
    };
    const h = STREET / 2, nx = AX.streets.length - 1, nz = AZ.streets.length - 1;
    AX.streets.forEach((sx, i) => AZ.streets.forEach((sz, j) => {
      if (j > 0) zebra(sz - h, sx, -1, false);
      if (j < nz) zebra(sz + h, sx, 1, false);
      if (i > 0) zebra(sx - h, sz, -1, true);
      if (i < nx) zebra(sx + h, sz, 1, true);
    }));

    // The piazza: a paved square with a fine grid, the city's still centre.
    const [px0, px1] = AX.cells.get(0), [pz0, pz1] = AZ.cells.get(0);
    const inset = 0.6;
    rect(px0 + inset, pz0 + inset, px1 - inset, pz1 - inset, marks);
    const n = 8;
    for (let i = 1; i < n; i++) {
      const x = lerp(px0 + inset, px1 - inset, i / n), z = lerp(pz0 + inset, pz1 - inset, i / n);
      marks.push(x, 0, pz0 + inset, x, 0, pz1 - inset, px0 + inset, 0, z, px1 - inset, 0, z);
    }
    this.group.add(lines(kerbs, 0x8f8677, 0.2), lines(marks, 0x8f8677, 0.09));

    // Centre lines: one segment per stretch of road between junctions, dashed in the shader.
    const pos = [], run = [];
    const seg = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      pos.push(x0, 0.01, z0, x1, 0.01, z1);
      run.push(0, len);
    };
    for (const s of AX.streets) for (const [a, b] of AZ.spans) seg(s, a, s, b);
    for (const s of AZ.streets) for (const [a, b] of AX.spans) seg(a, s, b, s);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('run', new THREE.Float32BufferAttribute(run, 1));
    this.laneUniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x8f8677) } };
    this.lanes = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      uniforms: this.laneUniforms, transparent: true, depthWrite: false,
      vertexShader: 'attribute float run; varying float vRun; void main(){ vRun = run; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uTime; uniform vec3 uColor; varying float vRun;
        void main(){
          float d = fract((vRun - uTime * 0.18) / 1.5);
          float on = smoothstep(0.0, 0.06, d) * (1.0 - smoothstep(0.46, 0.52, d));
          if (on < 0.01) discard;
          gl_FragColor = vec4(uColor, 0.16 * on);
        }`,
    }));
    this.group.add(this.lanes);
  }

  // Plot volumes: a lot grows to hold whatever was built on it.
  refreshVolumes() {
    const boxes = [];
    for (const p of PLOTS) boxEdges(p.cx, p.cz, p.w, p.d, p.h, boxes);
    this.boxes.geometry.dispose();
    this.boxes.geometry = new THREE.BufferGeometry();
    this.boxes.geometry.setAttribute('position', new THREE.Float32BufferAttribute(boxes, 3));
    const m = new THREE.Matrix4();
    PLOTS.forEach((p, i) => this.pickMesh.setMatrixAt(i, m.compose(new THREE.Vector3(p.cx, p.h / 2, p.cz), new THREE.Quaternion(), new THREE.Vector3(p.w, p.h, p.d))));
    this.pickMesh.instanceMatrix.needsUpdate = true;
    this.pickMesh.computeBoundingSphere();
  }

  setWorlds(worlds) {
    for (const p of PLOTS) p.h = p.h0;
    for (const it of this.items) {
      disposeBuild(it.build);
      it.exhibit.dispose();
      disposeForm(it.form);
      this.group.remove(it.anchor);
      it.label.remove();
    }
    this.items = [];
    this.byKey.clear();

    // Worlds that asked for a plot get it if free; the rest settle from the centre out.
    const taken = new Set();
    const placed = worlds.map((w) => {
      const k = w.plot && key(w.plot.x, w.plot.z);
      if (k && PLOT_BY_KEY.has(k) && !taken.has(k)) { taken.add(k); return { w, p: PLOT_BY_KEY.get(k) }; }
      return { w, p: null };
    });
    const free = PLOTS.filter((p) => !taken.has(key(p.x, p.z)));
    for (const entry of placed) if (!entry.p) entry.p = free.shift();

    for (const { w: world, p } of placed) {
      if (!p) continue; // the city is full
      const anchor = new THREE.Group();
      anchor.position.copy(center(p.x, p.z));
      const U = Math.min(p.w, p.d);
      p.h = Math.max(p.h0, buildTop(world.build) * U + 0.15, exhibitTop(world) * U + 0.15);
      const build = createBuild(world.build, world.palette, U);
      anchor.add(build);
      const exhibit = createExhibit(world, U, world.build ? buildTop(world.build) * U * 0.45 : p.h0 * 0.5);
      anchor.add(exhibit.group);
      const form = createForm(world, { lod: 0.16, size: 0.62 });
      form.visible = !world.form.hidden;
      const place = formPlacement(world, U, p.h);
      form.scale.setScalar(place.scale);
      form.position.copy(place.pos);
      const drawn = world.form.strokes?.length > 0; // stars placed by hand keep the orientation they were drawn in
      form.rotation.y = drawn ? 0 : p.n;
      if (world.form.type === 'spiral') form.rotation.x = 0.45;
      anchor.add(form);
      this.group.add(anchor);

      const label = el('button', 'label');
      label.append(el('span', 'label__num mono', t('plot.n', { n: roman(p.n) })), el('span', 'label__title', world.title),
        el('span', 'label__by mono', `${world.creator.name} · ${NATURE[world.creator.nature]}`));
      label.addEventListener('click', () => this.select(p));
      label.addEventListener('dblclick', () => this.enter(it));
      label.addEventListener('pointerenter', () => { this.labelHover = p; });
      label.addEventListener('pointerleave', () => { this.labelHover = null; });
      label.hidden = !this.active;
      this.labelsRoot.append(label);
      const it = { world, plot: p, anchor, form, build, exhibit, label, drawn, hover: 0, screen: {} };
      this.items.push(it);
      this.byKey.set(key(p.x, p.z), it);
    }
    this.refreshVolumes();
  }

  plotOf(worldId) {
    return this.items.find((x) => x.world.id === worldId)?.plot || null;
  }

  freeCount() {
    return PLOTS.length - this.byKey.size;
  }

  firstFreePlot() {
    return PLOTS.find((p) => !this.byKey.has(key(p.x, p.z))) || null;
  }

  fitBox(box, p) {
    box.position.set(p.cx, 0, p.cz);
    box.scale.set(p.w, p.h, p.d);
  }

  isBuilt(p) {
    return !!p && this.byKey.has(key(p.x, p.z));
  }

  // Step into a built world, or claim a free plot.
  act(p) {
    const it = this.byKey.get(key(p.x, p.z));
    if (it) this.enter(it); else this.onClaim(p);
  }

  setMode(mode) {
    if (mode === 'tour') {
      if (this.mode === 'map') this.setMode('walk');
      this.select(null);
      this.standing = null;
      if (this.walker.startTour()) { this.mode = 'tour'; this.onModeChange(mode); }
      return;
    }
    const e = this.engine;
    if (mode === 'map') {
      this.walker.hide();
      e.setMode('map');
      const ground = this.walker.pos.clone().setY(0);
      e.controls.target.copy(ground);
      e.flyTo(ground.clone().add(new THREE.Vector3(0, 18, 24)), ground, 1.6);
      this.you.visible = true;
      this.ocean.visible = false; // the map looks down from above the water
    } else {
      this.ocean.visible = true;
      if (this.mode === 'map') this.walker.place(e.controls.target.x, e.controls.target.z, Math.atan2(e.camera.position.x - e.controls.target.x, e.camera.position.z - e.controls.target.z));
      this.you.visible = false;
      this.walker.activate();
    }
    this.mode = mode;
    this.onModeChange(mode);
  }

  isFree(p) {
    return !!p && PLOT_BY_KEY.has(key(p.x, p.z)) && !this.byKey.has(key(p.x, p.z));
  }

  async show({ fromWorld, focus } = {}) {
    this.active = true;
    this.group.visible = true;
    const e = this.engine;
    e.setViewOffset(0);
    e.setMode('map');
    e.scene.fog = new THREE.FogExp2(0x0b0a09, 0.016);
    Object.assign(e.controls, { minDistance: 5, maxDistance: 60, maxPolarAngle: 1.32, autoRotate: false });
    for (const it of this.items) it.label.hidden = false;
    for (const it of this.items) it.form.userData.uniforms.uReveal.value = fromWorld ? 1 : 0;
    this.revealStart = performance.now();

    // The visitor starts in the street in front of the world just left, or at the piazza.
    const from = fromWorld ? this.plotOf(fromWorld) : focus || null;
    const w = this.walker;
    if (from) { const st = streetBy(from); w.place(st.x, st.z, st.z > from.cz ? 0 : Math.PI, Math.min(from.h * 0.6, 3)); }
    else w.place(0, 3.2, 0, 1.6);
    w.mesh.visible = this.mode !== 'map';
    this.you.visible = this.mode === 'map';
    this.ocean.visible = this.mode !== 'map';
    if (fromWorld && from) {
      const c = center(from.x, from.z);
      e.camera.position.copy(c).add(new THREE.Vector3(0, from.h * 0.6, 3));
      e.controls.target.copy(c).setY(from.h * 0.5);
    } else if (!fromWorld) {
      e.camera.position.set(0, 70, 70);
      e.controls.target.set(0, 0, 0);
    }
    const goal = w.cameraGoal(new THREE.Vector3());
    await e.flyTo(this.mode === 'map' ? new THREE.Vector3(0, 19, 27).add(w.pos) : goal, w.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), fromWorld ? 2.2 : 3.8);
    if (!this.active) return;
    if (this.mode === 'tour') this.mode = 'walk';
    this.setMode(this.mode);
  }

  hide() {
    this.active = false;
    this.walker.hide();
    this.group.visible = false;
    this.hovered = null;
    this.select(null, { quiet: true });
    const e = this.engine;
    e.controls.autoRotate = false;
    e.scene.fog = null;
    e.setMode('orbit');
    document.body.style.cursor = '';
    for (const it of this.items) it.label.hidden = true;
  }

  select(p, { quiet = false, fly = true } = {}) {
    this.selected = p;
    this.selectBox.visible = !!p;
    if (p) {
      this.fitBox(this.selectBox, p);
      if (!quiet && fly && !this.engine.flight) {
        const c = center(p.x, p.z);
        const off = this.engine.camera.position.clone().sub(this.engine.controls.target);
        off.setLength(clamp(off.length(), 12, 22));
        this.engine.flyTo(c.clone().add(off), c, 1.2);
      }
    }
    if (!quiet || !p) this.onSelect(p, p ? this.byKey.get(key(p.x, p.z))?.world || null : null);
  }

  async enter(it) {
    if (!this.active || !it) return;
    this.active = false;
    this.walker.deactivate();
    for (const x of this.items) x.label.hidden = true;
    const c = center(it.plot.x, it.plot.z);
    const h = it.plot.h;
    await this.engine.flyTo(c.clone().add(new THREE.Vector3(0, h * 0.55, Math.min(it.plot.w, it.plot.d) * 0.7)), c.clone().setY(h * 0.5), 1.6);
    this.onEnter(it.world);
  }

  walk(dt) {
    const k = this.keys;
    const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const s = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const e = this.engine;
    const move = new THREE.Vector3();
    if (f || s) {
      const fwd = e.controls.target.clone().sub(e.camera.position).setY(0).normalize();
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      move.addScaledVector(fwd, f).addScaledVector(right, s).setLength(dt * (k.has('shift') ? 26 : 12));
      e.controls.autoRotate = false;
    }
    // Keep the visitor inside the walls.
    const lim = EXTENT + 3;
    const t = e.controls.target;
    move.x = clamp(t.x + move.x, -lim, lim) - t.x;
    move.z = clamp(t.z + move.z, -lim, lim) - t.z;
    t.add(move);
    e.camera.position.add(move);
  }

  update(t, dt) {
    if (!this.group.visible) return;
    this.laneUniforms.uTime.value = t;
    this.ocean.userData.uniforms.uTime.value = t;
    const e = this.engine;
    if (this.active && !e.flight && this.mode === 'map') this.walk(dt);
    this.walker.update(t, dt);
    // Standing on a plot opens its panel; walking off closes it.
    if (this.active && this.mode === 'walk' && !e.flight) {
      const here = plotAt(this.walker.pos.x, this.walker.pos.z);
      if (here !== this.standing) {
        this.standing = here;
        if (here) this.select(here, { fly: false });
        else if (this.selected) this.select(null);
      }
    }

    let hovered = this.labelHover || null;
    if (this.active && !e.flight && !hovered) {
      const hit = e.pick([this.pickMesh]);
      hovered = hit ? PLOTS[hit.instanceId] : null;
    }
    if (hovered !== this.hovered) {
      this.hovered = hovered;
      document.body.style.cursor = hovered ? 'pointer' : '';
    }
    this.hoverBox.visible = !!hovered && hovered !== this.selected;
    if (hovered) this.fitBox(this.hoverBox, hovered);
    this.selectBox.material.opacity = 0.6 + 0.4 * Math.sin(t * 3) ** 2;

    this.you.position.set(e.controls.target.x, 0.4 + 0.1 * Math.sin(t * 2), e.controls.target.z);
    this.visitors.update(t, dt);

    const reveal = Math.min(1, (performance.now() - this.revealStart) / 4000);
    for (const it of this.items) {
      const u = it.form.userData.uniforms;
      u.uTime.value = t;
      u.uReveal.value = Math.max(u.uReveal.value, reveal);
      // Once gathered, worlds outside the view are skipped by the graphics card.
      if (reveal >= 1 && !it.culled) {
        it.culled = true;
        it.form.geometry.boundingSphere.radius += 0.8; // room for the breathing noise and hover swell
        it.form.frustumCulled = true;
      }
      const isHover = hovered && hovered === it.plot;
      it.hover = lerp(it.hover, isHover || this.selected === it.plot ? 1 : 0, 1 - Math.pow(0.001, dt));
      u.uHover.value = it.hover;
      if (!it.drawn) it.form.rotation.y += dt * 0.08;
      // The exhibition plays while you are near; the one you stand in can be heard.
      const camDist = e.camera.position.distanceTo(it.anchor.position);
      const far = camDist > 70 && this.selected !== it.plot; // the plot you chose shows in full, even from the map
      if (far && it.exhibit.group.visible) it.exhibit.sleep(); // heavy models and splats let go when nobody is near
      it.exhibit.group.visible = !far;
      if (!far) {
        // Presence: how close a visitor is. Some exhibitions only gather when someone comes.
        let presence = this.selected === it.plot ? 1 : 0;
        if (this.active && this.mode !== 'map') {
          const d = Math.hypot(this.walker.pos.x - it.anchor.position.x, this.walker.pos.z - it.anchor.position.z);
          presence = Math.max(presence, Math.min(1, Math.max(0, (15 - d) / 6)));
        }
        it.exhibit.update(t, dt, e.camera, { audible: this.standing === it.plot && document.body.classList.contains('sound-on'), presence, dist: camDist });
      }

      if (it.label.hidden) continue;
      const pos = it.anchor.position.clone().add(new THREE.Vector3(-it.plot.w / 2, it.plot.h + 0.4, 0));
      const s = e.project(pos, it.screen);
      const dist = e.camera.position.distanceTo(it.anchor.position);
      const near = dist < 48 || isHover || this.selected === it.plot;
      const scale = Math.max(0.6, Math.min(1, 20 / dist));
      it.label.style.transform = `translate(${s.x}px, ${s.y}px) translateY(-50%) scale(${scale})`;
      it.label.style.visibility = s.visible && near ? 'visible' : 'hidden';
      it.label.classList.toggle('is-hover', !!isHover);
      it.label.style.opacity = hovered && !isHover ? 0.4 : Math.min(1, (60 - dist) / 20);
    }
  }
}
