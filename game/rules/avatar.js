// @ts-check
/**
 * 化身（设计文档第 4 节"化身"）：一局一次的翻盘。气血归零时不死，或者低血时自己开：时间一停亮相，回一口血，
 * 之后一段时间人变大，法力和闪避都不花，闪避穿过敌人打它一下，结束时一圈爆开，没有虚弱。
 * 这里只管走到哪一段、开得开不了；定格、外形、打人在 main.js，闪避在 modes/trial.js。
 */
import { RUN } from './numbers.js';

/**
 * phase：off 没开；pose 亮相，世界定住；on 变身中。used：这一局用过了（走完回到 off 也还记着）
 * @typedef {{ phase: 'off' | 'pose' | 'on', t: number, used: boolean }} Avatar
 */

/** @type {Avatar} */
export const AVATAR_OFF = { phase: 'off', t: 0, used: false };

/** @param {Avatar} a */
export const avatarOn = (a) => a.phase !== 'off';

/** 这会儿法力、闪避不花（亮相时世界是停的，不用算） @param {Avatar} a */
export const avatarFree = (a) => a.phase === 'on';

/** 气血归零时救不救得了：领悟了、这一局没用过 @param {Avatar} a @param {boolean} has */
export const canSave = (a, has) => has && !a.used && !avatarOn(a);

/** 按钮亮不亮：救得了的前提下，开战了、气血低于 low 成 @param {Avatar} a @param {{ has: boolean, fighting: boolean, hp: number, max: number }} c */
export const canAvatar = (a, c) => canSave(a, c.has) && c.fighting && c.hp <= c.max * RUN.avatar.low;

/** @returns {Avatar} */
export const openAvatar = () => ({ phase: 'pose', t: RUN.avatar.pose, used: true });

/** 开的时候回多少血：归零救回来和自己开都是回 heal，回不过上限 @param {number} hp @param {number} max */
export const avatarHeal = (hp, max) => Math.min(max, hp + RUN.avatar.heal);

/**
 * 走一步。亮相时世界定住，走真实时间；变身中走玩家的钟，法域定住时、选卡时不掉时间
 * @param {Avatar} a @param {number} real @param {number} play @returns {{ a: Avatar, event: '' | 'on' | 'end' }}
 */
export function tickAvatar(a, real, play) {
  if (a.phase === 'pose') {
    const t = a.t - real;
    return t > 0 ? { a: { ...a, t }, event: '' } : { a: { ...a, phase: 'on', t: RUN.avatar.sec }, event: 'on' };
  }
  if (a.phase === 'off') return { a, event: '' };
  const t = a.t - play;
  return t > 0 ? { a: { ...a, t }, event: '' } : { a: { phase: 'off', t: 0, used: true }, event: 'end' };
}
