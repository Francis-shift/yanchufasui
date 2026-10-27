// @ts-check
/**
 * 试炼模式（灰盒，设计文档第 2 节"试炼模式"）：在山门广场上走位躲 boss 的招。
 * 战中不打字：WASD / 方向键走位、空格闪避、1～3 放天赋、4 召唤（手机：在画面上拖动走位，轻点画面或点"闪"闪避）；战前可以给按钮写咒。
 * 规则（冰甲、换阶段、挑招、判定、走位边界）在 rules/trial.js；这里管玩家走位与受伤、boss 的动作、地上的预警。
 * 施法者的位置就是 CASTER_POS：玩家走到哪，法术就从哪放出（同步脚下法阵和特效起点）；回到守关时放回原处。
 */
import * as THREE from 'three';
import { BOSS, ENEMIES, TRIAL } from '../rules/numbers.js';
import { bossHit, bossPhase, inCircle, inSector, keepInArena, pickMove, recoverSec, slamCount, teleSec } from '../rules/trial.js';
import { CASTER_POS, CORE_POS, OBSTACLES, PLAZA_R } from '../world/layout.js';
import { rand } from '../fx/common.js';

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
/** @type {Record<string, [number, number]>} 键 → 屏幕上的方向（右、上） */
const MOVE_KEYS = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };

