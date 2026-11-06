// 香炉、索桥（设计文档第 2 节"场景物件可点名"：香炉（踢翻 → 地面起火）、索桥（冻住 → 敌人滑落））
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as THREE from 'three';

import { freezes, pickOfTwo, saysTip, tips } from '../game/rules/arbiter.js';
import { sanitizeIntent } from '../game/rules/intent.js';
import { parseKeywords } from '../game/rules/keywords.js';
import { BRIDGE_ICE, ENEMIES, RUN, SPILL, TOPPLE } from '../game/rules/numbers.js';
import { backOnPath, CENSERS, groundHeightAt, OBJECTS, OBSTACLES, PATHS, slipDir, spillSpots } from '../game/world/layout.js';
import { Tipper } from '../game/world/tipper.js';

const parsed = (text) => sanitizeIntent(parseKeywords(text), text).steps[0];
const LAND = TOPPLE.lean + TOPPLE.fall;

function fake() {
  const boxes = CENSERS.map((p) => { const o = new THREE.Object3D(); o.position.set(p.x, 0, p.z); return o; });
  return { boxes, t: new Tipper(CENSERS, boxes, SPILL.hinge) };
}
/** @param {Tipper} t @param {number} sec */
function run(t, sec) { for (let s = 0; s < sec; s += 1 / 60) t.update(1 / 60); }

test('翻得了：要点名香炉，风不用多说，别的元素要说踢、倒、翻、掀、撞、砸', () => {
  assert.ok(tips({ el: 'wind', target: 'censer' }, '风吹香炉'));
  assert.ok(tips({ el: 'fire', target: 'censer' }, '用火踢翻香炉'));
  assert.ok(tips({ el: 'earth', target: 'censer' }, '石头砸香炉'));
  assert.ok(!tips({ el: 'fire', target: 'censer' }, '火球打香炉'), '只是打它，不翻');
  assert.ok(!tips({ el: 'wind', target: 'front' }, '踢翻最前面那只'), '没点名香炉');
  for (const w of ['踢它一脚', '打倒', '掀了', '撞过去', '砸']) assert.ok(saysTip(w), w);
  assert.ok(!saysTip('香炉'));
});

test('打字就能翻：踢翻、打翻都认，左右听原话', () => {
  for (const t of ['踢翻香炉', '踢翻左边的香炉', '打翻香炉', '踢倒香炉', '撞翻右边的炉子']) {
    const s = parsed(t);
    assert.equal(s?.target, 'censer', t);
    assert.equal(s.el, 'wind', t);
    assert.ok(tips(s, t), t);
  }
  const ups = CENSERS.map((p) => ({ x: p.x, z: p.z, up: true }));
  assert.deepEqual(pickOfTwo('踢翻左边的香炉', ups, []), [0]);
  assert.deepEqual(pickOfTwo('踢翻右边的香炉', ups, []), [1]);
  assert.deepEqual(pickOfTwo('踢翻两只香炉', ups, []), [0, 1]);
  assert.deepEqual(pickOfTwo('踢翻香炉', ups.map((u) => ({ ...u, up: false })), []), [], '都翻了就没得翻');
});

test('炭火洒到路上：一溜从香炉脚边排到路中间，都落在广场上，不碰对面那只', () => {
  for (const p of CENSERS) {
    const spots = spillSpots(p, SPILL.at);
    assert.equal(spots.length, SPILL.at.length);
    for (const q of spots) {
      assert.equal(groundHeightAt(q.x, q.z), 0, '落在地上');
      assert.equal(q.z, p.z);
    }
    assert.ok(Math.abs(spots[0].x) > Math.abs(spots.at(-1).x), '往里排');
    assert.ok(Math.abs(spots.at(-1).x) < 2, '够到路中间');
    assert.ok(Math.hypot(spots[0].x - p.x, spots[0].z - p.z) >= 1, '不贴着炉身');
  }
  for (let i = 1; i < SPILL.at.length; i++) assert.ok(SPILL.at[i] - SPILL.at[i - 1] <= SPILL.r * 2, '片与片连得上，走过去躲不开');
  assert.ok((SPILL.dmg / RUN.runes.liao.tick) * SPILL.sec >= ENEMIES.grunt.hp, '站着烧满能烧掉一只小傀儡');
});

