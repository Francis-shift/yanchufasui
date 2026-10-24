// @ts-check
/**
 * 远景与天光：傍晚金色时刻（2026-10-21 定，目标图 素材/概念图）的天空、太阳、云海、远处的石峰与楼阁。
 * 太阳低（约 14°），在镜头右前方：天边向阳一侧金橙、背阳一侧淡紫灰，云海迎光的坡镀金边，影子拉长。
 * 入侵进程（风格卡"入侵进程"，程度由 invasion.js 按波次算）：紫黑的雾从石阶下方和索桥那一侧（镜头左前方）漫上来，
 * 云海染黑、雾墙往天上卷、雾里打紫色闪电，被盖住的楼阁起火冒烟；越往后越往太阳那边吞，最后一波只剩太阳那一道光缝。
 * 只搭镜头里看得见的那一面；远处只要轮廓和雾。
 */
import * as THREE from 'three';
import { clamp01, rng } from '../fx/common.js';

export const SUN_DIR = new THREE.Vector3(0.55, 0.242, -0.8).normalize();
const ZENITH = new THREE.Color(0.16, 0.27, 0.5);
const HORIZON_SUN = new THREE.Color(1.0, 0.5, 0.2);
const HORIZON_AWAY = new THREE.Color(0.45, 0.42, 0.55);
const SUN_COLOR = new THREE.Color(1.0, 0.66, 0.36);
/** 天空在材质上的反光强度（环境贴图），压暗时一起降 */
const ENV_I = 0.35;
const CLOUD_SHADE = new THREE.Color(0.28, 0.3, 0.42), CLOUD_BODY = new THREE.Color(0.72, 0.56, 0.38);   // 阴影偏红会发粉（实测），压低红
/** 远山的石头：受光面、背光面 */
const ROCK = new THREE.Color(0.62, 0.5, 0.4), ROCK_SHADE = new THREE.Color(0.11, 0.12, 0.16);
/** 石峰顶上的松树（远看只是一层深绿） */
const PINE = new THREE.Color(0.16, 0.24, 0.1);
/** 黑雾从哪个水平方向来：索桥那一侧偏石阶（镜头左前方，约 -145°） */
export const INV_DIR = new THREE.Vector2(Math.cos(-2.53), Math.sin(-2.53));
/** 云海从哪里先黑：石阶下方 */
const INV_ORIGIN = new THREE.Vector2(-5, -30);
/** 黑雾的颜色：最深处、翻起来的团块、边缘和闪电照亮时的紫光（紫色只给敌人，风格卡"敌我配色"） */
const INV_DEEP = new THREE.Color(0.03, 0.022, 0.05), INV_LIT = new THREE.Color(0.09, 0.066, 0.12), INV_GLOW = new THREE.Color(0.6, 0.25, 1.0);
/** 镜头（横屏）看的水平方向，远山围着它摆 */
const VIEW_AZ = -1.84;   // 竖屏镜头约 -1.92，差不多
const SEA_Y = -9;

/** 调画面用的一组数：灯的基准强度、着色器共用的颜色对象。改了下一帧生效（雾色要再调一次 aim） */
const LOOK = { hemi: 0.45, sun: 5.0, env: ENV_I,
  colors: { zenith: ZENITH, horizonSun: HORIZON_SUN, horizonAway: HORIZON_AWAY, sun: SUN_COLOR, cloudShade: CLOUD_SHADE, cloudBody: CLOUD_BODY,
    rock: ROCK, rockShade: ROCK_SHADE, pine: PINE, invDeep: INV_DEEP, invLit: INV_LIT, invGlow: INV_GLOW } };

/**
 * 黑雾盖到离来路方向多少弧度：程度 k 从 k0 到 k0 + span，盖住的角度从 from 涨到 from + grow；
 * edge 是边缘的过渡宽度，slant 让越高的地方越晚盖到。着色器和 JS（invMaskAt）都按这一组数算
 */
const REACH = { k0: 0.2, span: 0.66, from: -0.2, grow: 1.65, edge: 0.14, slant: 0.3 };
const f1 = (x) => x.toFixed(4);

