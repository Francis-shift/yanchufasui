// 墙挡什么（设计文档第 4 节"10-30 改：墙挡弹幕"）：四种墙都挡敌方弹幕；只有土墙挡路；只有写了「返」的土墙把冰锥弹回去。
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Walls } from '../game/fx/walls.js';

const pts = (x) => [{ x, z: 0 }, { x: x + 1.1, z: 0 }];
const fake = {
  list: [
    { el: 'earth', pts: pts(0), payload: { runes: ['fan'] } },
    { el: 'earth', pts: pts(5), payload: {} },
    { el: 'fire', pts: pts(10), payload: { runes: ['fan'] } },
    { el: 'ice', pts: pts(15) },
    { el: 'wind', pts: pts(20) },
  ],
};

test('四种墙的每一段都挡弹幕', () => {
  const s = Walls.prototype.shields.call(fake);
  assert.equal(s.length, 10);
  for (const x of [0, 5, 10, 15, 20]) assert.ok(s.some((o) => o.x === x && o.r > 0), `x=${x} 那堵墙没挡弹幕`);
});

test('挡路的只有土墙', () => {
  const o = Walls.prototype.obstacles.call(fake);
  assert.deepEqual([...new Set(o.map((p) => p.x))].sort((a, b) => a - b), [0, 1.1, 5, 6.1]);
});

test('只有写了「返」的土墙弹回冰锥，帘子带着「返」也不弹', () => {
  const s = Walls.prototype.shields.call(fake);
  assert.deepEqual(s.filter((o) => o.bounce).map((o) => o.x), [0, 1.1]);
});
