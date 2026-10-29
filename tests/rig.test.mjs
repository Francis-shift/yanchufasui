// 骨骼模型（game/actors/rig.js 读 tools/pack_rig.py 打的 RIG1）：解开小傀儡、施法者、三个 boss 的正式文件，用 three.js 自己的骨骼动画跑几帧核对。
// 施法者另外核对 game/actors/caster.js 的两层动作（边跑边出掌只换上半身）和朝向。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import * as THREE from 'three';
import { BOSS_CLIPS } from '../game/actors/bossanim.js';
import { Caster } from '../game/actors/caster.js';
import { decodeRig, makeRig, playRig } from '../game/actors/rig.js';

/** @param {string} file public/models 下的文件名 */
function load(file) {
  const raw = gunzipSync(readFileSync(new URL(`../public/models/${file}`, import.meta.url)));
  return { ...decodeRig(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)), tex: null };
}
const MODELS = {
  小傀儡: { rig: load('grunt.rig.gz'), clips: ['run', 'walk', 'idle', 'box'] },
  施法者: { rig: load('caster.rig.gz'), clips: ['run', 'walk', 'idle', 'charge', 'cast', 'dodge'] },
};

for (const [who, { rig, clips }] of Object.entries(MODELS)) {
  test(`${who}模型：骨架父在前子在后，每个顶点的权重加起来是 1、骨号不越界；动作都在`, () => {
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
    for (const c of clips) assert.ok(rig.clips[c]?.duration > 0, c);
    // 走、跑记了原本的前进速度（游戏里按它配播放快慢），跑得比走快；原地的动作是 0
    assert.ok(rig.speeds.run > rig.speeds.walk && rig.speeds.walk > 0);
    assert.equal(rig.speeds.idle, 0);
  });

  test(`${who}：刚做出来就摆着待机的姿势：手不在绑骨骼时的位置（冒出来就被冻住，定住的不是 T 字）`, () => {
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

  test(`${who}跑、走：一整个循环里脚一直踩在地面附近、真的在动，而且原地踏步（髋骨不往前漂）`, () => {
    for (const name of ['run', 'walk']) {
      const s = sample(rig, name, rig.clips[name].duration * 1.5);
      for (const f of s) {
        assert.ok(f.low > -0.08 && f.low < 0.12, `${name} 最低点 ${f.low.toFixed(3)}`);
        assert.ok(f.drift < 0.2, `${name} 髋骨漂了 ${f.drift.toFixed(3)}`);
      }
      assert.ok(Math.max(...s.map((f) => f.moved)) > 0.05, `${name} 动起来了`);
    }
  });
}

for (const [who, file, type] of [['寒甲傀儡王', 'boss.rig.gz', 'boss'], ['石甲巨像', 'stone.rig.gz', 'stone'], ['火灵', 'flame.rig.gz', 'flame']]) {
  test(`${who}模型：骨架、权重同上；出招表（bossanim.js）里的每段动作（借来的按借的那段）都在，出手、收招、来回那一段都落在动作长度以内；走路原地、脚踩地`, () => {
    const rig = load(file), g = rig.geometry, n = g.attributes.position.count;
    rig.bones.forEach((b, i) => assert.ok(b.parent < i, `${b.name} 的父骨排在它前面`));
    const J = g.attributes.skinIndex.array, W = g.attributes.skinWeight.array;
    for (let i = 0; i < n; i++) {
      assert.equal(W[i * 4] + W[i * 4 + 1] + W[i * 4 + 2] + W[i * 4 + 3], 255);
      for (let k = 0; k < 4; k++) assert.ok(J[i * 4 + k] < rig.bones.length);
    }
    for (const [name, c] of Object.entries(BOSS_CLIPS[type])) {
      const clip = /** @type {any} */ (c).clip ?? name, d = rig.clips[clip]?.duration;
      assert.ok(d > 0, `没有 ${clip} 这段动作`);
      for (const x of [c.hit, c.end, ...(/** @type {any} */ (c).hold ?? [])]) assert.ok(x >= 0 && x <= d + 1e-6, `${name}：${x} 秒超出动作长度 ${d.toFixed(2)}`);
    }
    assert.ok(rig.clips.idle?.duration > 0 && rig.speeds.walk > 0);
    for (const f of sample(rig, 'walk', rig.clips.walk.duration * 1.5)) {
      assert.ok(f.low > -0.08 && f.low < 0.12, `walk 最低点 ${f.low.toFixed(3)}`);
      assert.ok(f.drift < 0.2, `walk 髋骨漂了 ${f.drift.toFixed(3)}`);
    }
  });
}

/** 放这段动作 sec 秒，每 step 秒量一次：最低点（脚）多高、髋骨离静止位置水平多远、身上的点挪了多少 */
function sample(rig, name, sec = 1.4, step = 0.1) {
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

/** 和游戏里一样：组里先放一个胶囊占位，再把模型套进去 */
function caster() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1, 4, 8), new THREE.MeshStandardMaterial()));
  const c = new Caster(g);
  c.use(MODELS.施法者.rig);
  return c;
}
/** 右手相对胸口指向哪边，减去身子的朝向（度，0 = 正前方） @param {Caster} c */
function handOff(c) {
  c.group.updateMatrixWorld(true);
  const h = c.r.bones.RightHand.getWorldPosition(new THREE.Vector3()), s = c.r.bones.Spine2.getWorldPosition(new THREE.Vector3());
  const a = Math.atan2(h.x - s.x, h.z - s.z) - c.yaw;
  return (Math.atan2(Math.sin(a), Math.cos(a)) * 180) / Math.PI;
}