// ---------------------------------------------------------------- 着色器共用的一段
// 天空、云海、远山、雾墙都用同一套公式（天边色、黑雾盖到哪），几样东西在天边接得上；JS 里有同样的一份（算雾色、灯）
const COMMON_GLSL = `
uniform vec3 uHorizonSun; uniform vec3 uHorizonAway; uniform vec3 uSun; uniform vec3 uSunCol;
uniform float uDim; uniform float uTime; uniform float uInv; uniform float uFlash; uniform vec3 uFlashDir;
uniform vec2 uInvDir; uniform vec3 uInvDeep; uniform vec3 uInvLit; uniform vec3 uInvGlow;
// 压暗世界（大招时）：变暗变灰，发光的法术不受灯光影响、照样亮
vec3 dimColor(vec3 c, float k){ float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); return mix(c, vec3(l), 0.6 * k) * (1. - 0.8 * k) + vec3(0.0, 0.004, 0.02) * k; }
// 某个水平方向上的天边颜色：越朝太阳越金
vec3 horizonAt(vec3 d){ vec2 a = d.xz / max(length(d.xz), 1e-4); vec2 s = normalize(uSun.xz);
  float t = dot(a, s) * 0.5 + 0.5; return mix(uHorizonAway, uHorizonSun, t * t); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y); }
float fbm(vec2 p){ float v = 0., a = 0.5; for (int k = 0; k < 5; k++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
// 黑雾盖到离来路方向多少弧度：第一波还没上天，第三波打完吞掉半边天，最后一波停在太阳左边一点，输了全盖（tests/invasion.test.mjs 核对）
float invReach(){ return ${f1(REACH.from)} + ${f1(REACH.grow)} * clamp((uInv - ${f1(REACH.k0)}) / ${f1(REACH.span)}, 0., 1.) + 3. * smoothstep(0.93, 1., uInv); }
// 方向 d 被黑雾盖住多少（0～1）；wob 是边缘的起伏（弧度）。越高的地方越晚盖到
float invMask(vec3 d, float wob){ if (uInv <= 0.001) return 0.; vec2 a = d.xz / max(length(d.xz), 1e-4);
  float A = invReach(); return 1. - smoothstep(A - ${f1(REACH.edge)}, A + ${f1(REACH.edge)}, acos(clamp(dot(a, uInvDir), -1., 1.)) + ${f1(REACH.slant)} * max(d.y, 0.) + wob); }
// 相对来路方向的角度（-π～π，接缝在镜头背后），给黑雾的噪声当横坐标
float invAngle(vec3 d){ vec2 a = d.xz / max(length(d.xz), 1e-4); return atan(a.x * uInvDir.y - a.y * uInvDir.x, dot(a, uInvDir)); }
// 带入侵的天边色：远处的云海、远山融进它
vec3 horizonInv(vec3 d){ return mix(horizonAt(d), uInvDeep * 1.6, invMask(d, 0.)); }
// 闪电照亮：离闪电方向越近越亮
float flashAt(vec3 d){ return uFlash * pow(max(dot(d, uFlashDir), 0.), 30.); }
`;

const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** @param {number} k */
const invReach = (k) => REACH.from + REACH.grow * clamp01((k - REACH.k0) / REACH.span) + 3 * sstep(0.93, 1, k);
/** 同着色器里的 invMask（不带边缘起伏）：方向 (dx, dy, dz) 在入侵程度 k 时被黑雾盖住多少（0～1）。测试用它核对各波的样子
 * @param {number} dx @param {number} dy @param {number} dz @param {number} k */
export function invMaskAt(dx, dy, dz, k) {
  if (k <= 0.001) return 0;
  const l = Math.hypot(dx, dz) || 1e-4, A = invReach(k);
  const ang = Math.acos(Math.max(-1, Math.min(1, (dx * INV_DIR.x + dz * INV_DIR.y) / l)));
  return 1 - sstep(A - REACH.edge, A + REACH.edge, ang + REACH.slant * Math.max(dy / (Math.hypot(dx, dy, dz) || 1), 0));
}
/** @param {THREE.Color} out @param {THREE.Color} c @param {number} k */
function dimColor(out, c, k) {
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, s = 0.6 * k, f = 1 - 0.8 * k;
  return out.setRGB((c.r + (l - c.r) * s) * f, (c.g + (l - c.g) * s) * f + 0.004 * k, (c.b + (l - c.b) * s) * f + 0.02 * k);
}
/** @param {THREE.Color} out @param {number} dx @param {number} dz */
function horizonAt(out, dx, dz) {
  const l = Math.hypot(dx, dz) || 1e-4, sl = Math.hypot(SUN_DIR.x, SUN_DIR.z);
  const t = ((dx * SUN_DIR.x + dz * SUN_DIR.z) / (l * sl)) * 0.5 + 0.5;
  return out.copy(HORIZON_AWAY).lerp(HORIZON_SUN, t * t);
}

