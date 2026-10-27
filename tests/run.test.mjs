// 试炼的一局（game/rules/run.js）：怎么排、出哪几张卡、拿了 / 重抽 / 不拿、心法加成；以及加成在裁决器、完美闪避判定里生效。
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planCast, regenMana } from '../game/rules/arbiter.js';
import { inCharset } from '../game/rules/charset.js';
import { FUSION_OPEN, MANA_MAX, MANA_REGEN, RUN, TRIAL, ULT_GAUGE } from '../game/rules/numbers.js';
import {
  BOSS_COUNT, CARDS, RUN_STAGES, artBoost, boostPlan, buttonMove, eligible, limitToLearned, moveName, moveTargets, native, newRun, offer,
  previewMove, reroll, runFusions, runMods, skip, take, upLabel, weight,
} from '../game/rules/run.js';
import { combineButtons, defaultIntent } from '../game/rules/talents.js';
import { isPerfect } from '../game/rules/trial.js';

/** 固定种子的随机数，结果可复现 @param {number} seed */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 全部当作已做好的一池卡：测出卡规则本身，不受"哪些效果做好了"影响 */
const ALL = CARDS.map((c) => ({ ...c, ready: true }));
const ELS = ['fire', 'ice', 'wind'];
const byId = (id) => ALL.find((c) => c.id === id);

test('一局：小怪潮开头，小怪潮与三个 boss 交替，每段之间三选一，打完 boss 那次是领悟，最后一个 boss 之后不再选卡', () => {
  assert.equal(RUN_STAGES[0].kind, 'wave');
  assert.equal(RUN_STAGES[1].kind, 'pick', '第一次三选一紧跟第一段小怪潮（开局 1 分钟内）');
  assert.equal(BOSS_COUNT, 3);
  assert.deepEqual(RUN_STAGES.filter((s) => s.kind === 'boss').map((s) => s.n), [1, 2, 3]);
  assert.equal(RUN_STAGES.at(-1)?.kind, 'boss', '打完最后一个 boss 直接结算');
  for (let i = 0; i + 1 < RUN_STAGES.length; i++) {
    const a = RUN_STAGES[i], b = RUN_STAGES[i + 1];
    if (a.kind !== 'pick') assert.equal(b.kind, 'pick', `第 ${i} 段（${a.kind}）后面要三选一`);
    if (b.kind === 'pick') assert.equal(!!b.insight, a.kind === 'boss', `第 ${i + 1} 段：只有打完 boss 那次是领悟`);
  }
  const W = RUN.wave;
  assert.ok(W.first + (W.n[0] - 1) * W.every < 30, '第一段小怪 30 秒内冒完，第一次选卡赶得上 1 分钟');
});

test('卡池：编号不重复，名字每个字都在书法字表里，说明不空', () => {
  assert.equal(new Set(CARDS.map((c) => c.id)).size, CARDS.length);
  const bad = CARDS.filter((c) => !inCharset(c.name) || !c.text);
  assert.deepEqual(bad.map((c) => c.name), []);
  for (const kind of ['move', 'rune', 'art', 'insight']) assert.ok(CARDS.some((c) => c.kind === kind), `有${kind}`);
});

test('能出的卡：效果没做好的不出；手上没有的元素的字诀不出；合字两个元素都要有；领悟新元素要手上没有；拿满了不出', () => {
  const run = newRun();
  for (const c of CARDS.filter((x) => !x.ready)) assert.equal(eligible(c, run, ELS), false, `${c.name} 还没做好`);
  assert.equal(eligible(byId('liao'), run, ELS), true);
  assert.equal(eligible(byId('fan'), run, ELS), false, '没有土，不出「返」');
  assert.equal(eligible(byId('he-fire-wind'), run, ['fire', 'ice']), false, '没有风，不出「火借风威」');
  assert.equal(eligible(byId('he-fire-wind'), run, ELS), true);
  assert.equal(eligible(byId('learn-fire'), run, ELS), false, '已经有火');
  assert.equal(eligible(byId('learn-earth'), run, ELS), true);
  const once = take(run, byId('jianqie'));
  assert.equal(eligible(byId('jianqie'), once, ELS), false, '心法只拿一次');
  const burst1 = take(run, byId('burst'), 'fire');
  assert.equal(eligible(byId('burst'), burst1, ELS), true, '「爆」能再拿一次（升级）');
  assert.equal(eligible(byId('burst'), take(burst1, byId('burst'), 'fire'), ELS), false);
});

