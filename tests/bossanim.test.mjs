// boss 换成模型以后摆哪段动作的第几秒（game/actors/bossanim.js）：预警从头放到出手、出手正好在预警结束；出手后放完收招；
// 旋转弹幕持续喷时在双臂平伸那一段来回；吼按吼的时长放完；平时（和没有这段动作的招）交回待机、走路。
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BOSS_CLIPS, bossPose, FLAME_SPIRIT, ICE_KING, STONE_COLOSSUS } from '../game/actors/bossanim.js';
import { BOSS, FLAME, STONE } from '../game/rules/numbers.js';

const at = (/** @type {Partial<import('../game/actors/bossanim.js').PoseInput>} */ s, /** @type {any} */ clips = ICE_KING) =>
  bossPose(clips, { state: 'recover', move: '', t: 0, len: 1, chT: 0, tail: null, ...s });

test('预警：从第 0 秒放起，预警结束那一刻正好是出手那一帧；预警长短不同只改快慢', () => {
  for (const move of ['slam', 'sweep', 'summon', 'homing', 'spiral']) {
    const hit = ICE_KING[/** @type {keyof typeof ICE_KING} */ (move)].hit;
    for (const len of [0.7, 1.2]) {
      assert.deepEqual(at({ state: 'tele', move, t: len, len }), { clip: move, time: 0 });
      assert.ok(Math.abs(/** @type {any} */ (at({ state: 'tele', move, t: len / 2, len })).time - hit / 2) < 1e-9);
      assert.deepEqual(at({ state: 'tele', move, t: 0, len }), { clip: move, time: hit }, `${move} 预警结束时不在出手那一帧`);
      assert.deepEqual(at({ state: 'tele', move, t: -0.05, len }), { clip: move, time: hit }, '超过一点也停在出手');
    }
  }
});

test('出手以后：从出手那一帧照常速往后放，放到收招就交回平时；这个 boss 没有的招一律交回平时', () => {
  assert.deepEqual(at({ tail: { move: 'slam', t: 0.1 } }), { clip: 'slam', time: ICE_KING.slam.hit + 0.1 });
  assert.equal(at({ tail: { move: 'slam', t: ICE_KING.slam.end - ICE_KING.slam.hit + 0.01 } }), null);
  assert.deepEqual(at({ state: 'spin', move: 'sweep', tail: { move: 'sweep', t: 0.2 } }), { clip: 'sweep', time: ICE_KING.sweep.hit + 0.2 });
  assert.equal(at({ state: 'tele', move: 'charge', t: 1, len: 2 }), null);
  assert.equal(at({ tail: { move: 'rocks', t: 0 } }), null);
  assert.equal(at({}), null);
});

test('旋转弹幕：持续喷的时候一直在双臂平伸那一段里来回；喷完从那一段的尽头接着收招', () => {
  const [a, b] = /** @type {number[]} */ (ICE_KING.spiral.hold);
  let lo = Infinity, hi = -Infinity;
  for (let chT = 0; chT <= 2.4; chT += 0.01) {
    const p = /** @type {any} */ (at({ state: 'channel', move: 'spiral', chT }));
    assert.equal(p.clip, 'spiral');
    lo = Math.min(lo, p.time); hi = Math.max(hi, p.time);
  }
  assert.ok(lo >= a - 1e-9 && hi <= b + 1e-9, `跑出平伸那一段：${lo}～${hi}`);
  assert.ok(hi - lo > (b - a) * 0.9, '来回要走满这一段');
  assert.deepEqual(at({ tail: { move: 'spiral', t: 0 } }), { clip: 'spiral', time: b });
});

test('吼：吼的时长里从头放到收完', () => {
  assert.deepEqual(at({ state: 'roar', t: 1.6, len: 1.6 }), { clip: 'roar', time: 0 });
  assert.deepEqual(at({ state: 'roar', t: 0, len: 1.28 }), { clip: 'roar', time: ICE_KING.roar.end });
  assert.ok(Math.abs(/** @type {any} */ (at({ state: 'roar', t: 0.8, len: 1.6 })).time - ICE_KING.roar.end / 2) < 1e-9, '吼到一半放到一半');
});

