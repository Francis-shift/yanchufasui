// @ts-check
/**
 * 广场本体（10-23 照目标图 素材/概念图/山门广场-傍晚.webp 重做）：汉白玉台面、台沿浮雕、台底山石、石阶。
 * 贴图全用代码在画布上画，不占下载：
 *   - 台面：一圈圈扇形石板，正中刻阵纹（同心槽、卷云、八卦、刻度），刻槽里描金；抛光，夕阳下有光泽；
 *   - 台沿：一圈浮雕石板（框 + 卷云），上下两道线脚，石阶口断开；
 *   - 台底：往下收窄的山石，竖向起棱，凹处暗，朝上的面长青苔；
 *   - 入侵（风格卡"入侵进程"）：台面的裂缝和焦痕从敌人来的那一侧长出来，越往后越多，裂缝里透紫光（紫色只给敌人）。
 * 画布坐标按米画：原点在广场中心，x 向右、y 向下对应世界的 x、z（贴图翻转后正好对上圆面的贴图坐标）。
 */
import * as THREE from 'three';
import { rng } from '../fx/common.js';

/**
 * 画一张画布贴图。color：颜色贴图（sRGB）；否则是数据贴图（凹凸、粗糙度、损伤阈值，按原值读）
 * @param {number} w @param {number} h @param {(g: CanvasRenderingContext2D, w: number, h: number) => void} draw
 */
function paint(w, h, draw, color = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(/** @type {CanvasRenderingContext2D} */ (c.getContext('2d')), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------- 台面
/** 石板一圈一圈铺：[内半径, 外半径, 块数]；最外一圈是镶边，颜色深一点、粗糙一点 */
const RINGS = [[0, 1.25, 1], [1.25, 2.42, 8], [2.42, 4.62, 16], [4.62, 6.6, 24], [6.6, 8.5, 32], [8.5, 10.2, 40], [10.2, 11.05, 56]];
/** 先天八卦，从 -z（牌坊那边）起顺时针；每卦三爻从里到外，1 是阳（整条）0 是阴（断开） */
const TRIGRAMS = [[1, 1, 1], [0, 1, 1], [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1], [1, 1, 0]];

/**
 * 阵纹：所有刻槽的路径。line(宽, 画路径) 由调用方决定画成什么（颜色贴图里描金，凹凸贴图里压低）
 * @param {(w: number, path: (g: CanvasRenderingContext2D) => void) => void} line
 */
function engraving(line) {
  const circle = (r) => (g) => { g.moveTo(r, 0); g.arc(0, 0, r, 0, Math.PI * 2); };
  for (const r of [0.55, 1.12, 2.3, 2.55, 4.5, 4.75, 10.28, 10.97]) line(0.04, circle(r));
  // 正中：八条放射线，线间八个小圆
  line(0.035, (g) => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.moveTo(Math.cos(a) * 0.55, Math.sin(a) * 0.55); g.lineTo(Math.cos(a) * 1.12, Math.sin(a) * 1.12);
      const b = a + Math.PI / 8;
      g.moveTo(Math.cos(b) * 0.85 + 0.08, Math.sin(b) * 0.85); g.arc(Math.cos(b) * 0.85, Math.sin(b) * 0.85, 0.08, 0, Math.PI * 2);
    }
  });
  // 卷云：十二个往里卷的涡
  line(0.035, (g) => {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, cx = Math.cos(a) * 1.71, cy = Math.sin(a) * 1.71;
      for (let i = 0; i <= 40; i++) {
        const t = i / 40, rr = 0.36 * (1 - t * 0.85), th = a + Math.PI + t * Math.PI * 3;
        const x = cx + Math.cos(th) * rr, y = cy + Math.sin(th) * rr;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
    }
  });
  // 八卦：每卦三爻，沿切向的短条，阴爻中间断开
  line(0.12, (g) => {
    TRIGRAMS.forEach((bits, k) => {
      const a = -Math.PI / 2 + (k / 8) * Math.PI * 2, tx = -Math.sin(a), ty = Math.cos(a);
      bits.forEach((yang, j) => {
        const r = 3.05 + j * 0.45, cx = Math.cos(a) * r, cy = Math.sin(a) * r;
        for (const [s0, s1] of yang ? [[-0.5, 0.5]] : [[-0.5, -0.1], [0.1, 0.5]]) {
          g.moveTo(cx + tx * s0, cy + ty * s0); g.lineTo(cx + tx * s1, cy + ty * s1);
        }
      });
    });
  });
  // 刻度：两圈之间 64 道
  line(0.025, (g) => {
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2, r1 = k % 4 ? 4.62 : 4.75;
      g.moveTo(Math.cos(a) * 4.5, Math.sin(a) * 4.5); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    }
  });
  // 镶边上一串菱形
  line(0.03, (g) => {
    for (let k = 0; k < 120; k++) {
      const a = (k / 120) * Math.PI * 2, r = 10.62, d = 0.13;
      const p = (dr, da) => [Math.cos(a + da) * (r + dr), Math.sin(a + da) * (r + dr)];
      const pts = [p(d, 0), p(0, d / r), p(-d, 0), p(0, -d / r)];
      g.moveTo(pts[0][0], pts[0][1]); for (const q of pts.slice(1)) g.lineTo(q[0], q[1]); g.closePath();
    }
  });
}

