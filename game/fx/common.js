// @ts-check
/** 特效公用：配色、程序生成的贴图、发光材质、随机与缓动。 */
import * as THREE from 'three';

/** 元素配色（RGB 0～1，见设计文档风格卡）；core 是最亮的内核色 */
export const PALETTE = {
  fire:   { primary: [1.0, 0.38, 0.08], secondary: [1.0, 0.8, 0.3],  core: [1.0, 0.95, 0.8],  sparkGravity: -9, emberGravity: 2.2 },
  ice:    { primary: [0.18, 0.6, 1.0],  secondary: [0.45, 0.88, 1.0], core: [0.8, 0.95, 1.0],  sparkGravity: -4, emberGravity: -0.6 },
  wind:   { primary: [0.3, 0.95, 0.65], secondary: [0.7, 1.0, 0.85],  core: [0.9, 1.0, 0.95],  sparkGravity: -2, emberGravity: 0.8 },
  earth:  { primary: [0.85, 0.55, 0.25], secondary: [1.0, 0.8, 0.5],  core: [1.0, 0.92, 0.8],  sparkGravity: -12, emberGravity: -2 },
  arcane: { primary: [0.62, 0.38, 1.0], secondary: [0.35, 0.85, 1.0], core: [1.0, 0.95, 1.0],  sparkGravity: -6, emberGravity: 0.4 },
};

/** @param {number[]} a @param {number} [k] */
export const col = (a, k = 1) => new THREE.Color(a[0] * k, a[1] * k, a[2] * k);
/** @param {number[]} a @param {number} k */
export const scaleArr = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

/** 可复现的伪随机（贴图图案固定） */
export function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
export const rand = (a, b) => a + Math.random() * (b - a);
/** 按"每秒多少个"发射，跟帧率和慢动作无关 */
export const perSec = (rate, dt) => { const x = rate * dt; return Math.floor(x) + (Math.random() < x % 1 ? 1 : 0); };
export function randDir(out = new THREE.Vector3()) {
  const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(th), u, s * Math.sin(th));
}
export const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const clamp01 = (t) => Math.min(1, Math.max(0, t));

/** @param {number} size @param {(g: CanvasRenderingContext2D, S: number) => void} draw */
export function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (g) draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

let _sigil = null, _arcs = null, _glow = null;

/** 主法阵：多重圆环 + 符文带 + 六芒星 + 刻度 */
export function sigilTex() {
  if (_sigil) return _sigil;
  _sigil = canvasTex(1024, (g, S) => {
    const C = S / 2, R = rng(7);
    g.translate(C, C);
    g.strokeStyle = g.fillStyle = '#fff';
    g.shadowColor = '#fff';
    g.shadowBlur = 10;
    const ring = (r, w) => { g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };
    ring(498, 7); ring(476, 2); ring(404, 3); ring(388, 1.5); ring(236, 3); ring(150, 2); ring(58, 3); ring(36, 1.5);
    const N = 30;
    for (let i = 0; i < N; i++) {
      g.save();
      g.rotate((i / N) * Math.PI * 2);
      g.translate(0, -440);
      g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath();
      g.moveTo(0, -20); g.lineTo(0, 20);
      const strokes = 1 + Math.floor(R() * 3);
      for (let k = 0; k < strokes; k++) {
        const y = -18 + R() * 32, dir = R() < 0.5 ? -1 : 1;
        g.moveTo(0, y); g.lineTo(dir * (8 + R() * 10), y + (R() < 0.5 ? -1 : 1) * (6 + R() * 10));
      }
      if (R() < 0.35) { g.moveTo(7, 0); g.arc(0, 0, 7, 0, Math.PI * 2); }
      g.stroke();
      g.restore();
    }
    g.lineWidth = 3;
    for (let t = 0; t < 2; t++) {
      g.beginPath();
      for (let k = 0; k <= 3; k++) {
        const a = -Math.PI / 2 + t * Math.PI / 3 + (k * Math.PI * 2) / 3;
        const x = Math.cos(a) * 388, y = Math.sin(a) * 388;
        if (k) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
    for (let k = 0; k < 6; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 3;
      g.beginPath(); g.arc(Math.cos(a) * 388, Math.sin(a) * 388, 22, 0, Math.PI * 2); g.stroke();
    }
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * Math.PI * 2, l = k % 6 === 0 ? 30 : 14;
      g.lineWidth = k % 6 === 0 ? 3 : 1.5;
      g.beginPath(); g.moveTo(Math.cos(a) * 236, Math.sin(a) * 236);
      g.lineTo(Math.cos(a) * (236 + l), Math.sin(a) * (236 + l)); g.stroke();
    }
    g.lineWidth = 2.5; g.beginPath();
    for (let k = 0; k <= 5; k++) {
      const a = -Math.PI / 2 + (k * 2 * Math.PI * 2) / 5;
      const x = Math.cos(a) * 150, y = Math.sin(a) * 150;
      if (k) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
  });
  return _sigil;
}

/** 外环：断续弧线与光点，反向旋转制造层次 */
export function arcsTex() {
  if (_arcs) return _arcs;
  _arcs = canvasTex(1024, (g, S) => {
    const C = S / 2, R = rng(19);
    g.translate(C, C);
    g.strokeStyle = g.fillStyle = '#fff';
    g.shadowColor = '#fff'; g.shadowBlur = 14; g.lineCap = 'round';
    for (let layer = 0; layer < 3; layer++) {
      const r = 500 - layer * 26;
      let a = R() * Math.PI;
      while (a < Math.PI * 2 + 0.2) {
        const len = 0.15 + R() * 0.6;
        g.lineWidth = layer === 0 ? 5 : 2.5;
        g.beginPath(); g.arc(0, 0, r, a, a + len); g.stroke();
        a += len + 0.08 + R() * 0.25;
      }
    }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      g.beginPath(); g.arc(Math.cos(a) * 425, Math.sin(a) * 425, 6, 0, Math.PI * 2); g.fill();
    }
  });
  return _arcs;
}

/** 柔光点 */
export function glowTex() {
  if (_glow) return _glow;
  _glow = canvasTex(256, (g, S) => {
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
  });
  return _glow;
}

/** 发光外壳：越侧对镜头越亮（菲涅尔）；vertical = 1 时沿高度渐隐（光柱用） */
export function glowShellMat(color, vertical = 0) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: color }, uAlpha: { value: 1 }, uVert: { value: vertical }, uFill: { value: 0.25 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz); vUv = uv; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha; uniform float uVert; uniform float uFill;
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){ float f = pow(1. - clamp(abs(dot(vN, vV)), 0., 1.), 2.2);
        float v = mix(1., pow(clamp(1. - vUv.y, 0., 1.), 2.5), uVert);
        gl_FragColor = vec4(uColor * (f * 2.2 + uFill) * v * uAlpha, 1.); }`,
  });
}

/** 地面冲击环 */
export function ringMat(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: color }, uAlpha: { value: 1 }, uThick: { value: 0.07 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha; uniform float uThick; varying vec2 vUv;
      void main(){ float r = length(vUv - 0.5) * 2.; if (r > 1.) discard;
        float ring = smoothstep(uThick, 0., abs(r - 0.9));
        float fill = smoothstep(0.95, 0.2, r) * 0.12;
        gl_FragColor = vec4(uColor * (ring + fill) * uAlpha, 1.); }`,
  });
}

/** 法阵贴图材质（叠加发光，初始透明） */
export function sigilMat(tex, color) {
  return new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, opacity: 0 });
}