test('出卡：三张不重复；第一张招式字或字诀、第二张心法、第三张随机；打完 boss 第三张是领悟；第一次选卡第一张必是招式字', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = rng(seed);
    const first = offer(newRun(), { els: ELS, insight: false }, r, [], ALL);
    assert.equal(first.length, 3);
    assert.equal(new Set(first).size, 3);
    assert.equal(first[0].kind, 'move', '第一次选卡保证有招式字');
    assert.equal(first[1].kind, 'art');
    assert.notEqual(first[2].kind, 'insight', '平常不出领悟');
    const later = { ...newRun(), picks: 2 };
    const after = offer(later, { els: ELS, insight: true }, r, [], ALL);
    assert.ok(['move', 'rune'].includes(after[0].kind));
    assert.equal(after[1].kind, 'art');
    assert.equal(after[2].kind, 'insight', '打完 boss 第三张是领悟');
    for (const c of [...first, ...after]) assert.ok(eligible(c, later, ELS), `${c.name} 不该出`);
  }
});

test('出卡：只出效果做好的；某一类抽不出就从别的能出的补，再没有就少几张', () => {
  const run = newRun();
  const cards = offer(run, { els: ELS, insight: true }, rng(7));
  assert.ok(cards.length > 0 && cards.length <= 3);
  for (const c of cards) assert.ok(c.ready, `${c.name} 还没做好，不该出`);
  assert.ok(cards.every((c) => c.kind !== 'insight' || c.ready));
  // 做好的卡全拿满、别的又都没做好：一张也出不了
  let full = newRun();
  for (const c of CARDS.filter((x) => x.ready)) for (let i = 0; i < c.max; i++) full = take(full, c);
  assert.deepEqual(offer(full, { els: ELS, insight: true }, rng(3)), []);
});

test('押过的元素：带这个元素的卡出现的分量 × RUN.owned，抽到的次数约是两倍', () => {
  const run = newRun();
  assert.equal(weight(byId('liao'), run), 1);
  const fireRun = take(run, byId('burst'), 'fire');
  assert.deepEqual(fireRun.invest, ['fire'], '把「爆」换进火的按钮，押在火上');
  assert.equal(weight(byId('liao'), fireRun), RUN.owned);
  assert.equal(weight(byId('ning'), fireRun), 1);
  assert.equal(weight(byId('he-wind-fire'), fireRun), RUN.owned, '合字带着火');
  // 只有燎、凝两张能抽时，押了火的那局抽到燎的比例约 2/3
  const pool = ALL.filter((c) => c.id === 'liao' || c.id === 'ning');
  const r = rng(11);
  let liao = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) if (offer({ ...fireRun, picks: 1 }, { els: ELS, insight: false }, r, [], pool)[0].id === 'liao') liao++;
  assert.ok(Math.abs(liao / N - 2 / 3) < 0.04, `抽到燎 ${liao}/${N}`);
});

test('拿了：记一级、再出带「·二」（招式字不在卡上标，选按钮时标）；不拿记一次；重抽每局一次、尽量不出刚才那几张', () => {
  let run = newRun();
  const b = byId('burst');
  const twice = { ...byId('po'), max: 2 };
  assert.equal(upLabel(run, twice), '');
  assert.equal(upLabel(take(run, twice), twice), '·二');
  run = take(run, b, 'ice');
  assert.equal(run.picks, 1);
  assert.equal(run.have.burst, 1);
  assert.equal(upLabel(run, b), '');
  const s = skip(run);
  assert.equal(s.picks, 2);
  assert.equal(s.skips, 1);
  assert.deepEqual(s.have, run.have);
  const ctx = { els: ELS, insight: false };
  const shown = offer(run, ctx, rng(5), [], ALL);
  const r1 = reroll(run, ctx, rng(6), shown, ALL);
  assert.ok(r1);
  assert.equal(r1.run.rerolls, RUN.rerolls - 1);
  assert.equal(r1.cards.length, 3);
  for (const c of r1.cards) assert.ok(!shown.includes(c), `重抽又出了${c.name}`);
  assert.equal(reroll(r1.run, ctx, rng(7), r1.cards, ALL), null, '每局只能重抽一次');
});

