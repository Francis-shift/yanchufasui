// @ts-check
/**
 * 护山大阵的金色光罩（风格卡"入侵进程"：光罩跟阵眼血量走；"敌我配色"：我方用金色）。
 * 一个从云海升起、罩住整座山门的大半球，镜头在罩子里面：平时只看得见远处罩壁上淡淡的六角纹和几圈符文、
 * 罩脚贴着云海的一道金线、罩面上一道道往上流的光；阵眼每挨一下整罩闪一下，掉血越多裂纹越多——
 * 裂纹从敌人来的那一侧（黑雾那边）先裂，金白色、边上透紫；阵眼破了整罩碎掉散去。
 * 加色混合、不写深度：只往画面上加光，不挡敌人。
 */
import * as THREE from 'three';
import { rng } from '../fx/common.js';
import { INV_DIR } from './environment.js';

/** 罩脚落在云海上（云海在 -9，抬高一点免得和云海平面打架）；半径要把牌坊屋顶罩进去，又让横屏、竖屏机位都在罩子里 */
export const BARRIER = { center: new THREE.Vector3(0, -8.6, -2), radius: 30 };

/**
 * 球面贴图坐标：u 绕一圈（three 的球体 x = -cos(2πu)、z = sin(2πu)），v 从罩脚 0 到顶 1。
 * 某个水平方向在 u 上的位置 @param {number} dx @param {number} dz
 */
const azToU = (dx, dz) => { const u = Math.atan2(dz, -dx) / (Math.PI * 2); return u - Math.floor(u); };

/** 画布贴图（数据，按原值读） */
function dataTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(/** @type {CanvasRenderingContext2D} */ (c.getContext('2d')), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** 罩面纹样：R 通道六角纹，G 通道符文圈。列数取整，绕一圈接缝对得上 @param {number} W */
function patternTex(W) {
  const H = W / 4;   // 半球一圈约 188 米、从脚到顶约 47 米，宽高 4 比 1，格子不变形
  return dataTex(W, H, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    const cols = 46, s = W / (cols * 1.5), rowH = Math.sqrt(3) * s;
    g.strokeStyle = 'rgb(255, 0, 0)'; g.lineWidth = Math.max(1, W / 1400);
    g.beginPath();
    for (let c = 0; c <= cols; c++) {
      for (let r = -1; r * rowH < H + rowH; r++) {
        const cx = c * 1.5 * s, cy = r * rowH + (c % 2) * rowH / 2;
        for (let k = 0; k < 6; k++) {
          const a0 = (k / 6) * Math.PI * 2, a1 = ((k + 1) / 6) * Math.PI * 2;
          g.moveTo(cx + Math.cos(a0) * s, cy + Math.sin(a0) * s); g.lineTo(cx + Math.cos(a1) * s, cy + Math.sin(a1) * s);
        }
      }
    }
    g.stroke();
    // 符文圈：多半在下半截（镜头看得见的那一段）
    const R = rng(59);
    g.strokeStyle = 'rgb(0, 255, 0)';
    for (let i = 0; i < 18; i++) {
      const x = R() * W, y = H * (0.4 + R() * 0.48), r = H * (0.05 + R() * 0.05);
      for (const dx of [-W, 0, W]) {   // 挨着接缝的那几个在另一边也画一份
        const cx = x + dx;
        if (cx < -r * 2 || cx > W + r * 2) continue;
        g.lineWidth = Math.max(1, r * 0.06);
        g.beginPath(); g.arc(cx, y, r, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.arc(cx, y, r * 0.72, 0, Math.PI * 2); g.stroke();
        g.beginPath();
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          g.moveTo(cx + Math.cos(a) * r * 0.74, y + Math.sin(a) * r * 0.74); g.lineTo(cx + Math.cos(a) * r * 0.98, y + Math.sin(a) * r * 0.98);
        }
        // 当中一个三角加一道横，像个符
        for (let k = 0; k < 3; k++) {
          const a = -Math.PI / 2 + (k / 3) * Math.PI * 2, b = a + (Math.PI * 2) / 3;
          g.moveTo(cx + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.45); g.lineTo(cx + Math.cos(b) * r * 0.45, y + Math.sin(b) * r * 0.45);
        }
        g.moveTo(cx - r * 0.3, y + r * 0.05); g.lineTo(cx + r * 0.3, y + r * 0.05);
        g.stroke();
      }
    }
  });
}

/**
 * 裂纹图：R 是这一处在阵眼掉了几成血时裂开（255 = 不会裂）。用"取较暗"叠上去，越往裂纹末梢越晚，
 * 看上去是一点点裂开的；离敌人来路越近的裂纹越早出现。@param {number} W
 */
