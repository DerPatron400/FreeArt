// The cosmos: every world floating in shared space, waiting to be entered.
import * as THREE from 'three';
import { createForm, disposeForm } from './form.js';
import { roman, el, lerp } from './util.js';

const NATURE = { human: 'human', machine: 'machine', together: 'human + machine' };

// Worlds sit on concentric rings: 5 on the first, then 9, 13, ...
function ringSlot(i, total) {
  let ring = 0, start = 0, cap = 5;
  while (i >= start + cap) { start += cap; ring++; cap += 4; }
  const count = Math.min(cap, total - start);
  return { a: ((i - start) / count) * Math.PI * 2 + ring * 0.5, rad: 6.5 + ring * 5.5 };
}

export class Cosmos {
  constructor(engine, labelsRoot, onEnter) {
    this.engine = engine;
    this.labelsRoot = labelsRoot;
    this.onEnter = onEnter;
    this.group = new THREE.Group();
    this.items = [];
    this.active = false;
    this.hovered = null;
    engine.scene.add(this.group);
    engine.updaters.add((t, dt) => this.update(t, dt));
    engine.canvas.addEventListener('click', () => {
      if (this.active && this.hovered && !engine.flight && engine.dragDistance < 6) this.enter(this.hovered);
    });
  }

  setWorlds(worlds) {
    for (const it of this.items) { disposeForm(it.form); it.label.remove(); }
    this.group.clear();
    this.items = worlds.map((world, i) => {
      const { a, rad } = ringSlot(i, worlds.length);
      const anchor = new THREE.Group();
      anchor.position.set(Math.cos(a) * rad, Math.sin(i * 1.7) * 1.6, Math.sin(a) * rad);
      const form = createForm(world, { lod: 0.1, size: 0.6 });
      form.scale.setScalar(1.05);
      form.rotation.y = i;
      anchor.add(form);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData.index = i;
      anchor.add(hit);
      this.group.add(anchor);

      const label = el('button', 'label');
      label.append(el('span', 'label__num mono', roman(i + 1)), el('span', 'label__title', world.title),
        el('span', 'label__by mono', `${world.creator.name} · ${NATURE[world.creator.nature]}`));
      label.addEventListener('click', () => this.enter(this.items[i]));
      label.addEventListener('pointerenter', () => { this.labelHover = this.items[i]; });
      label.addEventListener('pointerleave', () => { this.labelHover = null; });
      label.hidden = true;
      this.labelsRoot.append(label);
      return { world, index: i, anchor, form, hit, label, hover: 0, screen: {} };
    });
  }

  radius() {
    return this.items.reduce((m, it) => Math.max(m, it.anchor.position.length()), 6);
  }

  async show({ fromWorld } = {}) {
    this.active = true;
    this.group.visible = true;
    const e = this.engine;
    e.setViewOffset(0);
    const r = this.radius();
    Object.assign(e.controls, { minDistance: 6, maxDistance: r * 3.2, autoRotate: true, autoRotateSpeed: 0.18 });
    for (const it of this.items) it.label.hidden = false;
    const target = new THREE.Vector3(0, 0, 0);
    const pos = new THREE.Vector3(0, r * 1.5, r * 2.2);
    if (fromWorld) {
      // Start just outside the world we came from and drift back out.
      const it = this.items.find((x) => x.world.id === fromWorld);
      if (it) {
        e.camera.position.copy(it.anchor.position).add(new THREE.Vector3(0, 0.6, 3));
        e.controls.target.copy(it.anchor.position);
      }
    }
    for (const it of this.items) it.form.userData.uniforms.uReveal.value = fromWorld ? 1 : 0;
    this.revealStart = performance.now();
    await e.flyTo(pos, target, fromWorld ? 2.6 : 3.6);
  }

  hide() {
    this.active = false;
    this.group.visible = false;
    this.hovered = null;
    this.engine.controls.autoRotate = false;
    document.body.style.cursor = '';
    for (const it of this.items) it.label.hidden = true;
  }

  async enter(it) {
    if (!this.active) return;
    this.active = false;
    for (const x of this.items) x.label.hidden = true;
    const p = it.anchor.position;
    const dir = p.clone().sub(this.engine.camera.position).normalize();
    await this.engine.flyTo(p.clone().sub(dir.multiplyScalar(1.2)), p.clone(), 1.8);
    this.onEnter(it.world);
  }

  update(t, dt) {
    if (!this.group.visible) return;
    const e = this.engine;
    let hovered = this.labelHover || null;
    if (this.active && !e.flight && !hovered) {
      const hit = e.pick(this.items.map((i) => i.hit));
      hovered = hit ? this.items[hit.object.userData.index] : null;
    }
    if (hovered !== this.hovered) {
      this.hovered = hovered;
      document.body.style.cursor = hovered ? 'pointer' : '';
    }
    const reveal = this.revealStart ? Math.min(1, (performance.now() - this.revealStart) / 4000) : 1;
    for (const it of this.items) {
      const u = it.form.userData.uniforms;
      u.uTime.value = t;
      u.uReveal.value = Math.max(u.uReveal.value, reveal);
      it.hover = lerp(it.hover, it === this.hovered ? 1 : 0, 1 - Math.pow(0.001, dt));
      u.uHover.value = it.hover;
      it.form.rotation.y += dt * 0.05;
      it.anchor.position.y += Math.sin(t * 0.3 + it.index) * dt * 0.05;

      if (!it.label.hidden) {
        const s = e.project(it.anchor.position.clone().add(new THREE.Vector3(1.4, 0.3, 0)), it.screen);
        const dist = e.camera.position.distanceTo(it.anchor.position);
        const scale = Math.max(0.55, Math.min(1, 14 / dist));
        it.label.style.transform = `translate(${s.x}px, ${s.y}px) translateY(-50%) scale(${scale})`;
        it.label.style.visibility = s.visible ? 'visible' : 'hidden';
        it.label.classList.toggle('is-hover', it === this.hovered);
        it.label.style.opacity = this.hovered && it !== this.hovered ? 0.35 : 1;
      }
    }
  }
}
