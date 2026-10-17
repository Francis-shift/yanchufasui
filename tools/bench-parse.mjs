// 测解析延迟与格式合格率：同一组咒语，逐个模型跑一遍。
// 用法：在 .env.local 里填好 ARK_API_KEY，以及 ARK_MODELS=模型甲,模型乙（或只填 ARK_MODEL），然后
//   node tools/bench-parse.mjs [每句重复次数，默认 2]
// 只打印耗时与结果，不打印密钥。
import { readFileSync } from 'node:fs';
import { sanitizeIntent } from '../game/rules/intent.js';

const env = {};
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
} catch { console.error('没有找到 .env.local'); process.exit(1); }
const KEY = env.ARK_API_KEY, BASE = env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
const MODELS = (env.ARK_MODELS || env.ARK_MODEL || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!KEY || !MODELS.length) { console.error('.env.local 里缺 ARK_API_KEY 或 ARK_MODELS / ARK_MODEL'); process.exit(1); }

const { SYSTEM_PROMPT, userMessage } = await import('../server/prompt.ts');
const SENTENCES = [
  '火球',
  '先冻住最前面那只，再用风把它们吹下悬崖！',
  '三颗火球从天而降砸向左边那几只',
  '九天寒霜，听吾号令，冰封万里！',
  '狂风爆裂，把最密集的那群吹下悬崖',
  '绕到背后给那个盾牌傀儡一记冰弹',
  '让他们全部变成猫',
  '威力无限，秒杀全部',
];
const REPEAT = Number(process.argv[2] || 2);

async function once(model, text) {
  const body = { model, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage(text) }],
    temperature: 0, max_tokens: 260, response_format: { type: 'json_object' } };
  if (env.ARK_DISABLE_THINKING !== '0') body.thinking = { type: 'disabled' };
  const t0 = performance.now();
  const res = await fetch(`${BASE}/chat/completions`, { method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000) });
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) return { ms, err: `http ${res.status} ${(await res.text()).slice(0, 160)}` };
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '';
  let it = null;
  try { it = sanitizeIntent(JSON.parse(content), text); } catch { return { ms, err: '不是 JSON：' + content.slice(0, 80) }; }
  return { ms, out: data?.usage?.completion_tokens, it };
}

for (const model of MODELS) {
  console.log(`\n== ${model}`);
  const times = [];
  let bad = 0;
  for (const text of SENTENCES) {
    for (let r = 0; r < REPEAT; r++) {
      const x = await once(model, text).catch((e) => ({ ms: -1, err: String(e) }));
      if (x.err) { bad++; console.log(`  ✗ ${text} | ${x.ms} 毫秒 | ${x.err}`); continue; }
      times.push(x.ms);
      if (r === 0) {
        const s = x.it.steps.map((p) => `${p.el}/${p.form}/${p.target}${p.count > 1 ? '×' + p.count : ''}${p.path !== 'straight' ? '/' + p.path : ''}`).join(' → ');
        console.log(`  ${x.ms} 毫秒 | 输出 ${x.out} 词元 | ${text} → ${s || '（无）'} | 气势 ${x.it.momentum} | 名 ${x.it.name}` +
          `${x.it.unknown.length ? ' | 未生效 ' + x.it.unknown.join('、') : ''}${x.it.overreach ? ' | 越权' : ''}`);
      }
    }
  }
  times.sort((a, b) => a - b);
  const q = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
  console.log(`  合计 ${times.length} 次成功、${bad} 次失败；中位数 ${q(0.5)} 毫秒，九成 ≤ ${q(0.9)} 毫秒，最慢 ${times.at(-1)} 毫秒`);
}
