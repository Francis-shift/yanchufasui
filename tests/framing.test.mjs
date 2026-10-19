// 竖屏自动取景：要看的点都要落在没被界面挡住的那一条里，而且在每个高度上再近一点都会有点出界（说明是最近的）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fitFrame } from '../game/world/framing.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const POINTS = [V(0, 2.2, 5.2), V(0, 0, 6.8), V(0, 0, -10.4), V(-9.2, 0, -5.4), V(-14, 0, -8.3), V(7, 0, -3)];
const DIR = V(0.36, 1.0, 1);
const LOOK = V(-2, 0, -2);
const M = 0.03;   // fitFrame 默认留的边

/** 镜头放在 look 沿 DIR 退 dist 处，这些点是否都在没被挡住的那一条里 */
function fitsAt(camera, look, dist, top, bottom) {
  camera.position.copy(look).addScaledVector(DIR.clone().normalize(), dist);
  camera.lookAt(look);
  camera.updateMatrixWorld();
  return POINTS.every((pt) => {
    const p = pt.clone().project(camera);
    return p.z > -1 && p.z < 1 && Math.abs(p.x) <= 1 - 2 * M + 1e-6 && p.y >= -1 + 2 * (bottom + M) - 1e-6 && p.y <= 1 - 2 * (top + M) + 1e-6;
  });
}

// 后两种画面很矮、上下挡得多：竖直方向卡住取景，上下边距才真正起作用
const CASES = [
  ['竖屏', 390 / 756, 0.07, 0.17],
  ['键盘弹起', 390 / 403, 0.11, 0.27],
  ['很矮且上面挡得多', 390 / 300, 0.3, 0.2],
  ['很矮且下面挡得多', 390 / 300, 0.1, 0.45],
];

for (const [name, aspect, top, bottom] of CASES) {
  test(`${name}：所有点都在没被挡住的那一条里，且是最近的`, () => {
    const camera = new THREE.PerspectiveCamera(aspect < 0.8 ? 62 : 50, aspect, 0.1, 1500);
    const f = fitFrame(camera, { dir: DIR, look: LOOK, points: POINTS, top, bottom });
    assert.ok(fitsAt(camera, f.look, f.dist, top, bottom), '取景结果有点落在界外或被挡住的地方');
    // 每个高度（与 fitFrame 搜的同一组）上，再近 3% 都框不下
    for (let s = -8; s <= 8; s += 0.5) {
      const look = LOOK.clone().setY(LOOK.y + s);
      assert.ok(!fitsAt(camera, look, f.dist * 0.97, top, bottom), `抬高 ${s} 时能更近，说明没找最近的`);
    }
  });
}

test('挡住的越多，镜头离得越远', () => {
  const camera = new THREE.PerspectiveCamera(50, 390 / 403, 0.1, 1500);
  const a = fitFrame(camera, { dir: DIR, look: LOOK, points: POINTS, top: 0.05, bottom: 0.05 });
  const b = fitFrame(camera, { dir: DIR, look: LOOK, points: POINTS, top: 0.3, bottom: 0.3 });
  assert.ok(b.dist > a.dist);
});
