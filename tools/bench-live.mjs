// 量线上解析接口的耗时，比较不同时段（夜里跨境线路和模型都忙）。
// 先调两次诊断（每次连发 6 个只要 1 个词元的模型请求），再发几句真咒语，打印服务器这一侧的中位、九成、最慢与失败数。
// 用法：node tools/bench-live.mjs [网站地址，默认 https://www.yanchufasui.top] [每句重复次数，默认 1]
// 每次的结果另追加一行到 tests/eval/results/live-latency.jsonl。接口每分钟限 12 次，这里每句之间隔 5 秒。
import { appendFileSync } from 'node:fs';

const SITE = (process.argv[2] || 'https://www.yanchufasui.top').replace(/\/$/, '');
const REPEAT = Number(process.argv[3] || 1);
const API = `${SITE}/api/parse`;
const SPELLS = ['火球砸向那个傀儡', '冰墙挡住他们', '狂风把它们吹下悬崖', '召唤冰龙冻住所有敌人',
  '三颗火球从天而降', '土墙挡在石阶上', '九天寒霜化作冰雨，落向来犯之敌！', '先冻住前排，再用风把它们吹下去'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {number[]} xs @param {number} q */
function pct(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
}

const at = new Date();
const beijing = new Date(at.getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
console.log(`== ${API}  北京时间 ${beijing}`);

const tiny = [];
let tinyFail = 0;
for (let k = 0; k < 2; k++) {
  try {
    const j = await (await fetch(`${API}?diag=6`, { signal: AbortSignal.timeout(60000) })).json();
    for (const c of j.calls || []) { if (c.status === 200) tiny.push(c.ms); else { tinyFail++; console.log(`  诊断失败 ${c.ms} 毫秒 ${c.err || c.status}`); } }
    if (k === 0) console.log(`  函数在 ${j.where?.city || '?'}，运行时 ${j.node || '?'}`);
  } catch (e) {
    console.log(`  诊断请求没回来：${/** @type {Error} */ (e).message}`);
  }
  await sleep(5000);
}
console.log(`  诊断 ${tiny.length} 次成功、${tinyFail} 次失败；中位 ${pct(tiny, 0.5)}，九成 ≤ ${pct(tiny, 0.9)}，最慢 ${pct(tiny, 1)} 毫秒`);

const server = [], total = [];
let ok = 0, timeouts = 0, errors = 0, retried = 0;
for (const text of SPELLS) {
  for (let r = 0; r < REPEAT; r++) {
    const t0 = Date.now();
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(15000) });
      const j = await res.json();
      const ms = Date.now() - t0;
      if ((j.tries || 1) > 1) retried++;
      if (typeof j.ms === 'number') server.push(j.ms);   // 超时的也算进去（约 4000），不然只统计成功的会显得快
      if (j.ok) { ok++; total.push(ms); }
      else if (j.reason === 'timeout') timeouts++;
      else errors++;
      console.log(`  ${j.ok ? '成' : '败'} 服务器 ${j.ms ?? '-'} 毫秒 · 本机总共 ${ms} 毫秒 · 试 ${j.tries ?? 1} 次${j.ok ? '' : ' · ' + j.reason + (j.errs ? ' ' + j.errs.join(',') : '')} | ${text}`);
    } catch (e) {
      errors++;
      console.log(`  败 本机没等到（${/** @type {Error} */ (e).message}） | ${text}`);
    }
    await sleep(5000);
  }
}
const n = ok + timeouts + errors;
console.log(`  真咒语 ${n} 句：成功 ${ok}、超时 ${timeouts}、出错 ${errors}、重试过 ${retried}`);
console.log(`  服务器调模型（超时按约 4000 计）：中位 ${pct(server, 0.5)}，九成 ≤ ${pct(server, 0.9)}，最慢 ${pct(server, 1)} 毫秒（本机总共的数含本机到服务器的路程，只作参考）`);

appendFileSync(new URL('../tests/eval/results/live-latency.jsonl', import.meta.url), JSON.stringify({
  beijing, site: SITE, tiny: { ok: tiny.length, fail: tinyFail, p50: pct(tiny, 0.5), p90: pct(tiny, 0.9), max: pct(tiny, 1) },
  spells: { n, ok, timeouts, errors, retried, p50: pct(server, 0.5), p90: pct(server, 0.9), max: pct(server, 1) },
}) + '\n');