/** @param {THREE.Scene} scene @param {THREE.WebGLRenderer} [renderer] 给了就用天空做一张环境贴图，石头、青铜才有天光反射 */
export function buildEnvironment(scene, renderer) {
  // 所有远景材质共用这一份（同一个对象，改一处全变）
  const U = {
    uHorizonSun: { value: HORIZON_SUN }, uHorizonAway: { value: HORIZON_AWAY }, uSun: { value: SUN_DIR }, uSunCol: { value: SUN_COLOR },
    uDim: { value: 0 }, uTime: { value: 0 }, uInv: { value: 0 }, uFlash: { value: 0 }, uFlashDir: { value: new THREE.Vector3(-0.8, 0.15, -0.6).normalize() },
    uInvDir: { value: INV_DIR }, uInvDeep: { value: INV_DEEP }, uInvLit: { value: INV_LIT }, uInvGlow: { value: INV_GLOW },
  };
  const fogBase = horizonAt(new THREE.Color(), -0.27, -0.96);   // 镜头大致朝向的天边色，aim() 会按实际机位改
  scene.background = fogBase.clone();
  scene.fog = new THREE.FogExp2(fogBase.getHex(), 0.005);

  // 天空：天边按方向从金橙过渡到淡紫灰、往上变成偏暗的蓝；太阳一圈大光晕（太阳本身在画面右上角外面，光晕进画）。
  // 入侵：来路那一侧盖上翻滚的紫黑雾，边缘一圈紫光，闪电时照亮云团；剩下的天越往后越偏红
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { ...U, uTop: { value: ZENITH } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 uTop;
      ${COMMON_GLSL}
      void main(){ vec3 d = normalize(vDir); float h = clamp(d.y, 0., 1.);
        vec3 c = mix(horizonAt(d), uTop, pow(h, 0.6));
        float s = max(dot(d, uSun), 0.);
        c += uSunCol * (pow(s, 1200.) * 8. + pow(s, 64.) * 0.6 + pow(s, 8.) * 0.3 + pow(s, 3.) * 0.15) * (1. - uDim);
        if (uInv > 0.001) {
          c *= mix(vec3(1.), vec3(1.08, 0.74, 0.6), smoothstep(0.45, 0.9, uInv));   // 剩下的天偏红：最后只剩一道红金色光缝
          vec2 uv = vec2(invAngle(d) * 2.4, d.y * 7.);
          float n = fbm(uv + vec2(uTime * 0.01, -uTime * 0.04));                 // 往上卷
          float n2 = fbm(uv * 2.3 + n * 1.6 - vec2(0., uTime * 0.07));
          float m = invMask(d, (n - 0.5) * 0.5);
          vec3 fog = mix(uInvDeep, uInvLit, smoothstep(0.35, 0.85, n2));
          fog += uInvGlow * m * (1. - m) * 4. * 0.45 * n2;                      // 边缘一圈紫光
          fog += uInvGlow * flashAt(d) * (0.4 + n2) * 0.8;
          c = mix(c, fog, m);
        }
        gl_FragColor = vec4(dimColor(c, uDim), 1.); }`,
  });
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), skyMat);
  skyMesh.renderOrder = -10;
  scene.add(skyMesh);
  if (renderer) {
    // 只拿天空拍一张环境贴图：不压暗、没入侵时的样子；压暗由 environmentIntensity 跟着降
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(skyMesh.geometry, skyMat));
    scene.environment = pm.fromScene(envScene, 0, 0.1, 1000).texture;   // far 默认 100，天空球半径 600 会被裁掉
    scene.environmentIntensity = LOOK.env;
    pm.dispose();
  }

  // 天光 + 太阳（灯的数量固定，只改强度）：受光面暖、背光面偏冷蓝，冷暖对比靠这两盏灯
  const hemi = new THREE.HemisphereLight(0x9fb3d9, 0x8a6a4e, LOOK.hemi);
  const hemiSky = hemi.color.clone(), hemiInv = new THREE.Color(0x9a8cc8);
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

  const clouds = buildCloudSea(scene, U);
  const smoke = buildFarLayer(scene, U);
  const bands = buildFogBank(scene, U);
  const bolt = buildBolt(scene);

  const bg = /** @type {THREE.Color} */ (scene.background), fog = /** @type {THREE.FogExp2} */ (scene.fog);
  const aimDir = new THREE.Vector3(-0.27, -0.3, -0.96), fogCol = new THREE.Color();
  let dimK = 0, invK = 0;
  /** 灯、雾色按压暗和入侵一起算。广场本身保持亮（看得清敌人）：入侵到最后一波太阳也只降约四分之一，输了再暗一截 */
  const apply = () => {
    const dark = 0.3 * invK + 0.45 * sstep(0.9, 1, invK);
    hemi.intensity = LOOK.hemi * (1 - 0.7 * dimK) * (1 - 0.5 * dark);
    hemi.color.copy(hemiSky).lerp(hemiInv, invK);
    sun.intensity = LOOK.sun * (1 - 0.8 * dimK) * (1 - dark);
    scene.environmentIntensity = LOOK.env * (1 - 0.8 * dimK) * (1 - 0.5 * dark);
    U.uDim.value = dimK;
    U.uInv.value = invK;
    for (const b of bands) b.visible = invK > 0.12;   // 没盖到天的时候整圈都不画，省得白算
    smoke.visible = invK > 0.28;
    horizonAt(fogBase, aimDir.x, aimDir.z);
    fogBase.lerp(fogCol.copy(INV_DEEP).multiplyScalar(1.6), invMaskAt(aimDir.x, aimDir.y, aimDir.z, invK));
    dimColor(bg, fogBase, dimK);
    fog.color.copy(bg);
  };
  /** 压暗世界：k = 0 正常，1 最暗（灯降到约三成、天空云海变暗变灰） @param {number} k */
  const setDim = (k) => { dimK = k; apply(); };
  /** 入侵程度（invasion.js 算）：0 目标图的傍晚，1 全暗 @param {number} k */
  const setInvasion = (k) => { if (k !== invK) { invK = k; apply(); } };
  /** 机位定了以后调：雾取镜头朝向那一段天边的颜色 @param {THREE.Vector3} dir 镜头看的方向 */
  const aim = (dir) => { aimDir.copy(dir); apply(); };
  /** 阴影贴图大小（画质档定）@param {number} size */
  const setShadowMap = (size) => { sun.shadow.mapSize.set(size, size); };

  // 闪电：黑雾盖住了一片天以后，隔几秒在雾里劈一道（越往后越密）
  const R = rng(77);
  let nextBolt = 2, flashT = 9;
  const strike = () => {
    const A = Math.max(0.25, Math.min(invReach(invK), 1.4));
    const az = Math.atan2(INV_DIR.y, INV_DIR.x) + 0.1 + R() * Math.max(0.1, A * 0.9 - 0.1);   // 来路方向（正好是横屏画面左沿）往里到雾的边缘：落在画面里
    const d = 120 + R() * 60;
    U.uFlashDir.value.set(Math.cos(az), 0.18, Math.sin(az)).normalize();
    bolt.strike(Math.cos(az) * d, Math.sin(az) * d, R);
    flashT = 0;
  };
  /** 每帧（游戏时间，慢放时一起变慢）：云和雾流动、闪电 @param {number} dt @param {THREE.Vector3} camPos */
  const update = (dt, camPos) => {
    U.uTime.value += dt;
    if (invK > 0.3) {
      nextBolt -= dt;
      if (nextBolt <= 0) { strike(); nextBolt = 1.2 + R() * (6 - 4 * invK); }
    }
    flashT += dt;
    // 一道闪电闪两下：亮、暗一下、再亮，然后很快熄掉
    const f = flashT < 0.07 ? 1 : flashT < 0.12 ? 0.25 : flashT < 0.2 ? 0.85 : 0.85 * Math.exp(-(flashT - 0.2) * 9);
    U.uFlash.value = f * (1 - dimK * 0.5);
    bolt.update(f, camPos);
  };
  return { sun, hemi, clouds, setDim, setInvasion, setShadowMap, aim, update, flash: strike, look: LOOK };
}

/** 云海：两层流动的噪声当起伏；朝太阳挪一点再取一次，差值大于零就是迎光坡，镀金边；远处融进天边色。
 * 入侵：从石阶下方往外染成紫黑，往太阳那边漫得慢；黑雾盖住的那片天底下，远一点的云也跟着黑 */
function buildCloudSea(scene, U) {
  const mat = new THREE.ShaderMaterial({
    fog: false,
    uniforms: { ...U, uShade: { value: CLOUD_SHADE }, uBody: { value: CLOUD_BODY }, uInvOrigin: { value: INV_ORIGIN } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vW; uniform vec3 uShade; uniform vec3 uBody; uniform vec2 uInvOrigin;
      ${COMMON_GLSL}
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
        float dist = length(vW.xz - cameraPosition.xz);
        // 朝太阳那一大片云面泛金光
        c += uSunCol * pow(max(dot(v.xz / max(length(v.xz), 1e-4), normalize(uSun.xz)), 0.), 6.) * 0.25;   // 不用 normalize：镜头正下方 xz 为零会出 NaN，泛光把它放大成黑块
        if (uInv > 0.001) {
          vec2 q = vW.xz - uInvOrigin;
          float R = 10. + 390. * pow(uInv, 1.7);
          float e = length(q) + max(dot(q, normalize(uSun.xz)), 0.) * 1.3 + (n - 0.5) * 70.;
          float inv = 1. - smoothstep(R - 30., R + 30., e);
          inv = max(inv, invMask(v, (n - 0.5) * 0.4) * smoothstep(30., 140., dist));
          vec3 dark = mix(uInvDeep, uInvLit * 0.8, top);                  // 紫黑的云，顶上带一点紫
          dark += uInvGlow * inv * (1. - inv) * 4. * 0.1 * top;           // 黑与金交界的一圈紫光
          dark += uInvGlow * flashAt(v) * top * 0.35;
          c = mix(c, dark, inv);
        }
        c = mix(c, horizonInv(v), smoothstep(60., 420., dist));
        gl_FragColor = vec4(dimColor(c, uDim), 1.); }`,
  });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), mat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = SEA_Y;
  scene.add(sea);
  return mat;
}

