// 护身无敌的规则：能挡多久、一条龙不震、两条龙隔多久震一次、弹幕来时字别刷屏、快结束时要看得出来
import test from 'node:test';
import assert from 'node:assert/strict';
import { GUARD_OFF, blockHit, guardGlow, guardOn, openGuard, tickGuard } from '../game/rules/guard.js';
import { RUN } from '../game/rules/numbers.js';

const G = RUN.dragon.guard;

test('护身：没开挡不了，开了能挡到龙转完', () => {
  assert.equal(guardOn(GUARD_OFF), false);
  const g = openGuard(false);
  assert.equal(guardOn(g), true);
  assert.equal(g.t, G.sec + G.lead);
  assert.ok(guardOn(tickGuard(g, G.sec + G.lead - 0.01)));
  assert.equal(guardOn(tickGuard(g, G.sec + G.lead)), false);
});

test('护身：时间到了回到没开的样子，没开时走钟什么都不变', () => {
  assert.equal(tickGuard(openGuard(true), 99), GUARD_OFF);
  assert.equal(tickGuard(GUARD_OFF, 1), GUARD_OFF);
});

test('一条龙只挡不震，挡多少下都不震', () => {
  let g = openGuard(false);
  for (let i = 0; i < 5; i++) {
    const r = blockHit(g);
    assert.equal(r.shock, false);
    g = tickGuard(r.g, G.shock.every);
  }
});

test('双龙护身：第一下就震，隔 every 秒才能再震', () => {
  const a = blockHit(openGuard(true));
  assert.equal(a.shock, true);
  assert.equal(blockHit(a.g).shock, false);
  assert.equal(blockHit(tickGuard(a.g, G.shock.every - 0.01)).shock, false);
  assert.equal(blockHit(tickGuard(a.g, G.shock.every)).shock, true);
});

test('没震的那一下不把反震的计时重新算', () => {
  const a = blockHit(openGuard(true));
  const b = blockHit(tickGuard(a.g, G.shock.every / 2));
  assert.equal(b.g.cd, G.shock.every / 2);
});

test('弹幕一帧来好几颗：飘字隔 quiet 秒一次，挡是每下都挡', () => {
  const a = blockHit(openGuard(false));
  assert.equal(a.show, true);
  const b = blockHit(a.g);
  assert.equal(b.show, false);
  assert.equal(guardOn(b.g), true);
  assert.equal(blockHit(tickGuard(a.g, G.quiet)).show, true);
});

test('没飘字的那一下不把飘字的计时重新算', () => {
  const a = blockHit(openGuard(false));
  const b = blockHit(tickGuard(a.g, G.quiet / 2));
  assert.equal(b.g.quiet, G.quiet / 2);
});

test('身上的光：转着时一直亮，最后 warn 秒闪，结束就灭', () => {
  const g = openGuard(false);
  assert.equal(guardGlow(GUARD_OFF), 0);
  assert.equal(guardGlow(g), 1);
  assert.equal(guardGlow({ ...g, t: G.warn + 0.01 }), 1);
  const late = Array.from({ length: 8 }, (_, i) => guardGlow({ ...g, t: 0.01 + (i * G.warn) / 8 }));
  assert.ok(late.includes(1) && late.includes(0.2), `最后 ${G.warn} 秒要有亮有暗：${late}`);
});

test('挡的数：反震够得着贴身打的 boss，隔得开，闪的时间不超过护身', () => {
  assert.ok(G.shock.r >= 4, '红圈砸过来时 boss 通常在几米外');
  assert.ok(G.shock.every >= 0.3);
  assert.ok(G.warn < G.sec);
});
