// 火旋风与落石（设计文档第 4 节元素反应表："风→火 火的作用范围 ×1.5"；"土→风 石墙被风推出，砸中的敌人受 30 点伤害"）
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { damageTo, fireReach, namesWall, rockRun, windReaches } from '../game/rules/arbiter.js';
import { ELEMENTS, REACTIONS } from '../game/rules/numbers.js';
import { Walls } from '../game/fx/walls.js';

const P = { x: 0, z: 0 };

test('火旋风：圈里有带风痕的敌人，火的范围 × 1.5', () => {
  assert.equal(fireReach('fire', 3, [{ x: 2, z: 0, windy: 1 }], P), 4.5);
  assert.equal(REACTIONS['wind+fire'].radiusMult, 1.5, '设计文档定的倍数');
});

test('火旋风：风痕散了、带风痕的在圈外、打下来的不是火，范围都不变', () => {
  assert.equal(fireReach('fire', 3, [{ x: 2, z: 0, windy: 0 }], P), 3);
  assert.equal(fireReach('fire', 3, [{ x: 2, z: 0 }], P), 3);
  assert.equal(fireReach('fire', 3, [{ x: 3.1, z: 0, windy: 2 }], P), 3, '圈外的风痕不算');
  assert.equal(fireReach('ice', 3, [{ x: 2, z: 0, windy: 2 }], P), 3);
});

test('火旋风：打中的标反应、照常灼烧，伤害不额外加（好处全在范围）；冻住的算蒸汽爆', () => {
  const r = damageTo({ type: 'grunt', frozen: false }, { el: 'fire', dmg: 40, whirl: true });
  assert.equal(r.reaction, '火旋风');
  assert.equal(r.dmg, 40);
  assert.equal(r.burnSec, ELEMENTS.fire.burnSec);
  assert.equal(damageTo({ type: 'grunt', frozen: true }, { el: 'fire', dmg: 40, whirl: true }).reaction, '蒸汽爆');
  assert.equal(damageTo({ type: 'grunt', frozen: false }, { el: 'fire', dmg: 40 }).reaction, '');
});

test('落石：砸中的按给的伤害算、标反应、顺着往外推', () => {
  const r = damageTo({ type: 'grunt', frozen: false }, { el: 'earth', dmg: REACTIONS['earth+wind'].rockDmg, rock: true });
  assert.equal(r.reaction, '落石');
  assert.equal(r.dmg, 30);
  assert.equal(r.push, ELEMENTS.wind.push);
  assert.equal(damageTo({ type: 'grunt', frozen: true }, { el: 'earth', dmg: 30, rock: true }).reaction, '落石', '冻住的也写落石');
  assert.equal(damageTo({ type: 'grunt', frozen: false }, { el: 'earth', dmg: 30 }).push, 0, '平常土不推人');
});

test('落石：风够得着墙的哪一段都算，够不着就不掀', () => {
  const pts = [{ x: 0, z: 0 }, { x: 4, z: 0 }];
  assert.ok(windReaches(pts, { x: 6, z: 0 }, 1.5), '只够得着靠近的那一段（2 米 ≤ 1.5 + 0.6）');
  assert.ok(!windReaches(pts, { x: 6.2, z: 0 }, 1.5));
});

test('落石：句子点名土墙才不看距离，只说风墙不算', () => {
  for (const t of ['用风把石墙推出去', '风吹石墙', '狂风把土墙吹向敌人', '大风把那堵墙吹倒', '风吹石壁']) assert.ok(namesWall(t), t);
  for (const t of ['立一道风墙', '在左边升起风墙', '风吹那一群', '狂风吹下悬崖']) assert.ok(!namesWall(t), t);
});

test('落石：路上没东西飞满，撞上东西停在跟前，一块一块算', () => {
  const dir = { x: 0, z: 1 };
  assert.equal(rockRun({ x: 0, z: 0 }, dir, 9, () => false), 9);
  assert.equal(rockRun({ x: 0, z: 0 }, dir, 9, (x, z) => z > 5), 5);
  assert.equal(rockRun({ x: 0, z: 0 }, dir, 9, () => true), 0, '一动就撞：原地碎');
  const pillar = (x, z) => x > 3 && z > 2;
  assert.equal(rockRun({ x: 4, z: 0 }, dir, 9, pillar), 2, '正对柱子的那块停');
  assert.equal(rockRun({ x: 0, z: 0 }, dir, 9, pillar), 9, '旁边那块接着飞');
});

/** 不开画面的一堵土墙：只管位置、寿命和飞不飞 */
function fakeWalls(payload = { form: 'wall' }) {
  const walls = Object.create(Walls.prototype);
  const removed = [];
  Object.assign(walls, { world: { removeBody: (b) => removed.push(b) }, p: { emit() {} }, scene: { remove() {} }, fx: null, list: [] });
  const w = { el: 'earth', pts: [{ x: 0, z: 0 }, { x: 1.1, z: 0 }], t: 1, sec: 8, hit: new Set(),
    meshes: [{ position: {}, visible: true }, { position: {}, visible: true }], bodies: ['b1', 'b2'], yaw: 0, payload };
  walls.list.push(w);
  return { walls, w, removed };
}

test('落石：掀出去的墙当场不挡路、不挡弹幕，物理实体拿掉，飞的时候在 flying 里', () => {
  const { walls, w, removed } = fakeWalls();
  assert.equal(walls.blowable().length, 1);
  walls.blow(w, { x: 0, z: 1 }, [3, 3], 16, { el: 'earth' });
  assert.deepEqual(walls.obstacles(), []);
  assert.deepEqual(walls.shields(), []);
  assert.deepEqual(removed, ['b1', 'b2']);
  assert.deepEqual(walls.blowable(), [], '飞着的不再掀一次');
  assert.deepEqual(walls.flying(), [w]);
});

test('落石：每块飞自己那段路，飞到头的不见了、别的接着飞，飞的时候不算寿命，全飞完这堵墙才没', () => {
  const { walls, w } = fakeWalls();
  w.t = w.sec - 0.4;   // 快到时间了才掀：也要飞完
  walls.blow(w, { x: 0, z: 1 }, [0.5, 3], 16, { el: 'earth' });
  for (let i = 0; i < 10; i++) { w.t += 0.016; walls.fly(w, 0.016); }
  assert.equal(w.meshes[0].visible, false, '飞 0.5 米的那块飞到头了');
  assert.ok(Math.abs(w.pts[0].z - 0.5) < 1e-9, '它停在飞到的地方');
  assert.equal(w.meshes[1].visible, true);
  assert.ok(Math.abs(w.pts[1].z - (3 - w.blown.left[1])) < 1e-9, '每帧挪多少路程就扣多少');
  assert.ok(w.t < w.sec - 0.35, '飞的路上不到碎的时候');
  assert.ok(!w.crumbled);
  while (w.blown.left[1] > 0) walls.fly(w, 0.016);
  assert.ok(Math.abs(w.pts[1].z - 3) < 1e-9, '飞满 3 米');
  assert.equal(w.meshes[1].position.z, w.pts[1].z);
  assert.equal(w.crumbled, true);
  assert.equal(w.t, w.sec, '全飞完了，下一次 update 就收走');
  assert.deepEqual(walls.flying(), []);
});

test('落石：土龙围的一圈和已经碎了的不掀', () => {
  assert.deepEqual(fakeWalls({ el: 'earth' }).walls.blowable(), [], '土龙的圈没有 form');
  const { walls, w } = fakeWalls();
  w.crumbled = true;
  assert.deepEqual(walls.blowable(), []);
});
