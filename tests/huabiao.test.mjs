// 华表推倒（设计文档第 2 节"场景物件可点名"：华表（推倒 → 挡路）；第 3 节：敌人绕开倒下的华表）
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as THREE from 'three';

import { damageTo, pickPillars, saysDown, topples, toppleAngle, underLog } from '../game/rules/arbiter.js';
import { sanitizeIntent } from '../game/rules/intent.js';
import { parseKeywords } from '../game/rules/keywords.js';
import { ELEMENTS, ENEMIES, TOPPLE } from '../game/rules/numbers.js';
import { keepInArena } from '../game/rules/trial.js';
import { FlowField } from '../game/world/flowfield.js';
import { Huabiao } from '../game/world/huabiao.js';
import { CASTER_POS, CORE_POS, fallenCircles, OBJECTS, OBSTACLES, PILLARS, PLAZA_R, setFallen } from '../game/world/layout.js';

const LAND = TOPPLE.lean + TOPPLE.fall, END = LAND + TOPPLE.settle;
const views = (l = true, r = true) => [{ x: -4.2, z: -3, up: l }, { x: 4.2, z: -3, up: r }];
const enemy = (x, z, distToCore) => ({ id: `e${x}`, x, z, hp: 40, distToCore });
const parsed = (text) => sanitizeIntent(parseKeywords(text), text).steps[0];

test('推得倒：点名华表，风不用多说，别的元素要说倒；没点名华表的风不算', () => {
  assert.ok(topples({ el: 'wind', target: 'pillar' }, '风吹华表'));
  assert.ok(topples({ el: 'thunder', target: 'pillar' }, '用雷把华表劈倒'));
  assert.ok(topples({ el: 'earth', target: 'pillar' }, '石头撞翻华表'));
  assert.ok(!topples({ el: 'fire', target: 'pillar' }, '火球打华表'), '只是打它，不倒');
  assert.ok(!topples({ el: 'wind', target: 'front' }, '狂风推倒最前面那只'), '没点名华表');
  assert.ok(saysDown('推倒') && saysDown('掀翻') && !saysDown('华表'));
});

test('打字就能推：关键词解析认得出华表和没说元素的说法，左右不抢目标', () => {
  for (const t of ['推倒华表', '把华表推倒', '推倒左边的华表', '放倒右边的华表', '撞倒华表', '掀翻华表', '把两根华表都推倒']) {
    const s = parsed(t);
    assert.equal(s?.target, 'pillar', t);
    assert.equal(s.el, 'wind', t);
    assert.ok(topples(s, t), t);
  }
  assert.equal(parsed('用石头砸倒华表').el, 'earth', '先说了石头就是土');
});

test('哪一根：左右听原话；两根、都、左和右是全部；倒了的不算', () => {
  assert.deepEqual(pickPillars('推倒左边的华表', views(), []), [0]);
  assert.deepEqual(pickPillars('推倒右边的华表', views(), []), [1]);
  assert.deepEqual(pickPillars('把两根华表都推倒', views(), []), [0, 1]);
  assert.deepEqual(pickPillars('推倒左边和右边的华表', views(), []), [0, 1]);
  assert.deepEqual(pickPillars('把两根华表都推倒', views(false, true), []), [1], '倒了的不再算');
  assert.deepEqual(pickPillars('推倒左边的华表', views(false, true), []), [], '点名的那根已经倒了，别改去推另一根');
  assert.deepEqual(pickPillars('推倒华表', views(false, false), []), []);
});

test('哪一根：没说左右挑离最前面那只最近的，只剩一根就是它，没敌人先左边', () => {
  const front = [enemy(3, -5, 12), enemy(-3, -6, 14)];
  assert.deepEqual(pickPillars('推倒华表', views(), front), [1], '离阵眼最近的那只在右边');
  assert.deepEqual(pickPillars('推倒华表', views(), [...front].reverse()), [1], '和排列顺序无关');
  assert.deepEqual(pickPillars('推倒华表', views(), [enemy(-3, -6, 9), enemy(3, -5, 12)]), [0]);
  assert.deepEqual(pickPillars('推倒华表', views(true, false), front), [0]);
  assert.deepEqual(pickPillars('推倒华表', views(), []), [0]);
});