/** 台面两张贴图：颜色、辅助（R 高度，G 粗糙度）。石板的色调和缝在两张里一一对应 @param {number} S @param {number} R */
function floorTextures(S, R) {
  const rnd = rng(23), slabs = [];
  RINGS.forEach(([r0, r1, n], ri) => {
    const off = rnd() * Math.PI * 2, edge = ri === RINGS.length - 1;
    for (let k = 0; k < n; k++) {
      slabs.push({ r0, r1, a0: off + (k / n) * Math.PI * 2, a1: off + ((k + 1) / n) * Math.PI * 2, edge,
        l: (edge ? 79 : 85) + rnd() * 5, s: 10 + rnd() * 6, rough: (edge ? 130 : 92) + rnd() * 26 });
    }
  });
  const sector = (g, s) => { g.beginPath(); if (s.r0 > 0) g.arc(0, 0, s.r0, s.a0, s.a1); else g.moveTo(0, 0); g.arc(0, 0, s.r1, s.a1, s.a0, true); g.closePath(); };
  const joints = (g) => {
    g.beginPath();
    for (const s of slabs) { if (s.r0 > 0) { g.moveTo(Math.cos(s.a0) * s.r0, Math.sin(s.a0) * s.r0); g.lineTo(Math.cos(s.a0) * s.r1, Math.sin(s.a0) * s.r1); } }
    for (const [r0] of RINGS) if (r0 > 0) { g.moveTo(r0, 0); g.arc(0, 0, r0, 0, Math.PI * 2); }
    g.stroke();
  };
  const toMeters = (g) => { const k = S / (2 * R); g.setTransform(k, 0, 0, k, S / 2, S / 2); g.lineCap = 'round'; };

  const color = paint(S, S, (g) => {
    g.fillStyle = '#8f877a'; g.fillRect(0, 0, S, S);
    toMeters(g);
    for (const s of slabs) { sector(g, s); g.fillStyle = `hsl(40, ${s.s}%, ${s.l}%)`; g.fill(); }
    // 汉白玉的细纹和斑点（同一个随机序列，每次打开都一样）
    const vr = rng(71);
    for (let i = 0; i < 320; i++) {
      const a = vr() * Math.PI * 2, r = Math.sqrt(vr()) * R, x = Math.cos(a) * r, y = Math.sin(a) * r, d = 0.4 + vr() * 1.4, b = vr() * Math.PI * 2;
      g.strokeStyle = `rgba(110, 100, 88, ${0.05 + vr() * 0.09})`; g.lineWidth = 0.006 + vr() * 0.016;
      g.beginPath(); g.moveTo(x, y);
      g.bezierCurveTo(x + Math.cos(b) * d * 0.4 + (vr() - 0.5) * 0.4, y + Math.sin(b) * d * 0.4 + (vr() - 0.5) * 0.4,
        x + Math.cos(b) * d * 0.7 + (vr() - 0.5) * 0.4, y + Math.sin(b) * d * 0.7 + (vr() - 0.5) * 0.4, x + Math.cos(b) * d, y + Math.sin(b) * d);
      g.stroke();
    }
    for (let i = 0; i < 2600; i++) {
      const a = vr() * Math.PI * 2, r = Math.sqrt(vr()) * R;
      g.fillStyle = `rgba(90, 80, 70, ${0.04 + vr() * 0.08})`;
      const d = 0.01 + vr() * 0.025; g.fillRect(Math.cos(a) * r, Math.sin(a) * r, d, d);
    }
    g.strokeStyle = 'rgba(96, 86, 74, 0.8)'; g.lineWidth = 0.028; joints(g);
    // 刻槽里描金：先一道暗边当槽的阴影，再一道金
    engraving((w, path) => {
      g.beginPath(); path(g);
      g.strokeStyle = 'rgba(92, 72, 44, 0.55)'; g.lineWidth = w + 0.025; g.stroke();
      g.strokeStyle = 'rgba(176, 134, 66, 0.92)'; g.lineWidth = w; g.stroke();
    });
    // 越靠台边越旧：一圈淡淡的灰
    const grad = g.createRadialGradient(0, 0, 8.6, 0, 0, R);
    grad.addColorStop(0, 'rgba(70, 60, 50, 0)'); grad.addColorStop(1, 'rgba(70, 60, 50, 0.16)');
    g.fillStyle = grad; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
  });
  const aux = paint(S, S, (g) => {
    g.fillStyle = 'rgb(200, 110, 0)'; g.fillRect(0, 0, S, S);
    toMeters(g);
    for (const s of slabs) { sector(g, s); g.fillStyle = `rgb(${s.edge ? 190 : 200}, ${Math.round(s.rough)}, 0)`; g.fill(); }
    g.strokeStyle = 'rgb(110, 225, 0)'; g.lineWidth = 0.03; joints(g);
    engraving((w, path) => {
      g.beginPath(); path(g);
      g.strokeStyle = 'rgb(150, 190, 0)'; g.lineWidth = w + 0.03; g.stroke();   // 槽口斜边
      g.strokeStyle = 'rgb(70, 140, 0)'; g.lineWidth = w; g.stroke();            // 槽底（描金的地方光一点）
    });
  }, false);
  return { color, aux };
}

