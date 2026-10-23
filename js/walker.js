// The visitor: a soft, morphing blob that glides freely through the city, can
// take you on a slow flight over every world, and shares the air with others.
import * as THREE from 'three';
import { NOISE } from './form.js';
import { clamp, el, roman } from './util.js';
import { t } from './i18n.js';

const RADIUS = 0.11;
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uWobble;
uniform float uSquash;
uniform vec3 uVel;
varying vec3 vNormal;
varying vec3 vView;
${NOISE}
void main() {
  vec3 n = normalize(position);
  vec3 p = position;
  // Living surface: slow breathing plus a faster shiver that grows with motion.
  float w = snoise(n * 1.1 + vec3(uTime * 0.4)) * (0.035 + uWobble * 0.06);
  p += n * w * 1.0;
  // Squash and stretch, roughly keeping its volume.
  p.y *= 1.0 + uSquash;
  p.xz *= 1.0 - uSquash * 0.5;
  // Drag: the back trails behind, the front flattens a little.
  float sp = length(uVel);
  if (sp > 0.001) {
    vec3 d = uVel / sp;
    float k = dot(n, d);
    p -= d * max(-k, 0.0) * min(sp * 0.03, 0.3) * 1.0;
    p -= d * max(k, 0.0) * min(sp * 0.012, 0.12) * 1.0;
  }
  vec4 world = modelMatrix * vec4(p, 1.0);
  vNormal = normalize(mat3(modelMatrix) * n);
  vView = cameraPosition - world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uCore;
uniform vec3 uTint;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vView);
  float fr = pow(1.0 - max(dot(N, V), 0.0), 2.4);
  float light = 0.55 + 0.45 * max(dot(N, normalize(vec3(0.3, 1.0, 0.4))), 0.0);
  // Matte off-white with a soft rim; drawn after the bloom pass, so it never glows.
  vec3 col = mix(uCore, uTint, 0.6) * (0.28 + 0.42 * light) + uTint * fr * 0.12;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export const BLOB_LAYER = 1; // rendered outside the bloom (see Engine)

// One blob: unit geometry scaled to size, with its own uniforms.
const blobGeometry = new THREE.IcosahedronGeometry(1, 20);
export function makeBlob(radius, tint) {
  const uniforms = {
    uTime: { value: 0 }, uWobble: { value: 0 }, uSquash: { value: 0 }, uVel: { value: new THREE.Vector3() },
    uCore: { value: new THREE.Color('#ece4d4') }, uTint: { value: new THREE.Color(tint) },
  };
  const mesh = new THREE.Mesh(blobGeometry, new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader }));
  mesh.scale.setScalar(radius);
  mesh.layers.set(BLOB_LAYER);
  mesh.userData.uniforms = uniforms;
  return mesh;
}

export class Walker {
  constructor(engine, city, geo) {
    this.engine = engine;
    this.city = city;
    this.geo = geo; // { EXTENT, plotAt(x, z) }
    this.active = false;
    this.mode = 'walk'; // 'walk' | 'tour'
    this.pos = new THREE.Vector3(0, 0, 3);
    this.vel = new THREE.Vector3();
    this.squash = 0;
    this.squashVel = 0;
    this.yaw = 0;
    this.pitch = 0.3;
    this.dist = 3.2;
    this.look = new THREE.Vector3();
    this.joy = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
    this.tint = new THREE.Color('#c9a46a');

    this.mesh = makeBlob(RADIUS, '#fff6e6');
    this.uniforms = this.mesh.userData.uniforms;
    this.mesh.visible = false;
    city.group.add(this.mesh);

    this.caption = el('div', 'tour-caption');
    this.caption.hidden = true;
    document.body.append(this.caption);

    this.coarse = matchMedia('(pointer: coarse)').matches;
    this.vert = 0; // -1 down, 1 up, from the on-screen buttons
    this.held = 0; // seconds of steady movement, for gentle speeding up
    this.buildHelp();
    this.bindInput();
  }

