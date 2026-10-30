// @ts-check
/**
 * 广场本体（10-23 照目标图 素材/概念图/山门广场-傍晚.webp 重做）：汉白玉台面、台沿浮雕、台底山石、石阶。
 * 贴图大多用代码在画布上画，不占下载：
 *   - 台面：一圈圈扇形石板，正中刻阵纹（同心槽、卷云、八卦、刻度），刻槽里描金；抛光，夕阳下有光泽；
 *     缝口倒斜边、积灰，边角有崩口；常走的路磨光、东西脚下积灰（生活痕迹图）；
 *     台边石缝里长青苔、落着干松针，香炉脚下有香灰；着色器里再加飘过的云影；
 *     石面的细纹、凹坑和大理石纹叠一层实拍的 CC0 贴图（三张共约 160 KB，跟模型一起下载，见 useStoneMaps）；
 *   - 台沿：一圈浮雕石板（框 + 卷云），上下两道线脚，石阶口断开；
 *   - 台底：往下收窄的山石，竖向起棱，凹处暗，朝上的面长青苔；
 *   - 入侵（风格卡"入侵进程"）：台面的裂缝和焦痕从敌人来的那一侧长出来，越往后越多，裂缝里透紫光（紫色只给敌人）。
 * 画布坐标按米画：原点在广场中心，x 向右、y 向下对应世界的 x、z（贴图翻转后正好对上圆面的贴图坐标）。
 */
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
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

/**
 * 台面两张贴图：颜色、辅助（R 高度，G 粗糙度，B 石板编号：着色器按它给每块石板转一个角度叠石纹，缝里是 0）。
 * 石板的色调和缝在两张里一一对应
 * @param {number} S @param {number} R @param {number[][]} [rings] 石板怎么铺（邻峰落脚台另给一套） @param {boolean} [engrave] 刻不刻阵纹
 * @param {number[][]} [ash] 香炉脚下的香灰 [x, z, 半径]
 */
