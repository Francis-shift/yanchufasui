import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FlowField } from '../game/world/flowfield.js';

const goal = { x: 0, z: 8.6, r: 2.4 };

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
