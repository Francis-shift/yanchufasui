// @ts-check
/**
 * 试炼的镜头（设计文档第 4 节"10-29 定：试炼的镜头与三档视角"）。这里只算"镜头该在哪、看哪"，平滑、推镜在 main 里。
 * 俯视跟随：方向定死（和守关的镜头同一侧，俯得更多），位置跟着人走，所以摇杆往上永远是往画面里面走；
 * 看的点往 boss 那边偏，人和 boss 离远了就往后拉，把两边都框进来。
 */
import * as THREE from 'three';

export const FOLLOW = {
  /** 俯角（守关约 17°：要把石阶、索桥远景都框进来；试炼只看广场，俯得多些地上的红圈才好认） */
  pitch: THREE.MathUtils.degToRad(35),
  /** 从看的点往镜头的水平方向：和守关镜头同一侧（守关机位 (5.6, 7.4, 16.8) 看 (0, 1, -3.5)） */
  yaw: Math.atan2(5.6, 20.3),
  /** 离看的点多远；人和 boss 框不进来时最多拉到多远 */
  dist: 11, maxDist: 24,
  /** 看的点往画面里面挪几米：人落在画面中间偏下，前面多看一点 */
  lead: 1.2,
  /** 看的点往 boss 那边偏几成 */
  bias: 0.3,
  /** 看的点的高度（胸口） */
  y: 1,
  /** 人（脚到头顶）和 boss（脚到头顶）要落在投影后的这个范围里：左右、上（顶上是 boss 血条，矮屏幕上 main 按血条下沿再压低）、下（底下一排技能按钮） */
  safe: { x: 0.82, top: 0.7, bottom: -0.42 },
};

const _cam = new THREE.PerspectiveCamera();
const _p = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();

/** 从看的点指向镜头的方向（长度 1） @param {number} pitch @param {number} yaw @param {THREE.Vector3} [out] */
export function viewDir(pitch, yaw, out = new THREE.Vector3()) {
  return out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}

/**
 * 俯视跟随该看哪、离多远。先按"人前面一点、往 boss 偏几成"定看的点；这样框不进来，就把人和 boss 一起摆到安全框正中
 * （拉远前先挪，能少拉一点），还不行再往后拉。
 * @param {THREE.PerspectiveCamera} camera 取它的 fov、aspect
 * @param {{ x: number, z: number }} p 玩家
 * @param {{ x: number, z: number, h: number } | null} boss 场上的 boss（h：多高）；没有就只跟人
 * @param {Partial<typeof FOLLOW>} [o] 改几项看效果
 * @returns {{ look: THREE.Vector3, dist: number, dir: THREE.Vector3 }}
 */
export function followPose(camera, p, boss, o = {}) {
  const c = { ...FOLLOW, ...o };
  const dir = viewDir(c.pitch, c.yaw);
  const look = new THREE.Vector3(p.x - Math.sin(c.yaw) * c.lead, c.y, p.z - Math.cos(c.yaw) * c.lead);
  if (boss) { look.x += (boss.x - p.x) * c.bias; look.z += (boss.z - p.z) * c.bias; }
  const pts = [[p.x, 0, p.z], [p.x, 1.9, p.z]];
  if (boss) pts.push([boss.x, 0, boss.z], [boss.x, boss.h, boss.z]);
  _cam.fov = camera.fov; _cam.aspect = camera.aspect; _cam.near = 0.1; _cam.far = 1000;
  _cam.updateProjectionMatrix();
  const aim = (/** @type {THREE.Vector3} */ at, /** @type {number} */ d) => {
    _cam.position.copy(at).addScaledVector(dir, d);
    _cam.lookAt(at);
    _cam.updateMatrixWorld();
  };
  const fits = (/** @type {THREE.Vector3} */ at, /** @type {number} */ d) => {
    aim(at, d);
    for (const [x, y, z] of pts) {
      _p.set(x, y, z).project(_cam);
      if (_p.z >= 1 || Math.abs(_p.x) > c.safe.x || _p.y > c.safe.top || _p.y < c.safe.bottom) return false;
    }
    return true;
  };
  if (fits(look, c.dist)) return { look, dist: c.dist, dir };
  // 摆正中：看 d 米远时几个点投出去的范围偏了多少，按看的点那个深度换成米，在地面高度上挪——画面横向就是横着挪，
  // 画面竖向换成往里、往外挪（往里挪 1 米，画面上升 sin(俯角) 米）。看的点高度不变，镜头就不会低下去。
  // 近处的点挪得多一点，所以只是近似，够不够由 fits 再量；有点在镜头背后时投影是翻的，不挪；
  // 挪的距离不超过人到 boss 那么远（竖屏拉到最远还框不下时，近似会越算越偏）
  const tan = Math.tan(THREE.MathUtils.degToRad(_cam.fov / 2)), mid = (c.safe.top + c.safe.bottom) / 2;
  const span = boss ? Math.hypot(boss.x - p.x, boss.z - p.z) : 0;
  _r.set(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
  _u.set(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
  const centered = (/** @type {number} */ d) => {
    aim(look, d);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y, z] of pts) {
      _p.set(x, y, z).project(_cam);
      if (_p.z >= 1) return look.clone();
      x0 = Math.min(x0, _p.x); x1 = Math.max(x1, _p.x); y0 = Math.min(y0, _p.y); y1 = Math.max(y1, _p.y);
    }
    const shift = _p.copy(_r).multiplyScalar((x0 + x1) / 2 * d * tan * _cam.aspect)
      .addScaledVector(_u, ((y0 + y1) / 2 - mid) * d * tan / Math.sin(c.pitch));
    return look.clone().add(shift.clampLength(0, span));
  };
  if (fits(centered(c.dist), c.dist)) return { look: centered(c.dist), dist: c.dist, dir };
  if (!fits(centered(c.maxDist), c.maxDist)) return { look: centered(c.maxDist), dist: c.maxDist, dir };
  let lo = c.dist, hi = c.maxDist;
  for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (fits(centered(m), m)) hi = m; else lo = m; }
  return { look: centered(hi), dist: hi, dir };
}

