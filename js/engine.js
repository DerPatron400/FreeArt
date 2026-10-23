// Renderer, camera, post-processing and the frame loop.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';

// Draws layer 1 (blobs, built lines, exhibits) after the bloom, into the same
// buffer and against the same depth, so it is crisp, never glows, and still
// hides behind what stands in front of it.
class LayerPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene; this.camera = camera; this.needsSwap = false;
  }
  render(renderer, writeBuffer, readBuffer) {
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.camera.layers.set(1);
    renderer.render(this.scene, this.camera);
    this.camera.layers.set(0);
    renderer.autoClear = auto;
  }
}
import { easeInOutCubic } from './util.js';

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    // Sharpness follows the machine: start at the screen's own density (at most 2),
    // step down while frames run slow, step back up when there is room again.
    this.maxRatio = Math.min(window.devicePixelRatio, 2);
    this.ratio = this.maxRatio;
    this.renderer.setPixelRatio(this.ratio);
    this.frameMs = 16.7;
    this.slowFor = 0; this.fastFor = 0;
    // three.js encodes the clear colour for the screen even when the composer
    // renders into a linear target, so pre-linearise it once more.
    this.renderer.setClearColor(0x000000, 1); // the space the city stands in: black

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
    this.camera.position.set(0, 7, 24);

    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.045, enablePan: false, rotateSpeed: 0.45, zoomSpeed: 0.6 });

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.75, 0.7, 0.12);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new LayerPass(this.scene, this.camera));
    this.composer.addPass(new OutputPass());

    this.pointer = new THREE.Vector2(-10, -10);
    this.raycaster = new THREE.Raycaster();
    this.updaters = new Set();
    this.viewOffset = [0, 0];
    this.flight = null;
    this.manual = false; // true while something else (the walker) drives the camera
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

  // 'map' walks the city (drag pans along the ground), 'orbit' turns around a world.
  setMode(mode) {
    const c = this.controls;
    const { MOUSE, TOUCH } = THREE;
    if (mode === 'map') {
      // Negative pan speed: dragging moves you the way you drag, like steering, not like grabbing paper.
      Object.assign(c, { enablePan: true, screenSpacePanning: false, panSpeed: -1.2 });
      c.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
      c.touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE };
    } else {
      Object.assign(c, { enablePan: false, maxPolarAngle: Math.PI, panSpeed: 1 });
      c.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
      c.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    }
  }

  // arc: instead of a straight line, swing round the target, the distance, the tilt and the
  // heading each easing from where the camera is to where it goes (turn adds extra heading,
  // in radians, so the view visibly turns on the way). onStep(k) hears the eased progress.
  flyTo(position, target, duration = 2.4, { arc = false, turn = 0, onStep = null } = {}) {
    return new Promise((resolve) => {
      const f = {
        from: this.camera.position.clone(), to: position.clone(),
        fromT: this.controls.target.clone(), toT: target.clone(),
        t: 0, duration, resolve, onStep,
      };
      if (arc) {
        const a = new THREE.Spherical().setFromVector3(f.from.clone().sub(f.fromT));
        const b = new THREE.Spherical().setFromVector3(f.to.clone().sub(f.toT));
        let dTheta = b.theta - a.theta;
        dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta)) + turn;
        f.arc = { a, b, dTheta, s: new THREE.Spherical(), off: new THREE.Vector3() };
      }
      this.flight = f;
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

  adapt(dt) {
    if (document.hidden || dt <= 0 || dt >= 0.05) return; // ignore pauses and tab switches
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    this.slowFor = this.frameMs > 24 ? this.slowFor + dt : 0;
    this.fastFor = this.frameMs < 14 ? this.fastFor + dt : 0;
    let next = this.ratio;
    if (this.slowFor > 1.5) next = Math.max(0.6, this.ratio - 0.25);
    else if (this.fastFor > 6) next = Math.min(this.maxRatio, this.ratio + 0.25);
    if (next === this.ratio) return;
    this.ratio = next;
    this.slowFor = this.fastFor = 0;
    this.renderer.setPixelRatio(next);
    this.composer.setPixelRatio?.(next);
    this.resize();
  }

  start() {
    const tick = () => {
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = this.clock.elapsedTime;
      if (this.flight) {
        const f = this.flight;
        f.t = Math.min(1, f.t + dt / f.duration);
        const k = easeInOutCubic(f.t);
        this.controls.target.lerpVectors(f.fromT, f.toT, k);
        if (f.arc) {
          const { a, b, s, off } = f.arc;
          // Distance shrinks evenly in scale; the tilt comes on later, so it starts straight down.
          s.radius = a.radius * Math.pow(b.radius / a.radius, k);
          s.phi = a.phi + (b.phi - a.phi) * (k * k * (3 - 2 * k));
          s.theta = b.theta - f.arc.dTheta * (1 - k);
          this.camera.position.copy(this.controls.target).add(off.setFromSpherical(s));
        } else this.camera.position.lerpVectors(f.from, f.to, k);
        f.onStep?.(k);
        if (f.t >= 1) { this.flight = null; this.controls.enabled = true; f.resolve(); }
      }
      for (const u of this.updaters) u(t, dt);
      if (this.flight) this.camera.lookAt(this.controls.target);
      else if (!this.manual) this.controls.update();
      this.composer.render();
      this.adapt(dt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
