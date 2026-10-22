// @ts-check
/**
 * 远景与天光：白天的天空、太阳、云海、远山剪影。
 * 只搭镜头里看得见的那一面；远处只要轮廓和雾。
 */
import * as THREE from 'three';
import { rng } from '../fx/common.js';

export const HORIZON = new THREE.Color(0.84, 0.9, 0.96);
const ZENITH = new THREE.Color(0.3, 0.52, 0.84);
export const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();

// 压暗世界（大招时）：天空、云海、雾、灯一起变暗变灰，发光的法术不受灯光影响、照样亮——参考里"特效是全场最亮的东西"
// 着色器与 JS 用同一个公式（dimColor），天边与雾的颜色才接得上
const DIM_GLSL = `vec3 dimColor(vec3 c, float k){ float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); return mix(c, vec3(l), 0.6 * k) * (1. - 0.8 * k) + vec3(0.0, 0.004, 0.02) * k; }`;
/** @param {THREE.Color} out @param {THREE.Color} c @param {number} k */
function dimColor(out, c, k) {
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, s = 0.6 * k, f = 1 - 0.8 * k;
  return out.setRGB((c.r + (l - c.r) * s) * f, (c.g + (l - c.g) * s) * f + 0.004 * k, (c.b + (l - c.b) * s) * f + 0.02 * k);
}

/** @param {THREE.Scene} scene */
export function buildEnvironment(scene) {
  scene.background = HORIZON.clone();
  scene.fog = new THREE.FogExp2(HORIZON.getHex(), 0.0062);

  // 天空：地平线发白、天顶偏蓝，太阳附近一圈光晕
  const skyMesh = new THREE.Mesh(
    new THREE.SphereGeometry(600, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: ZENITH }, uHorizon: { value: HORIZON }, uSun: { value: SUN_DIR }, uDim: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `varying vec3 vDir; uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; uniform float uDim;
        ${DIM_GLSL}
        void main(){ vec3 d = normalize(vDir); float h = clamp(d.y, 0., 1.);
          vec3 c = mix(uHorizon, uTop, pow(h, 0.5));
          float s = max(dot(d, uSun), 0.);
          c += vec3(1., 0.95, 0.82) * (pow(s, 600.) * 2.5 + pow(s, 12.) * 0.18) * (1. - uDim);
          gl_FragColor = vec4(dimColor(c, uDim), 1.); }`,
    }),
  );
  skyMesh.renderOrder = -10;
  scene.add(skyMesh);

  // 天光 + 太阳（灯的数量固定，只改强度）
  const hemi = new THREE.HemisphereLight(0xd7e8ff, 0x7d7262, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.7);
  sun.position.copy(SUN_DIR).multiplyScalar(40);
  sun.target.position.set(0, 0, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 5, far: 90 });
  sun.shadow.camera.updateProjectionMatrix();       // 改了范围必须调，否则阴影只在中间一小块
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const clouds = buildCloudSea(scene);
  buildDistantPeaks(scene);
  const sky = /** @type {THREE.ShaderMaterial} */ (skyMesh.material);
  const bg = /** @type {THREE.Color} */ (scene.background), fog = /** @type {THREE.FogExp2} */ (scene.fog);
  /** 压暗世界：k = 0 正常，1 最暗（灯降到约三成、天空云海变暗变灰） @param {number} k */
  const setDim = (k) => {
    hemi.intensity = 1.15 * (1 - 0.7 * k);
    sun.intensity = 2.7 * (1 - 0.8 * k);
    sky.uniforms.uDim.value = k;
    clouds.uniforms.uDim.value = k;
    dimColor(bg, HORIZON, k);
    fog.color.copy(bg);
  };
  /** 阴影贴图大小（画质档定）@param {number} size */
  const setShadowMap = (size) => { sun.shadow.mapSize.set(size, size); };
  return { sun, clouds, setDim, setShadowMap };
}

/** 云海：一大片流动的噪声，远处融进地平线色 */
function buildCloudSea(scene) {
  const mat = new THREE.ShaderMaterial({
    fog: false,
    uniforms: { uTime: { value: 0 }, uHorizon: { value: HORIZON }, uSun: { value: SUN_DIR }, uDim: { value: 0 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vW; uniform float uTime; uniform vec3 uHorizon; uniform vec3 uSun; uniform float uDim;
      ${DIM_GLSL}
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
        return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y); }
      float fbm(vec2 p){ float v = 0., a = 0.5; for (int k = 0; k < 5; k++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main(){
        vec2 p = vW.xz * 0.035;
        float n = fbm(p + vec2(uTime * 0.012, uTime * 0.006));
        float m = fbm(p * 1.9 - vec2(uTime * 0.02, 0.) + n);
        float lit = smoothstep(0.25, 0.85, n * 0.6 + m * 0.6);
        vec3 shade = vec3(0.6, 0.68, 0.8), light = vec3(1.0, 0.99, 0.97);
        vec3 c = mix(shade, light, lit);
        c += vec3(1., 0.95, 0.85) * pow(max(dot(normalize(vec3(-vW.x, 30., -vW.z)), uSun), 0.), 8.) * 0.12;
        float dist = length(vW.xz - cameraPosition.xz);
        c = mix(c, uHorizon, smoothstep(60., 420., dist));
        gl_FragColor = vec4(dimColor(c, uDim), 1.); }`,
  });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), mat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -9;
  scene.add(sea);
  return mat;
}

/** 远山：几座有棱角的锥体立在云海里，雾把它们推远；主要放在镜头前方 */
function buildDistantPeaks(scene) {
  const R = rng(41);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8796a8, roughness: 1, flatShading: true });
  const specs = [];
  for (let i = 0; i < 16; i++) {
    const a = -Math.PI * 0.95 + (i / 15) * Math.PI * 0.9 + (R() - 0.5) * 0.12;   // 镜头前方的半圈
    const d = 70 + R() * 120, h = 26 + R() * 50, r = 10 + R() * 18;
    specs.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, h, r });
  }
  for (const s of specs) {
    const g = new THREE.ConeGeometry(s.r, s.h + 30, 7, 4);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < (s.h + 30) / 2 - 0.01) {
        p.setX(i, p.getX(i) * (0.8 + R() * 0.45));
        p.setZ(i, p.getZ(i) * (0.8 + R() * 0.45));
        p.setY(i, y + (R() - 0.5) * 4);
      }
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.position.set(s.x, (s.h + 30) / 2 - 30, s.z);
    m.rotation.y = R() * Math.PI;
    scene.add(m);
  }
}
