// 龙的飞行路线不能穿过场景里的实心物件（牌坊、镇山石、石兽、华表）：
// 冰龙绕场那段离它们至少 2 米，俯冲到撞上目标前 2 米为止至少 1.2 米（龙身截面一半的点在中线 0.65 米以内，九成在 1.6 米以内）；
// 另外四条整条路线（砸中处 2 米内、地面以下的不算）至少 1.2 米再加上身体摆动的幅度。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

import { emergePoint, flightPlan, guardPlan, summonPoints } from '../game/fx/dragon.js';
import { RUN } from '../game/rules/numbers.js';
import { OBSTACLES, PLAZA_R, SOLIDS } from '../game/world/layout.js';

/** @param {THREE.Vector3} p @param {{ min: number[], max: number[] }} b */
const distToBox = (p, b) => Math.hypot(
  Math.max(b.min[0] - p.x, 0, p.x - b.max[0]), Math.max(b.min[1] - p.y, 0, p.y - b.max[1]), Math.max(b.min[2] - p.z, 0, p.z - b.max[2]));
/** @param {THREE.Vector3} p */
const toSolids = (p) => Math.min(...SOLIDS.map((b) => distToBox(p, b)));

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
    const d = toSolids(samples[i]);
    if (i < iDive) orbit = Math.min(orbit, d);
    else if (d < dive) { dive = d; worst = samples[i]; }
  }
  return { orbit, dive, worst };
}

/**
 * 另外四条：整条路线离实心物件最近多远。砸中处（目标、砸中的控制点）2 米内不算，落点或法阵的地面以下不算（在地里）。
 * 要求的余量 = 1.2 米 + 身体摆动最大的幅度（越靠尾摆得越大，尾巴是 1.3 倍）。
 * @param {string} el @param {THREE.Vector3} T
 */
function planClearance(el, T) {
  const plan = flightPlan(el, T);
  const curve = new THREE.CatmullRomCurve3(plan.pts, false, 'centripetal');
  curve.arcLengthDivisions = 1500;
  const H = plan.pts[plan.hit], floor = Math.min(T.y, plan.sigil.y) - 0.5;
  let min = Infinity, worst = null;
  for (let i = 0; i <= 3000; i++) {
    const q = curve.getPointAt(i / 3000);
    if (q.distanceTo(T) < 2 || q.distanceTo(H) < 2 || q.y < floor) continue;
    const d = toSolids(q);
    if (d < min) { min = d; worst = q; }
  }
  return { min, worst, need: 1.2 + Math.hypot(plan.sway.side, plan.sway.up) * 1.3 };
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

for (const [el, name] of [['fire', '火龙'], ['thunder', '雷龙'], ['wind', '风龙'], ['earth', '土龙']]) {
  test(`${name}：整条路线离实心物件至少 1.2 米加摆幅`, () => {
    for (const [x, y, z] of TARGETS) {
      const c = planClearance(el, new THREE.Vector3(x, y, z));
      assert.ok(c.min >= c.need, `目标 (${x}, ${y}, ${z})：离实心物件只有 ${c.min.toFixed(2)} 米（要 ${c.need.toFixed(2)}），最近处 ${c.worst?.toArray().map((v) => v.toFixed(1))}`);
    }
  });
}

test('护身：从人脚下的地里钻出来，贴着人绕圈（半径、离地高度不变），圈长约是速度乘时长，转完往天上走；外圈那条更大更高、反着转', () => {
  const G = RUN.dragon.guard, C = new THREE.Vector3(3, -1, -5);
  /** 绕 C 转的方向：俯看角度变大为正 @param {THREE.Vector3} a @param {THREE.Vector3} b */
  const turn = (a, b) => Math.sign((a.x - C.x) * (b.z - C.z) - (a.z - C.z) * (b.x - C.x));
  for (const g of [{ r: G.r, h: G.h, dir: 1 }, { r: G.r + G.outer.dr, h: G.h + G.outer.dh, dir: -1 }]) {
    const p = guardPlan(C, 'ice', { ...g, speed: G.speed, sec: G.sec });
    assert.ok(p.pts[0].y < C.y - 3, '起点在地里');
    const ring = p.pts.slice(2, p.hit + 1);
    let len = 0;
    for (let i = 0; i < ring.length; i++) {
      assert.ok(Math.abs(Math.hypot(ring[i].x - C.x, ring[i].z - C.z) - g.r) < 1e-9, `第 ${i} 点不在半径 ${g.r} 上`);
      assert.ok(Math.abs(ring[i].y - C.y - g.h) < 1e-9, `第 ${i} 点离地不是 ${g.h}`);
      if (i) { len += ring[i].distanceTo(ring[i - 1]); assert.equal(turn(ring[i - 1], ring[i]), g.dir, `第 ${i} 段转反了`); }
    }
    assert.ok(Math.abs(len / (G.speed * G.sec) - 1) < 0.03, `圈长 ${len.toFixed(1)} 米，速度乘时长是 ${G.speed * G.sec} 米`);
    assert.ok(p.pts[p.pts.length - 1].y > C.y + 20, '转完飞上天');
    assert.equal(p.slam, false);
    assert.equal(p.move, 0, '每帧跟着人重算');
  }
});

test('召龙的法阵跟着施法者：守关站原位时还是原来那一点；试炼里站到哪都亮在人旁边、广场上、不压着障碍', () => {
  assert.deepEqual(emergePoint().toArray(), [-3, 0, 4]);
  for (let x = -9.5; x <= 9.5; x += 0.5) {
    for (let z = -9.5; z <= 9.5; z += 0.5) {
      if (Math.hypot(x, z) > PLAZA_R - 1.2 || OBSTACLES.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 0.4)) continue;
      const E = emergePoint({ x, z });
      const d = Math.hypot(E.x - x, E.z - z);
      assert.ok(d > 2 && d < 4.6, `站在 (${x}, ${z})：法阵离人 ${d.toFixed(2)} 米`);
      assert.ok(Math.hypot(E.x, E.z) <= PLAZA_R - 1.2, `站在 (${x}, ${z})：法阵 (${E.x.toFixed(1)}, ${E.z.toFixed(1)}) 出了广场`);
      assert.ok(!OBSTACLES.some((o) => Math.hypot(E.x - o.x, E.z - o.z) < o.r + 0.6), `站在 (${x}, ${z})：法阵压着障碍`);
    }
  }
});

