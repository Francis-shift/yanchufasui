// 检查模型起的咒语名有多少能完全落在书法字表里（game/rules/charset.js）。
// 用法：node tools/name-charset.mjs        → 用下面这批句子（不在评测集里）各调一次模型
// 字表是照评测集里的名字补的，这里换一批没见过的句子，才看得出真实覆盖率。
import { CHARSET, inCharset } from '../game/rules/charset.js';
import { cleanName } from '../game/rules/intent.js';
import { callParse, loadEnv, modelsOf } from './ark.mjs';

const SENTENCES = [
  '燃尽吧，把这群傀儡烧成灰', '寒冰啊，封住他们的脚步', '起风了，把最前面那只卷下山去',
  '大地裂开，立起一道石墙挡住石阶', '天降火雨，洒满整个广场', '冰锥三连，射穿最强的那个',
  '让火焰在索桥上炸开', '狂风啊，吹散中间那一群', '一颗小火苗，轻轻点一下左边的',
  '千年寒冰，冻结巨像', '石头从天而降砸右边', '用风墙护住阵眼',
  '先放火再刮风，烧穿他们', '先起一阵风，再点一把火', '冰霜之雨覆盖最密集的地方',
  '烈焰之墙挡在桥头', '全力一击，火球砸向巨像', '冻住它们，然后用风吹碎',
  '绕到背后给盾傀儡来一发冰弹', '岩石之拳，捶飞最前面的', '漫天飞雪落在左边',
  '怒火冲天，炸翻那一堆', '一阵清风拂过山门', '寒霜护体，守住脚下',
  '三团火从天上落下来', '土墙立在右边那条路上', '风刃斩向最强的敌人',
  '让冰在中间炸开一朵花', '用尽全力，把所有火都砸下去', '星火燎原，烧遍石阶',
];

const env = loadEnv();
const model = env.ARK_MODEL || modelsOf(env)[0];
if (!env.ARK_API_KEY || !model) { console.error('.env.local 里缺 ARK_API_KEY 或 ARK_MODEL'); process.exit(1); }
console.log(`字表 ${CHARSET.length} 字；模型 ${model}`);
let ok = 0, n = 0; const miss = {};
for (const text of SENTENCES) {
  const r = await callParse(env, model, text);
  const nm = cleanName(r.raw?.nm);
  if (!nm) { console.log(`  （没起名或失败）${text}`); continue; }
  n++;
  const pass = inCharset(nm);
  if (pass) ok++; else for (const c of nm) if (!inCharset(c)) miss[c] = (miss[c] || 0) + 1;
  console.log(`  ${pass ? '✓' : '✗'} ${nm}　←　${text}`);
}
console.log(`\n全在字表里：${ok}/${n}`);
console.log('缺的字：' + Object.entries(miss).sort((a, b) => b[1] - a[1]).map(([c, k]) => `${c}×${k}`).join(' '));
