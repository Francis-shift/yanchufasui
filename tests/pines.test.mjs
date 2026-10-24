// 松树的根团不悬在外面（10-24 本人看出：中景石峰边上那棵黄山松树根整团露着）。
// 拿 public/models 里的真模型，按游戏里同一套摆法（props.js 的 perchPose、pinePlacements，drg2.js 的 flatSpots）摆好，
// 量每棵树根团（模型最底下 0.6 米，隔一个顶点取一个）有多少悬着——在山石外面、而且离底下的石面超过 0.25 米（贴着地面的根颈不算）；
// 石壁上的几棵再核树冠伸出来了（不是扎进石头里），台底那几棵树冠不高过台面。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';

import { decodeDRG2, flatSpots, staticGeometry, topOf } from '../game/world/drg2.js';
import { PROP_SPOTS } from '../game/world/layout.js';
import { perchPose, pinePlacements } from '../game/world/props.js';

/** @param {string} name */
function model(name) {
  const b = gunzipSync(readFileSync(new URL(`../public/models/${name}.drg2.gz`, import.meta.url)));
  return staticGeometry(decodeDRG2(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
}
const solid = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });   // 判里外要数正反两面
const rocks = { 'rock-a': model('rock-a'), 'rock-b': model('rock-b') };
const pines = [model('pine-a'), model('pine-b')];

// 摆山石：跟 loadProps 一样（中景按 PROP_SPOTS.rocks，邻峰、台底按顶面反推）
/** @type {Parameters<typeof pinePlacements>[0]} */
const perches = [];
for (const s of PROP_SPOTS.rocks) {
  const mesh = new THREE.Mesh(rocks[s.model], solid);
  mesh.position.set(s.x, s.y, s.z); mesh.rotation.y = s.rotY;
  if (s.mirror) mesh.scale.x = -1;
  mesh.scale.multiplyScalar(s.scale);
  perches.push({ mesh, name: s.model, kind: 'mid', wallAz: (s.wallPine * Math.PI) / 180 });
}
for (const [s, kind] of /** @type {const} */ ([[PROP_SPOTS.peak, 'peak'], [PROP_SPOTS.base, 'base']])) {
  const p = perchPose(s, topOf(rocks[s.model]));
  const mesh = new THREE.Mesh(rocks[s.model], solid);
  mesh.position.set(p.x, p.y, p.z); mesh.rotation.y = p.rotY; mesh.scale.setScalar(s.scale);
  perches.push({ mesh, name: s.model, kind });
}
const spots = Object.fromEntries(Object.entries(rocks).map(([n, g]) => [n, flatSpots(g, 8)]));
const lists = pinePlacements(perches, pines, spots);
const boxes = perches.map(({ mesh }) => { mesh.updateMatrixWorld(); return new THREE.Box3().setFromObject(mesh).expandByScalar(0.1); });

const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), upward = new THREE.Vector3(0, 1, 0);
/** 点在不在山石里：往上、往下各打一条线，穿过的面数都是奇数才算在里面 @param {THREE.Vector3} v */
const inside = (v) => perches.some(({ mesh }, i) => boxes[i].containsPoint(v) && [upward, down].every((d) => {
  ray.set(v, d);
  return ray.intersectObject(mesh).length % 2 === 1;
}));
/** 点离底下的石面多远（底下没有石头就是无穷远） @param {THREE.Vector3} v */
const gap = (v) => Math.min(...perches.map(({ mesh }, i) => {
  const b = boxes[i];
  if (v.x < b.min.x || v.x > b.max.x || v.z < b.min.z || v.z > b.max.z || v.y < b.min.y) return Infinity;
  ray.set(v, down);
  return ray.intersectObject(mesh)[0]?.distance ?? Infinity;
}));
/** 一棵树模型里 y 在 [lo, hi) 的顶点（每 step 个取一个）里，有几成满足 pick @param {number} kind @param {THREE.Matrix4} m */
function share(kind, m, lo, hi, step, /** @type {(v: THREE.Vector3) => boolean} */ pick) {
  const p = pines[kind].attributes.position, v = new THREE.Vector3();
  let n = 0, k = 0;
  for (let i = 0; i < p.count; i += step) {
    if (p.getY(i) < lo || p.getY(i) >= hi) continue;
    n++;
    if (pick(v.fromBufferAttribute(p, i).applyMatrix4(m))) k++;
  }
  return k / n;
}
const NAME = [['中景挺拔的', '中景黄山松'], ['近处挺拔的', '近处黄山松']];

test('松树：中景每块石峰顶上至少一棵、石壁上一棵，台底四棵、邻峰两棵（都打得到石壁）', () => {
  assert.ok(lists[0][0].length >= PROP_SPOTS.rocks.length, `中景顶上 ${lists[0][0].length} 棵`);
  assert.equal(lists[0][1].length, PROP_SPOTS.rocks.length);
  assert.equal(lists[1][1].length, PROP_SPOTS.cliffPines.length);
  assert.equal(lists[1][0].length, 0);   // 邻峰顶是落脚台，不种
});

test('松树：根团悬在外面的不到 3%', () => {
  for (const [g, group] of lists.entries()) {
    for (const [kind, mats] of group.entries()) {
      mats.forEach((m, i) => {
        const hang = share(kind, m, 0, 0.6, 2, (v) => !inside(v) && gap(v) > 0.25);
        assert.ok(hang < 0.03, `${NAME[g][kind]}第 ${i + 1} 棵：根团 ${(hang * 100).toFixed(0)}% 悬着`);
      });
    }
  }
});

test('松树：石壁上的黄山松树冠伸在外面（八成五以上的树冠顶点在山石外），台底的树冠不高过台面', () => {
  for (const [g, mats] of [[0, lists[0][1]], [1, lists[1][1]]]) {
    mats.forEach((m, i) => {
      const out = share(1, m, 1.4, Infinity, 6, (v) => !inside(v));
      assert.ok(out >= 0.85, `${NAME[/** @type {number} */ (g)][1]}第 ${i + 1} 棵：树冠只有 ${(out * 100).toFixed(0)}% 在外面`);
      const at = new THREE.Vector3().setFromMatrixPosition(m);
      if (Math.hypot(at.x, at.z) < 15) {   // 台底那几棵
        const topY = share(1, m, 0, Infinity, 1, (v) => v.y > -1);
        assert.equal(topY, 0, `台底第 ${i + 1} 棵树冠高过台面下 1 米`);
      }
    });
  }
});
