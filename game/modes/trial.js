// @ts-check
/**
 * 试炼模式（灰盒，设计文档第 2 节"试炼模式"）：在山门广场上走位躲 boss 的招。
 * 战中不打字：WASD / 方向键走位、空格闪避、1～3 放天赋、4 召唤（手机横过来玩：左手摇杆走位，右手点"闪"和天赋）；战前可以给按钮写咒。
 * 规则（冰甲、换阶段、挑招、判定、走位边界）在 rules/trial.js；这里管玩家走位与受伤、boss 的动作、地上的预警。
 * 一局（rules/run.js RUN_STAGES）：小怪潮 → 三选一 → boss → 三选一 → …… → 第三个 boss；这里按顺序推进，选卡交给 main.js（d.pick）。
 * 第一个 boss 寒甲傀儡王（冰甲只怕火）；第二个石甲巨像（石甲只怕雷：重踏、落石雨、蓄力冲撞——蓄力时打够伤害就打断、硬直，一线地刺）；
 * 第三个火灵还没做，先用寒甲傀儡王顶上。招式表在 numbers.js 的 BOSS、STONE（this.cfg 指向当前这个 boss 的）。
 * 施法者的位置就是 CASTER_POS：玩家走到哪，法术就从哪放出（同步脚下法阵和特效起点）；回到守关时放回原处。
 */
import * as THREE from 'three';
import { BOSS, ENEMIES, MINION, RUN, STONE, TRIAL } from '../rules/numbers.js';
import { BOSS_COUNT, RUN_STAGES, newRun, runMods } from '../rules/run.js';
import {
  bossHit, bossPhase, canDash, chargeLen, homingTurn, inCircle, inSector, inStrip, isPerfect, keepInArena, nextBatch, pickMinion, pickMove,
  recoverSec, regenStamina, rockSpots, slamCount, spawnSpot, spikeDirs, spikeReach, spiralAngles, teleSec,
} from '../rules/trial.js';
import { CASTER_POS, CORE_POS, OBSTACLES, PLAZA_R } from '../world/layout.js';
import { rand } from '../fx/common.js';
import { distToSegment } from '../fx/walls.js';

/** 守关时施法者站的地方（开局就记下，试炼结束放回这里） */
const HOME = CASTER_POS.clone();
const ARENA_R = PLAZA_R - 0.9;
const BODY = 0.35;
/** 玩家走不进去的：场景障碍加阵眼那一圈石桩 */
const BLOCK = [...OBSTACLES, { x: CORE_POS.x, z: CORE_POS.z, r: 2.9 }];
const BOSS_AT = { x: 0, z: -3.5 };
const BOSS_BODY = 1.0;
const RED = 0xff3b2f;
const PHASE_NAME = ['', '第一阶段', '第二阶段', '第三阶段 · 狂暴'];
const SWEEP_HALF = (BOSS.sweep.halfDeg * Math.PI) / 180;
/** 同时在飞的冰锥最多这么多（旋转弹幕狂暴时一轮约 70 颗） */
const MAX_BULLETS = 200;
/** 第几个 boss 用哪张招式表（第三个火灵还没做，先用寒甲傀儡王顶上） */
const BOSS_CFG = [BOSS, STONE, BOSS];
/** 每个 boss 现身时的提示：手机版、电脑版 @type {Record<string, [string, string]>} */
const BOSS_HINT = {
  boss: ['躲开地上的红圈和红扇；冰甲只怕火，先用火打碎它', '躲开地上的红圈和红扇；冰甲只怕火，先用火打碎它。1、2、3 放天赋，4 召唤，空格闪避'],
  stone: ['石甲只怕雷；它蹲下蓄力时猛打能打断冲撞，打断了趁它硬直多打几下；落石看红圈，地刺横着躲',
    '石甲只怕雷；它蹲下蓄力时猛打能打断冲撞，打断了趁它硬直多打几下；落石看红圈，地刺横着躲。1、2、3 放天赋，4 召唤，空格闪避'],
};
/** 每个 boss 的大字颜色：现身时的名字、甲碎了与重凝 @type {Record<string, [string, string]>} */
const BOSS_INK = { boss: ['#1f4f7a', '#2f6fae'], stone: ['#4a3a28', '#6b5236'] };
/** 落石最后这几秒从天上砸下来（之前只有地上的红圈）；从多高落 */
const ROCK_FALL = 0.45, ROCK_FROM = 10;
/** 地刺：每隔多远冒一根；一根冒出来、停住、缩回去各要几秒（之后消失）；同时最多多少根 */
const SPIKE_GAP = 0.55, SPIKE_UP = 0.08, SPIKE_HOLD = 0.5, SPIKE_DOWN = 0.35, MAX_SPIKES = 160;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const ROCK_AXIS = new THREE.Vector3(0.4, 1, 0.3).normalize();
const NO_SIZE = new THREE.Vector3(0, 0, 0);
/** 小怪追人时被拦在这个半径里（enemies.js chaseStep）；铁头傀儡冲锋也冲不出去 */
const CHASE_R = PLAZA_R - 0.6;
/** 铁头傀儡的身体半径（冲锋撞障碍、撞人用） */
const CHARGER_BODY = 0.4;
/** 每段小怪潮开头的提示：这一段新来了什么、怎么对付 @type {[string, string][]} 手机版、电脑版 */
const WAVE_HINT = [
  ['小傀儡追着人自爆：边走边打，别让它们贴身', '小傀儡追着人自爆：边走边打，别让它们贴身。1、2、3 放天赋，4 召唤，空格闪避'],
  ['新来的符箓傀儡站在远处射紫火球：看地上的红点，走开或者闪避；火球也能完美闪避', '新来的符箓傀儡站在远处射紫火球：看地上的红点，走开或者按空格闪避；火球也能完美闪避'],
  ['铁头傀儡地上亮起红条就要冲过来：横着躲开，它冲完会晕一会儿，趁机打', '铁头傀儡地上亮起红条就要冲过来：横着躲开，它冲完会晕一会儿，趁机打'],
];
/** @type {Record<string, [number, number]>} 键 → 屏幕上的方向（右、上） */
const MOVE_KEYS = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };

