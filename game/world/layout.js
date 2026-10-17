// @ts-check
/**
 * 云海之上的宗门山门广场（方块版）。尺寸与玩法、物理对齐：
 *   - 广场：半径 11 米的圆台，边缘之下是云海（用风推出去就没进云里）；
 *   - 正面：从云海升上来的长石阶（敌人路线一）；左前：通往邻峰的索桥（敌人路线二）；
 *   - 石阶口上方是山门牌坊，粗绳吊着镇山石；两侧香炉；石阶两旁华表；
 *   - 施法者站在阵眼前面，阵眼破了就输。
 * 地标物件以后换成模型，这里先用方块占位；位置以这里为准。
 */
import * as THREE from 'three';
import { canvasTex, col, PALETTE, rng, sigilMat, sigilTex } from '../fx/common.js';

export const PLAZA_R = 11;
export const CORE_POS = new THREE.Vector3(0, 0, 8.6);
export const CASTER_POS = new THREE.Vector3(0, 0, 5.2);
const STAIRS = { halfW: 2.0, zTop: -10.4, zBottom: -26, yBottom: -10 };
const BRIDGE = { a: new THREE.Vector2(-9.2, -5.4), b: new THREE.Vector2(-24, -14.2), halfW: 1.05 };
const BRIDGE_DIR = BRIDGE.b.clone().sub(BRIDGE.a).normalize();
const PEAK = { c: BRIDGE.b.clone().addScaledVector(BRIDGE_DIR, 3.6), r: 4.4 };

/** 场景物件的位置（玩家可以点名的目标） */
export const OBJECTS = {
  rope: { x: 0, z: -10.8 },
  censer: { x: -7.2, z: 1.5 },
  bridge: { x: (BRIDGE.a.x + BRIDGE.b.x) / 2, z: (BRIDGE.a.y + BRIDGE.b.y) / 2 },
  pillar: { x: -4.4, z: -9.4 },
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

/** @param {THREE.Scene} scene */
export function buildLayout(scene) {
  const R = rng(5);
  const stone = new THREE.MeshStandardMaterial({ color: 0xbdb6a8, roughness: 0.9 });
  const darkStone = new THREE.MeshStandardMaterial({ color: 0x8c8578, roughness: 0.95 });
  const cliffMat = new THREE.MeshStandardMaterial({ color: 0x7d776c, roughness: 1, flatShading: true });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5636, roughness: 0.85 });
  const lacquer = new THREE.MeshStandardMaterial({ color: 0x8e2b22, roughness: 0.6 });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.45, metalness: 0.7 });
  const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  // 广场地面：浅色石板
  const tiles = canvasTex(1024, (g, S) => {
    g.fillStyle = '#9b958a'; g.fillRect(0, 0, S, S);
    const n = 8, cell = S / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const l = 66 + R() * 10;
      g.fillStyle = `hsl(38, 8%, ${l}%)`;
      g.fillRect(x * cell + 3, y * cell + 3, cell - 6, cell - 6);
    }
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(60,50,40,${R() * 0.05})`; g.fillRect(R() * S, R() * S, 2, 2); }
  });
  tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping;
  tiles.repeat.set(5, 5);
  const top = shadowy(new THREE.Mesh(new THREE.CircleGeometry(PLAZA_R, 72),
    new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.92 })));
  top.rotation.x = -Math.PI / 2;
  scene.add(top);
  const rim = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(PLAZA_R + 0.05, PLAZA_R + 0.05, 0.7, 72, 1, true), darkStone));
  rim.position.y = -0.35;
  scene.add(rim);

  // 广场下面的山体：往下收窄、表面起伏，插进云海
  const cliffGeo = new THREE.CylinderGeometry(PLAZA_R, 6, 20, 40, 6);
  const cp = cliffGeo.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const y = cp.getY(i);
    if (y < 9.9) { const k = 0.82 + R() * 0.3; cp.setX(i, cp.getX(i) * k); cp.setZ(i, cp.getZ(i) * k); }
  }
  cliffGeo.computeVertexNormals();
  const cliff = shadowy(new THREE.Mesh(cliffGeo, cliffMat));
  cliff.position.y = -10.7;
  scene.add(cliff);

  // 石阶：16 级，从云海里升到广场边缘
  const N = 16, depth = (STAIRS.zTop - STAIRS.zBottom) / N, rise = -STAIRS.yBottom / N;
  const stepGeo = new THREE.BoxGeometry(STAIRS.halfW * 2, rise, depth);
  const steps = new THREE.InstancedMesh(stepGeo, stone, N);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    m4.makeTranslation(0, -rise * (i + 0.5), STAIRS.zTop - depth * (i + 0.5));
    steps.setMatrixAt(i, m4);
  }
  steps.castShadow = steps.receiveShadow = true;
  scene.add(steps);
  const ramp = shadowy(new THREE.Mesh(new THREE.BoxGeometry(STAIRS.halfW * 2 + 0.6, 4, STAIRS.zTop - STAIRS.zBottom + 1), darkStone));
  ramp.position.set(0, STAIRS.yBottom / 2 - 2.1, (STAIRS.zTop + STAIRS.zBottom) / 2);
  ramp.rotation.x = -Math.atan2(-STAIRS.yBottom, STAIRS.zTop - STAIRS.zBottom);   // 靠广场（+z）那头高
  scene.add(ramp);

  // 山门牌坊 + 吊着的镇山石
  for (const sx of [-3.0, 3.0]) {
    const post = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.8, 7, 0.8), lacquer));
    post.position.set(sx, 3.5, -10.8);
    scene.add(post);
  }
  const beam = shadowy(new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.5, 0.6), lacquer));
  beam.position.set(0, 5.6, -10.8);
  const roof = shadowy(new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.6, 1.6), new THREE.MeshStandardMaterial({ color: 0x3d4a52, roughness: 0.7 })));
  roof.position.set(0, 7.25, -10.8);
  const plaque = shadowy(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 0.12), new THREE.MeshStandardMaterial({ color: 0x23303a })));
  plaque.position.set(0, 6.35, -10.45);
  scene.add(beam, roof, plaque);
  const boulder = shadowy(new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 0), darkStone));
  boulder.position.set(0, 3.7, -10.8);
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6), wood);
  rope.position.set(0, 4.95, -10.8);
  scene.add(boulder, rope);

  // 华表（石阶两旁）与香炉（广场两侧）
  for (const sx of [-4.4, 4.4]) {
    const col_ = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 4.6, 12), stone));
    col_.position.set(sx, 2.3, -9.4);
    const cap = shadowy(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.4), stone));
    cap.position.set(sx, 3.9, -9.4);
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
  const yaw = Math.atan2(BRIDGE_DIR.x, BRIDGE_DIR.y);
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
  const peakGeo = new THREE.CylinderGeometry(PEAK.r, 2.2, 22, 18, 4);
  const pp = peakGeo.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    if (pp.getY(i) < 10.9) { const k = 0.8 + R() * 0.35; pp.setX(i, pp.getX(i) * k); pp.setZ(i, pp.getZ(i) * k); }
  }
  peakGeo.computeVertexNormals();
  const peak = shadowy(new THREE.Mesh(peakGeo, cliffMat));
  peak.position.set(PEAK.c.x, -11, PEAK.c.y);
  scene.add(peak);

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

  return { coreSigil, crystal, caster, boulder };
}
