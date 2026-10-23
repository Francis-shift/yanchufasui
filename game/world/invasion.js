// @ts-check
/**
 * 入侵进程（设计文档第 5 节风格卡"入侵进程"）：宗门本身照目标图建成完好的，"被入侵"是一层随战况加重的效果。
 * 这里只算"现在该有多重"：0 是目标图里的傍晚，1 是全暗（输了）。天和云海怎么跟着变在 environment.js。
 * 只管画面，不影响胜负。
 */

/** 第一波开打时的程度：只有石阶下方的云海发暗 */
const FIRST = 0.15;
/** 最后一波（Boss 波）开打时：天几乎全暗，只剩太阳那边一道光缝 */
const LAST = 0.86;
/** 一波打到底再加这么多：同一波里也看得出越压越近 */
const IN_WAVE = 0.06;
/** 守住一波，黑雾退回这么多，下一波开打再压上来 */
const REST_BACK = 0.06;

/**
 * 按局面算该有多重。
 * @param {{ phase: string, wave: number, waves: number, progress?: number }} s
 *   phase：title / playing / rest / won / lost；wave 从 0 数；progress 是这一波出场了几成（0～1）
 * @returns {number} 0～1
 */
export function invasionTarget(s) {
  if (s.phase === 'won' || s.phase === 'title') return 0;   // 守住了：黑雾散开、阳光重新照下来
  if (s.phase === 'lost') return 1;
  const base = FIRST + (LAST - FIRST) * (s.waves > 1 ? Math.min(s.wave, s.waves - 1) / (s.waves - 1) : 0);
  if (s.phase === 'rest') return base + IN_WAVE - REST_BACK;
  return base + IN_WAVE * Math.min(1, Math.max(0, s.progress ?? 0));
}

/**
 * 往目标靠一帧：压上来慢（几秒，像雾一点点漫过来），守住时散得快（两三秒内放晴，结算的高光一刻），输了很快全暗。
 * @param {number} cur @param {number} target @param {string} phase @param {number} dt 秒
 */
export function stepInvasion(cur, target, phase, dt) {
  const rate = target < cur ? (phase === 'won' ? 0.4 : 0.05) : (phase === 'lost' ? 0.35 : 0.04);
  const step = rate * dt;
  return Math.abs(target - cur) <= step ? target : cur + Math.sign(target - cur) * step;
}
