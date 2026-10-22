// Inside a world: the full form at the centre, its fragments in orbit.
import * as THREE from 'three';
import { createForm, disposeForm, updateFormLook } from './form.js';
import { roman, el, rng, lerp } from './util.js';
import { createBuild, disposeBuild, formPlacement, buildTop } from './build.js';
import { createExhibit, exhibitItems, exhibitTop } from './exhibit.js';

let glowTexture;
function glow() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

const strokeKey = (strokes) => (strokes ? strokes.length + ':' + strokes.reduce((a, s) => a + s.pts.length + s.spread + s.tone * 7 + (s.pts[0]?.[0] || 0), 0) : '');

export class WorldView {
  constructor(engine, labelsRoot, { onFragment } = {}) {
    this.engine = engine;
    this.labelsRoot = labelsRoot;
    this.onFragment = onFragment || (() => {});
    this.group = new THREE.Group();
    this.group.visible = false;
    engine.scene.add(this.group);
    this.form = null;
    this.fragments = [];
    this.openIndex = -1;
    this.world = null;
    engine.updaters.add((t, dt) => this.update(t, dt));
    this.bindPainting();
    this.bindPlacing();
  }

  // ---- placing stars by hand (in the workshop) ----

  // While painting, dragging on the world lays a stroke of stars on an invisible
  // sheet facing you through the form's centre. Turn the world between strokes to draw in depth.
  setPainting(on, opts = {}) {
    this.painting = on ? opts : null;
    const c = this.engine.controls;
    c.enabled = !on;
    c.autoRotate = !on && !this.preview;
    // Pictures and the rest step aside while you draw, so the stars are clear.
    if (this.exhibit) this.exhibit.group.visible = !on;
    document.body.classList.toggle('is-painting', !!on);
  }

  // ---- placing things by hand (in the studio) ----

  // While placing, dragging moves the chosen thing across its plot at its height;
  // a thin line to a ring on the ground shows where it stands.
  setPlacing(opts) {
    this.placing = opts || null;
    const c = this.engine.controls;
    c.enabled = !opts || !!opts.turning;
    c.autoRotate = !opts && !this.preview;
    document.body.classList.toggle('is-placing', !!opts);
    if (!opts) this.clearMarker();
  }

  // Show how it behaves from afar (0) or with a visitor close by (1).
  setNearPreview(v) { this.nearPreview = v; }

  clearMarker() {
    if (!this.marker) return;
    this.marker.removeFromParent();
    this.marker.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    this.marker = null;
  }