test('倒的过程：先慢、越倒越快、到底弹一下，最后躺在 rest', () => {
  assert.equal(toppleAngle(0), 0);
  assert.ok(toppleAngle(TOPPLE.lean) < 0.1, '先只歪一点');
  assert.ok(toppleAngle(TOPPLE.lean / 2) > 0.02, '歪是看得出来的');
  assert.ok(LAND >= 0.75 && LAND <= 1.5, '倒下来这一段要看得清，也不能拖');
  const at = (u) => toppleAngle(TOPPLE.lean + TOPPLE.fall * u);
  assert.ok(at(0.5) - at(0.25) + 0.2 < at(1) - at(0.75), '越倒越快');
  assert.ok(Math.abs(at(1) - TOPPLE.rest) < 1e-9, '到地上就是 rest');
  assert.ok(toppleAngle(LAND + TOPPLE.settle / 2) < TOPPLE.rest, '弹起来一点');
  assert.ok(Math.abs(toppleAngle(END) - TOPPLE.rest) < 1e-9, '落回去');
  assert.ok(toppleAngle(END + 5) <= TOPPLE.rest + 1e-9);
});

test('砸中的：标华表、照伤害算，盾傀儡挡不住，往外弹', () => {
  const r = damageTo({ type: 'shield', frozen: false }, { el: 'earth', dmg: TOPPLE.dmg, crush: TOPPLE.name, fromAbove: true });
  assert.equal(r.reaction, TOPPLE.name);
  assert.equal(r.dmg, TOPPLE.dmg, '从上面砸下来，不吃正面减伤');
  assert.equal(r.push, ELEMENTS.wind.push);
  assert.ok(TOPPLE.dmg >= ENEMIES.shield.hp, '小傀儡、盾傀儡一下砸死，巨像不死');
  assert.ok(TOPPLE.dmg < ENEMIES.colossus.hp);
});

test('压没压到：离柱身近才算，boss 身子大够得远，柱头外面量到柱头', () => {
  const a = { x: 0, z: 0 }, b = { x: 4, z: 0 };
  assert.deepEqual(underLog({ x: 2, z: 0.7 }, false, a, b), { x: 2, z: 0 });
  assert.equal(underLog({ x: 2, z: 1.2 }, false, a, b), null);
  assert.deepEqual(underLog({ x: 2, z: 1.2 }, true, a, b), { x: 2, z: 0 });
  assert.equal(underLog({ x: 2, z: 2 }, true, a, b), null);
  assert.deepEqual(underLog({ x: 4.5, z: 0 }, false, a, b), { x: 4, z: 0 });
  assert.equal(underLog({ x: 5.5, z: 0 }, false, a, b), null);
  assert.deepEqual(underLog({ x: -0.5, z: 0 }, false, a, b), { x: 0, z: 0 });
});

test('倒的方向：都朝路中间，一根朝阵眼偏、一根朝牌坊偏，点名华表打的就是这两根', () => {
  const [L, R] = PILLARS;
  assert.deepEqual([L.x, L.z], [OBJECTS.pillar.x, OBJECTS.pillar.z]);
  assert.ok(L.dir.x > 0 && R.dir.x < 0, '都朝路中间');
  assert.ok(L.dir.z > 0 && R.dir.z < 0, '一前一后');
  for (const p of PILLARS) assert.ok(Math.abs(Math.hypot(p.dir.x, p.dir.z) - 1) < 1e-9);
});

test('两根都倒了也不叠在一起，也不压到石兽、牌坊柱子、香炉', () => {
  const [a, b] = PILLARS.map(fallenCircles);
  for (const p of a) for (const q of b) assert.ok(Math.hypot(p.x - q.x, p.z - q.z) >= 1.5, '两根之间留得开');
  const fixed = OBSTACLES.filter((o) => o.r > 0.6);   // 柱脚和石灯以外的：香炉、牌坊柱子、石兽
  for (const p of [...a, ...b]) for (const o of fixed) assert.ok(Math.hypot(p.x - o.x, p.z - o.z) > p.r + o.r, `${p.x},${p.z}`);
});

