// The ground is still dark water: slow, low swells, and in them a soft, blurred
// reflection of the city's lines and its art. Planar reflection as in three.js's Reflector, with its own
// shader, and with the line layer (blobs, builds) included in the reflection.
import * as THREE from 'three';

// Wave field shared by both shaders: a few long travelling swells and finer chop.
// Returns height in .x and its gradient in .yz.
const WAVES = /* glsl */ `
vec3 waves(vec2 p, float t) {
  vec3 h = vec3(0.0);
  #define W(dx, dy, k, a, w) { vec2 d = normalize(vec2(dx, dy)); float ph = dot(d, p) * k + t * w; h.x += a * sin(ph); h.yz += a * k * d * cos(ph); }
  W( 1.0,  0.3, 0.16, 0.55, 0.55)
  W(-0.4,  1.0, 0.22, 0.38, 0.62)
  W( 0.7, -0.8, 0.31, 0.22, 0.81)
  W( 0.2,  1.0, 0.58, 0.10, 1.25)
  W(-1.0, -0.2, 0.83, 0.06, 1.55)
  W( 0.9,  0.6, 1.35, 0.035, 2.10)
  W(-0.5,  0.9, 2.10, 0.02, 2.70)
  #ifdef FINE
  W( 0.3, -1.0, 3.40, 0.012, 3.4)
  W(-0.8, -0.6, 5.10, 0.008, 4.1)
  #endif
  return h;
}`;

const vertexShader = /* glsl */ `
uniform mat4 textureMatrix;
uniform float uTime;
uniform float uAmp;
varying vec4 vUv;
varying vec3 vWorld;
${WAVES}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec3 h = waves(w.xz, uTime);
  w.y += h.x * uAmp; // the swell itself, kept low so the ground stays calm
  vUv = textureMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const fragmentShader = /* glsl */ `
