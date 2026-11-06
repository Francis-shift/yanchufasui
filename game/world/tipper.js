// @ts-check
/**
 * 绕贴地一条转轴倒下去的物件（华表、香炉）：转轴在底座靠倒的那一边。模型到之前转方块占位，模型到了一起转（倒到一半才到也接得上）。
 * 砸到地上调一次 onLand，开新的一局才立回去。
 */
import * as THREE from 'three';
import { toppleAngle } from '../rules/arbiter.js';
import { TOPPLE } from '../rules/numbers.js';

const LAND = TOPPLE.lean + TOPPLE.fall, END = LAND + TOPPLE.settle;
const _q = new THREE.Quaternion(), _axis = new THREE.Vector3(), _pivot = new THREE.Vector3();

export class Tipper {
  /**
   * @param {{ x: number, z: number, dir: { x: number, z: number } }[]} spots 立在哪、往哪倒
   * @param {THREE.Object3D[]} boxes 方块占位（原点在底下）
   * @param {number} hinge 转轴离中心多远
   */
  constructor(spots, boxes, hinge) {
    this.hinge = hinge;
    /**
     * t：推了几秒，-1 是立着；down：砸到地上了；gone：华表被 boss 撞碎了
     * @type {{ x: number, z: number, dir: { x: number, z: number }, t: number, down: boolean, gone: boolean, onLand: (() => void) | null,
     *   parts: { o: THREE.Object3D, pos: THREE.Vector3, quat: THREE.Quaternion }[] }[]}
     */
    this.list = spots.map((p) => ({ ...p, t: -1, down: false, gone: false, onLand: null, parts: [] }));
    boxes.forEach((b, i) => this.use(i, b));
  }

  /** 接上一个要跟着转的东西（站着时的样子记下来） @param {number} i @param {THREE.Object3D} o */
  use(i, o) {
    const p = this.list[i];
    p.parts.push({ o, pos: o.position.clone(), quat: o.quaternion.clone() });
    this.pose(p);
  }

  /** 给 pickOfTwo 看 */
  views() { return this.list.map((p) => ({ x: p.x, z: p.z, up: p.t < 0 })); }

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
      this.landed();
      p.onLand?.();
      p.onLand = null;
    }
  }

  /** 砸到地上那一刻，onLand 之前（子类用） */
  landed() {}

  /** 都立回去（开新的一局） @returns {boolean} 有没有倒着的 */
  reset() {
    const any = this.list.some((p) => p.down);
    for (const p of this.list) { p.t = -1; p.down = false; p.onLand = null; this.pose(p); }
    return any;
  }

  /** @param {Tipper['list'][number]} p */
  pose(p) {
    _pivot.set(p.x + p.dir.x * this.hinge, 0, p.z + p.dir.z * this.hinge);
    _q.setFromAxisAngle(_axis.set(p.dir.z, 0, -p.dir.x), p.t < 0 ? 0 : toppleAngle(p.t));
    for (const { o, pos, quat } of p.parts) {
      o.quaternion.copy(_q).multiply(quat);
      o.position.copy(pos).sub(_pivot).applyQuaternion(_q).add(_pivot);
    }
  }
}
