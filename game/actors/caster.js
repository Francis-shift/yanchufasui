// @ts-check
/**
 * 施法者的骨骼模型（10-28 换掉胶囊占位；模型与动作见 tools/pack_rig.py 的打包记录）。
 * 两层动作叠着放：
 *   底层按实际移动速度在待机、走、跑之间切（播放快慢 = 实际速度 ÷ 动作原本的速度，脚不打滑）；
 *   上层是蓄力、出掌、闪避。站着时整个人做；边走边放时只换上半身（腿照样跑），闪避一律整个人做。
 * 位置、显隐、朝向都在 layout 的施法者组上（试炼挪它、挨打时让它一闪一闪）；这里只转朝向、摆姿势。
 * 时间用施法者自己的钟（main.js 传进来）：开口慢放时世界慢下来，人照常抬手。
 */
import * as THREE from 'three';
import { makeRig, playRig } from './rig.js';

const HEIGHT = 1.75;
/** 上半身的骨：边走边放时只有这几根跟动作层走 */
const UPPER = /^(Spine|Spine1|Spine2|Neck|Head|(Left|Right)(Shoulder|Arm|ForeArm|Hand))$/;
/**
 * 动作层每段怎么放：从第几秒起、放多快、放完后再保持几秒才松手（蓄力本该等到出掌或收手，hold 只是防卡住：咏唱最长 4.5 秒）；
 * upper：能只换上半身。量过的时间点：蓄力 0.5 秒双手合拢，出掌约 0.35 秒推到底，闪避 0.5 秒侧身最深
 */
const ACTS = {
  charge: { at: 0, rate: 1, hold: 4, upper: true },
  cast: { at: 0.1, rate: 1.25, hold: 0.75, upper: true },
  dodge: { at: 0, rate: 1.6, hold: 0.5, upper: false },
};
/** 走、跑之间按速度切（米 / 秒）；进跑和出跑错开一点，免得在临界速度上来回抖 */
const WALK_FROM = 0.25, RUN_FROM = 2.6, RUN_UNTIL = 2.2;
const TURN = 10;      // 每秒最多转几弧度
const FACE_HOME = Math.PI;   // 守关站桩：面朝山门外（−z），妖物从那边来

/** @param {number} a @param {number} b 从 a 转到 b 最近的那条路（弧度） */
const angleTo = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/**
 * 只动上半身的那份动作。髋骨跟着底层走跑，动作里髋骨自己的转动（相对静止姿势）要挪到 Spine 上，胸口才和整个人做时朝向一致：
 * 出掌是侧身马步，髋骨转了约 87°、脊柱再扭回来让掌朝前；只取上半身就只剩"扭回来"那一半，掌伸到身侧去了（10-28 量过：偏 91°，挪过来后与站着出掌一致）
 * @param {string} name @param {THREE.AnimationClip} clip @param {import('./rig.js').Rig} rig
 */
function upperClip(name, clip, rig) {
  const tracks = clip.tracks.filter((k) => UPPER.test(k.name.split('.')[0]));
  const hips = clip.tracks.find((k) => k.name === 'Hips.quaternion');
  const hipsRest = rig.bones.find((b) => b.name === 'Hips'), spineRest = rig.bones.find((b) => b.name === 'Spine');
  if (!hips || !hipsRest || !spineRest) return new THREE.AnimationClip(`${name}·上身`, clip.duration, tracks);
  const i0 = tracks.findIndex((k) => k.name === 'Spine.quaternion'), spine = i0 >= 0 ? tracks[i0] : null;
  const src = spine && spine.times.length > hips.times.length ? spine : hips, n = src.times.length;
  const inv = new THREE.Quaternion(...hipsRest.q).invert(), h = new THREE.Quaternion(), s = new THREE.Quaternion(), out = new THREE.Quaternion();
  const v = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    h.fromArray(hips.values, Math.min(i, hips.times.length - 1) * 4);
    if (spine) s.fromArray(spine.values, Math.min(i, spine.times.length - 1) * 4); else s.fromArray(spineRest.q);
    out.copy(inv).multiply(h).multiply(s).toArray(v, i * 4);
  }
  const moved = new THREE.QuaternionKeyframeTrack('Spine.quaternion', src.times, v);
  if (spine) tracks[i0] = moved; else tracks.push(moved);
  return new THREE.AnimationClip(`${name}·上身`, clip.duration, tracks);
}

