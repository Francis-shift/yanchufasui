// @ts-check
/**
 * 融合法术的样子（伤害在 main.js 结算；10-27 照本人给的参考图把两种都改成翻滚的火云，见 fx/flame.js）：
 *   - 火卷风（先风后火）：一根螺旋往上卷的火柱，下面白黄、往上烧红、顶上冒黑烟，从目标处往外卷 3 秒，
 *     碰到的敌人被点着、卷起来甩出去；走过的地上留一路火；
 *   - 豪火灭却（先火后风，10-27 由"烈焰冲击"改名）：从施法者身前推出一整片往前翻滚的火浪，越推越宽，
 *     浪头上窜着火舌、顶上压着黑烟、两侧贴地翻白烟；浪头扫到谁才烧谁。
 */
import * as THREE from 'three';
import { PALETTE, rand, scaleArr } from './common.js';
import { FlameClouds } from './flame.js';
import { SOLIDS, groundHeightAt } from '../world/layout.js';
import { BEAM, TORNADO } from '../rules/numbers.js';
import { waveHalfW } from '../rules/fusion.js';

/** 火浪推到头以后还烧多久（秒）：火团冷成烟、慢慢散掉 */
const WAVE_LINGER = 1.3;
/** 火卷风转多快（弧度/秒）：配上火团每秒升 5 米左右，螺旋一圈约 5 米高 */
const SWIRL_W = 6;

export class FusionFx {
  /**
   * @param {import('./spells.js').SpellFx} fx @param {import('./particles.js').Particles} particles
   * @param {number} [density] 火云团数的倍数（手机流畅档给小一点）
   */
  constructor(fx, particles, density = 1) {
    this.fx = fx; this.p = particles;
    this.clouds = new FlameClouds(fx.scene, density, SOLIDS);
    this.k = density;
    /** @type {{ pos: THREE.Vector3, dir: THREE.Vector3, t: number, hit: Set<string>, step: any, acc: number }[]} */
    this.tornadoes = [];
    /** @type {{ from: THREE.Vector3, dir: THREE.Vector3, side: THREE.Vector3, t: number, hit: Set<string>, step: any, done: number, scorched: number }[]} */
    this.waves = [];
  }

  /**
   * 放一根火卷风，返回它（main 每帧拿它的位置判断碰到了谁）。
   * @param {THREE.Vector3} at 起点 @param {THREE.Vector3} dir 往哪边卷（水平单位向量）
   */
  tornado(at, dir, step) {
    const tw = { pos: at.clone(), dir: dir.clone(), t: 0, hit: new Set(), step, acc: 0 };
    this.tornadoes.push(tw);
    this.fx.shake = Math.max(this.fx.shake, 0.3);
    this.fx.pulseDim(0.6, 2.4);   // 融合是招牌：火卷风卷着走的这几秒压暗
    return tw;
  }

  /**
   * 豪火灭却：推出一片火浪，返回它（main 每帧按浪头推到哪判断烧到了谁）。
   * @param {THREE.Vector3} from 施法者身前、胸口高度 @param {THREE.Vector3} dir 水平单位向量
   */
  beam(from, dir, step) {
    const g = groundHeightAt(from.x, from.z) ?? 0;
    const wv = { from: new THREE.Vector3(from.x, g, from.z), dir: dir.clone(), side: new THREE.Vector3(-dir.z, 0, dir.x),
      t: 0, hit: new Set(), step, done: 0, scorched: 0 };
    this.waves.push(wv);
    this.fx.shake = Math.max(this.fx.shake, 0.55);
    this.fx.hitStop = Math.max(this.fx.hitStop, 0.06);
    this.fx.pulseDim(0.65, 1.6);
    this.fx.impact(from.clone().addScaledVector(dir, 3), 0.8);
    // 出手那一下：身前先炸开一团
    for (let i = Math.round(14 * this.k); i > 0; i--) {
      const u = rand(-1, 1);
      this.clouds.puff('fire', { x: wv.from.x + dir.x * rand(0.3, 1.5) + wv.side.x * u * 1.2, y: g + rand(0.6, 1.8), z: wv.from.z + dir.z * rand(0.3, 1.5) + wv.side.z * u * 1.2,
        vx: dir.x * rand(4, 8), vy: rand(0.5, 2), vz: dir.z * rand(4, 8), life: rand(0.5, 0.8), r0: rand(0.5, 0.8), r1: rand(1.4, 1.9), heat: 1.05, cool: 1.4, drag: 2, rise: 1 });
    }
    return wv;
  }

