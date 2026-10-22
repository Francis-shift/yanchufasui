// @ts-check
/**
 * 画质分档（设计文档第 5 节，10-21 定）：电脑开"电影档"，手机开"流畅档"。
 * 地址里带 ?q=cinema 或 ?q=smooth 可以强制某一档（试验场对比用）。
 * 电影档的数值是初值，做出来后按帧率实测再改。
 */

/**
 * @typedef {{
 *   name: 'cinema' | 'smooth', label: string,
 *   pixelRatio: number, particles: number, ink: number, shadowMap: number,
 *   bloom: { strength: number, radius: number, threshold: number },
 *   grade: { contrast: number, saturation: number, vignette: number, impact: number, grain: number },
 *   foreground: boolean, inkK: number,
 * }} Quality
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
  },
  smooth: {
    name: 'smooth', label: '流畅档',
    pixelRatio: 1.5, particles: 4500, ink: 900, shadowMap: 2048,
    bloom: { strength: 0.45, radius: 0.45, threshold: 1.05 },
    grade: { contrast: 1.06, saturation: 1.05, vignette: 0.18, impact: 0, grain: 0 },
    foreground: false,
    inkK: 0.45,
  },
};

/**
 * @param {string} search 地址里的查询串（location.search）
 * @param {boolean} mobile 是不是触屏手机
 * @returns {Quality}
 */
export function pickQuality(search, mobile) {
  const q = new URLSearchParams(search).get('q');
  if (q === 'cinema' || q === 'smooth') return TIERS[q];
  return mobile ? TIERS.smooth : TIERS.cinema;
}