  bindInput() {
    const canvas = this.engine.canvas;
    const coarse = matchMedia('(pointer: coarse)').matches;
    let last = null;
    const up = (e) => {
      if (e.pointerId === this.joy.id) Object.assign(this.joy, { id: null, x: 0, y: 0 });
      if (last && e.pointerId === last.id) last = null;
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      if (this.mode === 'tour') { this.stopTour(); return; }
      this.city.hall?.pause(); // touching the view takes over from the guide in a plot
      // On touch screens the left half is a joystick, the right half turns the view.
      if (coarse && e.clientX < window.innerWidth * 0.45) {
        Object.assign(this.joy, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
        return;
      }
      last = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('pointermove', (e) => {
      if (!this.active) return;
      // A release we never heard about (outside the window, a menu): stop dragging the view.
      if (e.pointerType === 'mouse' && e.buttons === 0) { up(e); return; }
      if (e.pointerId === this.joy.id) {
        this.joy.x = clamp((e.clientX - this.joy.ox) / 60, -1, 1);
        this.joy.y = clamp((e.clientY - this.joy.oy) / 60, -1, 1);
      } else if (last && e.pointerId === last.id) {
        this.yaw -= (e.clientX - last.x) * 0.006;
        this.pitch = clamp(this.pitch + (e.clientY - last.y) * 0.004, -1.25, 1.4);
        last.x = e.clientX; last.y = e.clientY;
      }
    });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    window.addEventListener('blur', () => { last = null; Object.assign(this.joy, { id: null, x: 0, y: 0 }); });
    canvas.addEventListener('wheel', (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.dist = clamp(this.dist * (1 + e.deltaY * 0.001), 1.0, 16);
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (!this.active || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (this.mode === 'tour' && e.key !== 'Shift') { this.stopTour(); return; }
      if (e.code === 'Space' || e.key.startsWith('Arrow')) e.preventDefault();
    });
  }

  // How to move, always one tap away, and up/down buttons on touch screens.
  buildHelp() {
    const key = (k) => el('kbd', null, k);
    const row = (keys, text) => { const r = el('div', 'move-help__row'); r.append(...keys, el('span', null, text)); return r; };
    const help = el('div', 'move-help');
    const body = el('div', 'move-help__body');
    if (this.coarse) {
      body.append(
        row([el('b', null, t('move.leftThumb'))], t('move.move')),
        row([el('b', null, t('move.rightThumb'))], t('move.look')),
        row([key('▲'), key('▼')], t('move.upDown')),
        row([el('b', null, t('move.tapPlot'))], t('move.chooseIt')),
      );
    } else {
      body.append(
        row(t('key.wasd').split(' ').map(key), t('move.wasd')),
        row([key(t('key.space'))], t('move.up')),
        row([key(t('key.shift'))], t('move.down')),
        row([el('b', null, t('move.scroll'))], t('move.zoom')),
        row([el('b', null, t('move.drag'))], t('move.look')),
        row([key('E')], t('move.enter')),
      );
    }
    // Folding the card away sits at the end of its last row; folded, the title alone opens it.
    const toggle = el('button', 'move-help__toggle');
    toggle.type = 'button';
    const icon = Object.assign(document.createElement('img'), { src: 'img/collapse.svg', width: 28, height: 28, alt: '' });
    toggle.append(icon);
    body.lastElementChild.append(toggle);
    const title = el('button', 'move-help__title', t('move.title'));
    title.type = 'button';
    const set = (open) => {
      help.classList.toggle('is-open', open);
      toggle.setAttribute('aria-label', t('move.hide'));
      title.setAttribute('aria-expanded', String(open));
      try { localStorage.setItem('freeart.help', open ? '1' : '0'); } catch {}
    };
    toggle.addEventListener('click', () => set(false));
    title.addEventListener('click', () => set(!help.classList.contains('is-open')));
    let open = true;
    try { open = localStorage.getItem('freeart.help') !== '0'; } catch {}
    help.append(title, body);
    set(open);
    help.hidden = true;
    this.help = help;

    const pad = el('div', 'move-pad');
    for (const [label, dir] of [['▲', 1], ['▼', -1]]) {
      const b = el('button', null, label);
      b.type = 'button';
      b.setAttribute('aria-label', dir > 0 ? t('move.up') : t('move.down'));
      const stop = () => { if (this.vert === dir) this.vert = 0; };
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.vert = dir; });
      b.addEventListener('pointerup', stop);
      b.addEventListener('pointercancel', stop);
      b.addEventListener('pointerleave', stop);
      pad.append(b);
    }
    pad.hidden = true;
    this.pad = pad;
    document.body.append(help, pad);
  }

  showHelp(on) {
    if (this.helpOn === on) return;
    this.helpOn = on;
    this.help.hidden = !on;
    this.pad.hidden = !on || !this.coarse;
  }

  // Where the chase camera wants to be for the current state.
  cameraGoal(out) {
    const d = this.dist, p = this.pitch;
    const lift = 0.2 * Math.min(1, d); // close in (the hall's guide looks through your eyes), no lift
    return out.set(Math.sin(this.yaw) * Math.cos(p) * d, Math.sin(p) * d + lift, Math.cos(this.yaw) * Math.cos(p) * d).add(this.pos);
  }

  place(x, z, yaw = this.yaw, y = this.pos.y || 1.6) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
  }