/** 把一块几何体摆好位置，三角形顶点接到 out 后面（远景合成一个网格，一次画完）；extra 是要一起接上的其他属性 */
function pushGeo(out, g, x, y, z, rotY = 0, extra = {}) {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.applyMatrix4(new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z));
  const p = ng.attributes.position.array;
  for (let i = 0; i < p.length; i++) out.push(p[i]);
  for (const [name, arr] of Object.entries(extra)) { const a = ng.attributes[name].array; for (let i = 0; i < a.length; i++) arr.push(a[i]); }
  return p.length / 3;
}

/**
 * 一根石柱（目标图里的石峰）：上细下粗、竖向起棱、略歪，顶上微微隆起。属性 ao：凹槽里和根部暗一点、顶上一圈是松树（着色器里染深绿）。
 * 位移只按角度、高度算（不取随机数），圆柱接缝和顶盖边上的点挪得一样，不会裂口。
 * 返回几何体和顶面中心相对底面中心挪了多少（ox、oz 是歪出去的，dome 是隆起的高度），楼阁要放在那里。
 */
function pillarGeo(R, r, h) {
  const g = new THREE.CylinderGeometry(r * (0.55 + R() * 0.25), r, h, 16, 10);
  const ph = [R() * 6.28, R() * 6.28, R() * 6.28, R() * 6.28], lx = (R() - 0.5) * 0.18, lz = (R() - 0.5) * 0.18;
  const p = g.attributes.position, ao = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = y / h + 0.5, ang = Math.atan2(z, x), rr = Math.hypot(x, z);
    const k = 1 + 0.16 * Math.sin(ang * 3 + ph[0] + t * 1.5) + 0.09 * Math.sin(ang * 7 + ph[1]) + 0.06 * Math.sin(ang * 13 + ph[3] + t * 4)
      + 0.07 * Math.sin(t * 9 + ph[2] + ang * 2);
    const top = t > 0.999, dome = top ? Math.max(0, 1 - rr / r) * h * 0.05 : 0;
    p.setXYZ(i, x * k + lx * t * t * h, y + dome, z * k + lz * t * t * h);
    ao[i * 2] = Math.min(1.2, Math.max(0.45, 0.75 + (k - 1) * 1.4)) * (0.7 + 0.3 * t);
    ao[i * 2 + 1] = top ? 0.85 : t > 0.9 ? 0.5 : 0;
  }
  g.setAttribute('ao', new THREE.BufferAttribute(ao, 2));
  return { g, ox: lx * h, oz: lz * h, dome: h * 0.05 };
}

