// The sky is an ocean seen from below: rolling swells, and in them a soft,
// blurred reflection of the city's lines and its art. Planar reflection as in three.js's Reflector, with its own
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
varying vec4 vUv;
varying vec3 vWorld;
${WAVES}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec3 h = waves(w.xz, uTime);
  w.y += h.x; // the swell itself, so crests stand out against the distance
  vUv = textureMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const fragmentShader = /* glsl */ `
#define FINE
uniform sampler2D tReflect;
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uCrest;
uniform vec3 uFog;
uniform vec2 uTexel;
varying vec4 vUv;
varying vec3 vWorld;
${WAVES}
void main() {
  vec3 h = waves(vWorld.xz, uTime);
  // Seen from below: the surface normal points down, tilted by the slopes.
  vec3 N = normalize(vec3(h.y, -1.0, h.z));
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
  float lit = clamp(dot(N, normalize(vec3(0.35, -1.0, 0.25))) * 0.5 + 0.5, 0.0, 1.0);
  float crest = smoothstep(0.35, 0.95, h.x);
  vec3 body = mix(uDeep * 0.5, uDeep * 1.8, pow(lit, 3.0)) + uCrest * crest * 0.025;
  // A faint glint where the slope catches the city's light.
  vec3 R = reflect(-V, N);
  float glint = pow(max(dot(R, normalize(vec3(-0.2, -1.0, 0.1))), 0.0), 80.0);

  vec3 col = body + refl * (0.35 + 0.65 * fresnel) * 0.85 + uCrest * glint * 0.18;
  float d = length(vWorld.xz - cameraPosition.xz);
  // Fade fully into the background well before the edge, so the water has no border.
  float fade = exp(-d * 0.014) * (1.0 - smoothstep(110.0, 220.0, d));
  gl_FragColor = vec4(mix(uFog, col, fade), 1.0);
}`;

export function createOcean(renderer, { height = 24, size = 600, resolution = 0.3 } = {}) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 0, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const textureMatrix = new THREE.Matrix4();
  const uniforms = {
    tReflect: { value: target.texture }, textureMatrix: { value: textureMatrix }, uTime: { value: 0 },
    uDeep: { value: new THREE.Color('#0b0a09').convertSRGBToLinear() },
    uCrest: { value: new THREE.Color('#8f9a96').convertSRGBToLinear() },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uFog: { value: new THREE.Color(0x0b0a09).convertSRGBToLinear() },
  };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 240, 240), new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader }));
  mesh.rotation.x = Math.PI / 2; // faces down
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

// The same water standing on the four sides, so the city lies in the ocean all round.
// The walls carry the swell and its light but no mirror of their own: one reflection
// pass (the sky) is enough, and the sides read as deep water fading into the dark.
const wallVertex = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying vec2 vP;
${WAVES}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  // Waves run along the wall (x) and up it (y), in the wall's own plane.
  vP = vec2(position.x, position.y * 1.6);
  vec3 h = waves(vP, uTime);
  vec3 p = position + vec3(0.0, 0.0, -h.x * 0.6); // bulging softly outward and back
  w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const wallFragment = /* glsl */ `
#define FINE
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uCrest;
uniform vec3 uFog;
uniform float uTop;
varying vec3 vWorld;
varying vec2 vP;
${WAVES}
void main() {
  vec3 h = waves(vP, uTime);
  vec3 N = normalize(vec3(-h.y, -h.z, 1.0)); // in the wall's frame, facing the city
  float lit = clamp(dot(N, normalize(vec3(0.3, 0.8, 0.5))) * 0.5 + 0.5, 0.0, 1.0);
  float crest = smoothstep(0.35, 0.95, h.x);
  // The walls have no mirror, so they carry a little more of the water's own light.
  vec3 body = mix(uDeep * 0.7, uDeep * 2.6 + uCrest * 0.035, pow(lit, 2.0)) + uCrest * crest * 0.07;
  float glint = pow(max(dot(reflect(vec3(0.0, 0.0, -1.0), N), normalize(vec3(-0.2, 0.9, 0.3))), 0.0), 40.0);
  vec3 col = body + uCrest * glint * 0.3;
  // Lighter towards the surface above, darker towards the depths below.
  col *= mix(0.55, 1.15, smoothstep(0.0, uTop, vWorld.y));
  float d = length(vWorld - cameraPosition);
  float fade = exp(-d * 0.014) * (1.0 - smoothstep(110.0, 220.0, d));
  gl_FragColor = vec4(mix(uFog, col, fade), 1.0);
}`;

export function createOceanWalls(sky, { reach, height = 18, depth = 6 }) {
  const u = sky.userData.uniforms;
  const uniforms = { uTime: u.uTime, uDeep: u.uDeep, uCrest: u.uCrest, uFog: u.uFog, uTop: { value: height } };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: wallVertex, fragmentShader: wallFragment });
  const group = new THREE.Group();
  const tall = height + depth, long = reach * 2 + 40;
  const geometry = new THREE.PlaneGeometry(long, tall, 200, 40);
  geometry.translate(0, tall / 2 - depth, 0);
  for (let i = 0; i < 4; i++) {
    const wall = new THREE.Mesh(geometry, material);
    const a = (i * Math.PI) / 2;
    wall.position.set(-Math.sin(a) * reach, 0, -Math.cos(a) * reach);
    wall.rotation.y = a; // each faces the centre
    group.add(wall);
  }
  return group;
}
