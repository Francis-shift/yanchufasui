// @ts-check
/**
 * 法域（设计文档第 4 节"法域"）：气势满了开，水墨从脚下一点点铺满全场，敌人跟着慢下来直到定住，人随便走；念最多三句，收束时一起落下。
 * 这里只管走到哪一段、念的话收到哪；定格、画框、放法术都在 main.js。定住时世界的钟是停的，所以这里的秒都是真实时间。
 */
import { RUN } from './numbers.js';

/**
 * phase：off 没开；open 展开（水墨铺开）；chant 念咒；wait 时间到了，还有一句在解析、听写，等它一下。
 * @typedef {{ phase: 'off' | 'open' | 'chant' | 'wait', t: number, lines: any[] }} Domain
 */

/** @type {Domain} */
export const DOMAIN_OFF = { phase: 'off', t: 0, lines: [] };

/** @param {Domain} d */
export const domainOn = (d) => d.phase !== 'off';

/** 世界的钟走几成：墨铺开的时候一点点慢下来，铺满了全停；人不受这个管 @param {Domain} d */
export function domainPace(d) {
  if (d.phase === 'off') return 1;
  return d.phase === 'open' ? (d.t / RUN.domain.open) ** 2 : 0;
}

/** 现在还能不能再念一句 @param {Domain} d */
export const canChant = (d) => d.phase === 'chant' && d.lines.length < RUN.domain.lines;

/**
 * 开得开不了：领悟了、开战了、气势满了，手上没有正在念的咒
 * @param {Domain} d @param {{ has: boolean, fighting: boolean, gauge: number, ult: number, busy: boolean }} c
 */
export const canOpen = (d, c) => !domainOn(d) && c.has && c.fighting && c.gauge >= c.ult && !c.busy;

/** @returns {Domain} */
export const openDomain = () => ({ phase: 'open', t: RUN.domain.open, lines: [] });

/** 念成一句：收起来，到收束时才放 @param {Domain} d @param {any} line @returns {Domain} */
export const addLine = (d, line) => ({ ...d, lines: [...d.lines, line] });

/** 不等时间到，这就收束（念够了不用干等） @param {Domain} d @returns {Domain} */
export const endChant = (d) => (d.phase === 'chant' ? { ...d, t: 0 } : d);

/**
 * 过了 dt 秒真实时间。busy：还有一句在解析、听写：时间到了也等它，最多等 wait 秒（解析超时比这短，等不到的只有断了的请求）。
 * @param {Domain} d @param {number} dt @param {boolean} busy
 * @returns {{ d: Domain, event: '' | 'chant' | 'strike', lines: any[] }} event：chant 该开始念了；strike 该收束了，lines 是念成的
 */
export function tickDomain(d, dt, busy) {
  const stay = (/** @type {Domain} */ x) => ({ d: x, event: /** @type {''} */ (''), lines: [] });
  if (d.phase === 'off') return stay(d);
  const t = d.t - dt;
  if (d.phase === 'open') return t > 0 ? stay({ ...d, t }) : { d: { ...d, phase: 'chant', t: RUN.domain.sec }, event: 'chant', lines: [] };
  const strike = { d: DOMAIN_OFF, event: /** @type {'strike'} */ ('strike'), lines: d.lines };
  if (d.phase === 'wait') return busy && t > 0 ? stay({ ...d, t }) : strike;
  if (t > 0 && d.lines.length < RUN.domain.lines) return stay({ ...d, t });
  return busy ? stay({ ...d, phase: 'wait', t: RUN.domain.wait }) : strike;
}

/** 念咒还剩几成（画框上的倒计时）：展开时满的，等解析时空的 @param {Domain} d */
export function domainLeft(d) {
  if (d.phase === 'open') return 1;
  return d.phase === 'chant' ? Math.max(0, d.t / RUN.domain.sec) : 0;
}

/**
 * 水墨这一帧铺到哪：开着时从脚下往外铺（r 是半径，屏高 = 1），关了就整张褪掉
 * @param {{ r: number, k: number }} s @param {boolean} on @param {number} dt @returns {{ r: number, k: number }}
 */
export function inkStep(s, on, dt) {
  if (on) return { r: Math.min(RUN.domain.inkR, s.r + (dt * RUN.domain.inkR) / RUN.domain.open), k: 1 };
  const k = Math.max(0, s.k - dt / RUN.domain.fade);
  return { r: k > 0 ? s.r : 0, k };
}