  updateMarker() {
    const h = this.placing && this.exhibit?.holderOf(this.placing.index);
    if (!h) return this.clearMarker();
    if (!this.marker) {
      const m = new THREE.Group();
      const ring = [];
      for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; ring.push(new THREE.Vector3(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35)); }
      const mat = () => new THREE.LineBasicMaterial({ color: 0xc9a46a, transparent: true, opacity: 0.8, depthWrite: false });
      m.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), mat()));
      m.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), mat()));
      m.traverse((o) => o.layers.set(1));
      this.exhibit.group.add(m);
      this.marker = m;
    }
    this.marker.position.set(h.position.x, 0, h.position.z);
    this.marker.children[1].scale.y = Math.max(0.001, h.position.y);
  }

  bindPlacing() {
    const canvas = this.engine.canvas;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(), hit = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3();
    let id = null;
    const move = (e) => {
      const h = this.exhibit?.holderOf(this.placing.index);
      if (!h) return;
      ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      ray.setFromCamera(ndc, this.engine.camera);
      h.getWorldPosition(p);
      plane.setFromNormalAndCoplanarPoint(up, p);
      if (!ray.ray.intersectPlane(plane, hit)) return;
      const local = this.exhibit.group.worldToLocal(hit.clone()).divideScalar(5.2);
      const r = this.room || { ax: 0.5, az: 0.5 };
      this.placing.onMove?.(Math.max(-r.ax, Math.min(r.ax, local.x)), Math.max(-r.az, Math.min(r.az, local.z)));
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.placing || this.placing.turning || !this.group.visible) return;
      e.preventDefault();
      id = e.pointerId;
      canvas.setPointerCapture?.(id);
      move(e);
    });
    canvas.addEventListener('pointermove', (e) => { if (id !== null && e.pointerId === id && this.placing) move(e); });
    const end = (e) => { if (e.pointerId === id) id = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  bindPainting() {
    const canvas = this.engine.canvas;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(), hit = new THREE.Vector3(), centre = new THREE.Vector3(), n = new THREE.Vector3();
    let stroke = null, ink = null;
    const at = (e) => {
      ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      const cam = this.engine.camera;
      ray.setFromCamera(ndc, cam);
      this.form.getWorldPosition(centre);
      plane.setFromNormalAndCoplanarPoint(cam.getWorldDirection(n), centre);
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      return this.form.worldToLocal(hit.clone());
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.painting || !this.form || !this.group.visible) return;
      const p = at(e);
      if (!p) return;
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      stroke = { id: e.pointerId, pts: [p] };
      const colour = new THREE.Color(this.world.palette[this.painting.tone ?? 2]);
      ink = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: colour, size: 0.05, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
      ink.geometry.setFromPoints(stroke.pts);
      this.form.add(ink);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!stroke || e.pointerId !== stroke.id) return;
      const p = at(e);
      if (!p || p.distanceTo(stroke.pts[stroke.pts.length - 1]) < 0.03) return;
      if (stroke.pts.length >= 400) return;
      stroke.pts.push(p);
      ink.geometry.dispose();
      ink.geometry = new THREE.BufferGeometry().setFromPoints(stroke.pts);
    });
    const end = (e) => {
      if (!stroke || (e.pointerId !== undefined && e.pointerId !== stroke.id)) return;
      const pts = stroke.pts.map((p) => [p.x, p.y, p.z].map((v) => Math.round(v * 1000) / 1000));
      stroke = null;
      // The stroke stays visible until the form is rebuilt with it.
      const old = ink;
      ink = null;
      setTimeout(() => { old.removeFromParent(); old.geometry.dispose(); old.material.dispose(); }, 120);
      const style = this.painting.style && this.painting.style !== 'stars' ? { style: this.painting.style } : {};
      this.painting?.onStroke?.({ pts, spread: this.painting.spread ?? 0.06, tone: this.painting.tone ?? 2, ...style });
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  // Keep the form clear of the text: beside it on wide screens, above it on phones.
  // While the story panel is open on the right, the form moves into the space left of it.
  frame({ reading = false } = {}) {
    const e = this.engine, preview = this.preview;
    const w = window.innerWidth, h = window.innerHeight;
    if (w <= 760) e.setViewOffset(0, preview ? h * 0.29 : h * 0.16);
    else if (reading) e.setViewOffset(-Math.min(600, w) / 2, 0);
    else e.setViewOffset(preview ? Math.min(460, w) / 2 : w > 1100 ? 140 : 0, 0);
  }

  show(world, { preview = false, plot = null } = {}) {
    this.preview = preview;
    this.plot = preview ? plot : null;
    this.roomDist = 0;
    this.setWorld(world, { rebuild: true });
    this.group.visible = true;
    const e = this.engine;
    e.setMode('orbit');
    Object.assign(e.controls, { minDistance: 3.2, maxDistance: Math.max(24, this.roomDist * 1.6), autoRotate: !preview, autoRotateSpeed: 0.25 }); // in the studio the plot stands still: you turn it by hand
    this.frame();
    const narrow = window.innerWidth <= 760;
    if (!preview || !this.shownOnce) {
      const dist = Math.max((narrow ? 10.5 : 7.2) * this.fit, this.roomDist);
      e.camera.position.set(0, 1.2, dist * 2);
      e.controls.target.set(0, 0, 0);
      e.flyTo(new THREE.Vector3(0, dist * (this.roomDist ? 0.4 : 0.15), dist), new THREE.Vector3(0, 0, 0), 3.2); // a little from above when the plot shows
    }
    this.shownOnce = preview;
  }

  hide() {
    clearTimeout(this.pending);
    this.setPlacing(null);
    this.nearPreview = null;
    if (this.painting) this.setPainting(false);
    this.group.visible = false;
    this.closeFragment();
    this.clearFragments();
    disposeForm(this.form);
    disposeBuild(this.build);
    this.exhibit?.dispose();
    this.form = this.build = this.exhibit = null;
    if (this.plotBox) { this.plotBox.geometry.dispose(); this.plotBox.material.dispose(); this.plotBox = null; }
    this.buildKey = null;
    this.world = null;
    this.shownOnce = false;
    this.engine.setViewOffset(0);
  }

  // Apply a (possibly edited) world. Colour and energy show at once through
  // uniforms; the heavier rebuilds wait until the editing pauses for a moment, so
  // dragging a colour or a slider never rebuilds the scene dozens of times a second.
  setWorld(world, { rebuild = false } = {}) {
    clearTimeout(this.pending);
    // While something is being placed by hand it follows at once (it only moves; nothing is rebuilt).
    if (rebuild || !this.form || !this.preview || this.placing) return this.apply(world, { rebuild });
    updateFormLook(this.form, world);
    for (const f of this.fragments) f.sprite.material.color.set(world.palette[2]);
    this.pending = setTimeout(() => this.apply(world), 140);
  }

  apply(world, { rebuild = false } = {}) {
    const prev = this.world;
    this.world = world;
    const strokesKey = strokeKey(world.form.strokes);
    const onlyStrokes = prev && !rebuild && strokesKey !== this.strokesKey && prev.form.type === world.form.type && prev.form.density === world.form.density && prev.id === world.id;
    const shapeChanged = !prev || rebuild || onlyStrokes || prev.form.type !== world.form.type || prev.form.density !== world.form.density || prev.id !== world.id;
    this.strokesKey = strokesKey;
    if (shapeChanged) {
      // New strokes appear in place; other shape changes gather in from a scatter.
      const reveal = onlyStrokes ? 1 : this.form && !rebuild ? 0.35 : 0;
      const keep = onlyStrokes && this.form ? { pos: this.form.position.clone(), scale: this.form.scale.clone(), rot: this.form.rotation.clone() } : null;
      disposeForm(this.form);
      this.form = createForm(world);
      this.form.scale.setScalar(1.55);
      if (world.form.type === 'spiral') this.form.rotation.x = 0.45;
      this.form.userData.uniforms.uReveal.value = reveal;
      if (keep) { this.form.position.copy(keep.pos); this.form.scale.copy(keep.scale); this.form.rotation.copy(keep.rot); }
      this.group.add(this.form);
      this.outline();
    } else {
      updateFormLook(this.form, world);
    }
    // Moving, resizing or re-timing a placed thing only re-places it; anything else rebuilds.
    const buildKey = JSON.stringify(world.build) + world.palette.join() + JSON.stringify(exhibitItems(world).map((m) => [m.kind, m.src?.length, !!m.show, m.show?.flip, m.poem, m.constellation, m.melody, m.sketch?.paths.length, m.build?.pieces.length]));
    const placeKey = JSON.stringify(exhibitItems(world).map((m) => m.show));
    if ((shapeChanged && !onlyStrokes) || buildKey !== this.buildKey) {
      this.buildKey = buildKey;
      this.placeKey = placeKey;
      this.layoutBuild();
    } else if (placeKey !== this.placeKey) {
      this.placeKey = placeKey;
      if (!this.exhibit?.relayout(world)) this.layoutBuild();
    }
    for (const f of this.fragments) f.sprite.material.color.set(world.palette[2]);
    const fragKey = JSON.stringify(world.fragments.map((f) => f.title));
    if ((shapeChanged && !onlyStrokes) || fragKey !== this.fragKey) {
      this.fragKey = fragKey;
      this.buildFragments();
    }
  }

  // With a build, a world is shown as its whole plot: architecture and form at
  // their true proportions, as the maker designed them.
  layoutBuild() {
    this.clearMarker();
    disposeBuild(this.build);
    this.exhibit?.dispose();
    this.build = this.exhibit = null;
    const w = this.world;
    this.form.position.set(0, 0, 0);
    this.form.scale.setScalar(1.55);
    this.fit = 1;
    if (!w.build && !exhibitItems(w).length) return this.outline();
    const U = 5.2, top = Math.max(buildTop(w.build), exhibitTop(w), 0.6) * U;
    const place = formPlacement(w, U, w.build ? top : U * 0.6);
    this.build = createBuild(w.build, w.palette, U);
    this.build.position.y = -top / 2;
    this.exhibit = createExhibit(w, U, w.build ? buildTop(w.build) * U * 0.45 : U * 0.3);
    this.build.add(this.exhibit.group);
    this.form.position.copy(place.pos).add(this.build.position);
    this.form.scale.setScalar(place.scale);
    this.fit = Math.max(1, Math.max(top, U * 1.15) / 4.2);
    this.group.add(this.build);
    this.outline();
    // In the workshop, step back when the build outgrows the view.
    const e = this.engine;
    if (this.preview && this.group.visible && !e.flight) {
      const want = 7.2 * this.fit, have = e.camera.position.distanceTo(e.controls.target);
      if (have < want * 0.9) e.flyTo(e.camera.position.clone().sub(e.controls.target).setLength(want).add(e.controls.target), e.controls.target.clone(), 1.2);
    }
  }

  // In the studio, the plot's true room drawn in faint lines: its footprint and
  // the height of its storeys, to the same scale as in the city, so stars and
  // pictures placed by hand land where you mean them to.
  outline() {
    if (this.plotBox) {
      this.plotBox.traverse((o) => { o.geometry.dispose(); o.material.dispose(); });
      this.plotBox.removeFromParent(); this.plotBox = null;
    }
    const p = this.plot, w = this.world;
    if (!p || !this.form) return;
    const Ucity = Math.min(p.w, p.d);
    const H = Math.max(p.h0, buildTop(w.build) * Ucity + 0.15, exhibitTop(w) * Ucity + 0.15);
    let parent, k, y0;
    if (this.build) {
      // With a build the view is in plot units (U = 5.2 per plot width), ground at y = 0.
      parent = this.build; k = 5.2 / Ucity; y0 = 0;
    } else {
      // Otherwise the form stands at half height of the plot, as in the city.
      parent = this.form; k = 1 / formPlacement(w, Ucity, H).scale; y0 = -H / 2 * k;
    }
    const a = (p.w * k) / 2, b = (p.d * k) / 2, h = H * k;
    this.room = { ax: p.w / Ucity / 2, az: p.d / Ucity / 2, h: H / Ucity, front: p.z <= 0 ? -1 : 1 };
    const pts = [];
    const c = [[-a, -b], [a, -b], [a, b], [-a, b]];
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = c[i], [x1, z1] = c[(i + 1) % 4];
      pts.push(x0, y0, z0, x1, y0, z1, x0, y0 + h, z0, x1, y0 + h, z1, x0, y0, z0, x0, y0 + h, z0);
    }
    // A faint mark for each storey on the corners, so the height reads in floors.
    const floors = Math.max(1, Math.round(p.h0 / 0.62)), step = (p.h0 * k) / floors;
    for (let f = 1; f < floors; f++) for (const [x0, z0] of c) {
      const y = y0 + f * step, dx = -Math.sign(x0) * a * 0.06, dz = -Math.sign(z0) * b * 0.06;
      pts.push(x0, y, z0, x0 + dx, y, z0, x0, y, z0, x0, y, z0 + dz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.plotBox = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xece4d4, transparent: true, opacity: 0.22, depthWrite: false }));
    this.plotBox.layers.set(1);
    // A faint floor grid (quarters of the plot) to place things by.
    const grid = [], n = 4;
    for (let i = 1; i < n; i++) {
      const x = -a + (2 * a * i) / n, z = -b + (2 * b * i) / n;
      grid.push(x, y0, -b, x, y0, b, -a, y0, z, a, y0, z);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(grid, 3));
    const floor = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0xece4d4, transparent: true, opacity: 0.08, depthWrite: false }));
    floor.layers.set(1);
    this.plotBox.add(floor);
    parent.add(this.plotBox);
    // Step back far enough to see the whole room.
    this.group.updateMatrixWorld(true);
    const sphere = new THREE.Box3().setFromObject(this.plotBox).getBoundingSphere(new THREE.Sphere());
    const e = this.engine, want = this.roomDist = sphere.radius * 2.3;
    e.controls.maxDistance = Math.max(24, want * 1.6);
    if (this.group.visible && !e.flight) {
      const have = e.camera.position.distanceTo(e.controls.target);
      if (have < want * 0.9) e.flyTo(e.camera.position.clone().sub(e.controls.target).setLength(want).add(e.controls.target), e.controls.target.clone(), 1.2);
    }
  }

  clearFragments() {
    for (const f of this.fragments) {
      f.sprite.material.dispose();
      this.group.remove(f.sprite);
      f.label.remove();
    }
    this.fragments = [];
  }

  buildFragments() {
    this.clearFragments();
    const w = this.world;
    const r = rng(w.id + ':orbits');
    const n = w.fragments.length;
    this.fragments = w.fragments.map((frag, i) => {
      const material = new THREE.SpriteMaterial({
        map: glow(), color: new THREE.Color(w.palette[2]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.setScalar(0.5);
      this.group.add(sprite);
      const label = el('button', 'label label--fragment');
      label.append(el('span', 'label__num mono', roman(i + 1)), el('span', 'label__title', frag.title));
      label.addEventListener('click', () => this.openFragment(i));
      this.labelsRoot.append(label);
      return {
        frag, sprite, label, screen: {},
        radius: 3.0 + r() * 1.3,
        phase: (i / Math.max(1, n)) * Math.PI * 2 + r() * 0.4,
        speed: 0.035 + r() * 0.03,
        tilt: new THREE.Euler((r() - 0.5) * 0.9, 0, (r() - 0.5) * 0.7),
        pos: new THREE.Vector3(),
      };
    });
  }

  openFragment(i) {
    const f = this.fragments[i];
    if (!f) return;
    this.openIndex = i;
    this.fragments.forEach((x, j) => x.label.classList.toggle('is-open', j === i));
    this.engine.controls.autoRotate = false;
    this.onFragment(f.frag, i, this.world);
  }

  closeFragment() {
    this.openIndex = -1;
    this.fragments.forEach((x) => x.label.classList.remove('is-open'));
    if (this.group.visible) this.engine.controls.autoRotate = !this.preview;
  }

  update(t, dt) {
    if (!this.group.visible || !this.form) return;
    const u = this.form.userData.uniforms;
    u.uTime.value = t;
    u.uReveal.value = Math.min(1, u.uReveal.value + dt / 4.5);
    // The form turns slowly in the gallery; in the studio it stands square with the plot,
    // so the box, the stars and everything placed share one fixed frame.
    if (this.preview) this.form.rotation.y = 0;
    else if (!this.painting && !this.world.form.strokes?.length) this.form.rotation.y += dt * 0.03; // hand-placed stars keep their place
    this.exhibit?.update(t, dt, this.engine.camera, { audible: document.body.classList.contains('sound-on'), presence: this.nearPreview ?? 1 });
    this.updateMarker();
    const e = this.engine;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < this.fragments.length; i++) {
      const f = this.fragments[i];
      const a = f.phase + t * f.speed * (this.openIndex === i ? 0.2 : 1);
      f.pos.set(Math.cos(a) * f.radius, Math.sin(a * 2) * 0.25, Math.sin(a) * f.radius).applyEuler(f.tilt);
      f.sprite.position.copy(f.pos);
      const pulse = 0.42 + Math.sin(t * 1.6 + i) * 0.06 + (this.openIndex === i ? 0.3 : 0);
      f.sprite.scale.setScalar(lerp(f.sprite.scale.x, pulse, 0.1));
      f.sprite.material.opacity = Math.min(1, u.uReveal.value * 1.4);

      e.project(tmp.copy(f.pos).add(new THREE.Vector3(0.35, 0, 0)), f.screen);
      const depth = tmp.copy(f.pos).applyMatrix4(e.camera.matrixWorldInverse).z;
      const behind = e.camera.position.distanceTo(f.pos) > e.camera.position.length() + 0.5;
      f.label.style.transform = `translate(${f.screen.x}px, ${f.screen.y}px) translateY(-50%)`;
      f.label.style.visibility = f.screen.visible && depth < 0 && u.uReveal.value > 0.6 ? 'visible' : 'hidden';
      f.label.classList.toggle('is-behind', behind);
    }
  }
}