test('香炉的一生：先歪再倒，落地调一次 onLand，翻过的不再翻，脚还在原地挡路', () => {
  const { boxes, t } = fake(), n0 = OBSTACLES.length;
  let land = 0;
  assert.ok(t.topple(0, () => { land++; }));
  assert.equal(t.topple(0, () => assert.fail('翻过的不再翻')), false);
  run(t, LAND - 0.1);
  assert.equal(land, 0);
  assert.equal(t.list[0].down, false);
  assert.ok(boxes[0].quaternion.angleTo(new THREE.Quaternion()) > 0.5, '在倒');
  assert.equal(boxes[1].quaternion.angleTo(new THREE.Quaternion()), 0, '另一只不动');
  run(t, 0.3);
  assert.equal(land, 1);
  assert.ok(t.list[0].down);
  run(t, 1);
  assert.equal(land, 1);
  assert.deepEqual(t.views().map((v) => v.up), [false, true]);
  assert.equal(OBSTACLES.length, n0, '香炉翻了不改路');
});

test('往路中间倒：炉子躺下时朝里，不朝栏杆外', () => {
  const { boxes, t } = fake();
  const top = [new THREE.Object3D(), new THREE.Object3D()];
  top.forEach((o, i) => { o.position.set(CENSERS[i].x, 1, CENSERS[i].z); t.use(i, o); });
  for (const i of [0, 1]) t.topple(i, () => {});
  run(t, 2);
  for (const i of [0, 1]) assert.ok(Math.abs(top[i].position.x) < Math.abs(CENSERS[i].x) - 0.5, '顶往里去');
  assert.ok(boxes[0].position.y < 0.5);
  assert.ok(SPILL.hinge > 0.2 && SPILL.hinge < 0.7, '转轴在炉脚边上（炉脚半径 0.7）');
});

test('开新的一局：立回去，还能再翻；半路开局不洒火；模型晚到接得上', () => {
  const { boxes, t } = fake(), p0 = boxes[0].position.clone();
  t.topple(0, () => assert.fail('半路开局不落地'));
  run(t, 0.4);
  const late = new THREE.Object3D();
  late.position.set(CENSERS[0].x, 0.6, CENSERS[0].z);
  t.use(0, late);
  assert.ok(late.position.y !== 0.6, '接上就跟着倒');
  assert.equal(t.reset(), false, '没落地不算倒过');
  assert.equal(boxes[0].position.distanceTo(p0), 0);
  assert.equal(late.position.y, 0.6);
  assert.equal(boxes[0].quaternion.angleTo(new THREE.Quaternion()), 0);
  run(t, 2);
  let land = 0;
  assert.ok(t.topple(0, () => { land++; }));
  run(t, 2);
  assert.equal(land, 1);
  assert.equal(t.reset(), true);
  assert.ok(t.topple(0, () => {}), '新一局还能再翻');
});

test('冻得住：只有冰，要点名索桥；风、火打桥不算', () => {
  assert.ok(freezes({ el: 'ice', target: 'bridge' }));
  assert.ok(!freezes({ el: 'fire', target: 'bridge' }));
  assert.ok(!freezes({ el: 'ice', target: 'front' }));
  for (const t of ['冻住索桥', '把索桥冻住', '冰封索桥']) {
    const s = parsed(t);
    assert.equal(s?.target, 'bridge', t);
    assert.ok(freezes(s), t);
  }
  assert.ok(!freezes(parsed('火烧索桥')));
});

