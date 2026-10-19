// @ts-check
/**
 * 流场寻路：把广场切成小格子，从阵眼往外算一遍"每一格离阵眼还有多远"，
 * 敌人只看脚下那格往哪边更近就往哪边走。一百个敌人和一个敌人一样便宜——场景变了（立起土墙、
 * 推倒华表）重算一遍就行，两千来个格子算一遍不到一毫秒。
 * 纯计算，不依赖 three.js，单元测试直接跑。
 */

const SQRT2 = Math.SQRT2;
const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]];

/**
 * @typedef {{ x: number, z: number, r: number }} Circle 圆形障碍或目标区
 */

export class FlowField {
  /**
   * @param {{ radius: number, cell?: number, goal: Circle, body?: number }} o
   *   radius 广场半径（格子只铺在圆内）；goal 走到这个圆里就算碰到阵眼；body 敌人身体半径，障碍按它往外扩
   */
  constructor(o) {
    this.R = o.radius;
    this.cell = o.cell ?? 0.5;
    this.goal = o.goal;
    this.body = o.body ?? 0.35;
    this.n = Math.ceil((2 * this.R) / this.cell);
    this.blocked = new Uint8Array(this.n * this.n);
    this.dist = new Float32Array(this.n * this.n);
    /** @type {Circle[]} */
    this.obstacles = [];
    this.rebuild();
  }

  /** @param {Circle[]} list 换上一组障碍并重算 */
  setObstacles(list) {
    this.obstacles = list;
    this.rebuild();
  }

  /** 格子中心的世界坐标 */
  center(i, j) { return { x: -this.R + (i + 0.5) * this.cell, z: -this.R + (j + 0.5) * this.cell }; }

  /** 世界坐标落在哪一格；不在网格里返回 -1 */
  index(x, z) {
    const i = Math.floor((x + this.R) / this.cell), j = Math.floor((z + this.R) / this.cell);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }

  rebuild() {
    const { n, blocked, dist } = this;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = this.center(i, j), k = j * n + i;
        let b = c.x * c.x + c.z * c.z > (this.R - this.body) * (this.R - this.body) ? 1 : 0;
        for (const o of this.obstacles) if (!b && (c.x - o.x) ** 2 + (c.z - o.z) ** 2 < (o.r + this.body) ** 2) b = 1;
        blocked[k] = b;
        dist[k] = Infinity;
      }
    }
    // 从阵眼一圈的格子出发，往外按真实步长（直走 1、斜走 √2）扩散
    /** @type {number[]} */
    const heap = [];
    const push = (k) => { heap.push(k); let a = heap.length - 1; while (a > 0) { const p = (a - 1) >> 1; if (dist[heap[p]] <= dist[heap[a]]) break; [heap[p], heap[a]] = [heap[a], heap[p]]; a = p; } };
    const pop = () => {
      const top = heap[0], last = /** @type {number} */ (heap.pop());
      if (heap.length) {
        heap[0] = last; let a = 0;
        for (;;) { const l = 2 * a + 1, r = l + 1; let m = a;
          if (l < heap.length && dist[heap[l]] < dist[heap[m]]) m = l;
          if (r < heap.length && dist[heap[r]] < dist[heap[m]]) m = r;
          if (m === a) break; [heap[m], heap[a]] = [heap[a], heap[m]]; a = m; }
      }
      return top;
    };
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = this.center(i, j), k = j * n + i;
        if (!blocked[k] && (c.x - this.goal.x) ** 2 + (c.z - this.goal.z) ** 2 <= this.goal.r ** 2) { dist[k] = 0; push(k); }
      }
    }
    while (heap.length) {
      const k = pop(), i = k % n, j = (k - i) / n, d = dist[k];
      for (const [di, dj, w] of N8) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const kk = b * n + a;
        if (blocked[kk]) continue;
        if (di && dj && (blocked[j * n + a] || blocked[b * n + i])) continue;   // 斜着走不许擦着障碍的角穿过去
        const nd = d + w * this.cell;
        if (nd < dist[kk]) { dist[kk] = nd; push(kk); }
      }
    }
  }

  /** 离阵眼还有多远（沿可走的路）；走不到返回 Infinity，不在广场上返回 null */
  distAt(x, z) {
    const k = this.index(x, z);
    return k < 0 ? null : this.dist[k];
  }

  /**
   * 站在这里该往哪走（单位向量）。看周围 8 格谁离阵眼最近就朝谁；
   * 脚下这格被堵（墙刚立在身上）也照样找最近的出口。四周都走不通返回 null，由调用方直接朝阵眼走。
   */
  dirAt(x, z) {
    const k = this.index(x, z);
    if (k < 0) return null;
    const { n, dist } = this, i = k % n, j = (k - i) / n;
    let best = -1, bd = this.blocked[k] ? Infinity : dist[k];
    for (const [di, dj] of N8) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const kk = b * n + a;
      if (dist[kk] < bd) { bd = dist[kk]; best = kk; }
    }
    if (best < 0) return null;
    const c = this.center(best % n, Math.floor(best / n));
    const dx = c.x - x, dz = c.z - z, len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }
}