test('倒下的一串圆连成一条，人走不过去，只能绕；从柱脚边上到柱头都算', () => {
  const c = fallenCircles(PILLARS[0]);
  for (let i = 1; i < c.length; i++) assert.ok(Math.hypot(c[i].x - c[i - 1].x, c[i].z - c[i - 1].z) < 2 * c[i].r);
  const along = (q) => (q.x - PILLARS[0].x) * PILLARS[0].dir.x + (q.z - PILLARS[0].z) * PILLARS[0].dir.z;
  assert.ok(along(c[0]) - c[0].r <= TOPPLE.hinge, '盖到柱脚那头');
  assert.ok(Math.abs(along(c[c.length - 1]) + c[0].r - (TOPPLE.hinge + TOPPLE.len)) < 0.3, '盖到柱头那头');
  const p = { x: -2, z: -6 }, list = [...OBSTACLES, ...c];
  for (let i = 0; i < 300; i++) { p.z += 0.05; keepInArena(p, list, 10, 0.35); }
  assert.ok(p.z < -2.5, `一直往前走穿过去了：${p.z}`);
});

/** 从门洞偏左、偏右和索桥口到阵眼的路多长（流场参数与 actors/enemies.js 相同） */
function routes(down = []) {
  setFallen(down.map((i) => PILLARS[i]), down);
  const f = new FlowField({ radius: PLAZA_R - 0.4, goal: { x: CORE_POS.x, z: CORE_POS.z, r: 2.4 } });
  f.setObstacles([...OBSTACLES, { x: CASTER_POS.x, z: CASTER_POS.z, r: 0.5 }]);
  setFallen([], []);
  return { left: f.distAt(-1.5, -9.7), right: f.distAt(0.6, -9.7), bridge: f.distAt(-8.3, -4.6) };
}

test('倒下来才挡路：一根挡住这一边要绕到柱头，两根连成一道要绕开整条路，都走得到阵眼', () => {
  const none = routes(), L = routes([0]), R = routes([1]), both = routes([0, 1]);
  for (const r of [none, L, R, both]) assert.ok(Object.values(r).every(Number.isFinite), '都走得到');
  assert.ok(L.left >= none.left + 0.5, `左边倒了，走左边的绕到柱头：${none.left} → ${L.left}`);
  assert.ok(R.right >= none.right + 0.5, `右边倒了，走右边的绕到柱头：${none.right} → ${R.right}`);
  assert.ok(both.left >= none.left + 3 && both.right >= none.right + 3, `两根都倒：${none.left} → ${both.left}，${none.right} → ${both.right}`);
});

/** 不开画面的两根华表：一根方块一根模型 */
function fakeHuabiao() {
  const boxes = PILLARS.map((p) => { const o = new THREE.Object3D(); o.position.set(p.x, 0, p.z); return o; });
  return { hb: new Huabiao(boxes), boxes };
}
const run = (hb, sec, dt = 0.02) => { for (let t = 0; t < sec; t += dt) hb.update(dt); };

test('推一下：倒地前不挡路，砸到地上只调一次 onLand，这时才挡路', () => {
  const { hb } = fakeHuabiao(), n0 = OBSTACLES.length;
  let landed = 0;
  assert.equal(hb.topple(0, () => { landed++; assert.equal(OBSTACLES.length, n0 + 5, '先挡路再结算'); }), true);
  run(hb, LAND - 0.1);
  assert.equal(landed, 0);
  assert.equal(OBSTACLES.length, n0, '倒的路上还不挡');
  assert.deepEqual(hb.views().map((v) => v.up), [false, true], '开始倒就不算立着');
  run(hb, 0.2);
  assert.equal(landed, 1);
  run(hb, 3);
  assert.equal(landed, 1);
  hb.reset();
});

