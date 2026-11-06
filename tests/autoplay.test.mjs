// 演示模式：脚本里每句话关键词都认得、演得出该演的；总长不超过 3 分钟；引擎一步一步走、打字、等得到才走、等不到也走、放完从头来、退得掉；自动走位躲得开红圈。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTOPLAY, Autoplay, TYPE, autoMove } from '../game/modes/autoplay.js';
import { parseKeywords } from '../game/rules/keywords.js';
import { sanitizeIntent } from '../game/rules/intent.js';
import { planCast } from '../game/rules/arbiter.js';
import { MOMENTUM_MAX, RUN } from '../game/rules/numbers.js';
import { inCircle } from '../game/rules/trial.js';

const typedSteps = AUTOPLAY.filter((s) => s.type);
/** 脚本里第 n 句放出来是什么（气势槽给满，召龙那句才召得出来） @param {number} n */
function planOf(n) {
  const text = typedSteps[n].type;
  const intent = sanitizeIntent(parseKeywords(text), text);
  return { intent, plan: planCast(intent, { mana: 100, lastCombo: null, seen: [], said: new Set(), text, gauge: 8, ult: 8, button: false }) };
}

test('脚本的每一句都放得出来：不靠模型，关键词就认得', () => {
  typedSteps.forEach((s, i) => {
    const { intent, plan } = planOf(i);
    assert.ok(plan.ok, `第 ${i + 1} 句放不出来：${s.type}`);
    assert.ok(intent.steps.length || intent.summon, `第 ${i + 1} 句什么也没认出来：${s.type}`);
  });
});

test('字幕说什么，放出来就是什么：分两步、融合、气势、反噬、召龙', () => {
  const find = (/** @type {string} */ say) => typedSteps.findIndex((s) => s.say.includes(say));
  assert.equal(planOf(find('分几步')).intent.steps.length, 2);
  assert.equal(planOf(find('新的法术')).plan.steps[0].fusionName, '火卷风');
  assert.ok(planOf(find('气势越足')).intent.momentum >= MOMENTUM_MAX, '这句要拉满气势才演得出"气势如虹"');
  assert.ok(planOf(find('反噬')).plan.backlash);
  assert.equal(planOf(find('召龙')).plan.summon?.el, 'ice');
  assert.equal(typedSteps.filter((_, i) => planOf(i).plan.backlash).length, 1, '只有一句越权');
});

test('法域这一段：等展开完才念，两句打完赶得上时限，念完再收束，接着放龙', () => {
  const at = AUTOPLAY.findIndex((s) => s.call === 'domain');
  assert.equal(AUTOPLAY[at].until, 'chanting');
  const lines = AUTOPLAY.slice(at + 1, at + 3);
  assert.ok(lines.every((s) => s.type));
  assert.equal(AUTOPLAY[at + 3].call, 'strike');
  assert.equal(AUTOPLAY[at + 4].call, 'dragon');
  assert.ok(lines.length <= RUN.domain.lines);
  const sec = lines.reduce((a, s) => a + [...s.type].length * TYPE.char + TYPE.hold + (s.sec ?? 0), 0);
  assert.ok(sec < RUN.domain.sec, `念两句要 ${sec.toFixed(1)} 秒`);
});

test('整段不超过 3 分钟（打字、等待都按最长算）', () => {
  const sec = AUTOPLAY.reduce((a, s) => a + (s.type ? [...s.type].length * TYPE.char + TYPE.hold + TYPE.wait : 0) + Math.max(s.sec ?? 0, s.max ?? 0), 0);
  assert.ok(sec <= 180, `最长 ${sec.toFixed(1)} 秒`);
});

/** 记下 api 被调了什么 @param {{ ready?: () => boolean, test?: (c: string) => boolean }} [o] */
function fake(o = {}) {
  /** @type {any[][]} */
  const log = [];
  return { log, api: {
    say: (t) => log.push(['say', t]), go: (m) => log.push(['go', m]), typed: (t) => log.push(['typed', t]), cast: (t) => log.push(['cast', t]),
    ready: o.ready ?? (() => true), call: (c) => log.push(['call', c]), test: o.test ?? (() => false),
  } };
}
const run = (/** @type {Autoplay} */ p, /** @type {number} */ sec, step = 0.05) => { for (let t = 0; t < sec; t += step) p.update(step); };

test('打字：一个字一个字进输入框，打完停一下才回车，回车后才开始数 sec', () => {
  const f = fake(), p = new Autoplay(f.api, [{ type: '火球术', say: '字幕', sec: 2 }, { go: 'cover', sec: 9 }]);
  p.start();
  assert.deepEqual(f.log[0], ['say', '字幕']);
  run(p, 3 * TYPE.char + 0.1);
  assert.equal(f.log.filter((l) => l[0] === 'typed').at(-1)[1], '火球术');
  assert.ok(!f.log.some((l) => l[0] === 'cast'), '打完先停一下');
  run(p, TYPE.hold + 0.1);
  assert.deepEqual(f.log.at(-1), ['cast', '火球术']);
  run(p, 1.5);
  assert.equal(p.i, 0, '回车后才开始数 2 秒');
  run(p, 0.7);
  assert.equal(p.i, 1);
});

