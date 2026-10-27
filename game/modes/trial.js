// @ts-check
/**
 * 试炼模式（灰盒，设计文档第 2 节"试炼模式"）：在山门广场上走位躲 boss 的招。
 * 战中不打字：WASD / 方向键走位、空格闪避、1～3 放天赋、4 召唤（手机横过来玩：左手摇杆走位，右手点"闪"和天赋）；战前可以给按钮写咒。
 * 规则（冰甲、换阶段、挑招、判定、走位边界）在 rules/trial.js；这里管玩家走位与受伤、boss 的动作、地上的预警。
 * 一局（rules/run.js RUN_STAGES）：小怪潮 → 三选一 → boss → 三选一 → …… → 第三个 boss；这里按顺序推进，选卡交给 main.js（d.pick）。
 * 第二、三个 boss（石甲巨像、火灵）还没做，先用寒甲傀儡王顶上。
 * 施法者的位置就是 CASTER_POS：玩家走到哪，法术就从哪放出（同步脚下法阵和特效起点）；回到守关时放回原处。
 */
import * as THREE from 'three';
import { BOSS, ENEMIES, RUN, TRIAL } from '../rules/numbers.js';
import { BOSS_COUNT, RUN_STAGES, newRun, runMods } from '../rules/run.js';
import {
  bossHit, bossPhase, canDash, homingTurn, inCircle, inSector, isPerfect, keepInArena, nextBatch, pickMove, recoverSec, regenStamina, slamCount,
  spawnSpot, spiralAngles, teleSec,
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
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const NO_SIZE = new THREE.Vector3(0, 0, 0);
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
    /** 小怪潮里冒着紫烟、还没出来的小傀儡：落点与还要几秒 @type {{ x: number, z: number, t: number }[]} */
    this.pending = [];
    /** @type {any} */
    this.boss = null;
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
    /** @type {{ x: number, y: number, z: number, vx: number, vz: number, t: number, life: number, homing: boolean, dmg: number, r: number,
     *           fooled?: boolean, friendly?: boolean }[]} */
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
    for (const m of [this.shards, this.dots]) { m.count = 0; m.frustumCulled = false; scene.add(m); }
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

  /** 一段小怪潮：小傀儡隔一会儿成批冒出来（落点随机、先冒紫烟），追着人自爆；冒完、清空了这一段就过了 */
  startWave() {
    const W = RUN.wave;
    this.round++;
    this.waveLeft = this.waveN = W.n[Math.min(this.round, W.n.length) - 1];
    this.spawnT = W.first; this.state = 'wave'; this.pending.length = 0;
    const { hud } = this.d;
    hud.bigText(`第 ${this.round} 波`, '#16202b', 1400);
    hud.setHint(this.d.mobile ? '小傀儡追着人自爆：边走边打，别让它们贴身' : '小傀儡追着人自爆：边走边打，别让它们贴身。1、2、3 放天赋，4 召唤，空格闪避');
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
      for (let i = 0; i < b.n; i++) {
        const at = spawnSpot(Math.random, this.p, ARENA_R - 0.8, W.away, [...BLOCK, ...this.pending.map((q) => ({ x: q.x, z: q.z, r: 0.9 }))]);
        this.pending.push({ x: at.x, z: at.z, t: W.warn });
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
    if (this.waveLeft <= 0 && !this.pending.length && !alive) { this.state = 'rest'; this.t = RUN.rest; }
    this.showWave();
  }

  /** 紫烟里冒出一只追人的小傀儡 @param {{ x: number, z: number }} at */
  spawnChaser(at) {
    this.d.enemies.spawnAt('grunt', at.x, at.z, 'chase');
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

  /** 第 n 个 boss 从广场那头现身，吼一声再出招（石甲巨像、火灵还没做，先用寒甲傀儡王顶上） @param {number} n */
  spawnBoss(n) {
    const b = this.d.enemies.spawnAt('boss', BOSS_AT.x, BOSS_AT.z, 'boss');
    this.boss = b;
    this.armor = BOSS.armor; this.phase = 1; this.freezeCd = 0; this.sinceSummon = 0; this.lastMove = '';
    this.state = 'roar'; this.t = BOSS.roarSec;
    const { hud, fx } = this.d;
    fx.burst(new THREE.Vector3(b.pos.x, 0.4, b.pos.z), 'ice', 3, 0.8);
    hud.bigText(ENEMIES.boss.name, '#1f4f7a', 1600);
    hud.setWave(`试炼 ${n}/${BOSS_COUNT}`, PHASE_NAME[1]);
    hud.setHint(this.d.mobile ? '躲开地上的红圈和红扇；冰甲只怕火，先用火打碎它' : '躲开地上的红圈和红扇；冰甲只怕火，先用火打碎它。1、2、3 放天赋，4 召唤，空格闪避');
    this.shown = '';
    this.showBoss();
  }

  /** 这个 boss 碎了：场上的小傀儡一起碎掉、冰锥收起，喘口气进下一段（最后一个 boss 就是打通了） @param {any} e */
  bossDown(e) {
    this.circle.g.visible = this.sector.g.visible = false;
    this.clearBullets();
    for (const o of [...this.d.enemies.list]) if (o.chase) this.d.enemies.kill(o, o.pos);
    this.d.hud.setBoss(null);
    this.d.fx.burst(new THREE.Vector3(e.pos.x, 1.2, e.pos.z), 'ice', 3.2, 0.9);
    if (this.stage + 1 >= RUN_STAGES.length) { this.end(true); return; }
    this.d.hud.bigText(`${ENEMIES.boss.name}碎了`, '#16202b', 1400);
    this.state = 'rest'; this.t = RUN.rest;
  }

  /** 收场（回守关、重开）：玩家放回原处，预警收起 */
  stop() {
    this.on = false; this.fighting = false; this.boss = null;
    this.circle.g.visible = this.sector.g.visible = false;
    this.clearBullets();
    this.dashAt = -Infinity; this.perfectUsed = true; this.glow = 0; this.lastMove = '';
    this.keys.clear(); this.ptr = null; this.stick.x = this.stick.y = 0;
    this.dashT = 0; this.hurtT = 0; this.flash = 0;
    this.stamina = TRIAL.stamina.max; this.sinceDash = Infinity; this.shownSta = ''; this.dashLock = 0; this.slowTele = false;
    this.pending.length = 0;
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
    for (const x of [this.circle, this.sector]) this.scene.remove(x.g);
    this.scene.remove(this.ghost); this.ghostMat.dispose();
    for (const m of [this.shards, this.dots]) { this.scene.remove(m); m.geometry.dispose(); /** @type {THREE.Material} */ (m.material).dispose(); m.dispose(); }
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
   * boss 挨一下（main.js hitEnemy 在结算前调）：按冰甲改这一下，削穿了演一下碎甲。po：这一下带着字诀「破」
   * @template {{ dmg: number, reaction: string, freezeSec: number, push: number, stunSec: number }} R
   * @param {any} e @param {string} el @param {R} r @param {boolean} [po] @returns {R}
   */
  hitBoss(e, el, r, po = false) {
    const h = bossHit({ armor: this.armor, freezeCd: this.freezeCd }, el, r, po);
    this.armor = h.armor;
    if (h.broke) {
      this.d.hud.bigText('冰甲碎了', '#2f6fae', 1100);
      this.d.fx.burst(new THREE.Vector3(e.pos.x, 2, e.pos.z), 'ice', 2.6, 0.9);
    }
    return h.r;
  }

  /** 有敌人没了（enemies 的 onGone）：是 boss 就过了这一段 @param {any} e @param {string} how */
  onGone(e, how) {
    if (e !== this.boss) return;
    this.boss = null;
    if (how === 'kill' && this.fighting) this.bossDown(e);
  }

  /** @param {boolean} won */
  end(won) {
    this.fighting = false;
    this.circle.g.visible = this.sector.g.visible = false;
    this.clearBullets();
    if (won) for (const o of [...this.d.enemies.list]) if (o.chase) this.d.enemies.kill(o, o.pos);
    this.d.hud.setBoss(null);
    (won ? this.d.win : this.d.lose)();
  }

  /** 换阶段：手上的招作废，吼一声；第 2 阶段冰甲重凝，第 3 阶段狂暴 @param {number} ph */
  enterPhase(ph) {
    const b = this.boss;
    this.phase = ph;
    this.circle.g.visible = this.sector.g.visible = false;
    this.state = 'roar'; this.t = BOSS.roarSec * 0.8; this.leanTo = -0.25;
    if (ph === 2) this.armor = BOSS.armor;
    if (ph === 2) this.d.hud.bigText('冰甲重凝', '#2f6fae', 1300);
    else this.d.hud.bigText('狂暴', '#b3261e', 1300);
    this.d.hud.setWave(`试炼 ${this.round}/${BOSS_COUNT}`, PHASE_NAME[ph]);
    this.d.fx.burst(new THREE.Vector3(b.pos.x, 1.2, b.pos.z), 'ice', 3.2, 0.9);
  }

  /** 调试：马上出这一招 @param {import('../rules/trial.js').Move} m */
  force(m) {
    if (!this.fighting || !this.boss) return;
    this.move = m; this.lastMove = m; this.left = m === 'slam' ? slamCount(this.phase) : 1;
    this.startTele();
  }

  recover() {
    this.state = 'recover'; this.t = recoverSec(this.phase, Math.random()); this.leanTo = 0;
  }

  /** 预警开始：红圈落在玩家此刻站的地方；扇形朝玩家；召唤先在落点冒紫烟 */
  startTele() {
    const b = this.boss, second = this.move === 'slam' && this.left < slamCount(this.phase);
    this.state = 'tele';
    // 连砸的第二下快一点；字诀「凝」冻住过它，这一招慢一些
    this.t = this.teleLen = teleSec(this.move, this.phase) * (second ? 0.7 : 1) * (this.slowTele ? RUN.runes.ning.tele : 1);
    this.slowTele = false;
    if (this.move === 'slam') {
      this.target.set(this.p.x, 0, this.p.z);
      this.circle.g.position.set(this.target.x, 0.03, this.target.z);
      this.circle.g.scale.set(BOSS.slam.r, 1, BOSS.slam.r);
      this.circle.g.visible = true;
      this.leanTo = -0.22;
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
      const n = BOSS.summon.n[this.phase - 1], a0 = Math.atan2(this.p.z - b.pos.z, this.p.x - b.pos.x);
      this.spots = Array.from({ length: n }, (_, i) => keepInArena(
        { x: b.pos.x + Math.cos(a0 + (i - (n - 1) / 2) * 0.8) * 2.4, z: b.pos.z + Math.sin(a0 + (i - (n - 1) / 2) * 0.8) * 2.4 }, BLOCK, ARENA_R, 0.3));
      this.leanTo = -0.32;
    } else {
      this.leanTo = this.move === 'homing' ? -0.3 : -0.15;   // 冰锥：后仰蓄力；旋转弹幕：微微后仰，原地转起来
    }
  }

  /** 放一颗冰锥 @param {number} x @param {number} y @param {number} z @param {number} vx @param {number} vz @param {{ life: number, dmg: number, r: number, homing?: boolean }} o */
  fire(x, y, z, vx, vz, o) {
    if (this.bullets.length >= MAX_BULLETS) return;
    this.bullets.push({ x, y, z, vx, vz, t: 0, life: o.life, homing: !!o.homing, dmg: o.dmg, r: o.r });
  }

  clearBullets() { this.bullets.length = 0; this.shards.count = this.dots.count = 0; }

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
        if (gone) {   // 撞碎：溅几片冰
          for (let k = 0; k < 10; k++) {
            particles.emit(b.x, b.y, b.z, rand(-3, 3), rand(0.5, 3), rand(-3, 3), rand(0.25, 0.5), rand(0.05, 0.1), [1.4, 1.8, 2.2], [0.3, 0.55, 0.9], { drag: 2, grav: -8 });
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
      // 身后拖一道冷光：追踪的拖得密，看得出它在拐弯；旋转弹幕一轮几十颗，拖得稀，不然连成一片白
      if (Math.random() < dt * (b.homing ? 40 : 4)) {
        particles.emit(b.x, b.y, b.z, -b.vx * 0.1, 0.2, -b.vz * 0.1, rand(0.25, 0.4), rand(0.1, 0.18), [1.4, 1.9, 2.4], [0.3, 0.5, 0.9], { alpha: 0.6, drag: 3 });
      }
    }
    const n = this.bullets.length;
    for (let i = 0; i < n; i++) {
      const b = this.bullets[i];
      this._bd.set(b.vx, 0, b.vz).normalize();
      this._q.setFromUnitVectors(Z_AXIS, this._bd);
      this.shards.setMatrixAt(i, this._m4.compose(this._bp.set(b.x, b.y, b.z), this._q, this._s));
      // 弹回去的不伤人，地上不画红点
      this.dots.setMatrixAt(i, this._m4.compose(this._bp.set(b.x, 0.035, b.z), this._q.identity(), b.friendly ? NO_SIZE : this._s));
    }
    this.shards.count = this.dots.count = n;
    this.shards.instanceMatrix.needsUpdate = this.dots.instanceMatrix.needsUpdate = true;
  }

  /** 预警到点：判定、演出 */
  resolve() {
    const b = this.boss, { fx, particles } = this.d;
    if (this.move === 'slam') {
      this.circle.g.visible = false;
      if (inCircle(this.p, this.target, BOSS.slam.r, BODY)) this.hurt(BOSS.slam.dmg);
      else this.checkPerfect((q) => inCircle(q, this.target, BOSS.slam.r, BODY));
      fx.burst(new THREE.Vector3(this.target.x, 0.3, this.target.z), 'ice', BOSS.slam.r, 0.7);
      fx.crack(this.target, BOSS.slam.r * 0.8);
      this.kick = 0.45;
      if (--this.left > 0) { this.startTele(); return; }
      this.recover();
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
    if (!this.fighting) return;
    this.runT += dt;
    if (this.state === 'wave') { this.updateWave(dt); return; }
    if (this.state === 'rest') { if ((this.t -= dt) <= 0) this.next(); return; }   // 一段打完喘口气
    const b = this.boss;
    if (!b) return;
    this.updateBullets(dt);   // 冰锥照飞，boss 冻住了也一样
    if (!this.fighting) return;   // 被冰锥打死了
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
          const v = ENEMIES.boss.speed * (this.phase >= 3 ? BOSS.enrageSpeed : 1) * dt;
          b.pos.x += (dx / dist) * v; b.pos.z += (dz / dist) * v;
          keepInArena(b.pos, BLOCK, ARENA_R - 0.3, BOSS_BODY);
          b.moving = true;
        }
        if (this.t <= 0) {
          const minions = this.d.enemies.list.filter((o) => o.chase).length;
          this.move = pickMove(this.phase, { dist, minions, sinceSummon: this.sinceSummon, last: this.lastMove }, Math.random());
          this.lastMove = this.move;
          this.left = this.move === 'slam' ? slamCount(this.phase) : 1;
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
      }
    }
    // 出招的身段：蓄力后仰、砸下去前扑一下
    this.kick = Math.max(0, this.kick - dt * 2.5);
    b.lean += (this.leanTo + this.kick - b.lean) * Math.min(1, dt * 12);
    if (b.armorMesh) b.armorMesh.visible = this.armor > 0;
    this.d.enemies.armorMat.opacity = 0.2 + 0.4 * (this.armor / BOSS.armor);
    this.showBoss();
  }

  /** 顶上的 boss 血条（数变了才改界面） */
  showBoss() {
    const b = this.boss;
    if (!b) return;
    const key = `${Math.ceil(b.hp)}|${Math.ceil(this.armor)}|${this.phase}`;
    if (key === this.shown) return;
    this.shown = key;
    this.d.hud.setBoss({ name: ENEMIES.boss.name, phase: `${PHASE_NAME[this.phase]}${this.armor > 0 ? ' · 冰甲' : ''}`,
      hp: b.hp, max: b.maxHp, armor: this.armor, armorMax: BOSS.armor });
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