  activate() {
    this.active = true;
    this.mesh.visible = true;
    this.engine.manual = true;
    this.engine.controls.enabled = false;
    this.look.copy(this.pos).add(new THREE.Vector3(0, 0.35, 0));
  }

  deactivate() {
    this.active = false;
    this.stopTour(true);
    this.engine.manual = false;
    this.engine.controls.enabled = true;
  }

  hide() {
    this.deactivate();
    this.mesh.visible = false;
  }

  // The world the blob is passing, if any (for tour captions).
  updateTint() {
    let best = null, bestD = 9;
    for (const it of this.city.items) {
      const d = Math.hypot(it.anchor.position.x - this.pos.x, it.anchor.position.z - this.pos.z);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best && bestD < 4.5 ? best : null;
  }

  // The usual flying controls: WASD or arrows move level with the ground,
  // Space rises, Shift sinks (on touch: a thumb stick and two buttons).
  input() {
    const k = this.city.keys;
    const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0) - this.joy.y;
    const s = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0) + this.joy.x;
    const u = (k.has(' ') ? 1 : 0) - (k.has('shift') ? 1 : 0) + this.vert;
    return { f: clamp(f, -1, 1), s: clamp(s, -1, 1), u: clamp(u, -1, 1) };
  }

  // Free flight: no gravity, no collisions, just smooth easing in every direction.
  walk(dt) {
    const { f, s, u } = this.input();
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const want = fwd.multiplyScalar(f).addScaledVector(right, s);
    if (want.lengthSq() > 1) want.normalize();
    // Holding a direction for a while speeds up gently, for crossing the city.
    this.held = f || s ? Math.min(this.held + dt, 4) : 0;
    want.multiplyScalar(6 + Math.max(0, this.held - 1.5) * 3);
    want.y = u * 4;
    this.vel.lerp(want, damp(want.lengthSq() ? 4 : 3, dt));

    const lim = this.geo.EXTENT + 6, r = this.reach; // reach: wider bounds while in a grown plot
    this.pos.addScaledVector(this.vel, dt);
    this.pos.x = clamp(this.pos.x, Math.min(-lim, r?.x0 ?? -lim), Math.max(lim, r?.x1 ?? lim));
    this.pos.z = clamp(this.pos.z, Math.min(-lim, r?.z0 ?? -lim), Math.max(lim, r?.z1 ?? lim));
    this.pos.y = clamp(this.pos.y, 0.3, r?.top ?? 15);
  }

  spring(dt) {
    // Stretch while rising fast, squash on impact, then wobble back to round.
    // Changes of speed squash and stretch the blob, then it wobbles back to round.
    const accel = this.vel.length() - (this.lastSpeed ?? 0);
    this.lastSpeed = this.vel.length();
    const target = clamp(accel * 0.6, -0.2, 0.2);
    const acc = -140 * (this.squash - target) - 7 * this.squashVel;
    this.squashVel += acc * dt;
    this.squash += this.squashVel * dt;
    this.squash = clamp(this.squash, -0.45, 0.45);
  }

  // A slow flight that passes over every world already built, then lands at the piazza.
  startTour() {
    const items = this.city.items.slice();
    if (!items.length) return false;
    const pts = [this.pos.clone()];
    let cur = this.pos.clone();
    const order = [];
    while (items.length) {
      items.sort((a, b) => a.anchor.position.distanceTo(cur) - b.anchor.position.distanceTo(cur));
      const it = items.shift();
      order.push(it);
      cur = it.anchor.position.clone();
    }
    let prev = pts[0];
    for (const it of order) {
      const c = it.anchor.position;
      const dir = c.clone().sub(prev).setY(0);
      if (dir.lengthSq() < 0.01) dir.set(0, 0, -1);
      dir.normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(1.2);
      const top = it.plot.h;
      pts.push(c.clone().addScaledVector(dir, -4.5).add(side).setY(top + 1.6));
      pts.push(c.clone().setY(top + 2.6));
      pts.push(c.clone().addScaledVector(dir, 4.5).sub(side).setY(top + 1.6));
      prev = c;
    }
    pts.push(new THREE.Vector3(0, 3, 5), new THREE.Vector3(0, 1.6, 3));
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.tourLen = this.curve.getLength();
    this.tourT = 0;
    this.tourSpeed = 0;
    this.mode = 'tour';
    return true;
  }

  stopTour(silent = false) {
    if (this.mode !== 'tour') return;
    this.mode = 'walk';
    this.caption.hidden = true;
    this.vel.multiplyScalar(0.3);
    if (!silent) this.city.setMode('walk');
  }

  tour(dt) {
    // Ease in, cruise, ease out.
    const remaining = (1 - this.tourT) * this.tourLen;
    const cruise = Math.min(6.5, Math.max(1.2, remaining * 0.9));
    this.tourSpeed += (cruise - this.tourSpeed) * damp(1.2, dt);
    const prev = this.pos.clone();
    this.tourT = Math.min(1, this.tourT + (this.tourSpeed * dt) / this.tourLen);
    this.curve.getPointAt(this.tourT, this.pos);
    this.vel.copy(this.pos).sub(prev).divideScalar(Math.max(dt, 1e-4));
    const tan = this.curve.getTangentAt(this.tourT);
    const goalYaw = Math.atan2(-tan.x, -tan.z);
    let dy = goalYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * damp(1.6, dt);
    this.pitch += (0.62 - this.pitch) * damp(1, dt);
    this.dist += (5.5 - this.dist) * damp(1, dt);
    if (this.tourT >= 1) this.stopTour();
  }

  showCaption(it) {
    if (this.mode !== 'tour' || !it) { this.caption.classList.remove('is-on'); return; }
    if (this.captionFor !== it) {
      this.captionFor = it;
      this.caption.replaceChildren(el('span', 'mono', 'Plot ' + roman(it.plot.n)), el('b', null, it.world.title), el('span', 'mono', it.world.creator.name));
    }
    this.caption.hidden = false;
    this.caption.classList.add('is-on');
  }

  update(t, dt) {
    this.showHelp(this.active && this.mode === 'walk' && this.mesh.visible && !this.engine.flight);
    if (!this.mesh.visible) return;
    this.uniforms.uTime.value = t;
    if (this.active && !this.engine.flight) {
      if (this.mode === 'tour') this.tour(dt);
      else {
        // In a grown plot the guide may be steering; any move of yours takes over.
        const { f, s, u } = this.input();
        if (!this.city.hall?.drive(dt, !!(f || s || u))) this.walk(dt);
      }
    }
    this.spring(dt);
    const speed = this.vel.length();
    this.uniforms.uWobble.value += (Math.min(speed / 10, 1) - this.uniforms.uWobble.value) * damp(3, dt);
    this.uniforms.uSquash.value = this.squash;
    this.uniforms.uVel.value.lerp(this.vel, damp(10, dt));
    this.mesh.position.copy(this.pos);
    this.mesh.position.y += Math.sin(t * 1.3) * 0.06;
    const near = this.updateTint(dt);
    this.showCaption(near);

    if (this.active && !this.engine.flight) {
      const cam = this.engine.camera;
      // The camera never goes under the ground: there it stays low and tilts up instead,
      // still looking along the direction it would have looked at the blob.
      const goal = this.cameraGoal(new THREE.Vector3());
      const focus = this.pos.clone().add(new THREE.Vector3(0, 0.12 * Math.min(1, this.dist), 0));
      const dir = focus.clone().sub(goal).normalize();
      goal.y = Math.max(goal.y, 0.3);
      cam.position.lerp(goal, damp(this.mode === 'tour' ? 2 : 7, dt));
      if (cam.position.y < 0.3) cam.position.y = 0.3;
      const lookGoal = goal.clone().addScaledVector(dir, Math.max(this.dist, focus.distanceTo(goal), 2)).addScaledVector(this.vel, 0.08);
      this.look.lerp(lookGoal, damp(7, dt));
      cam.lookAt(this.look);
      this.engine.controls.target.copy(this.look);
    }
  }
}

