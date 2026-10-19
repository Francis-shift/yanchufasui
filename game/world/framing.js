// @ts-check
/**
 * 镜头自动取景：方向定死，求镜头离多远、整体抬高或放低多少，让要看的几个点都落在
 * 没被界面挡住的那一条画面里，并且离得尽量近。
 * 竖屏、键盘弹起后画面变窄变扁时用（手机上界面占掉上下一大截，固定机位会把敌人的来路挤出画面）；
 * 横屏仍用调好的固定机位。
 */
import * as THREE from 'three';

const _p = new THREE.Vector3();

/**
 * @param {THREE.PerspectiveCamera} camera 已设好 fov 与 aspect
 * @param {{ dir: THREE.Vector3, look: THREE.Vector3, points: THREE.Vector3[], top: number, bottom: number, margin?: number }} o
 *   dir：从看的点指向镜头的方向；look：看的点（会被上下挪）；top / bottom：画面上、下被界面挡住的比例（0～1）；
 *   margin：四边再留的比例
 * @returns {{ pos: THREE.Vector3, look: THREE.Vector3, dist: number }}
 */
export function fitFrame(camera, o) {
  const m = o.margin ?? 0.03;
  const dir = o.dir.clone().normalize();
  // 投影后的坐标：x、y 都是 -1～1，y = 1 是画面顶端
  const xMax = 1 - 2 * m, yMin = -1 + 2 * (o.bottom + m), yMax = 1 - 2 * (o.top + m);
  const cam = camera.clone();
  const look = new THREE.Vector3();

  /** @param {number} dist */
  const fits = (dist) => {
    cam.position.copy(look).addScaledVector(dir, dist);
    cam.lookAt(look);
    cam.updateMatrixWorld();
    for (const pt of o.points) {
      _p.copy(pt).project(cam);
      if (_p.z <= -1 || _p.z >= 1 || Math.abs(_p.x) > xMax || _p.y < yMin || _p.y > yMax) return false;
    }
    return true;
  };

  let best = { dist: Infinity, look: o.look.clone() };
  // 整套机位上下平移（方向不变），把画面内容挪进没被挡住的那一条；每个高度上二分找最近的距离
  for (let shift = -8; shift <= 8; shift += 0.5) {
    look.copy(o.look).setY(o.look.y + shift);
    let lo = 3, hi = 160;
    if (!fits(hi)) continue;
    for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    if (hi < best.dist) best = { dist: hi, look: look.clone() };
  }
  if (!Number.isFinite(best.dist)) best.dist = 40;   // 怎么都框不下（界面占满了）：给个远一点的默认
  return { pos: best.look.clone().addScaledVector(dir, best.dist), look: best.look, dist: best.dist };
}
