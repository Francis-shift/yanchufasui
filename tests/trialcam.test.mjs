// 试炼的俯视跟随镜头（world/trialcam.js）：该离多远、boss 出画时边缘箭头放哪。画面好不好看在预览页里看
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FOLLOW, LOCK, ORBIT, SHOT, VIEWS, clearDist, followPose, kickAt, lockPose, lockTarget, nextView, offscreenArrow, orbitDrag, orbitHome,
  orbitIsHome, orbitOpts, orbitZoom, readView, shoulderPose, turnToward, viewDir } from '../game/world/trialcam.js';
import { CAMERA_BLOCKERS, SOLIDS } from '../game/world/layout.js';

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

test('自己摆镜头：没动过就是默认机位；往右拖镜头往左绕、往下拖俯得更多，俯角夹在上下限里，转多少圈都收在 ±π', () => {
  const o = orbitHome();
  assert.ok(orbitIsHome(o));
  assert.deepEqual(orbitOpts(o), { yaw: FOLLOW.yaw, pitch: FOLLOW.pitch, dist: FOLLOW.dist, maxDist: FOLLOW.maxDist });
  orbitDrag(o, 100, 0);
  assert.ok(o.yaw < 0 && Math.abs(o.yaw + 100 * ORBIT.sens) < 1e-12);
  orbitDrag(o, 0, 40);
  assert.ok(o.pitch > 0);
  orbitDrag(o, 0, 1e4);
  assert.ok(Math.abs(FOLLOW.pitch + o.pitch - ORBIT.pitchMax) < 1e-12);
  orbitDrag(o, 0, -1e5);
  assert.ok(Math.abs(FOLLOW.pitch + o.pitch - ORBIT.pitchMin) < 1e-12);
  for (let i = 0; i < 50; i++) orbitDrag(o, 997, 0);
  assert.ok(Math.abs(o.yaw) <= Math.PI + 1e-12);
  assert.ok(!orbitIsHome(o));
});

test('滚轮：往下滚拉远、往上滚推近，夹在最近最远之间；拉远超过原来的最远时，最远跟着放宽', () => {
  const o = orbitHome();
  orbitZoom(o, 100);
  assert.ok(o.zoom > 1);
  orbitZoom(o, -300);
  assert.ok(o.zoom < 1);
  orbitZoom(o, 1e5);
  assert.equal(o.zoom, ORBIT.zoomMax);
  const opts = orbitOpts(o);
  assert.ok(Math.abs(opts.dist - FOLLOW.dist * ORBIT.zoomMax) < 1e-12);
  assert.ok(opts.maxDist >= opts.dist);
  orbitZoom(o, -1e5);
  assert.equal(o.zoom, ORBIT.zoomMin);
  assert.equal(orbitOpts(o).maxDist, FOLLOW.maxDist, '拉近了，boss 跑远时照旧能自动拉到原来的最远');
});

test('转过的镜头：方向跟着转，走位的"往前"（镜头方向反过来）也跟着转；人和 boss 照样框在安全框里', () => {
  const p = { x: 3, z: 4 }, boss = { x: -6, z: -5, h: 3.2 };
  for (const yaw of [Math.PI / 2, Math.PI, -2.2]) {
    for (const dy of [0, -400, 400]) {
      const o = orbitHome();
      o.yaw = yaw;
      orbitDrag(o, 0, dy);
      const opts = orbitOpts(o);
      for (const aspect of [16 / 9, 740 / 360]) {
        const camera = lens(aspect);
        const pose = followPose(camera, p, boss, opts);
        const want = viewDir(FOLLOW.pitch + o.pitch, FOLLOW.yaw + yaw);   // 照拖过的量自己算，不拿 orbitOpts 的结果当标尺
        assert.ok(pose.dir.distanceTo(want) < 1e-9);
        const fwd = pose.dir.clone().negate().setY(0).normalize();
        assert.ok(Math.abs(Math.atan2(-fwd.x, -fwd.z) - Math.atan2(Math.sin(opts.yaw), Math.cos(opts.yaw))) < 1e-9, '往前正对着镜头朝的方向');
        if (pose.dist < opts.maxDist) {
          place(camera, pose);
          for (const [x, y, z] of [[p.x, 0, p.z], [p.x, 1.9, p.z], [boss.x, 0, boss.z], [boss.x, boss.h, boss.z]]) {
            assert.ok(inside(camera, x, y, z), `${x},${y},${z} yaw ${yaw} dy ${dy} @ ${aspect}`);
          }
        }
      }
    }
  }
});