export class Caster {
  /** @param {THREE.Group} group layout 里的施法者组：模型到了挂进去，占位的胶囊和头藏起来 */
  constructor(group) {
    this.group = group;
    /** @type {ReturnType<typeof makeRig> | null} */
    this.r = null;
    /** @type {import('./rig.js').Rig | null} */
    this.rig = null;
    this.last = group.position.clone();
    this.speed = 0;            // 平滑过的水平速度（米 / 秒）
    this.yaw = FACE_HOME;
    this.aimYaw = 0; this.aimT = 0;   // 刚放完招：站着时朝打的方向转过去，aimT 秒后松开
    /** 动作层：w 是现在占多少，to 是往多少走，t 是还要保持几秒，on 是还在放（淡完了停掉） @type {Record<string, { full: THREE.AnimationAction, upper: THREE.AnimationAction | null, w: number, to: number, t: number, on: boolean }>} */
    this.acts = {};
    this.cur = '';
    /** 残影用的另一份模型（第一次闪避时才做） @type {{ group: THREE.Group, bones: Record<string, THREE.Bone> } | null} */
    this.g = null;
  }

  /** 模型下载好了：套上贴图、挂进施法者组。袍子沿用占位胶囊的材质（试炼挨打泛红、完美闪避泛白改的就是它） @param {import('./rig.js').Rig} rig */
  use(rig) {
    if (this.r) return;
    const robe = /** @type {THREE.MeshStandardMaterial} */ (/** @type {THREE.Mesh} */ (this.group.children[0]).material);
    if (rig.tex) { robe.map = rig.tex; robe.color.set(0xffffff); robe.needsUpdate = true; }
    const r = makeRig(rig, robe);
    r.mesh.scale.setScalar(HEIGHT);
    for (const c of this.group.children) c.visible = false;
    this.group.add(r.mesh);
    for (const [name, cfg] of Object.entries(ACTS)) {
      const clip = rig.clips[name];
      if (!clip) continue;
      const top = cfg.upper ? upperClip(name, clip, rig) : null;
      const full = r.mixer.clipAction(clip), upper = top ? r.mixer.clipAction(top) : null;
      for (const a of [full, upper]) if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.acts[name] = { full, upper, w: 0, to: 0, t: 0, on: false };
    }
    this.r = r; this.rig = rig;
    this.last.copy(this.group.position);
    this.group.rotation.y = this.yaw;
  }

  /** 动作层换到这段（别的几段淡出） @param {keyof typeof ACTS} name */
  act(name) {
    const o = this.acts[name], cfg = ACTS[name];
    if (!o) return;
    for (const [k, x] of Object.entries(this.acts)) x.to = k === name ? 1 : 0;
    for (const a of [o.full, o.upper]) if (a) { a.reset(); a.time = cfg.at; a.timeScale = cfg.rate; a.weight = 0; a.play(); }
    o.t = (o.full.getClip().duration - cfg.at) / cfg.rate + cfg.hold;
    o.on = true;
    this.cur = name;
  }

  /** 咏唱开始：蓄力，双手合拢后一直保持到出掌 */
  charge() { this.act('charge'); }

  /** 咏唱没成（法力不足、未能成咒、局已结束）：收手 */
  endCharge() { if (this.cur === 'charge') this.acts.charge.to = 0; }

  /** 放出：出掌；aim 是打的方向（站着时转过去），召龙一类没有方向的给 null @param {{ x: number, z: number } | null} [aim] */
  cast(aim) {
    const p = this.group.position;
    if (aim && Math.hypot(aim.x - p.x, aim.z - p.z) > 0.5) { this.aimYaw = Math.atan2(aim.x - p.x, aim.z - p.z); this.aimT = 1.2; }
    this.act('cast');
  }

