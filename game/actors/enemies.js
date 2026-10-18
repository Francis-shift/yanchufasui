// @ts-check
/**
 * 傀儡（方块版）：沿石阶或索桥一跳一跳地走向阵眼。
 * 会被冻住（停步、发蓝）、点燃（持续掉血）、被风推走（脚下没地面就坠入云海）；
 * 死了就碎成方块由物理引擎炸开。碰到阵眼扣阵眼的血。
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { ELEMENTS, ENEMIES } from '../rules/numbers.js';
import { CASTER_POS, CORE_POS, groundHeightAt, PATHS } from '../world/layout.js';
import { col, PALETTE, rand } from '../fx/common.js';

const CORE_FRONT = new THREE.Vector3(CORE_POS.x, 0, CORE_POS.z - 2.2);

/** 路径长度表，便于按走过的距离取位置 */
function pathInfo(pts) {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
  return { pts, lens, total: lens[lens.length - 1] };
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
   * @param {{ onCoreHit: (dmg: number) => void, onGone: (e: any, how: 'kill' | 'fall' | 'core') => void,
   *           floatText: (p: THREE.Vector3, text: string, color: string) => void }} hooks
   */
  constructor(scene, world, particles, hooks) {
    this.scene = scene; this.world = world; this.particles = particles; this.hooks = hooks;
    /** @type {any[]} */
    this.list = [];
    /** @type {{ mesh: THREE.Mesh, mat: THREE.Material, body: CANNON.Body, t: number }[]} */
    this.debris = [];
    this.paths = PATHS.map(pathInfo);
    this.geo = {
      torso: new THREE.BoxGeometry(0.62, 0.7, 0.4), head: new THREE.BoxGeometry(0.42, 0.42, 0.42),
      arm: new THREE.BoxGeometry(0.16, 0.6, 0.16), leg: new THREE.BoxGeometry(0.18, 0.42, 0.18),
      eye: new THREE.BoxGeometry(0.08, 0.06, 0.02), shard: new THREE.BoxGeometry(0.22, 0.22, 0.22),
      shield: new THREE.BoxGeometry(0.9, 1.0, 0.1), bar: new THREE.PlaneGeometry(0.8, 0.07),
    };
    this.eyeMat = new THREE.MeshBasicMaterial({ color: col(PALETTE.arcane.primary, 2.2) });
    this.barBg = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.6, depthTest: false });
    this._p = new THREE.Vector3(); this._d = new THREE.Vector3();
  }

  /** @param {'grunt' | 'shield' | 'colossus'} type @param {number} pathIndex */
  spawn(type, pathIndex) {
    const spec = ENEMIES[type];
    const mat = new THREE.MeshStandardMaterial({ color: type === 'shield' ? 0x6f6a62 : 0x8b7355, roughness: 0.8 });
    const g = new THREE.Group();
    const part = (geo, x, y, z, m = /** @type {THREE.Material} */ (mat)) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
    part(this.geo.torso, 0, 0.77, 0); part(this.geo.head, 0, 1.35, 0);
    part(this.geo.arm, -0.42, 0.8, 0); part(this.geo.arm, 0.42, 0.8, 0);
    part(this.geo.leg, -0.16, 0.21, 0); part(this.geo.leg, 0.16, 0.21, 0);
    part(this.geo.eye, -0.1, 1.4, 0.215, this.eyeMat); part(this.geo.eye, 0.1, 1.4, 0.215, this.eyeMat);
    if (type === 'shield') part(this.geo.shield, 0, 0.8, 0.42);
    const scale = type === 'colossus' ? 2.2 : type === 'shield' ? 1.15 : 0.9;
    g.scale.setScalar(scale);
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
      id: `e${++seq}`, type, spec, hp: spec.hp, maxHp: spec.hp, group: g, mat, bar, fill, fillMat, scale,
      path: info, s: 0, lateral: rand(-0.7, 0.7), mode: 'walk', pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      dir: new THREE.Vector3(0, 0, 1), frozen: 0, burn: 0, hop: rand(0, Math.PI * 2), lastHitEl: '', squash: 0,
    };
    pointAt(info, 0, e.pos, e.dir);
    this.list.push(e);
    return e;
  }

  get alive() { return this.list.length; }

  /** 给裁决器看的样子：位置、血量、离阵眼多远 */
  views() {
    return this.list.map((e) => ({
      id: e.id, x: e.pos.x, z: e.pos.z, hp: e.hp,
      distToCore: e.mode === 'walk' ? e.path.total - e.s : e.pos.distanceTo(CORE_FRONT),
    }));
  }

  /** @param {string} id */
  get(id) { return this.list.find((e) => e.id === id) || null; }

  /** 身体中心（瞄准用） */
  aimPoint(e, out = new THREE.Vector3()) { return out.copy(e.pos).setY(e.pos.y + 0.8 * e.scale); }

  /**
   * 结算一次命中（伤害与效果已由 damageTo 算好）。
   * @param {any} e
   * @param {{ dmg: number, freezeSec: number, burnSec: number, unfreeze: boolean, push: number, reaction: string }} r
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
    if (r.push && e.mode !== 'fall') {
      // 方向：离爆心向外（四成）+ 背离施法者（六成）——「吹下悬崖」是往外吹，不是原地打转
      const d = this._d.copy(e.pos).sub(from).setY(0);
      if (d.lengthSq() > 1e-4) d.normalize();
      const away = this._p.copy(e.pos).sub(CASTER_POS).setY(0).normalize();
      d.multiplyScalar(0.4).addScaledVector(away, 0.6);
      if (d.lengthSq() < 1e-4) d.set(0, 0, -1);
      d.normalize();
      e.vel.set(d.x * r.push, 1.5, d.z * r.push);
      e.mode = 'slide';
    }
    this.hooks.floatText(this.aimPoint(e).setY(e.pos.y + 1.7 * e.scale),
      (r.reaction ? r.reaction + ' ' : '') + Math.round(r.dmg), r.reaction ? '#ffe27a' : '#ffffff');
    if (e.hp <= 0) this.kill(e, from);
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

  kill(e, from) {
    this.shatter(e, from);
    this.remove(e, 'kill');
  }

  /** @param {any} e @param {'kill' | 'fall' | 'core'} how */
  remove(e, how) {
    const i = this.list.indexOf(e);
    if (i < 0) return;
    this.list.splice(i, 1);
    this.scene.remove(e.group, e.bar);
    e.mat.dispose(); e.fillMat.dispose();
    this.hooks.onGone(e, how);
  }

  /** 碎成同色方块，物理引擎炸开 */
  shatter(e, from) {
    const c = e.mat.color.clone();
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
      const frozenK = e.frozen > 0 ? 1 : 0, burnK = e.burn > 0 ? 0.5 + Math.random() * 0.5 : 0;
      e.mat.emissive.setRGB(0.15 * frozenK + 0.9 * burnK, 0.45 * frozenK + 0.3 * burnK, 1.0 * frozenK + 0.05 * burnK);
      e.mat.emissiveIntensity = frozenK ? 0.55 : burnK ? 0.6 : 0;

      if (e.mode === 'walk') {
        if (!e.frozen) e.s += e.spec.speed * dt;
        if (e.s >= e.path.total) { this.hooks.onCoreHit(e.spec.coreDmg); this.remove(e, 'core'); continue; }
        pointAt(e.path, e.s, e.pos, e.dir);
        const side = this._d.set(e.dir.z, 0, -e.dir.x);
        const fadeLat = Math.min(1, (e.path.total - e.s) / 3);         // 快到阵眼时收拢到中线
        e.pos.addScaledVector(side, e.lateral * fadeLat);
        e.pos.y = groundHeightAt(e.pos.x, e.pos.z) ?? e.pos.y;
        if (!e.frozen) {
          const before = Math.floor(e.hop / Math.PI);
          e.hop += dt * e.spec.speed * 4.2;
          if (Math.floor(e.hop / Math.PI) !== before) this.land(e);   // 正弦过零 = 一跳落地
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
            // 站稳后直接朝阵眼走
            e.path = pathInfo([e.pos.clone(), CORE_FRONT.clone()]);
            e.s = 0; e.mode = 'walk'; e.lateral = 0;
          }
        }
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
      // 程序动画（不用骨骼，傀儡本来就僵）：一跳一跳，空中拉长、落地压扁，前倾，每步左右晃
      const walking = e.mode === 'walk' && !e.frozen;
      const air = walking ? Math.abs(Math.sin(e.hop)) : 0;
      const hopY = air * 0.22;
      e.squash = Math.max(0, e.squash - dt / 0.14);
      const sq = e.squash * e.squash;
      const sy = 1 + 0.07 * air - 0.2 * sq, sxz = 1 + 0.12 * sq - 0.03 * air;
      e.group.scale.set(e.scale * sxz, e.scale * sy, e.scale * sxz);
      e.group.position.set(e.pos.x, e.pos.y + hopY, e.pos.z);
      if (e.mode === 'walk') {
        const sway = walking ? Math.sin(e.hop * 0.5) * 0.09 : 0;          // 左一步右一步
        e.group.rotation.set(walking ? 0.1 + 0.06 * air : 0, Math.atan2(e.dir.x, e.dir.z), sway);
      }
      // 血条：受过伤才显示，始终朝向镜头
      e.bar.visible = e.hp < e.maxHp;
      if (e.bar.visible) {
        e.bar.position.set(e.pos.x, e.pos.y + 1.85 * e.scale + hopY, e.pos.z);
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
    for (const e of [...this.list]) { this.scene.remove(e.group, e.bar); e.mat.dispose(); e.fillMat.dispose(); }
    this.list.length = 0;
    for (const d of this.debris) { this.world.removeBody(d.body); this.scene.remove(d.mesh); d.mat.dispose(); }
    this.debris.length = 0;
  }
}
