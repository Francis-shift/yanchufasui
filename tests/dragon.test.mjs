// 冰龙的飞行路线不能穿过场景里的实心物件（牌坊、镇山石、石兽、华表）：
// 绕场那段离它们至少 2 米，俯冲到撞上目标前 2 米为止至少 1.2 米（龙身截面一半的点在中线 0.65 米以内，九成在 1.6 米以内）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

import { summonPoints } from '../game/fx/dragon.js';
import { SOLIDS } from '../game/world/layout.js';

/** @param {THREE.Vector3} p @param {{ min: number[], max: number[] }} b */
const distToBox = (p, b) => Math.hypot(
  Math.max(b.min[0] - p.x, 0, p.x - b.max[0]), Math.max(b.min[1] - p.y, 0, p.y - b.max[1]), Math.max(b.min[2] - p.z, 0, p.z - b.max[2]));

/** 按游戏里的做法建曲线、找撞点，返回绕场段与俯冲段离实心物件最近的距离 */
function clearance(T) {
  const pts = summonPoints(T);
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  curve.arcLengthDivisions = 1500;
  const N = 3000, samples = [];
  let iHit = 0, iDive = 0, bestHit = Infinity, bestDive = Infinity;
  for (let i = 0; i <= N; i++) {
    const q = curve.getPointAt(i / N);
    samples.push(q);
    if (q.distanceToSquared(T) < bestHit) { bestHit = q.distanceToSquared(T); iHit = i; }
    if (q.distanceToSquared(pts[10]) < bestDive) { bestDive = q.distanceToSquared(pts[10]); iDive = i; }
  }
  let orbit = Infinity, dive = Infinity, worst = null;
  for (let i = 0; i <= iHit; i++) {
    if (samples[i].distanceTo(T) < 2) continue;      // 撞点前 2 米不算：目标贴着柱子站时，撞点本身就挨着柱子
    const d = Math.min(...SOLIDS.map((b) => distToBox(samples[i], b)));
    if (i < iDive) orbit = Math.min(orbit, d);
    else if (d < dive) { dive = d; worst = samples[i]; }
  }
  return { orbit, dive, worst };
}

// 敌人会站的地方：门洞里与门洞前、石阶上中下、广场中路、索桥口与桥上、两侧（离实心物件 2 米以上；贴着物件站的目标，撞点本身就挨着它）
const TARGETS = [[0, 0, -8.6], [1.5, 0, -9.4], [0, 0, -7.2], [2, 0, -7.5], [0, 0, -6], [0, -1, -12], [0.5, -4, -16.5], [-0.6, -8, -23],
  [0, 0, -3], [0, 0, 3], [-8.3, 0, -4.6], [-8.5, 0, -7.5], [-5, 0, -1], [-14, 0, -8.4], [-20, 0, -12], [6, 0, 0], [6.5, 0, -1]];

test('冰龙：绕场离牌坊、石兽、华表、镇山石至少 2 米，俯冲到撞上目标为止至少 1.2 米', () => {
  for (const [x, y, z] of TARGETS) {
    const c = clearance(new THREE.Vector3(x, y, z));
    assert.ok(c.orbit >= 2, `目标 (${x}, ${y}, ${z})：绕场离实心物件只有 ${c.orbit.toFixed(2)} 米`);
    assert.ok(c.dive >= 1.2, `目标 (${x}, ${y}, ${z})：俯冲离实心物件只有 ${c.dive.toFixed(2)} 米，最近处 ${c.worst?.toArray().map((v) => v.toFixed(1))}`);
  }
});
