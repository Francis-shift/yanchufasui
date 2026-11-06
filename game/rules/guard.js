// @ts-check
/**
 * 护身无敌（设计文档第 4 节"领悟"）：龙绕着人转的这几秒什么都打不动；双龙护身挡下一击再反震一圈。
 * 这里只管还剩几秒、这一下震不震、飘不飘字；挡在 modes/trial.js 的 hurt，震的效果在 main.js 的 guardBlock。
 */
import { RUN } from './numbers.js';

const G = RUN.dragon.guard;

/**
 * t 还剩几秒；every 反震隔几秒一次（0 是不震，只有一条龙）；cd 还要几秒才能再震；quiet 还要几秒才能再飘字
 * @typedef {{ t: number, every: number, cd: number, quiet: number }} Guard
 */

/** @type {Guard} */
export const GUARD_OFF = { t: 0, every: 0, cd: 0, quiet: 0 };

/** @param {Guard} g */
export const guardOn = (g) => g.t > 0;

/**
 * 能挡多久。main.js 召的时候开一次（龙还在地下也要挡住），龙破土再开一次，这样转完正好结束（lead 是龙破土后钻到人身边那一小段）
 * @param {boolean} twin @returns {Guard}
 */
export const openGuard = (twin) => ({ t: G.sec + G.lead, every: twin ? G.shock.every : 0, cd: 0, quiet: 0 });

/** @param {Guard} g @param {number} dt @returns {Guard} */
export function tickGuard(g, dt) {
  if (!guardOn(g)) return g;
  const t = g.t - dt;
  return t > 0 ? { ...g, t, cd: Math.max(0, g.cd - dt), quiet: Math.max(0, g.quiet - dt) } : GUARD_OFF;
}

/**
 * 挡下一击。弹幕一帧能来好几颗：每一下都挡，但震和飘字各有间隔，免得糊成一片
 * @param {Guard} g @returns {{ g: Guard, shock: boolean, show: boolean }}
 */
export function blockHit(g) {
  const shock = g.every > 0 && g.cd <= 0, show = g.quiet <= 0;
  return { g: { ...g, cd: shock ? g.every : g.cd, quiet: show ? G.quiet : g.quiet }, shock, show };
}

/**
 * 身上亮多少（0～1）：转着的时候一直亮，好让人知道现在能站着挨；最后 warn 秒一闪一闪，该跑了
 * @param {Guard} g
 */
export function guardGlow(g) {
  if (!guardOn(g)) return 0;
  return g.t > G.warn || Math.floor(g.t * 8) % 2 ? 1 : 0.2;
}