/**
 * 大招镜头（设计文档第 4 节"10-29 定"里那一条）：
 * 完美闪避时镜头往人推近一下（kick：推近几成，in 秒推到、之后 out 秒退回）；
 * 召龙时推到人的肩后、朝龙要砸的地方看，龙钻出来以后看的点往龙头那边偏 head 成，停 sec 秒或到龙砸中，再拉回俯视。
 */
export const SHOT = {
  kick: { push: 0.22, in: 0.12, out: 0.8 },
  /**
   * 在人身后几米、往右偏几米（横屏时；电脑上技能按钮在底下正中，偏这么多人才落在按钮排左边，画面窄就按宽高比少偏些，免得出画）、
   * 多高（齐头顶：人的上半身在按钮那一排上面）；看的点多高、最高抬到多高（龙飞得高时不跟着仰上去，不然人沉到画面底下）；
   * 推过去、拉回来各几秒
   */
  back: 3.4, side: 2.0, up: 1.9, lookY: 1.5, head: 0.45, maxLookY: 2.4, sec: 2.6, in: 0.45, out: 0.9,
};

/** 完美闪避推近的量（0～1）：t 是推近开始后过了几秒 @param {number} t */
export function kickAt(t) {
  const { in: a, out: b } = SHOT.kick;
  if (t < 0 || t >= a + b) return 0;
  return t < a ? t / a : (1 - (t - a) / b) ** 2;
}

/**
 * 召龙时肩后镜头的位置和看的点
 * @param {{ x: number, z: number }} p 人
 * @param {{ x: number, z: number }} target 龙要砸的地方
 * @param {THREE.Vector3 | null} head 龙头（还没钻出来给 null）
 * @param {THREE.Vector3} fwd 目标就在脚下时朝哪看（俯视跟随的"往前"）
 * @param {number} [aspect] 画面宽高比
 * @returns {{ pos: THREE.Vector3, look: THREE.Vector3 }}
 */
export function shoulderPose(p, target, head, fwd, aspect = 16 / 9) {
  const f = new THREE.Vector3(target.x - p.x, 0, target.z - p.z);
  if (f.lengthSq() < 1) f.set(fwd.x, 0, fwd.z);
  f.normalize();
  const side = SHOT.side * THREE.MathUtils.clamp(aspect / 1.7, 0.25, 1);
  const pos = new THREE.Vector3(p.x - f.x * SHOT.back - f.z * side, SHOT.up, p.z - f.z * SHOT.back + f.x * side);
  const look = new THREE.Vector3(target.x, SHOT.lookY, target.z);
  if (head) { look.lerp(head, SHOT.head); look.y = Math.min(look.y, SHOT.maxLookY); }
  return { pos, look };
}

/**
 * 一个点投到画面外时，边缘箭头放在哪、朝哪（画面坐标 -1～1，y 朝上）；在画面里就给 null
 * @param {THREE.Vector3} at 世界坐标 @param {THREE.Camera} camera @param {number} [edge] 箭头离边多远（投影坐标）
 * @returns {{ x: number, y: number, angle: number } | null} angle：箭头朝向（弧度，0 朝右、逆时针为正）
 */
export function offscreenArrow(at, camera, edge = 0.88) {
  _p.copy(at).applyMatrix4(camera.matrixWorldInverse);
  const behind = _p.z > 0;   // 在镜头背后：投影会翻过来，按镜头空间里的方向算
  _p.copy(at).project(camera);
  if (!behind && Math.abs(_p.x) <= 1 && Math.abs(_p.y) <= 1) return null;
  let x = _p.x, y = _p.y;
  if (behind) { x = -x; y = -y; }
  if (behind && Math.abs(y) < 0.2) y = -1;   // 正后方：指向画面下边
  const k = edge / Math.max(Math.abs(x), Math.abs(y), 1e-6);
  const aspect = /** @type {{ aspect?: number }} */ (camera).aspect ?? 1;   // 投影坐标横竖不等长：朝向按画面上的像素方向算
  return { x: x * k, y: y * k, angle: Math.atan2(y, x * aspect) };
}