/**
 * 入侵的损伤图：R 是这一处裂开时的入侵程度，G 是烧焦时的程度（255 = 永远不会）。
 * 用"取较暗"叠上去，重叠处取最早出现的那个；同一条裂缝越往里越晚，看上去是一点点裂进来的。
 * 裂缝从敌人来的那一侧（石阶口、索桥口所在的 -z、-x 半边）的台边往里长；焦痕撒在敌人走过的半边，最后一两波才烧到中间。
 * @param {number} S @param {number} R
 */
function damageTexture(S, R) {
  return paint(S, S, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
    const k = S / (2 * R); g.setTransform(k, 0, 0, k, S / 2, S / 2);
    g.globalCompositeOperation = 'darken';
    g.lineCap = 'round';
    const rnd = rng(97);
    const crack = (x, y, dir, len, t0, span, depth) => {
      let walked = 0;
      while (walked < len) {
        const step = 0.25 + rnd() * 0.3;
        dir += (rnd() - 0.5) * 0.9;
        const nx = x + Math.cos(dir) * step, ny = y + Math.sin(dir) * step;
        if (nx * nx + ny * ny > R * R) break;
        const t = Math.min(0.99, t0 + span * (walked / len));
        g.strokeStyle = `rgb(${Math.round(t * 255)}, 255, 255)`; g.lineWidth = 0.11 * (1 - 0.6 * walked / len) * (depth ? 0.6 : 1);
        g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
        if (depth < 2 && rnd() < 0.18) crack(nx, ny, dir + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6), len * 0.35, t, span * 0.6, depth + 1);
        x = nx; y = ny; walked += step;
      }
    };
    // 台边往里：敌人那半边（方位 -165°～-15°，也就是 z < 0 的一侧，偏左）
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI * (0.08 + 0.84 * rnd()) - (rnd() < 0.4 ? 0.3 : 0), r = R - 0.15;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      crack(x, y, a + Math.PI + (rnd() - 0.5) * 0.6, 2.5 + rnd() * 4, 0.22 + rnd() * 0.45, 0.3, 0);
    }
    // 最后一两波：广场中间也裂
    for (let i = 0; i < 6; i++) {
      const x = (rnd() - 0.5) * 12, y = -4 + rnd() * 8;
      crack(x, y, rnd() * Math.PI * 2, 1.5 + rnd() * 2.5, 0.72 + rnd() * 0.15, 0.12, 1);
    }
    // 焦痕：敌人走过的半边（z < 4），离阵眼远一点。每处是一团大小不一、互相叠着的斑（单个圆斑实测像地上的洞）
    for (let i = 0; i < 14; i++) {
      const x = (rnd() - 0.5) * 18, y = -9.5 + rnd() * 13.5, size = 0.6 + rnd() * 1.0, t0 = 0.32 + rnd() * 0.5;
      if (x * x + y * y > (R - 0.8) ** 2) continue;
      const n = 5 + Math.floor(rnd() * 5), stretch = rnd() * Math.PI;
      for (let j = 0; j < n; j++) {
        const d = size * rnd() * 0.6, a = stretch + (rnd() - 0.5) * 2.4 + (j % 2) * Math.PI;
        const bx = x + Math.cos(a) * d, by = y + Math.sin(a) * d * 0.6, rad = size * (0.55 + rnd() * 0.45), tj = t0 + (d / size) * 0.12;
        const grad = g.createRadialGradient(bx, by, 0, bx, by, rad);
        grad.addColorStop(0, `rgb(255, ${Math.round(Math.min(0.99, tj) * 255)}, 255)`);
        grad.addColorStop(0.6, `rgb(255, ${Math.round(Math.min(0.99, tj + 0.18) * 255)}, 255)`);
        grad.addColorStop(1, 'rgb(255, 255, 255)');
        g.fillStyle = grad; g.beginPath(); g.arc(bx, by, rad, 0, Math.PI * 2); g.fill();
      }
    }  }, false);
}

