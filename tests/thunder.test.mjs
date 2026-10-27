// 雷（设计文档第 4 节元素表："连锁：命中后跳到 3 米内最近的 2 个敌人，每跳伤害 ×0.6；麻痹 0.5 秒"；反应"冰→雷 导电"）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainTargets, damageTo, planCast } from '../game/rules/arbiter.js';
import { parseKeywords } from '../game/rules/keywords.js';
import { sanitizeIntent } from '../game/rules/intent.js';
import { ELEMENTS } from '../game/rules/numbers.js';

const E = (id, x, z, frozen = false) => ({ id, x, z, frozen });

test('连锁：每次跳到 3 米内最近的、没打过的，最多跳 2 次，每跳 ×0.6', () => {
  const list = [E('a', 0, 0), E('b', 2, 0), E('c', 4.5, 0), E('d', 0, 2.5), E('far', 9, 0)];
  const j = chainTargets('a', list, 100);
  assert.deepEqual(j.map((x) => x.id), ['b', 'c'], 'a 先跳最近的 b（2 米），再从 b 跳到 c（2.5 米）');
  assert.equal(j[0].from, 'a');
  assert.equal(j[1].from, 'b');
  assert.ok(Math.abs(j[0].dmg - 60) < 1e-9 && Math.abs(j[1].dmg - 36) < 1e-9);
  assert.equal(j.length, ELEMENTS.thunder.chain.jumps);
  assert.deepEqual(chainTargets('far', list, 100), [], '3 米内没人就不跳');
});

test('字诀「引」：连锁多跳几次，范围和衰减照旧', () => {
  const line = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => E(id, i * 2, 0));
  assert.deepEqual(chainTargets('a', line, 100).map((x) => x.id), ['b', 'c']);
  const j = chainTargets('a', line, 100, 2);
  assert.deepEqual(j.map((x) => x.id), ['b', 'c', 'd', 'e']);
  assert.ok(Math.abs(j[3].dmg - 100 * 0.6 ** 4) < 1e-9);
});

test('导电：从冻住的跳到冻住的不衰减，有一头没冻就照常衰减', () => {
  const j = chainTargets('a', [E('a', 0, 0, true), E('b', 2, 0, true), E('c', 4, 0)], 100);
  assert.equal(j[0].conduct, true);
  assert.equal(j[0].dmg, 100);
  assert.equal(j[1].conduct, false);
  assert.ok(Math.abs(j[1].dmg - 60) < 1e-9);
});

test('雷打中：麻痹 0.5 秒；打冻住的算导电反应（并吃冻结的 1.5 倍）', () => {
  const r = damageTo({ type: 'grunt', frozen: false }, { el: 'thunder', dmg: 30 });
  assert.equal(r.stunSec, ELEMENTS.thunder.stunSec);
  assert.equal(r.reaction, '');
  const f = damageTo({ type: 'grunt', frozen: true }, { el: 'thunder', dmg: 30 });
  assert.equal(f.reaction, '导电');
  assert.equal(f.dmg, 45);
  assert.equal(damageTo({ type: 'grunt', frozen: false }, { el: 'fire', dmg: 30 }).stunSec, 0, '别的元素不麻痹');
});

test('雷弹：伤害系数 1.1，可以施放；关键词认得雷、电、霹雳', () => {
  const it = sanitizeIntent({ s: [{ e: 'thunder', f: 'bolt', t: 'front' }] }, '雷弹');
  assert.equal(it.steps.length, 1, '雷开放后不再"未生效"');
  const plan = planCast(it, { mana: 100 });
  assert.ok(plan.ok);
  assert.ok(Math.abs(plan.steps[0].dmgTotal - 30 * 1.1 * 1.5 * 1.2) < 1e-9, '弹 30 × 雷 1.1 × 威力 2 档 1.5 × 首次 1.2');
  for (const t of ['天雷劈向最前面那只', '电光落下', '霹雳一声']) {
    assert.equal(parseKeywords(t).s[0]?.e, 'thunder', t);
  }
});