  /** 试炼闪避：侧身一闪 */
  dodge() { this.act('dodge'); }

  /**
   * 残影：另一份同样的模型，摆成此刻的姿势（之后不再动）；模型还没到就给 null（试炼照旧用胶囊的残影）
   * @param {THREE.Material} mat @returns {THREE.Object3D | null}
   */
  ghost(mat) {
    if (!this.r || !this.rig) return null;
    if (!this.g) {
      const g = makeRig(this.rig, mat);
      g.mesh.castShadow = false;
      g.mesh.scale.setScalar(HEIGHT);
      this.g = { group: new THREE.Group().add(g.mesh), bones: g.bones };
    }
    for (const [n, b] of Object.entries(this.r.bones)) {
      const o = this.g.bones[n];
      o.position.copy(b.position); o.quaternion.copy(b.quaternion);
    }
    return this.g.group;
  }

  /**
   * @param {number} dt 施法者的钟（秒）
   * @param {boolean} roam 试炼里自己走位：朝走的方向；否则（守关）站桩，放完招转回去面朝山门
   */
  update(dt, roam) {
    const r = this.r;
    if (!r || dt <= 0) return;
    const p = this.group.position, dx = p.x - this.last.x, dz = p.z - this.last.z, d = Math.hypot(dx, dz);
    this.last.copy(p);
    // 一帧挪了 2 米以上是瞬移（试炼开局、收场放回原处），不算速度
    const v = d > 2 ? 0 : d / dt;
    this.speed += (v - this.speed) * Math.min(1, dt * 12);
    const sp = this.speed, H = HEIGHT, speeds = this.rig?.speeds ?? {};

    // 底层：待机、走、跑
    let base = 'idle', rate = 1;
    if (sp > WALK_FROM) {
      base = sp > RUN_FROM || (r.cur === 'run' && sp > RUN_UNTIL) ? 'run' : 'walk';
      rate = THREE.MathUtils.clamp(sp / ((speeds[base] || 1) * H), 0.5, 1.6);
    }
    playRig(r, base, rate, 0.2);

    // 动作层：边走边放只换上半身（权重压过底层），站着整个人做；底层让出整个人做的那部分
    const m = THREE.MathUtils.clamp((sp - 0.3) / 0.8, 0, 1);
    let whole = 0;
    for (const o of Object.values(this.acts)) {
      if (o.to > 0 && (o.t -= dt) <= 0) o.to = 0;
      o.w += Math.sign(o.to - o.w) * Math.min(Math.abs(o.to - o.w), dt * (o.to > o.w ? 10 : 4));
      const mm = o.upper ? m : 0;
      // 直接改 weight（不用 setEffectiveWeight）：三维库把它乘在淡入淡出上，不打断底层正在做的交叉淡化
      o.full.weight = o.w * (1 - mm);
      if (o.upper) o.upper.weight = 12 * o.w * mm;
      whole += o.w * (1 - mm);
      if (o.on && o.w <= 0 && o.to <= 0) { o.full.stop(); o.upper?.stop(); o.on = false; }
    }
    const k = Math.max(0, 1 - whole);
    for (const n of ['idle', 'walk', 'run']) if (r.actions[n]) r.actions[n].weight = k;
    r.mixer.update(dt);

    // 朝向：走着朝走的方向；站着时刚放完招朝打的方向，守关过后转回山门；闪避时不转（侧身滑出去）
    this.aimT = Math.max(0, this.aimT - dt);
    let want = this.yaw;
    if (this.cur === 'dodge' && this.acts.dodge.to > 0) want = this.yaw;
    else if (sp > 0.6 && d > 1e-4 && d <= 2) want = Math.atan2(dx, dz);
    else if (this.aimT > 0) want = this.aimYaw;
    else if (!roam) want = FACE_HOME;
    const turn = angleTo(this.yaw, want);
    this.yaw = angleTo(0, this.yaw + Math.sign(turn) * Math.min(Math.abs(turn), TURN * dt));   // 收在 ±π 里，绕圈走不会越转越大
    this.group.rotation.y = this.yaw;
  }
}
