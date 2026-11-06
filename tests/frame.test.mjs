// 全屏画框的硬规矩（game/ui/frame.js）：三级谁压谁、中间不放东西，水墨的后期参数手机档也要有
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GradePass } from '../game/fx/grade.js';
import { FRAME_CSS, FRAME_GLOW, LEVELS, outranks } from '../game/ui/frame.js';
import { SUMMONS } from '../game/rules/numbers.js';
import * as THREE from 'three';

test('三级：法域最大，化身次之，召龙最小；两个同时来只放强的，一样强的新的换旧的', () => {
  assert.ok(LEVELS.large.rank > LEVELS.mid.rank && LEVELS.mid.rank > LEVELS.small.rank);
  assert.equal(outranks({ level: 'large', on: true }, 'small'), false);
  assert.equal(outranks({ level: 'mid', on: true }, 'small'), false);
  assert.equal(outranks({ level: 'small', on: true }, 'mid'), true);
  assert.equal(outranks({ level: 'small', on: true }, 'small'), true);
  assert.equal(outranks(null, 'small'), true);
});

test('化身亮相完留着呼吸时不占位：这时候召龙的小画框照样亮', () => {
  assert.equal(outranks({ level: 'mid', on: false }, 'small'), true);
});

test('中间不放东西：墨带最宽也只占短边一成半，大字贴在左边，天上的字在上半屏', () => {
  for (const L of Object.values(LEVELS)) assert.ok(L.thick <= 0.15);
  assert.match(FRAME_CSS, /\.yc-frame b \{ position: absolute; left: 3\.2vmin/);
  assert.match(FRAME_CSS, /\.yc-sky \{ position: absolute; left: 0; right: 0; top: max\(15%, 92px\)/, '手机上 boss 血条到 83 像素，天上的字排在它下面');
  assert.match(FRAME_CSS, /\.yc-frame \{[^}]*pointer-events: none/, '画框不挡手');
});

test('入场 0.12 秒，小的和中的亮 1 秒，法域的一直留着等收束', () => {
  assert.match(FRAME_CSS, /\.yc-frame \{[^}]*transition: opacity \.12s/);
  assert.equal(LEVELS.small.hold, 1);
  assert.equal(LEVELS.mid.hold, 1);
  assert.equal(LEVELS.mid.rest, true);
  assert.equal(LEVELS.small.rest, false);
  assert.equal(LEVELS.large.hold, 0);
});

test('五条龙的元素都有画框色', () => {
  for (const el of Object.keys(SUMMONS)) assert.match(FRAME_GLOW[el] ?? '', /^#[0-9a-f]{6}$/);
});

test('水墨：流畅档（g.impact 为 0）也写进后期，收束褪完就关掉', () => {
  const g = new GradePass({ contrast: 1, saturation: 1, vignette: 0, grain: 0, impact: 0 });
  const c = new THREE.Vector2(0.5, 0.5);
  g.tick(0.016, 1, c, 16 / 9, { x: 0, y: 0, r: 0, w: 1, amp: 1 }, { x: 0.4, y: 0.3, r: 1.2, k: 0.7 });
  assert.equal(g.uniforms.uShockAmp.value, 0, '折射圈跟着 impact 关');
  const u = g.uniforms.uInk.value;
  assert.deepEqual([u.x, u.y, u.z, u.w], [0.4, 0.3, 1.2, 0.7]);
  assert.ok(Math.abs(g.uniforms.uTexel.value.y / g.uniforms.uTexel.value.x - 16 / 9) < 1e-9, '描边取样横竖等距');
  g.tick(0.016, 0, c, 16 / 9, undefined, undefined);
  assert.equal(g.uniforms.uInk.value.w, 0);
});
