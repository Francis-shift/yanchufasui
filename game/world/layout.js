// @ts-check
/**
 * 云海之上的宗门山门广场（方块版）。尺寸与玩法、物理对齐：
 *   - 广场：半径 11 米的圆台，边缘之下是云海（用风推出去就没进云里）；
 *   - 正面：从云海升上来的长石阶（敌人路线一）；左前：通往邻峰的索桥（敌人路线二）；
 *   - 石阶口进来是山门牌坊（10-21 换成模型：宽 13 米、高约 9.6 米，往广场里收了 2 米才放得下），
 *     门洞正中两根铁链吊着镇山石，牌坊前两只石兽；两侧香炉；华表立在牌坊到阵眼的路两旁；
 *   - 施法者站在阵眼前面，阵眼破了就输。
 * 模型（牌坊、石兽、镇山石）由 props.js 加载后摆到这里给的位置；没加载出来时用这里的方块占位。
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
/** 华表：从横屏机位看正好叠在两组柱子前面，不挡门洞 */
const HUABIAO_X = 4.2, HUABIAO_Z = -3.0;

/** 场景物件的位置（玩家可以点名的目标） */
export const OBJECTS = {
  rope: { x: 0, z: GATE.z },
  censer: { x: -7.2, z: 1.5 },
  bridge: { x: (BRIDGE.a.x + BRIDGE.b.x) / 2, z: (BRIDGE.a.y + BRIDGE.b.y) / 2 },
  pillar: { x: -HUABIAO_X, z: HUABIAO_Z },
};

/** 广场上的固定障碍（敌人寻路绕开）：华表、香炉、牌坊两组柱子、石兽 */
export const OBSTACLES = [
  { x: -HUABIAO_X, z: HUABIAO_Z, r: 0.45 }, { x: HUABIAO_X, z: HUABIAO_Z, r: 0.45 },
  { x: -7.2, z: 1.5, r: 0.7 }, { x: 7.2, z: 1.5, r: 0.7 },
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
  ...[-1, 1].map((s) => box(s * HUABIAO_X - 0.7, s * HUABIAO_X + 0.7, 0, 4.6, HUABIAO_Z - 0.4, HUABIAO_Z + 0.4)),
];

/** 模型摆放的位置（props.js 用）：牌坊、两只石兽（右边那只镜像）、镇山石（模型原点在底面中心） */
export const PROP_SPOTS = {
  gate: { x: 0, y: 0, z: GATE.z, rotY: 0, mirror: false },
  lions: [{ x: -LION.x, y: 0, z: LION.z, rotY: LION.turn, mirror: false }, { x: LION.x, y: 0, z: LION.z, rotY: -LION.turn, mirror: true }],
  stone: { x: 0, y: STONE_BOTTOM, z: GATE.z, rotY: 0, mirror: false },
};

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
  for (const sx of [-0.9, 0.9]) scene.add(chain(new THREE.Vector3(sx, GATE.openTop, GATE.z), ring, iron));
  const stoneBox = shadowy(new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), darkStone));
  stoneBox.position.set(0, STONE.ringTop - STONE.height + 0.9, GATE.z);
  scene.add(stoneBox);

  // 华表（牌坊到阵眼的路两旁）与香炉（广场两侧）
  for (const sx of [-HUABIAO_X, HUABIAO_X]) {
    const col_ = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 4.6, 12), stone));
    col_.position.set(sx, 2.3, HUABIAO_Z);
    const cap = shadowy(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.4), stone));
    cap.position.set(sx, 3.9, HUABIAO_Z);
    scene.add(col_, cap);
  }
  for (const sx of [-7.2, 7.2]) {
    const bowl = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.5, 0.8, 16), bronze));
    bowl.position.set(sx, 0.95, 1.5);
    const foot = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 0.6, 10), bronze));
    foot.position.set(sx, 0.3, 1.5);
    scene.add(bowl, foot);
  }

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
  for (const side of [-1, 1]) {
    const off = new THREE.Vector2(-BRIDGE_DIR.y, BRIDGE_DIR.x).multiplyScalar(side * (BRIDGE.halfW + 0.05));
    const a = BRIDGE.a.clone().add(off), b = BRIDGE.b.clone().add(off);
    const ropeGeo = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 17 }, (_, i) => {
        const t = i / 16, p = a.clone().lerp(b, t);
        return new THREE.Vector3(p.x, 0.95 - Math.sin(Math.PI * t) * 0.25, p.y);
      }));
    scene.add(new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0x4a3626 })));
  }
  // 邻峰：索桥那头的山石，顶上一块平台
  const peak = rockColumn(PEAK.r, 2.2, 22, 11);
  peak.position.set(PEAK.c.x, -11, PEAK.c.y);
  const landing = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(PEAK.r + 0.15, PEAK.r, 0.3, 40), darkStone));
  landing.position.set(PEAK.c.x, -0.15, PEAK.c.y);
  scene.add(peak, landing);

  // 阵眼：地上一圈发光阵盘 + 悬浮水晶 + 八根石桩
  const coreColor = col(PALETTE.arcane.secondary, 1.6);
  const coreSigil = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 4.8), sigilMat(sigilTex(), coreColor));
  coreSigil.material.opacity = 0.9;
  coreSigil.rotation.x = -Math.PI / 2;
  coreSigil.position.set(CORE_POS.x, 0.03, CORE_POS.z);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0),
    new THREE.MeshStandardMaterial({ color: 0x9fe7ff, emissive: coreColor, emissiveIntensity: 0.8, roughness: 0.2 }));
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

  return { coreSigil, crystal, caster, gateBox, stoneBox, plaza };
}

/**
 * 一根铁链：从 a 到 b 一节节扁环，相邻两节转 90°。一次画完（实例化）。
 * @param {THREE.Vector3} a @param {THREE.Vector3} b @param {THREE.Material} mat
 */
function chain(a, b, mat) {
  const LINK = 0.16, dir = b.clone().sub(a), n = Math.max(2, Math.round(dir.length() / LINK));
  const geo = new THREE.TorusGeometry(0.07, 0.022, 6, 10);
  geo.scale(1, 1.45, 1);                                   // 拉成长圆环，长边顺着链子
  const links = new THREE.InstancedMesh(geo, mat, n);
  const align = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const twist = new THREE.Quaternion(), q = new THREE.Quaternion(), m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < n; i++) {
    twist.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i % 2) * Math.PI / 2);
    q.copy(align).multiply(twist);
    links.setMatrixAt(i, m.compose(a.clone().lerp(b, (i + 0.5) / n), q, one));
  }
  links.castShadow = true;
  return links;
}
