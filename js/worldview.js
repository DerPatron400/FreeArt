// Inside a world: the full form at the centre, its fragments in orbit.
import * as THREE from 'three';
import { createForm, disposeForm, updateFormLook } from './form.js';
import { roman, el, rng, lerp } from './util.js';
import { createBuild, disposeBuild, formPlacement, buildTop } from './build.js';
import { createExhibit, exhibitItems, exhibitTop } from './exhibit.js';
import { embedFor, ctx, pluck } from './media.js';
import { t as tr } from './i18n.js';

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
  constructor(engine, labelsRoot, { onFragment, onPiece } = {}) {
    this.engine = engine;
    this.onPiece = onPiece || (() => false);
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
    this.bindFocus();
    this.bindLighting();
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
    this.exhibit?.showSetting(opts ? opts.index : -1); // a setting being placed is the one the plot shows
    if (!opts) this.clearMarker();
  }

  // ---- painting the plot's light (in the studio) ----

  // The plot stands empty, glowing as it does from afar; each light is a dot you can drag
  // (in the plane facing you, so turning the plot places it in depth), and a tap on the
  // plot adds one where you tapped.
  setLighting(opts) {
    const was = !!this.lighting;
    this.lighting = opts || null;
    document.body.classList.toggle('is-lighting', !!opts);
    if (!opts) { for (const d of this.dots || []) d.remove(); this.dots = []; }
    // An empty plot still gets its light to paint (and lets it go again afterwards).
    const empty = this.world && !this.world.build && !exhibitItems(this.world).length;
    if (!!opts !== was && this.world && this.form && (opts ? !this.exhibit : empty)) this.layoutBuild();
  }

  autoLight() { return this.exhibit?.autoLight() || []; }

  // The plot's light from afar, taken from how the world looks: the next frame, as you see
  // it, shrunk to a small picture, and its strongest colours found in it (greys, darks and
  // the night around count for almost nothing), each placed where it shows. Null if the
  // world shows no colour to speak of (then the light comes from the pieces as before).
  captureLight() {
    const e = this.engine;
    if (!this.exhibit || !this.group.visible || this.lighting) return Promise.resolve(null);
    return new Promise((resolve) => {
      const grab = () => {
        e.afterRender.delete(grab);
        // The whole plot in view, from the side you look at it from and level with it, for
        // this one picture (wherever the camera happens to be, close to one piece or not).
        const cam = e.camera, was = { p: cam.position.clone(), q: cam.quaternion.clone() };
        const r = this.room || { ax: 0.5, az: 0.5, h: 1 }, mid = this.lightToWorld([0, r.h / 2, 0]);
        const reach = this.lightToWorld([r.ax, r.h, r.az]).distanceTo(this.lightToWorld([-r.ax, 0, -r.az])) / 2;
        const dir = cam.getWorldDirection(new THREE.Vector3()).setY(0);
        if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
        cam.position.copy(mid).addScaledVector(dir.normalize(), -reach / Math.sin(THREE.MathUtils.degToRad(cam.fov) / 2) * 1.05);
        cam.lookAt(mid);
        cam.updateMatrixWorld();
        let px;
        try { e.composer.render(); } catch {}
        const W = 256, H = Math.max(72, Math.round((W * e.canvas.height) / Math.max(1, e.canvas.width)));
        try {
          const c = Object.assign(document.createElement('canvas'), { width: W, height: H }), g = c.getContext('2d', { willReadFrequently: true });
          g.imageSmoothingQuality = 'high';
          g.drawImage(e.canvas, 0, 0, W, H);
          px = g.getImageData(0, 0, W, H).data;
        } catch { px = null; }
        cam.position.copy(was.p); cam.quaternion.copy(was.q); cam.updateMatrixWorld();
        try { e.composer.render(); } catch {} // and the view as it was, before anyone sees the other
        if (!px) return resolve(null);
        resolve(this.lightFromPicture(px, W, H));
      };
      e.afterRender.add(grab);
    });
  }

  // Like a screen's ambient light: the picture is cut into zones (four across, three up),
  // and each zone of the plot glows with the colour that shows most in it, so the colours
  // lie side by side and blend into each other instead of one taking over. A colour that
  // already leads elsewhere gives way to the next one in a zone, if that one shows enough.
  lightFromPicture(px, W, H) {
    const lin = (v) => Math.pow(v / 255, 2.2), HUES = 12, GX = 4, GY = 3;
    const found = [];
    let total = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
      const hi = Math.max(r, g, b), lo = Math.min(r, g, b), sat = hi ? (hi - lo) / hi : 0;
      if (hi < 70) continue; // the dim haze of stars around is not the world's colour
      // Bright white (a lit page, pale stone) counts as a colour of its own; dim greys and
      // the small stars of the night around do not.
      let hue = -1, w;
      if (sat < 0.3) { if (hi < 170) continue; w = 0.12 * (hi / 255); } else {
        w = sat * sat * (hi / 255);
        const h = hi === r ? ((g - b) / (hi - lo) + 6) % 6 : hi === g ? (b - r) / (hi - lo) + 2 : (r - g) / (hi - lo) + 4;
        hue = Math.floor((h / 6) * HUES) % HUES;
      }
      found.push([x, y, hue, w, lin(r), lin(g), lin(b)]);
      total += w;
    }
    if (total < 2) return null; // hardly a colour anywhere (a world of greys)
    // The part of the picture the colours fill (the few strays at its edges left out).
    const span = (k) => {
      const list = found.map((f) => [f[k], f[3]]).sort((a, b) => a[0] - b[0]);
      let acc = 0, lo = list[0][0], hi = list[list.length - 1][0];
      for (const [v, w] of list) { acc += w; if (acc < total * 0.03) lo = v; if (acc <= total * 0.97) hi = v; }
      return [lo, Math.max(hi, lo + 1)];
    };
    const [x0, x1] = span(0), [y0, y1] = span(1);
    const zones = Array.from({ length: GX * GY }, () => new Map());
    for (const [x, y, hue, w, r, g, b] of found) {
      const zx = Math.max(0, Math.min(GX - 1, Math.floor(((x - x0) / (x1 - x0)) * GX))), zy = Math.max(0, Math.min(GY - 1, Math.floor(((y - y0) / (y1 - y0)) * GY)));
      const m = zones[zy * GX + zx], o = m.get(hue) || m.set(hue, { hue, w: 0, c: [0, 0, 0] }).get(hue);
      o.w += w; o.c[0] += r * w; o.c[1] += g * w; o.c[2] += b * w;
    }
    const hex = (c) => '#' + c.map((v) => Math.round(Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2) * 255).toString(16).padStart(2, '0')).join('');
    // A colour at full strength (how bright the plot glows is the haze's own matter).
    const colour = (o) => { const c = o.c.map((v) => v / o.w), top = Math.max(...c, 1e-4); return hex(c.map((v) => (v / top) * 0.85)); };
    const room = this.room || { ax: 0.5, az: 0.5, h: 1 }, k2 = (v) => Math.round(v * 100) / 100;
    const used = new Map(), spots = [];
    const order = zones.map((m, i) => ({ i, m, w: [...m.values()].reduce((a, o) => a + o.w, 0) })).filter((z) => z.w > total * 0.04).sort((a, b) => b.w - a.w);
    for (const { i, m, w } of order) {
      let best = null, score = -1;
      for (const o of m.values()) {
        if (o.w < w * 0.06) continue;
        // Near hues count as the same (two blues are one blue); white only as itself.
        let near = 0;
        for (const [h, k] of used) if (h === o.hue || (h >= 0 && o.hue >= 0 && Math.min((h - o.hue + HUES) % HUES, (o.hue - h + HUES) % HUES) <= 1)) near += k;
        const sc = o.w / (1 + 3 * near);
        if (sc > score) { score = sc; best = o; }
      }
      if (!best || best.w < total * 0.015) continue;
      used.set(best.hue, (used.get(best.hue) || 0) + 1);
      const zx = i % GX, zy = Math.floor(i / GX);
      const c = colour(best);
      if (spots.some((o) => o.c === c)) continue; // the same colour twice: the one already there reaches here too
      spots.push({ at: [k2(((zx + 0.5) / GX - 0.5) * 1.6 * room.ax), k2((0.82 - zy * 0.3) * room.h), k2((zx % 2 ? 0.25 : -0.25) * room.az)], c, r: k2(Math.max(0.25, Math.min(0.5, room.ax * 0.75))) });
    }
    // Colours that show well in the whole picture but led in no zone still glow, smaller.
    const all = new Map();
    for (const m of zones) for (const o of m.values()) { const a = all.get(o.hue) || all.set(o.hue, { hue: o.hue, w: 0, c: [0, 0, 0] }).get(o.hue); a.w += o.w; o.c.forEach((v, k) => { a.c[k] += v; }); }
    let n = 0;
    for (const a of [...all.values()].sort((p, q) => q.w - p.w)) {
      if (used.has(a.hue) || a.w < total * 0.05 || n >= 2 || spots.length >= 12) continue;
      spots.push({ at: [k2((n ? 0.3 : -0.3) * room.ax), k2(0.5 * room.h), k2((n ? -0.3 : 0.3) * room.az)], c: colour(a), r: k2(Math.max(0.25, room.ax * 0.6)) });
      n++;
    }
    return spots.length ? { spots, flow: 'drift', speed: 0.5, auto: true } : null;
  }

  // A point in the plot (in plot widths) and back, through where the plot stands now.
  lightToWorld(at) {
    return this.exhibit.group.localToWorld(new THREE.Vector3(at[0], at[1], at[2]).multiplyScalar(5.2));
  }

  lightFromScreen(x, y, through) {
    const e = this.engine, ray = new THREE.Raycaster(), n = new THREE.Vector3(), hit = new THREE.Vector3();
    ray.setFromCamera(new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1), e.camera);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(e.camera.getWorldDirection(n), through);
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    const p = this.exhibit.group.worldToLocal(hit).divideScalar(5.2), r = this.room || { ax: 0.5, az: 0.5, h: 1 };
    const round = (v) => Math.round(v * 100) / 100;
    return [round(Math.max(-r.ax, Math.min(r.ax, p.x))), round(Math.max(0.02, Math.min(r.h, p.y))), round(Math.max(-r.az, Math.min(r.az, p.z)))];
  }

  // The dots, one per light, kept over where each light is.
  updateDots() {
    const L = this.lighting;
    if (!L || !this.exhibit) return;
    const spots = L.spots();
    this.dots ||= [];
    while (this.dots.length > spots.length) this.dots.pop().remove();
    while (this.dots.length < spots.length) {
      const d = el('button', 'light-dot');
      d.type = 'button';
      d.setAttribute('aria-label', L.label || '');
      const i = () => this.dots.indexOf(d);
      d.addEventListener('pointerdown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        d.setPointerCapture?.(ev.pointerId);
        L.onSelect?.(i());
        const from = this.lightToWorld(this.lighting.spots()[i()].at);
        const move = (m) => { const at = this.lightFromScreen(m.clientX, m.clientY, from); if (at) this.lighting?.onMove?.(i(), at); };
        const up = () => { d.removeEventListener('pointermove', move); d.removeEventListener('pointerup', up); d.removeEventListener('pointercancel', up); this.lighting?.onDrop?.(); };
        d.addEventListener('pointermove', move);
        d.addEventListener('pointerup', up);
        d.addEventListener('pointercancel', up);
      });
      this.labelsRoot.append(d);
      this.dots.push(d);
    }
    const scr = {}, sel = L.selected?.();
    spots.forEach((o, i) => {
      const d = this.dots[i];
      this.engine.project(this.lightToWorld(o.at), scr);
      d.style.transform = `translate(${scr.x}px, ${scr.y}px) translate(-50%, -50%)`;
      d.style.visibility = scr.visible ? 'visible' : 'hidden';
      d.style.background = o.c;
      d.classList.toggle('is-on', i === sel);
    });
  }

  bindLighting() {
    const e = this.engine;
    e.canvas.addEventListener('click', (ev) => {
      if (!this.lighting || !this.exhibit || !this.group.visible || e.dragDistance >= 6) return;
      const mid = this.room ? [0, this.room.h / 2, 0] : [0, 0.5, 0];
      const at = this.lightFromScreen(ev.clientX, ev.clientY, this.lightToWorld(mid));
      if (at) this.lighting.onAdd?.(at);
    });
  }

  // Stand where a setting was seen from, looking the way it looked (its sharpest view).
  lookFrom(index, tries = 40) {
    clearTimeout(this.lookWait);
    const s = this.exhibit?.spots().find((x) => x.index === index && x.setting);
    // Still loading (or just rebuilt): look once it is there.
    if (!s?.eye) { if (tries > 0) this.lookWait = setTimeout(() => this.lookFrom(index, tries - 1), 250); return; }
    this.exhibit.showSetting(index);
    const e = this.engine;
    e.controls.autoRotate = false;
    e.flyTo(s.eye.clone(), s.eye.clone().addScaledVector(s.forward, 4), 1.6);
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

  // ---- looking closely (in the gallery) ----

  // Click a piece and the camera flies to it: pictures and films then fill the screen,
  // 3D pieces stay in the scene to be turned around; what the maker wrote about it
  // appears word by word, each word with a soft note. Esc, the back button or a click
  // beside it flies you back to where you stood.
  bindFocus() {
    const e = this.engine, canvas = e.canvas;
    canvas.addEventListener('click', () => {
      if (!this.canFocus() || e.flight || e.dragDistance >= 6) return;
      const hit = this.pickPiece();
      // A piece clicked: on to the world's tour, at that piece (or, for a world without a
      // plot, a close look here).
      if (hit && !this.focused && this.onPiece(this.world, hit.index)) return;
      if (hit) this.focus(hit);
      else if (this.focused) this.unfocus();
    });
  }

  canFocus() { return this.group.visible && !this.preview && !this.painting && !this.placing && !!this.exhibit; }

  pickPiece() {
    const e = this.engine;
    if (e.pointer.x < -2) return null;
    e.raycaster.setFromCamera(e.pointer, e.camera);
    return this.exhibit.pick(e.raycaster);
  }

  focus(hit) {
    const e = this.engine, cam = e.camera;
    if (this.focused?.index === hit.index) return;
    if (!this.focused) {
      this.home = { pos: cam.position.clone(), target: e.controls.target.clone(), min: e.controls.minDistance, max: e.controls.maxDistance, offset: [...e.viewOffset] };
    } else this.clearFocusView();
    this.focused = hit;
    this.exhibit.hold(hit.index);
    e.controls.autoRotate = false;
    this.offsetGoal = [0, 0]; // the picture glides to the middle of the screen
    document.body.classList.add('is-focus');
    // Pictures and films are faced square on; solid pieces from where you stand.
    const kind = hit.item.kind, flat = kind === 'image' || kind === 'video' || kind === 'sketch';
    const dir = new THREE.Vector3();
    if (flat) dir.set(0, 0, 1).applyQuaternion(hit.holder.getWorldQuaternion(new THREE.Quaternion()));
    else dir.copy(cam.position).sub(hit.centre).setY(Math.max(0, cam.position.y - hit.centre.y) * 0.4);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const half = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), size = hit.radius / 0.55;
    const d = flat
      ? Math.max((size * 0.5) / (half * cam.aspect), (size * 0.4) / half) * 1.12
      : (hit.radius * 1.15) / half;
    Object.assign(e.controls, { minDistance: d * 0.35, maxDistance: Math.max(d * 4, 6) });
    const token = this.focusToken = {};
    this.focusView(hit, flat);
    e.flyTo(hit.centre.clone().addScaledVector(dir, d), hit.centre, 1.5).then(() => {
      if (this.focusToken === token) this.focusEl?.classList.add('is-arrived');
    });
  }

  unfocus({ instant = false } = {}) {
    if (!this.focused) return;
    const e = this.engine, home = this.home;
    this.focused = null;
    const token = this.focusToken = {};
    this.clearFocusView();
    document.body.classList.remove('is-focus');
    // The old limits go back before the flight, or the first frame after it would clamp the camera.
    Object.assign(e.controls, { minDistance: home.min, maxDistance: home.max });
    const done = () => {
      if (this.focusToken !== token) return;
      this.exhibit?.hold(-1);
      e.controls.autoRotate = !this.preview && this.group.visible;
    };
    if (instant) { this.offsetGoal = null; e.setViewOffset(...home.offset); e.flight = null; e.controls.enabled = true; return done(); }
    this.offsetGoal = home.offset;
    e.flyTo(home.pos, home.target, 1.3).then(done);
  }

  // Per frame: glide the picture's offset, and show a hand over pieces that can be looked at.
  focusFrame(dt) {
    const e = this.engine;
    if (this.offsetGoal) {
      const [x, y] = e.viewOffset, [gx, gy] = this.offsetGoal, k = Math.min(1, dt * 3.5);
      const done = Math.abs(gx - x) + Math.abs(gy - y) < 0.5;
      e.setViewOffset(done ? gx : x + (gx - x) * k, done ? gy : y + (gy - y) * k);
      if (done) this.offsetGoal = null;
    }
    // Look again only when the pointer or the camera moved.
    const at = e.pointer.x + ',' + e.pointer.y + ',' + e.camera.position.x.toFixed(2) + e.camera.position.z.toFixed(2);
    if (at === this.overAt) return;
    this.overAt = at;
    const over = this.canFocus() && !e.flight && !!this.pickPiece();
    if (over !== this.overPiece) { this.overPiece = over; document.body.style.cursor = over ? 'pointer' : ''; }
  }

  // What the maker wrote about this piece: its caption, and the step or fragment it belongs to.
  wordsFor(item) {
    const w = this.world, same = (m) => m === item || (m.kind === item.kind && (item.src ? m.src === item.src : JSON.stringify({ ...m, show: 0 }) === JSON.stringify({ ...item, show: 0 })));
    const steps = w.process?.steps || [];
    let where = steps.findIndex((s) => s.media.some(same)), title = '', text = '', kicker = '';
    if (where >= 0) { title = steps[where].title; text = steps[where].text || ''; kicker = [roman(where + 1), steps[where].when].filter(Boolean).join(' · '); }
    else {
      where = w.fragments.findIndex((f) => (f.media || []).some(same));
      if (where >= 0) { title = w.fragments[where].title; text = w.fragments[where].text || ''; kicker = roman(where + 1); }
    }
    return { kicker, title, caption: item.caption || '', text };
  }

  focusView(hit, flat) {
    const item = hit.item, root = el('div', 'focus' + (flat && item.kind !== 'sketch' ? ' focus--full' : ''));
    const back = el('button', 'focus__back mono', tr('focus.back'));
    back.type = 'button';
    back.addEventListener('click', (ev) => { ev.stopPropagation(); this.unfocus(); });
    root.append(back);
    if (item.kind === 'image' || item.kind === 'video') {
      const stage = el('div', 'focus__media');
      const embed = item.kind === 'video' && embedFor(item.src);
      if (item.kind === 'image') stage.append(Object.assign(el('img'), { src: item.src, alt: item.alt || item.caption || '', decoding: 'async' }));
      else if (embed) {
        const f = el('iframe');
        Object.assign(f, { src: embed.url + (embed.url.includes('?') ? '&' : '?') + 'autoplay=1', title: item.caption || 'Video', allow: 'autoplay; fullscreen; picture-in-picture', allowFullscreen: true, referrerPolicy: 'strict-origin-when-cross-origin' });
        if (embed.ratio) f.style.aspectRatio = String(embed.ratio);
        stage.append(f);
      } else {
        const v = Object.assign(el('video'), { src: item.src, controls: true, autoplay: true, loop: true, playsInline: true });
        v.muted = !document.body.classList.contains('sound-on');
        stage.append(v);
      }
      // A click beside the picture goes back; on the picture itself it stays.
      root.addEventListener('click', (ev) => { if (ev.target === root || ev.target === stage) this.unfocus(); });
      root.append(stage);
    }
    const words = this.wordsFor(item);
    if (words.title || words.caption || words.text) root.append(this.kinetic(words));
    document.body.append(root);
    this.focusEl = root;
    requestAnimationFrame(() => root.classList.add('is-open'));
  }

  // The words arrive one at a time, each with a quiet plucked note from the world's own key.
  kinetic({ kicker, title, caption, text }) {
    const box = el('div', 'focus__words');
    if (kicker) box.append(el('p', 'mono focus__kicker', kicker));
    const lines = [];
    if (title) lines.push(['focus__title', title]);
    if (caption && caption !== title) lines.push(['focus__caption', caption]);
    if (text) for (const para of text.split(/\n+/).filter(Boolean)) lines.push(['focus__text', para]);
    const spans = [];
    for (const [cls, line] of lines) {
      const p = el('p', cls);
      for (const word of line.split(/\s+/).filter(Boolean)) {
        const s = el('span', 'focus__word', word);
        p.append(s, ' ');
        spans.push({ s, word, cls });
      }
      box.append(p);
    }
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const root = this.world.sound?.root || 110;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16];
    let i = 0, degree = 2;
    const step = () => {
      if (!box.isConnected && i > 0) return;
      const w = spans[i++];
      if (!w) return;
      w.s.classList.add('is-in');
      if (document.body.classList.contains('sound-on')) {
        // A gentle walk through the scale; headings sit lower, sentence ends come home.
        degree = Math.max(0, Math.min(scale.length - 1, degree + ((w.word.length % 3) - 1)));
        if (/[.!?…。！？]$/.test(w.word)) degree = 0;
        const base = w.cls === 'focus__text' ? 2 : 1;
        try { const ac = ctx(); ac?.resume(); if (ac) pluck(ac, root * base * Math.pow(2, scale[degree] / 12), 0.5, w.cls === 'focus__text' ? 0.05 : 0.08); } catch {}
      }
      const pause = /[.!?…。！？]$/.test(w.word) ? 700 : /[,;:—]$/.test(w.word) ? 380 : 0;
      this.wordTimer = setTimeout(step, 170 + Math.min(14, w.word.length) * 28 + pause + (w.cls === 'focus__title' ? 180 : 0));
    };
    if (still) spans.forEach((w) => w.s.classList.add('is-in'));
    else this.wordTimer = setTimeout(step, 1300); // once the flight is nearly there
    // A click on the words shows them all at once.
    box.addEventListener('click', (ev) => { ev.stopPropagation(); clearTimeout(this.wordTimer); spans.forEach((w) => w.s.classList.add('is-in')); });
    return box;
  }

  clearFocusView() {
    clearTimeout(this.wordTimer);
    const root = this.focusEl;
    this.focusEl = null;
    if (!root) return;
    root.classList.remove('is-open');
    root.querySelector('video')?.pause();
    setTimeout(() => {
      const v = root.querySelector('video');
      if (v) { v.removeAttribute('src'); v.load(); }
      root.remove();
    }, 600);
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
    this.plot = preview ? plot : null; // the outline of the plot shows only in the studio
    this.cell = plot; // but the form always stands in it as it does in the city
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
    this.unfocus({ instant: true });
    if (this.overPiece) { this.overPiece = false; document.body.style.cursor = ''; }
    this.setPlacing(null);
    this.setLighting(null);
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
    if (rebuild || !this.form || !this.preview || this.placing || this.lighting) return this.apply(world, { rebuild });
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
    const buildKey = JSON.stringify(world.build) + world.palette.join() + JSON.stringify(exhibitItems(world).map((m) => [m.kind, m.src?.length, !!m.show, m.show?.flip, m.show?.setting, m.poem, m.constellation, m.melody, m.sketch?.paths.length, m.build?.pieces.length]));
    const placeKey = JSON.stringify(exhibitItems(world).map((m) => m.show));
    if ((shapeChanged && !onlyStrokes) || buildKey !== this.buildKey) {
      this.buildKey = buildKey;
      this.placeKey = placeKey;
      this.layoutBuild();
    } else if (placeKey !== this.placeKey) {
      this.placeKey = placeKey;
      if (!this.exhibit?.relayout(world)) this.layoutBuild();
    }
    this.exhibit?.setLight(world.light);
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
    if (!w.build && !exhibitItems(w).length && !this.lighting) return this.outline();
    const U = 5.2, top = Math.max(buildTop(w.build), exhibitTop(w), 0.6) * U;
    let place = formPlacement(w, U, w.build ? top : U * 0.6);
    // Standing in a known plot, the form takes the same place and size as in the city,
    // so particles drawn or filled here land where everyone will see them.
    const c = this.cell;
    let room;
    if (c) {
      const Uc = Math.min(c.w, c.d), H = Math.max(c.h0, buildTop(w.build) * Uc + 0.15, exhibitTop(w) * Uc + 0.15);
      if (!w.build?.form) place = formPlacement(w, U, H * (U / Uc));
      room = { w: (c.w / Uc) * U, d: (c.d / Uc) * U, h: (H / Uc) * U }; // its light fills the plot as in the city
    }
    this.build = createBuild(w.build, w.palette, U);
    this.build.position.y = -top / 2;
    this.exhibit = createExhibit(w, U, w.build ? buildTop(w.build) * U * 0.45 : U * 0.3, room);
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
    const box = new THREE.Box3().setFromObject(this.plotBox);
    // The same room in the form's own space (where stars by hand are drawn), for filling it.
    const fp = this.form.getWorldPosition(new THREE.Vector3()), fs = this.form.getWorldScale(new THREE.Vector3()).x;
    this.room.form = { min: box.min.clone().sub(fp).divideScalar(fs).toArray(), max: box.max.clone().sub(fp).divideScalar(fs).toArray() };
    const sphere = box.getBoundingSphere(new THREE.Sphere());
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
    this.form.visible = (!this.world.form.hidden || !!this.painting) && !this.lighting; // while drawing stars you see them; painting light, the plot is empty
    if (this.preview) this.form.rotation.y = 0;
    else if (!this.painting && !this.world.form.strokes?.length) this.form.rotation.y += dt * 0.03; // hand-placed stars keep their place
    this.focusFrame(dt);
    this.exhibit?.update(t, dt, this.engine.camera, { audible: document.body.classList.contains('sound-on'), presence: this.nearPreview ?? 1, all: this.preview, inside: true, lighting: !!this.lighting }); // you have come into this world: it all shows (the studio at once, a visit piece by piece)
    this.updateMarker();
    this.updateDots();
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
