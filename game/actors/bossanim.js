// @ts-check
/**
 * 试炼的 boss 换成绑骨骼的模型以后，每一刻该摆哪段动作的第几秒（纯函数，modes/trial.js 每帧算一次交给 enemies.js 播）。
 * 出招的动作都是"蓄力 → 出手 → 收回"：预警期间从头放到出手那一帧，预警长短不同就放快放慢，出手正好落在预警结束（红圈落下）那一刻；
 * 出手以后照常速往后放到 end，再交回平时（待机、走路按实际挪多快挑）。吼、石甲巨像被打断的硬直照它们的时长从头放到 end。
 */

/**
 * 寒甲傀儡王（本人用 Tripo 建的冰甲傀儡，10-28 导出）各段动作：hit 出手那一帧在第几秒，end 收招放到第几秒；
 * 旋转弹幕的 hold 是双臂平伸那一小段（持续喷的时候在这里来回）。数是逐帧量两只手的位置定的：
 * - 砸地：右手 1.12 秒举到最高，1.5 秒落到最低（手没碰到地，只是落到身前），取 1.45；
 * - 横扫：右臂 1.0 秒拉到身后，1.25～1.75 秒扫回身前，取 1.45；
 * - 召小怪：张开双臂、抬起左脚，1.15 秒左脚跺回地面；
 * - 追踪冰锥：右手 0.6～0.9 秒举过头顶，0.95 秒往前甩；
 * - 旋转弹幕：双手先举过头顶，1.22～1.38 秒向两侧平伸；
 * - 吼：0.4～0.75 秒双臂屈起发力，1.5 秒基本收完。
 */
export const ICE_KING = {
  slam: { hit: 1.45, end: 1.65 },
  sweep: { hit: 1.45, end: 1.95 },
  summon: { hit: 1.15, end: 1.6 },
  homing: { hit: 0.95, end: 1.6 },
  spiral: { hit: 1.22, hold: [1.22, 1.38], end: 1.95 },
  roar: { hit: 0, end: 1.5 },
};

/**
 * 石甲巨像（10-28 导出）。提示词做的段里重踏、冲撞、地刺都没成，借了 Tripo 自带的两段：
 * - 重踏：angry_01 的 1.45～2.75 秒，1.05 秒蹲身砸到最低；
 * - 地刺：angry_01 的 0.25～1.45 秒，0.83 秒双拳往下捶；
 * - 落石：双手托过头顶、1.6 秒往下一压（第一块石头落地那一刻，后面几块落地时接着放完）；召小怪也用这段（召唤那段几乎不动，没用）；
 * - 冲撞蓄力：dive 的头 0.45 秒（俯身前倾），出手就是冲出去，冲的时候按走路放；
 * - 吼、被打断的硬直：照吼、硬直的时长从头放到收完。
 */
export const STONE_COLOSSUS = {
  slam: { hit: 1.05, end: 1.32 },
  spikes: { hit: 0.83, end: 1.16 },
  rocks: { hit: 1.6, end: 1.95 },
  summon: { clip: 'rocks', hit: 1.6, end: 1.95 },
  charge: { hit: 0.41, end: 0.41 },
  roar: { hit: 0, end: 1.5 },
  stagger: { hit: 0, end: 1.95 },
};

/**
 * 火灵（10-28 导出）。待机、吼借 Tripo 自带的（idle 8.5～12.5 秒、angry_01 1.4～2.75 秒）；追踪火球提示词那段太弱，换成 cast_a_spell 1.4～3.0 秒：
 * - 火浪：双手举高聚力，1.08 秒双掌往前推（gather：蓄力时火往身高 0.75 倍处的手上收）；
 * - 追踪火球：1.04 秒出手，手在身高 0.65 倍处；
 * - 火圈：双臂向两侧张开，1.6 秒掌心往下一按；召小怪也用这段；
 * - 火环：蜷身抱臂蓄力，1.3 秒双臂往外甩开。
 */
export const FLAME_SPIRIT = {
  wave: { hit: 1.08, end: 1.5, gather: 0.75 },
  homing: { hit: 1.04, end: 1.62, gather: 0.65 },
  pyre: { hit: 1.6, end: 1.95 },
  summon: { clip: 'pyre', hit: 1.6, end: 1.95 },
  nova: { hit: 1.3, end: 1.95 },
  roar: { hit: 0, end: 1.37 },
};

/** 三个 boss 各自的出招表（键是 numbers.js 里的 type） */
export const BOSS_CLIPS = { boss: ICE_KING, stone: STONE_COLOSSUS, flame: FLAME_SPIRIT };

/** 持续喷的时候在 hold 那一段里来回，每秒走多少秒的动作 */
const HOLD_RATE = 0.4;

/**
 * @typedef {{ hit: number, end: number, hold?: number[], clip?: string, gather?: number }} Beat
 *   clip：借哪段动作（不写就是和这一招同名的那段）；gather：蓄力时能量往身高几倍处收（不写按试炼模式的默认）
 * @typedef {Record<string, Beat>} BossClips
 * @typedef {{ state: string, move: string, t: number, len: number, chT: number, tail: { move: string, t: number } | null, lead?: number }} PoseInput
 *   state / move / t：试炼模式的状态、这一招、这个状态还剩几秒；len：这个状态（预警、吼、硬直）一共几秒；
 *   chT：旋转弹幕已经喷了几秒；tail：上一招出手（旋转弹幕是喷完）以后过了几秒；
 *   lead：预警最后这几秒已经算出手以后（落石第一块落地时还有几块在天上，出手对第一块，后面照常速往后放）
 */

/**
 * @param {BossClips} clips @param {PoseInput} s
 * @returns {{ clip: string, time: number } | null} null：平时，按挪多快挑待机或走路
 */
export function bossPose(clips, s) {
  const done = (/** @type {number} */ t, /** @type {number} */ len) => Math.min(1, Math.max(0, 1 - t / Math.max(len, 1e-6)));
  const at = (/** @type {string} */ move, /** @type {number} */ time) => ({ clip: clips[move].clip ?? move, time });
  const c = clips[s.move];
  if (s.state === 'tele' && c) {
    const lead = s.lead ?? 0;
    return at(s.move, lead > 0 && s.t <= lead ? Math.min(c.end, c.hit + lead - s.t) : done(s.t - lead, s.len - lead) * c.hit);
  }
  if ((s.state === 'roar' || s.state === 'stagger') && clips[s.state]) return at(s.state, done(s.t, s.len) * clips[s.state].end);
  if (s.state === 'channel' && c?.hold) {
    const w = c.hold[1] - c.hold[0], x = (s.chT * HOLD_RATE) % (2 * w);
    return at(s.move, c.hold[0] + (x < w ? x : 2 * w - x));
  }
  const tc = s.tail && clips[s.tail.move];
  if (s.tail && tc) {
    const time = (tc.hold ? tc.hold[1] : tc.hit) + s.tail.t;
    if (time <= tc.end) return at(s.tail.move, time);
  }
  return null;
}