  /**
   * 火浪推过 [s0, s1] 这一段：沿浪头铺火团（中间热、两边冷）、顶上窜火舌、再上面压黑烟、两侧贴地翻白烟、火星往前飞。
   * @param {{ from: THREE.Vector3, dir: THREE.Vector3, side: THREE.Vector3 }} wv @param {number} s0 @param {number} s1
   */
  waveSegment(wv, s0, s1) {
    const { dir, side, from } = wv, C = this.clouds, fire = PALETTE.fire, k = this.k;
    const at = (/** @type {number} */ s, /** @type {number} */ lat) => ({ x: from.x + dir.x * s + side.x * lat, z: from.z + dir.z * s + side.z * lat });
    const ds = s1 - s0;
    const count = (/** @type {number} */ perM) => { const x = perM * ds * k; return Math.floor(x) + (Math.random() < x % 1 ? 1 : 0); };
    const sMid = (s0 + s1) / 2, hw = waveHalfW(sMid), grow = 0.8 + 0.4 * (sMid / BEAM.len);
    for (let i = count(3.4 * hw); i > 0; i--) {   // 火墙本体：越往后浪越宽，团越多越大
      // 横向位置再抖一下、边上的团小一些矮一些、中间的垒得高：均匀撒在 ±半宽里那版，两侧齐成一道竖直的直边，整片像个方块（10-27 截图）
      const s = rand(s0, s1), u = rand(-1, 1), q = at(s, u * hw * rand(0.7, 1.1)), r0 = rand(0.75, 1.15) * grow * (1 - 0.35 * Math.abs(u));
      // 往前的冲劲越近尽头越小：火团会再往前飘 v/drag 米，不收的话画面比判定远 4 米，还穿进靶场尽头的石门（10-27 截图）
      const fwd = BEAM.speed * rand(0.32, 0.62) * Math.min(1, 0.25 + (BEAM.len - s) / 5);
      C.puff('fire', { x: q.x, y: from.y + r0 * 0.5 + rand(0, 1.2) + (1 - Math.abs(u)) * rand(0, 1.4), z: q.z,
        vx: dir.x * fwd + side.x * u * 2.4, vy: rand(0.5, 2), vz: dir.z * fwd + side.z * u * 2.4,
        life: rand(0.85, 1.35), r0, r1: r0 * rand(1.9, 2.5), heat: 1.02 - 0.38 * Math.abs(u) - rand(0, 0.12), cool: 0.75, drag: 1.5, rise: 1.4 });   // 冷得慢：1.3 那版推到一半就整片发红发褐
    }
    for (let i = count(2.2); i > 0; i--) {   // 火舌：顶上往上窜的细长火苗
      const s = rand(s0, s1), u = rand(-0.85, 0.85), q = at(s, u * hw);
      C.puff('fire', { x: q.x, y: from.y + rand(2.2, 3.4), z: q.z, vx: dir.x * BEAM.speed * 0.45, vy: rand(3.5, 6), vz: dir.z * BEAM.speed * 0.45,
        life: rand(0.35, 0.55), r0: rand(0.32, 0.48), r1: rand(0.55, 0.8), aspect: rand(1.8, 2.6), spin: 0, heat: 1, cool: 1.6, drag: 1 });
    }
    for (let i = count(1.3); i > 0; i--) {   // 黑烟：压在浪顶和背后，慢慢往上胀
      const s = rand(s0, s1) - rand(0.5, 2), q = at(s, rand(-0.8, 0.8) * hw);
      C.puff('smoke', { x: q.x, y: from.y + rand(3.6, 5), z: q.z, vx: dir.x * rand(1, 3), vy: rand(1.4, 2.6), vz: dir.z * rand(1, 3),
        life: rand(1.9, 2.7), r0: rand(1, 1.4), r1: rand(2.8, 3.6), heat: 0, cool: 0, alpha: 0.82, drag: 0.8, spin: rand(-0.4, 0.4) });
    }
    for (let i = count(0.9); i > 0; i--) {   // 白烟：两侧贴地往外翻
      const s = rand(s0, s1), u = Math.random() < 0.5 ? -1 : 1, q = at(s, u * hw * rand(0.85, 1.1));
      C.puff('smoke', { x: q.x, y: from.y + rand(0.2, 0.7), z: q.z, vx: side.x * u * rand(1, 2.2) + dir.x * 2, vy: rand(0.4, 1), vz: side.z * u * rand(1, 2.2) + dir.z * 2,
        life: rand(1.5, 2.2), r0: rand(0.7, 1), r1: rand(2, 2.8), heat: 0.8, cool: 0, alpha: 0.42, drag: 1, spin: rand(-0.3, 0.3) });   // 0.95 白、0.6 不透明那版贴着镜头一大团白（10-27）
    }
    for (let i = count(26); i > 0; i--) {   // 火星：往前、往上飞得远
      const s = rand(s0, s1), q = at(s, rand(-1, 1) * hw);
      this.p.emit(q.x, from.y + rand(0.3, 3), q.z, dir.x * rand(8, 16) + rand(-2, 2), rand(1, 5), dir.z * rand(8, 16) + rand(-2, 2),
        rand(0.7, 1.4), rand(0.04, 0.08), scaleArr(fire.core, 3), scaleArr(fire.primary, 1.3), { drag: 1.2, grav: 1.2, grow: 0.6 });
    }
  }