export class Trial {
  /**
   * @param {THREE.Scene} scene
   * @param {{ enemies: import('../actors/enemies.js').Enemies, fx: import('../fx/spells.js').SpellFx,
   *           particles: import('../fx/particles.js').Particles, hud: import('../ui/hud.js').Hud,
   *           caster: THREE.Object3D, origins: THREE.Vector3[], canvas: HTMLElement, mobile: boolean,
   *           floatText: (p: THREE.Vector3, text: string, color: string) => void, win: () => void, lose: () => void }} d
   *   origins：法术起点（施法者胸口高度），跟着玩家走
   */
  constructor(scene, d) {
    this.scene = scene; this.d = d;
    this.on = false;          // 在试炼模式里（含战前准备）
    this.fighting = false;    // 已开战
    this.hp = TRIAL.hp;
    this.p = HOME.clone();
    this.face = new THREE.Vector3(0, 0, -1);   // 最近一次走的方向：原地闪避朝这边
    /** @type {Set<string>} */
    this.keys = new Set();
    this.stick = { x: 0, y: 0 };
    /** @type {{ id: number, x: number, y: number, t: number, moved: boolean } | null} */
    this.ptr = null;
    this.dashT = 0; this.dashCd = 0; this.dashDir = new THREE.Vector3(); this.hurtT = 0; this.flash = 0;
    /** @type {any} */
    this.boss = null;
    this.armor = 0; this.phase = 1; this.freezeCd = 0;
    this.state = 'idle'; this.t = 0; this.teleLen = 1; this.move = /** @type {'slam' | 'sweep' | 'summon'} */ ('slam');
    this.left = 0; this.sinceSummon = 0; this.spinFrom = 0;
    this.target = new THREE.Vector3(); this.sweepDir = new THREE.Vector3();
    /** @type {{ x: number, z: number }[]} */
    this.spots = [];
    this.leanTo = 0; this.kick = 0; this.shown = '';
    this.robe = /** @type {THREE.MeshStandardMaterial} */ (/** @type {THREE.Mesh} */ (d.caster.children[0]).material);
    this._f = new THREE.Vector3(); this._r = new THREE.Vector3(); this._m = new THREE.Vector3();

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

  /** 拖动画面走位、轻点闪避 @param {HTMLElement} canvas */
  attach(canvas) {
    const down = (/** @type {PointerEvent} */ e) => {
      if (!this.on || this.ptr) return;
      this.ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      canvas.setPointerCapture?.(e.pointerId);
    };
    const move = (/** @type {PointerEvent} */ e) => {
      const p = this.ptr;
      if (!p || e.pointerId !== p.id) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y, l = Math.hypot(dx, dy);
      if (l > 10) p.moved = true;
      const k = l < 10 ? 0 : Math.min(1, l / 60) / l;   // 拖 60 像素就是全速
      this.stick.x = dx * k; this.stick.y = -dy * k;
    };
    const up = (/** @type {PointerEvent} */ e) => {
      const p = this.ptr;
      if (!p || e.pointerId !== p.id) return;
      if (!p.moved && performance.now() - p.t < 250) this.dash();
      this.ptr = null; this.stick.x = this.stick.y = 0;
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
    this.d.canvas.style.touchAction = 'none';
    const { hud } = this.d;
    hud.setTrial(true, false);
    hud.setCoreName('气血');
    hud.setCore(this.hp, TRIAL.hp);
    hud.setWave('试炼', '战前准备');
    hud.setHint(this.d.mobile
      ? '战前：点按钮右上角的笔给按钮写一句咒（开战后不能写）。在画面上拖动走位，轻点画面闪避；准备好了点「开战」'
      : '战前：点按钮右上角的笔给按钮写一句咒（开战后不能写）。WASD / 方向键走位，空格闪避；准备好了点「开战」或按回车');
    hud.setDashReady(true);
  }

  /** 开战：boss 从广场那头现身，吼一声再出招 */
  engage() {
    if (!this.on || this.fighting) return;
    this.fighting = true;
    const b = this.d.enemies.spawnAt('boss', BOSS_AT.x, BOSS_AT.z, 'boss');
    this.boss = b;
    this.armor = BOSS.armor; this.phase = 1; this.freezeCd = 0; this.sinceSummon = 0;
    this.state = 'roar'; this.t = BOSS.roarSec;
    const { hud, fx } = this.d;
    fx.burst(new THREE.Vector3(b.pos.x, 0.4, b.pos.z), 'ice', 3, 0.8);
    hud.bigText(ENEMIES.boss.name, '#1f4f7a', 1600);
    hud.setTrial(true, true);
    hud.setWave('试炼', PHASE_NAME[1]);
    hud.setHint(this.d.mobile ? '躲开地上的红圈和红扇；冰甲只怕火，先用火打碎它' : '躲开地上的红圈和红扇；冰甲只怕火，先用火打碎它。1、2、3 放天赋，4 召唤，空格闪避');
    this.showBoss();
  }

  /** 收场（回守关、重开）：玩家放回原处，预警收起 */
  stop() {
    this.on = false; this.fighting = false; this.boss = null;
    this.circle.g.visible = this.sector.g.visible = false;
    this.keys.clear(); this.ptr = null; this.stick.x = this.stick.y = 0;
    this.dashT = 0; this.dashCd = 0; this.hurtT = 0; this.flash = 0;
    this.p.copy(HOME); this.face.set(0, 0, -1);
    this.sync();
    this.d.caster.visible = true;
    this.robe.emissive.setRGB(0, 0, 0);
    this.d.canvas.style.touchAction = '';
    this.d.hud.setTrial(false, false);
    this.d.hud.setCoreName('阵眼');
    this.shown = '';
  }

  dispose() { this.stop(); this.unbind(); for (const x of [this.circle, this.sector]) this.scene.remove(x.g); }

  // ---------------------------------------------------------------- 玩家
  dash() {
    if (!this.on || this.dashCd > 0 || this.hp <= 0) return;
    const mv = this.input();
    this.dashDir.copy(mv.lengthSq() > 0.01 ? mv.normalize() : this.face);
    this.dashT = TRIAL.dash.sec; this.dashCd = TRIAL.dash.cd;
    this.d.hud.setDashReady(false);
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
    if (this.dashCd > 0) { this.dashCd -= dt; if (this.dashCd <= 0) this.d.hud.setDashReady(true); }
    const block = this.boss ? [...BLOCK, { x: this.boss.pos.x, z: this.boss.pos.z, r: BOSS_BODY }] : BLOCK;
    keepInArena(this.p, block, ARENA_R, BODY);
    this.sync();
    // 挨打后一小会儿不再受伤：身影一闪一闪；袍子泛红一下
    if (this.hurtT > 0) this.hurtT -= dt;
    this.d.caster.visible = this.hurtT <= 0 || Math.floor(this.hurtT * 16) % 2 === 0;
    this.flash = Math.max(0, this.flash - dt * 3);
    this.robe.emissive.setRGB(0.9 * this.flash, 0.08 * this.flash, 0.04 * this.flash);
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
    if (this.dashT > 0) { this.d.floatText(at, '闪', '#cfe8ff'); return false; }
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
   * boss 挨一下（main.js hitEnemy 在结算前调）：按冰甲改这一下，削穿了演一下碎甲。
   * @template {{ dmg: number, reaction: string, freezeSec: number, push: number, stunSec: number }} R
   * @param {any} e @param {string} el @param {R} r @returns {R}
   */
  hitBoss(e, el, r) {
    const h = bossHit({ armor: this.armor, freezeCd: this.freezeCd }, el, r);
    this.armor = h.armor;
    if (h.broke) {
      this.d.hud.bigText('冰甲碎了', '#2f6fae', 1100);
      this.d.fx.burst(new THREE.Vector3(e.pos.x, 2, e.pos.z), 'ice', 2.6, 0.9);
    }
    return h.r;
  }

  /** 有敌人没了（enemies 的 onGone）：是 boss 就赢了 @param {any} e @param {string} how */
  onGone(e, how) {
    if (e !== this.boss) return;
    this.boss = null;
    if (how === 'kill') this.end(true);
  }

  /** @param {boolean} won */
  end(won) {
    this.fighting = false;
    this.circle.g.visible = this.sector.g.visible = false;
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
    this.d.hud.setWave('试炼', PHASE_NAME[ph]);
    this.d.fx.burst(new THREE.Vector3(b.pos.x, 1.2, b.pos.z), 'ice', 3.2, 0.9);
  }

  recover() {
    this.state = 'recover'; this.t = recoverSec(this.phase, Math.random()); this.leanTo = 0;
  }

  /** 预警开始：红圈落在玩家此刻站的地方；扇形朝玩家；召唤先在落点冒紫烟 */
  startTele() {
    const b = this.boss, second = this.move === 'slam' && this.left < slamCount(this.phase);
    this.state = 'tele';
    this.t = this.teleLen = teleSec(this.move, this.phase) * (second ? 0.7 : 1);   // 连砸的第二下快一点
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
    } else {
      const n = BOSS.summon.n[this.phase - 1], a0 = Math.atan2(this.p.z - b.pos.z, this.p.x - b.pos.x);
      this.spots = Array.from({ length: n }, (_, i) => keepInArena(
        { x: b.pos.x + Math.cos(a0 + (i - (n - 1) / 2) * 0.8) * 2.4, z: b.pos.z + Math.sin(a0 + (i - (n - 1) / 2) * 0.8) * 2.4 }, BLOCK, ARENA_R, 0.3));
      this.leanTo = -0.32;
    }
  }

  /** 预警到点：判定、演出 */
  resolve() {
    const b = this.boss, { fx, particles } = this.d;
    if (this.move === 'slam') {
      this.circle.g.visible = false;
      if (inCircle(this.p, this.target, BOSS.slam.r, BODY)) this.hurt(BOSS.slam.dmg);
      fx.burst(new THREE.Vector3(this.target.x, 0.3, this.target.z), 'ice', BOSS.slam.r, 0.7);
      fx.crack(this.target, BOSS.slam.r * 0.8);
      this.kick = 0.45;
      if (--this.left > 0) { this.startTele(); return; }
      this.recover();
    } else if (this.move === 'sweep') {
      this.sector.g.visible = false;
      if (inSector(this.p, b.pos, this.sweepDir, SWEEP_HALF, BOSS.sweep.r, BODY)) this.hurt(BOSS.sweep.dmg);
      const a0 = Math.atan2(this.sweepDir.z, this.sweepDir.x);
      for (let i = 0; i < 90; i++) {
        const a = a0 + rand(-SWEEP_HALF, SWEEP_HALF), r = rand(1.2, BOSS.sweep.r), s = rand(3, 7);
        particles.emit(b.pos.x + Math.cos(a) * r, rand(0.2, 1.0), b.pos.z + Math.sin(a) * r, -Math.sin(a) * s, rand(0.3, 1.5), Math.cos(a) * s,
          rand(0.35, 0.7), rand(0.08, 0.18), [0.8, 1.3, 1.9], [0.2, 0.45, 0.9], { drag: 2.5 });
      }
      fx.shake = Math.max(fx.shake, 0.35);
      this.state = 'spin'; this.t = 0.28; this.spinFrom = a0 - SWEEP_HALF;   // 身子跟着扫过去
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

  /** 每帧（游戏时间） @param {number} dt @param {THREE.Camera} camera */
  update(dt, camera) {
    if (!this.on) return;
    if (this.hp > 0) this.movePlayer(dt, camera);
    const b = this.boss;
    if (!this.fighting || !b) return;
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
          this.move = pickMove(this.phase, { dist, minions, sinceSummon: this.sinceSummon }, Math.random());
          this.left = this.move === 'slam' ? slamCount(this.phase) : 1;
          this.startTele();
        }
      } else if (this.state === 'tele') {
        const k = 1 - Math.max(0, this.t) / this.teleLen;
        const fill = this.move === 'slam' ? this.circle.fill : this.sector.fill;
        fill.scale.set(Math.max(0.001, k), Math.max(0.001, k), 1);
        if (this.move === 'slam') turn(this.target.x - b.pos.x, this.target.z - b.pos.z, 6);
        else if (this.move === 'sweep') turn(this.sweepDir.x, this.sweepDir.z, 8);
        else if (Math.random() < dt * 30) {
          const s = this.spots[Math.floor(Math.random() * this.spots.length)];
          this.d.particles.emit(s.x + rand(-0.3, 0.3), 0.1, s.z + rand(-0.3, 0.3), 0, rand(0.8, 1.6), 0, rand(0.5, 0.8), rand(0.12, 0.22),
            [0.9, 0.45, 1.5], [0.25, 0.08, 0.4], { alpha: 0.35, drag: 1 });
        }
        if (this.t <= 0) this.resolve();
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

  /** 天色（world/invasion.js）用：这一阶段打掉了几成 */
  progress() {
    const b = this.boss;
    if (!b) return 0;
    const k = b.hp / b.maxHp, [p2, p3] = BOSS.phases;
    const [hi, lo] = this.phase === 1 ? [1, p2] : this.phase === 2 ? [p2, p3] : [p3, 0];
    return Math.min(1, Math.max(0, (hi - k) / (hi - lo)));
  }
}