test('脚下一滑：桥上才滑，往近的那边，方向横着桥走', () => {
  const { x, z } = OBJECTS.bridge;
  const d = slipDir(x, z);
  assert.ok(d, '桥中间');
  assert.ok(Math.abs(Math.hypot(d.x, d.z) - 1) < 1e-9, '单位向量');
  const along = { x: -d.z, z: d.x };
  assert.ok(slipDir(x + along.x * 3, z + along.z * 3), '桥上别处也滑');
  assert.ok(!slipDir(x + along.x * 40, z + along.z * 40), '走出桥不滑');
  assert.ok(!slipDir(x - along.x * 40, z - along.z * 40), '另一头也不滑');
  assert.equal(slipDir(0, 0), null, '广场上不滑');
  assert.equal(slipDir(0, -9.7), null, '石阶口不滑');
  const a = slipDir(x + d.x * 0.5, z + d.z * 0.5), b = slipDir(x - d.x * 0.5, z - d.z * 0.5);
  assert.ok(a.x * b.x + a.z * b.z < -0.99, '两边各往各的边上滑');
  assert.ok(a.x * d.x + a.z * d.z > 0.99, '往离得近的那边');
  assert.equal(slipDir(x + d.x * 3, z + d.z * 3), null, '桥边外面不算在桥上');
  assert.equal(slipDir(x - d.x * 3, z - d.z * 3), null, '另一边也不算');
});

test('悬空那一段哪里滑一下都掉得下去，脚踩山头的那截不滑', () => {
  const [, b, a] = PATHS[1], L = a.distanceTo(b), u = b.clone().sub(a).setY(0).normalize();
  let hang = 0, last = 0;
  for (let t = 0; t <= L; t += 0.1) {
    const x = a.x + u.x * t, z = a.z + u.z * t, d = slipDir(x, z);
    if (!d) continue;
    hang++; last = t;
    let px = x, pz = z, v = BRIDGE_ICE.slide, fell = false;
    for (let s = 0; s < 3 && !fell; s += 1 / 60) {
      px += d.x * v / 60; pz += d.z * v / 60;
      v *= Math.exp(-3.2 / 60);   // 敌人滑行的摩擦，见 actors/enemies.js
      fell = groundHeightAt(px, pz) === null;
    }
    // 广场这头那一小截滑回广场上，跟流场接着走，不算
    if (t > 0.5) assert.ok(fell, `离桥头 ${t.toFixed(1)} 米`);
  }
  assert.ok(hang > 100, '桥上大部分地方都滑');
  assert.ok(last < L - 0.5, '桥尾不滑');
  assert.equal(slipDir(b.x, b.z), null, '桥尾在山头上');
  assert.ok(BRIDGE_ICE.sec >= 4, '冻得够久，过桥的来得及踩上去');
});

test('冲下路站稳了接回原路，不从云海上走过去', () => {
  /** @param {THREE.Vector3[]} pts */
  const allGround = (pts) => {
    for (let i = 1; i < pts.length; i++) {
      const n = Math.ceil(pts[i].distanceTo(pts[i - 1]) / 0.2);
      for (let k = 0; k <= n; k++) {
        const q = pts[i - 1].clone().lerp(pts[i], k / n);
        if (groundHeightAt(q.x, q.z) === null) return false;
      }
    }
    return true;
  };
  const [c, b, a] = PATHS[1], u = c.clone().sub(b).setY(0).normalize();
  const on = b.clone().addScaledVector(u, 1.3).add(new THREE.Vector3(-u.z, 0, u.x).multiplyScalar(1.5)), wind = new THREE.Vector3(1.5, -5, -20);
  assert.notEqual(groundHeightAt(on.x, on.z), null, '邻峰边上站得住');
  assert.notEqual(groundHeightAt(wind.x, wind.z), null, '石阶边上站得住');
  assert.ok(!allGround([on, PATHS[1].at(-1)]), '直线奔阵眼会踩空');
  assert.ok(allGround(backOnPath(PATHS[1], on)), '邻峰边上接回去');
  assert.ok(allGround(backOnPath(PATHS[0], wind)), '石阶边上接回去');
  assert.equal(backOnPath(PATHS[1], on)[1], b, '先奔桥尾');
  assert.equal(backOnPath(PATHS[1], on).length, PATHS[1].length, '后面的路不少一段');
  const bridge = b.clone().lerp(a, 0.5).add(new THREE.Vector3(0.2, 0, 0.2));
  assert.equal(backOnPath(PATHS[1], bridge)[1], a, '桥上往广场那头走，不走回头路');
  assert.ok(allGround(backOnPath(PATHS[1], bridge)));
  assert.ok(allGround(backOnPath(backOnPath(PATHS[1], on), bridge)), '接回去之后再被冲一次也接得上');
});
