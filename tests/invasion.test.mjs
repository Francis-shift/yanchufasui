// 入侵进程（设计文档第 5 节风格卡）：天色跟波次走。按风格卡逐条核对——
// 第 1 波天上还没有黑雾；第 3 波打到底吞掉镜头正前方那半边天；最后一波太阳那边留一道光缝；输了全盖；守住两三秒内放晴。
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { invMaskAt, SUN_DIR } from '../game/world/environment.js';
import { invasionTarget, stepInvasion } from '../game/world/invasion.js';

const WAVES = 5;   // 与 game/main.js 的 WAVES 一致
const at = (wave, progress, phase = 'playing') => invasionTarget({ phase, wave, waves: WAVES, progress });
/** 横屏镜头看的方向（main.js layoutCamera：机位 (5.6, 7.4, 16.8) 看 (0, 1, -3.5)） */
const VIEW = [0 - 5.6, 1 - 7.4, -3.5 - 16.8];
const SUN = [SUN_DIR.x, SUN_DIR.y, SUN_DIR.z];

test('入侵：开局前和守住了是目标图的傍晚，输了全暗', () => {
  assert.equal(invasionTarget({ phase: 'title', wave: 0, waves: WAVES }), 0);
  assert.equal(at(4, 1, 'won'), 0);
  assert.equal(at(2, 0.5, 'lost'), 1);
});

test('入侵：一波比一波重，同一波里越打越重；守住一波退回一点，下一波再压上来', () => {
  for (let w = 0; w < WAVES; w++) {
    assert.ok(at(w, 1) > at(w, 0), `第 ${w + 1} 波打到底比开打时重`);
    if (w + 1 < WAVES) {
      assert.ok(at(w + 1, 0) > at(w, 1), `第 ${w + 2} 波开打比第 ${w + 1} 波打完重`);
      const rest = at(w, 0, 'rest');
      assert.ok(rest < at(w, 1) && rest < at(w + 1, 0), `第 ${w + 1} 波守住后的休息：黑雾退回`);
    }
  }
  for (let w = 0; w < WAVES; w++) for (const p of [0, 0.5, 1]) { const k = at(w, p); assert.ok(k > 0 && k < 1, `${k} 在 0～1 之间`); }
});

test('入侵：第 1 波天上还没有黑雾（只有石阶下方的云海发暗）', () => {
  const k = at(0, 1);
  for (let a = -Math.PI; a < Math.PI; a += 0.05) {
    for (const y of [0, 0.1, 0.3]) assert.equal(invMaskAt(Math.cos(a), y, Math.sin(a), k), 0, `方位 ${a.toFixed(2)} 高 ${y}`);
  }
});

test('入侵：第 3 波打到底，吞掉镜头正前方的半边天，太阳那边还亮', () => {
  const k = at(2, 1);
  assert.ok(invMaskAt(...VIEW, k) >= 0.5, `镜头正前方被盖住 ${invMaskAt(...VIEW, k).toFixed(2)}`);
  assert.equal(invMaskAt(...SUN, k), 0);
});

test('入侵：最后一波打到底，镜头正前方全黑，太阳那边留一道光缝；输了连太阳也盖住', () => {
  const k = at(WAVES - 1, 1);
  assert.equal(invMaskAt(...VIEW, k), 1);
  assert.equal(invMaskAt(...SUN, k), 0, '太阳方向没被盖住');
  assert.ok(invMaskAt(...SUN, 1) > 0.99, '输了：太阳也被盖住');
});

test('入侵：压上来要几秒（不是一下跳黑），守住两三秒内放晴，输了很快全暗', () => {
  const run = (from, target, phase, sec) => { let k = from; for (let i = 0; i < sec * 60; i++) k = stepInvasion(k, target, phase, 1 / 60); return k; };
  assert.ok(run(at(0, 1), at(1, 0), 'playing', 2) < at(1, 0), '下一波开打 2 秒后还没压到位');
  assert.equal(run(at(0, 1), at(1, 0), 'playing', 10), at(1, 0), '10 秒内压到位，不越过');
  assert.equal(run(at(WAVES - 1, 1), 0, 'won', 3), 0, '守住：3 秒内放晴');
  assert.equal(run(at(2, 0.5), 1, 'lost', 2), 1, '输了：2 秒内全暗');
});
