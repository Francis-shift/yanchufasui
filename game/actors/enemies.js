// @ts-check
/**
 * 傀儡（方块版）：沿石阶或索桥一跳一跳地走向阵眼；索桥那一路从邻峰的黑雾里走出来。
 * 会被冻住（停步、发蓝）、点燃（持续掉血）、被风推走（脚下没地面就坠入云海）；
 * 死了就碎成方块由物理引擎炸开。碰到阵眼扣阵眼的血。
 * 试炼模式（modes/trial.js）另有两种走法：boss 的位置由试炼模式每帧摆（mode 'boss'）；小怪潮和 boss 召的小怪追着施法者（mode 'chase'）：
 * 小傀儡贴身自爆，符箓傀儡（额头贴黄符）站远处射火球，铁头傀儡（戴铁盔）冲锋——射和冲由试炼模式摆（e.act），这里只管平时怎么走。
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BOSS, ELEMENTS, ENEMIES, FLAME, MINION, STONE } from '../rules/numbers.js';
import { archerIntent, keepInArena } from '../rules/trial.js';
import { attachToBone, makeRig, playRig } from './rig.js';
import { CASTER_POS, CORE_POS, groundHeightAt, OBSTACLES, PATHS, PLAZA_R, SPAWN_FOG } from '../world/layout.js';
import { FlowField } from '../world/flowfield.js';
import { col, PALETTE, rand } from '../fx/common.js';

const CORE_FRONT = new THREE.Vector3(CORE_POS.x, 0, CORE_POS.z - 2.2);
/** 索桥那一路从邻峰的黑雾里出来（layout.js SPAWN_FOG）：先只看得见两只眼睛，身子再从暗处慢慢显出来，要这么多秒 */
const EMERGE_SEC = 1.2;
const EMERGE_DARK = new THREE.Color(0.04, 0.03, 0.06);
const { smoothstep } = THREE.MathUtils;
/** 走进阵眼这么近就算撞上阵眼 */
const CORE_REACH = 2.6;
/** 广场上的固定障碍：场景物件（位置以 layout.js 为准）加上施法者本人 */
const STATIC_OBSTACLES = [...OBSTACLES, { x: CASTER_POS.x, z: CASTER_POS.z, r: 0.5 }];
/** 试炼模式：追上来的小傀儡离施法者这么近就自爆；铁头傀儡贴到这么近就站住等着冲 */
const TOUCH_REACH = 0.9;
const CHARGER_STOP = 1.0;
/** @typedef {'grunt' | 'shield' | 'colossus' | 'boss' | 'stone' | 'flame' | 'archer' | 'charger'} EnemyType */
/**
 * 小傀儡模型（actors/rig.js）到了以后三种小怪的样子：同一个模型，颜色乘在贴图上、身高（米）各不同，挂件另加（spawn 里）。
 * 盾傀儡、巨像还是方块；boss 见 BOSS_LOOK。chip：碎块的颜色（木头色乘上染色）
 */
const RIG_LOOK = {
  grunt: { tint: 0xffffff, h: 1.3 },
  archer: { tint: 0xc9a2ff, h: 1.15 },
  charger: { tint: 0xb8c4d6, h: 1.45 },
};
/**
 * 换成绑骨骼模型的 boss（模型由 useBossRig 给，没到之前照旧方块）：身高（米）、染色、碎块颜色、出招身段（lean）打几折（动作自己会俯仰）。
 * 寒甲傀儡王：方块那版高约 4 米，模型取 3.8（宽是身高的 0.92 倍，双拳垂在身侧）
 * @type {Record<string, { h: number, tint: number, chip: number, lean: number }>}
 */
const BOSS_LOOK = { boss: { h: 3.8, tint: 0xffffff, chip: 0x5a6872, lean: 0.35 } };
/** 出拳那段动作里拳头打到最远是第几秒：符箓傀儡蓄力到点（出火球）正好打出去 */
const AIM_PUNCH = 0.875;

/** 路径长度表，便于按走过的距离取位置；entry 是走到哪里算上了广场（之后改跟流场走） */
function pathInfo(pts) {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const info = { pts, lens, total: lens[lens.length - 1], entry: Infinity };
  const p = new THREE.Vector3(), d = new THREE.Vector3();
  for (let s = 0; s <= info.total; s += 0.25) {
    pointAt(info, s, p, d);
    if (p.x * p.x + p.z * p.z < (PLAZA_R - 1.2) ** 2) { info.entry = s; break; }
  }
  return info;
}
function pointAt(info, s, out, dirOut) {
  const { pts, lens } = info;
  let i = 1;
  while (i < pts.length - 1 && lens[i] < s) i++;
  const a = pts[i - 1], b = pts[i];
  const t = THREE.MathUtils.clamp((s - lens[i - 1]) / Math.max(lens[i] - lens[i - 1], 1e-6), 0, 1);
  out.copy(a).lerp(b, t);
  dirOut.copy(b).sub(a).setY(0).normalize();
  return out;
}

let seq = 0;

