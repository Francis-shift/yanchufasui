// 骨骼模型（game/actors/rig.js 读 tools/pack_rig.py 打的 RIG1）：解开小傀儡的正式文件，用 three.js 自己的骨骼动画跑几帧核对。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import * as THREE from 'three';
import { decodeRig, makeRig, playRig } from '../game/actors/rig.js';

const raw = gunzipSync(readFileSync(new URL('../public/models/grunt.rig.gz', import.meta.url)));
const rig = { ...decodeRig(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)), tex: null };

test('小傀儡模型：骨架父在前子在后，每个顶点的权重加起来是 1、骨号不越界；四段动作都在', () => {
  const g = rig.geometry, n = g.attributes.position.count;
  assert.ok(n > 1000 && g.index.count % 3 === 0);
  rig.bones.forEach((b, i) => assert.ok(b.parent < i, `${b.name} 的父骨排在它前面`));
  assert.equal(rig.bones[0].name, 'Hips');
  assert.ok(rig.bones.some((b) => b.name === 'Head'), '挂黄符、铁盔要用头骨');
  const J = g.attributes.skinIndex.array, W = g.attributes.skinWeight.array;
  for (let i = 0; i < n; i++) {
    assert.equal(W[i * 4] + W[i * 4 + 1] + W[i * 4 + 2] + W[i * 4 + 3], 255);
    for (let k = 0; k < 4; k++) assert.ok(J[i * 4 + k] < rig.bones.length);
  }
  for (const c of ['run', 'walk', 'idle', 'box']) assert.ok(rig.clips[c]?.duration > 0, c);
  // 走、跑记了原本的前进速度（游戏里按它配播放快慢），跑得比走快；原地的动作是 0
  assert.ok(rig.speeds.run > rig.speeds.walk && rig.speeds.walk > 0);
  assert.equal(rig.speeds.idle, 0);
});

test('刚做出来就摆着待机的姿势：手不在绑骨骼时的位置（冒出来就被冻住，定住的不是 T 字）', () => {
  const r = makeRig(rig, new THREE.MeshBasicMaterial());
  assert.equal(r.cur, 'idle');
  r.mesh.updateMatrixWorld(true);
  const at = (i) => (i < 0 ? new THREE.Matrix4()
    : at(rig.bones[i].parent).multiply(new THREE.Matrix4().compose(new THREE.Vector3(...rig.bones[i].t), new THREE.Quaternion(...rig.bones[i].q), new THREE.Vector3(1, 1, 1))));
  const hand = rig.bones.findIndex((b) => b.name === 'LeftHand');
  const rest = new THREE.Vector3().setFromMatrixPosition(at(hand));
  const now = r.bones.LeftHand.getWorldPosition(new THREE.Vector3());
  assert.ok(now.distanceTo(rest) > 0.05, `左手离绑定位置 ${now.distanceTo(rest).toFixed(3)}`);
  r.mesh.skeleton.dispose();
});

/** 放这段动作 sec 秒，每 step 秒量一次：最低点（脚）多高、髋骨离静止位置水平多远、身上的点挪了多少 */
function sample(name, sec = 1.4, step = 0.1) {
  const r = makeRig(rig, new THREE.MeshBasicMaterial());
  playRig(r, name, 1, 0);
  const pos = r.mesh.geometry.attributes.position, v = new THREE.Vector3(), out = [];
  const rest = new THREE.Vector3(...rig.bones[0].t), hip = new THREE.Vector3();
  let prev = null;
  for (let t = 0; t < sec; t += step) {
    r.mixer.update(step);
    r.mesh.updateMatrixWorld(true);
    r.mesh.skeleton.update();
    let low = Infinity, moved = 0;
    const now = [];
    for (let i = 0; i < pos.count; i += 7) {
      v.fromBufferAttribute(pos, i);
      r.mesh.applyBoneTransform(i, v);
      low = Math.min(low, v.y);
      now.push(v.clone());
    }
    if (prev) moved = Math.max(...now.map((p, i) => p.distanceTo(prev[i])));
    prev = now;
    r.bones.Hips.getWorldPosition(hip);
    out.push({ low, drift: Math.hypot(hip.x - rest.x, hip.z - rest.z), moved });
  }
  r.mesh.skeleton.dispose();
  return out;
}

test('跑、走：一整个循环里脚一直踩在地面附近、真的在动，而且原地踏步（髋骨不往前漂）', () => {
  for (const name of ['run', 'walk']) {
    const s = sample(name, rig.clips[name].duration * 1.5);
    for (const f of s) {
      assert.ok(f.low > -0.08 && f.low < 0.12, `${name} 最低点 ${f.low.toFixed(3)}`);
      assert.ok(f.drift < 0.2, `${name} 髋骨漂了 ${f.drift.toFixed(3)}`);
    }
    assert.ok(Math.max(...s.map((f) => f.moved)) > 0.05, `${name} 动起来了`);
  }
});