test('心法加成：没拿是原值；见切放宽完美闪避窗口、聚气多加气势、回元回得快、龙吟召龙格数变少', () => {
  const base = runMods(newRun());
  assert.deepEqual(base, { perfectWindow: TRIAL.perfect.window, perfectGauge: TRIAL.perfect.gauge, manaRegen: 1, ult: ULT_GAUGE,
    chana: false, fanshou: false, canying: false, yuwei: false });
  let run = newRun();
  for (const id of ['jianqie', 'juqi', 'huiyuan', 'longyin']) run = take(run, byId(id));
  const m = runMods(run);
  assert.equal(m.perfectWindow, RUN.arts.window);
  assert.equal(m.perfectGauge, RUN.arts.gauge);
  assert.equal(m.manaRegen, RUN.arts.regen);
  assert.equal(m.ult, RUN.arts.ult);
  // 见切：0.4 秒前按的闪避，原来不算完美，拿了算
  assert.equal(isPerfect(0.4, true), false);
  assert.equal(isPerfect(0.4, true, m.perfectWindow), true);
  assert.equal(isPerfect(0.4, false, m.perfectWindow), false, '早早走开的仍不算');
  // 回元：法力回复 × 1.3，不超过上限
  assert.equal(regenMana(0, 1, m.manaRegen), MANA_REGEN * RUN.arts.regen);
  assert.equal(regenMana(MANA_MAX - 1, 1, m.manaRegen), MANA_MAX);
  // 龙吟：气势 6 格就召得出，原来差一口气
  const summon = { steps: [], momentum: 0, name: '冰龙', unknown: [], overreach: false, notes: [], summon: 'ice' };
  const ctx = { mana: MANA_MAX, gauge: RUN.arts.ult, button: true };
  assert.equal(planCast(summon, ctx).summon?.cast, false);
  assert.equal(planCast(summon, { ...ctx, ult: m.ult }).summon?.cast, true);
});

test('心法刹那、反手、残影、余威：拿了才开；反手余威的加伤按窗口算、两个都在相乘，每步每颗和龙都乘上', () => {
  let run = newRun();
  for (const id of ['chana', 'fanshou', 'canying', 'yuwei']) run = take(run, byId(id));
  const m = runMods(run);
  assert.deepEqual([m.chana, m.fanshou, m.canying, m.yuwei], [true, true, true, true]);
  assert.equal(m.perfectWindow, TRIAL.perfect.window, '这四个不动闪避窗口');
  // 窗口
  assert.deepEqual(artBoost({ counter: 0, after: 0 }), { k: 1, counter: false, after: false });
  assert.equal(artBoost({ counter: 0.2, after: 0 }).k, RUN.arts.counter.mult);
  assert.equal(artBoost({ counter: 0, after: 3 }).k, RUN.arts.after.mult);
  assert.equal(artBoost({ counter: 1, after: 1 }).k, RUN.arts.counter.mult * RUN.arts.after.mult);
  // 加伤：三颗火弹每颗和总数都乘 1.5，消耗不变；k = 1 原样返回
  const bolt = { steps: [{ el: 'fire', form: 'bolt', target: 'nearest', power: 2, count: 3, path: 'straight', words: {} }],
    momentum: 0, name: '', unknown: [], overreach: false, notes: [], summon: null };
  const plan = planCast(bolt, { mana: MANA_MAX, button: true });
  const up = boostPlan(plan, 1.5);
  assert.equal(up.steps[0].dmgTotal, plan.steps[0].dmgTotal * 1.5);
  assert.equal(up.steps[0].dmgEach, plan.steps[0].dmgEach * 1.5);
  assert.equal(up.cost, plan.cost);
  assert.equal(plan.steps[0].dmgTotal, planCast(bolt, { mana: MANA_MAX, button: true }).steps[0].dmgTotal, '原计划不被改');
  assert.equal(boostPlan(plan, 1), plan);
  const dragon = planCast({ ...bolt, steps: [], summon: 'ice' }, { mana: MANA_MAX, gauge: ULT_GAUGE, button: true });
  assert.ok(dragon.summon?.cast && dragon.summon.dmg > 0);
  assert.equal(boostPlan(dragon, 1.3).summon?.dmg, /** @type {any} */ (dragon.summon).dmg * 1.3);
});