test('boss 碰到躺着的才算：撞碎后不挡路、看不见、柱脚也没了；立着的、别的那根不受影响；开新的一局都回来', () => {
  const { hb, boxes } = fakeHuabiao(), n0 = OBSTACLES.length;
  const on = fallenCircles(PILLARS[0])[2], base = { x: PILLARS[0].x, z: PILLARS[0].z };
  assert.equal(hb.touching(on, 1), -1, '立着的时候那里是空地');
  hb.topple(0, () => {});
  run(hb, 0.3);
  assert.equal(hb.touching(on, 1), -1, '还没倒下来');
  run(hb, 2);
  hb.topple(1, () => {});
  run(hb, 2);
  assert.equal(hb.touching(on, 1), 0);
  assert.equal(hb.touching({ x: on.x, z: on.z + 1.6 }, 1), 0, '身子挨上就算');
  assert.equal(hb.touching({ x: on.x, z: on.z + 2 }, 1), -1, '隔开了不算');
  assert.ok(!OBSTACLES.some((o) => o.x === base.x && o.z === base.z), '倒了柱脚那个圆就没了');
  hb.shatter(0);
  assert.equal(boxes[0].visible, false);
  assert.equal(boxes[1].visible, true);
  assert.equal(hb.touching(on, 1), -1);
  assert.equal(OBSTACLES.length, n0 - 2 + 6, '只剩右边那一串');
  assert.equal(hb.topple(0, () => {}), false, '碎了的推不了');
  assert.deepEqual(hb.views().map((v) => v.up), [false, false]);
  hb.reset();
  assert.equal(boxes[0].visible, true);
  assert.equal(OBSTACLES.length, n0);
  assert.ok(OBSTACLES.some((o) => o.x === base.x && o.z === base.z));
  hb.topple(0, () => {});
  run(hb, 2);
  assert.equal(hb.touching(on, 1), 0, '新一局再推倒还是挡路');
  hb.reset();
});

test('已经倒了的再推没用；两根都倒了两串圆都在；开新的一局都立回去、路通了', () => {
  const { hb, boxes } = fakeHuabiao(), n0 = OBSTACLES.length;
  hb.topple(0, () => {});
  assert.equal(hb.topple(0, () => assert.fail('倒过的不再落一次')), false);
  run(hb, 2);
  hb.topple(1, () => {});
  run(hb, 2);
  assert.equal(OBSTACLES.length, n0 + 10);
  assert.equal(hb.reset(), true, '有倒着的，流场要重算');
  assert.equal(OBSTACLES.length, n0);
  assert.equal(hb.reset(), false, '都立着就不用重算');
  assert.ok(boxes[0].position.distanceTo(new THREE.Vector3(PILLARS[0].x, 0, PILLARS[0].z)) < 1e-9, '站回原地');
  assert.ok(Math.abs(boxes[0].quaternion.w - 1) < 1e-9, '站直了');
});

test('开新的一局时正倒到一半的不会再砸一下', () => {
  const { hb } = fakeHuabiao();
  hb.topple(0, () => assert.fail('这一局已经没了'));
  run(hb, 0.3);
  hb.reset();
  run(hb, 2);
  assert.deepEqual(hb.views().map((v) => v.up), [true, true]);
});

test('倒的时候绕柱脚外侧转：柱顶朝倒的方向落到地上，柱脚抬起来一点，不入地', () => {
  const { hb, boxes } = fakeHuabiao();
  hb.topple(0, () => {});
  run(hb, 2);
  const p = PILLARS[0], o = boxes[0], top = new THREE.Vector3(0, TOPPLE.len, 0).applyQuaternion(o.quaternion).add(o.position);
  const along = (top.x - p.x) * p.dir.x + (top.z - p.z) * p.dir.z;
  assert.ok(Math.abs(along - (TOPPLE.hinge + TOPPLE.len)) < 0.1, `柱顶落在 ${along} 米外`);
  assert.ok(Math.abs((top.x - p.x) * -p.dir.z + (top.z - p.z) * p.dir.x) < 1e-6, '不往两边歪');
  assert.ok(top.y > 0.5 && top.y < 1, `柱顶搁在云板上，离地 ${top.y}`);
  assert.ok(o.position.y > 0.4 && o.position.y < 0.6, '底座翻起来，中心离地约半个底座');
  const { a, b } = hb.ends(0);
  assert.ok(Math.hypot(b.x - a.x, b.z - a.z) === TOPPLE.len || Math.abs(Math.hypot(b.x - a.x, b.z - a.z) - TOPPLE.len) < 1e-9);
  hb.reset();
});

test('模型倒到一半才到也接得上', () => {
  const { hb, boxes } = fakeHuabiao();
  hb.topple(0, () => {});
  run(hb, 0.6);
  const m = new THREE.Object3D();
  m.position.set(PILLARS[0].x, 0, PILLARS[0].z);
  hb.use(0, m);
  assert.ok(m.position.distanceTo(boxes[0].position) < 1e-9);
  assert.ok(m.quaternion.angleTo(boxes[0].quaternion) < 1e-6);
  hb.reset();
});