/** 楼阁的剪影：一两层，四角攒尖顶。返回 [墙体, 屋顶] 两块 */
function hallGeo(R, w) {
  const tiers = R() < 0.5 ? 2 : 1, walls = [], roofs = [];
  let y = 0, s = w;
  for (let t = 0; t < tiers; t++) {
    const hh = s * 0.55;
    walls.push(new THREE.BoxGeometry(s, hh, s * 0.8).translate(0, y + hh / 2, 0));
    const roof = new THREE.ConeGeometry(s * 0.95, s * 0.42, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 0.85);
    roofs.push(roof.translate(0, y + hh + s * 0.21, 0));
    y += hh + s * 0.3; s *= 0.7;
  }
  return [walls, roofs];
}

/**
 * 远山：照目标图摆——两侧近处各一簇高石柱（被画面上沿切掉），中景几簇，正中间只放远处矮的，露出石阶下去的纵深；
 * 再撒一层远处的小石峰。雾按方向融进天边色（入侵那一侧的雾是紫黑的）。太阳那一侧留空，天边的光晕要露出来。
 * da 是相对横屏镜头朝向的水平角（正数在画面右边，弧度；横屏左右各约 0.69 看得见），d 离广场中心多远，h 露出云海多高。
 * pav：顶上立一座楼阁；来路那一侧的被黑雾盖住后起火冒烟。
 */
const PEAKS = [
  { da: -0.95, d: 82, h: 34, r: 7, sats: 2 },
  { da: -0.64, d: 72, h: 32, r: 6, sats: 2 },
  { da: -0.46, d: 128, h: 25, r: 6.5, sats: 1, pav: true },
  { da: -0.32, d: 160, h: 19, r: 5, sats: 1 },
  { da: -0.19, d: 196, h: 15, r: 6, sats: 0, pav: true },
  { da: -0.05, d: 265, h: 13, r: 8, sats: 1 },
  { da: 0.09, d: 300, h: 19, r: 9, sats: 1 },
  { da: 0.24, d: 150, h: 21, r: 6, sats: 1, pav: true },
  { da: 0.38, d: 120, h: 30, r: 7, sats: 2 },
  { da: 0.61, d: 78, h: 33, r: 6, sats: 2 },
  { da: 0.5, d: 175, h: 26, r: 6, sats: 1, pav: true },
];