/** 一步法术（按钮写的咒清洗后长这样） */
const step = (el, form, o = {}) => ({ el, form, target: 'front', power: 2, count: 1, path: 'straight', words: {}, ...o });
const spell = (...steps) => ({ steps, momentum: 0, name: '', unknown: [], overreach: false, notes: [], summon: null });

test('开局只会本命招：火、冰、雷是弹，风是爆，土是墙，单颗、直线', () => {
  const run = newRun();
  assert.deepEqual(native('fire'), { form: 'bolt', path: 'straight', count: 1 });
  for (const [el, form] of [['fire', 'bolt'], ['ice', 'bolt'], ['thunder', 'bolt'], ['wind', 'burst'], ['earth', 'wall']]) {
    assert.equal(buttonMove(run, el).form, form, el);
    assert.deepEqual(limitToLearned(defaultIntent(el), run, el).steps.map((s) => s.form), [form], `${el} 的默认招照常放`);
  }
});

test('写了没学会的形态、轨迹、颗数：按这个元素按钮现在的招放，标灰「尚未领悟」', () => {
  const run = newRun();
  const rain = limitToLearned(spell(step('fire', 'rain')), run, 'fire');
  assert.equal(rain.steps[0].form, 'bolt');
  assert.deepEqual(rain.notes, ['尚未领悟「雨」，按「弹」放']);
  const fancy = limitToLearned(spell(step('fire', 'bolt', { count: 3, path: 'sky' })), run, 'fire');
  assert.equal(fancy.steps[0].count, 1);
  assert.equal(fancy.steps[0].path, 'straight');
  assert.deepEqual(fancy.notes, ['尚未领悟「天降」，按直线放', '尚未领悟「三颗」，按一颗放']);
  // 装在火按钮上的句子里有一步冰爆：冰没学过爆，按冰的弹放
  const mixed = limitToLearned(spell(step('fire', 'bolt'), step('ice', 'burst')), run, 'fire');
  assert.deepEqual(mixed.steps.map((s) => s.form), ['bolt', 'bolt']);
  assert.deepEqual(mixed.notes, ['尚未领悟「爆」，按「弹」放']);
  // 风本来就会爆
  assert.deepEqual(limitToLearned(spell(step('wind', 'burst')), run, 'wind').notes, []);
});

test('招式字能换进哪几个按钮：形态哪个都行（升过级的同形态除外）；天降、绕后、三颗只换得了弹', () => {
  const run = newRun();
  assert.deepEqual(moveTargets(run, byId('burst'), ELS), ['fire', 'ice', 'wind'], '风已是爆：换进去是升级');
  assert.deepEqual(moveTargets(run, byId('sky'), ['fire', 'wind', 'earth']), ['fire']);
  assert.deepEqual(moveTargets(run, byId('three'), ['wind', 'earth']), []);
  assert.equal(eligible(byId('three'), run, ['wind', 'earth']), false, '没有弹的按钮，不出「三颗」');
  const up = take(run, byId('burst'), 'wind');
  assert.deepEqual(moveTargets(up, byId('burst'), ELS), ['fire', 'ice'], '风的爆升过级了');
  const sky = take(run, byId('sky'), 'fire');
  assert.deepEqual(moveTargets(sky, byId('sky'), ELS), ['ice'], '火已经天降');
});

