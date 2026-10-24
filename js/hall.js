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
const EYE = 0.04, BEHIND = 3.2; // the camera inside your blob while guided; behind it while you fly
const ease = (x) => x * x * (3 - 2 * x);

// Phones and desktops get their own pace and framing: a phone held upright sees less to
// the sides, is held closer and more briefly, so pieces fill more of it and come sooner.
const FEEL = {
  desktop: { build: 6, fill: 0.55, dist: 0, pitch: 0, glide: 1.25, dwell: 7, film: 12, sway: 0.28 },
  phone: { build: 5, fill: 0.72, dist: 0, pitch: 0.03, glide: 1.1, dwell: 5.5, film: 9, sway: 0.18 },
};

const LINE_VERT = /* glsl */`
attribute float run;
varying float vRun;
void main() { vRun = run; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const LINE_FRAG = /* glsl */`
uniform float uTime, uOpacity, uNear, uDraw;
varying float vRun;
void main() {
  // Short dashes of light travelling along the way the tour goes.
  float d = fract(vRun * 0.9 - uTime * 0.35);
  float on = smoothstep(0.0, 0.08, d) * (1.0 - smoothstep(0.4, 0.5, d));
  float a = uOpacity * (0.22 + 0.5 * on) * (0.6 + 0.4 * uNear) * (1.0 - smoothstep(uDraw - 2.0, uDraw, vRun));
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.91, 0.92, 1.0) * a, a); // the paper white, #e8ebff
}`;

export class Hall {
  constructor(city) {
    this.city = city;
    this.it = null;
    this.k = 1; this.goal = 1; this.from = 1; this.at = 0; this.span = 1;
    this.origin = new THREE.Vector3();
    this.base = new THREE.Vector3();
    this.mode = 'off'; // 'off' | 'arrive' (the flyover as you come in) | 'guide' | 'free'
    this.stage = 0; this.order = []; this.dwell = 0; this.sway = 0;
    this.speed = new THREE.Vector3();
    this.phone = matchMedia('(pointer: coarse)').matches;

    this.uniforms = { uTime: { value: 0 }, uOpacity: { value: 0 }, uNear: { value: 0 }, uDraw: { value: 1e6 } };
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
    // The way out: no wall to find, a doorway opens just where you are.
    this.leaveButton = el('div', 'hall-leave');
    const out = el('button', 'btn btn--ghost btn--small', t('hall.leave'));
    out.type = 'button';
    out.addEventListener('click', () => this.goOut());
    // And the other way of seeing the same world: its page, the whole of it at once (you
    // come back to the stop you were at).
    const whole = el('button', 'btn btn--ghost btn--small', t('hall.overview'));
    whole.type = 'button';
    whole.addEventListener('click', () => this.toOverview());
    this.leaveButton.append(whole, out);
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.it && !this.exit) { e.stopImmediatePropagation(); this.goOut(); } }, true);
    // Back and on between the stops, and the way onto the tour when you are near its line.
    this.nav = el('div', 'hall-nav');
    const arrow = (cls, label, step) => {
      const b = el('button', 'hall-nav__arrow ' + cls, label);
      b.type = 'button';
      b.setAttribute('aria-label', t(step < 0 ? 'hall.prev' : 'hall.next'));
      b.addEventListener('click', () => this.step(step));
      return b;
    };
    this.count = el('span', 'hall-nav__count mono');
    this.join = el('button', 'btn btn--primary btn--small hall-nav__join', t('hall.join'));
    this.join.type = 'button';
    this.join.addEventListener('click', () => this.joinNearest());
    this.nav.append(arrow('is-prev', '‹', -1), this.count, this.join, arrow('is-next', '›', 1));
    addEventListener('keydown', (e) => {
      if (!this.it || this.exit || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === ',' || e.key === '<') this.step(-1);
      if (e.key === '.' || e.key === '>') this.step(1);
    });
    document.body.append(this.caption, this.hint, this.leaveButton, this.nav);
    this.spreadAmt = 0;
    this.exit = null; // while leaving: { door, facing, open, to, time }
    this.leaving = null; // the plot just left, so walking on out of it does not open it again
  }

  get feel() {
    return this.phone || innerWidth < innerHeight ? FEEL.phone : FEEL.desktop;
  }

  // How big a plot grows: about forty paces across, whatever its size.
  scaleFor(it) {
    return Math.min(6, Math.max(3, 34 / Math.max(it.plot.w, it.plot.d)));
  }

  // The plot's box as it stands now (grown, while it is the hall).
  // In the hall it also takes in the gallery the pieces spread out into, with room around it.
  bounds(it) {
    const k = it.anchor.scale.x, a = it.anchor.position;
    if (it !== this.it) return { cx: a.x, cz: a.z, w: it.plot.w * k, d: it.plot.d * k, h: it.plot.h * k };
    const g = it.exhibit.galleryBox(), m = 2;
    const x0 = Math.min(-it.plot.w / 2, g.min.x - m), x1 = Math.max(it.plot.w / 2, g.max.x + m);
    const z0 = Math.min(-it.plot.d / 2, g.min.z - m), z1 = Math.max(it.plot.d / 2, g.max.z + m);
    return { cx: a.x + (x0 + x1) / 2 * k, cz: a.z + (z0 + z1) / 2 * k, w: (x1 - x0) * k, d: (z1 - z0) * k, h: Math.max(it.plot.h, g.max.y + m) * k };
  }

  // to: start the tour at this piece (its index), quick: come straight in, without the long flight.
  open(it, { to = null, quick = false } = {}) {
    this.target = to;
    this.quick = quick;
    if (this.it === it) { this.grow(this.scaleFor(it), 1.8); return; }
    if (this.it) this.reset();
    const w = this.city.walker;
    this.it = it;
    this.base.copy(it.anchor.position);
    this.origin.set(w.pos.x, 0, w.pos.z); // the room grows out from where you came in
    this.grow(this.scaleFor(it), 3);
    this.mode = 'off';
    this.order = [];
    this.nearLine = false;
    this.zoomK = 1;
    this.stage = 0;
    this.city.refreshVolumes(it.plot);
    // The plot's card steps aside: in here the guide says what each piece is.
    this.city.standing = it.plot;
    this.city.select(null, { quiet: true });
  }

  // The stop you are at (or nearest), as the piece's index.
  currentPiece() {
    if (!this.order.length) return null;
    const s = this.mode === 'free' ? this.nearestStage() : this.stage % this.order.length;
    return this.order[s] ?? null;
  }

  toOverview() {
    if (!this.it || this.exit) return;
    const index = this.currentPiece();
    if (index !== null) this.city.lastStop = { id: this.it.world.id, index };
    this.city.onEnter(this.it.world);
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
    it.exhibit.spread(0);
    this.spreadAmt = 0;
    it.anchor.scale.setScalar(1);
    it.anchor.position.copy(this.base);
    this.it = null;
    this.k = this.goal = 1;
    this.leave();
    this.city.refreshVolumes();
    this.city.walker.reach = null;
    this.city.walker.mesh.material.visible = true;
  }

  // Stop guiding (on any move of yours); the line shows the way back in.
  pause() {
    if (this.mode !== 'guide' && this.mode !== 'arrive') return;
    if (this.mode === 'arrive' || !this.order.length) this.order = this.plan();
    this.mode = 'free';
    this.rush = false;
    this.away = false; // you stop on the line itself: it only takes you back once you have left it
    this.drawing = false;
    this.uniforms.uDraw.value = 1e6;
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

  // The order the guide takes: the maker's, always from their first piece to their last.
  plan() {
    return this.it.exhibit.spots().filter((s) => s.size > 0).sort((a, b) => a.index - b.index).map((s) => s.index);
  }

  // Back to the city: a doorway opens just before you, you turn to it and go through, and
  // the space folds away behind you; you come out by the wall you came in through.
  goOut() {
    const it = this.it, w = this.city.walker;
    if (!it || this.exit) return;
    this.mode = 'off';
    this.say(null);
    this.hint.classList.remove('is-on');
    this.line.visible = false;
    // Out where you came in: the room grew from that point and folds back to it.
    const out = this.origin.clone().sub(this.base).setY(0);
    if (Math.abs(out.x) / it.plot.w > Math.abs(out.z) / it.plot.d) out.set(Math.sign(out.x) || 1, 0, 0); else out.set(0, 0, Math.sign(out.z) || 1);
    const to = this.origin.clone().addScaledVector(out, 3).setY(Math.min(it.plot.h * 0.6, 2.4));
    // The doorway opens straight ahead of you, where you are looking.
    const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(this.city.engine.camera.quaternion).setY(0);
    if (ahead.lengthSq() < 0.01) ahead.set(-Math.sin(w.yaw), 0, -Math.cos(w.yaw));
    ahead.normalize();
    const door = w.pos.clone().addScaledVector(ahead, 3);
    door.y = Math.max(w.pos.y, 1.5);
    this.exit = { door, facing: ahead.clone().negate(), open: 0, to, time: 0, ahead };
    this.speed.set(0, 0, 0);
  }

  // Each frame of leaving: turn to the doorway as it opens, glide through, fold, arrive.
  going(dt) {
    const x = this.exit, w = this.city.walker;
    x.time += dt;
    x.open = x.time < 3.4 ? Math.min(1, x.time / 0.6) : 0;
    // Facing the doorway; once through, turning to where you come out.
    const towards = x.time < 1.9 ? x.ahead : x.to.clone().sub(w.pos).setY(0);
    const yaw = towards.lengthSq() > 0.01 ? Math.atan2(-towards.x, -towards.z) : w.yaw;
    let dy = yaw - w.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    w.yaw += dy * damp(3, dt);
    w.pitch += (0.15 - w.pitch) * damp(2, dt);
    w.dist += ((x.time < 1.9 ? EYE : BEHIND) - w.dist) * damp(x.time < 1.9 ? 3 : 1, dt);
    if (x.time > 1.4 && !x.folding && this.it) {
      // Through the doorway: the hall folds back around you as you go.
      x.folding = true;
      this.leaving = this.it;
      this.grow(1, 2.2);
    }
    // A breath while it opens, then through the doorway, then on out.
    const goal = x.time < 0.7 ? w.pos.clone() : x.time < 1.9 ? x.door.clone().addScaledVector(x.ahead, 2) : x.to;
    const om = x.time < 1.9 ? 2.6 : 1.4;
    const acc = goal.clone().sub(w.pos).multiplyScalar(om * om).addScaledVector(this.speed, -2 * om);
    this.speed.addScaledVector(acc, dt);
    if (this.speed.length() > 9) this.speed.setLength(9);
    w.pos.addScaledVector(this.speed, dt);
    w.vel.copy(this.speed);
    if (x.time > 1.9 && !this.it && w.pos.distanceTo(x.to) < 0.4) { this.exit = null; w.vel.multiplyScalar(0.3); }
    if (x.time > 9) this.exit = null;
    return true;
  }

  // Where to be to see a piece well: between the room's middle and the piece, far enough
  // back that it fills a good part of the view, turned a little with the sway.
  // In the gallery you come to each piece from the one before, so the way between them is
  // the journey, and what comes later stands further off in the dark.
  viewpoint(spot, sway = 0, out = new THREE.Vector3(), from = null) {
    // In a setting you stand where it was seen from (so it stays sharp), and only lean a
    // little toward each piece in it.
    const room = this.roomOf(spot);
    if (room) return spot.setting ? out.copy(room.eye) : out.copy(room.eye).lerp(spot.at, 0.18);
    const b = this.bounds(this.it), f = this.feel, cam = this.city.engine.camera;
    const centre = from || new THREE.Vector3(b.cx, b.h * 0.45, b.cz);
    const dir = centre.clone().sub(spot.at).setY(0);
    if (dir.lengthSq() < 0.01) dir.copy(this.city.walker.pos).sub(spot.at).setY(0);
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
    dir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), sway);
    const half = THREE.MathUtils.degToRad(cam.fov) / 2;
    const narrow = Math.min(half, Math.atan(Math.tan(half) * cam.aspect));
    const D = spot.size / (2 * Math.tan(narrow) * f.fill) * (this.zoomK || 1);
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
      const v = this.viewpoint(s, 0, undefined, this.before(i, spots));
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
    this.runLength = len;
    this.pathFull = this.spreadAmt >= 1; // drawn before the pieces had all spread: drawn again once they have
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('run', new THREE.Float32BufferAttribute(run, 1));
    this.line.geometry.dispose();
    this.line.geometry = g;
    this.line.visible = true;
  }

  // Where the guide comes to a stage from: the piece before it (the first, from the last).
  before(stage, spots) {
    const n = this.order.length;
    if (n < 2) return null;
    return spots.get(this.order[(stage - 1 + n) % n])?.at || null;
  }

  // The setting a spot stands in (or is), once its point of view is known.
  roomOf(spot) {
    if (spot.setting) return spot.eye ? spot : null;
    if (spot.room == null) return null;
    const room = this.spotMap().get(spot.room);
    return room?.eye ? room : null;
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

  // Looking around while guided: the guide lets the view go while you turn it, and brings it
  // gently back to the piece a moment after you let go. Only moving leaves the tour.
  freeLook() {
    return performance.now() - (this.city.walker.lookedAt || 0) < 1500;
  }

  // The wheel while guided: nearer to the pieces, or further back (kept for the whole tour).
  zoom(dy) {
    if (this.mode !== 'guide' && this.mode !== 'arrive') return false;
    this.zoomK = Math.min(2.5, Math.max(0.45, (this.zoomK || 1) * (1 + dy * 0.001)));
    return true;
  }

  // The walker asks each frame: are you steering me? (true while the guide is.)
  drive(dt, moving) {
    if (this.exit) return this.going(dt);
    if (this.mode === 'arrive') {
      if (moving) { this.pause(); return false; }
      return this.flyover(dt);
    }
    if (this.mode !== 'guide') return false;
    if (moving) { this.pause(); return false; }
    const w = this.city.walker, f = this.feel, spots = this.spotMap();
    if (!this.order.length) { this.order = this.plan(); this.stage = 0; }
    const spot = spots.get(this.order[this.stage % this.order.length]);
    if (!spot) { this.pause(); return false; }
    const next = this.order[(this.stage + 1) % this.order.length];
    this.it.exhibit.prefer([spot.index, next]);
    // A slow sway around the piece while you look at it.
    const room = this.roomOf(spot);
    const target = this.viewpoint(spot, room ? 0 : Math.sin(this.sway) * f.sway, undefined, this.stage ? this.before(this.stage % this.order.length, spots) : w.pos);
    // What to look at: the piece, or (a setting) the way it was seen.
    const look = spot.setting && room ? room.eye.clone().addScaledVector(room.forward, 10).setY(room.eye.y) : spot.at;
    // A smooth glide: a spring with no overshoot, its speed kept gentle.
    const om = this.rush ? f.glide * 2.6 : f.glide; // clicked to: quick, still without overshoot
    const acc = target.clone().sub(w.pos).multiplyScalar(om * om).addScaledVector(this.speed, -2 * om);
    this.speed.addScaledVector(acc, dt);
    const top = Math.max(2.5, spot.size * 1.2) * (this.rush ? 4 : 1);
    if (this.speed.length() > top) this.speed.setLength(top);
    w.pos.addScaledVector(this.speed, dt);
    w.vel.copy(this.speed);
    // Look at the piece (unless you are looking around yourself just now).
    if (!this.freeLook()) {
      const yaw = Math.atan2(w.pos.x - look.x, w.pos.z - look.z);
      let dy = yaw - w.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      w.yaw += dy * damp(1.6, dt);
      const flat = Math.hypot(w.pos.x - look.x, w.pos.z - look.z);
      const pitch = Math.atan2(w.pos.y - look.y, Math.max(0.5, flat)) + f.pitch;
      w.pitch += (pitch - w.pitch) * damp(1.2, dt);
    }
    // Guided, you see through your own eyes: nothing of you stands between you and the piece.
    w.dist += (EYE - w.dist) * damp(1.5, dt);
    // Arrived: stay a while, then on to the next.
    const sz = room ? Math.min(spot.size, 1.5) : spot.size; // in a setting: right at its point of view
    const here = w.pos.distanceTo(target) < Math.max(0.35, sz * 0.2) && this.speed.length() < Math.max(0.6, sz * 0.3);
    if (this.rush && w.pos.distanceTo(target) < Math.max(1, sz * 0.6)) { this.rush = false; this.say(spot); } // its words, right as you get there
    if (here || this.dwell > 0) {
      this.dwell += dt;
      this.sway += dt * 0.22;
      this.say(spot);
      const film = spot.item?.kind === 'video';
      if (this.dwell > (film ? f.film : f.dwell)) { this.dwell = 0; this.stage++; this.say(null); }
    }
    return true;
  }

  // The arrows: on to the next stop or back to the one before (from flying free, too).
  step(d) {
    if (!this.it || this.exit || this.mode === 'off') return;
    if (this.mode === 'arrive') this.spreadAmt = Math.max(this.spreadAmt, 0.98); // straight on to the tour
    if (!this.order.length) this.order = this.plan();
    const n = this.order.length;
    if (!n) return;
    const near = this.mode === 'free' ? this.nearestStage() : this.stage;
    this.stage = (((near + (this.mode === 'free' && d > 0 ? 0 : d)) % n) + n) % n;
    this.dwell = 0;
    this.say(null);
    this.resume();
  }

  // A piece clicked while flying free (or guided): a quick flight straight to its stop,
  // with its words shown as soon as you are there; then the tour carries on from it.
  click() {
    if (!this.it || this.exit || this.mode === 'off' || this.mode === 'arrive') return;
    const e = this.city.engine;
    if (e.pointer.x < -2) return;
    e.raycaster.setFromCamera(e.pointer, e.camera);
    const hit = this.it.exhibit.pick(e.raycaster);
    if (!hit) return;
    if (!this.order.length) this.order = this.plan();
    const stage = this.order.indexOf(hit.index);
    if (stage < 0) return;
    this.stage = stage;
    this.dwell = 0;
    this.rush = true;
    this.say(null);
    this.resume();
  }

  // Under the pointer while flying free: a piece you could click to fly to.
  hovering() {
    if (!this.it || this.mode !== 'free' || this.exit) return false;
    const e = this.city.engine;
    if (e.pointer.x < -2) return false;
    e.raycaster.setFromCamera(e.pointer, e.camera);
    return !!this.it.exhibit.pick(e.raycaster);
  }

  // The stop nearest to you (its viewpoint on the line).
  nearestStage() {
    const w = this.city.walker;
    let near = this.path[0], d = Infinity;
    for (const p of this.path) { const dd = p.at.distanceToSquared(w.pos); if (dd < d) { d = dd; near = p; } }
    return near ? near.stage : this.stage;
  }

  joinNearest() {
    if (this.mode !== 'free') return;
    this.stage = this.nearestStage();
    this.dwell = 0;
    this.resume();
  }

  resume() {
    if (this.mode === 'arrive') return;
    this.mode = 'guide';
    this.speed.copy(this.city.walker.vel);
    this.hint.classList.remove('is-on');
  }

  // Coming in: first a slow flight around the plot as its pieces come, one by one, where
  // the maker placed them; then they drift apart into the dark, the way between them
  // draws itself as a line of light, and the guide sets off along it.
  flyover(dt) {
    const w = this.city.walker, it = this.it, x = this.arrive, f = this.feel;
    x.time += dt;
    const a = it.anchor.position, k = this.k, g = it.exhibit.galleryBox(), b = this.bounds(it);
    const sp = ease(this.spreadAmt);
    const gc = new THREE.Vector3((g.min.x + g.max.x) / 2, (g.min.y + g.max.y) / 2, (g.min.z + g.max.z) / 2).multiplyScalar(k);
    const centre = new THREE.Vector3(a.x + gc.x * sp, it.plot.h * k * 0.4 * (1 - sp) + gc.y * sp, a.z + gc.z * sp);
    const rx = THREE.MathUtils.lerp(it.plot.w * k * 0.75, b.w * 0.42, sp) * (f === FEEL.phone ? 1.15 : 1) * (this.zoomK || 1);
    const rz = THREE.MathUtils.lerp(it.plot.d * k * 0.75, b.d * 0.42, sp) * (f === FEEL.phone ? 1.15 : 1) * (this.zoomK || 1);
    x.angle += dt * 0.06;
    const goal = new THREE.Vector3(centre.x + Math.sin(x.angle) * rx, centre.y + Math.max(rx, rz) * 0.32, centre.z + Math.cos(x.angle) * rz);
    const m = 1;
    goal.x = Math.min(Math.max(goal.x, b.cx - b.w / 2 + m), b.cx + b.w / 2 - m);
    goal.z = Math.min(Math.max(goal.z, b.cz - b.d / 2 + m), b.cz + b.d / 2 - m);
    goal.y = Math.min(Math.max(goal.y, 1), b.h - m);
    // A slow, soft glide: nothing is hurried while the place comes into being.
    const om = 0.9;
    const acc = goal.sub(w.pos).multiplyScalar(om * om).addScaledVector(this.speed, -2 * om);
    this.speed.addScaledVector(acc, dt);
    w.pos.addScaledVector(this.speed, dt);
    w.vel.copy(this.speed);
    if (!this.freeLook()) {
      const yaw = Math.atan2(w.pos.x - centre.x, w.pos.z - centre.z);
      let dy = yaw - w.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      w.yaw += dy * damp(1.4, dt);
      const flat = Math.hypot(w.pos.x - centre.x, w.pos.z - centre.z);
      w.pitch += (Math.atan2(w.pos.y - centre.y, Math.max(0.5, flat)) - w.pitch) * damp(1.2, dt);
    }
    w.dist += (EYE - w.dist) * damp(1.5, dt);
    // All spread out: the line draws itself, and the guide takes you along it.
    if (this.spreadAmt >= 1) {
      this.order = this.plan();
      this.stage = 0; this.dwell = 0;
      // Come for one piece: straight on to it.
      const s = this.target == null ? -1 : this.order.indexOf(this.target);
      if (s >= 0) { this.stage = s; this.rush = true; }
      this.target = null;
      this.mode = 'guide';
      this.buildPath();
      this.uniforms.uDraw.value = 0;
      this.drawing = true;
      this.showLine = 5;
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
    this.nearLine = best < Math.max(reach * 10, 4) ** 2; // close enough to be offered the way back on
    if (best > reach * reach || !this.away) return;
    this.joinNearest();
  }

  update(t, dt) {
    const it = this.it;
    this.uniforms.uTime.value = t;
    this.showLine = Math.max(0, (this.showLine || 0) - dt);
    this.uniforms.uOpacity.value += ((it && (this.mode === 'free' || this.showLine > 0) ? 1 : 0) - this.uniforms.uOpacity.value) * damp(this.showLine > 0 ? 3 : 2, dt);
    if (this.drawing) {
      this.uniforms.uDraw.value += dt * Math.max(6, this.runLength / 3.5);
      if (this.uniforms.uDraw.value > this.runLength + 2) { this.drawing = false; this.uniforms.uDraw.value = 1e6; }
    }
    if (this.uniforms.uOpacity.value < 0.01) this.line.visible = false;
    const showLeave = !!it && this.k > 1.5 && !this.exit && this.goal > 1;
    if (showLeave !== this.leaveShown) {
      this.leaveShown = showLeave;
      this.leaveButton.classList.toggle('is-on', showLeave);
    }
    document.body.classList.toggle('in-hall', !!it && this.k > 1.5); // the city's own hints step aside
    const navOn = showLeave && (this.mode === 'guide' || this.mode === 'free') && this.order.length > 1;
    this.nav.classList.toggle('is-on', navOn);
    if (navOn) {
      const joinOn = this.mode === 'free' && !!this.nearLine;
      this.nav.classList.toggle('can-join', joinOn);
      const text = `${(this.mode === 'free' ? this.nearestStage() : this.stage % this.order.length) + 1} / ${this.order.length}`;
      if (this.count.textContent !== text) this.count.textContent = text;
    }
    if (!it) return;
    const w = this.city.walker, e = this.city.engine;
    // The pieces spread out into the dark as the room grows, and gather back as it folds.
    // (Coming in, first the flight around them as they were placed: then they spread.)
    const spreading = this.goal > 1 && this.at > 0.25 && (this.mode !== 'arrive' || this.quick || this.arrive.time > this.feel.build) && this.mode !== 'off';
    this.spreadAmt = Math.max(0, Math.min(1, this.spreadAmt + (spreading ? dt / (this.quick ? 2.2 : 4.5) : this.goal > 1 ? 0 : -dt / 1.2)));
    it.exhibit.spread(this.spreadAmt);
    // Grow (or fold), smoothly, around where you came in.
    if (this.at < 1) {
      this.at = Math.min(1, this.at + dt / this.span);
      const k = this.from + (this.goal - this.from) * ease(ease(this.at));
      // Folding back, you stay where you are in the room: you, your view and the room shrink together.
      if (this.goal < this.from) {
        const r = k / this.k;
        for (const v of [w.pos, e.camera.position, w.look, ...(this.exit ? [this.exit.door] : [])]) v.sub(this.origin).multiplyScalar(r).add(this.origin);
        this.speed.multiplyScalar(r);
      }
      this.k = k;
      it.anchor.scale.setScalar(k);
      it.anchor.position.copy(this.base).sub(this.origin).multiplyScalar(k).add(this.origin);
      if (this.at >= 1 && this.goal === 1) { this.reset(); return; }
    }
    const b = this.bounds(it);
    w.reach = { x0: b.cx - b.w / 2 - 4, x1: b.cx + b.w / 2 + 4, z0: b.cz - b.d / 2 - 4, z1: b.cz + b.d / 2 + 4, top: Math.max(15, b.h + 2) };
    // Fully grown: the guide begins, unless you are already on your way somewhere.
    if (this.mode === 'off' && this.goal > 1 && this.at > 0.15 && !this.exit) {
      this.mode = 'arrive';
      this.arrive = { time: 0, angle: Math.atan2(w.pos.x - it.anchor.position.x, w.pos.z - it.anchor.position.z) };
      this.speed.copy(w.vel);
      const { f, s, u } = w.input();
      if (f || s || u) this.pause();
    }
    // Your blob is not drawn while the camera is within it.
    w.mesh.material.visible = w.dist > 0.6;
    if (this.mode === 'free' && !this.pathFull && this.spreadAmt >= 1) this.buildPath();
    if (this.mode === 'free') {
      w.dist += (Math.max(w.dist, BEHIND) - w.dist) * damp(1.2, dt); // flying free, you see yourself again
      this.rejoin(w);
    }
  }
}
