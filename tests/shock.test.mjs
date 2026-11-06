// 命中时的冲击波圈（game/fx/shock.js）：圈多大、多强、谁能换掉谁；手机流畅档不画
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as THREE from 'three';

import { GradePass } from '../game/fx/grade.js';
import { SHOCK, Shock, screenR } from '../game/fx/shock.js';
import { TIERS } from '../game/quality.js';

const AT = { x: 1, y: 0.4, z: -4 }, DIST = 16, FOV = 45;
const at = (s, q) => { s.t = SHOCK.sec * q; return s.ring(DIST, FOV); };

test('屏幕半径：越远越小，视角越大越小，贴脸也不炸', () => {
  assert.ok(Math.abs(screenR(1, 1, 90) - 0.5) < 1e-9);
  assert.ok(screenR(3, 20, 45) < screenR(3, 10, 45));
  assert.ok(screenR(3, 10, 60) < screenR(3, 10, 45));
  assert.ok(Number.isFinite(screenR(3, 0, 45)));
});

test('一圈：往外胀，先升后衰，跑完就没了', () => {
  const s = new Shock();
  assert.equal(s.ring(DIST, FOV).amp, 0, '没打过就没有圈');
  s.hit(AT, 3, 1);
  assert.equal(s.ring(DIST, FOV).amp, 0, '起跑那一下不跳出来');
  let lastR = -1, peak = 0, peakQ = 0;
  for (let q = 0; q < 1; q += 0.02) {
    const { r, w, amp } = at(s, q);
    assert.ok(r > lastR, `q=${q} 往外胀`);
    assert.ok(w >= SHOCK.wMin && Number.isFinite(amp));
    if (amp > peak) { peak = amp; peakQ = q; }
    lastR = r;
  }
  assert.ok(peak > SHOCK.amp * 0.5 && peak <= SHOCK.amp, '强度到得了，也不过头');
  assert.ok(peakQ < 0.25, '很快到最强，后面都在衰减');
  assert.ok(Math.abs(lastR - screenR(3 * SHOCK.reach, DIST, FOV)) < 0.01, '跑到爆炸半径的几倍');
  assert.ok(at(s, 0.5).r > lastR * 0.8, '先快后慢：一半时间跑完大半');
  assert.ok(at(s, 0.95).amp < at(s, 0.3).amp * 0.1, '快到头时几乎不扭了，收得住');
  s.t = 0;
  s.tick(SHOCK.sec * 0.5);
  assert.ok(s.ring(DIST, FOV).amp > 0, '半路还在');
  s.tick(SHOCK.sec * 0.6);
  assert.equal(s.ring(DIST, FOV).amp, 0, '跑完就没了');
  s.tick(1);
  assert.equal(s.t, -1, '没圈时时间不走');
});

test('圈的大小跟着爆炸半径和距离走，再大也不盖满全屏', () => {
  const a = new Shock(), b = new Shock();
  a.hit(AT, 2, 1); b.hit(AT, 4, 1);
  assert.ok(at(b, 0.9).r > at(a, 0.9).r);
  assert.ok(a.ring(30, FOV).r < a.ring(10, FOV).r, '远处的圈小');
  assert.ok(b.ring(0.5, FOV).r <= SHOCK.maxR, '贴脸的大爆炸也有上限');
});

test('小命中不起圈；规模决定强度，超过 1 不再加', () => {
  const s = new Shock();
  s.hit(AT, 3, SHOCK.minScale - 0.01);
  assert.equal(s.t, -1);
  s.hit(AT, 3, SHOCK.minScale);
  assert.equal(s.t, 0);
  const small = at(s, 0.3).amp;
  const big = new Shock();
  big.hit(AT, 3, 1);
  assert.ok(at(big, 0.3).amp > small);
  const huge = new Shock();
  huge.hit(AT, 3, 1.6);
  assert.equal(at(huge, 0.3).amp, at(big, 0.3).amp);
});

test('一圈只有一个位子：前一半小的打不断大的，过半就让位，更强的随时换', () => {
  const s = new Shock();
  s.hit({ x: 1, y: 0, z: 1 }, 3, 1);
  at(s, 0.3);
  s.hit({ x: 9, y: 0, z: 9 }, 1, 0.5);
  assert.equal(s.x, 1, '小的打不断');
  at(s, 0.6);
  s.hit({ x: 9, y: 0, z: 9 }, 1, 0.5);
  assert.equal(s.x, 9, '过半让位');
  assert.equal(s.t, 0, '新圈从头跑');
  assert.equal(s.R, 1);
  at(s, 0.1);
  s.hit({ x: 5, y: 2, z: 7 }, 2, 0.9);
  assert.deepEqual([s.x, s.y, s.z, s.k], [5, 2, 7, 0.9], '更强的随时换');
  at(s, 0.1);
  s.hit({ x: 0, y: 0, z: 0 }, 2, 0.9);
  assert.equal(s.x, 5, '一样强不换');
});

test('调色层：电影档收到圈，流畅档不画，没给圈的检查页也不画', () => {
  const center = new THREE.Vector2(0.5, 0.5), ring = { x: 0.3, y: 0.7, r: 0.2, w: 0.04, amp: 0.008 };
  const cinema = new GradePass(TIERS.cinema.grade), smooth = new GradePass(TIERS.smooth.grade);
  cinema.tick(0.016, 0, center, 1.5, ring);
  assert.equal(cinema.uniforms.uShockAmp.value, 0.008);
  assert.deepEqual(cinema.uniforms.uShock.value.toArray(), [0.3, 0.7, 0.2, 0.04]);
  smooth.tick(0.016, 0, center, 1.5, ring);
  assert.equal(smooth.uniforms.uShockAmp.value, 0, '手机流畅档进不了那段着色器');
  cinema.tick(0.016, 0, center, 1.5);
  assert.equal(cinema.uniforms.uShockAmp.value, 0);
});
