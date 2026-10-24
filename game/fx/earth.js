// @ts-check
/**
 * 土的专用画面（特效风格 v2 元素对照：金色熔纹加黑色墨裂的石块 + 碎石尘浪）。
 *   - 石块材质：受光的山石（跟着太阳有明暗、有影子），表面按噪声长出一道道金色熔纹（发光，uHeat 从 1 冷到 0）和黑色墨裂；
 *     纹路按石块自己的坐标算，实例化时再按各自的位置错开，几十块看不出是同一块；
 *   - 石块几何体：一个捏歪的二十面体，切面分明；实例化时各自拉伸、转动；
 *   - 裂地：落点地上一片放射状的裂纹，缝里先透金光，一两秒熄掉，黑缝留 6 秒多再淡掉。
 * 碎石怎么飞、尘浪怎么推在 spells.js 里排。
 */
import * as THREE from 'three';
import { canvasTex, rng } from './common.js';

const NOISE3 = `
float eh3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float en3(vec3 p){ vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3. - 2. * f);
  return mix(mix(mix(eh3(i), eh3(i + vec3(1,0,0)), u.x), mix(eh3(i + vec3(0,1,0)), eh3(i + vec3(1,1,0)), u.x), u.y),
             mix(mix(eh3(i + vec3(0,0,1)), eh3(i + vec3(1,0,1)), u.x), mix(eh3(i + vec3(0,1,1)), eh3(i + vec3(1,1,1)), u.x), u.y), u.z); }`;

/**
 * 石块材质（每个特效一份：uHeat 各自冷却）。veinK：熔纹的密度（墙比碎石大，纹路要多一些）；
 * veinW：熔纹的半宽（模型坐标：碎石的模型是单位半径，墙是真实米数，所以碎石要给大一些）。
 * @param {{ heat?: number, veinK?: number, veinW?: number }} [o]
 */
export function rockMat(o = {}) {
  const U = { uHeat: { value: o.heat ?? 1 }, uVeinK: { value: o.veinK ?? 2.2 }, uVeinW: { value: o.veinW ?? 0.07 } };
  // 0x8c8274 时墙朝镜头那面背光，近看几乎是黑的、认不出是石头（实测）
  const m = new THREE.MeshStandardMaterial({ color: 0xb3a68f, roughness: 0.93, flatShading: true });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vObj = position;
        #ifdef USE_INSTANCING
          vObj += instanceMatrix[3].xyz * 0.37;
        #endif`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vObj; uniform float uHeat; uniform float uVeinK; uniform float uVeinW;
        ${NOISE3}
        // 离噪声等值线有多远（模型坐标）：噪声差值除以噪声在这儿的坡度。
        // 直接按噪声差值取缝宽，坡缓的地方一道缝会胀成一大团（墙上一个个金色蝌蚪，实测）
        float isoDist(float n, vec3 p){
          float g = length(vec2(dFdx(n), dFdy(n))) / max(length(vec2(length(dFdx(p)), length(dFdy(p)))), 1e-6);
          return abs(n - 0.5) / max(g, 1e-4);
        }
        // 叠一层细的：只有一层时缝是圆滑的波浪线，一律粗细，像面条（实测）
        float fb(vec3 p, float k){ return en3(p) * (1. - k) + en3(p * 3.1 + 5.3) * k; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float nV = fb(vObj * uVeinK + 3.1, 0.3), nC = fb(vObj * uVeinK * 1.5 + 11.7, 0.4);
        // 粗细沿着缝时粗时细，有的地方收没了：一道道断开的缝，像笔锋
        float wV = uVeinW * 1.4 * smoothstep(0.25, 0.7, en3(vObj * 2.3 + 7.));
        float vein = 1. - smoothstep(0.4, 1., isoDist(nV, vObj) / max(wV, 1e-4));
        // 黑缝也断开：连成一整张网时整面墙像迷宫地图（实测）
        float wC = uVeinW * 0.6 * smoothstep(0.4, 0.7, en3(vObj * 1.9 + 2.));
        float crack = 1. - smoothstep(0.3, 1., isoDist(nC, vObj) / max(wC, 1e-4));
        diffuseColor.rgb *= (0.78 + 0.4 * en3(vObj * 1.3)) * (1. - 0.82 * max(vein, crack * 0.8));   // 冷了只剩黑缝`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.6, 0.78, 0.2) * vein * uHeat * (0.75 + 0.25 * en3(vObj * 6.));`);
  };
  m.userData.heat = U.uHeat;
  return m;
}

/** @param {number} x */
const q = (x) => Math.round(x * 1000) / 1000;