function floorTextures(S, R, rings = RINGS, engrave = true, ash = []) {
  const rnd = rng(23), idr = rng(41), slabs = [], dens = (R / 11) ** 2;   // 斑点、崩口按面积撒，小台子不会更脏
  rings.forEach(([r0, r1, n], ri) => {
    const off = rnd() * Math.PI * 2, edge = ri === rings.length - 1;
    for (let k = 0; k < n; k++) {
      slabs.push({ r0, r1, a0: off + (k / n) * Math.PI * 2, a1: off + ((k + 1) / n) * Math.PI * 2, edge,
        l: (edge ? 79 : 85) + rnd() * 5, s: 10 + rnd() * 6, rough: (edge ? 130 : 92) + rnd() * 26, id: 16 + Math.floor(idr() * 240) });
    }
  });
  // 崩口：石板边角上磕掉的小块（跨在缝上，露出新鲜的白茬）
  const chips = [];
  for (let i = 0; i < 70 * dens; i++) {
    const s = slabs[Math.floor(idr() * slabs.length)];
    if (!s.r0) continue;
    const onArc = idr() < 0.5, a = onArc ? s.a0 + (s.a1 - s.a0) * (0.15 + idr() * 0.7) : s.a0, r = onArc ? s.r1 : s.r0 + (s.r1 - s.r0) * idr();
    const size = 0.03 + idr() * 0.05, pts = [];
    for (let j = 0; j < 6; j++) { const b = (j / 6) * Math.PI * 2, d = size * (0.5 + idr() * 0.6); pts.push([Math.cos(a) * r + Math.cos(b) * d, Math.sin(a) * r + Math.sin(b) * d]); }
    chips.push(pts);
  }
  /** @param {CanvasRenderingContext2D} g */
  const chipPaths = (g) => { g.beginPath(); for (const p of chips) { g.moveTo(p[0][0], p[0][1]); for (const q of p.slice(1)) g.lineTo(q[0], q[1]); g.closePath(); } };
  const sector = (g, s) => { g.beginPath(); if (s.r0 > 0) g.arc(0, 0, s.r0, s.a0, s.a1); else g.moveTo(0, 0); g.arc(0, 0, s.r1, s.a1, s.a0, true); g.closePath(); };
  const joints = (g) => {
    g.beginPath();
    for (const s of slabs) { if (s.r0 > 0) { g.moveTo(Math.cos(s.a0) * s.r0, Math.sin(s.a0) * s.r0); g.lineTo(Math.cos(s.a0) * s.r1, Math.sin(s.a0) * s.r1); } }
    for (const [r0] of rings) if (r0 > 0) { g.moveTo(r0, 0); g.arc(0, 0, r0, 0, Math.PI * 2); }
    g.stroke();
  };
  const toMeters = (g) => { const k = S / (2 * R); g.setTransform(k, 0, 0, k, S / 2, S / 2); g.lineCap = 'round'; };

  const color = paint(S, S, (g) => {
    g.fillStyle = '#8f877a'; g.fillRect(0, 0, S, S);
    toMeters(g);
    for (const s of slabs) { sector(g, s); g.fillStyle = `hsl(40, ${s.s}%, ${s.l}%)`; g.fill(); }
    // 斑点（同一个随机序列，每次打开都一样）；石纹交给实拍的大理石贴图（着色器里叠）
    const vr = rng(71);
    for (let i = 0; i < 2600 * dens; i++) {
      const a = vr() * Math.PI * 2, r = Math.sqrt(vr()) * R;
      g.fillStyle = `rgba(90, 80, 70, ${0.04 + vr() * 0.08})`;
      const d = 0.01 + vr() * 0.025; g.fillRect(Math.cos(a) * r, Math.sin(a) * r, d, d);
    }
    // 缝：两边斜口里积的灰，再一道深缝；崩口是新鲜的白茬，描一圈暗边
    g.strokeStyle = 'rgba(96, 86, 74, 0.22)'; g.lineWidth = 0.085; joints(g);
    g.strokeStyle = 'rgba(96, 86, 74, 0.8)'; g.lineWidth = 0.028; joints(g);
    chipPaths(g); g.fillStyle = 'rgba(238, 233, 222, 0.9)'; g.fill();
    g.strokeStyle = 'rgba(84, 74, 62, 0.45)'; g.lineWidth = 0.006; g.stroke();
    // 青苔：靠台边两圈（没人走、背阴潮）的缝里长出一段段，缝交叉处一小团。
    // 一段是一串大小不一的小点（画成一根线像掉了根棍子）
    const mr = rng(61);
    const moss = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w) => {
      g.fillStyle = `rgba(${60 + mr() * 26}, ${80 + mr() * 22}, ${34 + mr() * 12}, ${0.35 + mr() * 0.35})`;
      g.beginPath(); g.arc(x + (mr() - 0.5) * w, y + (mr() - 0.5) * w, 0.008 + mr() * w * 0.45, 0, Math.PI * 2); g.fill();
    };
    for (const s of slabs) {
      if (s.r0 < R - 2.6 || mr() > 0.45) continue;
      const r0 = s.r0 + (s.r1 - s.r0) * mr() * 0.5, r1 = r0 + (s.r1 - s.r0) * (0.25 + mr() * 0.5), c = Math.cos(s.a0), sn = Math.sin(s.a0);
      const w = 0.03 + mr() * 0.03;
      for (let r = r0; r < r1; r += 0.012) moss(c * r, sn * r, w * (0.5 + 0.5 * Math.sin(((r - r0) / (r1 - r0)) * Math.PI)));
      if (mr() < 0.5) for (let j = 0; j < 14; j++) moss(c * s.r0, sn * s.r0, 0.1);
    }
    // 落下的干松针：台边一簇簇（被风吹到栏杆脚下），台中间零星几根
    for (let i = 0; i < 90 * dens; i++) {
      const a = mr() * Math.PI * 2, r = i % 6 ? R - 0.25 - mr() * 1.4 : Math.sqrt(mr()) * R, cx = Math.cos(a) * r, cy = Math.sin(a) * r;
      for (let j = 0, n = 3 + Math.floor(mr() * 7); j < n; j++) {   // 松针两根一束，根部并在一起
        const x = cx + (mr() - 0.5) * 0.25, y = cy + (mr() - 0.5) * 0.25, b = mr() * Math.PI * 2, l = 0.06 + mr() * 0.05, open = 0.12 + mr() * 0.3;
        g.strokeStyle = mr() < 0.7 ? `rgba(${110 + mr() * 30}, ${72 + mr() * 18}, 38, 0.85)` : 'rgba(78, 86, 44, 0.8)'; g.lineWidth = 0.008;
        g.beginPath();
        for (const t of [b, b + open]) { g.moveTo(x, y); g.lineTo(x + Math.cos(t) * l, y + Math.sin(t) * l); }
        g.stroke();
      }
    }
    // 香灰：从香炉里落下来、被风吹向下风处（+x、+z，跟云影同向），炉身外露出一片灰，再撒些深浅不一的灰点；
    // 几根插剩的红香脚
    for (const [x, z, r] of ash) {
      const ox = x + r * 0.7, oz = z + r * 0.5;
      g.save(); g.translate(ox, oz); g.rotate(Math.atan2(0.5, 0.7)); g.scale(1.6, 1);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r * 1.2);
      gr.addColorStop(0, 'rgba(122, 118, 112, 0.6)'); gr.addColorStop(0.6, 'rgba(130, 126, 120, 0.35)'); gr.addColorStop(1, 'rgba(130, 126, 120, 0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r * 1.2, 0, Math.PI * 2); g.fill(); g.restore();
      for (let j = 0; j < 260; j++) {
        const a = mr() * Math.PI * 2, d = Math.sqrt(mr()) * r * 1.5;
        g.fillStyle = mr() < 0.6 ? 'rgba(92, 88, 84, 0.65)' : 'rgba(225, 222, 216, 0.75)';
        g.fillRect(ox + Math.cos(a) * d * 1.3, oz + Math.sin(a) * d, 0.008 + mr() * 0.014, 0.008 + mr() * 0.014);
      }
      g.lineWidth = 0.01;
      for (let j = 0; j < 7; j++) {
        const a = mr() * Math.PI * 2, d = r * (1 + mr() * 0.8), b = mr() * Math.PI, l = 0.08 + mr() * 0.08, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
        g.strokeStyle = `rgba(${150 + mr() * 30}, ${42 + mr() * 16}, 34, 0.9)`;
        g.beginPath(); g.moveTo(px, pz); g.lineTo(px + Math.cos(b) * l, pz + Math.sin(b) * l); g.stroke();
      }
    }
    // 刻槽里描金：先一道暗边当槽的阴影，再一道金
    if (engrave) engraving((w, path) => {
      g.beginPath(); path(g);
      g.strokeStyle = 'rgba(92, 72, 44, 0.55)'; g.lineWidth = w + 0.025; g.stroke();
      g.strokeStyle = 'rgba(176, 134, 66, 0.92)'; g.lineWidth = w; g.stroke();
    });
    // 越靠台边越旧：一圈淡淡的灰
    const grad = g.createRadialGradient(0, 0, R - 2.4, 0, 0, R);
    grad.addColorStop(0, 'rgba(70, 60, 50, 0)'); grad.addColorStop(1, 'rgba(70, 60, 50, 0.16)');
    g.fillStyle = grad; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
  });
  const aux = paint(S, S, (g) => {
    g.fillStyle = 'rgb(200, 110, 0)'; g.fillRect(0, 0, S, S);
    toMeters(g);
    for (const s of slabs) { sector(g, s); g.fillStyle = `rgb(${s.edge ? 190 : 200}, ${Math.round(s.rough)}, ${s.id})`; g.fill(); }
    // 缝口倒斜边：乘法只压低高度（R）、滤色只加粗糙（G），石板编号（B）不动；最里一道缝底编号清零
    g.globalCompositeOperation = 'multiply';
    g.strokeStyle = 'rgb(220, 255, 255)'; g.lineWidth = 0.08; joints(g);
    g.strokeStyle = 'rgb(205, 255, 255)'; g.lineWidth = 0.05; joints(g);
    g.globalCompositeOperation = 'screen';
    g.strokeStyle = 'rgb(0, 70, 0)'; g.lineWidth = 0.07; joints(g);
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgb(110, 225, 0)'; g.lineWidth = 0.03; joints(g);
    chipPaths(g); g.fillStyle = 'rgb(160, 205, 0)'; g.fill();
    if (engrave) engraving((w, path) => {
      g.beginPath(); path(g);
      g.strokeStyle = 'rgb(150, 190, 0)'; g.lineWidth = w + 0.03; g.stroke();   // 槽口斜边
      g.strokeStyle = 'rgb(70, 140, 0)'; g.lineWidth = w; g.stroke();            // 槽底（描金的地方光一点）
    });
  }, false);
  return { color, aux };
}

