// @ts-check
/**
 * 两根华表能被推倒（设计文档第 2 节"场景物件可点名"）。
 * 倒到地上那一刻才算挡路：柱脚的圆换成一串圆，调用方在 onLand 里让流场重算、结算砸中的敌人。开新的一局才立回去。
 * 试炼的 boss 碰到倒着的华表就撞碎（shatter）：小怪绕路，boss 不绕。
 */
import { TOPPLE } from '../rules/numbers.js';
import { fallenCircles, PILLARS, setFallen } from './layout.js';
import { Tipper } from './tipper.js';

export class Huabiao extends Tipper {
  /** @param {import('three').Object3D[]} boxes 两根的方块占位（原点在柱脚） */
  constructor(boxes) { super(PILLARS, boxes, TOPPLE.hinge); }

  /** 砸到地上时压住的那条线（柱身的两头，水平） @param {number} i */
  ends(i) {
    const p = this.list[i], at = (/** @type {number} */ t) => ({ x: p.x + p.dir.x * t, z: p.z + p.dir.z * t });
    return { a: at(TOPPLE.hinge), b: at(TOPPLE.hinge + TOPPLE.len) };
  }

  landed() { this.block(); }

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
    const any = super.reset();
    for (const p of this.list) {
      p.gone = false;
      for (const { o } of p.parts) o.visible = true;
    }
    if (any) this.block();
    return any;
  }
}