function crackTex(W) {
  const H = W / 4, u0 = azToU(INV_DIR.x, INV_DIR.y);
  return dataTex(W, H, (g) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'darken';
    g.lineCap = 'round';
    const R = rng(83);
    const walk = (x, y, dir, len, t0, span, depth) => {
      for (let walked = 0; walked < len;) {
        const step = W / 400 + R() * (W / 300);
        dir += (R() - 0.5) * 0.8;
        const nx = x + Math.cos(dir) * step, ny = y + Math.sin(dir) * step;
        if (ny < 0 || ny > H) break;
        const t = Math.min(0.99, t0 + span * (walked / len));
        g.strokeStyle = `rgb(${Math.round(t * 255)}, 255, 255)`; g.lineWidth = Math.max(1, (W / 1700) * (1 - 0.5 * walked / len) * (depth ? 0.7 : 1));
        for (const dx of [-W, 0, W]) { g.beginPath(); g.moveTo(x + dx, y); g.lineTo(nx + dx, ny); g.stroke(); }
        if (depth < 2 && R() < 0.12) walk(nx, ny, dir + (R() < 0.5 ? -1 : 1) * (0.6 + R() * 0.7), len * 0.4, t, span * 0.6, depth + 1);
        x = nx; y = ny; walked += step;
      }
    };
    for (let i = 0; i < 18; i++) {
      const du = (R() - 0.5) * 0.4, x = (u0 + du) * W, y = H * (0.75 + R() * 0.25);   // 从罩脚附近往上裂
      const t0 = 0.06 + (Math.abs(du) / 0.2) * 0.55 + R() * 0.2;
      walk(x, y, -Math.PI / 2 + (R() - 0.5) * 1.2, H * (0.18 + R() * 0.32), t0, 0.3, 0);
    }
  });
}

/**
 * @param {THREE.Scene} scene
 * @param {{ tex: number }} o tex：纹样贴图宽（电影档 2048、流畅档 1024）
 */
export function buildBarrier(scene, o) {
  const U = {
    uPat: { value: patternTex(o.tex) }, uCrack: { value: crackTex(Math.min(1024, o.tex)) },
    uDmg: { value: 0 }, uHit: { value: 0 }, uBreak: { value: 0 }, uTime: { value: 0 }, uDim: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: U,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `varying vec2 vUv; uniform sampler2D uPat; uniform sampler2D uCrack;
      uniform float uDmg; uniform float uHit; uniform float uBreak; uniform float uTime; uniform float uDim;
      void main(){
        float v = vUv.y;
        vec4 p = texture2D(uPat, vUv);
        float flow = 0.55 + 0.45 * sin(v * 90. - uTime * 1.2 + sin(vUv.x * 60.) * 1.5);   // 一道道往上流的光
        float body = exp(-v * 60.) * 0.9 + exp(-v * 8.) * 0.1                              // 罩脚一道金线，往上淡出
          + p.r * (0.025 + 0.05 * exp(-v * 5.)) * flow
          + p.g * 0.12 * (0.6 + 0.4 * sin(uTime * 1.7 + vUv.x * 50.));
        body *= (1. - smoothstep(0.6, 0.95, v)) * (1. + uHit * 1.5) * (1. - uBreak);
        float c = texture2D(uCrack, vUv).r;
        float crack = smoothstep(c - 0.015, c + 0.015, uDmg) * step(c, 0.99);
        float halo = max(0., smoothstep(c - 0.12, c, uDmg) * step(c, 0.99) - crack);          // 裂纹边上透一圈紫（紫色只给敌人）
        vec3 col = vec3(1.0, 0.7, 0.3) * body
          + (vec3(0.95, 0.72, 0.42) * crack * (0.8 + 0.9 * uHit) + vec3(0.5, 0.15, 0.9) * halo * 0.25) * (1. - uBreak * 0.8);   // 平时不过泛光阈值，挨打闪的那一下才发光
        gl_FragColor = vec4(col * (1. - 0.6 * uDim), 1.); }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(BARRIER.radius, 96, 32, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  dome.position.copy(BARRIER.center);
  dome.frustumCulled = false;
  scene.add(dome);

  let dmg = 0, breaking = false;
  return {
    /** 阵眼掉了几成血（0～1）：裂纹跟着长 @param {number} d */
    setDamage(d) { dmg = Math.min(1, Math.max(0, d)); if (!breaking) U.uDmg.value = dmg; },
    /** 阵眼挨了一下：整罩闪一下 */
    hit() { U.uHit.value = 1; },
    /** 阵眼破了：裂纹一下全开，然后整罩散掉 */
    shatter() { breaking = true; U.uDmg.value = 1; U.uHit.value = 1; },
    /** 新的一局：完好如初 */
    reset() { breaking = false; dmg = 0; U.uDmg.value = 0; U.uBreak.value = 0; U.uHit.value = 0; dome.visible = true; },
    /** @param {number} dt @param {number} dim 压暗世界的程度（大招时罩子也跟着暗） */
    update(dt, dim) {
      U.uTime.value += dt;
      U.uHit.value *= Math.exp(-dt * 5);
      U.uDim.value = dim;
      if (breaking) { U.uBreak.value = Math.min(1, U.uBreak.value + dt / 1.4); dome.visible = U.uBreak.value < 1; }
    },
  };
}
