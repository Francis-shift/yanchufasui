// @ts-check
/**
 * 云海之上的宗门山门广场（方块版）。尺寸与玩法、物理对齐：
 *   - 广场：半径 11 米的圆台，边缘之下是云海（用风推出去就没进云里）；
 *   - 正面：从云海升上来的长石阶（敌人路线一）；左前：通往邻峰的索桥（敌人路线二）；
 *   - 石阶口进来是山门牌坊（10-21 换成模型：宽 13 米、高约 9.6 米，往广场里收了 2 米才放得下），
 *     门洞正中两根铁链吊着镇山石，牌坊前两只石兽；两侧香炉；华表立在牌坊到阵眼的路两旁；
 *   - 施法者站在阵眼前面，阵眼破了就输。
 * 模型（牌坊、石兽、镇山石、香炉、华表、栏杆、山石）由 props.js 加载后摆到这里给的位置；没加载出来时用这里的方块占位（栏杆没有占位）。
 * 台面、台沿、台底山石、石阶在 plaza.js（10-23 照目标图重做）。
 */
import * as THREE from 'three';
import { col, PALETTE, sigilMat, sigilTex } from '../fx/common.js';
import { buildPlaza, rockColumn } from './plaza.js';

export const PLAZA_R = 11;
export const CORE_POS = new THREE.Vector3(0, 0, 8.6);
export const CASTER_POS = new THREE.Vector3(0, 0, 5.2);
const STAIRS = { halfW: 2.0, zTop: -10.4, zBottom: -26, yBottom: -10 };
const BRIDGE = { a: new THREE.Vector2(-9.2, -5.4), b: new THREE.Vector2(-24, -14.2), halfW: 1.05 };
const BRIDGE_DIR = BRIDGE.b.clone().sub(BRIDGE.a).normalize();
const PEAK = { c: BRIDGE.b.clone().addScaledVector(BRIDGE_DIR, 3.6), r: 4.4 };

/**
 * 牌坊（尺寸取自打包后的模型，tools/pack_prop.py 打印）：z 是中心；两组柱子底座在 |x| 2.24～4.92、前后各 0.81；
 * 门洞宽 4.76、顶 6.46。z 取 -8.6：底座外角离圆心 10.8 米，刚好在广场上；门洞比石阶（4 米）宽。
 */
export const GATE = { z: -8.6, height: 9.64, openTop: 6.46, pillarX: 3.58 };
/** 石兽：在两组柱子正前方，略朝里转 */
const LION = { x: 3.58, z: -6.4, turn: 0.3 };
/** 镇山石：直径 1.8、连顶上铁环高 1.95；环顶比门洞顶低 0.5，石头底离地约 4 米，巨像（约 3.3 米）过得去 */
const STONE = { ringTop: GATE.openTop - 0.5, height: 1.95 };
/**
 * 华表：从横屏机位看正好叠在两组柱子前面，不挡门洞。模型（10-24）高 4.6、云板横着伸出 1.62、八角底座宽约 1.1
 * （尺寸取自打包后的模型）
 */
const HUABIAO_X = 4.2, HUABIAO_Z = -3.0;
/** 香炉：广场两侧（目标图里在正中，但广场中间是敌人的路）。模型高 1.5、连龙耳宽 1.54、四足落地约 1.06 见方 */
const CENSER_X = 7.2, CENSER_Z = 1.5;

/** 场景物件的位置（玩家可以点名的目标） */
export const OBJECTS = {
  rope: { x: 0, z: GATE.z },
  censer: { x: -CENSER_X, z: CENSER_Z },
  bridge: { x: (BRIDGE.a.x + BRIDGE.b.x) / 2, z: (BRIDGE.a.y + BRIDGE.b.y) / 2 },
  pillar: { x: -HUABIAO_X, z: HUABIAO_Z },
};

/** 广场上的固定障碍（敌人寻路绕开）：华表、香炉、牌坊两组柱子、石兽 */
export const OBSTACLES = [
  { x: -HUABIAO_X, z: HUABIAO_Z, r: 0.6 }, { x: HUABIAO_X, z: HUABIAO_Z, r: 0.6 },
  { x: -CENSER_X, z: CENSER_Z, r: 0.7 }, { x: CENSER_X, z: CENSER_Z, r: 0.7 },
  { x: -GATE.pillarX, z: GATE.z, r: 1.5 }, { x: GATE.pillarX, z: GATE.z, r: 1.5 },
  { x: -LION.x, z: LION.z, r: 1.0 }, { x: LION.x, z: LION.z, r: 1.0 },
];