/**
 * 生活痕迹（R 走得多、磨光了的地方，G 积灰，B 雨后积水）：按米画，跟台面贴图同一套坐标。
 * 叠加着画（'lighter'），三个通道互不干扰
 * @param {number} S @param {number} R @param {Wear} wear
 * @typedef {{ walks?: { pts: number[][], w: number }[], grime?: number[][], pools?: number[][] }} Wear
 *   walks：常走的路（折线 [x, z]、宽）；grime：东西脚下 [x, z, 横半径, 纵半径]；pools：水洼 [x, z, 横半径, 纵半径]
 */
function wearTexture(S, R, wear) {
  return paint(S, S, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    const k = S / (2 * R); g.setTransform(k, 0, 0, k, S / 2, S / 2);
    g.globalCompositeOperation = 'lighter';
    // 水洼：一大六小几团软边叠起来，着色器按 0.5 取水边（实拍贴图到了再按石面明暗抖一抖；没到也不是光溜溜的椭圆），水边外一圈是湿的
    const pr = rng(53);
    for (const [x, z, rx, rz] of wear.pools ?? []) {
      for (let i = 0; i < 7; i++) {
        const a = pr() * Math.PI * 2, d = i ? 0.3 + pr() * 0.6 : 0, s = i ? 0.3 + pr() * 0.35 : 0.85;
        g.save(); g.translate(x + Math.cos(a) * d * rx, z + Math.sin(a) * d * rz); g.scale(rx * s, rz * s);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1.6);   // 单独一团水边在 0.8 倍半径
        gr.addColorStop(0, 'rgba(0, 0, 255, 1)'); gr.addColorStop(1, 'rgba(0, 0, 255, 0)');
        g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1.6, 0, Math.PI * 2); g.fill();
        g.restore();
      }
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    // 路：宽窄不同的几层淡笔叠起来，中间磨得最光、往两边渐淡
    for (const { pts, w } of wear.walks ?? []) {
      for (let i = 0; i < 6; i++) {
        g.strokeStyle = 'rgba(255, 0, 0, 0.13)'; g.lineWidth = w * (1.4 - i * 0.2);
        g.beginPath(); pts.forEach(([x, z], j) => (j ? g.lineTo(x, z) : g.moveTo(x, z))); g.stroke();
      }
    }
    // 东西脚下：椭圆的软边
    for (const [x, z, rx, rz] of wear.grime ?? []) {
      g.save(); g.translate(x, z); g.scale(rx, rz);
      const gr = g.createRadialGradient(0, 0, 0.5, 0, 0, 1.35);
      gr.addColorStop(0, 'rgba(0, 210, 0, 1)'); gr.addColorStop(1, 'rgba(0, 210, 0, 0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1.35, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    // 台边一圈（栏杆脚下，没人走）
    const rim = g.createRadialGradient(0, 0, R - 1.8, 0, 0, R);
    rim.addColorStop(0, 'rgba(0, 0, 0, 0)'); rim.addColorStop(1, 'rgba(0, 160, 0, 1)');
    g.fillStyle = rim; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
  }, false);
}