// Other visitors: blobs that drift from world to world, circling each for a while.
const VISITOR_TINTS = ['#ffffff', '#fbf3e4', '#f4efe6', '#fff8ec', '#ece6dc'];

export class Visitors {
  constructor(city, count) {
    this.city = city;
    this.list = Array.from({ length: count }, (_, i) => {
      const mesh = makeBlob(0.045 + Math.random() * 0.035, VISITOR_TINTS[i % VISITOR_TINTS.length]);
      city.group.add(mesh);
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 20;
      return {
        mesh, pos: new THREE.Vector3(Math.cos(a) * r, 1 + Math.random() * 4, Math.sin(a) * r), vel: new THREE.Vector3(),
        target: null, until: 0, angle: Math.random() * 6.28, dir: Math.random() < 0.5 ? -1 : 1, speed: 0.9 + Math.random() * 0.8,
        squash: 0, squashVel: 0, lastSpeed: 0, phase: Math.random() * 10,
      };
    });
  }

  pick(v, t) {
    const items = this.city.items;
    // Visit a world (or, in an empty city, a random plot), avoiding the one just seen.
    const options = items.length ? items.filter((it) => it !== v.target) : [];
    // Mostly look at art, sometimes just wander the streets.
    v.target = options.length && Math.random() < 0.6 ? options[Math.floor(Math.random() * options.length)] : null;
    v.free = v.target ? null : new THREE.Vector3((Math.random() - 0.5) * 60, 0.8 + Math.random() * 3, (Math.random() - 0.5) * 60);
    v.until = t + 8 + Math.random() * 10;
  }

