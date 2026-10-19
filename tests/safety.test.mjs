// 内容安全与书法字表的单测：node --test tests/
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHARSET, CORE, LEVEL1, UI_TEXTS, inCharset } from '../game/rules/charset.js';
import { defaultName, sanitizeIntent, usableName } from '../game/rules/intent.js';
import { ELEMENTS, FORMS, FUSIONS } from '../game/rules/numbers.js';
import { maskText, nameIsClean } from '../game/rules/safety.js';

// ---------------------------------------------------------------- 字表
test('字表：一级字正好 3755 个且没有解码失败的字；完整字表包含手挑的那份', () => {
  assert.equal([...LEVEL1].length, 3755);
  assert.ok(!LEVEL1.includes('�'));
  assert.ok([...CORE].every((c) => CHARSET.includes(c)));
});

test('字表：界面固定大字、所有默认名、融合名与成语都在先加载的那份里', () => {
  const core = new Set(CORE);
  const inCore = (s) => [...s].every((c) => core.has(c));
  const must = [...UI_TEXTS];
  for (const el of Object.keys(ELEMENTS)) for (const f of Object.keys(FORMS)) must.push(ELEMENTS[el].name + FORMS[f].name);
  for (const f of Object.values(FUSIONS)) must.push(f.name, f.idiom);
  const bad = must.filter((s) => !inCore(s));
  assert.deepEqual(bad, [], `这些字不在先加载的字表里：${bad.join('、')}`);
});

test('字表：名字里有表外的字（繁体、生僻字）就换默认名', () => {
  assert.equal(usableName('越權·雷彈'), '');
  assert.equal(usableName('霜缚·狂风'), '霜缚·狂风');
  const it = sanitizeIntent({ s: [{ e: 'ice', f: 'bolt' }], nm: '冰龘' }, '冰弹');
  assert.equal(it.name, '冰弹');
});

// ---------------------------------------------------------------- 原话
test('原话：敏感词换成＊，拆写、全角、繁体、英文大小写都认得，其余照常', () => {
  assert.equal(maskText('傻逼火球打最前面').text, '＊＊火球打最前面');
  assert.equal(maskText('傻 逼火球').text, '＊ ＊火球');
  assert.equal(maskText('傻_逼火球').text, '＊＊＊火球');
  assert.equal(maskText('他媽的冰弹').text, '＊＊＊冰弹');
  assert.equal(maskText('ＳＢ风墙').text, '＊＊风墙');
  assert.equal(maskText('Fuck 火雨').text, '＊＊＊＊ 火雨');
  const r = maskText('火球砸向最前面那只');
  assert.deepEqual(r, { text: '火球砸向最前面那只', hit: false });
});

test('原话：游戏里的正常说法不误伤', () => {
  for (const s of ['干掉他们', '冰霜逼近敌人', '我操控狂风吹走他们', '今日你们都得死', '给他们一个大麻烦', '去死吧傀儡', '把这些垃圾烧掉']) {
    assert.equal(maskText(s).hit, false, s);
  }
});

test('原话：盖掉以后模型解析不受影响（关键词解析照样认出火和最前面）', () => {
  const text = maskText('傻逼，火球打最前面').text;
  const it = sanitizeIntent({ s: [{ e: 'fire', f: 'bolt', t: 'front', w: { e: '火球', t: '最前面' } }], nm: '烈焰' }, text);
  assert.equal(it.steps[0].el, 'fire');
  assert.equal(it.steps[0].words.t, '最前面');
});

// ---------------------------------------------------------------- 名字
test('名字：含敏感词、骂人的轻话、广告就换默认名', () => {
  for (const nm of ['傻逼火球', '你这个小笨蛋', '快来买装备', '加微信领火球']) assert.equal(nameIsClean(nm), false, nm);
  const it = sanitizeIntent({ s: [{ e: 'fire', f: 'bolt' }], nm: '你这个小笨蛋' }, '火球');
  assert.equal(it.name, '火弹');
  assert.equal(nameIsClean('焚天·尽火'), true);
});

test('名字：默认名本身永远可用', () => {
  const steps = [{ el: 'wind', form: 'wall' }, { el: 'earth', form: 'rain' }];
  assert.ok(inCharset(defaultName(steps)) && nameIsClean(defaultName(steps)));
});
