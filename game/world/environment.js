// @ts-check
/**
 * 远景与天光：傍晚金色时刻（2026-10-21 定，目标图 素材/概念图）的天空、太阳、云海、远山剪影。
 * 太阳低（约 14°），在镜头右前方：天边向阳一侧金橙、背阳一侧淡紫灰，云海迎光的坡镀金边，影子拉长。
 * 只搭镜头里看得见的那一面；远处只要轮廓和雾。
 */
import * as THREE from 'three';
import { rng } from '../fx/common.js';

export const SUN_DIR = new THREE.Vector3(0.55, 0.242, -0.8).normalize();
const ZENITH = new THREE.Color(0.16, 0.27, 0.5);
const HORIZON_SUN = new THREE.Color(1.0, 0.5, 0.2);
const HORIZON_AWAY = new THREE.Color(0.45, 0.42, 0.55);
const SUN_COLOR = new THREE.Color(1.0, 0.66, 0.36);
/** 天空在材质上的反光强度（环境贴图），压暗时一起降 */
const ENV_I = 0.35;

// 压暗世界（大招时）：天空、云海、雾、灯一起变暗变灰，发光的法术不受灯光影响、照样亮——参考里"特效是全场最亮的东西"
// 着色器与 JS 用同一个公式（dimColor），天边与雾的颜色才接得上
const DIM_GLSL = `vec3 dimColor(vec3 c, float k){ float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); return mix(c, vec3(l), 0.6 * k) * (1. - 0.8 * k) + vec3(0.0, 0.004, 0.02) * k; }`;
/** @param {THREE.Color} out @param {THREE.Color} c @param {number} k */
function dimColor(out, c, k) {
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, s = 0.6 * k, f = 1 - 0.8 * k;
  return out.setRGB((c.r + (l - c.r) * s) * f, (c.g + (l - c.g) * s) * f + 0.004 * k, (c.b + (l - c.b) * s) * f + 0.02 * k);
}
// 某个水平方向上的天边颜色：越朝太阳越金。天空、云海远处、雾用同一个公式（horizonAt），三者在天边接得上
const HORIZON_GLSL = `vec3 horizonAt(vec3 d){ vec2 a = d.xz / max(length(d.xz), 1e-4); vec2 s = normalize(uSun.xz);
  float t = dot(a, s) * 0.5 + 0.5; return mix(uHorizonAway, uHorizonSun, t * t); }`;
/** @param {THREE.Color} out @param {number} dx @param {number} dz */
function horizonAt(out, dx, dz) {
  const l = Math.hypot(dx, dz) || 1e-4, sl = Math.hypot(SUN_DIR.x, SUN_DIR.z);
  const t = ((dx * SUN_DIR.x + dz * SUN_DIR.z) / (l * sl)) * 0.5 + 0.5;
  return out.copy(HORIZON_AWAY).lerp(HORIZON_SUN, t * t);
}
const SKY_UNIFORMS = () => ({ uHorizonSun: { value: HORIZON_SUN }, uHorizonAway: { value: HORIZON_AWAY }, uSun: { value: SUN_DIR }, uSunCol: { value: SUN_COLOR }, uDim: { value: 0 } });
const CLOUD_SHADE = new THREE.Color(0.28, 0.3, 0.42), CLOUD_BODY = new THREE.Color(0.72, 0.56, 0.38);   // 阴影偏红会发粉（实测），压低红
/** 调画面用的一组数：灯的基准强度、着色器共用的颜色对象。改了下一帧生效（雾色要再调一次 aim） */
const LOOK = { hemi: 0.45, sun: 5.0, env: ENV_I,
  colors: { zenith: ZENITH, horizonSun: HORIZON_SUN, horizonAway: HORIZON_AWAY, sun: SUN_COLOR, cloudShade: CLOUD_SHADE, cloudBody: CLOUD_BODY } };

