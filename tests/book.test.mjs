// 咒语图鉴（设计文档第 2 节"咒语图鉴"）
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { damageTo, planCast } from '../game/rules/arbiter.js';
import { BOOK, BOOK_TOTAL, lightCells, readBook } from '../game/rules/book.js';
import { sanitizeIntent } from '../game/rules/intent.js';
import { parseKeywords } from '../game/rules/keywords.js';
import { ELEMENTS, FORMS, FUSION_OPEN, INPUT_MAX_CHARS, MANA_MAX, REACTIONS, SUMMON_OPEN, ULT_GAUGE } from '../game/rules/numbers.js';

const CELLS = BOOK.flatMap((s) => s.cells), KEYS = new Set(CELLS.map((c) => c.key));
const plan = (text) => planCast(sanitizeIntent(parseKeywords(text), text), { mana: MANA_MAX, text });

test('格子不重：键、名字都不重，总数对得上', () => {
  assert.equal(BOOK_TOTAL, CELLS.length);
  assert.equal(KEYS.size, CELLS.length);
  assert.equal(new Set(CELLS.map((c) => c.name)).size, CELLS.length);
  assert.equal(BOOK_TOTAL, 20 + 2 + 5 + 5 + 4);
  for (const c of CELLS) assert.ok(c.name && c.hint, c.key);
  for (const s of BOOK) assert.ok(s.cells.length <= s.n * 5, '一行放得下');
});

test('五行四式：每一格的提示照着念，点亮的正是这一格', () => {
  const grid = BOOK[0];
  assert.equal(grid.cells.length, Object.keys(ELEMENTS).length * Object.keys(FORMS).length);
  for (const c of grid.cells) {
    const said = c.hint.replace(/^说：/, '');
    assert.ok(plan(said).newlySeen.includes(c.key), `${c.key}：${said}`);
  }
});

test('融合、召龙的键和 planCast 写的一样', () => {
  const raw = { 'wind>fire': ['wind', 'fire'], 'fire>wind': ['fire', 'wind'] };
  for (const k of FUSION_OPEN) {
    const intent = sanitizeIntent({ s: raw[k].map((e) => ({ e, f: 'burst', t: 'front' })) }, '');
    const seen = planCast(intent, { mana: MANA_MAX, text: '' }).newlySeen;
    assert.ok(seen.includes(`融合:${k}`));
    for (const key of seen) assert.ok(KEYS.has(key), key);
  }
  for (const el of SUMMON_OPEN) {
    const intent = sanitizeIntent({ s: [], c: el, m: 3 }, `召唤${el}`);
    const p = planCast(intent, { mana: MANA_MAX, text: '', gauge: ULT_GAUGE, ult: ULT_GAUGE });
    assert.deepEqual(p.newlySeen, [`召唤:${el}`]);
    assert.ok(KEYS.has(`召唤:${el}`));
  }
});

test('反应的键和 damageTo 给的名字一样', () => {
  const frozen = { type: 'grunt', frozen: true }, plain = { type: 'grunt', frozen: false };
  for (const [foe, hit, want] of [[frozen, { el: 'fire', dmg: 10 }, 'ice+fire'], [frozen, { el: 'wind', dmg: 10 }, 'ice+wind'], [frozen, { el: 'thunder', dmg: 10 }, 'ice+thunder'],
    [plain, { el: 'fire', dmg: 10, whirl: true }, 'wind+fire'], [plain, { el: 'earth', dmg: 30, rock: true }, 'earth+wind']]) {
    const r = damageTo(foe, hit).reaction;
    assert.equal(r, REACTIONS[want].name);
    assert.ok(KEYS.has(`反应:${r}`), r);
  }
  assert.ok(!KEYS.has('反应:'), '没反应不算');
  assert.ok(!KEYS.has('反应:华表'), '砸人的飘字不进图鉴');
});

test('点亮：记第一次的话，亮过的不改，不认识的不管，原来那份不动', () => {
  const a = lightCells({}, ['fire+bolt', 'ice+rain', 'fire+bolt', '没有这格'], '火弹打它');
  assert.deepEqual(a.fresh, ['火弹', '冰雨']);
  assert.deepEqual(a.book, { 'fire+bolt': '火弹打它', 'ice+rain': '火弹打它' });
  const b = lightCells(a.book, ['fire+bolt', 'wind+wall'], '第二句');
  assert.deepEqual(b.fresh, ['风墙']);
  assert.equal(b.book['fire+bolt'], '火弹打它', '留着第一次的');
  assert.equal(a.book['wind+wall'], undefined);
  const same = lightCells(a.book, ['fire+bolt'], '再说一遍');
  assert.equal(same.book, a.book, '没亮新的就不用存');
  assert.deepEqual(same.fresh, []);
  assert.deepEqual(lightCells({}, [], '').fresh, []);
  assert.equal(lightCells({}, ['constructor'], '').book.constructor, Object, '原型上的名字不算格子');
  const long = lightCells({}, ['fire+bolt'], '火'.repeat(INPUT_MAX_CHARS + 9));
  assert.equal(long.book['fire+bolt'].length, INPUT_MAX_CHARS);
  assert.equal(lightCells({}, ['fire+bolt'], '').book['fire+bolt'], '', '按钮放的没有话，也算亮了');
});

test('读回来：存进去的读得回来，坏的、改过的都不要', () => {
  const { book } = lightCells({}, ['fire+bolt', '物件:rope'], '一句话');
  assert.deepEqual(readBook(JSON.stringify(book)), book);
  assert.deepEqual(readBook(null), {});
  assert.deepEqual(readBook(''), {});
  assert.deepEqual(readBook('{坏了'), {});
  assert.deepEqual(readBook('[1,2]'), {});
  assert.deepEqual(readBook('"fire+bolt"'), {});
  assert.deepEqual(readBook('{"fire+bolt":3,"没有这格":"x","ice+bolt":"冰"}'), { 'ice+bolt': '冰' });
  assert.equal(readBook(JSON.stringify({ 'fire+bolt': '火'.repeat(999) }))['fire+bolt'].length, INPUT_MAX_CHARS);
});