// ---------------------------------------------------------------- 台沿
/** 台沿浮雕：一块贴图是两块石板（凸起的框、凹进去的板心、板心里一朵卷云）；颜色和凹凸两张 */
function rimTextures(W, H) {
  const draw = (g, aux) => {
    const base = aux ? 'rgb(150, 150, 0)' : '#d3ccbf', frame = aux ? 'rgb(215, 140, 0)' : '#e2dccf', field = aux ? 'rgb(95, 165, 0)' : '#b9b1a3';
    const relief = aux ? 'rgb(235, 130, 0)' : '#e8e2d6';
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    const pw = W / 2, m = H * 0.12;
    for (let p = 0; p < 2; p++) {
      const x0 = p * pw;
      g.fillStyle = frame; g.fillRect(x0 + m * 0.5, m, pw - m, H - 2 * m);
      g.fillStyle = field; g.fillRect(x0 + m * 1.3, m * 1.8, pw - m * 2.6, H - m * 3.6);
      // 卷草纹：一道横走的波浪，两头往里卷，波峰波谷各抽出一个小卷（两个对称的涡加一道弧会看成笑脸，实测，不用）
      g.strokeStyle = relief; g.lineWidth = H * 0.055; g.lineCap = 'round';
      const xa = x0 + pw * 0.2, xb = x0 + pw * 0.8, cy = H / 2, A = H * 0.11;
      const spiral = (cx, cy0, r, start, turn) => {
        for (let i = 0; i <= 28; i++) {
          const t = i / 28, rr = r * (1 - t * 0.75), th = start + turn * t * Math.PI * 1.8;
          const x = cx + Math.cos(th) * rr, y = cy0 + Math.sin(th) * rr;
          if (i) g.lineTo(x, y); else g.moveTo(x, y);
        }
      };
      g.beginPath();
      for (let i = 0; i <= 40; i++) { const t = i / 40, x = xa + (xb - xa) * t, y = cy + Math.sin(t * Math.PI * 2) * A; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
      const r0 = H * 0.13;
      g.beginPath(); spiral(xa, cy + r0, r0, -Math.PI / 2, -1); g.stroke();             // 左头往下卷
      g.beginPath(); spiral(xb, cy - r0, r0, Math.PI / 2, -1); g.stroke();              // 右头往上卷
      g.beginPath(); spiral(xa + (xb - xa) * 0.25 + r0 * 0.6, cy + A - r0 * 0.2, r0 * 0.6, Math.PI, 1); g.stroke();
      g.beginPath(); spiral(xa + (xb - xa) * 0.75 - r0 * 0.6, cy - A + r0 * 0.2, r0 * 0.6, 0, 1); g.stroke();
    }    if (!aux) {   // 风化：上浅下深，雨水往下流的痕
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, 'rgba(60, 50, 40, 0)'); grad.addColorStop(1, 'rgba(60, 50, 40, 0.28)');
      g.fillStyle = grad; g.fillRect(0, 0, W, H);
      const r = rng(13);
      for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(70, 62, 52, ${0.05 + r() * 0.08})`; g.fillRect(r() * W, r() * H * 0.4, 1 + r() * 3, H * (0.3 + r() * 0.6)); }
    }
  };
  return { color: paint(W, H, (g) => draw(g, false)), aux: paint(W, H, (g) => draw(g, true), false) };
}

// ---------------------------------------------------------------- 山石
const hash3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
/** 三维值噪声（0～1） */
function vnoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

let _rockMat = /** @type {THREE.MeshStandardMaterial | null} */ (null);
/** 山石的入侵程度（广场和邻峰共用一份材质）：根部融进的云色跟着变紫黑 */
const ROCK_INV = { value: 0 };
/** 山石材质：顶点颜色给大块的明暗和青苔，一张平铺的裂纹贴图给近看的细节（同时当凹凸）；
 * 往下融进云色（云海是不透明的平面，不融的话山石插进去是一刀切的直线；meltIntoClouds） */
function rockMaterial() {
  if (_rockMat) return _rockMat;
  const detail = paint(512, 512, (g, S) => {
    g.fillStyle = '#d8d6d2'; g.fillRect(0, 0, S, S);
    const r = rng(31);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '40,38,36'}, ${0.04 + r() * 0.08})`; g.beginPath(); g.ellipse(r() * S, r() * S, 3 + r() * 16, 2 + r() * 8, 0, 0, Math.PI * 2); g.fill(); }   // 圆斑（方块斑实测像马赛克）
    g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {   // 岩层：几道横的浅色带
      const y = r() * S; g.fillStyle = `rgba(255, 250, 240, ${0.05 + r() * 0.07})`; g.fillRect(0, y, S, 3 + r() * 10);
    }
    for (let i = 0; i < 60; i++) {   // 裂纹，多半是横的（岩层），淡一点、少一点，近看才有
      let x = r() * S, y = r() * S;
      g.strokeStyle = `rgba(30, 28, 26, ${0.12 + r() * 0.2})`; g.lineWidth = 1 + r() * 1.8;
      g.beginPath(); g.moveTo(x, y);
      const horiz = r() < 0.7;
      for (let k = 0; k < 6; k++) { x += horiz ? 8 + r() * 18 : (r() - 0.5) * 12; y += horiz ? (r() - 0.5) * 8 : 8 + r() * 14; g.lineTo(x, y); }
      g.stroke();
    }
  });
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.repeat.set(16, 4);
  _rockMat = meltIntoClouds(new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, bumpMap: detail, bumpScale: 2.5, roughness: 0.95 }));
  return _rockMat;
}