  /**
   * 火卷风一帧：螺旋往上卷的火团（下热上冷）、顶上的黑烟、底下一圈贴地的火（卷风走了还留在原地烧一会儿）和白烟。
   * @param {{ pos: THREE.Vector3, t: number, acc: number }} tw @param {number} dt @param {number} fade
   */
  tornadoFrame(tw, dt, fade) {
    const C = this.clouds, R = TORNADO.r, c = tw.pos, fire = PALETTE.fire;
    tw.acc += dt * fade * this.k;
    const n = (/** @type {number} */ perSec) => Math.floor(tw.acc * perSec) - Math.floor((tw.acc - dt * fade * this.k) * perSec);
    // 卷着往上走的火团：漏斗形（越高转得越开、团越大），两股螺旋带。
    // 起始角只分两股、转速大家一样，于是转过的角度跟升了多高成正比——叠出来就是两道螺旋（一圈约 5 米高）；
    // 角度乱撒、半径 0.15～0.3 R、只升到 3 米多那版看着就是一团火球，不像龙卷（10-27 截图）
    for (let i = n(110); i > 0; i--) {
      const band = Math.random() < 0.5 ? 0 : Math.PI;
      // 压扁、斜着摆（不自转）：一团团连成斜着绕上去的带子，螺旋才看得出来
      C.puff('fire', { x: c.x, y: c.y + rand(0, 0.5), z: c.z, vy: rand(4.6, 6.2), life: rand(1.15, 1.45), r0: rand(0.32, 0.48), r1: rand(1.1, 1.5), heat: 1.05, cool: 1.15,
        aspect: 0.7, rot: rand(0.25, 0.45), spin: 0,
        orbit: { c, a: band + rand(-0.45, 0.45), r: R * rand(0.12, 0.22), w: SWIRL_W, grow: 0.3 }, drag: 0.35, rise: 1.2 });
    }
    for (let i = n(40); i > 0; i--) {   // 火舌：贴着外圈往上窜（半径按高度张开由 grow 管，别再自己加一遍）
      C.puff('fire', { x: c.x, y: c.y + rand(0.5, 5), z: c.z, vy: rand(4, 6.5), life: rand(0.3, 0.5), r0: rand(0.25, 0.38), r1: rand(0.45, 0.65), aspect: rand(1.8, 2.5),
        spin: 0, heat: 1, cool: 1.4, orbit: { c, a: rand(0, Math.PI * 2), r: R * 0.25, w: SWIRL_W * 1.2, grow: 0.3 } });
    }
    for (let i = n(14); i > 0; i--) {   // 顶上的黑烟
      C.puff('smoke', { x: c.x, y: c.y + rand(6.6, 7.6), z: c.z, vy: rand(0.8, 1.6), life: rand(1.6, 2.3), r0: rand(1, 1.3), r1: rand(2.6, 3.4), heat: 0, cool: 0,
        alpha: 0.75, orbit: { c, a: rand(0, Math.PI * 2), r: R * 0.9, w: rand(1.5, 2.5), grow: 0.15 } });
    }
    for (let i = n(18); i > 0; i--) {   // 底下一圈贴地的火：不跟着走，留在地上烧一会儿
      const a = rand(0, Math.PI * 2), r = R * rand(0.4, 0.9);
      C.puff('fire', { x: c.x + Math.cos(a) * r, y: c.y + rand(0.2, 0.5), z: c.z + Math.sin(a) * r, vx: -Math.sin(a) * 2, vy: rand(0.6, 1.4), vz: Math.cos(a) * 2,
        life: rand(0.7, 1.1), r0: rand(0.35, 0.55), r1: rand(0.8, 1.1), heat: 0.85, cool: 1.2, drag: 1.5, rise: 0.8 });
    }
    for (let i = n(8); i > 0; i--) {   // 白烟：卷起来的尘
      const a = rand(0, Math.PI * 2);
      C.puff('smoke', { x: c.x + Math.cos(a) * R * 0.9, y: c.y + rand(0.2, 0.6), z: c.z + Math.sin(a) * R * 0.9, vx: Math.cos(a) * 1.5, vy: rand(0.3, 0.8), vz: Math.sin(a) * 1.5,
        life: rand(1.2, 1.8), r0: rand(0.6, 0.9), r1: rand(1.6, 2.2), heat: 0.9, cool: 0, alpha: 0.5, drag: 1 });
    }
    for (let i = n(160); i > 0; i--) {   // 火星：被甩出外圈
      const h = rand(0, 5), a = tw.t * 7 + Math.random() * Math.PI * 2, r = R * (0.3 + 0.12 * h);
      this.p.emit(c.x + Math.cos(a) * r, c.y + h, c.z + Math.sin(a) * r, -Math.sin(a) * 7 + Math.cos(a) * 2, rand(1.5, 4), Math.cos(a) * 7 + Math.sin(a) * 2,
        rand(0.5, 1), rand(0.04, 0.08), scaleArr(fire.core, 3), scaleArr(fire.primary, 1.3), { drag: 1.5, grav: 1, grow: 0.6 });
    }
  }