export class Enemies {
  /**
   * @param {THREE.Scene} scene
   * @param {CANNON.World} world
   * @param {import('../fx/particles.js').Particles} particles
   * @param {{ onCoreHit: (dmg: number) => void, onGone: (e: any, how: 'kill' | 'fall' | 'core' | 'touch') => void,
   *           floatText: (p: THREE.Vector3, text: string, color: string) => void, pushed?: (e: any) => void, emerge?: (e: any) => void,
   *           touch?: (e: any) => void }} hooks
   *   pushed：被风吹飞的那一下（画面在身后拖笔触）；emerge：一个敌人从邻峰的黑雾里出来（雾鼓一下）；touch：试炼模式里小傀儡贴身自爆
   */
  constructor(scene, world, particles, hooks) {
    this.scene = scene; this.world = world; this.particles = particles; this.hooks = hooks;
    /** @type {any[]} */
    this.list = [];
    /** @type {{ mesh: THREE.Mesh, mat: THREE.Material, body: CANNON.Body, t: number }[]} */
    this.debris = [];
    this.paths = PATHS.map(pathInfo);
    /** 广场上的寻路：石阶、索桥仍是仅有的两个入口，上了广场就跟着流场走 */
    this.field = new FlowField({ radius: PLAZA_R - 0.4, goal: { x: CORE_POS.x, z: CORE_POS.z, r: CORE_REACH - 0.2 } });
    this.field.setObstacles(STATIC_OBSTACLES);
    // 试炼：追人的小傀儡另用一张以玩家为目标的流场（玩家走动就重算，见 chaseDir）。只看身边的绕法出不了凹口：
    // 石兽和牌坊柱子挨着，顺着一根滑又撞上另一根（10-27 预览：玩家站到牌坊下，一只卡在两者之间不动）
    this.chaseField = new FlowField({ radius: PLAZA_R - 0.4, goal: { x: CASTER_POS.x, z: CASTER_POS.z, r: 1.0 } });
    this.chaseField.setObstacles(OBSTACLES);
    this.chaseAt = { x: CASTER_POS.x, z: CASTER_POS.z };
    this.geo = {
      torso: new THREE.BoxGeometry(0.62, 0.7, 0.4), head: new THREE.BoxGeometry(0.42, 0.42, 0.42),
      arm: new THREE.BoxGeometry(0.16, 0.6, 0.16), leg: new THREE.BoxGeometry(0.18, 0.42, 0.18),
      eye: new THREE.BoxGeometry(0.08, 0.06, 0.02), shard: new THREE.BoxGeometry(0.22, 0.22, 0.22),
      shield: new THREE.BoxGeometry(0.9, 1.0, 0.1), bar: new THREE.PlaneGeometry(0.8, 0.07),
      armor: new THREE.BoxGeometry(0.86, 1.5, 0.62), boulder: new THREE.DodecahedronGeometry(0.34, 0),
      charm: new THREE.BoxGeometry(0.1, 0.36, 0.02), helmet: new THREE.BoxGeometry(0.5, 0.2, 0.5), ram: new THREE.BoxGeometry(0.2, 0.14, 0.12),
      // 挂在模型头骨上的（模型单位：头从 0.68 到顶 1.0，最宽在 0.85 处、左右 ±0.19、前后 ±0.16，往上收窄；脸朝 +z）。
      // 铁盔是贴着头形的半球（底边在眼睛上面），前沿一道帽檐：方盒子扣在圆头上像顶着箱子（10-28 截图）
      rigCharm: new THREE.BoxGeometry(0.08, 0.22, 0.012),
      rigHelmet: new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.205, 0.17, 0.18),
      rigRam: new THREE.BoxGeometry(0.26, 0.04, 0.08),
      // 火灵的火罩：裹住全身的一团火（椭球），头顶再窜一簇火苗（底在原点，试炼模式按时间拉高拉矮）
      shroud: new THREE.SphereGeometry(1, 18, 12).scale(0.62, 0.95, 0.5), wisp: new THREE.ConeGeometry(0.22, 0.7, 8).translate(0, 0.35, 0),
    };
    /** @type {import('./rig.js').Rig | null} 小傀儡模型，没到之前（或下载失败）用方块 */
    this.rig = null;
    /** @type {Record<string, import('./rig.js').Rig>} 各个 boss 自己的模型（按敌人种类），没到的照旧方块 */
    this.bossRigs = {};
    this.eyeMat = new THREE.MeshBasicMaterial({ color: col(PALETTE.enemy.primary, 2.2) });
    // 符箓傀儡额头上的黄符、铁头傀儡的铁盔（所有同类共用，不随敌人销毁）
    this.charmMat = new THREE.MeshStandardMaterial({ color: 0xe8c860, emissive: 0x6a4a10, emissiveIntensity: 0.6, roughness: 0.9 });
    this.ironMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.4, metalness: 0.6 });
    /** boss 的冰甲：罩住上身的一层半透明冰（只有一个 boss，材质共用；透明度由试炼模式按剩多少甲调） */
    this.armorMat = new THREE.MeshStandardMaterial({ color: 0xcdeeff, roughness: 0.12, transparent: true, opacity: 0.55,
      emissive: 0x2f7fc0, emissiveIntensity: 0.5, depthWrite: false });
    // 换成模型的寒甲傀儡王：冰甲是贴着身子的一层（同一副骨架带着动），沿法线往外鼓 0.018（模型高 1），只罩静止姿势里 0.3 以上（膝盖以上）
    this.shellMat = this.armorMat.clone();
    this.shellMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vRestY;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * 0.018;\nvRestY = position.y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRestY;')
        .replace('void main() {', 'void main() {\n  if (vRestY < 0.3) discard;');
    };
    // 石甲巨像的石甲：胸前一整块石板、两肩各压一块大石头（棱角分明），石缝里透一点土黄的光
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x5f5548, roughness: 0.95, flatShading: true, emissive: 0x3a2408, emissiveIntensity: 0.6 });
    // 火灵的火罩：半透明、自己发光（亮过泛光阈值）；透明度由试炼模式按剩多少罩、一闪一闪地调
    // 1.6 倍发光、0.58 不透明那版整团橙色糊成一颗实心的蛋，里面只透出两只眼睛（10-28 截图），压下来让身形透出来
    this.flameMat = new THREE.MeshStandardMaterial({ color: 0xff9a4a, emissive: 0xff5a14, emissiveIntensity: 1.0, roughness: 0.6, transparent: true,
      opacity: 0.4, depthWrite: false });
    this.barBg = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.6, depthTest: false });
    this._p = new THREE.Vector3(); this._d = new THREE.Vector3();
  }

  /** 小傀儡模型下载好了：之后冒出来的小怪用模型（已经在场上的照旧是方块） @param {import('./rig.js').Rig} rig */
  useRig(rig) { this.rig = rig; }

  /** 某个 boss 的模型下载好了：之后现身的这个 boss 用模型 @param {EnemyType} type @param {import('./rig.js').Rig} rig */
  useBossRig(type, rig) { this.bossRigs[type] = rig; }

  /** @param {EnemyType} type @param {number} pathIndex */
  spawn(type, pathIndex) {
    const spec = ENEMIES[type];
    // 用哪份模型：这个 boss 自己的；三种小怪共用小傀儡的；都没有（或没下载完）就方块
    const bossLook = this.bossRigs[type] ? BOSS_LOOK[type] : undefined;
    const src = bossLook ? this.bossRigs[type] : this.rig && RIG_LOOK[/** @type {keyof typeof RIG_LOOK} */ (type)] ? this.rig : null;
    const look = bossLook ?? (src ? RIG_LOOK[/** @type {keyof typeof RIG_LOOK} */ (type)] : undefined);
    // 符箓傀儡紫、铁头傀儡浅钢灰：0x585d66 那版在紫色天光下和符箓傀儡一样黑（10-28 截图）
    const tint = look?.tint ?? { shield: 0x6f6a62, boss: 0x7f93a8, stone: 0x8a8378, flame: 0x6a3022, archer: 0x7a5aa8, charger: 0x9097a3 }[type] ?? 0x8b7355;
    const mat = new THREE.MeshStandardMaterial({ color: tint, roughness: look ? 0.85 : 0.8, map: look ? src?.tex : null });
    const base = mat.color.clone(), fromFog = pathIndex % this.paths.length === SPAWN_FOG.path;
    if (fromFog) { mat.transparent = true; mat.opacity = 0; mat.color.copy(EMERGE_DARK); }   // 眼睛是另一种材质，一开始就亮着
    const g = new THREE.Group();
    const scale = { boss: BOSS.scale, stone: STONE.scale, flame: FLAME.scale, colossus: 2.2, shield: 1.15, archer: 0.85, charger: 1.05 }[type] ?? 0.9;
    let armorMesh = null, rig = null;
    if (look && src) {
      // 模型：骨骼动作代替一跳一跳；scale 仍按方块那套算（瞄准点、互相挤开的距离不变），画出来的大小按身高
      rig = makeRig(src, mat);
      const prop = (/** @type {THREE.BufferGeometry} */ geo, /** @type {THREE.Material} */ m, /** @type {number} */ y, /** @type {number} */ z, rx = 0) => {
        const o = new THREE.Mesh(geo, m);
        o.position.set(0, y, z); o.rotation.x = rx; o.castShadow = true;
        attachToBone(rig, 'Head', o);
      };
      if (type === 'archer') prop(this.geo.rigCharm, this.charmMat, 0.86, 0.165, -0.22);   // 额头正中垂一道黄符，顺着脸往后仰
      if (type === 'charger') { prop(this.geo.rigHelmet, this.ironMat, 0.84, 0); prop(this.geo.rigRam, this.ironMat, 0.855, 0.17); }
      g.add(rig.mesh);
      if (type === 'boss') {   // 冰甲：同一份网格、同一副骨架再画一层（shellMat 往外鼓、只罩上身），跟着动作走
        const shell = new THREE.SkinnedMesh(src.geometry, this.shellMat);
        shell.bind(rig.mesh.skeleton, new THREE.Matrix4());
        shell.frustumCulled = false;
        rig.mesh.add(shell);
        armorMesh = shell;
      }
      g.scale.setScalar(look.h);
    } else {
      const part = (geo, x, y, z, m = /** @type {THREE.Material} */ (mat)) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
      part(this.geo.torso, 0, 0.77, 0); part(this.geo.head, 0, 1.35, 0);
      part(this.geo.arm, -0.42, 0.8, 0); part(this.geo.arm, 0.42, 0.8, 0);
      part(this.geo.leg, -0.16, 0.21, 0); part(this.geo.leg, 0.16, 0.21, 0);
      part(this.geo.eye, -0.1, 1.4, 0.215, this.eyeMat); part(this.geo.eye, 0.1, 1.4, 0.215, this.eyeMat);
      if (type === 'shield') part(this.geo.shield, 0, 0.8, 0.42);
      if (type === 'archer') part(this.geo.charm, 0, 1.38, 0.225, this.charmMat);   // 两眼之间垂下一道黄符
      if (type === 'charger') { part(this.geo.helmet, 0, 1.52, 0, this.ironMat); part(this.geo.ram, 0, 1.5, 0.28, this.ironMat); }
      if (type === 'boss') { armorMesh = part(this.geo.armor, 0, 1.0, 0, this.armorMat); armorMesh.castShadow = false; }
      if (type === 'stone') {   // 石甲：胸前石板加两肩的大石头，一起显隐（armorMesh）
        armorMesh = part(this.geo.armor, 0, 0.95, 0.02, this.rockMat);
        for (const sx of [-1, 1]) {
          const b = new THREE.Mesh(this.geo.boulder, this.rockMat);
          b.position.set(sx * 0.5, 0.3, 0); b.rotation.set(0.4, sx * 0.7, 0.2); b.castShadow = true;
          armorMesh.add(b);
        }
      }
      if (type === 'flame') {   // 火罩：裹住全身的一团火，头顶一簇火苗（第一个子物体，试炼模式让它跳），一起显隐
        armorMesh = part(this.geo.shroud, 0, 0.85, 0, this.flameMat);
        armorMesh.castShadow = false;
        const w = new THREE.Mesh(this.geo.wisp, this.flameMat);
        w.position.y = 0.85;
        armorMesh.add(w);
      }
      g.scale.setScalar(scale);
    }
    g.rotation.order = 'YXZ';   // 先转向、再前倾、再左右晃
    const bar = new THREE.Group();
    const bg = new THREE.Mesh(this.geo.bar, this.barBg);
    const fillMat = new THREE.MeshBasicMaterial({ color: 0xe0453a, depthTest: false });
    const fill = new THREE.Mesh(this.geo.bar, fillMat);
    fill.position.z = 0.001;
    bg.renderOrder = fill.renderOrder = 5;
    bar.add(bg, fill);
    bar.visible = false;
    this.scene.add(g, bar);
    const info = this.paths[pathIndex % this.paths.length];
    const e = {
      id: `e${++seq}`, type, spec, hp: spec.hp, maxHp: spec.hp, group: g, mat, base, bar, fill, fillMat, scale,
      path: info, s: 0, lateral: rand(-0.7, 0.7), mode: 'walk', pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      dir: new THREE.Vector3(0, 0, 1), frozen: 0, burn: 0, stun: 0, hop: rand(0, Math.PI * 2), lastHitEl: '', squash: 0,
      emerge: fromFog ? 0 : 1, armorMesh, lean: 0, moving: false, chase: false,
      // 试炼的小怪：act 是试炼模式摆的出招（符箓傀儡 'aim'，铁头傀儡 'tele' / 'rush' / 'daze'），cd 离下一次出招还有几秒；side 符箓傀儡横挪往哪边
      act: '', cd: 0, side: Math.random() < 0.5 ? 1 : -1,
      // 有模型的：rig 骨架与动作（rigSrc 是哪份模型），vis 画出来的身高，spd 这几帧实际挪多快（挑走还是跑），px / pz 上一帧在哪；top 血条多高；
      // leanK 出招身段打几折；pose 试炼的 boss 出招时该摆哪段动作的第几秒（试炼模式每帧给）
      rig, rigSrc: rig ? src : null, vis: look?.h ?? scale, spd: 0, px: NaN, pz: NaN, top: look ? look.h + 0.25 : 1.85 * scale,
      leanK: bossLook ? bossLook.lean : 0.5, pose: null,
      chip: bossLook ? new THREE.Color(bossLook.chip) : look ? new THREE.Color(0x7a6650).multiply(new THREE.Color(look.tint)) : base,
    };
    pointAt(info, 0, e.pos, e.dir);
    this.list.push(e);
    if (fromFog) this.hooks.emerge?.(e);
    return e;
  }

  /**
   * 试炼模式：直接放在广场上某处（不走石阶索桥）。
   * mode 'boss'：位置、朝向由试炼模式每帧摆（moving 为真时播走路的动画）；'chase'：自己追施法者（见 chaseStep）。
   * @param {EnemyType} type @param {number} x @param {number} z @param {'boss' | 'chase'} mode
   */
  spawnAt(type, x, z, mode) {
    const e = this.spawn(type, 0);
    e.mode = mode;
    e.chase = mode === 'chase';
    e.pos.set(x, groundHeightAt(x, z) ?? 0, z);
    e.dir.set(CASTER_POS.x - x, 0, CASTER_POS.z - z).normalize();
    return e;
  }

  get alive() { return this.list.length; }

  /**
   * 场景里多出（或撤掉）挡路的东西时调用：土墙立起、华表倒地……流场重算，敌人马上改道。
   * @param {{ x: number, z: number, r: number }[]} list 固定障碍之外的临时障碍
   */
  setObstacles(list) {
    this.temp = list; this.field.setObstacles([...STATIC_OBSTACLES, ...list]);
    this.chaseField.setObstacles([...OBSTACLES, ...list]);
  }

  /**
   * 追人的小傀儡往哪走：到施法者的直线上没有障碍就直走，挡着就跟流场绕。施法者挪了 0.4 米以上，流场重算（两千来格，不到一毫秒）。
   * @param {THREE.Vector3} p 小傀儡的位置 @param {number} dx @param {number} dz 到施法者的向量 @param {number} d 距离 @param {THREE.Vector3} out
   */
  chaseDir(p, dx, dz, d, out) {
    out.set(dx / d, 0, dz / d);
    const obs = this.chaseField.obstacles;
    const blocked = obs.some((o) => {
      const t = Math.max(0, Math.min(1, ((o.x - p.x) * dx + (o.z - p.z) * dz) / (d * d)));
      return (p.x + dx * t - o.x) ** 2 + (p.z + dz * t - o.z) ** 2 < (o.r + 0.35) ** 2;
    });
    if (!blocked) return out;
    if (Math.hypot(CASTER_POS.x - this.chaseAt.x, CASTER_POS.z - this.chaseAt.z) > 0.4) {
      this.chaseAt.x = this.chaseField.goal.x = CASTER_POS.x; this.chaseAt.z = this.chaseField.goal.z = CASTER_POS.z;
      this.chaseField.rebuild();
    }
    const f = this.chaseField.dirAt(p.x, p.z);
    return f ? out.set(f.x, 0, f.z) : out;
  }

  /**
   * 试炼里追人的一步。小傀儡、铁头傀儡直奔施法者（铁头傀儡贴到 1 米就站住）；符箓傀儡一直面朝施法者，
   * 离得远就靠近、太近就后退（退到广场边退不动了改横挪）、不远不近就横着挪，时不时换个方向。同伴之间挤开一点；土墙挡着就原地等。
   * @param {any} e @param {number} dx @param {number} dz 到施法者的向量 @param {number} d 距离 @param {number} dt
   */
  chaseStep(e, dx, dz, d, dt) {
    const turn = 1 - Math.exp(-8 * dt);
    let vx, vz, speed = e.spec.speed;
    if (e.type === 'archer') {
      const A = MINION.archer, face = this._p.set(dx / d, 0, dz / d);
      e.dir.lerp(face, turn).setY(0).normalize();
      let k = archerIntent(d, A.keep);
      if (k === -1 && Math.hypot(e.pos.x, e.pos.z) > PLAZA_R - 1.8) k = 0;
      if (k === 1) { const w = this.chaseDir(e.pos, dx, dz, d, this._d); vx = w.x; vz = w.z; }
      else if (k === -1) { vx = -face.x; vz = -face.z; }
      else {
        if (Math.random() < dt * 0.5) e.side = -e.side;
        vx = -face.z * e.side; vz = face.x * e.side; speed *= A.strafe;
      }
    } else {
      const want = this.chaseDir(e.pos, dx, dz, d, this._p);
      // 人正好在身后（铁头傀儡冲过了头）：两个方向正相反时插值只会缩短、归一化又还原，永远转不过来（10-28 预览：冲完背着人走到广场边）。先侧转 90°
      if (e.dir.dot(want) < -0.95) e.dir.set(-e.dir.z, 0, e.dir.x);
      e.dir.lerp(want, turn).setY(0).normalize();
      vx = e.dir.x; vz = e.dir.z;
      if (e.type === 'charger' && d <= CHARGER_STOP) speed = 0;
    }
    let sx = 0, sz = 0;   // 同伴之间挤开一点
    for (const o of this.list) {
      if (o === e || !o.chase) continue;
      const ox = e.pos.x - o.pos.x, oz = e.pos.z - o.pos.z, d2 = ox * ox + oz * oz, minD = 0.45 * (e.scale + o.scale);
      if (d2 > 1e-6 && d2 < minD * minD) { const od = Math.sqrt(d2); sx += (ox / od) * (minD - od); sz += (oz / od) * (minD - od); }
    }
    const nx = e.pos.x + (vx * speed + sx * 3) * dt, nz = e.pos.z + (vz * speed + sz * 3) * dt;
    if (!this.blockedAt(nx + vx * 0.3, nz + vz * 0.3)) { e.pos.x = nx; e.pos.z = nz; }   // 土墙挡着就原地等
    keepInArena(e.pos, OBSTACLES, PLAZA_R - 0.6, 0.3);
    e.moving = speed > 0;
  }

  /** 石阶、索桥上沿固定路线走的敌人不看流场：前面有土墙就原地等（等墙沉下去再走） */
  blockedAt(x, z) { return (this.temp || []).some((o) => (x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + 0.4) ** 2); }

  /** 给裁决器看的样子：位置、血量、离阵眼多远（试炼模式里阵眼就是施法者本人：离施法者多远） */
  views() {
    return this.list.map((e) => ({
      id: e.id, x: e.pos.x, z: e.pos.z, hp: e.hp,
      distToCore: e.mode === 'walk' ? e.path.total - e.s
        : e.mode === 'field' ? (this.field.distAt(e.pos.x, e.pos.z) ?? e.pos.distanceTo(CORE_POS))
        : e.mode === 'boss' || e.chase ? Math.hypot(e.pos.x - CASTER_POS.x, e.pos.z - CASTER_POS.z) : e.pos.distanceTo(CORE_FRONT),
    }));
  }

  /** @param {string} id */
  get(id) { return this.list.find((e) => e.id === id) || null; }

  /** 身体中心（瞄准用） */
  aimPoint(e, out = new THREE.Vector3()) { return out.copy(e.pos).setY(e.pos.y + 0.8 * e.scale); }

  /**
   * 结算一次命中（伤害与效果已由 damageTo 算好）。
   * @param {any} e
   * @param {{ dmg: number, freezeSec: number, burnSec: number, unfreeze: boolean, push: number, reaction: string, stunSec?: number }} r
   * @param {THREE.Vector3} from 冲击来源点（风往反方向推）
   * @param {string} el
   */
  applyHit(e, r, from, el) {
    if (!this.list.includes(e)) return;
    e.hp -= r.dmg;
    e.lastHitEl = el;
    if (r.unfreeze) e.frozen = 0;
    if (r.freezeSec) e.frozen = Math.max(e.frozen, r.freezeSec);
    if (r.burnSec) e.burn = Math.max(e.burn, r.burnSec);
    if (r.stunSec) e.stun = Math.max(e.stun, r.stunSec);
    if (r.push && e.mode !== 'fall' && e.mode !== 'boss') {
      // 方向：离爆心向外（四成）+ 背离施法者（六成）——「吹下悬崖」是往外吹，不是原地打转
      const d = this._d.copy(e.pos).sub(from).setY(0);
      if (d.lengthSq() > 1e-4) d.normalize();
      const away = this._p.copy(e.pos).sub(CASTER_POS).setY(0).normalize();
      d.multiplyScalar(0.4).addScaledVector(away, 0.6);
      if (d.lengthSq() < 1e-4) d.set(0, 0, -1);
      d.normalize();
      e.vel.set(d.x * r.push, 1.5, d.z * r.push);
      e.mode = 'slide';
      this.hooks.pushed?.(e);
    }
    this.hooks.floatText(this.aimPoint(e).setY(e.pos.y + 1.7 * e.scale),
      (r.reaction ? r.reaction + ' ' : '') + Math.round(r.dmg), r.reaction ? '#ffe27a' : '#ffffff');
    if (e.hp <= 0) this.kill(e, from);
  }

  /**
   * 广场上的一步：朝流场指的方向走，同时和身边的同伴互相挤开一点（不然同一条路上的会叠成一个）。
   * 方向做平滑，免得格子边上来回抖。
   */
  steer(e, dt) {
    const f = this.field.dirAt(e.pos.x, e.pos.z);
    const want = this._p.set(f ? f.x : CORE_POS.x - e.pos.x, 0, f ? f.z : CORE_POS.z - e.pos.z).normalize();
    const k = 1 - Math.exp(-8 * dt);
    e.dir.lerp(want, k).setY(0).normalize();
    let sx = 0, sz = 0;
    for (const o of this.list) {
      if (o === e || o.mode !== 'field') continue;
      const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
      const minD = 0.45 * (e.scale + o.scale);
      if (d2 > 1e-6 && d2 < minD * minD) { const d = Math.sqrt(d2); sx += (dx / d) * (minD - d); sz += (dz / d) * (minD - d); }
    }
    const v = e.spec.speed;
    e.pos.x += (e.dir.x * v + sx * 3) * dt;
    e.pos.z += (e.dir.z * v + sz * 3) * dt;
  }

  /**
   * 有模型的敌人挑动作、推进动作。冻住、麻痹就定在这一帧。出招按招：符箓傀儡蓄力时出拳（拳头打到最远正好是出火球那一刻），
   * 铁头傀儡预警、发晕站着，冲锋时狂奔；被吹飞、坠落也站着。平时看这几帧实际挪了多快：慢走、快跑，播放快慢 = 实际速度 ÷（动作原本的速度 × 身高），
   * 脚才不打滑；面朝人往后退（符箓傀儡）就把走路倒着放。试炼的 boss 出招时（e.pose）放哪段、第几秒由试炼模式给（actors/bossanim.js），
   * 这里只换段、摆到那一秒；没有跑的模型（boss）快了也是走。
   * @param {any} e @param {number} dt @param {boolean} held
   */
  animate(e, dt, held) {
    if (dt <= 0 || !e.rigSrc) return;
    const dx = Number.isFinite(e.px) ? e.pos.x - e.px : 0, dz = Number.isFinite(e.pz) ? e.pos.z - e.pz : 0;
    e.px = e.pos.x; e.pz = e.pos.z;
    e.spd += (Math.hypot(dx, dz) / dt - e.spd) * Math.min(1, dt * 8);
    if (held) return;
    if (e.pose && e.rig.actions[e.pose.clip]) {
      playRig(e.rig, e.pose.clip, 0, 0.2);
      e.rig.actions[e.pose.clip].time = e.pose.time;
      e.rig.mixer.update(dt);
      return;
    }
    const S = e.rigSrc.speeds;
    let name = 'idle', k = 1;
    if (e.act === 'aim') { name = 'box'; k = AIM_PUNCH / MINION.archer.aim; }
    else if (e.act === 'rush') { name = 'run'; k = 2.5; }
    else if (e.act === 'daze') k = 0.4;
    else if (e.act === 'tele' || e.mode === 'slide' || e.mode === 'fall') k = 1;
    else if (e.spd > 0.15) {
      // 往后退一律倒着走（倒放跑步像录像倒带）
      const back = dx * e.dir.x + dz * e.dir.z < 0;
      name = e.spd > 1.1 && !back && e.rig.actions.run ? 'run' : 'walk';
      k = THREE.MathUtils.clamp(e.spd / (S[name] * e.vis), 0.4, 2.5) * (back ? -1 : 1);
    }
    playRig(e.rig, name, k);
    e.rig.mixer.update(dt);
  }

  /** 一跳落地：压扁一下，脚边扬一点尘 */
  land(e) {
    e.squash = 1;
    const k = e.scale;
    for (let i = 0; i < 3; i++) {
      this.particles.emit(e.pos.x + rand(-0.25, 0.25) * k, e.pos.y + 0.05, e.pos.z + rand(-0.25, 0.25) * k,
        rand(-0.6, 0.6), rand(0.2, 0.6), rand(-0.6, 0.6), rand(0.4, 0.7), rand(0.12, 0.2) * k,
        [0.85, 0.8, 0.72], [0.6, 0.56, 0.5], { alpha: 0.3, drag: 2 });
    }
  }

  /** 被卷起、冲飞：给一个速度，按滑行处理（脚下没地面就坠入云海）；boss 太重，卷不动 */
  fling(e, vx, vy, vz) {
    if (!this.list.includes(e) || e.mode === 'fall' || e.mode === 'boss') return;
    e.vel.set(vx, vy, vz);
    e.mode = 'slide';
  }

  kill(e, from) {
    this.shatter(e, from);
    this.remove(e, 'kill');
  }

  /** @param {any} e @param {'kill' | 'fall' | 'core' | 'touch'} how */
  remove(e, how) {
    const i = this.list.indexOf(e);
    if (i < 0) return;
    this.list.splice(i, 1);
    this.scene.remove(e.group, e.bar);
    this.release(e);
    this.hooks.onGone(e, how);
  }

  /** 一个敌人用完的显存：自己的材质；有模型的还有骨架（每份一张骨骼贴图） @param {any} e */
  release(e) {
    e.mat.dispose(); e.fillMat.dispose();
    if (e.rig) { e.rig.mixer.stopAllAction(); e.rig.mesh.skeleton.dispose(); }
  }

  /** 碎成同色方块，物理引擎炸开 */
  shatter(e, from) {
    const c = e.chip.clone();
    const away = this._d.copy(e.pos).sub(from).setY(0).normalize();
    for (let i = 0; i < 9; i++) {
      const dm = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
      const m = new THREE.Mesh(this.geo.shard, dm);
      m.scale.setScalar(e.scale * rand(0.7, 1.3));
      m.castShadow = true;
      const s = 0.11 * m.scale.x;
      const body = new CANNON.Body({ mass: 0.3, shape: new CANNON.Box(new CANNON.Vec3(s, s, s)),
        position: new CANNON.Vec3(e.pos.x + rand(-0.3, 0.3), e.pos.y + rand(0.3, 1.4) * e.scale, e.pos.z + rand(-0.3, 0.3)) });
      body.velocity.set(away.x * rand(3, 7) + rand(-2, 2), rand(3, 7), away.z * rand(3, 7) + rand(-2, 2));
      body.angularVelocity.set(rand(-9, 9), rand(-9, 9), rand(-9, 9));
      this.world.addBody(body);
      this.scene.add(m);
      this.debris.push({ mesh: m, mat: dm, body, t: 0 });
    }
  }

  /** @param {number} dt @param {THREE.Camera} camera */
  update(dt, camera) {
    for (const e of [...this.list]) {
      // 状态：冻结、灼烧
      if (e.frozen > 0) e.frozen = Math.max(0, e.frozen - dt);
      if (e.burn > 0) {
        e.burn = Math.max(0, e.burn - dt);
        e.hp -= ELEMENTS.fire.burnDps * dt;
        if (Math.random() < dt * 30) {
          const p = this.aimPoint(e, this._p);
          this.particles.emit(p.x + rand(-0.3, 0.3), p.y + rand(-0.4, 0.4), p.z + rand(-0.3, 0.3), 0, rand(1, 2), 0,
            rand(0.4, 0.7), rand(0.08, 0.14), [2.4, 1.1, 0.3], [0.9, 0.2, 0.05], { drag: 0.6 });
        }
        if (e.hp <= 0) { this.kill(e, e.pos); continue; }
      }
      // 麻痹（雷）：停下不动，身上紫白色一闪一闪
      if (e.stun > 0) {
        e.stun = Math.max(0, e.stun - dt);
        if (Math.random() < dt * 24) {
          const p = this.aimPoint(e, this._p);
          this.particles.emit(p.x + rand(-0.35, 0.35), p.y + rand(-0.5, 0.5), p.z + rand(-0.35, 0.35), rand(-1.5, 1.5), rand(-1, 1.5), rand(-1.5, 1.5),
            rand(0.08, 0.16), rand(0.05, 0.1), [3, 3, 3.2], [1.4, 1.1, 3], { drag: 4 });
        }
      }
      const held = e.frozen > 0 || e.stun > 0;
      const frozenK = e.frozen > 0 ? 1 : 0, burnK = e.burn > 0 ? 0.5 + Math.random() * 0.5 : 0;
      const stunK = e.stun > 0 && !frozenK ? (Math.random() < 0.5 ? 1 : 0.3) : 0;
      e.mat.emissive.setRGB(0.15 * frozenK + 0.9 * burnK + 0.7 * stunK, 0.45 * frozenK + 0.3 * burnK + 0.55 * stunK, 1.0 * frozenK + 0.05 * burnK + 1.0 * stunK);
      e.mat.emissiveIntensity = frozenK ? 0.55 : stunK ? 0.9 : burnK ? 0.6 : 0;
      if (e.emerge < 1) {
        e.emerge = Math.min(1, e.emerge + dt / EMERGE_SEC);
        e.mat.opacity = smoothstep(e.emerge, 0.3, 1);
        e.mat.color.copy(EMERGE_DARK).lerp(e.base, smoothstep(e.emerge, 0.45, 1));
        if (e.emerge === 1) { e.mat.transparent = false; e.mat.needsUpdate = true; }
      }

      if (e.mode === 'walk') {
        if (!held) {
          const ahead = e.s + e.spec.speed * dt;
          pointAt(e.path, ahead + 0.3, this._p, this._d);
          if (!this.blockedAt(this._p.x, this._p.z)) e.s = ahead;
        }
        if (e.s >= e.path.total) { this.hooks.onCoreHit(e.spec.coreDmg); this.remove(e, 'core'); continue; }
        pointAt(e.path, e.s, e.pos, e.dir);
        const side = this._d.set(e.dir.z, 0, -e.dir.x);
        const fadeLat = Math.min(1, (e.path.total - e.s) / 3);         // 快到阵眼时收拢到中线
        e.pos.addScaledVector(side, e.lateral * fadeLat);
        e.pos.y = groundHeightAt(e.pos.x, e.pos.z) ?? e.pos.y;
        if (e.s >= e.path.entry) e.mode = 'field';   // 上了广场：改跟流场走，会绕障碍
      } else if (e.mode === 'field') {
        if (!held) this.steer(e, dt);
        e.pos.y = groundHeightAt(e.pos.x, e.pos.z) ?? 0;
        if (Math.hypot(e.pos.x - CORE_POS.x, e.pos.z - CORE_POS.z) <= CORE_REACH) {
          this.hooks.onCoreHit(e.spec.coreDmg); this.remove(e, 'core'); continue;
        }
      } else if (e.mode === 'slide') {
        e.pos.addScaledVector(e.vel, dt);
        e.vel.x *= Math.exp(-3.2 * dt); e.vel.z *= Math.exp(-3.2 * dt);
        const h = groundHeightAt(e.pos.x, e.pos.z);
        if (h === null) { e.mode = 'fall'; }
        else {
          e.vel.y -= 22 * dt;
          if (e.pos.y <= h) { e.pos.y = h; e.vel.y = 0; }
          if (Math.hypot(e.vel.x, e.vel.z) < 0.4 && e.pos.y <= h + 0.01) {
            // 站稳后接着走：试炼里的小傀儡接着追施法者；在广场上就跟流场；被吹回石阶或索桥上，就沿直线回到广场再说
            if (e.chase) e.mode = 'chase';
            else if (this.field.distAt(e.pos.x, e.pos.z) !== null) e.mode = 'field';
            else { e.path = pathInfo([e.pos.clone(), CORE_FRONT.clone()]); e.s = 0; e.mode = 'walk'; e.lateral = 0; }
          }
        }
      } else if (e.mode === 'boss') {
        e.pos.y = groundHeightAt(e.pos.x, e.pos.z) ?? 0;   // 位置由试炼模式摆
      } else if (e.mode === 'chase') {
        e.moving = false;
        if (!held) {
          const dx = CASTER_POS.x - e.pos.x, dz = CASTER_POS.z - e.pos.z, d = Math.max(Math.hypot(dx, dz), 1e-6);
          if (e.type === 'grunt' && d <= TOUCH_REACH) { this.hooks.touch?.(e); this.remove(e, 'touch'); continue; }
          // 出招时（e.act）位置由试炼模式摆；符箓傀儡蓄力时还要一直转着对准人
          if (!e.act) this.chaseStep(e, dx, dz, d, dt);
          else if (e.act === 'aim') e.dir.lerp(this._p.set(dx / d, 0, dz / d), 1 - Math.exp(-8 * dt)).setY(0).normalize();
        }
        e.pos.y = groundHeightAt(e.pos.x, e.pos.z) ?? 0;
      } else if (e.mode === 'fall') {
        e.vel.y -= 22 * dt;
        e.pos.addScaledVector(e.vel, dt);
        e.group.rotation.x += dt * 4; e.group.rotation.z += dt * 3;
        if (e.pos.y < -9) {
          for (let i = 0; i < 40; i++) {
            this.particles.emit(e.pos.x, -8.8, e.pos.z, rand(-2, 2), rand(1, 4), rand(-2, 2), rand(0.6, 1.2), rand(0.3, 0.6),
              [1.2, 1.2, 1.3], [0.6, 0.65, 0.75], { alpha: 0.35, drag: 1.5 });
          }
          this.hooks.floatText(e.pos.clone().setY(-6), '坠入云海', '#cfe8ff');
          this.remove(e, 'fall');
          continue;
        }
      }
      const upright = e.mode === 'walk' || e.mode === 'field' || e.mode === 'chase' || e.mode === 'boss';
      let hopY = 0;
      if (e.rig) {
        // 模型：骨骼动作（animate）；lean 打折（leanK），跑的动作本身已经前倾、boss 出招的动作自己会俯仰
        this.animate(e, dt, held);
        e.group.position.copy(e.pos);
        if (upright) e.group.rotation.set(e.lean * e.leanK, Math.atan2(e.dir.x, e.dir.z), 0);
      } else {
        // 方块：程序动画（傀儡本来就僵）：一跳一跳，空中拉长、落地压扁，前倾，每步左右晃
        const rush = e.act === 'rush';
        const walking = upright && !held && (e.mode === 'boss' || e.mode === 'chase' ? e.moving || rush : true);
        if (walking) {
          const before = Math.floor(e.hop / Math.PI);
          e.hop += dt * (rush ? MINION.charger.speed * 0.5 : e.spec.speed) * 4.2;
          if (Math.floor(e.hop / Math.PI) !== before) this.land(e);   // 正弦过零 = 一跳落地
        }
        const air = walking ? Math.abs(Math.sin(e.hop)) : 0;
        hopY = air * 0.22;
        e.squash = Math.max(0, e.squash - dt / 0.14);
        const sq = e.squash * e.squash;
        const sy = 1 + 0.07 * air - 0.2 * sq, sxz = 1 + 0.12 * sq - 0.03 * air;
        e.group.scale.set(e.scale * sxz, e.scale * sy, e.scale * sxz);
        e.group.position.set(e.pos.x, e.pos.y + hopY, e.pos.z);
        if (upright) {
          const sway = walking ? Math.sin(e.hop * 0.5) * 0.09 : 0;          // 左一步右一步
          // lean：试炼模式的 boss 出招时后仰蓄力、砸下去前扑
          e.group.rotation.set((walking ? 0.1 + 0.06 * air : 0) + e.lean, Math.atan2(e.dir.x, e.dir.z), sway);
        }
      }
      // 血条：受过伤才显示，始终朝向镜头（boss 的血条在界面顶上）
      e.bar.visible = e.hp < e.maxHp && e.mode !== 'boss';
      if (e.bar.visible) {
        e.bar.position.set(e.pos.x, e.pos.y + e.top + hopY, e.pos.z);
        e.bar.quaternion.copy(camera.quaternion);
        const k = Math.max(0, e.hp / e.maxHp);
        e.fill.scale.x = Math.max(k, 0.001);
        e.fill.position.x = -0.4 * (1 - k);
      }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.t += dt;
      d.mesh.position.copy(d.body.position);
      d.mesh.quaternion.copy(d.body.quaternion);
      if (d.t > 2.6 || d.body.position.y < -12) {
        this.world.removeBody(d.body);
        this.scene.remove(d.mesh);
        d.mat.dispose();
        this.debris.splice(i, 1);
      }
    }
  }

  clear() {
    for (const e of [...this.list]) { this.scene.remove(e.group, e.bar); this.release(e); }
    this.list.length = 0;
    for (const d of this.debris) { this.world.removeBody(d.body); this.scene.remove(d.mesh); d.mat.dispose(); }
    this.debris.length = 0;
  }
}
