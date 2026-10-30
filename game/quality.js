// @ts-check
/**
 * 画质分档（设计文档第 5 节，10-21 定）：电脑开"电影档"，手机开"流畅档"。
 * 地址里带 ?q=cinema 或 ?q=smooth 可以强制某一档（试验场对比用）；?refl=0 关掉水洼的平面反射（量它占多少帧率用）。
 * 电影档的数值是初值，做出来后按帧率实测再改。
 */

/**
 * @typedef {{
 *   name: 'cinema' | 'smooth', label: string,
 *   pixelRatio: number, particles: number, ink: number, shadowMap: number,
 *   bloom: { strength: number, radius: number, threshold: number },
 *   grade: { contrast: number, saturation: number, vignette: number, impact: number, grain: number },
 *   foreground: boolean, inkK: number, reflect: number,
 * }} Quality reflect：水洼平面反射图的宽（整个场景按地面翻过来再渲一遍），0 = 只照出天
 */

/** @type {Record<'cinema' | 'smooth', Quality>} */
export const TIERS = {
  cinema: {
    name: 'cinema', label: '电影档',
    pixelRatio: 2, particles: 24000, ink: 3000, shadowMap: 4096,
    bloom: { strength: 0.72, radius: 0.55, threshold: 1.05 },
    grade: { contrast: 1.1, saturation: 1.08, vignette: 0.32, impact: 1, grain: 0.035 },
    foreground: true,   // 前景层：镜头前大而虚的光斑
    inkK: 1,            // 墨点、墨烟的数量倍数
    reflect: 1024,
  },
  smooth: {
    name: 'smooth', label: '流畅档',
    pixelRatio: 1.5, particles: 4500, ink: 900, shadowMap: 2048,
    bloom: { strength: 0.45, radius: 0.45, threshold: 1.05 },
    grade: { contrast: 1.06, saturation: 1.05, vignette: 0.18, impact: 0, grain: 0 },
    foreground: false,
    inkK: 0.45,
    reflect: 0,
  },
};

/** 设置里选的档存在这台设备的浏览器里（'cinema' / 'smooth'，没存或认不出 = 自动） */
export const QUALITY_KEY = 'yc-quality';

/**
 * 先看地址里的 ?q=，再看设置里选的，都没有就电脑电影档、手机流畅档
 * @param {string} search 地址里的查询串（location.search）
 * @param {boolean} mobile 是不是触屏手机
 * @param {string | null} [pref] 设置里选的（localStorage 里 QUALITY_KEY 的值）
 * @returns {Quality}
 */
export function pickQuality(search, mobile, pref = null) {
  const p = new URLSearchParams(search), q = p.get('q');
  const ok = (/** @type {string | null} */ s) => s === 'cinema' || s === 'smooth';
  const tier = ok(q) ? TIERS[/** @type {'cinema' | 'smooth'} */ (q)] : ok(pref) ? TIERS[/** @type {'cinema' | 'smooth'} */ (pref)] : mobile ? TIERS.smooth : TIERS.cinema;
  return p.get('refl') === '0' ? { ...tier, reflect: 0 } : tier;
}