let _chunk = /** @type {THREE.BufferGeometry | null} */ (null);
/** 一块碎石（单位半径）：二十面体每个顶点按位置挪一点（同一位置挪得一样，面接得上） */
export function chunkGeo() {
  if (_chunk) return _chunk;
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position;
  // 先取整到千分之一再算：同一个顶点在不同的面上算出来的坐标差在末几位，直接拿去算会挪得不一样、面之间裂缝
  const j = (x, y, z) => { const s = Math.sin(q(x) * 12.99 + q(y) * 78.23 + q(z) * 37.71) * 43758.55; return s - Math.floor(s); };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.72 + 0.5 * j(x, y, z);
    p.setXYZ(i, x * k, y * k * 0.85, z * k);
  }
  g.computeVertexNormals();
  _chunk = g;
  return g;
}

let _wall = /** @type {THREE.BufferGeometry | null} */ (null);
/**
 * 土墙的一段：凿过的圆角石块（风格卡：土墙用圆角方块）。方块分几格，按位置挪一挪、角上往里收。
 * @param {number} w @param {number} h @param {number} d
 */
export function wallGeo(w, h, d) {
  if (_wall) return _wall;
  const g = new THREE.BoxGeometry(w, h, d, 3, 4, 2), p = g.attributes.position;
  const R = (x, y, z) => { const s = Math.sin(x * 41.3 + y * 17.9 + z * 63.1) * 43758.55; return s - Math.floor(s) - 0.5; };
  for (let i = 0; i < p.count; i++) {
    const x = q(p.getX(i)), y = q(p.getY(i)), z = q(p.getZ(i));
    const ex = Math.abs(x) / (w / 2), ey = Math.abs(y) / (h / 2), ez = Math.abs(z) / (d / 2);
    const corner = Math.max(0, ex + ey + ez - 2.2);   // 越靠角越往里收
    const k = 1 - corner * 0.25, bottom = y < -h / 2 + 0.01;   // 底面不挪，贴得住地
    p.setXYZ(i, x * k + R(x, y, z) * 0.07, bottom ? y : y * (1 - corner * 0.08) + R(y, z, x) * 0.05, z * k + R(z, x, y) * 0.05);
  }
  g.computeVertexNormals();
  _wall = g;
  return g;
}

let _cracks = /** @type {{ dark: THREE.Texture, glow: THREE.Texture } | null} */ (null);
/** 裂地两张图：dark 是黑缝（普通混合压暗地面），glow 是缝里透出的金光（叠加） */
export function crackTextures() {
  if (_cracks) return _cracks;
  const R = rng(53);
  /** @type {{ x: number, y: number }[][]} */
  const lines = [];
  /** 一道裂缝：从 (x, y) 往 a 方向折线走，偶尔分叉 @param {number} x @param {number} y @param {number} a @param {number} len @param {number} depth */
  const walk = (x, y, a, len, depth) => {
    const pts = [{ x, y }];
    for (let s = 0; s < len;) {
      const step = 0.025 + R() * 0.035;
      a += (R() - 0.5) * 0.9;
      x += Math.cos(a) * step; y += Math.sin(a) * step; s += step;
      pts.push({ x, y });
      if (depth < 2 && R() < 0.16) walk(x, y, a + (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.6), (len - s) * 0.6, depth + 1);
    }
    lines.push(pts);
  };
  for (let i = 0; i < 10; i++) walk(0, 0, (i / 10) * Math.PI * 2 + R() * 0.4, 0.3 + R() * 0.15, 0);
  /** @param {CanvasRenderingContext2D} g @param {number} S @param {string} color @param {number} w0 */
  const draw = (g, S, color, w0) => {
    g.strokeStyle = color; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pts of lines) {
      for (let i = 1; i < pts.length; i++) {
        const r = Math.hypot(pts[i].x, pts[i].y);
        g.lineWidth = Math.max(0.6, w0 * (1 - r * 1.8));   // 越往外越细
        g.beginPath(); g.moveTo(S / 2 + pts[i - 1].x * S, S / 2 + pts[i - 1].y * S); g.lineTo(S / 2 + pts[i].x * S, S / 2 + pts[i].y * S); g.stroke();
      }
    }
  };
  const dark = canvasTex(256, (g, S) => {
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.2);   // 正中砸碎的一小片
    grd.addColorStop(0, 'rgba(30, 24, 18, 0.7)'); grd.addColorStop(1, 'rgba(30, 24, 18, 0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    draw(g, S, 'rgba(14, 11, 8, 0.92)', 5);
  });
  const glow = canvasTex(256, (g, S) => draw(g, S, 'rgba(255, 255, 255, 0.95)', 2.4));
  _cracks = { dark, glow };
  return _cracks;
}