/** @param {number} x0 @param {number} x1 @param {number} y0 @param {number} y1 @param {number} z0 @param {number} z1 */
const box = (x0, x1, y0, y1, z0, z1) => ({ min: [x0, y0, z0], max: [x1, y1, z1] });
const STONE_BOTTOM = STONE.ringTop - STONE.height;
/**
 * 场景里实心的东西（轴对齐盒子，米；尺寸取自打包后的模型）：在空中飞的东西（冰龙）要绕开。
 * 两组柱子、横梁和屋顶、镇山石、两只石兽、两根华表。
 */
export const SOLIDS = [
  ...[-1, 1].map((s) => box(s > 0 ? 2.24 : -4.92, s > 0 ? 4.92 : -2.24, 0, GATE.openTop, GATE.z - 0.81, GATE.z + 0.81)),
  box(-6.5, 6.5, GATE.openTop, GATE.height, GATE.z - 1.39, GATE.z + 1.39),
  box(-0.9, 0.9, STONE_BOTTOM, STONE.ringTop, GATE.z - 0.9, GATE.z + 0.9),
  ...[-1, 1].map((s) => box(s * LION.x - 1.04, s * LION.x + 1.04, 0, 3, LION.z - 1.03, LION.z + 1.03)),
  ...[-1, 1].map((s) => box(s * HUABIAO_X - 0.81, s * HUABIAO_X + 0.81, 0, 4.6, HUABIAO_Z - 0.57, HUABIAO_Z + 0.57)),
];

/** 模型摆放的位置（props.js 用）：牌坊、两只石兽（右边那只镜像）、镇山石（模型原点在底面中心） */
export const PROP_SPOTS = {
  gate: { x: 0, y: 0, z: GATE.z, rotY: 0, mirror: false },
  lions: [{ x: -LION.x, y: 0, z: LION.z, rotY: LION.turn, mirror: false }, { x: LION.x, y: 0, z: LION.z, rotY: -LION.turn, mirror: true }],
  stone: { x: 0, y: STONE_BOTTOM, z: GATE.z, rotY: 0, mirror: false },
  /** 香炉两只都朝镜头（两只龙耳左右伸开）；华表两根，右边那根镜像（两根的盘龙左右对称） */
  censers: [-1, 1].map((s) => ({ x: s * CENSER_X, y: 0, z: CENSER_Z, rotY: 0, mirror: false })),
  huabiao: [-1, 1].map((s) => ({ x: s * HUABIAO_X, y: 0, z: HUABIAO_Z, rotY: 0, mirror: s > 0 })),
  /**
   * 中景（离广场 35～65 米）：牌坊两边各两块，牌坊背后不放（会从门洞里露出来、跟石阶上来的敌人搅在一起）。
   * rock-a 是高石柱（打包成 30 米高），底下那截插进云海（云面 y = -9）；rock-b 是浮岛（20 米宽），悬在半空。scale 乘在打包尺寸上。
   */
  rocks: [
    { model: 'rock-a', x: -24, y: -17.5, z: -38, rotY: 0.6, scale: 0.95, mirror: false },
    { model: 'rock-b', x: -34, y: -1.8, z: -30, rotY: 1.2, scale: 0.85, mirror: false },
    { model: 'rock-a', x: 19, y: -14.5, z: -30, rotY: 2.1, scale: 0.75, mirror: true },
    { model: 'rock-a', x: 26, y: -16, z: -58, rotY: 4.0, scale: 1, mirror: false },
  ],
  /**
   * 托东西的两块山石（替换代码合成的邻峰、广场台底，10-24 本人看出代码石头像塑料）：给的是顶面中心要放在哪（top），
   * props.js 按模型的顶面反推摆放位置。邻峰用石柱，放大到顶面跟落脚台差不多大，往下变粗的那截藏在云里；
   * 台底用浮岛，顶上那圈岩檐（半径约 11 米）正好托住广场，顶面压在台沿底下。
   */
  peak: { model: 'rock-a', top: [PEAK.c.x, -0.9, PEAK.c.y], rotY: 0.8, scale: 1.5 },
  base: { model: 'rock-b', top: [0, -1.75, 0], rotY: 0, scale: 1 },
};

/**
 * 栏杆（望柱 + 栏板两种模型，props.js 实例化一次画完）：台边一圈，石阶口、桥头断开；石阶两侧顺着矮石边往下，到云面为止。
 * 望柱竖着立在每个接头上；栏板给两头底边的中点 a、b——台边上是平的弦，石阶上带着坡（props.js 把栏板错切成斜的，竖线仍竖着）。
 * 尺寸取自打包后的模型：望柱 0.24 见方、高 1.15；栏板长 2.41、高 0.85。每段不到一块栏板长就压一压、多一点就拉一拉。
 */