test('上一句没放完就等一等；一直放不了，这句不放了，输入框收干净', () => {
  let can = false;
  const f = fake({ ready: () => can }), p = new Autoplay(f.api, [{ type: '火', sec: 0 }, { sec: 9 }]);
  p.start();
  run(p, TYPE.char + TYPE.hold + 1);
  assert.ok(!f.log.some((l) => l[0] === 'cast'));
  can = true;
  run(p, 0.1);
  assert.ok(f.log.some((l) => l[0] === 'cast'), '能放了就放');

  const g = fake(), q = new Autoplay({ ...g.api, ready: () => false }, [{ type: '火', sec: 0 }, { sec: 9 }]);
  q.start();
  run(q, TYPE.char + TYPE.hold + TYPE.wait + 0.2);
  assert.ok(!g.log.some((l) => l[0] === 'cast'));
  assert.deepEqual(g.log.at(-1), ['typed', ''], '放不了就把字收掉');
  assert.equal(q.i, 1, '不卡在这一句');
});

test('until：等到了才走、sec 没到也不走；max 到了等不到也走', () => {
  let ok = false;
  const f = fake({ test: () => ok }), p = new Autoplay(f.api, [{ until: 'x', sec: 1, max: 5 }, { sec: 9 }]);
  p.start();
  run(p, 2);
  assert.equal(p.i, 0);
  ok = true;
  run(p, 0.1);
  assert.equal(p.i, 1);

  const g = fake(), q = new Autoplay(g.api, [{ until: 'x', max: 5 }, { sec: 9 }]);
  q.start();
  run(q, 4.9);
  assert.equal(q.i, 0);
  run(q, 0.2);
  assert.equal(q.i, 1, '等不到也不能把演示卡死');
});

test('放完从头再来；退了就不动了，字幕和输入框都收干净', () => {
  const f = fake(), p = new Autoplay(f.api, [{ go: 'defense', sec: 1 }, { go: 'cover', sec: 1 }]);
  p.start();
  run(p, 2.2);
  assert.deepEqual(f.log.filter((l) => l[0] === 'go').map((l) => l[1]), ['defense', 'cover', 'defense']);
  p.stop();
  assert.deepEqual(f.log.slice(-2), [['typed', ''], ['say', null]]);
  const n = f.log.length;
  run(p, 5);
  assert.equal(f.log.length, n);
});

const open = { inArena: () => true, shot: false, side: 1, keep: 5 };
/** 红圈 @param {{ x: number, z: number }} c @param {number} t */
const circle = (c, t) => ({ t, inside: (/** @type {{ x: number, z: number }} */ q) => inCircle(q, c, 2.6, 0.35) });

test('红圈里：早的时候站住，快落下才闪，闪到的地方在圈外', () => {
  const p = { x: 0, z: 0 }, foe = { x: 0, z: -5 };
  assert.deepEqual(autoMove({ ...open, p, foe, threat: circle(p, 0.8) }), { x: 0, z: 0, dash: false });
  const m = autoMove({ ...open, p, foe, threat: circle(p, 0.2) });
  assert.ok(m.dash);
  assert.ok(!circle(p, 0).inside({ x: p.x + m.x * 3.6, z: p.z + m.z * 3.6 }));
  // 红圈偏在一边：往敌人那边闪最合适，但闪过去还在圈里，就不能往那边
  const c = { x: 2, z: 0 }, side = autoMove({ ...open, p, foe: { x: 8, z: 0 }, threat: circle(c, 0.1) });
  assert.ok(!circle(c, 0).inside({ x: p.x + side.x * 3.6, z: p.z + side.z * 3.6 }));
});

test('闪的方向不出场地；哪边都走不了就背着敌人闪', () => {
  const p = { x: 0, z: 0 }, foe = { x: 0, z: -5 };
  const m = autoMove({ ...open, p, foe, threat: circle(p, 0.1), inArena: (q) => q.x > 0 });
  assert.ok(m.x > 0, '左边是场外');
  const n = autoMove({ ...open, p, foe, threat: circle(p, 0.1), inArena: () => false });
  assert.deepEqual([n.x, n.z, n.dash], [0, 1, true]);
});

test('平时绕着敌人转、隔开 keep 米；红圈亮着时不往里走；冰锥快到了才闪', () => {
  const p = { x: 0, z: 0 }, near = autoMove({ ...open, p, foe: { x: 0, z: -2 }, threat: null }), far = autoMove({ ...open, p, foe: { x: 0, z: -9 }, threat: null });
  assert.ok(near.z > 0, '太近了往后退');
  assert.ok(far.z < 0, '太远了往前走');
  assert.ok(Math.abs(autoMove({ ...open, p, foe: { x: 0, z: -5 }, threat: null }).x) > 0.9, '正好时横着绕');
  assert.ok(Math.abs(Math.hypot(near.x, near.z) - 1) < 1e-9);
  assert.equal(autoMove({ ...open, side: -1, p, foe: { x: 0, z: -5 }, threat: null }).x, -autoMove({ ...open, p, foe: { x: 0, z: -5 }, threat: null }).x, 'side 换方向');
  const ahead = autoMove({ ...open, p, foe: { x: 0, z: -5 }, threat: circle({ x: 3, z: 0 }, 1) });
  assert.deepEqual(ahead, { x: 0, z: 0, dash: false });
  assert.ok(autoMove({ ...open, shot: true, p, foe: { x: 0, z: -5 }, threat: null }).dash);
  assert.ok(!autoMove({ ...open, p, foe: { x: 0, z: -5 }, threat: null }).dash);
  assert.deepEqual(autoMove({ ...open, p, foe: null, threat: null }), { x: 0, z: 0, dash: false });
});