/**
 * 实拍的石材细节（10-24 本人嫌台面"太塑料"：太平、太匀、反光一个样）。CC0 贴图，props.js 跟模型一起下载，到了交给 useStoneMaps；
 * 没到之前 uStone = 0，台面只有代码画的那层：
 *   - 法线、细节（R 凹坑的 AO、G 粗糙度、B 明暗）取自 Poly Haven 的 plaster_grey_04（风化的灰白石面），1.6 米铺一块；
 *   - 颜色取自 ambientCG 的 Marble014（米白大理石带浅褐纹），每块石板按编号转个角度、错开一段，石纹不跨缝。
 * 下载后怎么压成三张小图见 docs/设计文档.md 的素材来源
 */
const flat = (/** @type {number[]} */ ...c) => { const t = new THREE.DataTexture(new Uint8Array([...c, 255]), 1, 1); t.needsUpdate = true; return /** @type {THREE.Texture} */ (t); };
const STONE = { n: { value: flat(128, 128, 255) }, d: { value: flat(122, 212, 128) }, m: { value: flat(209, 196, 177) }, on: { value: 0 } };
/** @param {THREE.Texture} n 法线 @param {THREE.Texture} d 细节 @param {THREE.Texture} m 大理石颜色（sRGB） */
export function useStoneMaps(n, d, m) {
  for (const t of [n, d, m]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; }
  STONE.n.value = n; STONE.d.value = d; STONE.m.value = m; STONE.on.value = 1;
}

/**
 * 两块台面共用：时间（水洼里的涟漪）、入侵程度（倒影染紫）、平面反射（电影档才有，见 buildPlaza 的 reflect；
 * 流畅档 uReflOn = 0，水洼只照出环境贴图里的天）。meshes：反射那一遍要先藏起来的台面（它们自己要读这张图）
 */
const FLOOR = { time: { value: 0 }, inv: { value: 0 }, refl: { value: flat(0, 0, 0) }, reflMat: { value: new THREE.Matrix4() }, reflOn: { value: 0 }, glint: { value: 1 },
  /** @type {THREE.Object3D[]} */ meshes: [] };

/**
 * 台面材质：代码画的石板（颜色、凹凸、粗糙度、编号）叠上实拍石材、生活痕迹和雨后积水。
 * 细节贴图大理石那张的平均色（线性）是 (0.63, 0.55, 0.43)，除掉它只留明暗起伏；细节的 AO 均值 0.48、粗糙度均值 0.83，同样只取起伏。
 * 积水（生活痕迹图 B）：过 0.5 是水，按石面明暗抖出不规则的水边；水边外一圈湿的（发暗、光一点）；水边一薄层透出湿石头、越往里倒影越清楚；
 * 水面有风吹的细波，偶尔一滴水落下荡开一圈涟漪；云影只落在台面上（竖着的物件不跟着暗，只做了地面）；
 * 倒影：电影档用平面反射换掉环境反射，跟着波纹扭、稍微糊开、偏暗偏黄（10-25 本人说原来像镜子）；菲涅耳仍比真水夸张一倍（游戏机位俯看约 25°，真水只反 5%～10%，
 * 照出来的天跟晒亮的石面差不多亮，从游戏机位几乎看不出水洼）；流畅档水面的环境反射也按这个量
 * @param {{ color: THREE.Texture, aux: THREE.Texture }} floor @param {THREE.Texture} wear @param {number} R
 * @param {{ uniforms: Record<string, { value: any }>, decl: string, color: string, rough: string, metal: string, emissive: string }} [extra] 广场的入侵损伤与阵纹
 */
