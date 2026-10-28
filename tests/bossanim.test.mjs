// boss 换成模型以后摆哪段动作的第几秒（game/actors/bossanim.js）：预警从头放到出手、出手正好在预警结束；出手后放完收招；
// 旋转弹幕持续喷时在双臂平伸那一段来回；吼按吼的时长放完；平时（和没有这段动作的招）交回待机、走路。
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bossPose, ICE_KING } from '../game/actors/bossanim.js';

const at = (/** @type {Partial<import('../game/actors/bossanim.js').PoseInput>} */ s) =>
  bossPose(ICE_KING, { state: 'recover', move: '', t: 0, len: 1, chT: 0, tail: null, ...s });

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

test('出手以后：从出手那一帧照常速往后放，放到收招就交回平时；没有动作的招（石甲巨像的）一律交回平时', () => {
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