test('召龙：法阵亮在召唤那一刻定下的破土点，冰龙从那里钻出来；目标走动重算时沿用，不跳', () => {
  const E = emergePoint({ x: 6, z: 2 }), T = new THREE.Vector3(0, 0, -3.5);
  for (const el of ['ice', 'fire', 'thunder', 'wind']) assert.ok(flightPlan(el, T, undefined, undefined, E).sigil.equals(E), `${el} 的法阵不在破土点`);
  const ice = flightPlan('ice', T, undefined, undefined, E);
  assert.ok(ice.pts[0].y < -3 && Math.hypot(ice.pts[1].x - E.x, ice.pts[1].z - E.z) < 1e-9, '冰龙不是从破土点钻出来');
  const moved = flightPlan('ice', new THREE.Vector3(2, 0, -5), 'open', undefined, E);
  assert.ok(moved.sigil.equals(E) && moved.pts[1].equals(ice.pts[1]), '目标挪了，破土点跟着跳');
});
test('召龙：试炼里站到哪，冰龙破土盘上去到绕场这一段，八成五以上的站位离实心物件够远（1.2 米加摆幅），其余也不贴上去（0.4 米以上）', () => {
  const T = new THREE.Vector3(0, 0, -3.5);
  let n = 0, ok = 0, worst = Infinity;
  for (let x = -9.5; x <= 9.5; x += 0.5) {
    for (let z = -9.5; z <= 9.5; z += 0.5) {
      if (Math.hypot(x, z) > PLAZA_R - 1.2 || OBSTACLES.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 0.4)) continue;
      const curve = new THREE.CatmullRomCurve3(summonPoints(T, 'open', emergePoint({ x, z })), false, 'centripetal');
      let min = Infinity;
      for (let i = 0; i <= 200; i++) {
        const q = curve.getPoint((i / 200) * (6 / 13));   // 到绕场第一点（第 7 个控制点）为止
        if (q.y >= -0.5) min = Math.min(min, toSolids(q));
      }
      n++; if (min >= 1.2 + 0.18 * 1.3) ok++;
      worst = Math.min(worst, min);
    }
  }
  assert.ok(ok / n >= 0.85, `只有 ${ok} / ${n} 个站位够远`);
  assert.ok(worst >= 0.4, `最近的离实心物件只有 ${worst.toFixed(2)} 米`);
});