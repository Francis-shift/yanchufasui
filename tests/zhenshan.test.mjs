// 镇山石（设计文档第 2 节"场景物件可点名"：吊着镇山石的绳子（烧断 → 砸在石阶口））
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as THREE from 'three';

import { cuts, damageTo, dropDamage, saysCut, stoneDrop } from '../game/rules/arbiter.js';
import { sanitizeIntent } from '../game/rules/intent.js';
import { parseKeywords } from '../game/rules/keywords.js';
import { DROP, ELEMENTS, ENEMIES } from '../game/rules/numbers.js';
import { FlowField } from '../game/world/flowfield.js';
import { CASTER_POS, CORE_POS, OBJECTS, OBSTACLES, PILLARS, PLAZA_R, PROP_SPOTS, SOLIDS, setDropped, setFallen } from '../game/world/layout.js';
import { Zhenshan } from '../game/world/zhenshan.js';

const H = PROP_SPOTS.stone.y, LAND = DROP.hold + Math.sqrt((2 * H) / DROP.g);
const parsed = (text) => sanitizeIntent(parseKeywords(text), text).steps[0];
const SPOT = { x: OBJECTS.rope.x, z: OBJECTS.rope.z, r: DROP.body };

function fake() {
  const box = new THREE.Object3D(), chains = new THREE.Object3D();
  box.position.set(0, 4.9, -8.6);
  chains.position.set(0, 0, 0);
  return { box, chains, z: new Zhenshan(box, chains) };
}
/** @param {Zhenshan} z @param {number} sec */
function run(z, sec) { for (let t = 0; t < sec; t += 1 / 60) z.update(1 / 60); }

test('断得了：要点名铁链，火不用多说，别的元素要说断、落、掉、砸', () => {
  assert.ok(cuts({ el: 'fire', target: 'rope' }, '火球打铁链'));
  assert.ok(cuts({ el: 'thunder', target: 'rope' }, '用雷劈断铁链'));
  assert.ok(cuts({ el: 'earth', target: 'rope' }, '让镇山石掉下来'));
  assert.ok(!cuts({ el: 'ice', target: 'rope' }, '冰弹打铁链'), '只是打它，不断');
  assert.ok(!cuts({ el: 'fire', target: 'front' }, '烧断最前面那只的手'), '没点名铁链');
  for (const w of ['烧断', '落下来', '掉下来', '砸下来', '放下来']) assert.ok(saysCut(w), w);
  assert.ok(!saysCut('铁链'));
});

test('打字就能断：绳子、铁链、镇山石都认，左右不抢目标', () => {
  for (const [t, el] of [['烧断铁链', 'fire'], ['烧断绳子', 'fire'], ['烧断吊着镇山石的绳子', 'fire'], ['烧断左边的铁链', 'fire'], ['用雷劈断铁链', 'thunder'], ['让镇山石掉下来', 'earth']]) {
    const s = parsed(t);
    assert.equal(s?.target, 'rope', t);
    assert.equal(s.el, el, t);
    assert.ok(cuts(s, t), t);
  }
  assert.equal(parsed('火球打最前面那只').target, 'front', '没说铁链不算');
});

test('掉的过程：先顿一下，越掉越快，到地上不再动', () => {
  assert.equal(stoneDrop(0, H), 0);
  assert.equal(stoneDrop(DROP.hold, H), 0, '断的那一下先顿住');
  assert.ok(DROP.hold >= 0.1, '顿得出来');
  const at = (t) => stoneDrop(DROP.hold + t, H);
  assert.ok(at(0.2) > 0);
  assert.ok(at(0.6) - at(0.4) > at(0.4) - at(0.2), '越掉越快');
  assert.ok(Math.abs(stoneDrop(LAND, H) - H) < 1e-9, '正好落到地上');
  assert.equal(stoneDrop(LAND + 3, H), H);
  assert.ok(LAND >= 0.5 && LAND <= 1.2, '看得见它掉，也不用等');
  assert.ok(H > 3.9 && H < 4.1, '吊得比巨像高，石头底离地约 4 米');
});

test('砸中的：正下方重、外圈轻、再远没事；小怪砸得死，巨像不死；盾挡不住，往外弹', () => {
  assert.equal(dropDamage(0), DROP.dmg);
  assert.equal(dropDamage(DROP.r), DROP.dmg);
  assert.equal(dropDamage(DROP.r + 0.01), DROP.ringDmg);
  assert.equal(dropDamage(DROP.ringR), DROP.ringDmg);
  assert.equal(dropDamage(DROP.ringR + 0.01), 0);
  assert.ok(DROP.dmg >= ENEMIES.shield.hp && DROP.dmg < ENEMIES.colossus.hp);
  assert.ok(DROP.ringDmg < ENEMIES.shield.hp, '外圈留口气');
  const r = damageTo({ type: 'shield', frozen: false }, { el: 'earth', dmg: DROP.dmg, crush: DROP.name, fromAbove: true });
  assert.equal(r.reaction, DROP.name);
  assert.equal(r.dmg, DROP.dmg);
  assert.equal(r.push, ELEMENTS.wind.push);
});