function stoneFloor(floor, wear, R, extra) {
  const mat = new THREE.MeshStandardMaterial({ map: floor.color, roughnessMap: floor.aux, bumpMap: floor.aux, bumpScale: 1.2, roughness: 1 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uStoneN: STONE.n, uStoneD: STONE.d, uStoneM: STONE.m, uStone: STONE.on, uWear: { value: wear }, uR: { value: R },
      uFloorTime: FLOOR.time, uFloorInv: FLOOR.inv, uRefl: FLOOR.refl, uReflMat: FLOOR.reflMat, uReflOn: FLOOR.reflOn, uGlint: FLOOR.glint }, extra?.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uReflMat; varying vec4 vRefl;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRefl = uReflMat * modelMatrix * vec4(transformed, 1.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uStoneN, uStoneD, uStoneM, uWear, uRefl; uniform float uStone, uR, uFloorTime, uFloorInv, uReflOn, uGlint; varying vec4 vRefl;
        float sHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float sNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          return mix(mix(sHash(i), sHash(i + vec2(1., 0.)), f.x), mix(sHash(i + vec2(0., 1.)), sHash(i + 1.), f.x), f.y); }${extra?.decl ?? ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 sp = (vMapUv * 2. - 1.) * uR;                     // 台面上的位置（米）
        float sId = texture2D(roughnessMap, vMapUv).b;
        vec3 sDet = texture2D(uStoneD, sp / 1.6).rgb, sWear = texture2D(uWear, vMapUv).rgb;
        float sOn = uStone * smoothstep(0.03, 0.06, sId), sa = sId * 97.;   // 缝底、刻槽里编号是 0，不叠石纹
        mat2 sRot = mat2(cos(sa), sin(sa), -sin(sa), cos(sa));
        vec2 mp = sRot * sp / 2.6 + fract(vec2(sId * 13.7, sId * 7.3)) * 4.;
        vec3 sMarble = textureGrad(uStoneM, mp, sRot * dFdx(sp) / 2.6, sRot * dFdy(sp) / 2.6).rgb / vec3(0.63, 0.55, 0.43);
        diffuseColor.rgb *= mix(vec3(1.), clamp(sMarble, 0.4, 1.3), 0.9 * sOn);
        diffuseColor.rgb *= 1. + uStone * (0.06 * clamp((sDet.r - 0.48) / 0.06, -2.5, 1.5) + 0.04 * (sDet.b - 0.5) / 0.157) + 0.05 * sWear.r;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.72, 0.66, 0.58), sWear.g);
        float sWet = sWear.b + uStone * (0.5 * texture2D(uStoneD, sp / 0.9 + 0.37).b + 0.4 * texture2D(uStoneD, sp / 3.1 + 0.71).b - 0.45);   // 两层石面明暗把水边抖得不规则（约 ±0.25 米）
        // 水；水边外一圈湿的；deep 是水多深：水边一薄层透出底下的湿石头，往里才渐渐照得出东西（一下子满反射像贴了块镜子）
        float pool = smoothstep(0.49, 0.54, sWet), damp = smoothstep(0.3, 0.5, sWet), deep = smoothstep(0.5, 0.7, sWet);
        diffuseColor.rgb *= 1. - 0.25 * damp - 0.2 * deep;   // 湿石头发深；水底再深一点，倒影才托得出来
        ${extra?.color ?? ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= 1. + uStone * 0.3 * clamp((sDet.g - 0.832) / 0.06, -2., 2.);
        roughnessFactor = max(roughnessFactor * (1. - 0.35 * sWear.r), 0.24);   // 走得多的地方磨光，夕阳下亮一条；再光就成镜子，朝太阳看白成一片
        roughnessFactor = mix(roughnessFactor, max(roughnessFactor, 0.8), sWear.g);
        roughnessFactor = mix(mix(roughnessFactor, roughnessFactor * 0.6, damp), mix(0.14, 0.05, deep), pool);   // 水边的薄水膜里石面还冒头，没那么光
        ${extra?.rough ?? ''}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        ${extra?.metal ?? ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 sTx = normalize((viewMatrix * vec4(1., 0., 0., 0.)).xyz), sTz = normalize((viewMatrix * vec4(0., 0., 1., 0.)).xyz);
        vec3 sN = texture2D(uStoneN, sp / 1.6).xyz * 2. - 1.;  // 贴图右 = +x、上 = +z（贴图不翻转）
        normal = normalize(normal + uStone * 1.5 * (sN.x * sTx + sN.y * sTz));
        vec2 rip = vec2(0.), wave = vec2(0.);
        if (pool > 0.) {
          // 风吹的细波：实拍石面那张法线错开两层、朝不同方向移（每秒十几到二十几厘米），水面一直在轻轻晃（没下载到石材时是平的）。
          // 两层叠起来的起伏标准差约 0.047（量过 stone-normal.webp），乘 21 归一，下面再按要的大小乘
          wave = 21. * (texture2D(uStoneN, sp / 0.5 + uFloorTime * vec2(0.3, 0.18)).xy + texture2D(uStoneN, sp / 0.85 + vec2(0.5) - uFloorTime * vec2(0.12, 0.27)).xy - 1.);
          // 涟漪：0.45 米一格，约三成的格子每 3 秒落一滴，荡开一圈（sp 的 y 朝 -z）
          vec2 rp = sp * 2.2, cell = floor(rp);
          for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
            vec2 c = cell + vec2(i, j);
            float h = fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453);
            if (h > 0.3) continue;
            float t = fract(uFloorTime * 0.33 + h * 7.);
            vec2 d = rp - (c + 0.25 + 0.5 * fract(vec2(h * 17.3, h * 31.7)));
            float r = length(d), w = (r - t * 1.1) * 40.;
            rip += d / max(r, 1e-3) * sin(w) * step(abs(w), 6.2832) * (1. - t) * (1. - t);
          }
        }
        vec2 sTilt = 0.2 * rip + 0.05 * wave;   // 细波让水面倾约 0.05（3°）
        normal = normalize(mix(normal, normalize((viewMatrix * vec4(0., 1., 0., 0.)).xyz), pool) + pool * (sTilt.x * sTx - sTilt.y * sTz));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${extra?.emissive ?? ''}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        // 云影：几块大而软的影子顺着风慢慢飘过（约 0.3 米每秒），只压太阳直射的那份，入侵后天被黑雾盖住就不要了
        vec2 cp = sp + uFloorTime * vec2(-0.22, 0.17);
        float cl = 1. - 0.38 * (1. - uFloorInv) * smoothstep(0.44, 0.62, 0.6 * sNoise(cp / 6.) + 0.4 * sNoise(cp / 2.6 + 5.3));
        reflectedLight.directDiffuse *= cl; reflectedLight.directSpecular *= cl * uGlint;
        if (pool > 0.) {
          float nv = saturate(dot(normal, geometryViewDir)), F = 0.04 + 0.96 * pow(1. - nv, 3.5);   // 俯看 25° 约 0.18（真水约 0.08；原来 0.3 太像镜子）
          // 倒影：跟着细波和涟漪扭，再在 5 个点上取平均糊开一点（约 4 个像素），积水不干净、偏暗偏黄
          vec4 rc = vRefl + vec4((rip * 0.03 + wave * 0.004) * vRefl.w, 0., 0.);   // 细波把倒影扭开约 4 个像素
          vec2 bo = vec2(0.0042, 0.0016) * vRefl.w;
          vec3 rs = 0.36 * texture2DProj(uRefl, rc).rgb + 0.16 * (texture2DProj(uRefl, rc + vec4(bo, 0., 0.)).rgb + texture2DProj(uRefl, rc - vec4(bo, 0., 0.)).rgb
            + texture2DProj(uRefl, rc + vec4(-bo.y, bo.x, 0., 0.)).rgb + texture2DProj(uRefl, rc - vec4(-bo.y, bo.x, 0., 0.)).rgb);
          vec3 refl = mix(reflectedLight.indirectSpecular * F / (0.04 + 0.96 * pow(1. - nv, 5.)),   // 流畅档：环境反射按同样的量放大
            rs * F, uReflOn) * vec3(0.9, 0.87, 0.8);
          vec3 tint = mix(vec3(1.), vec3(0.72, 0.5, 1.35), (0.7 - 0.35 * uReflOn) * uFloorInv);   // 入侵：倒影染紫（环境贴图开局烤好，不会跟着天变）
          reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, refl * tint, pool * (0.35 + 0.65 * deep));
        }`);
  };
  return mat;
}

/**
 * 入侵的损伤图：R 是这一处裂开时的入侵程度，G 是烧焦时的程度（255 = 永远不会）；B 是阵纹刻槽（0 = 槽里，顺手放在这张里，不多占一张图）。
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
    }
    // B：阵纹刻槽（0 = 槽里）。描金的地方当金属，施法时流光、阵眼挨打时闪，都只走槽里
    engraving((w, path) => { g.beginPath(); path(g); g.strokeStyle = 'rgb(255, 255, 0)'; g.lineWidth = w + 0.015; g.stroke(); });
  }, false);
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
 * @param {{ R: number, stairs: { halfW: number, zTop: number, zBottom: number, yBottom: number }, tex: number, wear: Wear, core: [number, number], ash?: number[][], reflect?: number }} o
 *   tex：台面贴图边长（电影档 2048、流畅档 1024）；wear：常走的路、东西脚下、水洼（layout.js 按摆放给）；core：阵眼 [x, z]（阵纹流光往那扫）；
 *   ash：香炉脚下的香灰 [x, z, 半径]；
 *   reflect：水洼平面反射那张图的宽（电影档给；不给就只照出天）
 */
export function buildPlaza(scene, o) {
  const { R, stairs: ST } = o;
  const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  // 台面
  // 阵纹（10-25）：刻槽里的描金当金属（夕阳下反金光，不再是画上去的黄线）；施法时一道金光从台面远端扫向阵眼，
  // 前沿 0.8 秒扫完、后面拖一段渐暗的尾巴；阵眼挨打时整片阵纹闪一下（离阵眼越近越亮，快速抖动）
  const sigil = { flow: { value: 99 }, hit: { value: 0 }, core: { value: new THREE.Vector2(...o.core) } };
  const floor = floorTextures(o.tex, R, RINGS, true, o.ash), damage = damageTexture(Math.min(1024, o.tex), R);
  const floorMat = stoneFloor(floor, wearTexture(Math.min(1024, o.tex), R, o.wear), R, {
    uniforms: { uDamage: { value: damage }, uInv: FLOOR.inv, uTime: FLOOR.time, uFlow: sigil.flow, uHit: sigil.hit, uCore: sigil.core },
    decl: '\nuniform sampler2D uDamage; uniform float uInv, uTime, uFlow, uHit; uniform vec2 uCore;',
    color: `vec3 dmg = texture2D(uDamage, vMapUv).rgb;
        float groove = 1. - dmg.b;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.64, 0.28), 0.75 * groove);   // 鎏金：当金属时这就是反光的颜色
        float crack = smoothstep(dmg.r - 0.02, dmg.r + 0.02, uInv) * step(dmg.r, 0.99);
        float scorch = clamp((uInv - dmg.g) / 0.2, 0., 1.) * step(dmg.g, 0.99);   // 软边：阈值比当前程度低得越多越黑（硬边实测像地上的洞）
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.09, 0.07), scorch * scorch * 0.6);
        diffuseColor.rgb *= 1. - 0.85 * crack;`,
    rough: 'roughnessFactor = max(roughnessFactor, max(crack, scorch * 0.9));',
    metal: `metalnessFactor = mix(metalnessFactor, 0.8, groove * (1. - crack));   // 不到 1：背光那面只剩环境反射（场景的环境光弱），全金属会发黑
        roughnessFactor = mix(roughnessFactor, 0.3, groove * (1. - pool) * (1. - crack));`,
    emissive: `totalEmissiveRadiance += vec3(0.55, 0.18, 1.0) * crack * smoothstep(0.35, 0.8, uInv) * (0.5 + 0.3 * sin(uTime * 2.3 + vMapUv.x * 40.));
        float dC = length(vec2(sp.x, -sp.y) - uCore), D = 19. - uFlow * 24.;   // 离阵眼多远；前沿从 19 米外扫进来
        float flowK = (exp(-pow((dC - D) / 0.7, 2.)) + 0.35 * step(D, dC) * exp((D - dC) / 2.5)) * (1. - smoothstep(0.9, 1.5, uFlow));
        totalEmissiveRadiance += vec3(1., 0.7, 0.32) * groove * (1. - crack) * (2.6 * flowK + uHit * (1.6 + 1.2 * exp(-dC / 5.)) * (0.75 + 0.25 * sin(uTime * 37.)));`,
  });
  const top = new THREE.Mesh(new THREE.CircleGeometry(R, 96), floorMat);
  top.rotation.x = -Math.PI / 2;
  top.receiveShadow = true;
  scene.add(top);
  FLOOR.meshes.push(top);
  // 水洼的倒影（电影档）：一块看不见的镜面（不写颜色、不写深度），每帧最先画，画之前把场景按地面翻过来渲一遍到它的图里；
  // 广场和落脚台都在 y = 0，共用这一张。那一遍先藏起台面（它们自己在读这张图），阴影不重算
  if (o.reflect) {
    const mirror = new Reflector(new THREE.PlaneGeometry(90, 90), { textureWidth: o.reflect, textureHeight: Math.round((o.reflect * 9) / 16), clipBias: 0.003, multisample: 0 });
    mirror.rotation.x = -Math.PI / 2;
    mirror.renderOrder = -100;
    const mm = /** @type {THREE.ShaderMaterial} */ (mirror.material);
    mm.colorWrite = false; mm.depthWrite = false;
    mirror.updateMatrixWorld();
    const tm = mm.uniforms.textureMatrix.value, toLocal = mirror.matrixWorld.clone().invert(), draw = mirror.onBeforeRender;
    mirror.onBeforeRender = (...a) => {
      for (const m of FLOOR.meshes) m.visible = false;
      draw.apply(mirror, a);
      for (const m of FLOOR.meshes) m.visible = true;
      FLOOR.reflMat.value.multiplyMatrices(tm, toLocal);   // 镜面自带的矩阵从它自己的局部坐标算起，台面给的是世界坐标
    };
    FLOOR.refl.value = mirror.getRenderTarget().texture;
    FLOOR.reflOn.value = 1;
    scene.add(mirror);
  }

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
    setInvasion(k) { FLOOR.inv.value = k; ROCK_INV.value = k; },
    /**
     * 台面上太阳的直射高光留几成。试炼平视的两档（肩后、第一人称）朝太阳看时，磨光的路面和水洼在 6～7 米外把太阳镜面反射过来，
     * 泛光再晕成半屏白，连站在那里的敌人都看不见（10-30 在预览里关掉太阳光才消失）；俯视看不到这个角度，不用压 @param {number} k
     */
    setGlint(k) { FLOOR.glint.value = k; },
    /** 施法：阵纹里一道金光扫向阵眼 */
    flow() { sigil.flow.value = 0; },
    /** 阵眼挨打：阵纹闪一下 */
    hit() { sigil.hit.value = 1; },
    /**
     * @param {number} dt 游戏时间（涟漪跟着慢放）
     * @param {number} [real] 真实时间：流光、闪光按它走（咏唱慢放到 0.3 倍时，按游戏时间扫一趟要 2.7 秒，法术早放出去了）
     */
    update(dt, real = dt) { FLOOR.time.value += dt; sigil.flow.value += real; sigil.hit.value = Math.max(0, sigil.hit.value - real * 2.2); },
  };
}

/**
 * 邻峰的落脚台：跟广场同一套汉白玉台面（不刻阵纹）、浮雕台沿和线脚，小一号。
 * 原来是一块纯色圆盘，悬在山石模型的顶面上面，看不出是什么地面（10-24 本人看出来的）；台沿往下压到山石顶面以下，底下不露缝。
 * @param {THREE.Scene} scene @param {{ x: number, z: number, R: number, tex: number, wear: Wear }} o 中心、半径、台面贴图边长、生活痕迹（相对中心）
 */
export function buildLanding(scene, o) {
  const { R } = o, g = new THREE.Group();
  const floor = floorTextures(o.tex, R, [[0, 0.9, 1], [0.9, 2.1, 8], [2.1, 3.4, 14], [3.4, R - 0.7, 20], [R - 0.7, R, 32]], false);
  const top = new THREE.Mesh(new THREE.CircleGeometry(R, 64), stoneFloor(floor, wearTexture(256, R, o.wear), R));
  top.rotation.x = -Math.PI / 2;
  top.receiveShadow = true;
  const RR = R + 0.12, H = 1.25;
  const rimTex = rimTextures(1024, 256);
  for (const t of [rimTex.color, rimTex.aux]) { t.wrapS = THREE.RepeatWrapping; t.repeat.set(Math.round((RR * Math.PI * 2) / 4.6), 1); }
  const band = new THREE.Mesh(new THREE.CylinderGeometry(RR, RR, H, 96, 1, true),
    new THREE.MeshStandardMaterial({ map: rimTex.color, bumpMap: rimTex.aux, bumpScale: 3, roughnessMap: rimTex.aux, roughness: 1 }));
  band.position.y = -H / 2 - 0.04;
  const marble = new THREE.MeshStandardMaterial({ color: 0xe2dbce, roughness: 0.5 });
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(RR + 0.1, RR + 0.1, 0.16, 96, 1, true), marble);
  lip.position.y = -0.08;
  const lipTop = new THREE.Mesh(new THREE.RingGeometry(R - 0.02, RR + 0.1, 96), marble);
  lipTop.rotation.x = -Math.PI / 2;
  lipTop.position.y = 0.002;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(RR + 0.04, RR - 0.18, 0.26, 96, 1, true), marble);
  foot.position.y = -H - 0.17;
  for (const m of [top, band, lip, lipTop, foot]) { m.castShadow = m !== top && m !== lipTop; m.receiveShadow = true; g.add(m); }
  FLOOR.meshes.push(top);
  g.position.set(o.x, 0, o.z);
  scene.add(g);
  return g;
}
