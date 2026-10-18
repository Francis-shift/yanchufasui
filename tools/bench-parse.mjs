// 测解析延迟与格式合格率：同一组咒语，逐个模型跑一遍。
// 用法：在 .env.local 里填好 ARK_API_KEY，以及 ARK_MODELS=模型甲,模型乙（或只填 ARK_MODEL），然后
//   node tools/bench-parse.mjs [每句重复次数，默认 2]
// 只打印耗时与结果，不打印密钥。
import { sanitizeIntent } from '../game/rules/intent.js';
import { callParse, loadEnv, modelsOf } from './ark.mjs';

const env = loadEnv();
const MODELS = modelsOf(env);
if (!env.ARK_API_KEY || !MODELS.length) { console.error('.env.local 里缺 ARK_API_KEY 或 ARK_MODELS / ARK_MODEL'); process.exit(1); }

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

for (const model of MODELS) {
  console.log(`\n== ${model}`);
  const times = [];
  let bad = 0, named = false;
  for (const text of SENTENCES) {
    for (let r = 0; r < REPEAT; r++) {
      const x = await callParse(env, model, text);
      if (x.err) { bad++; console.log(`  ✗ ${text} | ${x.ms} 毫秒 | ${x.err}`); continue; }
      if (!named) { named = true; console.log(`  背后的模型：${x.real || '（接口没返回）'}`); }   // 接入点编号看不出是哪家，以返回为准
      times.push(x.ms);
      if (r === 0) {
        const it = sanitizeIntent(x.raw, text);
        const s = it.steps.map((p) => `${p.el}/${p.form}/${p.target}${p.count > 1 ? '×' + p.count : ''}${p.path !== 'straight' ? '/' + p.path : ''}`).join(' → ');
        console.log(`  ${x.ms} 毫秒 | 输出 ${x.out} 词元 | ${text} → ${s || '（无）'} | 气势 ${it.momentum} | 名 ${it.name}` +
          `${it.unknown.length ? ' | 未生效 ' + it.unknown.join('、') : ''}${it.overreach ? ' | 越权' : ''}`);
      }
    }
  }
  times.sort((a, b) => a - b);
  const q = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
  console.log(`  合计 ${times.length} 次成功、${bad} 次失败；中位数 ${q(0.5)} 毫秒，九成 ≤ ${q(0.9)} 毫秒，最慢 ${times.at(-1)} 毫秒`);
}