const RAIL = { r: PLAZA_R - 0.05, postW: 0.24, seg: 2.65 };
function railLayout() {
  /** @type {{ x: number, y: number, z: number, rotY: number }[]} */
  const posts = [];
  /** @type {{ a: THREE.Vector3, b: THREE.Vector3 }[]} */
  const panels = [];
  /** 依次连起来的一串接头（底面中心）：每个接头一根望柱，相邻两根之间一块栏板（两头插进望柱一点） @param {THREE.Vector3[]} pts */
  const run = (pts) => pts.forEach((p, i) => {
    const o = pts[Math.max(i - 1, 0)], q = pts[Math.min(i + 1, pts.length - 1)];
    posts.push({ x: p.x, y: p.y, z: p.z, rotY: Math.atan2(-(q.z - o.z), q.x - o.x) });   // 方柱的面顺着栏杆
    if (i + 1 === pts.length) return;
    const f = (RAIL.postW / 2 - 0.02) / Math.hypot(q.x - p.x, q.z - p.z);
    panels.push({ a: p.clone().lerp(q, f), b: q.clone().lerp(p, f) });
  });
  /** 台边的一段圆弧（角度从 +x 往 +z 量） @param {number} f0 @param {number} f1 */
  const arc = (f0, f1) => {
    const n = Math.max(1, Math.round(((f1 - f0) * RAIL.r) / RAIL.seg));
    run(Array.from({ length: n + 1 }, (_, i) => { const f = f0 + ((f1 - f0) * i) / n; return new THREE.Vector3(Math.cos(f) * RAIL.r, 0, Math.sin(f) * RAIL.r); }));
  };
  const fs = -Math.PI / 2, gs = Math.asin((STAIRS.halfW + 0.6) / RAIL.r);                         // 石阶口
  const fb = Math.atan2(BRIDGE.a.y, BRIDGE.a.x), gb = Math.asin((BRIDGE.halfW + 0.5) / RAIL.r);   // 桥头（让开两根拴铁链的石桩）
  arc(fb + gb, fs - gs);
  arc(fs + gs, fb - gb + Math.PI * 2);
  // 石阶两侧立在矮石边上（plaza.js 的 curb：中线在 halfW + 0.25，顶面比台阶的斜线高 0.616）；到云面（y = -9）附近为止。
  // 右边那串倒着排，两边栏板的正面都朝石阶
  const k = -STAIRS.yBottom / (STAIRS.zTop - STAIRS.zBottom), z0 = -11, z1 = -24.6, n = Math.round((z0 - z1) / RAIL.seg);
  for (const s of [-1, 1]) {
    const pts = Array.from({ length: n + 1 }, (_, i) => { const z = z0 + ((z1 - z0) * i) / n; return new THREE.Vector3(s * (STAIRS.halfW + 0.25), k * (z - STAIRS.zTop) + 0.616, z); });
    run(s > 0 ? pts.reverse() : pts);
  }
  return { posts, panels };
}
export const RAILS = railLayout();

/**
 * 某处地面高度；脚下没有地面（悬崖外、云海上空）返回 null。
 * @param {number} x @param {number} z
 */
export function groundHeightAt(x, z) {
  if (x * x + z * z <= PLAZA_R * PLAZA_R) return 0;
  if (Math.abs(x) <= STAIRS.halfW && z <= STAIRS.zTop + 0.6 && z >= STAIRS.zBottom) {
    return STAIRS.yBottom * Math.min(1, Math.max(0, (STAIRS.zTop - z) / (STAIRS.zTop - STAIRS.zBottom)));
  }
  const p = new THREE.Vector2(x, z);
  const t = THREE.MathUtils.clamp(p.clone().sub(BRIDGE.a).dot(BRIDGE_DIR), 0, BRIDGE.a.distanceTo(BRIDGE.b));
  if (p.distanceTo(BRIDGE.a.clone().addScaledVector(BRIDGE_DIR, t)) <= BRIDGE.halfW) return 0;
  if (p.distanceTo(PEAK.c) <= PEAK.r) return 0;
  return null;
}

/** 敌人的两条路线（世界坐标，y 由地面高度给出） */
export const PATHS = [
  [[0, -26], [0, -10.4], [0, -2], [0, CORE_POS.z - 2.2]],
  [[PEAK.c.x, PEAK.c.y], [BRIDGE.b.x, BRIDGE.b.y], [BRIDGE.a.x, BRIDGE.a.y], [-3, 2], [-1.1, CORE_POS.z - 2.2]],
].map((pts) => pts.map(([x, z]) => new THREE.Vector3(x, groundHeightAt(x, z) ?? 0, z)));

