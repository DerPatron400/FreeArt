// Inside a world: the full form at the centre, its fragments in orbit.
import * as THREE from 'three';
import { createForm, disposeForm, updateFormLook } from './form.js';
import { roman, el, rng, lerp } from './util.js';

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
  }

  show(world, { preview = false } = {}) {
    this.preview = preview;
    this.setWorld(world, { rebuild: true });
    this.group.visible = true;
    const e = this.engine;
    Object.assign(e.controls, { minDistance: 3.2, maxDistance: 16, autoRotate: true, autoRotateSpeed: preview ? 0.5 : 0.25 });
    // Keep the form clear of the text: beside it on wide screens, above it on phones.
    const w = window.innerWidth, h = window.innerHeight;
    const narrow = w <= 760;
    if (narrow) e.setViewOffset(0, preview ? h * 0.29 : h * 0.16);
    else e.setViewOffset(preview ? Math.min(460, w) / 2 : w > 1100 ? 140 : 0, 0);
    if (!preview || !this.shownOnce) {
      const dist = narrow ? 10.5 : 7.2;
      e.camera.position.set(0, 1.2, dist * 2);
      e.controls.target.set(0, 0, 0);
      e.flyTo(new THREE.Vector3(0, dist * 0.15, dist), new THREE.Vector3(0, 0, 0), 3.2);
    }
    this.shownOnce = preview;
  }

  hide() {
    this.group.visible = false;
    this.closeFragment();
    this.clearFragments();
    disposeForm(this.form);
    this.form = null;
    this.world = null;
    this.shownOnce = false;
    this.engine.setViewOffset(0);
  }

  // Apply a (possibly edited) world. Shape changes rebuild the particles;
  // colour and energy changes only touch uniforms.
  setWorld(world, { rebuild = false } = {}) {
    const prev = this.world;
    this.world = world;
    const shapeChanged = !prev || rebuild || prev.form.type !== world.form.type || prev.form.density !== world.form.density || prev.id !== world.id;
    if (shapeChanged) {
      const reveal = this.form && !rebuild ? 0.35 : 0;
      disposeForm(this.form);
      this.form = createForm(world);
      this.form.scale.setScalar(1.55);
      if (world.form.type === 'spiral') this.form.rotation.x = 0.45;
      this.form.userData.uniforms.uReveal.value = reveal;
      this.group.add(this.form);
    } else {
      updateFormLook(this.form, world);
    }
    const fragKey = JSON.stringify(world.fragments.map((f) => f.title)) + world.palette.join();
    if (shapeChanged || fragKey !== this.fragKey) {
      this.fragKey = fragKey;
      this.buildFragments();
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
    if (this.group.visible) this.engine.controls.autoRotate = true;
  }

  update(t, dt) {
    if (!this.group.visible || !this.form) return;
    const u = this.form.userData.uniforms;
    u.uTime.value = t;
    u.uReveal.value = Math.min(1, u.uReveal.value + dt / 4.5);
    this.form.rotation.y += dt * 0.03;
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