test('施法者出掌：站着整个人做，边跑边放只换上半身——腿照样跑，掌都朝身子前方（侧身马步的髋骨转动挪到了脊柱上）', () => {
  const still = caster();
  still.cast(null);
  for (let i = 0; i < 33; i++) still.update(1 / 60, true);   // 出掌约 0.35 秒推到底
  assert.ok(Math.abs(handOff(still)) < 25, `站着出掌偏 ${handOff(still).toFixed(0)}°`);
  assert.equal(still.acts.cast.upper?.weight ?? 0, 0, '站着不用上半身那份');

  const run = caster(), dt = 1 / 60;
  for (let i = 0; i < 40; i++) { run.group.position.x += 4.2 * dt; run.update(dt, true); }
  assert.equal(run.r.cur, 'run');
  assert.ok(Math.abs(run.yaw - Math.PI / 2) < 0.05, `朝着跑的方向（+x），yaw ${run.yaw.toFixed(2)}`);
  run.cast(null);
  for (let i = 0; i < 33; i++) { run.group.position.x += 4.2 * dt; run.update(dt, true); }
  assert.equal(run.r.cur, 'run', '腿还在跑');
  assert.ok(run.acts.cast.upper.weight > 5 && run.acts.cast.full.weight < 0.05, '只换上半身');
  assert.ok(Math.abs(handOff(run)) < 30, `边跑边出掌偏 ${handOff(run).toFixed(0)}°`);
});

test('施法者朝向：守关站桩面朝山门（−z）；放招转向打的方向，过一会儿转回来；试炼里站着不动就保持原来的朝向', () => {
  const c = caster(), dt = 1 / 60;
  for (let i = 0; i < 30; i++) c.update(dt, false);
  assert.ok(Math.abs(Math.abs(c.yaw) - Math.PI) < 1e-6, '面朝 −z');
  c.cast({ x: c.group.position.x + 5, z: c.group.position.z });   // 打右边（+x）
  for (let i = 0; i < 30; i++) c.update(dt, false);
  assert.ok(Math.abs(c.yaw - Math.PI / 2) < 0.05, `转过去了，yaw ${c.yaw.toFixed(2)}`);
  for (let i = 0; i < 120; i++) c.update(dt, false);
  assert.ok(Math.abs(Math.abs(c.yaw) - Math.PI) < 0.05, `守关：转回山门，yaw ${c.yaw.toFixed(2)}`);

  const t = caster();
  t.cast({ x: t.group.position.x + 5, z: t.group.position.z });
  for (let i = 0; i < 150; i++) t.update(dt, true);
  assert.ok(Math.abs(t.yaw - Math.PI / 2) < 0.05, `试炼：保持朝打的方向，yaw ${t.yaw.toFixed(2)}`);
});

test('施法者：蓄力保持到出掌或收手；收手后淡出、动作停掉；残影是一份摆着当时姿势、之后不再动的拷贝', () => {
  const c = caster(), dt = 1 / 60;
  c.charge();
  for (let i = 0; i < 180; i++) c.update(dt, false);   // 3 秒：蓄力动作早放完了，还撑着
  assert.equal(c.acts.charge.w, 1);
  c.endCharge();
  for (let i = 0; i < 30; i++) c.update(dt, false);
  assert.equal(c.acts.charge.w, 0);
  assert.equal(c.acts.charge.on, false);
  assert.ok(Math.abs(c.r.actions.idle.weight - 1) < 1e-9, '底层拿回整个人');

  c.dodge();
  for (let i = 0; i < 15; i++) c.update(dt, true);
  const g = c.ghost(new THREE.MeshBasicMaterial());
  assert.ok(g);
  const q = c.g.bones.Spine2.quaternion.clone();
  assert.ok(q.angleTo(c.r.bones.Spine2.quaternion) < 1e-6, '残影摆着此刻的姿势');
  for (let i = 0; i < 30; i++) c.update(dt, true);
  assert.ok(c.g.bones.Spine2.quaternion.angleTo(q) < 1e-6, '之后不跟着动');
  assert.equal(c.ghost(new THREE.MeshBasicMaterial()), g, '每次闪避重摆同一份，不另做');
});