/** @param {THREE.Scene} scene @param {{ tex?: number }} [opts] tex：台面贴图边长（电影档 2048、流畅档 1024） */
export function buildLayout(scene, opts = {}) {
  const stone = new THREE.MeshStandardMaterial({ color: 0xbdb6a8, roughness: 0.9 });
  const darkStone = new THREE.MeshStandardMaterial({ color: 0x8c8578, roughness: 0.95 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5636, roughness: 0.85 });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.45, metalness: 0.7 });
  const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  // 广场本体：汉白玉台面（刻阵纹）、台沿浮雕、台底山石、石阶（plaza.js）
  const plaza = buildPlaza(scene, { R: PLAZA_R, stairs: STAIRS, tex: opts.tex ?? 2048 });

  // 山门牌坊（占位：两组白石柱 + 横梁 + 蓝屋顶，尺寸同模型；模型加载出来就藏起来）
  const marble = new THREE.MeshStandardMaterial({ color: 0xd9d4ca, roughness: 0.6 });
  const gateBox = new THREE.Group();
  for (const sx of [-GATE.pillarX, GATE.pillarX]) {
    const post = shadowy(new THREE.Mesh(new THREE.BoxGeometry(2.68, GATE.openTop, 1.62), marble));
    post.position.set(sx, GATE.openTop / 2, 0);
    gateBox.add(post);
  }
  const beam = shadowy(new THREE.Mesh(new THREE.BoxGeometry(9.8, 1.3, 1.6), marble));
  beam.position.set(0, GATE.openTop + 0.65, 0);
  const roof = shadowy(new THREE.Mesh(new THREE.BoxGeometry(13, GATE.height - GATE.openTop - 1.3, 2.78), new THREE.MeshStandardMaterial({ color: 0x2c3c6a, roughness: 0.5 })));
  roof.position.set(0, (GATE.height + GATE.openTop + 1.3) / 2, 0);
  gateBox.add(beam, roof);
  gateBox.position.set(0, 0, GATE.z);
  scene.add(gateBox);

  // 镇山石：两根铁链从门洞顶斜吊到石头顶上的铁环（铁链一直用代码画；石头先用多面体占位）
  const iron = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.45, metalness: 0.85 });
  const ring = new THREE.Vector3(0, STONE.ringTop, GATE.z);
  scene.add(chains([-0.9, 0.9].map((sx) => [new THREE.Vector3(sx, GATE.openTop, GATE.z), ring]), iron));
  const stoneBox = shadowy(new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), darkStone));
  stoneBox.position.set(0, STONE.ringTop - STONE.height + 0.9, GATE.z);
  scene.add(stoneBox);

  // 华表（牌坊到阵眼的路两旁）与香炉（广场两侧）：占位，模型到了藏起来
  const huabiaoBox = new THREE.Group(), censerBox = new THREE.Group();
  for (const sx of [-HUABIAO_X, HUABIAO_X]) {
    const col_ = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 4.6, 12), stone));
    col_.position.set(sx, 2.3, HUABIAO_Z);
    const cap = shadowy(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.4), stone));
    cap.position.set(sx, 3.9, HUABIAO_Z);
    huabiaoBox.add(col_, cap);
  }
  for (const sx of [-CENSER_X, CENSER_X]) {
    const bowl = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.5, 0.8, 16), bronze));
    bowl.position.set(sx, 0.95, CENSER_Z);
    const foot = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 0.6, 10), bronze));
    foot.position.set(sx, 0.3, CENSER_Z);
    censerBox.add(bowl, foot);
  }
  scene.add(huabiaoBox, censerBox);

  // 索桥 + 邻峰
  const len = BRIDGE.a.distanceTo(BRIDGE.b), nPlank = Math.round(len / 0.48);
  const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(BRIDGE.halfW * 2, 0.1, 0.38), wood, nPlank);
  const yaw = Math.atan2(BRIDGE_DIR.x, BRIDGE_DIR.y), m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  for (let i = 0; i < nPlank; i++) {
    const p = BRIDGE.a.clone().addScaledVector(BRIDGE_DIR, (i + 0.5) * (len / nPlank));
    m4.compose(new THREE.Vector3(p.x, -0.06, p.y), q, new THREE.Vector3(1, 1, 1));
    planks.setMatrixAt(i, m4);
  }
  planks.castShadow = planks.receiveShadow = true;
  scene.add(planks);
  // 铁索（10-23 由麻绳改铁链，目标图是铁索桥）：两侧扶手各一根往下垂的铁链、桥面两边各一根贴着木板，
  // 中间几根竖链把扶手吊在桥面上；两头各立一对石桩拴住。全部铁链一次画完
  const lines = [];
  for (const side of [-1, 1]) {
    const off = new THREE.Vector2(-BRIDGE_DIR.y, BRIDGE_DIR.x).multiplyScalar(side * (BRIDGE.halfW + 0.05));
    const a = BRIDGE.a.clone().add(off), b = BRIDGE.b.clone().add(off);
    const at = (t, y0, dip) => { const p = a.clone().lerp(b, t); return new THREE.Vector3(p.x, y0 - Math.sin(Math.PI * t) * dip, p.y); };
    lines.push(Array.from({ length: 17 }, (_, i) => at(i / 16, 1.05, 0.3)), [at(0, 0.02, 0), at(1, 0.02, 0)]);
    for (const t of [0.2, 0.4, 0.6, 0.8]) lines.push([at(t, 0.02, 0), at(t, 1.05, 0.3)]);
    for (const end of [a, b]) {
      const post = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.35, 0.32), stone));
      post.position.set(end.x, 0.6, end.y);
      scene.add(post);
    }
  }
  scene.add(chains(lines, iron));
  // 邻峰：索桥那头的山石，顶上一块平台（山石模型到了换掉，见 PROP_SPOTS.peak）
  const peak = rockColumn(PEAK.r, 2.2, 22, 11);
  peak.position.set(PEAK.c.x, -11, PEAK.c.y);
  const landing = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(PEAK.r + 0.15, PEAK.r, 0.3, 40), darkStone));
  landing.position.set(PEAK.c.x, -0.15, PEAK.c.y);
  scene.add(peak, landing);

  // 阵眼：地上一圈发光阵盘 + 悬浮水晶 + 八根石桩
  const coreColor = col(PALETTE.arcane.secondary, 1.6);   // 我方金色（风格卡敌我配色）
  const coreSigil = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 4.8), sigilMat(sigilTex(), coreColor));
  coreSigil.material.opacity = 0.9;
  coreSigil.rotation.x = -Math.PI / 2;
  coreSigil.position.set(CORE_POS.x, 0.03, CORE_POS.z);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0),
    new THREE.MeshStandardMaterial({ color: 0xffe3a6, emissive: coreColor, emissiveIntensity: 0.8, roughness: 0.2 }));
  crystal.position.set(CORE_POS.x, 1.7, CORE_POS.z);
  crystal.castShadow = true;
  scene.add(coreSigil, crystal);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const post = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 0.3), stone));
    post.position.set(CORE_POS.x + Math.cos(a) * 2.7, 0.35, CORE_POS.z + Math.sin(a) * 2.7);
    scene.add(post);
  }

  // 施法者（占位：背对镜头的白衣修士）
  const caster = new THREE.Group();
  const robe = new THREE.MeshStandardMaterial({ color: 0xe8eef5, roughness: 0.8 });
  const body = shadowy(new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.0, 4, 12), robe));
  body.position.y = 0.85;
  const head = shadowy(new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshStandardMaterial({ color: 0x2b2b30 })));
  head.position.y = 1.62;
  caster.add(body, head);
  caster.position.copy(CASTER_POS);
  scene.add(caster);

  return { coreSigil, crystal, caster, gateBox, stoneBox, huabiaoBox, censerBox, peakRock: peak, plaza };
}