/**
 * 让山石往下融进云色（入侵时云色跟着变紫黑）。广场台底、邻峰（代码石头和换上的山石模型，props.js）共用。
 * @template {THREE.Material} M @param {M} m @returns {M}
 */
export function meltIntoClouds(m) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uInv = ROCK_INV;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWy;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWy = (modelMatrix * vec4(transformed, 1.)).y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWy; uniform float uInv;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(vec3(0.58, 0.54, 0.56), vec3(0.05, 0.035, 0.08), smoothstep(0.3, 0.7, uInv)), smoothstep(-4.5, -9., vWy));`);
  };
  return m;
}

/**
 * 一段山石：往下收窄的圆柱，表面按噪声起伏、竖向起棱、一层层的岩檐。位移只按方位和高度算，接缝不裂。
 * 顶点颜色：凹处、低处暗，朝上的面长青苔。顶和底都敞着（顶上压着台面，底下没进云里）。
 * @param {number} rTop @param {number} rBottom @param {number} h @param {number} seed
 */
export function rockColumn(rTop, rBottom, h, seed) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, 64, 18, true);
  const p = g.attributes.position, R = rng(seed), ph = Array.from({ length: 5 }, () => R() * 50);
  const ks = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = y / h + 0.5, ang = Math.atan2(z, x), ca = Math.cos(ang), sa = Math.sin(ang);
    const n = vnoise3(ca * 2.2 + ph[0], y * 0.22 + ph[1], sa * 2.2) * 0.6 + vnoise3(ca * 5 + ph[2], y * 0.55, sa * 5 + ph[3]) * 0.4;
    const ledge = Math.max(0, Math.sin((t * 5 + ph[4]) * Math.PI * 2)) ** 6 * 0.06;   // 一层层的岩檐
    const top = Math.min(1, (1 - t) / 0.2) ** 1.5;                                    // 顶上一段收住，压在台面下面（不然像蘑菇）
    const ridges = 0.05 * Math.sin(ang * 9 + ph[0] + t * 3) + 0.035 * Math.sin(ang * 23 + ph[2] + t * 7);   // 竖向的棱
    const k = 1 + ((n - 0.5) * 0.3 + ridges + ledge) * top - 0.05 * (1 - top);
    ks[i] = k;
    p.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  const nrm = g.attributes.normal, col = new Float32Array(p.count * 3);
  const light = new THREE.Color(0.52, 0.49, 0.44), dark = new THREE.Color(0.2, 0.2, 0.22), moss = new THREE.Color(0.27, 0.32, 0.17), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / h + 0.5;
    c.copy(dark).lerp(light, Math.min(1, Math.max(0, (ks[i] - 0.86) / 0.26)));
    const up = Math.min(1, Math.max(0, (nrm.getY(i) - 0.2) / 0.4));
    c.lerp(moss, up * 0.75).multiplyScalar(0.7 + 0.3 * t);
    c.toArray(col, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, rockMaterial());
  m.castShadow = m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- 组装
/**
 * @param {THREE.Scene} scene
 * @param {{ R: number, stairs: { halfW: number, zTop: number, zBottom: number, yBottom: number }, tex: number }} o tex：台面贴图边长（电影档 2048、流畅档 1024）
 */
export function buildPlaza(scene, o) {
  const { R, stairs: ST } = o;
  const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const inv = { value: 0 }, time = { value: 0 };

  // 台面
  const floor = floorTextures(o.tex, R), damage = damageTexture(Math.min(1024, o.tex), R);
  const floorMat = new THREE.MeshStandardMaterial({ map: floor.color, roughnessMap: floor.aux, bumpMap: floor.aux, bumpScale: 1.2, roughness: 1 });
  floorMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uDamage: { value: damage }, uInv: inv, uTime: time });
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uDamage; uniform float uInv; uniform float uTime;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 dmg = texture2D(uDamage, vMapUv).rg;
        float crack = smoothstep(dmg.r - 0.02, dmg.r + 0.02, uInv) * step(dmg.r, 0.99);
        float scorch = clamp((uInv - dmg.g) / 0.2, 0., 1.) * step(dmg.g, 0.99);   // 软边：阈值比当前程度低得越多越黑（硬边实测像地上的洞）
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.09, 0.07), scorch * scorch * 0.6);
        diffuseColor.rgb *= 1. - 0.85 * crack;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = max(roughnessFactor, max(crack, scorch * 0.9));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.55, 0.18, 1.0) * crack * smoothstep(0.35, 0.8, uInv) * (0.5 + 0.3 * sin(uTime * 2.3 + vMapUv.x * 40.));`);
  };
  const top = new THREE.Mesh(new THREE.CircleGeometry(R, 96), floorMat);
  top.rotation.x = -Math.PI / 2;
  top.receiveShadow = true;
  scene.add(top);

  // 台沿：石阶口断开（圆柱的角度从 +z 起算，-z 方向是 π）
  const RR = R + 0.12, H = 1.25, gap = Math.asin((ST.halfW + 0.35) / RR), t0 = Math.PI + gap, tl = Math.PI * 2 - 2 * gap;
  const rimTex = rimTextures(1024, 256);
  for (const t of [rimTex.color, rimTex.aux]) { t.wrapS = THREE.RepeatWrapping; t.repeat.set(Math.round((RR * tl) / 4.6), 1); }
  const band = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(RR, RR, H, 192, 1, true, t0, tl),
    new THREE.MeshStandardMaterial({ map: rimTex.color, bumpMap: rimTex.aux, bumpScale: 3, roughnessMap: rimTex.aux, roughness: 1 })));
  band.position.y = -H / 2 - 0.04;
  scene.add(band);
  const marble = new THREE.MeshStandardMaterial({ color: 0xe2dbce, roughness: 0.5 });
  const lip = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(RR + 0.1, RR + 0.1, 0.16, 192, 1, true, t0, tl), marble));
  lip.position.y = -0.08;
  // 线脚的顶面：一圈平的石条（圆环在 XY 平面里，转平以后 -z 方向是 π/2）
  const lipTop = new THREE.Mesh(new THREE.RingGeometry(R - 0.02, RR + 0.1, 192, 1, Math.PI / 2 + gap, tl), marble);
  lipTop.rotation.x = -Math.PI / 2;
  lipTop.position.y = 0.002;
  lipTop.receiveShadow = true;
  const foot = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(RR + 0.04, RR - 0.18, 0.26, 192, 1, true, t0, tl), marble));
  foot.position.y = -H - 0.17;
  scene.add(lip, lipTop, foot);

  // 台底山石：顶上收在台沿里面，往下收窄插进云海（山石模型到了换掉，见 layout.js PROP_SPOTS.base）
  const cliff = rockColumn(R - 0.45, 5.5, 21, 7);
  cliff.position.y = -H - 0.3 - 10.5;
  scene.add(cliff);

  // 石阶：汉白玉，两侧一道矮石边（之后摆 Tripo 的栏杆）
  const N = 16, depth = (ST.zTop - ST.zBottom) / N, rise = -ST.yBottom / N;
  const stepMat = new THREE.MeshStandardMaterial({ color: 0xe0d9cc, roughness: 0.55 });
  const steps = new THREE.InstancedMesh(new THREE.BoxGeometry(ST.halfW * 2, rise, depth), stepMat, N);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    m4.makeTranslation(0, -rise * (i + 0.5) - 0.01, ST.zTop - depth * (i + 0.5));   // 低 1 厘米：第一级顶面不和台面打架
    steps.setMatrixAt(i, m4);
  }
  steps.castShadow = steps.receiveShadow = true;
  scene.add(steps);
  const slope = Math.atan2(-ST.yBottom, ST.zTop - ST.zBottom), len = Math.hypot(-ST.yBottom, ST.zTop - ST.zBottom);
  const darkMarble = new THREE.MeshStandardMaterial({ color: 0xa9a194, roughness: 0.8 });
  const ramp = shadowy(new THREE.Mesh(new THREE.BoxGeometry(ST.halfW * 2 + 0.6, 4, len + 1), darkMarble));
  ramp.position.set(0, ST.yBottom / 2 - 2.1, (ST.zTop + ST.zBottom) / 2);
  ramp.rotation.x = -slope;   // 靠广场（+z）那头高
  scene.add(ramp);
  for (const s of [-1, 1]) {
    const curb = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, len + 0.3), stepMat));
    curb.position.set(s * (ST.halfW + 0.25), ST.yBottom / 2 + 0.2, (ST.zTop + ST.zBottom) / 2);
    curb.rotation.x = -slope;
    scene.add(curb);
  }

  return {
    /** 台底山石（props.js 换成模型以后藏起来） */
    base: cliff,
    /** 入侵程度（world/invasion.js）：台面裂缝、焦痕跟着长 @param {number} k */
    setInvasion(k) { inv.value = k; ROCK_INV.value = k; },
    /** @param {number} dt 游戏时间 */
    update(dt) { time.value += dt; },
  };
}