test('掉的时候还不挡路，落地才挡；只落一次，onLand 只调一次；开新的一局吊回去', () => {
  const { box, chains, z } = fake(), n0 = OBSTACLES.length, y0 = box.position.y;
  let land = 0;
  assert.ok(z.cut(() => { land++; }));
  assert.equal(z.cut(() => assert.fail('断过的不再落一次')), false);
  run(z, LAND - 0.1);
  assert.equal(z.down, false);
  assert.equal(land, 0);
  assert.equal(OBSTACLES.length, n0, '半空里不挡路');
  assert.ok(box.position.y < y0 - 1, '在往下掉');
  assert.ok(chains.position.y < -1, '铁链跟着掉');
  assert.ok(chains.visible);
  run(z, 0.3);
  assert.ok(z.down);
  assert.equal(land, 1);
  assert.equal(OBSTACLES.length, n0 + 1);
  assert.ok(Math.abs(box.position.y - (y0 - H)) < 1e-9, '落到地上');
  assert.ok(Math.abs(box.rotation.z) > 0.1, '落下来歪着');
  assert.equal(chains.visible, false);
  assert.equal(SOLIDS.filter((b) => b.max[1] <= 2 && b.min[1] === 0 && b.min[0] === -0.9).length, 1, '飞的东西改认地上那一块');
  run(z, 1);
  assert.equal(land, 1);
  assert.equal(z.reset(), true);
  assert.equal(box.position.y, y0);
  assert.equal(box.rotation.z, 0);
  assert.equal(chains.position.y, 0);
  assert.ok(chains.visible);
  assert.equal(OBSTACLES.length, n0);
  assert.equal(SOLIDS.filter((b) => b.min[0] === -0.9 && b.min[1] === H).length, 1, '飞的东西也还原');
  assert.equal(z.reset(), false, '没落过不用重算流场');
});

test('掉到半路开新的一局：不砸人，吊回去；模型晚到接得上', () => {
  const { box, z } = fake(), n0 = OBSTACLES.length;
  z.cut(() => assert.fail('没落地'));
  run(z, 0.4);
  const late = new THREE.Object3D();
  late.position.y = H;
  z.use(late);
  assert.ok(late.position.y < H, '接上就跟着掉');
  assert.equal(z.reset(), false);
  assert.equal(late.position.y, H);
  assert.equal(box.position.y, 4.9);
  run(z, 2);
  assert.equal(OBSTACLES.length, n0);
  assert.ok(z.cut(() => {}), '新一局还能再断');
  z.reset();
});

test('落地后堵住门洞正中，两边还走得过，路程不变；和倒下的华表互不覆盖', () => {
  const routes = () => {
    const f = new FlowField({ radius: PLAZA_R - 0.4, goal: { x: CORE_POS.x, z: CORE_POS.z, r: 2.4 } });
    f.setObstacles([...OBSTACLES, { x: CASTER_POS.x, z: CASTER_POS.z, r: 0.5 }]);
    return { mid: f.distAt(0, -9.7), left: f.distAt(-1.5, -9.7), right: f.distAt(1.5, -9.7), bridge: f.distAt(-8.3, -4.6) };
  };
  const before = routes();
  setDropped(SPOT);
  const after = routes();
  assert.ok(Number.isFinite(before.mid));
  assert.equal(after.mid, Infinity, '正中站不了');
  assert.ok(Number.isFinite(after.left) && Number.isFinite(after.right), '两边没堵死');
  assert.equal(after.left, before.left);
  assert.equal(after.right, before.right);
  assert.equal(after.bridge, before.bridge);
  const n = OBSTACLES.length;
  setFallen([PILLARS[0]], [0]);
  assert.ok(OBSTACLES.some((o) => o.x === SPOT.x && o.z === SPOT.z && o.r === SPOT.r), '倒华表不把石头冲掉');
  assert.ok(OBSTACLES.length > n);
  setDropped(null);
  assert.ok(!OBSTACLES.some((o) => o.r === SPOT.r), '吊回去只拿掉石头');
  assert.ok(OBSTACLES.some((o) => o.r === 0.55), '躺着的华表还在');
  setFallen([], []);
  const posts = OBSTACLES.filter((o) => Math.abs(o.z - OBJECTS.rope.z) < 1);
  for (const p of posts) assert.ok(Math.hypot(p.x - SPOT.x, p.z - SPOT.z) - p.r - SPOT.r >= 1, '门洞两边留得出路');
});

