// Renderer, camera, post-processing and the frame loop.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { easeInOutCubic } from './util.js';

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // three.js encodes the clear colour for the screen even when the composer
    // renders into a linear target, so pre-linearise it once more.
    this.renderer.setClearColor(new THREE.Color(0x0b0a09).convertSRGBToLinear(), 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
    this.camera.position.set(0, 7, 24);

    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.045, enablePan: false, rotateSpeed: 0.45, zoomSpeed: 0.6 });

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.75, 0.7, 0.12);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.pointer = new THREE.Vector2(-10, -10);
    this.raycaster = new THREE.Raycaster();
    this.updaters = new Set();
    this.viewOffset = [0, 0];
    this.flight = null;
    this.clock = new THREE.Clock();

    canvas.addEventListener('pointermove', (e) => {
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    });
    // Distinguish a click from the end of a drag.
    this.dragDistance = 0;
    canvas.addEventListener('pointerdown', (e) => { this.down = [e.clientX, e.clientY]; this.dragDistance = 0; });
    canvas.addEventListener('pointerup', (e) => {
      if (this.down) this.dragDistance = Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]);
    });
    canvas.addEventListener('pointerleave', () => this.pointer.set(-10, -10));
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.applyViewOffset();
  }

  // Slide the picture (in pixels: +x right, +y up) so content can sit beside a panel.
  setViewOffset(x = 0, y = 0) {
    this.viewOffset = [x, y];
    this.applyViewOffset();
  }

  applyViewOffset() {
    const w = window.innerWidth, h = window.innerHeight;
    const [x, y] = this.viewOffset;
    if (x || y) this.camera.setViewOffset(w, h, -x, y, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  flyTo(position, target, duration = 2.4) {
    return new Promise((resolve) => {
      this.flight = {
        from: this.camera.position.clone(), to: position.clone(),
        fromT: this.controls.target.clone(), toT: target.clone(),
        t: 0, duration, resolve,
      };
      this.controls.enabled = false;
    });
  }

  pick(objects) {
    if (this.pointer.x < -2) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(objects, false)[0] || null;
  }

  project(v3, out) {
    const v = v3.clone().project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    out.visible = v.z < 1;
    return out;
  }

  start() {
    const tick = () => {
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = this.clock.elapsedTime;
      if (this.flight) {
        const f = this.flight;
        f.t = Math.min(1, f.t + dt / f.duration);
        const k = easeInOutCubic(f.t);
        this.camera.position.lerpVectors(f.from, f.to, k);
        this.controls.target.lerpVectors(f.fromT, f.toT, k);
        if (f.t >= 1) { this.flight = null; this.controls.enabled = true; f.resolve(); }
      }
      for (const u of this.updaters) u(t, dt);
      if (this.flight) this.camera.lookAt(this.controls.target);
      else this.controls.update();
      this.composer.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
