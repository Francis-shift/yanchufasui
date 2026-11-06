// 法域的走段（game/rules/domain.js）：展开、念咒、等解析、收束，念够了、时间到了、提前收束都要走到收束
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DOMAIN_OFF, addLine, canChant, canOpen, domainLeft, domainOn, endChant, inkStep, openDomain, tickDomain } from '../game/rules/domain.js';
import { RUN } from '../game/rules/numbers.js';
import { CARDS, runMods, newRun } from '../game/rules/run.js';

const D = RUN.domain;
const chant = () => tickDomain(openDomain(), D.open + 0.01, false).d;

test('开得开不了：领悟、开战、气势满、手上没有咒，四样都要', () => {
  const ok = { has: true, fighting: true, gauge: 8, ult: 8, busy: false };
  assert.equal(canOpen(DOMAIN_OFF, ok), true);
  for (const bad of [{ has: false }, { fighting: false }, { gauge: 7 }, { busy: true }]) assert.equal(canOpen(DOMAIN_OFF, { ...ok, ...bad }), false, JSON.stringify(bad));
  assert.equal(canOpen(openDomain(), ok), false, '开着不能再开');
  assert.equal(canOpen(DOMAIN_OFF, { ...ok, gauge: 6, ult: 6 }), true, '拿了龙吟满 6 格也算满');
});

test('展开：约 1 秒，展开时念不了，到点进念咒、发一次 chant', () => {
  const d = openDomain();
  assert.equal(domainOn(d), true);
  assert.equal(canChant(d), false);
  const mid = tickDomain(d, D.open - 0.1, false);
  assert.equal(mid.event, '');
  assert.equal(mid.d.phase, 'open');
  const r = tickDomain(mid.d, 0.2, false);
  assert.equal(r.event, 'chant');
  assert.equal(r.d.phase, 'chant');
  assert.equal(r.d.t, D.sec);
  assert.equal(canChant(r.d), true);
  assert.equal(tickDomain(r.d, 0.1, false).event, '', 'chant 只发一次');
});

test('念咒：时间到就收束，念成的话一起交出去，收束后回到没开', () => {
  let d = addLine(chant(), 'a');
  d = addLine(d, 'b');
  const mid = tickDomain(d, D.sec - 0.1, false);
  assert.equal(mid.event, '');
  const r = tickDomain(mid.d, 0.2, false);
  assert.equal(r.event, 'strike');
  assert.deepEqual(r.lines, ['a', 'b']);
  assert.equal(domainOn(r.d), false);
  assert.equal(tickDomain(r.d, 1, false).event, '', '收束完不再发');
});

test('一句没念也收束：lines 是空的，那一笔照样斩', () => {
  const r = tickDomain(chant(), D.sec + 0.1, false);
  assert.equal(r.event, 'strike');
  assert.deepEqual(r.lines, []);
});

test('念满三句不等时间，也不能再念第四句', () => {
  let d = chant();
  for (let i = 0; i < D.lines - 1; i++) d = addLine(d, i);
  assert.equal(canChant(d), true);
  d = addLine(d, 'last');
  assert.equal(canChant(d), false);
  const r = tickDomain(d, 0.016, false);
  assert.equal(r.event, 'strike');
  assert.equal(r.lines.length, D.lines);
});

test('提前收束：念咒时才算，下一帧就收；展开时按了不算', () => {
  const o = openDomain();
  assert.equal(endChant(o), o);
  const r = tickDomain(endChant(addLine(chant(), 'a')), 0.016, false);
  assert.equal(r.event, 'strike');
  assert.deepEqual(r.lines, ['a']);
});

test('时间到了还有一句在解析：等它；回来了就收束，这期间不能再念', () => {
  const w = tickDomain(chant(), D.sec + 0.1, true);
  assert.equal(w.event, '');
  assert.equal(w.d.phase, 'wait');
  assert.equal(canChant(w.d), false);
  const still = tickDomain(w.d, 1, true);
  assert.equal(still.event, '');
  const r = tickDomain(addLine(still.d, 'late'), 0.016, false);
  assert.equal(r.event, 'strike');
  assert.deepEqual(r.lines, ['late']);
});

test('等解析有上限：请求卡死了也不会一直定着', () => {
  const w = tickDomain(chant(), D.sec + 0.1, true);
  const r = tickDomain(w.d, D.wait + 0.1, true);
  assert.equal(r.event, 'strike');
  assert.ok(D.wait * 1000 > 4500, '等得比解析超时长，正常的解析都等得到');
});

test('倒计时：展开时满的，念咒时跟着走，等解析时空的', () => {
  assert.equal(domainLeft(openDomain()), 1);
  const d = chant();
  assert.equal(domainLeft(d), 1);
  assert.equal(domainLeft(tickDomain(d, D.sec / 2, false).d), 0.5);
  assert.equal(domainLeft(tickDomain(d, D.sec + 1, true).d), 0);
});

test('水墨：展开的时间里铺满，不超过上限；关了几成几成褪掉，褪完半径归零', () => {
  let s = { r: 0, k: 0 };
  s = inkStep(s, true, D.open / 2);
  assert.equal(s.k, 1);
  assert.equal(s.r, D.inkR / 2);
  s = inkStep(s, true, D.open);
  assert.equal(s.r, D.inkR);
  const h = inkStep(s, false, D.fade / 2);
  assert.ok(Math.abs(h.k - 0.5) < 1e-9);
  assert.equal(h.r, D.inkR, '褪的时候半径不动');
  assert.deepEqual(inkStep(h, false, D.fade), { r: 0, k: 0 });
});

test('法域的卡：领悟类，能抽到，拿了才有；水墨盖得住 21:9 的宽屏四角', () => {
  const c = CARDS.find((x) => x.id === 'domain');
  assert.equal(c?.kind, 'insight');
  assert.equal(c?.ready, true);
  assert.equal(runMods(newRun()).domain, false);
  assert.equal(runMods({ ...newRun(), have: { domain: 1 } }).domain, true);
  assert.ok(D.inkR > Math.hypot(21 / 9 / 2, 1));
});
