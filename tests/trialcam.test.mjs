// 试炼的俯视跟随镜头（world/trialcam.js）：该离多远、boss 出画时边缘箭头放哪。画面好不好看在预览页里看
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FOLLOW, followPose, offscreenArrow, viewDir } from '../game/world/trialcam.js';

const lens = (aspect = 16 / 9) => new THREE.PerspectiveCamera(50, aspect, 0.1, 500);

/** 照 followPose 给的结果摆一台镜头 */
function place(camera, pose) {
  camera.position.copy(pose.look).addScaledVector(pose.dir, pose.dist);
  camera.lookAt(pose.look);
  camera.updateMatrixWorld();
  return camera;
}

function inside(camera, x, y, z) {
  const p = new THREE.Vector3(x, y, z).project(camera);
  return Math.abs(p.x) <= FOLLOW.safe.x + 1e-6 && p.y <= FOLLOW.safe.top + 1e-6 && p.y >= FOLLOW.safe.bottom - 1e-6;
}

test('镜头方向朝上、和守关镜头在同一侧，长度为 1', () => {
  const d = viewDir(FOLLOW.pitch, FOLLOW.yaw);
  assert.ok(Math.abs(d.length() - 1) < 1e-9);
  assert.ok(d.y > 0 && d.x > 0 && d.z > 0);
});

test('没有 boss 时只跟人：用默认距离，看的点在人前面一点、胸口高', () => {
  const pose = followPose(lens(), { x: 2, z: -3 }, null);
  assert.equal(pose.dist, FOLLOW.dist);
  assert.equal(pose.look.y, FOLLOW.y);
  // 看的点比人更往画面里面（镜头在 +x +z 一侧，所以往 -x -z 挪）
  assert.ok(pose.look.x < 2 && pose.look.z < -3);
  assert.ok(Math.hypot(pose.look.x - 2, pose.look.z + 3) - FOLLOW.lead < 1e-9);
});

test('boss 在近处：不拉远，看的点往 boss 那边偏', () => {
  const p = { x: 0, z: 2 }, boss = { x: 0, z: -2, h: 3.2 };
  const pose = followPose(lens(), p, boss);
  const alone = followPose(lens(), p, null);
  assert.equal(pose.dist, FOLLOW.dist);
  assert.ok(pose.look.z < alone.look.z);
});

test('人和 boss 离远了就往后拉，拉到两个人从脚到头都在安全框里', () => {
  for (const [p, boss] of [[{ x: 0, z: 9 }, { x: 0, z: -9, h: 3.2 }], [{ x: -9, z: 0 }, { x: 9, z: 0, h: 3.2 }], [{ x: 7, z: -7 }, { x: -7, z: 7, h: 3.2 }]]) {
    for (const aspect of [16 / 9, 740 / 360, 0.6]) {
      const camera = lens(aspect);
      const pose = followPose(camera, p, boss);
      assert.ok(pose.dist > FOLLOW.dist && pose.dist <= FOLLOW.maxDist, `dist ${pose.dist}`);
      if (pose.dist < FOLLOW.maxDist) {
        place(camera, pose);
        for (const [x, y, z] of [[p.x, 0, p.z], [p.x, 1.9, p.z], [boss.x, 0, boss.z], [boss.x, boss.h, boss.z]]) assert.ok(inside(camera, x, y, z), `${x},${y},${z} @ ${aspect}`);
      }
    }
  }
});

test('拉远有上限：框不进来就停在最远处', () => {
  const pose = followPose(lens(), { x: 0, z: 60 }, { x: 0, z: -60, h: 3.2 });
  assert.equal(pose.dist, FOLLOW.maxDist);
});

test('框不下的极端情况（竖屏人和 boss 分在两头、镜头压得很近 boss 落到背后）：看的点不乱跑，镜头不低下去', () => {
  const cases = [
    [0.46, { x: -9, z: 0 }, { x: 9, z: 0, h: 3.2 }, {}],
    [16 / 9, { x: 7, z: 7 }, { x: 9, z: 9, h: 3.2 }, { dist: 4, maxDist: 4.01 }],
    [16 / 9, { x: 0, z: -6 }, { x: 0, z: 9, h: 3.2 }, { dist: 4, maxDist: 4.01 }],
  ];
  for (const [aspect, p, boss, o] of cases) {
    const pose = followPose(lens(aspect), p, boss, o);
    const span = Math.hypot(boss.x - p.x, boss.z - p.z);
    assert.equal(pose.look.y, FOLLOW.y);
    assert.ok(Math.hypot(pose.look.x - p.x, pose.look.z - p.z) <= FOLLOW.lead + span * FOLLOW.bias + span + 1e-6);
    assert.ok(pose.look.y + pose.dir.y * pose.dist > 3);
  }
});

test('边缘箭头：boss 在画面里不出箭头，出了画面就贴边并指向它', () => {
  const camera = place(lens(), followPose(lens(), { x: 0, z: 0 }, null));
  const look = followPose(lens(), { x: 0, z: 0 }, null).look;
  assert.equal(offscreenArrow(look.clone(), camera), null);

  // 镜头在 +x 一侧偏后，往镜头的右手边远处放一个点
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const far = look.clone().addScaledVector(right, 40);
  const a = offscreenArrow(far, camera);
  assert.ok(a);
  assert.ok(Math.abs(Math.max(Math.abs(a.x), Math.abs(a.y)) - 0.88) < 1e-9);
  assert.ok(a.x > 0 && Math.abs(a.angle) < Math.PI / 4);

  const leftUp = look.clone().addScaledVector(right, -40).add(new THREE.Vector3(0, 60, 0));
  const b = offscreenArrow(leftUp, camera);
  assert.ok(b && b.x < 0 && b.y > 0 && b.angle > Math.PI / 2);
});

test('边缘箭头：boss 在镜头背后，箭头不跟着投影翻到对面', () => {
  const camera = place(lens(), followPose(lens(), { x: 0, z: 0 }, null));
  const back = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2);   // 镜头背后的方向
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const behindRight = camera.position.clone().addScaledVector(back, 5).addScaledVector(right, 3);
  const a = offscreenArrow(behindRight, camera);
  assert.ok(a && a.x > 0, JSON.stringify(a));
  const straightBack = camera.position.clone().addScaledVector(back, 5);
  const b = offscreenArrow(straightBack, camera);
  assert.ok(b && b.y < 0, JSON.stringify(b));
});