function buildFarLayer(scene, U) {
  const R = rng(41);
  const rock = [], rockAo = [], hallPos = [], hallDir = [], hallSeed = [], hallBase = [], halls = [];
  const sunAz = Math.atan2(SUN_DIR.z, SUN_DIR.x);
  const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const specs = PEAKS.map((p) => ({ ...p, a: VIEW_AZ + p.da }));
  for (let i = 0; i < 16; i++) {   // 远处一层小石峰
    const a = VIEW_AZ - 1.25 + (i + 0.5) / 16 * 2.5 + (R() - 0.5) * 0.1, far = angDiff(a, sunAz) < 0.3;
    specs.push({ a, da: a - VIEW_AZ, d: 230 + R() * 130, h: (12 + R() * 26) * (far ? 0.4 : 1), r: 6 + R() * 6, sats: Math.floor(R() * 2), pav: false });
  }
  for (const p of specs) {
    const x = Math.cos(p.a) * p.d, z = Math.sin(p.a) * p.d, base = SEA_Y - 8, rot = R() * 6.28;
    const pg = pillarGeo(R, p.r, p.h + 8), c = Math.cos(rot), s = Math.sin(rot);
    pushGeo(rock, pg.g, x, base + (p.h + 8) / 2, z, rot, { ao: rockAo });
    for (let k = 0; k < p.sats; k++) {   // 旁边一两根矮一点的
      const sa = R() * 6.28, sd = p.r * (1.1 + R() * 0.7), sh = (p.h + 8) * (0.45 + R() * 0.4);
      pushGeo(rock, pillarGeo(R, p.r * (0.4 + R() * 0.3), sh).g, x + Math.cos(sa) * sd, base + sh / 2, z + Math.sin(sa) * sd, R() * 6.28, { ao: rockAo });
    }
    if (!p.pav) continue;
    // 楼阁放在歪出去的顶面中心
    const tx = x + c * pg.ox + s * pg.oz, tz = z - s * pg.ox + c * pg.oz, ty = SEA_Y + p.h + pg.dome * 0.7;
    const w = 4.5 + R() * 2.5, [walls, roofs] = hallGeo(R, w), seed = halls.length + 0.37;
    const dir = new THREE.Vector3(tx, 0, tz).normalize();
    for (const g of [...walls, ...roofs]) {
      const n = pushGeo(hallPos, g, tx, ty, tz, R() * 6.28);
      for (let k = 0; k < n; k++) { hallDir.push(dir.x, dir.y, dir.z); hallSeed.push(seed); hallBase.push(ty); }
    }
    halls.push({ x: tx, y: ty + w * 0.3, z: tz, seed });
  }

  const rockGeo = new THREE.BufferGeometry();
  rockGeo.setAttribute('position', new THREE.Float32BufferAttribute(rock, 3));
  rockGeo.setAttribute('ao', new THREE.Float32BufferAttribute(rockAo, 2));
  scene.add(new THREE.Mesh(rockGeo, farMat(U, false)));
  const hallG = new THREE.BufferGeometry();
  hallG.setAttribute('position', new THREE.Float32BufferAttribute(hallPos, 3));
  hallG.setAttribute('aDir', new THREE.Float32BufferAttribute(hallDir, 3));
  hallG.setAttribute('aSeed', new THREE.Float32BufferAttribute(hallSeed, 1));
  hallG.setAttribute('aBase', new THREE.Float32BufferAttribute(hallBase, 1));
  scene.add(new THREE.Mesh(hallG, farMat(U, true)));
  return buildSmoke(scene, U, halls);
}

/**
 * 远山与楼阁的材质：面法线用屏幕导数算（合成的网格不带法线）；雾按方向融进天边色。
 * 被黑雾盖住的一侧不受阳光、压暗；楼阁烧黑，墙根一圈火光闪动 @param {boolean} fire
 */