/**
 * 几根铁链：每根是一条折线，沿线一节节扁环，相邻两节转 90°。所有链子合成一个实例化网格，一次画完。
 * @param {THREE.Vector3[][]} lines @param {THREE.Material} mat
 */
function chains(lines, mat) {
  const LINK = 0.16, UP = new THREE.Vector3(0, 1, 0), placed = [];
  for (const pts of lines) {
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s], dir = pts[s + 1].clone().sub(a), n = Math.max(2, Math.round(dir.length() / LINK));
      const align = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
      for (let i = 0; i < n; i++) placed.push({ p: a.clone().addScaledVector(dir, (i + 0.5) / n), align });
    }
  }
  const geo = new THREE.TorusGeometry(0.07, 0.022, 6, 10);
  geo.scale(1, 1.45, 1);                                   // 拉成长圆环，长边顺着链子
  const links = new THREE.InstancedMesh(geo, mat, placed.length);
  const twist = new THREE.Quaternion(), q = new THREE.Quaternion(), m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
  placed.forEach((L, i) => {
    twist.setFromAxisAngle(UP, (i % 2) * Math.PI / 2);
    links.setMatrixAt(i, m.compose(L.p, q.copy(L.align).multiply(twist), one));
  });
  links.castShadow = true;
  return links;
}
