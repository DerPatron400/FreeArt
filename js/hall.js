// The hall: once you have stepped into a plot, it grows around you into a great space,
// and a guide takes you from piece to piece, each brought before you, the next already
// loading. Move, and the guide lets go: you fly freely, and a thin line of light marks
// the way it would have gone; fly into that line and it carries on from there. Walking
// out through a wall, the space folds back into its plot around you. Nothing ever stops
// you or holds the view: the room grows and folds while you keep moving.
import * as THREE from 'three';
import { el } from './util.js';
import { t } from './i18n.js';

const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const ease = (x) => x * x * (3 - 2 * x);

// Phones and desktops get their own pace and framing: a phone held upright sees less to
// the sides, is held closer and more briefly, so pieces fill more of it and come sooner.
const FEEL = {
  desktop: { fill: 0.55, dist: 1.5, pitch: 0.12, glide: 1.25, dwell: 7, film: 12, sway: 0.28 },
  phone: { fill: 0.72, dist: 1.1, pitch: 0.16, glide: 1.1, dwell: 5.5, film: 9, sway: 0.18 },
};

const LINE_VERT = /* glsl */`
attribute float run;
varying float vRun;
void main() { vRun = run; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const LINE_FRAG = /* glsl */`
uniform float uTime, uOpacity, uNear;
varying float vRun;
void main() {
  // Short dashes of light travelling along the way the tour goes.
  float d = fract(vRun * 0.9 - uTime * 0.35);
  float on = smoothstep(0.0, 0.08, d) * (1.0 - smoothstep(0.4, 0.5, d));
  float a = uOpacity * (0.22 + 0.5 * on) * (0.6 + 0.4 * uNear);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.95, 0.93, 0.88) * a, a);
}`;

export class Hall {
  constructor(city) {
    this.city = city;
    this.it = null;
    this.k = 1; this.goal = 1; this.from = 1; this.at = 0; this.span = 1;
    this.origin = new THREE.Vector3();
    this.base = new THREE.Vector3();
    this.mode = 'off'; // 'off' | 'guide' | 'free'
    this.stage = 0; this.order = []; this.dwell = 0; this.sway = 0;
    this.speed = new THREE.Vector3();
    this.phone = matchMedia('(pointer: coarse)').matches;

    this.uniforms = { uTime: { value: 0 }, uOpacity: { value: 0 }, uNear: { value: 0 } };
    this.line = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    this.line.frustumCulled = false;
    this.line.layers.set(1);
    this.line.visible = false;
    city.group.add(this.line);
    this.path = []; // the points the line runs through, with the stage each one leads to

    this.caption = el('div', 'hall-caption');
    this.hint = el('p', 'hall-hint mono');
    this.caption.hidden = this.hint.hidden = true;
    document.body.append(this.caption, this.hint);
  }

  get feel() {
    return this.phone || innerWidth < innerHeight ? FEEL.phone : FEEL.desktop;
  }

  // How big a plot grows: about forty paces across, whatever its size.
  scaleFor(it) {
    return Math.min(6, Math.max(3, 34 / Math.max(it.plot.w, it.plot.d)));
  }

  // The plot's box as it stands now (grown, while it is the hall).
  bounds(it) {
    const k = it.anchor.scale.x;
    return { cx: it.anchor.position.x, cz: it.anchor.position.z, w: it.plot.w * k, d: it.plot.d * k, h: it.plot.h * k };
  }

  open(it) {
    if (this.it === it) { this.grow(this.scaleFor(it), 1.8); return; }
    if (this.it) this.reset();
    const w = this.city.walker;
    this.it = it;
    this.base.copy(it.anchor.position);
    this.origin.set(w.pos.x, 0, w.pos.z); // the room grows out from where you came in
    this.grow(this.scaleFor(it), 2.2);
    this.mode = 'off';
    this.stage = 0;
    this.city.refreshVolumes(it.plot);
    // The plot's card steps aside: in here the guide says what each piece is.
    this.city.standing = it.plot;
    this.city.select(null, { quiet: true });
  }

  close() {
    if (!this.it || this.goal === 1) return;
    this.leave();
    this.grow(1, 1.4);
  }

  grow(goal, span) {
    this.from = this.k; this.goal = goal; this.at = 0; this.span = span;
  }

  reset() {
    const it = this.it;
    it.anchor.scale.setScalar(1);
    it.anchor.position.copy(this.base);
    this.it = null;
    this.k = this.goal = 1;
    this.leave();
    this.city.refreshVolumes();
    this.city.walker.reach = null;
  }

  // Stop guiding (on any move of yours); the line shows the way back in.
  pause() {
    if (this.mode !== 'guide') return;
    this.mode = 'free';
    this.away = false; // you stop on the line itself: it only takes you back once you have left it
    this.it?.exhibit.prefer([]);
    this.buildPath();
    this.say(null);
    this.hint.textContent = t('hall.rejoin');
    this.hint.hidden = false;
    requestAnimationFrame(() => this.hint.classList.add('is-on'));
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.hint.classList.remove('is-on'), 6000);
  }

  leave() {
    this.mode = 'off';
    this.say(null);
    this.hint.classList.remove('is-on');
    this.it?.exhibit.prefer([]);
  }

  // The order the guide takes: from where you came in, always to the nearest piece next.
  plan() {
    const spots = this.it.exhibit.spots().filter((s) => s.size > 0);
    const order = [];
    let cur = this.city.walker.pos.clone();
    while (spots.length) {
      spots.sort((a, b) => a.at.distanceTo(cur) - b.at.distanceTo(cur));
      const s = spots.shift();
      order.push(s.index);
      cur = s.at;
    }
    return order;
  }

  // Where to be to see a piece well: between the room's middle and the piece, far enough
  // back that it fills a good part of the view, turned a little with the sway.
  viewpoint(spot, sway = 0, out = new THREE.Vector3()) {
    const b = this.bounds(this.it), f = this.feel, cam = this.city.engine.camera;
    const centre = new THREE.Vector3(b.cx, b.h * 0.45, b.cz);
    const dir = centre.clone().sub(spot.at).setY(0);
    if (dir.lengthSq() < 0.01) dir.copy(this.city.walker.pos).sub(spot.at).setY(0);
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
    dir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), sway);
    const half = THREE.MathUtils.degToRad(cam.fov) / 2;
    const narrow = Math.min(half, Math.atan(Math.tan(half) * cam.aspect));
    const D = spot.size / (2 * Math.tan(narrow) * f.fill);
    out.copy(spot.at).addScaledVector(dir, Math.max(D - f.dist, spot.size * 0.6));
    out.y = Math.max(0.6, spot.at.y);
    // Never out through the walls.
    const m = 0.6;
    out.x = Math.min(Math.max(out.x, b.cx - b.w / 2 + m), b.cx + b.w / 2 - m);
    out.z = Math.min(Math.max(out.z, b.cz - b.d / 2 + m), b.cz + b.d / 2 - m);
    out.y = Math.min(out.y, b.h - m);
    return out;
  }

  // The line of light: through every viewpoint in order, round and back to the first.
  buildPath() {
    const spots = this.spotMap();
    const pts = [];
    this.path = [];
    for (let i = 0; i < this.order.length; i++) {
      const s = spots.get(this.order[i]);
      if (!s) continue;
      const v = this.viewpoint(s);
      pts.push(v);
      this.path.push({ at: v, stage: i });
    }
    if (!pts.length) { this.line.visible = false; return; }
    // A single stop: the line is a slow ring around where the guide stands.
    if (pts.length === 1) {
      const c = pts[0], r = Math.max(1.2, this.k * 0.3);
      pts.length = 0;
      for (let i = 0; i < 6; i++) pts.push(c.clone().add(new THREE.Vector3(Math.cos(i / 6 * Math.PI * 2) * r, 0, Math.sin(i / 6 * Math.PI * 2) * r)));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    const n = Math.max(64, pts.length * 40), dense = curve.getSpacedPoints(n);
    const pos = [], run = [];
    let len = 0;
    for (let i = 0; i < dense.length - 1; i++) {
      const a = dense[i], b = dense[i + 1], l = a.distanceTo(b);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      run.push(len, len + l);
      len += l;
    }
    this.dense = dense;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('run', new THREE.Float32BufferAttribute(run, 1));
    this.line.geometry.dispose();
    this.line.geometry = g;
    this.line.visible = true;
  }

  spotMap() {
    return new Map(this.it.exhibit.spots().map((s) => [s.index, s]));
  }

  say(spot) {
    if (!spot) { this.caption.classList.remove('is-on'); this.captionFor = null; return; }
    if (this.captionFor !== spot.index) {
      this.captionFor = spot.index;
      const world = this.it.world;
      this.caption.replaceChildren(el('span', 'mono', world.title), ...(spot.item?.caption ? [el('b', null, spot.item.caption)] : []));
      this.caption.hidden = false;
      requestAnimationFrame(() => this.caption.classList.add('is-on'));
    }
  }

  // The walker asks each frame: are you steering me? (true while the guide is.)
  drive(dt, moving) {
    if (this.mode !== 'guide') return false;
    if (moving) { this.pause(); return false; }
    const w = this.city.walker, f = this.feel, spots = this.spotMap();
    if (!this.order.length) { this.order = this.plan(); this.stage = 0; }
    const spot = spots.get(this.order[this.stage % this.order.length]);
    if (!spot) { this.pause(); return false; }
    const next = this.order[(this.stage + 1) % this.order.length];
    this.it.exhibit.prefer([spot.index, next]);
    // A slow sway around the piece while you look at it.
    const target = this.viewpoint(spot, Math.sin(this.sway) * f.sway);
    // A smooth glide: a spring with no overshoot, its speed kept gentle.
    const om = f.glide;
    const acc = target.clone().sub(w.pos).multiplyScalar(om * om).addScaledVector(this.speed, -2 * om);
    this.speed.addScaledVector(acc, dt);
    const top = Math.max(2.5, spot.size * 1.2);
    if (this.speed.length() > top) this.speed.setLength(top);
    w.pos.addScaledVector(this.speed, dt);
    w.vel.copy(this.speed);
    // Look at the piece.
    const yaw = Math.atan2(w.pos.x - spot.at.x, w.pos.z - spot.at.z);
    let dy = yaw - w.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    w.yaw += dy * damp(2.2, dt);
    const flat = Math.hypot(w.pos.x - spot.at.x, w.pos.z - spot.at.z);
    const pitch = Math.atan2(w.pos.y - spot.at.y, Math.max(0.5, flat)) * 0.6 + f.pitch;
    w.pitch += (pitch - w.pitch) * damp(1.5, dt);
    w.dist += (f.dist - w.dist) * damp(1.5, dt);
    // Arrived: stay a while, then on to the next.
    const here = w.pos.distanceTo(target) < Math.max(0.35, spot.size * 0.2) && this.speed.length() < Math.max(0.6, spot.size * 0.3);
    if (here || this.dwell > 0) {
      this.dwell += dt;
      this.sway += dt * 0.22;
      this.say(spot);
      const film = spot.item?.kind === 'video';
      if (this.dwell > (film ? f.film : f.dwell)) { this.dwell = 0; this.stage++; this.say(null); }
    }
    return true;
  }

  // Back onto the line: carry on from the stage that part of the line leads to.
  rejoin(w) {
    if (!this.dense || !this.line.visible) return;
    let best = Infinity;
    for (const p of this.dense) best = Math.min(best, p.distanceToSquared(w.pos));
    const reach = Math.max(0.5, this.k * 0.12);
    this.uniforms.uNear.value += ((best < (reach * 4) ** 2 ? 1 : 0) - this.uniforms.uNear.value) * 0.1;
    if (best > (reach * 2.5) ** 2) this.away = true;
    if (best > reach * reach || !this.away) return;
    let near = this.path[0], d = Infinity;
    for (const p of this.path) { const dd = p.at.distanceToSquared(w.pos); if (dd < d) { d = dd; near = p; } }
    this.stage = near.stage;
    this.dwell = 0;
    this.speed.copy(w.vel);
    this.mode = 'guide';
    this.hint.classList.remove('is-on');
  }

  update(t, dt) {
    const it = this.it;
    this.uniforms.uTime.value = t;
    this.uniforms.uOpacity.value += ((it && this.mode === 'free' ? 1 : 0) - this.uniforms.uOpacity.value) * damp(2, dt);
    if (this.uniforms.uOpacity.value < 0.01) this.line.visible = false;
    if (!it) return;
    const w = this.city.walker, e = this.city.engine;
    // Grow (or fold), smoothly, around where you came in.
    if (this.at < 1) {
      this.at = Math.min(1, this.at + dt / this.span);
      const k = this.from + (this.goal - this.from) * ease(ease(this.at));
      // Folding back, you stay where you are in the room: you, your view and the room shrink together.
      if (this.goal < this.from) {
        const r = k / this.k;
        for (const v of [w.pos, e.camera.position, w.look]) v.sub(this.origin).multiplyScalar(r).add(this.origin);
      }
      this.k = k;
      it.anchor.scale.setScalar(k);
      it.anchor.position.copy(this.base).sub(this.origin).multiplyScalar(k).add(this.origin);
      if (this.at >= 1 && this.goal === 1) { this.reset(); return; }
    }
    const b = this.bounds(it);
    w.reach = { x0: b.cx - b.w / 2 - 4, x1: b.cx + b.w / 2 + 4, z0: b.cz - b.d / 2 - 4, z1: b.cz + b.d / 2 + 4, top: Math.max(15, b.h + 2) };
    // Fully grown: the guide begins, unless you are already on your way somewhere.
    if (this.mode === 'off' && this.goal > 1 && this.at > 0.8) {
      const { f, s, u } = w.input();
      if (f || s || u) { this.mode = 'guide'; this.order = this.plan(); this.pause(); }
      else { this.mode = 'guide'; this.order = this.plan(); this.stage = 0; this.dwell = 0; this.speed.copy(w.vel); }
    }
    if (this.mode === 'free') this.rejoin(w);
  }
}
