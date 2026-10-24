// @ts-check
/**
 * 火的专用画面（特效风格 v2 元素对照：斗破式白黄芯红边的火团 + 满屏火星 + 墨烟；风格卡"火烧过留焦黑，保留一段时间"）。
 *   - 火团：一个按噪声起伏、往外翻卷的球，里白外红；飞的时候背面往后拖成彗尾，炸开时胀大、冷却变红、按噪声烧穿散掉；
 *   - 焦痕：落在平地上留一块焦黑，先透着暗红的余烬，几秒后慢慢淡掉。
 * 火苗、火星、墨烟这些粒子在 spells.js 里发（用公共的粒子池）。
 */
import * as THREE from 'three';
import { canvasTex, rng } from './common.js';

const NOISE3 = `
float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float n3(vec3 p){ vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3. - 2. * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), u.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), u.x), u.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), u.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), u.x), u.y), u.z); }
float f3(vec3 p){ return n3(p) * 0.55 + n3(p * 2.1) * 0.3 + n3(p * 4.3) * 0.15; }
// 脊状噪声：一道道细的亮脊，像火舌
float ridge(vec3 p){ float v = 0., a = 0.6; for (int k = 0; k < 3; k++){ v += a * (1. - abs(n3(p) * 2. - 1.)); p *= 2.2; a *= 0.5; } return v; }`;

/**
 * 火团的材质。uHeat：1 白热、0 冷成暗红；uBurn：0 完整、1 烧穿散完；uDir、uStretch：往哪个方向飞、彗尾拖多长（米）。
 * 普通混合（不是叠加）：白天背景是白石头和亮天，叠加的火在上面只剩一团淡黄（实测），要实打实盖上去才看得出橙红；
 * 芯的颜色大于 1，照样过泛光发亮。只画正面。
 */
export function fireMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uHeat: { value: 1 }, uBurn: { value: 0 }, uAlpha: { value: 1 }, uAmp: { value: 0.3 },
      uDir: { value: new THREE.Vector3(0, 0, -1) }, uStretch: { value: 0 }, uSeed: { value: Math.random() * 50 } },
    vertexShader: `uniform float uTime; uniform float uAmp; uniform vec3 uDir; uniform float uStretch; uniform float uSeed;
      varying vec3 vN; varying vec3 vV; varying vec3 vO;
      ${NOISE3}
      void main(){
        vec3 n = normalize(position);
        float w = f3(n * 3. + vec3(uSeed, uSeed - uTime * 3., uSeed * 0.5));     // 火舌往上翻
        vec3 p = position + normal * (w - 0.35) * uAmp;
        vec3 dl = normalize(uDir);   // 火团只缩放不旋转，世界方向就是模型里的方向
        float back = max(0., -dot(n, dl));
        p -= dl * back * back * uStretch * (0.5 + w);                               // 背面往后拖成彗尾
        vO = n + vec3(0., -uTime * 2.2, 0.);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uHeat; uniform float uBurn; uniform float uAlpha; uniform float uSeed;
      varying vec3 vN; varying vec3 vV; varying vec3 vO;
      ${NOISE3}
      void main(){
        float facing = clamp(abs(dot(vN, vV)), 0., 1.);                 // 正对镜头的中间最热，边缘冷
        float n = f3(vO * 2.6 + uSeed), r = ridge(vO * 3.2 + uSeed * 0.7);
        // 热度：正中、火舌的脊上热；整体随冷却往下掉。白黄只留在最里面
        float t = clamp(facing * 0.5 * (0.4 + 0.6 * uHeat) + r * 0.42 + n * 0.2 + uHeat * 0.08 - 0.22, 0., 1.);
        // 白天背景亮，叠加的光很容易冲成一片白（实测）：橙红占大头，只有最里一小块白黄
        vec3 c = mix(vec3(0.32, 0.03, 0.005), vec3(1.15, 0.3, 0.035), smoothstep(0.1, 0.55, t));   // 暗红 → 橙
        c = mix(c, vec3(1.9, 1.25, 0.45), smoothstep(0.8, 1., t));                                 // → 白黄的芯
        float burn = smoothstep(uBurn - 0.08, uBurn + 0.08, n * 0.85 + facing * 0.15);       // 按噪声烧穿
        float a = uAlpha * burn * smoothstep(0.02, 0.45, facing + (r - 0.6) * 0.6) * 0.95;   // 轮廓按火舌化开
        gl_FragColor = vec4(c, a); }`,
  });
}

let _ballGeo = /** @type {THREE.BufferGeometry | null} */ (null);
/** 一团火（单位半径，用 scale 定大小）。几何体所有火团共用，用完只释放材质 */
export function fireball() {
  if (!_ballGeo) _ballGeo = new THREE.IcosahedronGeometry(1, 5);
  const m = new THREE.Mesh(_ballGeo, fireMaterial());
  m.frustumCulled = false;   // 顶点在着色器里挪动，包围球不准
  return m;
}

let _scorch = /** @type {{ dark: THREE.Texture, glow: THREE.Texture } | null} */ (null);
/** 焦痕两张图：dark 是焦黑（普通混合压暗地面），glow 是余烬（叠加发光，集中在边缘和裂纹里） */
export function scorchTextures() {
  if (_scorch) return _scorch;
  const R = rng(19);
  const blobs = Array.from({ length: 9 }, () => ({ a: R() * Math.PI * 2, d: R() * 0.32, r: 0.25 + R() * 0.25 }));
  const cracks = Array.from({ length: 11 }, () => ({ a: R() * Math.PI * 2, len: 0.25 + R() * 0.2, b: (R() - 0.5) * 0.5 }));
  const shape = (g, S, fill) => {
    for (const b of blobs) {
      const x = S / 2 + Math.cos(b.a) * b.d * S / 2, y = S / 2 + Math.sin(b.a) * b.d * S / 2, r = b.r * S / 2;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, fill(0.95)); grd.addColorStop(0.6, fill(0.6)); grd.addColorStop(1, fill(0));
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  };
  const dark = canvasTex(256, (g, S) => {
    shape(g, S, (a) => `rgba(22, 16, 12, ${a * 0.85})`);
    g.strokeStyle = 'rgba(10, 8, 6, 0.6)'; g.lineWidth = 2;
    for (const c of cracks) {   // 往外放射的焦纹
      g.beginPath(); g.moveTo(S / 2, S / 2);
      g.quadraticCurveTo(S / 2 + Math.cos(c.a + c.b) * c.len * S * 0.6, S / 2 + Math.sin(c.a + c.b) * c.len * S * 0.6, S / 2 + Math.cos(c.a) * c.len * S, S / 2 + Math.sin(c.a) * c.len * S);
      g.stroke();
    }
  });
  const glow = canvasTex(256, (g, S) => {
    g.strokeStyle = 'rgba(255, 255, 255, 0.9)'; g.lineWidth = 3; g.lineCap = 'round';
    for (const c of cracks) {
      g.beginPath(); g.moveTo(S / 2 + Math.cos(c.a) * c.len * S * 0.3, S / 2 + Math.sin(c.a) * c.len * S * 0.3);
      g.quadraticCurveTo(S / 2 + Math.cos(c.a + c.b) * c.len * S * 0.6, S / 2 + Math.sin(c.a + c.b) * c.len * S * 0.6, S / 2 + Math.cos(c.a) * c.len * S, S / 2 + Math.sin(c.a) * c.len * S);
      g.stroke();
    }
    const grd = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.42);
    grd.addColorStop(0, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
  });
  _scorch = { dark, glow };
  return _scorch;
}
