// @ts-check
/**
 * 冰的专用画面（特效风格 v2 元素对照：冰龙 + 半透明晶片 + 三层雪尘；风格卡"冰冻过留霜痕，保留一段时间"）。
 *   - 冰晶材质：边缘亮、中间透，按太阳方向闪一下高光；面法线用屏幕导数算，一个切面一个亮度；
 *   - 冰棱：六棱的晶柱（车床几何体），实例化一次画完；
 *   - 晶片：六角薄片，炸开时飞散翻滚，落地弹一下再化掉；
 *   - 霜痕：地上一片放射状的冰花纹。
 * 雪尘（细亮粉、冷雾）在 spells.js 里用粒子池发。
 */
import * as THREE from 'three';
import { canvasTex, rng } from './common.js';
import { SUN_DIR } from '../world/environment.js';

/**
 * 冰晶材质（普通混合：白石头上叠加的冰色只剩一片白，要实打实盖上去，边上才看得出冰蓝）。
 * 单个网格或实例化网格都能用（实例化时乘上每个实例的矩阵）。uAlpha 统一淡出。
 */
export function iceMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uAlpha: { value: 1 }, uSun: { value: SUN_DIR }, uTint: { value: new THREE.Color(0.18, 0.6, 1.0) } },
    vertexShader: `varying vec3 vP;
      void main(){ vec4 p = vec4(position, 1.);
      #ifdef USE_INSTANCING
        p = instanceMatrix * p;
      #endif
        vec4 mv = modelViewMatrix * p; vP = mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uAlpha; uniform vec3 uSun; uniform vec3 uTint; varying vec3 vP;
      void main(){
        vec3 N = normalize(cross(dFdx(vP), dFdy(vP))), V = normalize(-vP);
        if (dot(N, V) < 0.) N = -N;
        float f = pow(1. - clamp(dot(N, V), 0., 1.), 2.);                       // 越侧着越亮（冰的边）
        vec3 S = normalize((viewMatrix * vec4(uSun, 0.)).xyz);
        float spec = pow(max(dot(reflect(-V, N), S), 0.), 30.);                // 对着太阳的切面闪一下
        float facet = fract(sin(dot(floor(N * 4.), vec3(12.9, 78.2, 37.7))) * 43758.5);   // 每个切面亮度不同
        vec3 c = mix(vec3(0.55, 0.78, 1.0), vec3(0.9, 0.97, 1.0), f) * (0.72 + 0.35 * facet) + uTint * f * 0.6 + vec3(1.6) * spec;
        gl_FragColor = vec4(c, uAlpha * clamp(0.38 + 0.55 * f + spec, 0., 1.)); }`,
  });
}

let _crystal = /** @type {THREE.BufferGeometry | null} */ (null), _chip = /** @type {THREE.BufferGeometry | null} */ (null);
/** 冰棱：六棱柱往上收、顶上一个尖（单位半径、单位高，底在原点） */
export function crystalGeo() {
  if (!_crystal) _crystal = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(1, 0), new THREE.Vector2(0.8, 0.66), new THREE.Vector2(0, 1)], 6);
  return _crystal;
}
/** 晶片：六角薄片（单位半径） */
export function chipGeo() {
  if (!_chip) _chip = new THREE.CylinderGeometry(1, 1, 0.14, 6);
  return _chip;
}

let _frost = /** @type {THREE.Texture | null} */ (null);
/** 霜痕：从中心放射出去的冰花枝，每根枝上再分出 60° 的小枝 */
export function frostTexture() {
  if (_frost) return _frost;
  const R = rng(37);
  _frost = canvasTex(256, (g, S) => {
    const c = S / 2;
    const grd = g.createRadialGradient(c, c, 0, c, c, c * 0.9);
    grd.addColorStop(0, 'rgba(255,255,255,0.35)'); grd.addColorStop(0.7, 'rgba(255,255,255,0.15)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineCap = 'round';
    const branch = (x, y, a, len, w, depth) => {
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
      if (depth <= 0) return;
      for (let k = 1; k <= 3; k++) {   // 沿枝每隔一段分出一对 60° 的小枝
        const t = k / 4, bx = x + Math.cos(a) * len * t, by = y + Math.sin(a) * len * t, bl = len * (0.42 - t * 0.08) * (0.7 + R() * 0.5);
        branch(bx, by, a + Math.PI / 3, bl, w * 0.6, depth - 1);
        branch(bx, by, a - Math.PI / 3, bl, w * 0.6, depth - 1);
      }
    };
    for (let i = 0; i < 6; i++) branch(c, c, (i / 6) * Math.PI * 2 + R() * 0.3, c * (0.7 + R() * 0.2), 3, 2);
  });
  return _frost;
}