function farMat(U, fire) {
  return new THREE.ShaderMaterial({
    fog: false,
    defines: fire ? { FIRE: '' } : {},
    uniforms: { ...U, uRock: { value: ROCK }, uRockShade: { value: ROCK_SHADE }, uPine: { value: PINE }, uHaze: { value: 0.003 } },
    vertexShader: `varying vec3 vW; varying vec2 vAo;
      ${COMMON_GLSL}
      #ifdef FIRE
      attribute vec3 aDir; attribute float aSeed; attribute float aBase; varying float vBurn; varying float vSeed; varying float vBase;
      #else
      attribute vec2 ao;
      #endif
      void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
      #ifdef FIRE
        vBurn = smoothstep(0.4, 0.8, invMask(aDir, 0.)) * smoothstep(0.28, 0.38, uInv); vSeed = aSeed; vBase = aBase; vAo = vec2(1., 0.);
      #else
        vAo = ao;
      #endif
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vW; varying vec2 vAo; uniform vec3 uRock; uniform vec3 uRockShade; uniform vec3 uPine; uniform float uHaze;
      ${COMMON_GLSL}
      #ifdef FIRE
      varying float vBurn; varying float vSeed; varying float vBase;
      #endif
      void main(){
        vec3 v = normalize(vW - cameraPosition);
        vec3 N = normalize(cross(dFdx(vW), dFdy(vW)));
        if (dot(N, v) > 0.) N = -N;
        float m = invMask(v, 0.);
        float lit = max(dot(N, uSun), 0.) * (1. - 0.9 * m);
        vec3 c = (uRockShade * (0.55 + 0.45 * max(N.y, 0.)) + mix(uRock, uPine, vAo.y) * uSunCol * lit * 1.3) * vAo.x * (1. - 0.55 * m);
        // 朝太阳那边的轮廓镶一道金边（逆光）
        float rim = pow(1. - abs(dot(N, v)), 3.) * pow(max(dot(v.xz / max(length(v.xz), 1e-4), normalize(uSun.xz)), 0.), 3.);
        c += uSunCol * rim * 0.6 * (1. - m);
        float hd = length(vW - cameraPosition) * uHaze;
        float f = 1. - exp(-hd * hd);                             // 按距离平方：近处清楚、中景淡一层、远处几乎融进天边（分出层次）
        f = max(f, (1. - smoothstep(-9., 2., vW.y)) * 0.75);   // 根部没进云里
      #ifdef FIRE
        float low = 1. - smoothstep(0., 2.6, vW.y - vBase);     // 墙根
        float fl = (0.6 + 0.4 * sin(uTime * 11. + vSeed * 17. + vW.x) * sin(uTime * 6.3 + vSeed * 5. + vW.z)) * (0.5 + 0.5 * sin(vW.x * 2.1 + vW.z * 1.7 + vSeed));
        c = mix(c, c * 0.3, vBurn);                                 // 烧黑
        vec3 fire = vec3(2.6, 0.8, 0.18) * vBurn * low * fl;
        c = mix(c, horizonInv(v), f) + fire * (1. - 0.5 * f);      // 火光穿得过雾
      #else
        c = mix(c, horizonInv(v), f);
      #endif
        c += uInvGlow * flashAt(v) * m * 0.3;
        gl_FragColor = vec4(dimColor(c, uDim), 1.); }`,
  });
}

/** 起火楼阁上的黑烟：每座一张始终侧对镜头的长条，噪声往上流、越高越散、顺风歪；底下透出火光 */
function buildSmoke(scene, U, halls) {
  const center = [], corner = [], seed = [], index = [];
  halls.forEach((h, i) => {
    for (const [cx, cy] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]) { center.push(h.x, h.y, h.z); corner.push(cx, cy); seed.push(h.seed); }
    index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(center, 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  g.setIndex(index);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    uniforms: { ...U },
    vertexShader: `attribute vec2 aCorner; attribute float aSeed; varying vec2 vUv; varying float vBurn; varying float vSeed;
      ${COMMON_GLSL}
      void main(){
        vec3 toCam = cameraPosition - position; vec3 right = normalize(vec3(toCam.z, 0., -toCam.x));
        vec3 p = position + right * aCorner.x * 16. + vec3(aCorner.y * aCorner.y * 9., aCorner.y * 48., 0.);
        vUv = aCorner; vSeed = aSeed;
        vBurn = smoothstep(0.4, 0.8, invMask(normalize(vec3(position.x, 0., position.z)), 0.)) * smoothstep(0.3, 0.42, uInv);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }`,
    fragmentShader: `varying vec2 vUv; varying float vBurn; varying float vSeed;
      ${COMMON_GLSL}
      void main(){
        if (vBurn < 0.01) discard;
        float y = vUv.y, w = 0.12 + 0.38 * y;
        float n = fbm(vec2(vUv.x * 3. / (0.3 + y), y * 3.5 - uTime * 0.35) + vSeed * 7.);
        float a = smoothstep(0.3, 0.7, n) * (1. - smoothstep(w * 0.4, w, abs(vUv.x))) * smoothstep(0., 0.06, y) * (1. - smoothstep(0.55, 1., y)) * vBurn * 0.85;
        vec3 c = mix(vec3(0.05, 0.04, 0.05), vec3(0.13, 0.1, 0.12), n) + vec3(1.0, 0.35, 0.08) * (1. - smoothstep(0., 0.18, y)) * 1.5;
        gl_FragColor = vec4(dimColor(c, uDim), a); }`,
  });
  const smoke = new THREE.Mesh(g, mat);
  smoke.frustumCulled = false;   // 顶点在着色器里才展开，包围球不准
  smoke.visible = false;
  scene.add(smoke);
  return smoke;
}

