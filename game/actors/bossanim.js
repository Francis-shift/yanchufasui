// @ts-check
/**
 * 试炼的 boss 换成绑骨骼的模型以后，每一刻该摆哪段动作的第几秒（纯函数，modes/trial.js 每帧算一次交给 enemies.js 播）。
 * 出招的动作都是"蓄力 → 出手 → 收回"：预警期间从头放到出手那一帧，预警长短不同就放快放慢，出手正好落在预警结束（红圈落下）那一刻；
 * 出手以后照常速往后放到 end，再交回平时（待机、走路按实际挪多快挑）。
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

/** 持续喷的时候在 hold 那一段里来回，每秒走多少秒的动作 */
const HOLD_RATE = 0.4;

/**
 * @typedef {{ hit: number, end: number, hold?: number[] }} Beat
 * @typedef {Record<string, Beat>} BossClips
 * @typedef {{ state: string, move: string, t: number, len: number, chT: number, tail: { move: string, t: number } | null }} PoseInput
 *   state / move / t：试炼模式的状态、这一招、这个状态还剩几秒；len：这个状态（预警、吼）一共几秒；
 *   chT：旋转弹幕已经喷了几秒；tail：上一招出手（旋转弹幕是喷完）以后过了几秒
 */

/**
 * @param {BossClips} clips @param {PoseInput} s
 * @returns {{ clip: string, time: number } | null} null：平时，按挪多快挑待机或走路
 */
export function bossPose(clips, s) {
  const done = (/** @type {number} */ t, /** @type {number} */ len) => Math.min(1, Math.max(0, 1 - t / Math.max(len, 1e-6)));
  if (s.state === 'tele' && clips[s.move]) return { clip: s.move, time: done(s.t, s.len) * clips[s.move].hit };
  if (s.state === 'roar' && clips.roar) return { clip: 'roar', time: done(s.t, s.len) * clips.roar.end };
  const hold = clips[s.move]?.hold;
  if (s.state === 'channel' && hold) {
    const w = hold[1] - hold[0], x = (s.chT * HOLD_RATE) % (2 * w);
    return { clip: s.move, time: hold[0] + (x < w ? x : 2 * w - x) };
  }
  const c = s.tail && clips[s.tail.move];
  if (s.tail && c) {
    const time = (c.hold ? c.hold[1] : c.hit) + s.tail.t;
    if (time <= c.end) return { clip: s.tail.move, time };
  }
  return null;
}