#define FINE
uniform sampler2D tReflect;
uniform float uTime;
uniform float uAmp;
uniform vec3 uDeep;
uniform vec3 uCrest;
uniform vec3 uFog;
uniform vec2 uTexel;
uniform float uFade;
varying vec4 vUv;
varying vec3 vWorld;
${WAVES}
void main() {
  vec3 h = waves(vWorld.xz, uTime);
  // Seen from above: the surface normal points up, tilted by the slopes.
  vec3 N = normalize(vec3(-h.y * uAmp, 1.0, -h.z * uAmp));
  vec3 V = normalize(cameraPosition - vWorld);
  float facing = max(dot(N, V), 0.0);
  float fresnel = 0.12 + 0.88 * pow(1.0 - facing, 4.0);

  // The city, softly: the reflection bends with the waves and is blurred wide.
  vec2 uv = vUv.xy / vUv.w + N.xz * 0.06;
  vec3 refl = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 16; i++) {
    float a = float(i) * 2.39996, r = sqrt(float(i) + 0.5) * 6.0;
    vec2 o = vec2(cos(a), sin(a)) * r * uTexel;
    float wgt = 1.0 - float(i) / 18.0;
    refl += texture(tReflect, uv + o, 2.5).rgb * wgt; // from a smaller mip: soft, like light through water
    wsum += wgt;
  }
  refl /= wsum;

  // Body of the water: darker in the troughs, lighter on the faces of the swell.
  float lit = clamp(dot(N, normalize(vec3(0.35, 1.0, 0.25))) * 0.5 + 0.5, 0.0, 1.0);
  float crest = smoothstep(0.35, 0.95, h.x);
  vec3 body = mix(uDeep * 0.5, uDeep * 1.8, pow(lit, 3.0)) + uCrest * crest * 0.025;
  // A faint glint where the slope catches the city's light.
  vec3 R = reflect(-V, N);
  float glint = pow(max(dot(R, normalize(vec3(-0.2, 1.0, 0.1))), 0.0), 80.0);

  vec3 col = body + refl * (0.35 + 0.65 * fresnel) * 0.85 + uCrest * glint * 0.18;
  float d = length(vWorld.xz - cameraPosition.xz);
  // Fade fully into the background well before the edge, so the water has no border.
  float fade = exp(-d * 0.014) * (1.0 - smoothstep(110.0, 220.0, d));
  gl_FragColor = vec4(mix(uFog, col, fade * uFade), 1.0);
}`;

export function createOcean(renderer, { height = -0.4, size = 600, resolution = 0.3, amp = 0.25 } = {}) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 0, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const textureMatrix = new THREE.Matrix4();
  const uniforms = {
    tReflect: { value: target.texture }, textureMatrix: { value: textureMatrix }, uTime: { value: 0 }, uAmp: { value: amp },
    uDeep: { value: new THREE.Color('#030303').convertSRGBToLinear() },
    uCrest: { value: new THREE.Color('#8f9a96').convertSRGBToLinear() },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uFog: { value: new THREE.Color(0x000000) },
    uFade: { value: 1 }, // 0: gone into the dark
  };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 240, 240), new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader }));
  mesh.rotation.x = -Math.PI / 2; // faces up
  mesh.position.y = height;
  mesh.userData.uniforms = uniforms;

  const virtualCamera = new THREE.PerspectiveCamera();
  virtualCamera.layers.enable(1);
  const plane = new THREE.Plane(), normal = new THREE.Vector3(), mirror = new THREE.Vector3(), camPos = new THREE.Vector3();
  const rot = new THREE.Matrix4(), look = new THREE.Vector3(), view = new THREE.Vector3(), tgt = new THREE.Vector3();
  const clip = new THREE.Vector4(), q = new THREE.Vector4(), size2 = new THREE.Vector2();

  mesh.onBeforeRender = (r, scene, camera) => {
    r.getDrawingBufferSize(size2);
    const w = Math.max(1, Math.round(size2.x * resolution)), h = Math.max(1, Math.round(size2.y * resolution));
    if (target.width !== w || target.height !== h) { target.setSize(w, h); uniforms.uTexel.value.set(1 / w, 1 / h); }

    mirror.setFromMatrixPosition(mesh.matrixWorld);
    camPos.setFromMatrixPosition(camera.matrixWorld);
    rot.extractRotation(mesh.matrixWorld);
    normal.set(0, 0, 1).applyMatrix4(rot);
    view.subVectors(mirror, camPos);
    if (view.dot(normal) > 0) return; // looking at its back
    view.reflect(normal).negate().add(mirror);
    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    tgt.subVectors(mirror, look).reflect(normal).negate().add(mirror);

    virtualCamera.position.copy(view);
    virtualCamera.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    virtualCamera.lookAt(tgt);
    virtualCamera.far = camera.far;
    virtualCamera.updateMatrixWorld();
    virtualCamera.projectionMatrix.copy(camera.projectionMatrix);

    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    textureMatrix.multiply(virtualCamera.projectionMatrix).multiply(virtualCamera.matrixWorldInverse).multiply(mesh.matrixWorld);

    // Oblique near plane: clip everything on the far side of the mirror.
    plane.setFromNormalAndCoplanarPoint(normal, mirror).applyMatrix4(virtualCamera.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const e = virtualCamera.projectionMatrix.elements;
    q.set((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1; e[14] = clip.w;

    mesh.visible = false;
    const prev = r.getRenderTarget(), prevAuto = r.autoClear;
    r.setRenderTarget(target);
    r.state.buffers.depth.setMask(true);
    r.autoClear = true;
    // Thinner fog in the reflection, so the city reads clearly in the water.
    const fogDensity = scene.fog?.density;
    if (fogDensity) scene.fog.density = fogDensity * 0.45;
    r.render(scene, virtualCamera);
    if (fogDensity) scene.fog.density = fogDensity;
    r.autoClear = prevAuto;
    r.setRenderTarget(prev);
    const vp = camera.viewport;
    if (vp !== undefined) r.state.viewport(vp);
    mesh.visible = true;
  };
  return mesh;
}