/**
 * 黑雾墙：围着广场两圈竖着的环带（近一圈矮、远一圈高），只在被盖住的方向显出来；
 * 噪声往上流，雾顶参差，越往后越高——"黑雾往天上卷"。镜头看云海的那一截也挡得住（竖屏几乎看不到天）。
 */
function buildFogBank(scene, U) {
  const bands = [];
  for (const [r, top, seed] of [[85, 34, 0], [160, 62, 3.7]]) {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
      uniforms: { ...U, uR: { value: r }, uTop: { value: top }, uSeed: { value: seed } },
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `varying vec3 vW; uniform float uR; uniform float uTop; uniform float uSeed;
        ${COMMON_GLSL}
        void main(){
          vec3 dO = normalize(vec3(vW.x, 0., vW.z));
          float m = invMask(dO, 0.);
          if (m < 0.01) discard;
          float y = vW.y + 9.;
          vec2 uv = vec2(invAngle(dO) * uR / 22. + uSeed, y / 16. - uTime * 0.05);
          float n = fbm(uv);
          float n2 = fbm(uv * 2.2 + n * 1.3 - vec2(0., uTime * 0.08));
          float h = uTop * m * (0.35 + 0.65 * smoothstep(0.2, 0.9, uInv));   // 越往后雾墙越高
          float dens = n * 0.7 + n2 * 0.5 - y / max(h, 1.) * 0.9;
          float a = smoothstep(0.25, 0.55, dens) * smoothstep(0., 3., y);
          if (a < 0.01) discard;
          vec3 c = mix(uInvDeep, uInvLit, smoothstep(0.3, 0.9, n2) * 0.8);
          c += uInvGlow * flashAt(normalize(vW - cameraPosition)) * n2 * 0.6;
          gl_FragColor = vec4(dimColor(c, uDim), a * 0.92); }`,
    });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r, r, top + 4, 96, 1, true), mat);
    band.position.y = SEA_Y - 1 + (top + 4) / 2;
    band.frustumCulled = false;
    band.renderOrder = r > 100 ? -2 : -1;   // 远的一圈先画
    band.visible = false;
    scene.add(band);
    bands.push(band);
  }
  return bands;
}

/** 雾里的紫色闪电：一条锯齿带子从高处劈进雾里，带一根分叉；亮度超过泛光阈值，会发光 */
function buildBolt(scene) {
  const MAIN = 22, BR = 8, pos = new Float32Array((MAIN + BR) * 2 * 3), index = [];
  for (const [o, n] of [[0, MAIN], [MAIN, BR]]) {
    for (let i = 0; i < n - 1; i++) { const a = (o + i) * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(index);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 1.2, 3.2), transparent: true, opacity: 0, depthWrite: false, fog: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  /** 折线点（世界坐标），宽度方向等到 update 时按镜头算 */
  const pts = Array.from({ length: MAIN + BR }, () => new THREE.Vector3());
  const side = new THREE.Vector3(), _v = new THREE.Vector3();
  return {
    /** @param {number} x @param {number} z @param {() => number} R */
    strike(x, z, R) {
      const top = 42 + R() * 18, bottom = SEA_Y + 4;
      let ox = 0, oz = 0;
      for (let i = 0; i < MAIN; i++) {
        const t = i / (MAIN - 1);
        ox += (R() - 0.5) * 5; oz += (R() - 0.5) * 5;
        pts[i].set(x + ox, top + (bottom - top) * t, z + oz);
      }
      const from = pts[4 + Math.floor(R() * 8)];
      let bx = 0, bz = 0;
      const dirx = R() < 0.5 ? -1 : 1;
      for (let i = 0; i < BR; i++) {
        bx += dirx * (1.5 + R() * 2.5) + (R() - 0.5) * 3; bz += (R() - 0.5) * 3;
        pts[MAIN + i].set(from.x + bx, from.y - i * (2 + R() * 2), from.z + bz);
      }
    },
    /** @param {number} f 亮度（0 不画） @param {THREE.Vector3} [camPos] */
    update(f, camPos) {
      mesh.visible = f > 0.02;
      if (!mesh.visible || !camPos) return;
      mat.opacity = f;
      for (let i = 0; i < pts.length; i++) {
        const w = i < MAIN ? 0.9 * (1 - (i / MAIN) * 0.4) : 0.5;
        side.copy(pts[i]).sub(camPos).cross(_v.set(0, 1, 0)).normalize().multiplyScalar(w);
        pos.set([pts[i].x - side.x, pts[i].y, pts[i].z - side.z, pts[i].x + side.x, pts[i].y, pts[i].z + side.z], i * 6);
      }
      g.attributes.position.needsUpdate = true;
    },
  };
}