  /** @param {number} dt @param {THREE.Camera} camera */
  update(dt, camera) {
    const fx = this.fx, warm = PALETTE.fire.primary;
    for (let i = this.tornadoes.length - 1; i >= 0; i--) {
      const tw = this.tornadoes[i];
      tw.t += dt;
      // 前面撞上牌坊、石兽这些实心的就停在原地烧：钻进门洞那版，漏斗被两边门墙切出两道直边（10-27 截图）
      const nx = tw.pos.x + tw.dir.x * TORNADO.speed * dt, nz = tw.pos.z + tw.dir.z * TORNADO.speed * dt, g = TORNADO.r * 1.1;   // 门洞 4.5 米宽，放宽 1.1 R 后正中也过不去
      if (!SOLIDS.some((b) => b.min[1] < 3 && nx > b.min[0] - g && nx < b.max[0] + g && nz > b.min[2] - g && nz < b.max[2] + g)) tw.pos.set(nx, tw.pos.y, nz);
      tw.pos.y = groundHeightAt(tw.pos.x, tw.pos.z) ?? tw.pos.y;
      const fade = Math.min(1, tw.t / 0.25) * Math.max(0, Math.min(1, (TORNADO.sec - tw.t) / 0.4));
      this.tornadoFrame(tw, dt, fade);
      fx.blastLight.position.set(tw.pos.x, tw.pos.y + 2, tw.pos.z);
      fx.blastLight.color.setRGB(warm[0], warm[1], warm[2]);
      fx.blastT = 0.15; fx.blastBoost = 0.4 * fade;   // 卷风照亮四周
      if (tw.t >= TORNADO.sec) this.tornadoes.splice(i, 1);
    }
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const wv = this.waves[i];
      wv.t += dt;
      const front = Math.min(BEAM.len, wv.t * BEAM.speed);
      if (front > wv.done) { this.waveSegment(wv, wv.done, front); wv.done = front; }
      while (wv.scorched + 3.5 <= front) {   // 一路烧出焦痕
        wv.scorched += 3.5;
        fx.scorch(wv.from.clone().addScaledVector(wv.dir, wv.scorched), Math.min(2.2, waveHalfW(wv.scorched) * 0.6));
      }
      if (front < BEAM.len) {   // 浪头的光照在地上、跟着往前走
        fx.blastLight.position.copy(wv.from).addScaledVector(wv.dir, front).setY(wv.from.y + 1.8);
        fx.blastLight.color.setRGB(warm[0], warm[1], warm[2]);
        fx.blastT = 0.12; fx.blastBoost = 0.5;
      }
      if (wv.t >= BEAM.len / BEAM.speed + WAVE_LINGER) this.waves.splice(i, 1);
    }
    this.clouds.update(dt, camera);
  }

  clear() {
    this.tornadoes.length = 0;
    this.waves.length = 0;
    this.clouds.clear();
  }
}