/** @param {THREE.Scene} scene @param {THREE.WebGLRenderer} [renderer] 给了就用天空做一张环境贴图，石头、青铜才有天光反射 */
export function buildEnvironment(scene, renderer) {
  const fogBase = horizonAt(new THREE.Color(), -0.27, -0.96);   // 镜头大致朝向的天边色，aim() 会按实际机位改
  scene.background = fogBase.clone();
  scene.fog = new THREE.FogExp2(fogBase.getHex(), 0.005);

  // 天空：天边按方向从金橙过渡到淡紫灰、往上变成偏暗的蓝；太阳一圈大光晕（太阳本身在画面右上角外面，光晕进画）
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { ...SKY_UNIFORMS(), uTop: { value: ZENITH } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 uTop; uniform vec3 uHorizonSun; uniform vec3 uHorizonAway; uniform vec3 uSun; uniform vec3 uSunCol; uniform float uDim;
      ${DIM_GLSL}
      ${HORIZON_GLSL}
      void main(){ vec3 d = normalize(vDir); float h = clamp(d.y, 0., 1.);
        vec3 c = mix(horizonAt(d), uTop, pow(h, 0.6));
        float s = max(dot(d, uSun), 0.);
        c += uSunCol * (pow(s, 1200.) * 8. + pow(s, 64.) * 0.6 + pow(s, 8.) * 0.3 + pow(s, 3.) * 0.15) * (1. - uDim);
        gl_FragColor = vec4(dimColor(c, uDim), 1.); }`,
  });
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), skyMat);
  skyMesh.renderOrder = -10;
  scene.add(skyMesh);
  if (renderer) {
    // 只拿天空拍一张环境贴图：不压暗时的样子；压暗由 environmentIntensity 跟着降
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(skyMesh.geometry, skyMat));
    scene.environment = pm.fromScene(envScene, 0, 0.1, 1000).texture;   // far 默认 100，天空球半径 600 会被裁掉
    scene.environmentIntensity = LOOK.env;
    pm.dispose();
  }

  // 天光 + 太阳（灯的数量固定，只改强度）：受光面暖、背光面偏冷蓝，冷暖对比靠这两盏灯
  const hemi = new THREE.HemisphereLight(0x9fb3d9, 0x8a6a4e, LOOK.hemi);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffbd80, LOOK.sun);
  sun.position.copy(SUN_DIR).multiplyScalar(40);
  sun.target.position.set(0, 0, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 5, far: 90 });
  sun.shadow.camera.updateProjectionMatrix();       // 改了范围必须调，否则阴影只在中间一小块
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;                     // 太阳低，光线斜着扫地面，偏移小了地上会起条纹
  scene.add(sun, sun.target);

  const clouds = buildCloudSea(scene);
  buildDistantPeaks(scene);
  const bg = /** @type {THREE.Color} */ (scene.background), fog = /** @type {THREE.FogExp2} */ (scene.fog);
  let dimK = 0;
  /** 压暗世界：k = 0 正常，1 最暗（灯降到约三成、天空云海变暗变灰） @param {number} k */
  const setDim = (k) => {
    dimK = k;
    hemi.intensity = LOOK.hemi * (1 - 0.7 * k);
    sun.intensity = LOOK.sun * (1 - 0.8 * k);
    scene.environmentIntensity = LOOK.env * (1 - 0.8 * k);
    skyMat.uniforms.uDim.value = k;
    clouds.uniforms.uDim.value = k;
    dimColor(bg, fogBase, k);
    fog.color.copy(bg);
  };
  /** 机位定了以后调：雾取镜头朝向那一段天边的颜色 @param {THREE.Vector3} dir 镜头看的方向 */
  const aim = (dir) => { horizonAt(fogBase, dir.x, dir.z); setDim(dimK); };
  /** 阴影贴图大小（画质档定）@param {number} size */
  const setShadowMap = (size) => { sun.shadow.mapSize.set(size, size); };
  return { sun, hemi, clouds, setDim, setShadowMap, aim, look: LOOK };
}

/** 云海：两层流动的噪声当起伏；朝太阳挪一点再取一次，差值大于零就是迎光坡，镀金边；远处融进天边色 */
function buildCloudSea(scene) {
  const mat = new THREE.ShaderMaterial({
    fog: false,
    uniforms: { uTime: { value: 0 }, ...SKY_UNIFORMS(), uShade: { value: CLOUD_SHADE }, uBody: { value: CLOUD_BODY } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vW; uniform float uTime; uniform vec3 uHorizonSun; uniform vec3 uHorizonAway; uniform vec3 uSun; uniform vec3 uSunCol; uniform float uDim; uniform vec3 uShade; uniform vec3 uBody;
      ${DIM_GLSL}
      ${HORIZON_GLSL}
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
        return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y); }
      float fbm(vec2 p){ float v = 0., a = 0.5; for (int k = 0; k < 5; k++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main(){
        vec2 p = vW.xz * 0.035;
        vec2 drift = vec2(uTime * 0.012, uTime * 0.006);
        float n = fbm(p + drift);
        float m = fbm(p * 1.9 - vec2(uTime * 0.02, 0.) + n);
        float top = smoothstep(0.25, 0.85, n * 0.6 + m * 0.6);
        // 往太阳方向挪一点：那边更低，说明这里是朝着太阳的坡
        float lit = clamp((n - fbm(p + drift + normalize(uSun.xz) * 0.06)) * 9. + 0.5, 0., 1.);
        vec3 c = mix(uShade, uBody, top);
        c = mix(c, uSunCol * 1.15, smoothstep(0.45, 0.9, lit) * top * 0.8);
        vec3 v = normalize(vW - cameraPosition);
        // 朝太阳那一大片云面泛金光
        c += uSunCol * pow(max(dot(v.xz / max(length(v.xz), 1e-4), normalize(uSun.xz)), 0.), 6.) * 0.25;   // 不用 normalize：镜头正下方 xz 为零会出 NaN，泛光把它放大成黑块
        float dist = length(vW.xz - cameraPosition.xz);
        c = mix(c, horizonAt(v), smoothstep(60., 420., dist));
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
  const mat = new THREE.MeshStandardMaterial({ color: 0x55606e, roughness: 1, flatShading: true });
  const specs = [];
  for (let i = 0; i < 16; i++) {
    const a = -Math.PI * 0.95 + (i / 15) * Math.PI * 0.9 + (R() - 0.5) * 0.12;   // 镜头前方的半圈
    const d = 70 + R() * 120, h = 26 + R() * 50, r = 10 + R() * 18;
    specs.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, h, r });
  }
  const sunAz = Math.atan2(SUN_DIR.z, SUN_DIR.x);
  for (const s of specs) {
    // 太阳那一侧留空：天边的光晕要露出来（先照旧抽完随机数再跳过，其余山的位置不变）
    if (Math.abs(Math.atan2(Math.sin(Math.atan2(s.z, s.x) - sunAz), Math.cos(Math.atan2(s.z, s.x) - sunAz))) < 0.35) continue;
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