  update(t, dt) {
    for (const v of this.list) {
      if (!v.target && !v.free || t > v.until || (v.target && !this.city.items.includes(v.target))) this.pick(v, t);
      const goal = new THREE.Vector3();
      if (v.target) {
        const p = v.target.plot;
        v.angle += dt * 0.22 * v.dir;
        const R = Math.max(p.w, p.d) * 0.55 + 1.1;
        goal.set(p.cx + Math.cos(v.angle) * R, p.h * 0.55 + Math.sin(t * 0.4 + v.phase) * 0.5, p.cz + Math.sin(v.angle) * R);
      } else goal.copy(v.free);
      const want = goal.sub(v.pos);
      const dist = want.length();
      want.multiplyScalar(Math.min(v.speed, dist * 0.6) / Math.max(dist, 1e-4));
      // Keep a polite distance from you and from the lens.
      for (const [o, r] of [[this.city.walker.pos, 1.6], [this.city.engine.camera.position, 2.6]]) {
        const away = v.pos.clone().sub(o);
        const d = away.length();
        if (d < r) want.addScaledVector(away.normalize(), (r - d) * 4);
      }
      v.vel.lerp(want, 1 - Math.exp(-1.1 * dt));
      v.pos.addScaledVector(v.vel, dt);

      const sp = v.vel.length();
      const acc = -140 * (v.squash - clamp((sp - v.lastSpeed) * 0.6, -0.2, 0.2)) - 7 * v.squashVel;
      v.lastSpeed = sp;
      v.squashVel += acc * dt;
      v.squash = clamp(v.squash + v.squashVel * dt, -0.4, 0.4);
      const u = v.mesh.userData.uniforms;
      u.uTime.value = t + v.phase;
      u.uSquash.value = v.squash;
      u.uVel.value.lerp(v.vel, 1 - Math.exp(-8 * dt));
      u.uWobble.value += (Math.min(sp / 6, 1) - u.uWobble.value) * (1 - Math.exp(-3 * dt));
      v.mesh.position.copy(v.pos);
    }
  }
}