test('换进按钮：按钮的招跟着变，写过咒的按钮这个元素的那一步也换；学过的形态再换进来是升级，范围 × RUN.up', () => {
  let run = take(newRun(), byId('rain'), 'fire');
  assert.equal(buttonMove(run, 'fire').form, 'rain');
  assert.deepEqual(run.invest, ['fire']);
  assert.equal(limitToLearned(defaultIntent('fire'), run, 'fire').steps[0].form, 'rain', '没写咒的火按钮放火雨');
  const bound = limitToLearned(spell(step('fire', 'bolt', { target: 'strongest' })), run, 'fire');
  assert.equal(bound.steps[0].form, 'rain', '写了「火弹」的火按钮也换成雨');
  assert.equal(bound.steps[0].target, 'strongest', '打谁照原话');
  assert.equal(limitToLearned(spell(step('fire', 'rain')), run, 'ice').steps[0].form, 'rain', '火学会了雨，装在别的按钮上的火雨也放得出');
  assert.equal(limitToLearned(spell(step('ice', 'rain')), run, 'fire').steps[0].form, 'bolt', '冰没学过雨');
  // 再拿一次雨换进火：升级
  assert.deepEqual(previewMove(run, byId('rain'), 'fire'), { name: '火雨·二', up: true });
  run = take(run, byId('rain'), 'fire');
  assert.equal(limitToLearned(defaultIntent('fire'), run, 'fire').steps[0].wide, RUN.up);
  assert.equal(limitToLearned(defaultIntent('ice'), run, 'ice').steps[0].wide, undefined);
  // 风本命就是爆，换一张爆进去直接升级
  const wind = take(newRun(), byId('burst'), 'wind');
  assert.equal(limitToLearned(defaultIntent('wind'), wind, 'wind').steps[0].wide, RUN.up);
  assert.equal(moveName(wind, 'wind', buttonMove(wind, 'wind')), '风爆·二');
  // 弹的轨迹、颗数叠在一起；换成别的形态后就没有了
  let bolt = take(take(newRun(), byId('sky'), 'ice'), byId('three'), 'ice');
  assert.equal(moveName(bolt, 'ice', buttonMove(bolt, 'ice')), '冰弹×3·天降');
  bolt = take(bolt, byId('wall'), 'ice');
  assert.deepEqual(buttonMove(bolt, 'ice'), { form: 'wall', path: 'straight', count: 1 });
});

test('合字：领悟前两个按钮先后按只是组合（各放各的、八折），领悟后同样的按法合成融合；守关照常全开', () => {
  const run = newRun();
  assert.deepEqual(runFusions(run), []);
  const press = (r) => combineButtons(['fire', 'wind'].map((el) => limitToLearned(defaultIntent(el), r, el)));
  const ctx = { mana: MANA_MAX, button: true };
  const before = planCast(press(run), { ...ctx, fusions: runFusions(run) });
  assert.equal(before.steps.length, 2);
  assert.ok(before.steps.every((s) => !s.fusion));
  const learned = take(run, byId('he-fire-wind'));
  assert.deepEqual(runFusions(learned), ['fire>wind']);
  const after = planCast(press(learned), { ...ctx, fusions: runFusions(learned) });
  assert.equal(after.steps.length, 1);
  assert.equal(after.steps[0].fusionName, '豪火灭却');
  assert.equal(after.cost, before.cost, '消耗不变');
  // 只领悟了先火后风：先风后火仍是组合
  const wf = combineButtons(['wind', 'fire'].map((el) => limitToLearned(defaultIntent(el), learned, el)));
  assert.ok(planCast(wf, { ...ctx, fusions: runFusions(learned) }).steps.every((s) => !s.fusion));
  // 守关不传 fusions：按 FUSION_OPEN 全开
  assert.equal(planCast(press(run), ctx).steps[0].fusion, 'fire>wind');
  assert.ok(FUSION_OPEN.includes('wind>fire'));
});