export class Trial {
  /**
   * @param {THREE.Scene} scene
   * @param {{ enemies: import('../actors/enemies.js').Enemies, fx: import('../fx/spells.js').SpellFx,
   *           particles: import('../fx/particles.js').Particles, hud: import('../ui/hud.js').Hud,
   *           caster: THREE.Object3D, origins: THREE.Vector3[], canvas: HTMLElement, mobile: boolean,
   *           floatText: (p: THREE.Vector3, text: string, color: string) => void, win: () => void, lose: () => void,
   *           blockers: () => { x: number, z: number, r: number, bounce?: boolean }[], reward: (mana: number, gauge: number) => void,
   *           local: (x: number, y: number) => { x: number, y: number }, pick: (insight: boolean, done: () => void) => void,
   *           strike: (e: any, dmg: number, at: { x: number, z: number }) => void }} d
   *   origins：法术起点（施法者胸口高度），跟着玩家走；blockers：此刻的土墙（挡冰锥；bounce 的写了字诀「返」，把冰锥弹回去）；
   *   reward：完美闪避回法力、加气势；local：屏幕坐标换成界面坐标（画面转了 90° 时要转回来）；
   *   pick：出三选一（insight：打完 boss 那次），选完调 done 接着打；strike：弹回去的冰锥撞上敌人，打它一下（main.js 结算）
   */
  constructor(scene, d) {
    this.scene = scene; this.d = d;
    this.on = false;          // 在试炼模式里（含战前准备）
    this.fighting = false;    // 已开战
    this.hp = TRIAL.hp;
    /** 这一局拿过的心法合成的加成（main.js 选完卡写进来） */
    this.mods = runMods(newRun());
    // 一局走到第几段（RUN_STAGES 的下标）、第几段小怪潮 / 第几个 boss、这段小怪还要冒几只、多久冒下一只；用时、完美闪避几次（结算用）
    this.stage = -1; this.round = 0; this.waveLeft = 0; this.waveN = 1; this.spawnT = 0; this.runT = 0; this.perfects = 0;
    this.p = HOME.clone();
    this.face = new THREE.Vector3(0, 0, -1);   // 最近一次走的方向：原地闪避朝这边
    /** @type {Set<string>} */
    this.keys = new Set();
    this.stick = { x: 0, y: 0 };
    /** @type {{ id: number, x: number, y: number, t: number, moved: boolean } | null} */
    this.ptr = null;
    this.dashT = 0; this.dashDir = new THREE.Vector3(); this.hurtT = 0; this.flash = 0;
    // 精力：还剩几格（攒到一半也算数）、离上次按闪避过了几秒；shownSta 是闪避按钮上画成什么样（变了才重画）
    // dashLock：字诀「重」放完这几秒不能闪避；slowTele：字诀「凝」冻住了 boss，下一招预警变慢
    this.stamina = TRIAL.stamina.max; this.sinceDash = Infinity; this.shownSta = ''; this.dashLock = 0; this.slowTele = false;
    /** 小怪潮里冒着紫烟、还没出来的小怪：落点、还要几秒、是哪种 @type {{ x: number, z: number, t: number, kind: string }[]} */
    this.pending = [];
    /** 铁头傀儡正亮着的红条（收场时一起收） @type {Set<{ g: THREE.Group, fill: THREE.Mesh }>} */
    this.strips = new Set();
    /** @type {any} */
    this.boss = null;
    /** 当前这个 boss 的招式表（BOSS 寒甲傀儡王、STONE 石甲巨像） @type {typeof BOSS | typeof STONE} */
    this.cfg = BOSS;
    this.armor = 0; this.phase = 1; this.freezeCd = 0;
    this.state = 'idle'; this.t = 0; this.teleLen = 1; this.move = /** @type {import('../rules/trial.js').Move} */ ('slam');
    this.left = 0; this.sinceSummon = 0; this.spinFrom = 0;
    this.target = new THREE.Vector3(); this.sweepDir = new THREE.Vector3();
    /** @type {{ x: number, z: number }[]} */
    this.spots = [];
    this.leanTo = 0; this.kick = 0; this.shown = ''; this.lastMove = '';
    this.robe = /** @type {THREE.MeshStandardMaterial} */ (/** @type {THREE.Mesh} */ (d.caster.children[0]).material);
    this._f = new THREE.Vector3(); this._r = new THREE.Vector3(); this._m = new THREE.Vector3();
    // 完美闪避：按闪避的时刻与位置（招落下时回头核对）；一次闪避只算一次
    this.clock = 0; this.dashAt = -Infinity; this.dashFrom = new THREE.Vector3(); this.perfectUsed = true; this.glow = 0;
    // 冰锥：位置、速度、飞了多久；homing 的会追人；friendly：被写了字诀「返」的土墙弹回去的，不伤人、打敌人
    // orb：符箓傀儡射的紫火球，和冰锥一样飞、一样躲、一样能被「引」劈碎和「返」弹回，只是画成一颗球
    /** @type {{ x: number, y: number, z: number, vx: number, vz: number, t: number, life: number, homing: boolean, dmg: number, r: number,
     *           fooled?: boolean, friendly?: boolean, orb?: boolean }[]} */
    this.bullets = [];
    this.emitT = 0; this.a0 = 0; this.chT = 0;   // 旋转弹幕：下一轮还有多久、起始角、已经转了几秒
    // 冰锥要在十几米外的镜头里一眼看见：0.2 米那版在截图里只剩一个白点（10-27），放大、自发光压过泛光阈值
    const shard = new THREE.OctahedronGeometry(0.3, 0);
    shard.scale(1, 1, 2.4);   // 顺着飞的方向拉长
    this.shards = new THREE.InstancedMesh(shard, new THREE.MeshStandardMaterial({ color: 0xe4f6ff, emissive: 0x6cc4ff, emissiveIntensity: 1.8,
      roughness: 0.15 }), MAX_BULLETS);
    // 冰锥底下的红点：飞在齐腰高，看地上的点才知道会不会撞上
    this.dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.34, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: RED,
      transparent: true, opacity: 0.6, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), MAX_BULLETS);
    this.orbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 14, 10), new THREE.MeshStandardMaterial({ color: 0xc89cff, emissive: 0x8a3cff,
      emissiveIntensity: 2.2, roughness: 0.3 }), MAX_BULLETS);
    for (const m of [this.shards, this.orbs, this.dots]) { m.count = 0; m.frustumCulled = false; scene.add(m); }
    this.shards.castShadow = true;
    this.dots.renderOrder = 2;
    // 心法残影：闪避处留下一个半透明的人影，追踪冰锥改追它、撞上就碎；ghostT 是它还剩几秒
    // 淡蓝 0xbfe2ff 在白石地上和白袍分不开（10-27 截图），压成冷蓝
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x5aa8ff, transparent: true, opacity: 0.55, depthWrite: false });
    this.ghost = d.caster.clone();
    this.ghost.traverse((o) => { if (o instanceof THREE.Mesh) { o.material = this.ghostMat; o.castShadow = false; } });
    this.ghost.visible = false;
    scene.add(this.ghost);
    this.ghostT = 0;
    this._q = new THREE.Quaternion(); this._m4 = new THREE.Matrix4(); this._s = new THREE.Vector3(1, 1, 1);
    this._bp = new THREE.Vector3(); this._bd = new THREE.Vector3(); this._hv = { x: 0, z: 0 };   // _r 是镜头右方，闪避随时要用，冰锥另用一组

    // 地上的预警：底（淡）、由内向外长满的填充、外边一圈
    this.circle = this.decal(new THREE.CircleGeometry(1, 48), new THREE.RingGeometry(0.95, 1, 48));
    this.sector = this.decal(new THREE.CircleGeometry(1, 32, -SWEEP_HALF, SWEEP_HALF * 2), new THREE.RingGeometry(0.97, 1, 32, 1, -SWEEP_HALF, SWEEP_HALF * 2));
    // 石甲巨像：落石的红圈（一块一个）、最后一下从天上砸下来的石头、地刺；冲撞和地刺地上的红条在 lanes
    this.rockMarks = Array.from({ length: Math.max(...STONE.rocks.n) }, () => this.decal(new THREE.CircleGeometry(1, 40), new THREE.RingGeometry(0.94, 1, 40)));
    /** 这一轮落石：落点、还有几秒落地、预警一共几秒、落了没有、石头多大、转角 @type {{ x: number, z: number, t: number, len: number, landed: boolean, s: number, a: number }[]} */
    this.rocks = [];
    this.rockFx = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.62, 0),
      new THREE.MeshStandardMaterial({ color: 0x6a6052, roughness: 0.95, flatShading: true }), this.rockMarks.length);
    this.spikeFx = new THREE.InstancedMesh(new THREE.ConeGeometry(0.26, 1.4, 5).translate(0, 0.7, 0),
      new THREE.MeshStandardMaterial({ color: 0x7a6e5e, roughness: 0.9, flatShading: true }), MAX_SPIKES);
    for (const m of [this.rockFx, this.spikeFx]) { m.count = 0; m.frustumCulled = false; m.castShadow = true; scene.add(m); }
    /** 冒出来的地刺：位置、冒了几秒、粗细、朝哪歪 @type {{ x: number, z: number, t: number, s: number, a: number, tx: number, tz: number }[]} */
    this.spikes = [];
    /** 冲撞、地刺在地上的红条，各自的起点、方向、长；next：地刺下一根冒在多远 @type {{ s: { g: THREE.Group, fill: THREE.Mesh }, from: { x: number, z: number }, dir: { x: number, z: number }, len: number, next: number }[]} */
    this.lanes = [];
    this._rq = new THREE.Quaternion(); this._rs = new THREE.Vector3(); this._re = new THREE.Euler();
    // 地刺冒到多远了；蓄力冲撞时挨了多少伤害（够了就打断）、冲出去多远、撞到人没有（一次只撞一下）
    this.front = 0; this.chargeDmg = 0; this.ran = 0; this.struck = false;
    this.unbind = this.attach(d.canvas);
  }

  /** @param {THREE.BufferGeometry} area @param {THREE.BufferGeometry} edge */
  decal(area, edge) {
    const mat = (/** @type {number} */ op) => new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: op, depthWrite: false, fog: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const g = new THREE.Group();
    // 底 0.14、填充 0.3 在白石地上偏淡（10-25 截图），往上提
    const parts = [new THREE.Mesh(area, mat(0.2)), new THREE.Mesh(area, mat(0.38)), new THREE.Mesh(edge, mat(0.95))];
    for (const m of parts) { m.rotation.x = -Math.PI / 2; m.renderOrder = 2; g.add(m); }
    g.position.y = 0.03;
    g.visible = false;
    this.scene.add(g);
    return { g, fill: parts[1] };
  }

  /**
   * 触屏走位。手机（mobile）：左半边是浮动摇杆——按在哪儿底座就在哪儿，拖出底座半径时底座跟着手指走；右半边留给按钮，点空处不算。
   * 电脑上用鼠标：在画面上拖动走位、轻点闪避。
   * 坐标一律先换成界面坐标（d.local）：手机竖着拿时整个画面转了 90°，屏幕上的"往上拖"在画面里是"往右"。
   * @param {HTMLElement} canvas
   */
  attach(canvas) {
    const R = 50;   // 摇杆半径（像素）：拖满就是全速
    const down = (/** @type {PointerEvent} */ e) => {
      if (!this.on || this.ptr) return;
      const q = this.d.local(e.clientX, e.clientY);
      if (this.d.mobile && q.x > canvas.clientWidth * 0.55) return;
      this.ptr = { id: e.pointerId, x: q.x, y: q.y, t: performance.now(), moved: false };
      canvas.setPointerCapture?.(e.pointerId);
      if (this.d.mobile) this.d.hud.showStick(q);
    };
    const move = (/** @type {PointerEvent} */ e) => {
      const p = this.ptr;
      if (!p || e.pointerId !== p.id) return;
      const q = this.d.local(e.clientX, e.clientY);
      let dx = q.x - p.x, dy = q.y - p.y;
      const l = Math.hypot(dx, dy);
      if (l > 10) p.moved = true;
      if (this.d.mobile) {
        if (l > R) { p.x += (dx / l) * (l - R); p.y += (dy / l) * (l - R); dx = (dx / l) * R; dy = (dy / l) * R; }
        this.d.hud.showStick(p, dx, dy);
        const k = l < 6 ? 0 : 1 / R;
        this.stick.x = dx * k; this.stick.y = -dy * k;
        return;
      }
      const k = l < 10 ? 0 : Math.min(1, l / 60) / l;   // 拖 60 像素就是全速
      this.stick.x = dx * k; this.stick.y = -dy * k;
    };
    const up = (/** @type {PointerEvent} */ e) => {
      const p = this.ptr;
      if (!p || e.pointerId !== p.id) return;
      if (!this.d.mobile && !p.moved && performance.now() - p.t < 250) this.dash();
      this.ptr = null; this.stick.x = this.stick.y = 0;
      if (this.d.mobile) this.d.hud.showStick(null);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    return () => {
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up);
    };
  }

  /** 键盘：走位键按下 / 松开，空格闪避。处理了就返回 true（调用方据此 preventDefault） @param {string} code @param {boolean} down */
  key(code, down) {
    if (!this.on) return false;
    if (code === 'Space') { if (down) this.dash(); return true; }
    if (!(code in MOVE_KEYS)) return false;
    if (down) this.keys.add(code); else this.keys.delete(code);
    return true;
  }

  // ---------------------------------------------------------------- 开局、开战、收场
  /** 进试炼：玩家回到原处、满血，boss 还没出来（战前可以写咒、试招） */
  prepare() {
    this.stop();
    this.on = true;
    this.hp = TRIAL.hp; this.phase = 1; this.armor = 0; this.state = 'idle';
    this.stage = -1; this.round = 0; this.waveLeft = 0; this.runT = 0; this.perfects = 0;
    this.d.canvas.style.touchAction = 'none';
    const { hud } = this.d;
    hud.setTrial(true, false);
    hud.setPad(this.d.mobile);
    hud.setCoreName('气血');
    hud.setCore(this.hp, TRIAL.hp);
    hud.setWave('试炼', '战前准备');
    hud.setHint(this.d.mobile
      ? `一局：小怪潮与 ${BOSS_COUNT} 个 boss 交替；开局只会本命招，每打完一段三选一学字。战前点按钮右上角的笔写一句咒（开战后不能写）；左手拖动走位，右手点「闪」闪避；准备好了点「开战」`
      : `一局：小怪潮与 ${BOSS_COUNT} 个 boss 交替；开局只会本命招，每打完一段三选一学字。战前点按钮右上角的笔写一句咒（开战后不能写）；WASD / 方向键走位，空格闪避；准备好了点「开战」或按回车`);
    this.showStamina();
  }

  /** 开战：从第一段小怪潮打起 */
  engage() {
    if (!this.on || this.fighting) return;
    this.fighting = true;
    this.d.hud.setTrial(true, true);
    this.next();
  }

  /** 进下一段（RUN_STAGES）：小怪潮、三选一、boss；排完了就是打通了 */
  next() {
    if (!this.fighting) return;
    const st = RUN_STAGES[++this.stage];
    if (!st) { this.end(true); return; }
    if (st.kind === 'wave') this.startWave();
    else if (st.kind === 'boss') this.spawnBoss(st.n ?? 1);
    else { this.state = 'pick'; this.d.pick(!!st.insight, () => this.next()); }
  }

  /**
   * 一段小怪潮：小怪隔一会儿成批冒出来（落点随机、先冒紫烟）；冒完、清空了这一段就过了。
   * 第 1 段只有追人自爆的小傀儡；第 2 段混进远处射火球的符箓傀儡，第 3 段再混进冲锋的铁头傀儡（比例、同时上限见 RUN.wave.mix / cap）
   */
  startWave() {
    const W = RUN.wave;
    this.round++;
    this.waveLeft = this.waveN = W.n[Math.min(this.round, W.n.length) - 1];
    this.spawnT = W.first; this.state = 'wave'; this.pending.length = 0;
    const { hud } = this.d;
    hud.bigText(`第 ${this.round} 波`, '#16202b', 1400);
    hud.setHint(WAVE_HINT[Math.min(this.round, WAVE_HINT.length) - 1][this.d.mobile ? 0 : 1]);
    this.showWave();
  }

  /** @param {number} dt */
  updateWave(dt) {
    const W = RUN.wave, alive = this.d.enemies.list.filter((o) => o.chase).length;
    // 到点冒下一批；场上（连同正冒烟的）已经满了就先等着
    if (this.waveLeft > 0 && (this.spawnT -= dt) <= 0 && alive + this.pending.length < W.alive) {
      const b = nextBatch(Math.min(this.waveLeft, W.alive - alive - this.pending.length), Math.random);
      this.spawnT = b.gap;
      this.waveLeft -= b.n;
      // 每种现在有几只（连同正冒烟的），到了同时上限就不再抽它
      /** @type {Record<string, number>} */
      const have = {};
      for (const o of this.d.enemies.list) if (o.chase) have[o.type] = (have[o.type] ?? 0) + 1;
      for (const q of this.pending) have[q.kind] = (have[q.kind] ?? 0) + 1;
      const mix = /** @type {Record<string, number>} */ (W.mix[Math.min(this.round, W.mix.length) - 1]);
      for (let i = 0; i < b.n; i++) {
        const at = spawnSpot(Math.random, this.p, ARENA_R - 0.8, W.away, [...BLOCK, ...this.pending.map((q) => ({ x: q.x, z: q.z, r: 0.9 }))]);
        const kind = pickMinion(mix, have, W.cap, Math.random);
        have[kind] = (have[kind] ?? 0) + 1;
        this.pending.push({ x: at.x, z: at.z, t: W.warn, kind });
      }
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const q = this.pending[i];
      q.t -= dt;
      // 冒紫烟：越到出来越浓
      if (Math.random() < dt * (14 + 30 * (1 - q.t / W.warn))) {
        this.d.particles.emit(q.x + rand(-0.4, 0.4), rand(0.05, 0.3), q.z + rand(-0.4, 0.4), rand(-0.4, 0.4), rand(0.6, 1.6), rand(-0.4, 0.4),
          rand(0.5, 0.9), rand(0.15, 0.3), [1.0, 0.5, 1.6], [0.3, 0.1, 0.5], { alpha: 0.4, drag: 2 });
      }
      if (q.t <= 0) { this.pending.splice(i, 1); this.spawnChaser(q); }
    }
    if (this.waveLeft <= 0 && !this.pending.length && !alive) { this.state = 'rest'; this.t = RUN.rest; this.clearBullets(); }
    this.showWave();
  }

  /** 紫烟里冒出一只小怪：刚出来的符箓傀儡、铁头傀儡先缓一会儿再出招 @param {{ x: number, z: number, kind: string }} at */
  spawnChaser(at) {
    const type = at.kind === 'archer' || at.kind === 'charger' ? at.kind : 'grunt';
    const e = this.d.enemies.spawnAt(type, at.x, at.z, 'chase');
    e.cd = type === 'archer' ? rand(1.2, 2.2) : 1.2;
    for (let i = 0; i < 24; i++) {
      this.d.particles.emit(at.x + rand(-0.4, 0.4), rand(0.1, 0.9), at.z + rand(-0.4, 0.4), rand(-1.5, 1.5), rand(1, 3), rand(-1.5, 1.5),
        rand(0.5, 0.9), rand(0.15, 0.3), [1.0, 0.5, 1.6], [0.3, 0.1, 0.5], { alpha: 0.4, drag: 2 });
    }
  }

  /** 左上角：第几轮、这段小怪还剩几只（数变了才改界面） */
  showWave() {
    const left = this.waveLeft + this.pending.length + this.d.enemies.list.filter((o) => o.chase).length;
    const key = `w${this.round}|${left}`;
    if (key === this.shown) return;
    this.shown = key;
    this.d.hud.setWave(`试炼 ${this.round}/${BOSS_COUNT} · 小怪潮`, `剩 ${left}`);
  }

  /**
   * 小怪潮里符箓傀儡、铁头傀儡出招（平时怎么走在 enemies.js chaseStep）。被吹飞、冻住、麻痹：手上的招作废。
   * @param {number} dt
   */
  updateMinions(dt) {
    const walls = this.d.blockers();
    for (const e of this.d.enemies.list) {
      if (e.type !== 'archer' && e.type !== 'charger') continue;
      if (e.mode !== 'chase' || e.frozen > 0 || e.stun > 0) { this.calm(e); continue; }
      const dx = this.p.x - e.pos.x, dz = this.p.z - e.pos.z, d = Math.max(Math.hypot(dx, dz), 1e-6);
      if (e.type === 'archer') this.archerAct(e, dt, d);
      else this.chargerAct(e, dt, dx, dz, d, walls);
      if (!this.fighting) return;   // 被撞死了
    }
  }

  /** 招作废：红条收起，过一会儿再出招 @param {any} e */
  calm(e) {
    if (!e.act) return;
    e.act = ''; e.lean = 0; e.cd = Math.max(e.cd, 1.0);
    this.dropStrip(e);
  }

  /**
   * 符箓傀儡：够得着就停下蓄力（紫光往手上收），到点朝玩家此刻站的地方射一颗紫火球（不提前量，走开就躲得掉）
   * @param {any} e @param {number} dt @param {number} d 离玩家多远
   */
  archerAct(e, dt, d) {
    const A = MINION.archer;
    if (!e.act) {
      e.cd -= dt;
      if (e.cd <= 0 && d <= A.keep[1] + 1.5) { e.act = 'aim'; e.t = A.aim; }
      return;
    }
    e.t -= dt;
    const hx = e.pos.x + e.dir.x * 0.4 * e.scale, hy = 0.95 * e.scale, hz = e.pos.z + e.dir.z * 0.4 * e.scale;
    if (Math.random() < dt * 40) {
      const a = rand(0, Math.PI * 2), r = rand(0.5, 0.9), x = hx + Math.cos(a) * r, z = hz + Math.sin(a) * r;
      this.d.particles.emit(x, hy + rand(-0.3, 0.3), z, (hx - x) * 3, 0, (hz - z) * 3, 0.3, rand(0.05, 0.1), [1.6, 0.8, 2.6], [0.5, 0.15, 0.9], { drag: 0.3 });
    }
    if (e.t > 0) return;
    const vx = this.p.x - hx, vz = this.p.z - hz, l = Math.hypot(vx, vz) || 1;
    this.fire(hx, hy, hz, (vx / l) * A.speed, (vz / l) * A.speed, { life: A.life, dmg: A.dmg, r: A.r, orb: true });
    e.act = ''; e.cd = rand(A.every[0], A.every[1]);
  }

  /**
   * 铁头傀儡：冷却好了、离玩家够近、中间没东西挡：停下，地上从脚下朝玩家亮一条红条（由近往远长满）；
   * 到点沿红条直冲过去（撞到障碍、土墙、广场边就停），一路撞到人打一下；冲完原地发晕，过一阵才再冲
   * @param {any} e @param {number} dt @param {number} dx @param {number} dz @param {number} d @param {{ x: number, z: number, r: number }[]} walls
   */
  chargerAct(e, dt, dx, dz, d, walls) {
    const C = MINION.charger, { particles } = this.d;
    if (!e.act) {
      e.cd -= dt;
      if (e.cd > 0 || d > C.reach) return;
      const dir = { x: dx / d, z: dz / d }, obs = [...BLOCK, ...walls];
      const len = chargeLen(e.pos, dir, obs, CHASE_R, C.len, CHARGER_BODY);
      if (len < Math.min(d, C.len) - 1.0 || len < 2) { e.cd = 0.3; return; }   // 路上有东西挡着：接着绕，过会儿再看
      e.act = 'tele'; e.t = C.tele; e.cdir = dir; e.clen = len; e.ran = 0; e.hit = false;
      e.dir.set(dir.x, 0, dir.z);
      e.strip = this.strip(e.pos, dir, len);
      return;
    }
    if (e.act === 'tele') {
      e.t -= dt;
      const k = 1 - Math.max(0, e.t) / C.tele;
      e.strip.fill.scale.x = Math.max(0.001, k);
      e.lean = -0.25 * k;   // 往后一坐，蓄着劲
      if (Math.random() < dt * 20) {   // 后脚刨地
        particles.emit(e.pos.x - e.cdir.x * 0.4 + rand(-0.2, 0.2), 0.05, e.pos.z - e.cdir.z * 0.4 + rand(-0.2, 0.2), -e.cdir.x * rand(1, 2), rand(0.3, 0.8),
          -e.cdir.z * rand(1, 2), rand(0.3, 0.5), rand(0.1, 0.16), [0.85, 0.8, 0.72], [0.6, 0.56, 0.5], { alpha: 0.35, drag: 2 });
      }
      if (e.t > 0) return;
      e.act = 'rush';
      // 预警到点时人已经不在红条里、闪避又按得够晚：算完美闪避
      if (!inStrip(this.p, e.pos, e.cdir, e.clen, C.w, BODY)) this.checkPerfect((q) => inStrip(q, e.pos, e.cdir, e.clen, C.w, BODY));
      return;
    }
    if (e.act === 'rush') {
      const step = Math.min(C.speed * dt, e.clen - e.ran);
      e.pos.x += e.cdir.x * step; e.pos.z += e.cdir.z * step; e.ran += step;
      e.lean = 0.35;
      // 冲的路上新立起的土墙：撞上就停
      if (walls.some((o) => (e.pos.x - o.x) ** 2 + (e.pos.z - o.z) ** 2 < (o.r + CHARGER_BODY) ** 2)) e.ran = e.clen;
      if (!e.hit && Math.hypot(this.p.x - e.pos.x, this.p.z - e.pos.z) < BODY + CHARGER_BODY + 0.1) {
        e.hit = true;
        if (this.hurt(C.dmg)) this.d.fx.shake = Math.max(this.d.fx.shake, 0.6);
        if (!this.fighting) return;
      }
      for (let i = 0; i < 2; i++) {
        particles.emit(e.pos.x + rand(-0.3, 0.3), 0.08, e.pos.z + rand(-0.3, 0.3), -e.cdir.x * rand(1, 3), rand(0.3, 1), -e.cdir.z * rand(1, 3),
          rand(0.3, 0.5), rand(0.12, 0.2), [0.85, 0.8, 0.72], [0.6, 0.56, 0.5], { alpha: 0.35, drag: 2 });
      }
      if (e.ran < e.clen - 1e-6) return;
      e.act = 'daze'; e.t = C.daze; e.lean = 0;
      this.dropStrip(e);
      return;
    }
    // 发晕：头上冒几颗金星
    e.t -= dt;
    if (Math.random() < dt * 10) {
      const a = rand(0, Math.PI * 2), y = 1.75 * e.scale;
      particles.emit(e.pos.x + Math.cos(a) * 0.35, y, e.pos.z + Math.sin(a) * 0.35, -Math.sin(a) * 1.2, 0.3, Math.cos(a) * 1.2, 0.45, rand(0.06, 0.1),
        [2.4, 2.0, 0.8], [0.9, 0.6, 0.2], { drag: 1 });
    }
    if (e.t <= 0) { e.act = ''; e.cd = C.cd; e.dir.set(dx / d, 0, dz / d); }   // 醒过来先转身对着人
  }

  /**
   * 冲锋前地上的红条：从 at 朝 dir 长 len、宽 w（默认铁头傀儡的）；填充由近往远长满（fill.scale.x 从 0 到 1）
   * @param {{ x: number, z: number }} at @param {{ x: number, z: number }} dir @param {number} len @param {number} [w]
   */
  strip(at, dir, len, w = MINION.charger.w) {
    const h = w / 2, t = 0.06;
    const area = new THREE.PlaneGeometry(len, h * 2).translate(len / 2, 0, 0);
    const edge = new THREE.Shape([new THREE.Vector2(0, -h), new THREE.Vector2(len, -h), new THREE.Vector2(len, h), new THREE.Vector2(0, h)]);
    edge.holes.push(new THREE.Path([new THREE.Vector2(t, -h + t), new THREE.Vector2(t, h - t), new THREE.Vector2(len - t, h - t), new THREE.Vector2(len - t, -h + t)]));
    const s = this.decal(area, new THREE.ShapeGeometry(edge));
    s.g.position.set(at.x, 0.03, at.z);
    s.g.rotation.y = Math.atan2(-dir.z, dir.x);   // 同扇形：几何沿 +x 画，转到 dir
    s.fill.scale.x = 0.001;
    s.g.visible = true;
    this.strips.add(s);
    return s;
  }

  /** 收起这只铁头傀儡的红条 @param {any} e */
  dropStrip(e) {
    const s = e.strip;
    if (!s) return;
    e.strip = null;
    this.strips.delete(s);
    this.scene.remove(s.g);
    s.g.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); /** @type {THREE.Material} */ (o.material).dispose(); } });
  }

  /** 第 n 个 boss 从广场那头现身，吼一声再出招（第三个火灵还没做，先用寒甲傀儡王顶上） @param {number} n */
  spawnBoss(n) {
    const cfg = this.cfg = BOSS_CFG[Math.min(n, BOSS_CFG.length) - 1];
    const b = this.d.enemies.spawnAt(/** @type {'boss' | 'stone'} */ (cfg.type), BOSS_AT.x, BOSS_AT.z, 'boss');
    this.boss = b;
    this.armor = cfg.armor; this.phase = 1; this.freezeCd = 0; this.sinceSummon = 0; this.lastMove = '';
    this.state = 'roar'; this.t = BOSS.roarSec;
    const { hud, fx } = this.d;
    fx.burst(new THREE.Vector3(b.pos.x, 0.4, b.pos.z), cfg.el, 3, 0.8);
    if (cfg === STONE) { fx.crack(new THREE.Vector3(b.pos.x, 0, b.pos.z), 3.2); fx.shake = Math.max(fx.shake, 0.5); }   // 巨像落地，地面裂开
    hud.bigText(this.bossName(), BOSS_INK[cfg.type][0], 1600);
    hud.setWave(`试炼 ${n}/${BOSS_COUNT}`, PHASE_NAME[1]);
    hud.setHint(BOSS_HINT[cfg.type][this.d.mobile ? 0 : 1]);
    this.shown = '';
    this.showBoss();
  }

  /** 当前这个 boss 叫什么 */
  bossName() { return ENEMIES[/** @type {'boss' | 'stone'} */ (this.cfg.type)].name; }

  /** 这个 boss 碎了：场上的小傀儡一起碎掉、冰锥收起，喘口气进下一段（最后一个 boss 就是打通了） @param {any} e */
  bossDown(e) {
    this.hideTele();
    this.clearBullets();
    for (const o of [...this.d.enemies.list]) if (o.chase) this.d.enemies.kill(o, o.pos);
    this.d.hud.setBoss(null);
    this.d.fx.burst(new THREE.Vector3(e.pos.x, 1.2, e.pos.z), this.cfg.el, 3.2, 0.9);
    if (this.stage + 1 >= RUN_STAGES.length) { this.end(true); return; }
    this.d.hud.bigText(`${this.bossName()}碎了`, '#16202b', 1400);
    this.state = 'rest'; this.t = RUN.rest;
  }

  /** 收起地上所有预警：红圈、红扇、落石的红圈、冲撞与地刺的红条（还没落的石头也不落了；已经冒出来的地刺自己缩回去） */
  hideTele() {
    this.circle.g.visible = this.sector.g.visible = false;
    for (const m of this.rockMarks) m.g.visible = false;
    this.rocks.length = 0; this.rockFx.count = 0;
    this.dropLanes();
  }

  /** 收起冲撞、地刺的红条 */
  dropLanes() {
    for (const l of this.lanes) this.dropStrip({ strip: l.s });
    this.lanes.length = 0;
  }

  /** 收场（回守关、重开）：玩家放回原处，预警收起 */
  stop() {
    this.on = false; this.fighting = false; this.boss = null;
    this.hideTele();
    this.spikes.length = 0; this.spikeFx.count = 0;
    this.clearBullets();
    this.dashAt = -Infinity; this.perfectUsed = true; this.glow = 0; this.lastMove = '';
    this.keys.clear(); this.ptr = null; this.stick.x = this.stick.y = 0;
    this.dashT = 0; this.hurtT = 0; this.flash = 0;
    this.stamina = TRIAL.stamina.max; this.sinceDash = Infinity; this.shownSta = ''; this.dashLock = 0; this.slowTele = false;
    this.pending.length = 0;
    for (const e of this.d.enemies.list) if (e.strip) this.dropStrip(e);
    for (const s of this.strips) this.dropStrip({ strip: s });   // 敌人已经被清掉（enemies.clear 不报 onGone）的
    this.ghostT = 0; this.ghost.visible = false;
    this.p.copy(HOME); this.face.set(0, 0, -1);
    this.sync();
    this.d.caster.visible = true;
    this.robe.emissive.setRGB(0, 0, 0);
    this.d.canvas.style.touchAction = '';
    this.d.hud.setTrial(false, false);
    this.d.hud.setPad(false);
    this.d.hud.setCoreName('阵眼');
    this.shown = '';
  }

  dispose() {
    this.stop(); this.unbind();
    for (const x of [this.circle, this.sector, ...this.rockMarks]) this.scene.remove(x.g);
    this.scene.remove(this.ghost); this.ghostMat.dispose();
    for (const m of [this.shards, this.orbs, this.dots, this.rockFx, this.spikeFx]) { this.scene.remove(m); m.geometry.dispose(); /** @type {THREE.Material} */ (m.material).dispose(); m.dispose(); }
  }

  // ---------------------------------------------------------------- 玩家
  dash() {
    if (!this.on || !canDash(this.stamina, this.sinceDash) || this.dashLock > 0 || this.hp <= 0) return;
    const mv = this.input();
    this.dashDir.copy(mv.lengthSq() > 0.01 ? mv.normalize() : this.face);
    this.dashT = TRIAL.dash.sec;
    this.stamina -= 1; this.sinceDash = 0;
    this.dashAt = this.clock; this.dashFrom.copy(this.p); this.perfectUsed = false;
    this.showStamina();
    if (this.mods.canying && this.fighting) {   // 残影留在闪避起点
      this.ghostT = RUN.arts.ghost.sec;
      this.ghost.position.set(this.p.x, 0, this.p.z);
      this.ghost.quaternion.copy(this.d.caster.quaternion);
      this.ghost.visible = true;
    }
    // 冰锥眼看就要撞上（正朝人飞、window 秒内到）才闪：当场算完美闪避
    const W = this.mods.perfectWindow;
    for (const b of this.bullets) {
      if (b.friendly) continue;
      const rx = this.p.x - b.x, rz = this.p.z - b.z, d = Math.hypot(rx, rz), sp = Math.hypot(b.vx, b.vz);
      if (d < b.r + BODY + sp * W && rx * b.vx + rz * b.vz > 0.7 * d * sp) { this.perfect(); break; }
    }
  }

  /** 完美闪避：周身爆一圈白光、顿帧；回法力、加气势、回精力 */
  perfect() {
    if (this.perfectUsed || !this.fighting) return;
    this.perfectUsed = true;
    const { fx, particles, hud } = this.d, P = TRIAL.perfect, p = this.p;
    fx.hitStop = Math.max(fx.hitStop, P.stop);
    fx.pulseDim(0.3, 0.3);
    for (let i = 0; i < 90; i++) {   // 一圈往外散
      const a = rand(0, Math.PI * 2), s = rand(2.5, 6);
      particles.emit(p.x + Math.cos(a) * 0.4, rand(0.1, 1.7), p.z + Math.sin(a) * 0.4, Math.cos(a) * s, rand(-0.5, 1.5), Math.sin(a) * s,
        rand(0.35, 0.7), rand(0.05, 0.11), [2.2, 2.2, 2.4], [0.8, 0.85, 1.0], { drag: 3 });
    }
    for (let i = 0; i < 30; i++) {   // 几缕往上飘
      particles.emit(p.x + rand(-0.5, 0.5), rand(0.2, 1.2), p.z + rand(-0.5, 0.5), rand(-0.3, 0.3), rand(1.5, 3), rand(-0.3, 0.3),
        rand(0.6, 1.1), rand(0.08, 0.16), [1.6, 1.6, 1.8], [0.6, 0.65, 0.8], { alpha: 0.5, drag: 1.5 });
    }
    this.glow = 1;
    this.d.floatText(new THREE.Vector3(p.x, 2.4, p.z), '完美闪避', '#ffffff');
    this.stamina = Math.min(TRIAL.stamina.max, this.stamina + P.stamina); this.showStamina();
    this.perfects++;
    this.d.reward(P.mana, this.mods.perfectGauge);
  }

  /** 招落下没打中：闪避按得够晚、按的时候本来在范围里，就是完美闪避 @param {(q: { x: number, z: number }) => boolean} inside */
  checkPerfect(inside) {
    if (!this.perfectUsed && isPerfect(this.clock - this.dashAt, inside(this.dashFrom), this.mods.perfectWindow)) this.perfect();
  }

  /** 这一帧想往哪走（世界坐标，长度 0～1）：键盘和拖动按屏幕方向算，W / 往上拖是朝屏幕里走 */
  input() {
    let ix = this.stick.x, iy = this.stick.y;
    for (const k of this.keys) { ix += MOVE_KEYS[k][0]; iy += MOVE_KEYS[k][1]; }
    const l = Math.hypot(ix, iy);
    if (l > 1) { ix /= l; iy /= l; }
    return this._m.copy(this._r).multiplyScalar(ix).addScaledVector(this._f, iy);
  }

  /** @param {number} dt @param {THREE.Camera} camera */
  movePlayer(dt, camera) {
    camera.getWorldDirection(this._f);
    this._f.setY(0).normalize();
    this._r.set(-this._f.z, 0, this._f.x);
    const { particles } = this.d;
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.p.addScaledVector(this.dashDir, (TRIAL.dash.dist / TRIAL.dash.sec) * dt);
      for (let i = 0; i < 3; i++) {
        particles.emit(this.p.x + rand(-0.2, 0.2), rand(0.2, 1.4), this.p.z + rand(-0.2, 0.2), -this.dashDir.x * 2, rand(0, 0.5), -this.dashDir.z * 2,
          rand(0.25, 0.45), rand(0.08, 0.16), [1.4, 1.4, 1.5], [0.6, 0.65, 0.75], { alpha: 0.35, drag: 3 });
      }
    } else {
      const mv = this.input();
      if (mv.lengthSq() > 0.0025) { this.p.addScaledVector(mv, TRIAL.speed * dt); this.face.copy(mv).normalize(); }
    }
    this.sinceDash += dt;
    this.dashLock = Math.max(0, this.dashLock - dt);
    this.stamina = regenStamina(this.stamina, dt);
    this.showStamina();
    const block = this.boss ? [...BLOCK, { x: this.boss.pos.x, z: this.boss.pos.z, r: BOSS_BODY }] : BLOCK;
    keepInArena(this.p, block, ARENA_R, BODY);
    this.sync();
    // 挨打后一小会儿不再受伤：身影一闪一闪；袍子泛红一下
    if (this.hurtT > 0) this.hurtT -= dt;
    this.d.caster.visible = this.hurtT <= 0 || Math.floor(this.hurtT * 16) % 2 === 0;
    this.flash = Math.max(0, this.flash - dt * 3);
    this.glow = Math.max(0, this.glow - dt * 1.5);   // 完美闪避：袍子亮白一下
    this.robe.emissive.setRGB(0.9 * this.flash + 0.8 * this.glow, 0.08 * this.flash + 0.8 * this.glow, 0.04 * this.flash + 0.9 * this.glow);
  }

  /** 闪避按钮上的精力格（攒到几成画几成；变化不到 2% 不重画）；字诀「重」锁住闪避时按钮变淡 */
  showStamina() {
    const s = Math.round(this.stamina * 50) / 50, locked = this.dashLock > 0, key = `${s}|${locked}`;
    if (key === this.shownSta) return;
    this.shownSta = key;
    this.d.hud.setStamina(s, TRIAL.stamina.max, locked);
  }

  /** 字诀「重」：放完 sec 秒内不能闪避 @param {number} sec */
  lockDash(sec) {
    this.dashLock = Math.max(this.dashLock, sec);
    this.showStamina();
  }

  /** 字诀「凝」冻住了 boss：它的下一招预警变慢（只管一招），boss 头上飘个「凝」 */
  chill() {
    const b = this.boss;
    if (!b) return;
    if (!this.slowTele) this.d.floatText(new THREE.Vector3(b.pos.x, 3.6, b.pos.z), '凝', '#9fd4ff');
    this.slowTele = true;
  }

  /** 施法者、脚下法阵、法术起点都挪到玩家的位置 */
  sync() {
    CASTER_POS.set(this.p.x, 0, this.p.z);
    this.d.caster.position.set(this.p.x, 0, this.p.z);
    for (const o of this.d.origins) o.set(this.p.x, 1.5, this.p.z);
    this.d.fx.groundSigil.position.set(this.p.x, 0.03, this.p.z);
  }

  /** 玩家挨一下（冲刺中闪掉） @param {number} dmg @returns {boolean} 打中了没有 */
  hurt(dmg) {
    if (!this.fighting || this.hp <= 0) return false;
    const at = new THREE.Vector3(this.p.x, 2.2, this.p.z);
    if (this.dashT > 0) { this.perfect(); return false; }   // 冲刺中硬吃过去：也是完美闪避
    if (this.hurtT > 0) return false;
    this.hp = Math.max(0, this.hp - dmg);
    this.hurtT = TRIAL.hurtGrace; this.flash = 1;
    this.d.fx.shake = Math.max(this.d.fx.shake, 0.45);
    this.d.floatText(at, `-${dmg}`, '#ff6b5a');
    this.d.hud.setCore(this.hp, TRIAL.hp);
    if (this.hp <= 0) this.end(false);
    return true;
  }

  /** 小傀儡贴身自爆 @param {any} e */
  touch(e) {
    this.d.fx.burst(new THREE.Vector3(e.pos.x, 0.6, e.pos.z), 'enemy', 1.2, 0.35);
    this.hurt(TRIAL.touchDmg);
  }

  // ---------------------------------------------------------------- boss
  /**
   * boss 挨一下（main.js hitEnemy 在结算前调）：按甲（冰甲、石甲）改这一下，削穿了演一下碎甲。po：这一下带着字诀「破」。
   * 石甲巨像：蓄力冲撞时挨的伤害攒起来，够了就打断；打断后的硬直里挨打更疼
   * @template {{ dmg: number, reaction: string, freezeSec: number, push: number, stunSec: number }} R
   * @param {any} e @param {string} el @param {R} r @param {boolean} [po] @returns {R}
   */
  hitBoss(e, el, r, po = false) {
    const cfg = this.cfg, h = bossHit({ armor: this.armor, freezeCd: this.freezeCd }, el, r, po, cfg);
    this.armor = h.armor;
    if (h.broke) {
      this.d.hud.bigText(`${cfg.armorName}碎了`, BOSS_INK[cfg.type][1], 1100);
      this.d.fx.burst(new THREE.Vector3(e.pos.x, 2, e.pos.z), cfg.el, 2.6, 0.9);
    }
    if (this.state === 'stagger') h.r.dmg *= STONE.charge.staggerMult;
    else if (this.state === 'tele' && this.move === 'charge' && (this.chargeDmg += h.r.dmg) >= STONE.charge.breakDmg) this.interrupt();
    return h.r;
  }

  /** 蓄力冲撞被打断：红条收起，boss 往前一栽、硬直几秒（这时挨打更疼），不再连冲 */
  interrupt() {
    const b = this.boss, { hud, fx } = this.d;
    this.dropLanes();
    this.state = 'stagger'; this.t = STONE.charge.stagger; this.left = 0; this.kick = 0.3;
    hud.bigText('打断', '#16202b', 1100);
    fx.burst(new THREE.Vector3(b.pos.x, 1.2, b.pos.z), 'earth', 2.4, 0.6);
    this.shown = '';
  }

  /** 有敌人没了（enemies 的 onGone）：是 boss 就过了这一段 @param {any} e @param {string} how */
  onGone(e, how) {
    this.dropStrip(e);
    if (e !== this.boss) return;
    this.boss = null;
    if (how === 'kill' && this.fighting) this.bossDown(e);
  }

  /** @param {boolean} won */
  end(won) {
    this.fighting = false;
    this.hideTele();
    this.clearBullets();
    if (won) for (const o of [...this.d.enemies.list]) if (o.chase) this.d.enemies.kill(o, o.pos);
    this.d.hud.setBoss(null);
    (won ? this.d.win : this.d.lose)();
  }

  /** 换阶段：手上的招作废，吼一声；第 2 阶段甲重凝，第 3 阶段狂暴 @param {number} ph */
  enterPhase(ph) {
    const b = this.boss, cfg = this.cfg;
    this.phase = ph;
    this.hideTele();
    this.state = 'roar'; this.t = BOSS.roarSec * 0.8; this.leanTo = -0.25;
    if (ph === 2) this.armor = cfg.armor;
    if (ph === 2) this.d.hud.bigText(`${cfg.armorName}重凝`, BOSS_INK[cfg.type][1], 1300);
    else this.d.hud.bigText('狂暴', '#b3261e', 1300);
    this.d.hud.setWave(`试炼 ${this.round}/${BOSS_COUNT}`, PHASE_NAME[ph]);
    this.d.fx.burst(new THREE.Vector3(b.pos.x, 1.2, b.pos.z), cfg.el, 3.2, 0.9);
  }

  /** 这一招连出几下：砸地狂暴时连砸两下，石甲巨像的冲撞狂暴时连冲两次 @param {import('../rules/trial.js').Move} m */
  moveCount(m) {
    return m === 'slam' ? slamCount(this.phase) : m === 'charge' ? STONE.charge.times[this.phase - 1] : 1;
  }

  /** 调试：马上出这一招（当前这个 boss 没有这招就不出） @param {import('../rules/trial.js').Move} m */
  force(m) {
    if (!this.fighting || !this.boss || !(m in this.cfg)) return;
    this.move = m; this.lastMove = m; this.left = this.moveCount(m);
    this.startTele();
  }

  recover() {
    this.state = 'recover'; this.t = recoverSec(this.phase, Math.random()); this.leanTo = 0;
  }

  /**
   * 预警开始：红圈落在玩家此刻站的地方；扇形朝玩家；召唤先在落点冒紫烟。
   * 石甲巨像：落石在玩家四周一块一个红圈；冲撞从脚下朝玩家亮一条红条（冲不出去就改成重踏）；地刺朝玩家亮一到三条红条
   */
  startTele() {
    const b = this.boss, cfg = this.cfg, again = this.left < this.moveCount(this.move);
    this.state = 'tele';
    // 连砸的第二下快一点、连冲的第二次蓄力短一些；字诀「凝」冻住过它，这一招慢一些
    const quick = !again ? 1 : this.move === 'slam' ? 0.7 : this.move === 'charge' ? STONE.charge.again : 1;
    this.t = this.teleLen = teleSec(this.move, this.phase, cfg) * quick * (this.slowTele ? RUN.runes.ning.tele : 1);
    this.slowTele = false;
    const dx = this.p.x - b.pos.x, dz = this.p.z - b.pos.z, d = Math.hypot(dx, dz);
    const aim = d > 1e-3 ? { x: dx / d, z: dz / d } : { x: b.dir.x, z: b.dir.z };
    if (this.move === 'slam') {
      this.target.set(this.p.x, 0, this.p.z);
      this.circle.g.position.set(this.target.x, 0.03, this.target.z);
      this.circle.g.scale.set(cfg.slam.r, 1, cfg.slam.r);
      this.circle.g.visible = true;
      this.leanTo = -0.22;
    } else if (this.move === 'rocks') {
      const R = STONE.rocks, tele = this.t, spots = rockSpots(this.p, R.n[this.phase - 1], Math.random, BLOCK, ARENA_R - 0.3);
      this.rocks = spots.map((s, i) => ({ x: s.x, z: s.z, t: tele + i * R.gap, len: tele + i * R.gap, landed: false, s: rand(0.9, 1.25), a: rand(0, 6.3) }));
      spots.forEach((s, i) => {
        const m = this.rockMarks[i];
        m.g.position.set(s.x, 0.03, s.z); m.g.scale.set(R.r, 1, R.r); m.fill.scale.set(0.001, 0.001, 1); m.g.visible = true;
      });
      this.t = this.teleLen = tele + (spots.length - 1) * R.gap;
      this.leanTo = -0.3;   // 仰头举手，把石头召下来
    } else if (this.move === 'charge') {
      const C = STONE.charge, len = chargeLen(b.pos, aim, [...BLOCK, ...this.d.blockers()], ARENA_R - 0.3, C.len, BOSS_BODY);
      if (len < 2) {   // 贴着障碍冲不出去：头一次改成重踏，连冲的第二次就不冲了
        if (again) this.recover(); else { this.move = 'slam'; this.left = this.moveCount('slam'); this.startTele(); }
        return;
      }
      this.sweepDir.set(aim.x, 0, aim.z);
      // 红条画到冲到头时身体的前沿
      this.lanes.push({ s: this.strip(b.pos, aim, len + BOSS_BODY, C.w), from: { x: b.pos.x, z: b.pos.z }, dir: aim, len, next: 0 });
      this.chargeDmg = 0;
      this.leanTo = -0.35;   // 蹲下蓄力
      this.shown = '';
    } else if (this.move === 'spikes') {
      const S = STONE.spikes;
      this.sweepDir.set(aim.x, 0, aim.z);
      for (const dir of spikeDirs(aim, S.lines[this.phase - 1])) {
        const from = { x: b.pos.x + dir.x * BOSS_BODY, z: b.pos.z + dir.z * BOSS_BODY };
        const len = chargeLen(from, dir, [], PLAZA_R - 0.3, S.len, 0);
        if (len > 0.5) this.lanes.push({ s: this.strip(from, dir, len, S.w), from, dir, len, next: 0.3 });
      }
      this.leanTo = -0.25;
    } else if (this.move === 'sweep') {
      this.sweepDir.set(this.p.x - b.pos.x, 0, this.p.z - b.pos.z);
      if (this.sweepDir.lengthSq() < 1e-4) this.sweepDir.copy(b.dir);
      this.sweepDir.normalize();
      this.sector.g.position.set(b.pos.x, 0.03, b.pos.z);
      this.sector.g.rotation.y = Math.atan2(-this.sweepDir.z, this.sweepDir.x);
      this.sector.g.scale.set(BOSS.sweep.r, 1, BOSS.sweep.r);
      this.sector.g.visible = true;
      this.leanTo = -0.12;
    } else if (this.move === 'summon') {
      const n = cfg.summon.n[this.phase - 1], a0 = Math.atan2(aim.z, aim.x);
      this.spots = Array.from({ length: n }, (_, i) => keepInArena(
        { x: b.pos.x + Math.cos(a0 + (i - (n - 1) / 2) * 0.8) * 2.4, z: b.pos.z + Math.sin(a0 + (i - (n - 1) / 2) * 0.8) * 2.4 }, BLOCK, ARENA_R, 0.3));
      this.leanTo = -0.32;
    } else {
      this.leanTo = this.move === 'homing' ? -0.3 : -0.15;   // 冰锥：后仰蓄力；旋转弹幕：微微后仰，原地转起来
    }
  }

  /**
   * 放一颗冰锥（orb：符箓傀儡的紫火球）
   * @param {number} x @param {number} y @param {number} z @param {number} vx @param {number} vz @param {{ life: number, dmg: number, r: number, homing?: boolean, orb?: boolean }} o
   */
  fire(x, y, z, vx, vz, o) {
    if (this.bullets.length >= MAX_BULLETS) return;
    this.bullets.push({ x, y, z, vx, vz, t: 0, life: o.life, homing: !!o.homing, dmg: o.dmg, r: o.r, orb: !!o.orb });
  }

  clearBullets() { this.bullets.length = 0; this.shards.count = this.orbs.count = this.dots.count = 0; }

  /**
   * 落石：红圈由内向外长满，最后 ROCK_FALL 秒石头从天上砸下来（越落越快）；落地时人在红圈里就挨一下。
   * boss 冻住了也照落（石头已经召到天上了）。
   * @param {number} dt
   */
  updateRocks(dt) {
    if (!this.rocks.length) return;
    const R = STONE.rocks;
    let n = 0, live = 0;
    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i], m = this.rockMarks[i];
      if (r.landed) continue;
      r.t -= dt;
      if (r.t <= 0) {
        r.landed = true; m.g.visible = false;
        this.d.fx.burst(new THREE.Vector3(r.x, 0.3, r.z), 'earth', R.r, 0.45);
        if (inCircle(this.p, r, R.r, BODY)) { this.hurt(R.dmg); if (!this.fighting) return; }
        else this.checkPerfect((q) => inCircle(q, r, R.r, BODY));
        continue;
      }
      live++;
      const k = Math.max(0.001, 1 - r.t / r.len);
      m.fill.scale.set(k, k, 1);
      if (r.t < ROCK_FALL) {
        const s = 1 - r.t / ROCK_FALL;
        this._rq.setFromAxisAngle(ROCK_AXIS, r.a + s * 2.5);
        this.rockFx.setMatrixAt(n++, this._m4.compose(this._bp.set(r.x, 0.4 + ROCK_FROM * (1 - s * s), r.z), this._rq, this._rs.setScalar(r.s)));
      }
    }
    this.rockFx.count = n; this.rockFx.instanceMatrix.needsUpdate = true;
    if (!live) this.rocks.length = 0;
  }

  /** 冒一根地刺（满了就不冒；冒在障碍里的不画） @param {number} x @param {number} z */
  spike(x, z) {
    if (this.spikes.length >= MAX_SPIKES || BLOCK.some((o) => (x - o.x) ** 2 + (z - o.z) ** 2 < o.r * o.r)) return;
    this.spikes.push({ x, z, t: 0, s: rand(0.75, 1.25), a: rand(0, 6.3), tx: rand(-0.22, 0.22), tz: rand(-0.22, 0.22) });
  }

  /** 地刺：一下冒出来、停一会儿、缩回地里（boss 碎了、冻住了也照样缩回去） @param {number} dt */
  updateSpikes(dt) {
    if (!this.spikes.length && !this.spikeFx.count) return;
    let n = 0;
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i];
      s.t += dt;
      const h = s.t < SPIKE_UP ? s.t / SPIKE_UP : s.t < SPIKE_UP + SPIKE_HOLD ? 1 : 1 - (s.t - SPIKE_UP - SPIKE_HOLD) / SPIKE_DOWN;
      if (h <= 0) { this.spikes.splice(i, 1); continue; }
      this._rq.setFromEuler(this._re.set(s.tx, s.a, s.tz));
      this.spikeFx.setMatrixAt(n++, this._m4.compose(this._bp.set(s.x, -0.05, s.z), this._rq, this._rs.set(s.s, s.s * h, s.s)));
    }
    this.spikeFx.count = n; this.spikeFx.instanceMatrix.needsUpdate = true;
  }

  /**
   * 地刺这一帧从近往远冒一段：每隔 SPIKE_GAP 冒一对（左右错开）；冒到人就打一下（一招只打一下），
   * 没冒到、闪避按得够晚、按的时候站在这一段上：完美闪避。全冒到头了就收招。
   * @param {number} dt
   */
  spikeStep(dt) {
    const S = STONE.spikes, f0 = this.front, f1 = (this.front += S.speed * dt), { particles } = this.d;
    let more = false;
    for (const l of this.lanes) {
      if (f0 >= l.len) continue;
      more = true;
      const end = Math.min(f1, l.len), sx = -l.dir.z, sz = l.dir.x;
      for (; l.next < end; l.next += SPIKE_GAP) {
        for (const side of [-1, 1]) {
          const off = side * S.w * 0.22 + rand(-0.12, 0.12), along = l.next + rand(-0.1, 0.1);
          this.spike(l.from.x + l.dir.x * along + sx * off, l.from.z + l.dir.z * along + sz * off);
        }
      }
      const fx = l.from.x + l.dir.x * end, fz = l.from.z + l.dir.z * end;
      for (let i = 0; i < 2; i++) {   // 冒刺的地方翻起一股土
        particles.emit(fx + rand(-0.4, 0.4), 0.1, fz + rand(-0.4, 0.4), l.dir.x * rand(1, 3), rand(1, 2.5), l.dir.z * rand(1, 3),
          rand(0.3, 0.55), rand(0.1, 0.18), [0.85, 0.72, 0.55], [0.55, 0.45, 0.33], { alpha: 0.4, drag: 2.5 });
      }
      if (this.struck) continue;
      if (spikeReach(this.p, l.from, l.dir, f0, end, S.w, BODY)) {
        this.struck = true;
        this.hurt(S.dmg);
        if (!this.fighting) return;
      } else this.checkPerfect((q) => spikeReach(q, l.from, l.dir, f0, end, S.w, BODY));
    }
    if (!more) { this.dropLanes(); this.recover(); }
  }

  /**
   * 冲撞冲一帧：沿红条每秒冲 speed 米，身体前沿扫过人就撞一下（一次只撞一下）；撞上新立起的土墙就停。
   * 冲到头：狂暴时再蓄一次，不然喘口气。
   * @param {number} dt
   */
  rushStep(dt) {
    const C = STONE.charge, b = this.boss, l = this.lanes[0], { fx, particles } = this.d;
    const f0 = this.ran === 0 ? -BOSS_BODY : this.ran + BOSS_BODY;
    const step = Math.min(C.speed * dt, l.len - this.ran);
    b.pos.x += l.dir.x * step; b.pos.z += l.dir.z * step; this.ran += step;
    b.dir.set(l.dir.x, 0, l.dir.z); b.moving = true; this.leanTo = 0.35;
    if (this.d.blockers().some((o) => (b.pos.x - o.x) ** 2 + (b.pos.z - o.z) ** 2 < (o.r + BOSS_BODY) ** 2)) this.ran = l.len;
    const f1 = this.ran + BOSS_BODY;
    if (!this.struck) {
      if (spikeReach(this.p, l.from, l.dir, f0, f1, C.w, BODY)) {
        this.struck = true;
        if (this.hurt(C.dmg)) fx.shake = Math.max(fx.shake, 0.7);
        if (!this.fighting) return;
      } else this.checkPerfect((q) => spikeReach(q, l.from, l.dir, f0, f1, C.w, BODY));
    }
    for (let i = 0; i < 3; i++) {   // 脚下扬起的土
      particles.emit(b.pos.x + rand(-0.8, 0.8), 0.1, b.pos.z + rand(-0.8, 0.8), -l.dir.x * rand(1, 3), rand(0.3, 1.2), -l.dir.z * rand(1, 3),
        rand(0.4, 0.7), rand(0.15, 0.28), [0.85, 0.78, 0.66], [0.58, 0.52, 0.44], { alpha: 0.4, drag: 2 });
    }
    if (this.ran < l.len - 1e-6) return;
    keepInArena(b.pos, BLOCK, ARENA_R - 0.3, BOSS_BODY);
    this.dropLanes();
    fx.crack(new THREE.Vector3(b.pos.x + l.dir.x * BOSS_BODY, 0, b.pos.z + l.dir.z * BOSS_BODY), 1.4);
    fx.shake = Math.max(fx.shake, 0.45);
    this.kick = 0.4;
    if (--this.left > 0) this.startTele(); else this.recover();
  }

  /**
   * 字诀「返」：冰锥撞上写了「返」的土墙，被推回墙外、掉头飞向 boss（没有 boss 就照墙面反射），快一些、伤害翻倍，从此不伤人
   * @param {{ x: number, y: number, z: number, vx: number, vz: number, t: number, life: number, homing: boolean, dmg: number, r: number,
   *           friendly?: boolean }} b @param {{ x: number, z: number, r: number }} o 撞上的那段墙
   */
  bounce(b, o) {
    const F = RUN.runes.fan, sp = Math.hypot(b.vx, b.vz) * F.speed;
    let nx = b.x - o.x, nz = b.z - o.z;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    b.x = o.x + nx * (o.r + b.r + 0.05); b.z = o.z + nz * (o.r + b.r + 0.05);
    let vx = b.vx, vz = b.vz;
    if (this.boss) { vx = this.boss.pos.x - b.x; vz = this.boss.pos.z - b.z; }
    else { const d = vx * nx + vz * nz; if (d < 0) { vx -= 2 * d * nx; vz -= 2 * d * nz; } }
    const vl = Math.hypot(vx, vz) || 1;
    b.vx = (vx / vl) * sp; b.vz = (vz / vl) * sp;
    b.friendly = true; b.homing = false; b.t = 0; b.life = (PLAZA_R * 2) / sp; b.dmg *= F.mult;
    for (let k = 0; k < 8; k++) {   // 墙上迸几粒金色的石屑
      this.d.particles.emit(b.x, b.y, b.z, nx * rand(1, 3) + rand(-1, 1), rand(0.5, 2.5), nz * rand(1, 3) + rand(-1, 1), rand(0.25, 0.45), rand(0.04, 0.08),
        [2.4, 1.6, 0.5], [0.8, 0.45, 0.1], { drag: 2, grav: -8 });
    }
  }

  /**
   * 字诀「引」：一道闪电从 a 劈到 b，两侧 r 米内的冰锥全碎（弹回去的不算）
   * @param {{ x: number, z: number }} a @param {{ x: number, z: number }} b @param {number} r @returns {number} 碎了几颗
   */
  shatter(a, b, r) {
    let n = 0;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const q = this.bullets[i];
      if (q.friendly || distToSegment(q, a, b) > r) continue;
      for (let k = 0; k < 8; k++) {
        this.d.particles.emit(q.x, q.y, q.z, rand(-3, 3), rand(0.5, 3), rand(-3, 3), rand(0.25, 0.5), rand(0.05, 0.1), [2.2, 1.9, 0.9], [0.5, 0.55, 0.9], { drag: 2, grav: -8 });
      }
      this.bullets.splice(i, 1);
      n++;
    }
    return n;
  }

  /**
   * 弹回去的冰锥飞一帧：穿过土墙（刚从墙上弹出来）、撞上石物件就碎、撞上敌人打它一下；拖一道金光
   * @param {{ x: number, y: number, z: number, vx: number, vz: number, t: number, life: number, dmg: number, r: number }} b @param {number} dt
   * @returns {boolean} 没了
   */
  flyBack(b, dt) {
    b.x += b.vx * dt; b.z += b.vz * dt;
    b.y += (1.0 - b.y) * Math.min(1, dt * 4);
    if (b.t > b.life || Math.hypot(b.x, b.z) > PLAZA_R + 3) return true;
    for (const o of BLOCK) if ((b.x - o.x) ** 2 + (b.z - o.z) ** 2 < (o.r + b.r) ** 2) return true;
    for (const e of this.d.enemies.list) {
      const r = (e === this.boss ? BOSS_BODY : 0.45) + b.r;
      if ((b.x - e.pos.x) ** 2 + (b.z - e.pos.z) ** 2 < r * r) { this.d.strike(e, b.dmg, b); return true; }
    }
    if (Math.random() < dt * 40) {
      this.d.particles.emit(b.x, b.y, b.z, -b.vx * 0.1, 0.2, -b.vz * 0.1, rand(0.25, 0.4), rand(0.1, 0.18), [2.4, 1.7, 0.6], [0.8, 0.45, 0.1], { alpha: 0.7, drag: 3 });
    }
    return false;
  }

  /** 冰锥飞一帧：追人的转弯；撞上土墙、场上的石物件就碎（写了「返」的土墙弹回去）；撞上人就伤人；弹回去的撞上敌人打敌人 @param {number} dt */
  updateBullets(dt) {
    const { particles } = this.d, walls = this.d.blockers(), H = BOSS.homing;
    const ghost = this.ghostT > 0 ? this.ghost.position : null;   // 残影在：追踪的改追它
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.t += dt;
      if (b.friendly) {
        const gone = this.flyBack(b, dt);
        if (this.bullets[i] !== b) return;   // 这一下打碎了 boss：冰锥已经全收了
        if (gone) this.bullets.splice(i, 1);
        continue;
      }
      // 甩出去先直飞一小段再拐。追过残影的算被骗过：残影散了也不再回头，直飞到化掉
      // （转向有上限，两侧的冰锥 1.5 秒里拐不到残影跟前；不这样，残影一散它们又掉头追人，10-27 预览实测）
      if (b.homing && ghost) b.fooled = true;
      if (b.homing && b.t > 0.35 && (ghost || !b.fooled)) {
        const v = this._hv; v.x = b.vx; v.z = b.vz;
        homingTurn(v, b, ghost ?? this.p, H.turn, dt);
        b.vx = v.x; b.vz = v.z;
      }
      b.x += b.vx * dt; b.z += b.vz * dt;
      b.y += (1.0 - b.y) * Math.min(1, dt * 4);   // 追踪冰锥从高处甩出，落到齐腰高
      let gone = b.t > b.life || Math.hypot(b.x, b.z) > PLAZA_R + 3;
      if (!gone) {
        for (const o of walls) {
          if ((b.x - o.x) ** 2 + (b.z - o.z) ** 2 >= (o.r + b.r) ** 2) continue;
          if (o.bounce) this.bounce(b, o); else gone = true;
          break;
        }
        if (b.friendly) continue;
        if (!gone) for (const o of BLOCK) if ((b.x - o.x) ** 2 + (b.z - o.z) ** 2 < (o.r + b.r) ** 2) { gone = true; break; }
        if (!gone && ghost && b.y < 1.6 && inCircle(b, ghost, b.r, RUN.arts.ghost.r)) gone = true;
        if (gone) {   // 撞碎：溅几片冰（火球溅紫火星）
          const [c0, c1] = b.orb ? [[1.8, 0.9, 2.6], [0.5, 0.15, 0.9]] : [[1.4, 1.8, 2.2], [0.3, 0.55, 0.9]];
          for (let k = 0; k < 10; k++) {
            particles.emit(b.x, b.y, b.z, rand(-3, 3), rand(0.5, 3), rand(-3, 3), rand(0.25, 0.5), rand(0.05, 0.1), c0, c1, { drag: 2, grav: -8 });
          }
        }
      }
      if (!gone && b.y < 1.6 && inCircle(b, this.p, b.r, BODY)) {
        if (this.dashT > 0) this.perfect();   // 冲刺中穿身而过
        else {
          this.hurt(b.dmg); gone = true;
          if (this.bullets[i] !== b) return;   // 这一下打死了人：收场时冰锥已经清空，别再往下数
        }
      }
      if (gone) { this.bullets.splice(i, 1); continue; }
      // 身后拖一道冷光：追踪的拖得密，看得出它在拐弯；旋转弹幕一轮几十颗，拖得稀，不然连成一片白；火球拖一串紫火
      if (Math.random() < dt * (b.homing ? 40 : b.orb ? 30 : 4)) {
        const [c0, c1] = b.orb ? [[1.6, 0.7, 2.4], [0.4, 0.1, 0.8]] : [[1.4, 1.9, 2.4], [0.3, 0.5, 0.9]];
        particles.emit(b.x, b.y, b.z, -b.vx * 0.1, 0.2, -b.vz * 0.1, rand(0.25, 0.4), rand(0.1, 0.18), c0, c1, { alpha: 0.6, drag: 3 });
      }
    }
    const n = this.bullets.length;
    let ns = 0, no = 0;
    for (let i = 0; i < n; i++) {
      const b = this.bullets[i];
      this._bd.set(b.vx, 0, b.vz).normalize();
      this._q.setFromUnitVectors(Z_AXIS, this._bd);
      this._m4.compose(this._bp.set(b.x, b.y, b.z), this._q, this._s);
      if (b.orb) this.orbs.setMatrixAt(no++, this._m4); else this.shards.setMatrixAt(ns++, this._m4);
      // 弹回去的不伤人，地上不画红点
      this.dots.setMatrixAt(i, this._m4.compose(this._bp.set(b.x, 0.035, b.z), this._q.identity(), b.friendly ? NO_SIZE : this._s));
    }
    this.shards.count = ns; this.orbs.count = no; this.dots.count = n;
    for (const m of [this.shards, this.orbs, this.dots]) m.instanceMatrix.needsUpdate = true;
  }

  /** 预警到点：判定、演出 */
  resolve() {
    const b = this.boss, cfg = this.cfg, { fx, particles } = this.d;
    if (this.move === 'slam') {
      const S = cfg.slam;
      this.circle.g.visible = false;
      if (inCircle(this.p, this.target, S.r, BODY)) this.hurt(S.dmg);
      else this.checkPerfect((q) => inCircle(q, this.target, S.r, BODY));
      fx.burst(new THREE.Vector3(this.target.x, 0.3, this.target.z), cfg.el, S.r, 0.7);
      fx.crack(this.target, S.r * 0.8);
      this.kick = 0.45;
      if (--this.left > 0) { this.startTele(); return; }
      this.recover();
    } else if (this.move === 'rocks') {
      this.recover();   // 石头已经在天上，自己接着落（updateRocks）
    } else if (this.move === 'charge') {
      // 冲出去；预警到点时人已经不在红条里、闪避又按得够晚：算完美闪避（同铁头傀儡）
      const l = this.lanes[0], C = STONE.charge;
      if (!inStrip(this.p, l.from, l.dir, l.len + BOSS_BODY, C.w, BODY)) this.checkPerfect((q) => inStrip(q, l.from, l.dir, l.len + BOSS_BODY, C.w, BODY));
      this.state = 'rush'; this.ran = 0; this.struck = false; this.kick = 0.3;
      fx.shake = Math.max(fx.shake, 0.3);
      this.shown = '';
    } else if (this.move === 'spikes') {
      this.state = 'spikes'; this.front = 0; this.struck = false; this.kick = 0.55;
      fx.crack(new THREE.Vector3(b.pos.x + this.sweepDir.x * BOSS_BODY, 0, b.pos.z + this.sweepDir.z * BOSS_BODY), 1.6);
      fx.shake = Math.max(fx.shake, 0.4);
    } else if (this.move === 'sweep') {
      this.sector.g.visible = false;
      if (inSector(this.p, b.pos, this.sweepDir, SWEEP_HALF, BOSS.sweep.r, BODY)) this.hurt(BOSS.sweep.dmg);
      else this.checkPerfect((q) => inSector(q, b.pos, this.sweepDir, SWEEP_HALF, BOSS.sweep.r, BODY));
      const a0 = Math.atan2(this.sweepDir.z, this.sweepDir.x);
      for (let i = 0; i < 90; i++) {
        const a = a0 + rand(-SWEEP_HALF, SWEEP_HALF), r = rand(1.2, BOSS.sweep.r), s = rand(3, 7);
        particles.emit(b.pos.x + Math.cos(a) * r, rand(0.2, 1.0), b.pos.z + Math.sin(a) * r, -Math.sin(a) * s, rand(0.3, 1.5), Math.cos(a) * s,
          rand(0.35, 0.7), rand(0.08, 0.18), [0.8, 1.3, 1.9], [0.2, 0.45, 0.9], { drag: 2.5 });
      }
      fx.shake = Math.max(fx.shake, 0.35);
      this.state = 'spin'; this.t = 0.28; this.spinFrom = a0 - SWEEP_HALF;   // 身子跟着扫过去
    } else if (this.move === 'homing') {
      // 从举高的手上往前甩出一把冰锥，左右散开，飞一小段后各自拐向玩家
      const H = BOSS.homing, n = H.n[this.phase - 1], aim = Math.atan2(this.p.z - b.pos.z, this.p.x - b.pos.x), spread = (70 * Math.PI) / 180;
      for (let i = 0; i < n; i++) {
        const a = aim + (n > 1 ? (i / (n - 1) - 0.5) * 2 * spread : 0);
        this.fire(b.pos.x + Math.cos(a) * 1.1, 2.6, b.pos.z + Math.sin(a) * 1.1, Math.cos(a) * H.speed, Math.sin(a) * H.speed,
          { life: H.life, dmg: H.dmg, r: H.r, homing: true });
      }
      fx.burst(new THREE.Vector3(b.pos.x, 2.6, b.pos.z), 'ice', 1.2, 0.4);
      this.kick = 0.35;
      this.recover();
    } else if (this.move === 'spiral') {
      // 原地转起来，几条臂一边转一边往外喷冰锥
      this.state = 'channel'; this.t = BOSS.spiral.sec; this.chT = 0; this.emitT = 0;
      this.a0 = Math.atan2(this.p.z - b.pos.z, this.p.x - b.pos.x);
    } else {
      for (const s of this.spots) {
        this.d.enemies.spawnAt('grunt', s.x, s.z, 'chase');
        for (let i = 0; i < 24; i++) {
          particles.emit(s.x + rand(-0.4, 0.4), rand(0.1, 0.9), s.z + rand(-0.4, 0.4), rand(-1.5, 1.5), rand(1, 3), rand(-1.5, 1.5),
            rand(0.5, 0.9), rand(0.15, 0.3), [1.0, 0.5, 1.6], [0.3, 0.1, 0.5], { alpha: 0.4, drag: 2 });
        }
      }
      this.sinceSummon = 0;
      this.recover();
    }
  }

  /**
   * 每帧。dt 是游戏时间，pdt 是玩家的时间（心法刹那：全场慢下来时玩家照常快，走位、闪避冷却按 pdt 走）
   * @param {number} dt @param {THREE.Camera} camera @param {number} [pdt]
   */
  update(dt, camera, pdt = dt) {
    if (!this.on) return;
    this.clock += dt;
    if (this.hp > 0) this.movePlayer(pdt, camera);
    if (this.ghostT > 0) {   // 残影慢慢淡掉
      this.ghostT -= dt;
      this.ghostMat.opacity = 0.15 + 0.4 * Math.max(0, this.ghostT / RUN.arts.ghost.sec);
      if (this.ghostT <= 0) this.ghost.visible = false;
    }
    this.updateSpikes(dt);
    if (!this.fighting) return;
    this.runT += dt;
    if (this.state === 'wave') {   // 小怪潮：火球照飞（打死了人就停），小怪出招，到点冒下一批
      this.updateBullets(dt);
      if (this.fighting) this.updateMinions(dt);
      if (this.fighting) this.updateWave(dt);
      return;
    }
    if (this.state === 'rest') { if ((this.t -= dt) <= 0) this.next(); return; }   // 一段打完喘口气
    const b = this.boss;
    if (!b) return;
    this.updateBullets(dt);   // 冰锥照飞，boss 冻住了也一样
    if (this.fighting) this.updateMinions(dt);   // 小怪潮剩下的（调试放进来的）照样出招
    if (this.fighting) this.updateRocks(dt);
    if (!this.fighting) return;   // 被冰锥、落石打死了
    const cfg = this.cfg;
    const held = b.frozen > 0 || b.stun > 0;
    if (b.frozen > 0) this.freezeCd = BOSS.freezeGrace; else this.freezeCd = Math.max(0, this.freezeCd - dt);
    const ph = bossPhase(b.hp, b.maxHp);
    if (ph > this.phase) this.enterPhase(ph);
    this.sinceSummon += dt;
    b.moving = false;
    const dx = this.p.x - b.pos.x, dz = this.p.z - b.pos.z, dist = Math.hypot(dx, dz);
    const turn = (/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ k) => { this._m.set(x, 0, z); if (this._m.lengthSq() > 1e-6) b.dir.lerp(this._m.normalize(), Math.min(1, dt * k)).setY(0).normalize(); };
    if (!held) {   // 冻住、麻痹时一切停住（连预警也停）
      this.t -= dt;
      if (this.state === 'roar') {
        turn(dx, dz, 4);
        if (this.t <= 0) this.recover();
      } else if (this.state === 'recover') {
        turn(dx, dz, 5);
        if (dist > BOSS.keepDist) {
          const v = ENEMIES[/** @type {'boss' | 'stone'} */ (cfg.type)].speed * (this.phase >= 3 ? BOSS.enrageSpeed : 1) * dt;
          b.pos.x += (dx / dist) * v; b.pos.z += (dz / dist) * v;
          keepInArena(b.pos, BLOCK, ARENA_R - 0.3, BOSS_BODY);
          b.moving = true;
        }
        if (this.t <= 0) {
          const minions = this.d.enemies.list.filter((o) => o.chase).length;
          this.move = pickMove(this.phase, { dist, minions, sinceSummon: this.sinceSummon, last: this.lastMove }, Math.random(), cfg);
          this.lastMove = this.move;
          this.left = this.moveCount(this.move);
          this.startTele();
        }
      } else if (this.state === 'tele') {
        const k = Math.max(0.001, 1 - Math.max(0, this.t) / this.teleLen);
        if (this.move === 'slam') {
          this.circle.fill.scale.set(k, k, 1);
          turn(this.target.x - b.pos.x, this.target.z - b.pos.z, 6);
        } else if (this.move === 'sweep') {
          this.sector.fill.scale.set(k, k, 1);
          turn(this.sweepDir.x, this.sweepDir.z, 8);
        } else if (this.move === 'summon') {
          if (Math.random() < dt * 30) {
            const s = this.spots[Math.floor(Math.random() * this.spots.length)];
            this.d.particles.emit(s.x + rand(-0.3, 0.3), 0.1, s.z + rand(-0.3, 0.3), 0, rand(0.8, 1.6), 0, rand(0.5, 0.8), rand(0.12, 0.22),
              [0.9, 0.45, 1.5], [0.25, 0.08, 0.4], { alpha: 0.35, drag: 1 });
          }
        } else if (this.move === 'rocks') {
          turn(dx, dz, 4);
        } else if (this.move === 'charge' || this.move === 'spikes') {
          for (const l of this.lanes) l.s.fill.scale.x = k;
          turn(this.sweepDir.x, this.sweepDir.z, 8);
          if (this.move === 'charge') {
            // 蓄力：后脚刨地，土黄的光往身上收
            const back = -BOSS_BODY * 0.8;
            if (Math.random() < dt * 25) {
              this.d.particles.emit(b.pos.x + this.sweepDir.x * back + rand(-0.5, 0.5), 0.08, b.pos.z + this.sweepDir.z * back + rand(-0.5, 0.5),
                -this.sweepDir.x * rand(1.5, 3), rand(0.4, 1.2), -this.sweepDir.z * rand(1.5, 3), rand(0.4, 0.6), rand(0.14, 0.24),
                [0.85, 0.78, 0.66], [0.58, 0.52, 0.44], { alpha: 0.4, drag: 2 });
            }
            for (let i = 0; i < 2; i++) {
              if (Math.random() > dt * 30) continue;
              const a = rand(0, Math.PI * 2), r = rand(2, 3), x = b.pos.x + Math.cos(a) * r, z = b.pos.z + Math.sin(a) * r;
              this.d.particles.emit(x, rand(0.6, 2.4), z, (b.pos.x - x) * 2.2, 0, (b.pos.z - z) * 2.2, 0.42, rand(0.06, 0.12),
                [2.2, 1.3, 0.4], [0.8, 0.4, 0.1], { drag: 0.3 });
            }
          }
        } else {
          // 冰锥、旋转弹幕的蓄力：寒气往 boss 身上收（冰锥收到举高的手上，弹幕收到腰间）
          turn(dx, dz, 5);
          const y = this.move === 'homing' ? 2.6 : 1.0;
          for (let i = 0; i < 2; i++) {
            if (Math.random() > dt * 30) continue;
            const a = rand(0, Math.PI * 2), r = rand(1.8, 2.8), x = b.pos.x + Math.cos(a) * r, z = b.pos.z + Math.sin(a) * r;
            this.d.particles.emit(x, y + rand(-0.5, 0.5), z, (b.pos.x - x) * 2.2, 0, (b.pos.z - z) * 2.2, 0.42, rand(0.06, 0.12),
              [1.3, 1.8, 2.3], [0.3, 0.55, 0.9], { drag: 0.3 });
          }
        }
        if (this.t <= 0) this.resolve();
      } else if (this.state === 'channel') {
        // 旋转弹幕：每 every 秒各条臂喷一颗，身子跟着转
        const S = BOSS.spiral, arms = S.arms[this.phase - 1];
        this.chT += dt; this.emitT -= dt;
        while (this.emitT <= 0 && this.t > 0) {
          this.emitT += S.every;
          for (const a of spiralAngles(this.chT, arms, this.a0)) {
            this.fire(b.pos.x + Math.cos(a) * 1.3, 1.0, b.pos.z + Math.sin(a) * 1.3, Math.cos(a) * S.speed, Math.sin(a) * S.speed,
              { life: (PLAZA_R * 2) / S.speed, dmg: S.dmg, r: S.r });
          }
        }
        const a = this.a0 + this.chT * S.spin;
        b.dir.set(Math.cos(a), 0, Math.sin(a));
        if (this.t <= 0) this.recover();
      } else if (this.state === 'spin') {
        const a = this.spinFrom + SWEEP_HALF * 2 * (1 - Math.max(0, this.t) / 0.28);
        b.dir.set(Math.cos(a), 0, Math.sin(a));
        if (this.t <= 0) this.recover();
      } else if (this.state === 'rush') {
        this.rushStep(dt);
        if (!this.fighting) return;
      } else if (this.state === 'spikes') {
        this.spikeStep(dt);
        if (!this.fighting) return;
      } else if (this.state === 'stagger') {
        // 被打断：往前栽着喘不上气，头上冒金星
        this.leanTo = 0.45;
        if (Math.random() < dt * 14) {
          const a = rand(0, Math.PI * 2), y = 1.75 * b.scale;
          this.d.particles.emit(b.pos.x + Math.cos(a) * 0.9, y, b.pos.z + Math.sin(a) * 0.9, -Math.sin(a) * 2, 0.3, Math.cos(a) * 2, 0.5, rand(0.1, 0.16),
            [2.4, 2.0, 0.8], [0.9, 0.6, 0.2], { drag: 1 });
        }
        if (this.t <= 0) this.recover();
      }
    }
    // 出招的身段：蓄力后仰、砸下去前扑一下
    this.kick = Math.max(0, this.kick - dt * 2.5);
    b.lean += (this.leanTo + this.kick - b.lean) * Math.min(1, dt * 12);
    if (b.armorMesh) b.armorMesh.visible = this.armor > 0;
    if (cfg === BOSS) this.d.enemies.armorMat.opacity = 0.2 + 0.4 * (this.armor / BOSS.armor);   // 冰甲越削越透
    this.showBoss();
  }

  /** 顶上的 boss 血条（数变了才改界面）；石甲巨像蓄力冲撞时写还差多少伤害打断，被打断时写硬直 */
  showBoss() {
    const b = this.boss;
    if (!b) return;
    const cfg = this.cfg, need = this.state === 'tele' && this.move === 'charge' ? Math.max(0, Math.ceil(STONE.charge.breakDmg - this.chargeDmg)) : -1;
    const key = `${Math.ceil(b.hp)}|${Math.ceil(this.armor)}|${this.phase}|${need}|${this.state === 'stagger'}`;
    if (key === this.shown) return;
    this.shown = key;
    const tail = need >= 0 ? ` · 蓄力！再打 ${need} 就打断` : this.state === 'stagger' ? ' · 硬直' : '';
    this.d.hud.setBoss({ name: this.bossName(), phase: `${PHASE_NAME[this.phase]}${this.armor > 0 ? ` · ${cfg.armorName}` : ''}${tail}`,
      hp: b.hp, max: b.maxHp, armor: this.armor, armorMax: cfg.armor, stone: cfg === STONE });
  }

  /** 天色（world/invasion.js，一轮一档）用：这一轮打到几成——小怪潮占前一半（这段小怪打掉几成），boss 占后一半（血掉了几成） */
  progress() {
    const b = this.boss;
    if (b) return 0.5 + 0.5 * Math.min(1, Math.max(0, 1 - b.hp / b.maxHp));
    if (this.state === 'wave') return 0.5 * (1 - (this.waveLeft + this.d.enemies.list.filter((o) => o.chase).length) / Math.max(1, this.waveN));
    const st = RUN_STAGES[this.stage]?.kind === 'pick' ? RUN_STAGES[this.stage - 1] : RUN_STAGES[this.stage];
    return st?.kind === 'boss' ? 1 : st?.kind === 'wave' ? 0.5 : 0;
  }
}
