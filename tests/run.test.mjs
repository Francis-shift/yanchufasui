// 试炼的一局（game/rules/run.js）：怎么排、出哪几张卡、拿了 / 重抽 / 不拿、心法加成；以及加成在裁决器、完美闪避判定里生效。
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planCast, regenMana } from '../game/rules/arbiter.js';
import { inCharset } from '../game/rules/charset.js';
import { MANA_MAX, MANA_REGEN, RUN, TRIAL, ULT_GAUGE } from '../game/rules/numbers.js';
import {
  BOSS_COUNT, CARDS, RUN_STAGES, eligible, newRun, offer, reroll, runMods, skip, take, upLabel, weight,
} from '../game/rules/run.js';
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
  // 心法全拿完、别的又都没做好：一张也出不了
  let full = newRun();
  for (const c of CARDS.filter((x) => x.ready)) full = take(full, c);
  assert.deepEqual(offer(full, { els: ELS, insight: false }, rng(3)), []);
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

test('拿了：记一级、再出带「·二」；不拿记一次；重抽每局一次、尽量不出刚才那几张', () => {
  let run = newRun();
  const b = byId('burst');
  assert.equal(upLabel(run, b), '');
  run = take(run, b, 'ice');
  assert.equal(run.picks, 1);
  assert.equal(run.have.burst, 1);
  assert.equal(upLabel(run, b), '·二');
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
  assert.deepEqual(base, { perfectWindow: TRIAL.perfect.window, perfectGauge: TRIAL.perfect.gauge, manaRegen: 1, ult: ULT_GAUGE });
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
