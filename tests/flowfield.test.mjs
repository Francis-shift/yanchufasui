import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FlowField } from '../game/world/flowfield.js';
import { CASTER_POS, CORE_POS, GATE, OBSTACLES, PLAZA_R } from '../game/world/layout.js';

const goal = { x: 0, z: 8.6, r: 2.4 };

/** 从 (x, z) 跟着流场一步步走，返回走过的点；走进 2.6 米（actors/enemies.js 的 CORE_REACH，撞上阵眼）或走不动为止 */
function walk(f, x, z) {
  const pts = [{ x, z }];
  for (let i = 0; i < 400; i++) {
    if (Math.hypot(x - CORE_POS.x, z - CORE_POS.z) < 2.6) return { pts, reached: true };
    const d = f.dirAt(x, z);
    if (!d) break;
    x += d.x * 0.25; z += d.z * 0.25;
    pts.push({ x, z });
  }
  return { pts, reached: false };
}

test('场景布局：牌坊、石兽、华表、香炉都摆上后，石阶口进来的敌人穿门洞走到阵眼，索桥口进来的也走得到', () => {
  // 与 actors/enemies.js 同样的参数
  const f = new FlowField({ radius: PLAZA_R - 0.4, goal: { x: CORE_POS.x, z: CORE_POS.z, r: 2.4 } });
  f.setObstacles([...OBSTACLES, { x: CASTER_POS.x, z: CASTER_POS.z, r: 0.5 }]);
  const stairs = walk(f, 0.6, -9.7);
  assert.ok(stairs.reached, '石阶口走不到阵眼');
  const atGate = stairs.pts.find((p) => p.z >= GATE.z);
  assert.ok(atGate && Math.abs(atGate.x) < 2.4, `过牌坊时应在门洞里（|x| < 2.4），得到 ${JSON.stringify(atGate)}`);
  assert.ok(stairs.pts.length * 0.25 < 24, `石阶口到阵眼绕得太远：${stairs.pts.length * 0.25} 米`);
  assert.ok(walk(f, -8.3, -4.6).reached, '索桥口走不到阵眼');
});

test('流场：空广场上，北边的敌人朝阵眼（+z）走', () => {
  const f = new FlowField({ radius: 10.6, goal });
  const d = f.dirAt(0, -8);
  assert.ok(d && d.z > 0.9, JSON.stringify(d));
  assert.ok(f.distAt(0, -8) > f.distAt(0, 0), '越靠近阵眼越近');
  assert.equal(f.distAt(30, 0), null, '广场外不归它管');
});

test('流场：正路上立一道墙，敌人往墙的一端绕；墙一撤又走直线', () => {
  const f = new FlowField({ radius: 10.6, goal });
  const straight = f.distAt(0, -3);
  const wall = [-3, -2, -1, 0, 1, 2, 3].map((x) => ({ x, z: 0, r: 0.6 }));
  f.setObstacles(wall);
  const d = f.dirAt(0, -1.5);
  assert.ok(d && Math.abs(d.x) > 0.5, `应该横着绕，得到 ${JSON.stringify(d)}`);
  assert.ok(f.distAt(0, -3) > straight + 2, '绕路更远');
  f.setObstacles([]);
  assert.ok(Math.abs(f.distAt(0, -3) - straight) < 1e-6);
});

test('流场：墙立在敌人身上，也能找到最近的出口；被围死时返回 null', () => {
  const f = new FlowField({ radius: 10.6, goal });
  f.setObstacles([{ x: 0, z: -4, r: 0.5 }]);
  assert.ok(f.dirAt(0, -4), '脚下被堵也要有方向');
  f.setObstacles([{ x: 0, z: -4, r: 3 }]);
  assert.equal(f.dirAt(0, -4), null);
});
