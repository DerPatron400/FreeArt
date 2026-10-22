// A small turntable for 3D work inside a panel: a glTF model, or a sculpture
// built from the plot pieces. It renders only while its canvas is on the page.
import * as THREE from 'three';
import { createBuild } from './build.js';
import { t } from './i18n.js';

export class MiniViewer {
  constructor(canvas, { url, build, palette }) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.yaw = 0.6; this.pitch = 0.35; this.spin = true;
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x1a1410, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(3, 5, 4);
    this.scene.add(sun);

    if (build) this.fit(createBuild(build, palette, 1, { opacity: 0.9 }), true);
    if (url) this.load(url);
    this.bind();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  async load(url) {
    try {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(url);
      this.fit(gltf.scene);
    } catch (e) {
      this.canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'mono media__error', textContent: t('media.badModel') }));
      this.dispose();
    }
  }

  fit(obj, lines = false) {
    if (lines) obj.traverse((o) => o.layers.set(0)); // the panel has no bloom pass
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z) || 1;
    obj.position.sub(center);
    this.pivot.add(obj);
    this.dist = r * 1.9;
  }

  bind() {
    let last = null;
    this.canvas.addEventListener('pointerdown', (e) => { last = [e.clientX, e.clientY]; this.spin = false; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!last || e.buttons === 0) { last = null; return; }
      this.yaw -= (e.clientX - last[0]) * 0.01;
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + (e.clientY - last[1]) * 0.01));
      last = [e.clientX, e.clientY];
    });
    this.canvas.addEventListener('pointerup', () => { last = null; });
  }

  loop() {
    if (!this.canvas.isConnected) return this.dispose();
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w && h && (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()))) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (this.spin) this.yaw += 0.004;
    const d = this.dist || 3;
    this.camera.position.set(Math.sin(this.yaw) * Math.cos(this.pitch) * d, Math.sin(this.pitch) * d, Math.cos(this.yaw) * Math.cos(this.pitch) * d);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.scene.traverse((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