test('三个 boss 的出招表：招式表（numbers.js）里有的招都有动作，出手不晚于收招', () => {
  for (const [cfg, clips] of [[BOSS, ICE_KING], [STONE, STONE_COLOSSUS], [FLAME, FLAME_SPIRIT]]) {
    assert.equal(BOSS_CLIPS[/** @type {'boss' | 'stone' | 'flame'} */ (cfg.type)], clips);
    for (const m of ['slam', 'sweep', 'summon', 'homing', 'spiral', 'rocks', 'charge', 'spikes', 'pyre', 'nova', 'wave']) {
      if (m in cfg) assert.ok(/** @type {any} */ (clips)[m], `${cfg.type} 的 ${m} 没有动作`);
    }
    for (const [m, c] of Object.entries(clips)) assert.ok(c.hit <= c.end, `${cfg.type} 的 ${m}`);
  }
});

test('借别的动作的招（召小怪借落石、火圈）：放的是借来的那段，出手、收招照自己写的', () => {
  for (const clips of [STONE_COLOSSUS, FLAME_SPIRIT]) {
    const c = clips.summon;
    assert.deepEqual(at({ state: 'tele', move: 'summon', t: 0, len: 0.9 }, clips), { clip: c.clip, time: c.hit });
    assert.deepEqual(at({ tail: { move: 'summon', t: 0.1 } }, clips), { clip: c.clip, time: c.hit + 0.1 });
  }
  assert.deepEqual(at({ state: 'tele', move: 'slam', t: 0, len: 1.3 }, STONE_COLOSSUS), { clip: 'slam', time: STONE_COLOSSUS.slam.hit });
});

test('落石：出手对第一块落地（预警还剩 lead 秒时），后面几块落地时照常速往后放、放到收招停住；出手以后接着从那儿放', () => {
  const R = STONE_COLOSSUS.rocks, lead = 0.88, len = 1.1 + lead;
  const p = (/** @type {number} */ t) => /** @type {any} */ (at({ state: 'tele', move: 'rocks', t, len, lead }, STONE_COLOSSUS)).time;
  assert.equal(p(len), 0);
  assert.ok(Math.abs(p(lead + 0.55) - R.hit / 2) < 1e-9, '第一块落地前按剩下的预警放快放慢');
  assert.ok(Math.abs(p(lead) - R.hit) < 1e-9, '第一块落地那一刻正好出手');
  assert.ok(Math.abs(p(lead - 0.2) - (R.hit + 0.2)) < 1e-9, '后面几块落的时候照常速往后放');
  assert.equal(p(0), R.end, '放到收招就停住');
  // 预警结束时 tail 从 lead 秒算起（试炼模式就是这么记的）：接得上预警最后那一帧
  assert.equal(at({ tail: { move: 'rocks', t: lead } }, STONE_COLOSSUS), null);
  assert.deepEqual(at({ tail: { move: 'rocks', t: 0.2 } }, STONE_COLOSSUS), { clip: 'rocks', time: R.hit + 0.2 });
});

test('被打断的硬直：照硬直的时长从头放到收完；冲撞出手就交回平时（冲的时候按走路放）', () => {
  const S = STONE_COLOSSUS.stagger, len = STONE.charge.stagger;
  assert.deepEqual(at({ state: 'stagger', t: len, len }, STONE_COLOSSUS), { clip: 'stagger', time: 0 });
  assert.ok(Math.abs(/** @type {any} */ (at({ state: 'stagger', t: len / 2, len }, STONE_COLOSSUS)).time - S.end / 2) < 1e-9);
  assert.deepEqual(at({ state: 'stagger', t: 0, len }, STONE_COLOSSUS), { clip: 'stagger', time: S.end });
  assert.equal(at({ state: 'rush', tail: { move: 'charge', t: 0.01 } }, STONE_COLOSSUS), null);
  assert.equal(at({ state: 'stagger', t: 1, len }), null, '寒甲傀儡王没有硬直这段，交回平时');
});
