// 召唤与气势槽的单测：node --test tests/
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planCast } from '../game/rules/arbiter.js';
import { sanitizeIntent } from '../game/rules/intent.js';
import { parseKeywords } from '../game/rules/keywords.js';
import { FORMS, MOMENTUM_MULT, SUMMONS, ULT_GAUGE } from '../game/rules/numbers.js';

const ctx = (over = {}) => ({ mana: 100, lastCombo: null, seen: [], said: [], text: '', gauge: ULT_GAUGE, ...over });
const intentOf = (raw, text = '召唤冰龙') => sanitizeIntent(raw, text);
const iceDragon = (extra = {}) => intentOf({ s: [{ e: 'ice', f: 'bolt', t: 'left' }], m: 2, c: 'ice', ...extra });

test('召唤：气势槽满、法力够、冰龙已开放 → 召出，扣召唤的法力，槽清零，伤害吃气势与首次发现', () => {
  const plan = planCast(iceDragon(), ctx());
  assert.equal(plan.ok, true);
  assert.equal(plan.summon?.cast, true);
  assert.equal(plan.summon?.target, 'left', '龙砸向这句第一步说的目标');
  assert.equal(plan.cost, SUMMONS.ice.cost);
  assert.equal(plan.steps.length, 0);
  assert.equal(plan.gaugeSpent, true);
  assert.equal(plan.gaugeGain, 0);
  assert.ok(Math.abs((plan.summon?.dmg ?? 0) - SUMMONS.ice.dmg * MOMENTUM_MULT[2] * 1.2) < 1e-9);
  assert.deepEqual(plan.newlySeen, ['召唤:ice']);
  const again = planCast(iceDragon(), ctx({ seen: ['召唤:ice'] }));
  assert.ok((again.summon?.dmg ?? 0) < (plan.summon?.dmg ?? 0), '第二次召唤没有首次发现加成');
});

test('召唤：气势槽不满 → 差一口气，龙影散成冰雨，写明差几点，这一句的气势照常进槽', () => {
  const plan = planCast(iceDragon(), ctx({ gauge: 5 }));
  assert.equal(plan.ok, true);
  assert.equal(plan.summon?.cast, false);
  assert.equal(plan.summon?.ghost, true);
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].form, 'rain');
  assert.equal(plan.steps[0].el, 'ice');
  assert.equal(plan.steps[0].target, 'left');
  assert.equal(plan.cost, Math.round(FORMS.rain.cost * 1.5), '按冰雨扣法力（默认威力 2）');
  assert.match(plan.downgrades[0], /气势 5\/8，冰龙未至，化作冰雨/);
  assert.equal(plan.gaugeGain, 2);
  assert.ok(!plan.gaugeSpent);
});

test('召唤：气势槽满但法力不够 → 化作冰雨；冰雨也放不起就哑火', () => {
  const short = planCast(iceDragon(), ctx({ mana: 30 }));
  assert.equal(short.summon?.cast, false);
  assert.match(short.downgrades[0], /法力不足，冰龙未至，化作冰雨/);
  assert.equal(short.steps[0].form, 'rain');
  const broke = planCast(iceDragon(), ctx({ mana: 5 }));
  assert.equal(broke.ok, false);
  assert.equal(broke.summon?.ghost, false, '什么都没放出来就不演龙影');
});

test('召唤：没开放的龙（火龙）不管槽满不满都召不出，化作火雨；雷龙连雨都化不成', () => {
  const fire = planCast(intentOf({ s: [{ e: 'fire', f: 'bolt', t: 'strongest' }], c: 'fire' }, '召唤火龙'), ctx());
  assert.equal(fire.summon?.cast, false);
  assert.equal(fire.summon?.ghost, false);
  assert.match(fire.downgrades[0], /火龙尚未现世，化作火雨/);
  assert.equal(fire.steps[0].el, 'fire');
  const thunder = planCast(intentOf({ s: [], c: 'thunder' }, '召唤雷龙'), ctx());
  assert.equal(thunder.ok, false);
  assert.match(thunder.downgrades[0], /^雷龙尚未现世$/);
});

test('召唤：模型给了表外的召唤物（凤凰）就当没召唤；关键词解析认得冰龙、火龙，只说"召唤神龙"按句里的元素', () => {
  assert.equal(intentOf({ s: [{ e: 'fire' }], c: 'phoenix' }).summon, null);
  assert.equal(parseKeywords('召唤冰龙，向左边吐一颗冰弹').c, 'ice');
  assert.equal(parseKeywords('召唤火龙，朝最强的傀儡吐两颗火弹').c, 'fire');
  assert.equal(parseKeywords('以风之名，召唤神龙').c, 'wind');
  assert.equal(parseKeywords('火球打最前面那只').c, null);
  // 「召唤冰龙」这半句只是点名，不算一步；「龙卷风」不是龙
  assert.equal(parseKeywords('召唤冰龙，向左边吐一颗冰弹').s.length, 1);
  assert.equal(parseKeywords('先刮一阵龙卷风，再放一把火').s.length, 2);
  assert.equal(parseKeywords('先刮一阵龙卷风，再放一把火').c, null);
});

test('召唤：没有召唤时一切照旧（不带 gauge 也能算）', () => {
  const it = sanitizeIntent({ s: [{ e: 'fire', f: 'bolt' }], m: 1 }, '火球');
  const plan = planCast(it, { mana: 100 });
  assert.equal(plan.summon, undefined);
  assert.equal(plan.gaugeGain, 1);
});
