// @ts-check
/**
 * 两根华表能被推倒（设计文档第 2 节"场景物件可点名"）：绕贴地的一条转轴转，转轴在底座靠倒的那一边；
 * 模型到之前转方块占位，模型到了一起转（倒到一半才到也接得上）。
 * 倒到地上那一刻才算挡路：柱脚的圆换成一串圆，调用方在 onLand 里让流场重算、结算砸中的敌人。开新的一局才立回去。
 * 试炼的 boss 碰到倒着的华表就撞碎（shatter）：小怪绕路，boss 不绕。
 */
import * as THREE from 'three';
import { toppleAngle } from '../rules/arbiter.js';
import { TOPPLE } from '../rules/numbers.js';
import { fallenCircles, PILLARS, setFallen } from './layout.js';

const LAND = TOPPLE.lean + TOPPLE.fall, END = LAND + TOPPLE.settle;
const _q = new THREE.Quaternion(), _axis = new THREE.Vector3(), _pivot = new THREE.Vector3();

export class Huabiao {
  /** @param {THREE.Object3D[]} boxes 两根的方块占位（原点在柱脚） */
  constructor(boxes) {
    /**
     * t：推了几秒，-1 是立着；down：砸到地上了；gone：被 boss 撞碎了
     * @type {{ x: number, z: number, dir: { x: number, z: number }, t: number, down: boolean, gone: boolean, onLand: (() => void) | null,
     *   parts: { o: THREE.Object3D, pos: THREE.Vector3, quat: THREE.Quaternion }[] }[]}
     */
    this.list = PILLARS.map((p) => ({ ...p, t: -1, down: false, gone: false, onLand: null, parts: [] }));
    boxes.forEach((b, i) => this.use(i, b));
  }

  /** 接上一个要跟着转的东西（站着时的样子记下来） @param {number} i @param {THREE.Object3D} o */
  use(i, o) {
    const p = this.list[i];
    p.parts.push({ o, pos: o.position.clone(), quat: o.quaternion.clone() });
    this.pose(p);
  }

  /** 给 pickPillars 看 */
  views() { return this.list.map((p) => ({ x: p.x, z: p.z, up: p.t < 0 })); }

  /** 砸到地上时压住的那条线（柱身的两头，水平） @param {number} i */
  ends(i) {
    const p = this.list[i], at = (/** @type {number} */ t) => ({ x: p.x + p.dir.x * t, z: p.z + p.dir.z * t });
    return { a: at(TOPPLE.hinge), b: at(TOPPLE.hinge + TOPPLE.len) };
  }

  /**
   * 开始倒。已经倒了（或正在倒）的不算。
   * @param {number} i @param {() => void} onLand 砸到地上时调一次 @returns {boolean} 这一下推动了没有
   */
  topple(i, onLand) {
    const p = this.list[i];
    if (p.t >= 0) return false;
    p.t = 0; p.onLand = onLand;
    return true;
  }

  /** @param {number} dt */
  update(dt) {
    for (const p of this.list) {
      if (p.t < 0 || p.t >= END) continue;
      p.t = Math.min(END, p.t + dt);
      this.pose(p);
      if (p.down || p.t < LAND) continue;
      p.down = true;
      this.block();
      p.onLand?.();
      p.onLand = null;
    }
  }

  /** 躺着的和不在原地的换进 OBSTACLES */
  block() {
    setFallen(this.list.filter((p) => p.down && !p.gone), this.list.flatMap((p, i) => (p.down ? [i] : [])));
  }

  /**
   * 身子半径 r、站在 at 的东西碰到了哪一根躺着的。
   * @param {{ x: number, z: number }} at @param {number} r @returns {number} 下标，没碰到 -1
   */
  touching(at, r) {
    return this.list.findIndex((p) => p.down && !p.gone && fallenCircles(p).some((c) => Math.hypot(c.x - at.x, c.z - at.z) < c.r + r + 0.1));
  }

  /** 撞碎一根躺着的：不见了，地方让出来 @param {number} i */
  shatter(i) {
    const p = this.list[i];
    p.gone = true;
    for (const { o } of p.parts) o.visible = false;
    this.block();
  }

  /** 都立回去（开新的一局） @returns {boolean} 有没有倒着的（挡路的地方变了，流场要重算） */
  reset() {
    const any = this.list.some((p) => p.down);
    for (const p of this.list) {
      p.t = -1; p.down = p.gone = false; p.onLand = null;
      for (const { o } of p.parts) o.visible = true;
      this.pose(p);
    }
    if (any) this.block();
    return any;
  }

  /** @param {Huabiao['list'][number]} p */
  pose(p) {
    _pivot.set(p.x + p.dir.x * TOPPLE.hinge, 0, p.z + p.dir.z * TOPPLE.hinge);
    _q.setFromAxisAngle(_axis.set(p.dir.z, 0, -p.dir.x), p.t < 0 ? 0 : toppleAngle(p.t));
    for (const { o, pos, quat } of p.parts) {
      o.quaternion.copy(_q).multiply(quat);
      o.position.copy(pos).sub(_pivot).applyQuaternion(_q).add(_pivot);
    }
  }
}
