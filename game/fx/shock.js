// @ts-check
/**
 * 命中时那一圈冲击波（风格卡"打击感"）：从落点往外跑的一圈折射，画面在 grade.js 里按这里给的数扭。
 * 这里只算"这一刻圈多大、多强"，不碰 three。按真实时间走：顿帧、慢放时圈不停在半路。
 * 着色器里只有一圈，后来的小圈不打断刚起来的大圈。
 */

/** sec：跑完一圈的秒数；amp：最强时偏移屏高的几分之几；reach：圈最后跑到爆炸半径的几倍；minScale：比这小的命中不起圈 */
export const SHOCK = { sec: 0.42, amp: 0.03, reach: 2, minScale: 0.45, maxR: 0.55, wK: 0.12, wMin: 0.014 };

/**
 * 世界里的半径换成屏幕上的（屏高 = 1）
 * @param {number} worldR @param {number} dist 到镜头的距离 @param {number} fovDeg 竖直视角
 */
export function screenR(worldR, dist, fovDeg) {
  return worldR / (2 * Math.max(dist, 0.1) * Math.tan(fovDeg * Math.PI / 360));
}

export class Shock {
  constructor() {
    this.x = 0; this.y = 0; this.z = 0;
    this.R = 0; this.k = 0;
    /** 跑了多久；-1 是没有圈 */
    this.t = -1;
  }

  /**
   * 起一圈。圈还跑在前一半时，只有更强的才换掉它。
   * @param {{ x: number, y: number, z: number }} p @param {number} R 爆炸半径 @param {number} scale 特效规模（小命中 0.45，爆 1）
   */
  hit(p, R, scale) {
    if (scale < SHOCK.minScale) return;
    const k = Math.min(scale, 1);
    if (this.t >= 0 && this.t < SHOCK.sec * 0.5 && k <= this.k) return;
    this.x = p.x; this.y = p.y; this.z = p.z;
    this.R = R; this.k = k; this.t = 0;
  }

  /** @param {number} dt 真实时间 */
  tick(dt) {
    if (this.t >= 0 && (this.t += dt) >= SHOCK.sec) this.t = -1;
  }

  /**
   * 这一刻的圈。圈先快后慢地胀开，强度一路衰减，起跑时从 0 升上来免得一下子跳出一圈。
   * @param {number} dist 落点到镜头的距离 @param {number} fovDeg 竖直视角
   * @returns {{ r: number, w: number, amp: number }} 半径、宽度（屏高 = 1）、偏移量；没有圈时 amp 是 0
   */
  ring(dist, fovDeg) {
    if (this.t < 0) return { r: 0, w: SHOCK.wMin, amp: 0 };
    const q = this.t / SHOCK.sec, grow = 1 - (1 - q) ** 3;
    const r = Math.min(SHOCK.maxR, screenR(this.R * SHOCK.reach, dist, fovDeg) * grow);
    return { r, w: Math.max(SHOCK.wMin, r * SHOCK.wK), amp: SHOCK.amp * this.k * Math.min(1, q * 8) * (1 - q) ** 1.5 };
  }
}
