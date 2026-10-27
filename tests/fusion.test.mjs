// 豪火灭却的火浪（game/rules/fusion.js）：越推越宽、浪头到了才烧、身后不烧。
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BEAM } from '../game/rules/numbers.js';
import { inWave, waveHalfW } from '../game/rules/fusion.js';

const O = { x: 0, z: 0 }, FWD = { x: 0, z: -1 };

test('火浪越推越宽：起点 w0，尽头 w1，超出两头按两头算', () => {
  assert.equal(waveHalfW(0), BEAM.w0);
  assert.equal(waveHalfW(BEAM.len), BEAM.w1);
  assert.ok(waveHalfW(BEAM.len / 2) > BEAM.w0 && waveHalfW(BEAM.len / 2) < BEAM.w1);
  assert.equal(waveHalfW(-3), BEAM.w0);
  assert.equal(waveHalfW(BEAM.len * 2), BEAM.w1);
});

test('浪头到了才烧：同一个位置，浪头没到不算、到了算', () => {
  const p = { x: 0, z: -8 };
  assert.ok(!inWave(p, O, FWD, 5));
  assert.ok(inWave(p, O, FWD, 8));
  assert.ok(inWave(p, O, FWD, 99), '推到头以后还在火浪里');
});

test('尽头比起点宽：离中线 3 米，近处不烧、远处烧；身后、尽头外都不烧', () => {
  const full = BEAM.len;
  assert.ok(!inWave({ x: 3, z: -1 }, O, FWD, full), '近处还窄');
  assert.ok(inWave({ x: 3, z: -13 }, O, FWD, full), '远处张开了');
  assert.ok(!inWave({ x: 0, z: 2 }, O, FWD, full), '身后');
  assert.ok(!inWave({ x: 0, z: -(BEAM.len + 1) }, O, FWD, full), '尽头外');
  assert.ok(inWave({ x: 0, z: -(BEAM.len + 0.3) }, O, FWD, full, 0.35), '身体碰到尽头也算');
});

test('方向任意：朝 +x 推时按 +x 算', () => {
  const E = { x: 1, z: 0 };
  assert.ok(inWave({ x: 10, z: 2 }, O, E, BEAM.len));
  assert.ok(!inWave({ x: -2, z: 0 }, O, E, BEAM.len));
});
