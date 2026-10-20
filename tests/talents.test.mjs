// 天赋与按键（设计文档第 4 节"天赋与按键"）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCROLLS, bindSpell, buttonGaugeGain, combineButtons, defaultIntent, scrollsFor, synergies, toggleTalent } from '../game/rules/talents.js';
import { planCast } from '../game/rules/arbiter.js';
import { parseKeywords } from '../game/rules/keywords.js';
import { sanitizeIntent } from '../game/rules/intent.js';
import { TALENT_MAX } from '../game/rules/numbers.js';

const CTX = { mana: 100, seen: [], said: [], text: '', gauge: 0, button: true };

test('选天赋：最多 3 个，没开放的选不了，再点一下取消', () => {
  let c = [];
  for (const el of ['fire', 'ice', 'wind', 'earth']) c = toggleTalent(c, el);
  assert.equal(c.length, TALENT_MAX);
  assert.deepEqual(c, ['fire', 'ice', 'wind']);
  assert.deepEqual(toggleTalent(['fire'], 'thunder'), ['fire'], '雷还没开放，不能选');
  assert.deepEqual(toggleTalent(c, 'ice'), ['fire', 'wind']);
});

test('羁绊：列出两两之间已开放的融合和反应', () => {
  const names = synergies(['ice', 'fire', 'wind']).map((s) => `${s.kind}:${s.name}`);
  for (const n of ['反应:蒸汽爆', '反应:碎冰', '融合:火卷风', '融合:烈焰冲击']) assert.ok(names.includes(n), `缺 ${n}`);
  assert.ok(!names.some((n) => n.includes('暴风雪')), '暴风雪还没开放，不该列出');
  assert.ok(!names.some((n) => n.includes('火旋风')), '火旋风这个反应还没做，不该列出');
  assert.deepEqual(synergies(['earth']), []);
});

test('按钮默认招：风爆打最密集，按键放的不按描写加气势槽', () => {
  const it = defaultIntent('wind');
  assert.equal(it.steps[0].form, 'burst');
  assert.equal(it.steps[0].target, 'densest');
  const plan = planCast(it, CTX);
  assert.ok(plan.ok);
  assert.equal(plan.gaugeGain, 0);
  // 升级过的按钮带着写那句话时的气势（只放大这一招），按的时候照样不加气势槽
  const upgraded = planCast({ ...it, momentum: 2 }, CTX);
  assert.equal(upgraded.momentum, 2);
  assert.equal(upgraded.gaugeGain, 0);
  // 打字的照旧按气势加
  assert.equal(planCast({ ...it, momentum: 2 }, { ...CTX, button: false, text: '狂风呼啸' }).gaugeGain, 2);
});

test('先按风再按火：两步打同一处，融合成火卷风；反过来是烈焰冲击', () => {
  const wf = planCast(combineButtons([defaultIntent('wind'), defaultIntent('fire')]), CTX);
  assert.equal(wf.steps.length, 1);
  assert.equal(wf.steps[0].fusion, 'wind>fire');
  const fw = planCast(combineButtons([defaultIntent('fire'), defaultIntent('wind')]), CTX);
  assert.equal(fw.steps[0].fusion, 'fire>wind');
});

test('先冰后火不融合：两步照放、组合八折，蒸汽爆留给命中时', () => {
  const plan = planCast(combineButtons([defaultIntent('ice'), defaultIntent('fire')]), CTX);
  assert.equal(plan.steps.length, 2);
  assert.ok(!plan.steps.some((s) => s.fusion));
  assert.equal(plan.cost, Math.round((10 * 1.5 + 10 * 1.5) * 0.8));
});

test('给按钮写咒：要用到这个元素；没领悟的元素那几步拿掉并提示；召唤和越权装不进', () => {
  const step = (el) => ({ el, form: 'bolt', target: 'front', power: 2, count: 1, path: 'straight', words: {} });
  const base = { momentum: 2, name: '霜火', unknown: [], overreach: false, notes: [], summon: null };
  assert.equal(bindSpell('fire', { ...base, steps: [step('ice')] }, ['fire', 'ice']).ok, false);
  const r = bindSpell('fire', { ...base, steps: [step('ice'), step('fire')] }, ['fire', 'wind']);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.intent.steps.map((s) => s.el), ['fire']);
    assert.ok(r.intent.notes.some((n) => n.includes('尚未领悟「冰」')));
  }
  assert.equal(bindSpell('ice', { ...base, steps: [step('ice')], summon: 'ice' }, ['ice']).ok, false);
  assert.equal(bindSpell('ice', { ...base, steps: [step('ice')], overreach: true }, ['ice']).ok, false);
});

test('按键攒气势：打中 3 个以上 +1，融合或反应 +2，一招最多 +2', () => {
  assert.equal(buttonGaugeGain({ hits: 2, combo: false }), 0);
  assert.equal(buttonGaugeGain({ hits: 3, combo: false }), 1);
  assert.equal(buttonGaugeGain({ hits: 1, combo: true }), 2);
  assert.equal(buttonGaugeGain({ hits: 6, combo: true }), 2);
});

test('卷轴：每句用关键词解析也读得对——用到的元素正好是标的那些，装得进自己元素的按钮', () => {
  for (const [el, list] of Object.entries(SCROLLS)) {
    if (el === 'thunder') continue;   // 雷还没开放
    for (const s of list) {
      const intent = sanitizeIntent(parseKeywords(s.text), s.text);
      const found = [...new Set(intent.steps.map((x) => x.el))].sort();
      assert.deepEqual(found, [...s.els].sort(), `「${s.text}」读出的元素是 ${found}`);
      assert.ok(bindSpell(el, intent, s.els).ok, `「${s.text}」装不进${el}的按钮`);
    }
  }
});

test('卷轴：只挑天赋里都有的句子，每次轮着换一批', () => {
  const onlyIce = scrollsFor('ice', ['ice'], 9, 0);   // 要得比卷轴里的句子还多：全部候选都得过滤过
  assert.ok(onlyIce.length >= 3 && onlyIce.every((t) => !t.includes('火')), '没选火，不该给带火的句子');
  assert.notDeepEqual(scrollsFor('ice', ['ice', 'fire'], 3, 0), scrollsFor('ice', ['ice', 'fire'], 3, 3));
});

test('召唤按钮：气势 0 档召冰龙，基础伤害与范围', () => {
  const plan = planCast({ steps: [], momentum: 0, name: '冰龙', unknown: [], overreach: false, notes: [], summon: 'ice' },
    { ...CTX, gauge: 8, seen: ['召唤:ice'] });
  assert.ok(plan.summon?.cast);
  assert.equal(plan.summon?.dmg, 120);
  assert.equal(plan.summon?.radius, 5);
  assert.equal(plan.gaugeSpent, true);
});