test('镜头被实心盒子挡住：挪到盒子跟前；盒子在镜头后面、看的点在盒子里都不管；最近不近过 3 米', () => {
  const look = new THREE.Vector3(0, 1, 0), up = new THREE.Vector3(0, 0, 1);
  const wall = { min: [-2, 0, 5], max: [2, 4, 6] };
  assert.equal(clearDist(look, up, 11, []), 11);
  assert.ok(Math.abs(clearDist(look, up, 11, [wall]) - 4.6) < 1e-9, '盒子前面 5 米，放宽 0.4');
  assert.equal(clearDist(look, up, 4, [wall]), 4, '镜头本来就在盒子前面');
  assert.equal(clearDist(look, up, 11, [{ min: [-2, 0, 1], max: [2, 4, 2] }]), 3, '挡得太近也留 3 米');
  assert.equal(clearDist(look, up, 11, [{ min: [-1, 0, -1], max: [1, 4, 1] }]), 11, '贴着柱子站（看的点在盒子里）');
  assert.equal(clearDist(look, up, 11, [{ min: [3, 0, 5], max: [5, 4, 6] }]), 11, '盒子在旁边');
});

test('转到牌坊那一侧、人站在牌坊跟前：镜头挪到牌坊里面；默认朝向在广场上哪儿都不被牌坊挡、镜头不乱推', () => {
  assert.ok(CAMERA_BLOCKERS.length >= 3 && CAMERA_BLOCKERS.every((b) => SOLIDS.includes(b)), '牌坊两组柱子、屋顶（还有镇山石）');
  assert.ok(CAMERA_BLOCKERS.every((b) => b.min[2] < -6), '都在牌坊那一带');
  const lineHits = (a, b) => CAMERA_BLOCKERS.some((s) => {
    for (let k = 0; k <= 200; k++) {
      const p = a.clone().lerp(b, k / 200);
      if (p.x > s.min[0] && p.x < s.max[0] && p.y > s.min[1] && p.y < s.max[1] && p.z > s.min[2] && p.z < s.max[2]) return true;
    }
    return false;
  });
  const o = orbitHome();
  o.yaw = Math.PI;   // 镜头转到 -z 那一侧（牌坊在 z -8.6）
  const pose = followPose(lens(), { x: 2, z: -5 }, null, orbitOpts(o));
  const far = pose.look.clone().addScaledVector(pose.dir, pose.dist);
  assert.ok(lineHits(pose.look, far), '这个站位本来会被挡（试题本身有效）');
  const d = clearDist(pose.look, pose.dir, pose.dist, CAMERA_BLOCKERS);
  assert.ok(d < pose.dist && d >= 3);
  assert.ok(!lineHits(pose.look, pose.look.clone().addScaledVector(pose.dir, d)));
  for (let x = -8; x <= 8; x += 2) for (let z = -6; z <= 8; z += 2) {
    const q = followPose(lens(), { x, z }, null);
    assert.equal(clearDist(q.look, q.dir, q.dist, CAMERA_BLOCKERS), q.dist, `${x},${z}`);
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

test('完美闪避推近：开始前和结束后是 0，很快推到满、再慢慢退回', () => {
  const { in: a, out: b } = SHOT.kick;
  assert.equal(kickAt(-0.1), 0);
  assert.equal(kickAt(Infinity), 0);
  assert.equal(kickAt(a + b), 0);
  assert.ok(Math.abs(kickAt(a) - 1) < 1e-9);
  assert.ok(kickAt(a / 2) > 0.4 && kickAt(a / 2) < 0.6);
  // 退回的一段一路往下
  let last = 1;
  for (let t = a; t < a + b; t += 0.05) { const k = kickAt(t); assert.ok(k <= last + 1e-12); last = k; }
});

test('召龙的肩后镜头：在人身后、偏右、比人高，朝着龙要砸的地方；龙钻出来后看的点往龙头偏', () => {
  const fwd = new THREE.Vector3(0, 0, -1);
  for (const [p, T] of [[{ x: 0, z: 5 }, { x: 0, z: -4 }], [{ x: -6, z: 2 }, { x: 5, z: -3 }], [{ x: 7, z: -7 }, { x: -2, z: 6 }]]) {
    const { pos, look } = shoulderPose(p, T, null, fwd);
    const f = new THREE.Vector3(T.x - p.x, 0, T.z - p.z).normalize();
    const off = new THREE.Vector3(pos.x - p.x, 0, pos.z - p.z);
    assert.ok(Math.abs(off.dot(f) + SHOT.back) < 1e-9, '身后');
    const right = new THREE.Vector3(-f.z, 0, f.x);
    assert.ok(Math.abs(off.dot(right) - SHOT.side) < 1e-9, '偏右');
    assert.equal(pos.y, SHOT.up);
    assert.deepEqual([look.x, look.y, look.z], [T.x, SHOT.lookY, T.z]);
    // 照这个机位看过去，人落在画面左半边、在画面里
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500);
    cam.position.copy(pos); cam.lookAt(look); cam.updateMatrixWorld();
    const q = new THREE.Vector3(p.x, 1.2, p.z).project(cam);
    assert.ok(q.x < 0 && q.x > -1 && Math.abs(q.y) < 1 && q.z < 1, JSON.stringify(q));
  }
  const head = new THREE.Vector3(-3, 3, 2);
  const withHead = shoulderPose({ x: 0, z: 5 }, { x: 0, z: -4 }, head, fwd).look;
  const want = new THREE.Vector3(0, SHOT.lookY, -4).lerp(head, SHOT.head);
  assert.ok(withHead.distanceTo(want) < 1e-9);
  // 龙飞得很高：看的点横着照样偏过去，高度封顶
  const high = shoulderPose({ x: 0, z: 5 }, { x: 0, z: -4 }, new THREE.Vector3(-3, 30, 2), fwd).look;
  assert.equal(high.y, SHOT.maxLookY);
  assert.ok(Math.abs(high.x - want.x) < 1e-9 && Math.abs(high.z - want.z) < 1e-9);
});

test('召龙的肩后镜头：横屏时人的上半身在按钮那一排上面；龙还没钻出来时在画面左边、电脑上底下正中那排按钮的左边', () => {
  const fwd = new THREE.Vector3(0, 0, -1);
  // 龙钻出来以后看的点往龙头偏，龙在人哪一边都可能，人不一定还在左边——只要求在画面里、在按钮排上面
  for (const aspect of [16 / 9, 740 / 360]) {
    for (const head of [null, new THREE.Vector3(-3, 2, 2), new THREE.Vector3(1, 12, -5)]) {
      for (const [p, T] of [[{ x: -4, z: 7 }, { x: 0, z: -2 }], [{ x: 3, z: 3 }, { x: -1, z: -3 }]]) {
        const { pos, look } = shoulderPose(p, T, head, fwd, aspect);
        const cam = new THREE.PerspectiveCamera(50, aspect, 0.1, 500);
        cam.position.copy(pos); cam.lookAt(look); cam.updateMatrixWorld();
        const chest = new THREE.Vector3(p.x, 1.2, p.z).project(cam), top = new THREE.Vector3(p.x, 1.8, p.z).project(cam);
        if (!head) assert.ok(chest.x < -0.35, `x ${chest.x}`);
        assert.ok(chest.x < 0.9 && chest.x > -0.9, `x ${chest.x}`);
        assert.ok(chest.y > -0.6 && top.y < 0.6, `y ${chest.y} ${top.y}`);
      }
    }
  }
});

test('召龙的肩后镜头：竖长的窗口少往右偏，人不出画', () => {
  const fwd = new THREE.Vector3(0, 0, -1);
  const p = { x: -4, z: 7 };
  const { pos, look } = shoulderPose(p, { x: 0, z: -2 }, null, fwd, 0.46);
  const cam = new THREE.PerspectiveCamera(62, 0.46, 0.1, 500);
  cam.position.copy(pos); cam.lookAt(look); cam.updateMatrixWorld();
  const chest = new THREE.Vector3(p.x, 1.2, p.z).project(cam);
  assert.ok(chest.x < 0 && chest.x > -0.9 && Math.abs(chest.y) < 1, JSON.stringify(chest));
});

test('视角三档轮着切，存的东西不认识就回到俯视', () => {
  assert.deepEqual([...VIEWS], ['follow', 'shoulder', 'first']);
  assert.equal(nextView('follow'), 'shoulder');
  assert.equal(nextView('shoulder'), 'first');
  assert.equal(nextView('first'), 'follow');
  assert.equal(readView('first'), 'first');
  for (const s of [null, '', 'third', 'FIRST', '{"x":1}']) assert.equal(readView(s), 'follow');
});

test('锁谁：有 boss 锁 boss，没有锁最近的一只，都没有给 null', () => {
  const p = { x: 0, z: 0 }, boss = { x: 9, z: 9 };
  const near = { x: 1, z: -2 }, far = { x: -5, z: 5 };
  assert.equal(lockTarget(p, boss, [near, far]), boss);
  assert.equal(lockTarget(p, null, [far, near]), near);
  assert.equal(lockTarget(p, null, []), null);
});

test('往前朝目标转：每帧最多转 rate×dt，走近路，转到了就停；没目标、目标在脚下不转', () => {
  const p = { x: 0, z: 0 };
  // 朝 +z，目标在 -x（左手边 90°）：一帧 0.1 秒最多转 0.24 弧度
  const d = new THREE.Vector3(0, 0, 1);
  turnToward(d, p, { x: -5, z: 0 }, 0.1);
  assert.ok(Math.abs(Math.atan2(d.x, d.z) - -LOCK.turn * 0.1) < 1e-9, `${Math.atan2(d.x, d.z)}`);
  assert.ok(Math.abs(d.length() - 1) < 1e-9 && d.y === 0);
  // 转够了就正对着
  for (let i = 0; i < 20; i++) turnToward(d, p, { x: -5, z: 0 }, 0.1);
  assert.ok(Math.abs(d.x + 1) < 1e-9 && Math.abs(d.z) < 1e-9);
  // 跨过 ±180°：朝 (−0.1, −1) 附近，目标在 (+0.1, −1) 方向，应该往小的那边转一点点，不绕一大圈
  const e = new THREE.Vector3(Math.sin(Math.PI - 0.05), 0, Math.cos(Math.PI - 0.05));
  turnToward(e, p, { x: -Math.sin(0.05) * 5, z: -Math.cos(0.05) * 5 }, 1);
  assert.ok(Math.abs(Math.abs(Math.atan2(e.x, e.z)) - (Math.PI - 0.05)) < 1e-9, `${Math.atan2(e.x, e.z)}`);
  // 没目标、目标就在脚下：不转
  const f = new THREE.Vector3(0.6, 0, -0.8);
  turnToward(f, p, null, 1);
  turnToward(f, p, { x: 0.1, z: 0.2 }, 1);
  assert.ok(Math.abs(f.x - 0.6) < 1e-9 && Math.abs(f.z + 0.8) < 1e-9);
});

test('肩后：镜头在人身后、偏右、比人高；人在画面左边偏下、整个人在画面里，前面几米的地看得见', () => {
  for (const aspect of [16 / 9, 740 / 360, 0.6]) {
    for (const [p, a] of [[{ x: 0, z: 5 }, 0], [{ x: -6, z: 2 }, 2.1], [{ x: 7, z: -7 }, -2.8]]) {
      const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      const { pos, look } = lockPose('shoulder', p, dir, aspect);
      const off = new THREE.Vector3(pos.x - p.x, 0, pos.z - p.z);
      assert.ok(Math.abs(off.dot(dir) + LOCK.back) < 1e-9, '身后');
      assert.ok(off.dot(new THREE.Vector3(-dir.z, 0, dir.x)) > 0, '偏右');
      assert.equal(pos.y, LOCK.up);
      const cam = new THREE.PerspectiveCamera(aspect < 0.8 ? 62 : 50, aspect, 0.1, 500);
      cam.position.copy(pos); cam.lookAt(look); cam.updateMatrixWorld();
      const feet = new THREE.Vector3(p.x, 0, p.z).project(cam), top = new THREE.Vector3(p.x, 1.9, p.z).project(cam);
      assert.ok(feet.x < 0 && feet.x > -0.9 && feet.y > -0.8 && top.y < 0.5, `feet ${feet.x} ${feet.y} top ${top.y} @ ${aspect}`);
      // 人前面 3 米的地在画面里
      const ahead = new THREE.Vector3(p.x + dir.x * 3, 0, p.z + dir.z * 3).project(cam);
      assert.ok(Math.abs(ahead.x) < 1 && Math.abs(ahead.y) < 1 && ahead.z < 1, `ahead ${ahead.x} ${ahead.y}`);
    }
  }
});

test('第一人称：镜头在眼睛的位置、稍往前，朝"往前"略往下看；正前方的目标在画面正中一带', () => {
  const p = { x: 2, z: -1 }, dir = new THREE.Vector3(-0.6, 0, -0.8);
  const { pos, look } = lockPose('first', p, dir);
  assert.equal(pos.y, LOCK.eye);
  assert.ok(Math.abs(Math.hypot(pos.x - p.x, pos.z - p.z) - LOCK.nose) < 1e-9);
  assert.ok(look.y < pos.y);
  const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500);
  cam.position.copy(pos); cam.lookAt(look); cam.updateMatrixWorld();
  const boss = new THREE.Vector3(p.x + dir.x * 8, 1.6, p.z + dir.z * 8).project(cam);
  assert.ok(Math.abs(boss.x) < 1e-6 && Math.abs(boss.y) < 0.4 && boss.z < 1, JSON.stringify(boss));
  // 自己的脚在镜头底下，看不见
  const feet = new THREE.Vector3(p.x, 0, p.z).project(cam);
  assert.ok(feet.y < -1 || feet.z > 1, JSON.stringify(feet));
});

test('召龙的肩后镜头：目标就在脚下时朝俯视跟随的"往前"看，不出 NaN', () => {
  const fwd = new THREE.Vector3(-0.3, -0.5, -0.8);
  const { pos, look } = shoulderPose({ x: 1, z: 1 }, { x: 1.2, z: 1.1 }, null, fwd);
  for (const v of [pos.x, pos.y, pos.z, look.x, look.y, look.z]) assert.ok(Number.isFinite(v));
  const f = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
  assert.ok(Math.abs((pos.x - 1) * f.x + (pos.z - 1) * f.z + SHOT.back) < 1e-9);
});
