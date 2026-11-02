// @ts-check
/**
 * 试炼的镜头（设计文档第 4 节"10-29 定：试炼的镜头与三档视角"）。这里只算"镜头该在哪、看哪"，平滑、推镜在 main 里。
 * 俯视跟随：方向默认和守关的镜头同一侧（俯得更多），玩家可以自己转（ORBIT）；位置跟着人走，摇杆往上永远是往画面里面走；
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

/**
 * 俯视跟随时玩家自己摆镜头（11-01 做：本人 10-30 嫌视角卡得太死）：电脑上按住右键拖动——横着拖绕着人转、竖着拖改俯角，
 * 滚轮拉远拉近，按 C（设置里可改）回正；手机上在右边空处单指拖动转、双指捏合远近。记的是相对默认机位的偏移，followPose 照它算；
 * 走位的"往前"跟着转过后的画面走。人和 boss 框不进来时照旧自动往后拉
 */
export const ORBIT = {
  /** 拖 1 像素转几弧度 */
  sens: 0.005,
  /** 俯角压到多低、抬到多高：低了天边和太阳进画，高了远处的红圈看不见 */
  pitchMin: THREE.MathUtils.degToRad(25), pitchMax: THREE.MathUtils.degToRad(65),
  /** 离多远是默认的几倍：最近、最远 */
  zoomMin: 0.6, zoomMax: 1.7,
  /** 滚轮每滚 1（deltaY 的像素）远近变几成：一格约 100，就是一成多 */
  wheel: 0.0012,
};
/** @typedef {{ yaw: number, pitch: number, zoom: number }} Orbit */

/** 默认机位（没转过） @returns {Orbit} */
export function orbitHome() { return { yaw: 0, pitch: 0, zoom: 1 }; }

/** 是不是默认机位 @param {Orbit} o */
export function orbitIsHome(o) { return o.yaw === 0 && o.pitch === 0 && o.zoom === 1; }

/**
 * 右键拖了 dx、dy 像素：往右拖镜头往左绕（画面跟着手往右转），往下拖镜头抬高、往下看得更多；俯角夹在上下限里
 * @param {Orbit} o 会被改掉 @param {number} dx @param {number} dy
 */
export function orbitDrag(o, dx, dy) {
  o.yaw = Math.atan2(Math.sin(o.yaw - dx * ORBIT.sens), Math.cos(o.yaw - dx * ORBIT.sens));   // 收到 ±π，转多少圈都不漂
  o.pitch = THREE.MathUtils.clamp(FOLLOW.pitch + o.pitch + dy * ORBIT.sens, ORBIT.pitchMin, ORBIT.pitchMax) - FOLLOW.pitch;
  return o;
}

/** 滚轮滚了 dy（往下滚为正 = 拉远） @param {Orbit} o 会被改掉 @param {number} dy */
export function orbitZoom(o, dy) {
  o.zoom = THREE.MathUtils.clamp(o.zoom * Math.exp(dy * ORBIT.wheel), ORBIT.zoomMin, ORBIT.zoomMax);
  return o;
}

/** 手机上双指捏合：两指距离从 d0 变成 d1，张开（d1 更大）推近、捏拢拉远 @param {Orbit} o 会被改掉 @param {number} d0 @param {number} d1 */
export function orbitPinch(o, d0, d1) {
  if (d0 > 0 && d1 > 0) o.zoom = THREE.MathUtils.clamp(o.zoom * (d0 / d1), ORBIT.zoomMin, ORBIT.zoomMax);
  return o;
}

/** 交给 followPose 的那几项：转过的方向、俯角、默认距离（最远照旧，拉近了也能自动拉回来框 boss） @param {Orbit} o */
export function orbitOpts(o) {
  return { yaw: FOLLOW.yaw + o.yaw, pitch: FOLLOW.pitch + o.pitch, dist: FOLLOW.dist * o.zoom, maxDist: Math.max(FOLLOW.maxDist, FOLLOW.dist * o.zoom) };
}

/** 设置里的镜头灵敏度：拖动的像素先乘它再交给 orbitDrag / lookDrag；存的东西不认识就是 1 倍 */
export const SENS = { min: 0.3, max: 2 };
/** @param {unknown} s 存在浏览器里的那一串 */
export function readSens(s) {
  const v = typeof s === 'string' && s.trim() ? Number(s) : NaN;
  return Number.isFinite(v) ? THREE.MathUtils.clamp(v, SENS.min, SENS.max) : 1;
}

/**
 * 镜头别被实心的东西挡住：从看的点往镜头那条线上，要是穿过哪个实心盒子（main 给的是牌坊：layout.js CAMERA_BLOCKERS；四面各放宽 pad 米），
 * 镜头就挪到它跟前；最近不近过 min 米。看的点本身在盒子里（贴着柱子站）的那个不管
 * @param {THREE.Vector3} look 看的点 @param {THREE.Vector3} dir 从看的点指向镜头（长度 1） @param {number} dist 本来离多远
 * @param {{ min: number[], max: number[] }[]} solids @param {number} [pad] @param {number} [min]
 * @returns {number} 镜头最远放多远
 */
export function clearDist(look, dir, dist, solids, pad = 0.4, min = 3) {
  const o = [look.x, look.y, look.z], d = [dir.x, dir.y, dir.z];
  let best = dist;
  for (const b of solids) {
    let t0 = -Infinity, t1 = Infinity;
    for (let i = 0; i < 3 && t0 <= t1; i++) {
      const lo = b.min[i] - pad, hi = b.max[i] + pad;
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo || o[i] > hi) t0 = Infinity; continue; }
      const a = (lo - o[i]) / d[i], c = (hi - o[i]) / d[i];
      t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
    }
    if (t0 <= t1 && t0 > 0 && t0 < best) best = t0;
  }
  return Math.max(Math.min(best, dist), Math.min(min, dist));
}

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
 * 召龙时推到人的肩后、朝龙要砸的地方看，龙钻出来以后看的点往龙头那边偏 head 成，龙开飞后停 sec 秒、从召的那一刻算最多 wait 秒，
 * 或到龙砸中，再拉回俯视（10-30 本人嫌太久：原来 sec 2.6、wait 3.6、推过去 0.45、拉回 0.9，最长约 5 秒，缩到约 2.3 秒）。
 */
export const SHOT = {
  kick: { push: 0.22, in: 0.12, out: 0.8 },
  /**
   * 在人身后几米、往右偏几米（横屏时；电脑上技能按钮在底下正中，偏这么多人才落在按钮排左边，画面窄就按宽高比少偏些，免得出画）、
   * 多高（齐头顶：人的上半身在按钮那一排上面）；看的点多高、最高抬到多高（龙飞得高时不跟着仰上去，不然人沉到画面底下）；
   * 推过去、拉回来各几秒
   */
  back: 3.4, side: 2.0, up: 1.9, lookY: 1.5, head: 0.45, maxLookY: 2.4, sec: 1.3, wait: 1.8, in: 0.3, out: 0.55,
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
 * 三档视角（设计文档第 4 节"10-29 定"）：俯视跟随（默认）/ 肩后 / 第一人称，一个按钮轮着切（电脑上按 V）。
 * 后两档用同一套锁定："往前"朝着目标，镜头跟着往前转，转速有上限（boss 冲撞擦身而过时不甩半圈）；
 * 摇杆上 = 朝目标走、左右 = 绕着它转。锁定可以关（F、鼠标中键或按钮），关了以后自己拖着转（LOOK）。
 */
export const VIEWS = /** @type {const} */ (['follow', 'shoulder', 'first']);
/** @typedef {typeof VIEWS[number]} View */
/** 按钮上写的名字 @type {Record<View, string>} */
export const VIEW_NAMES = { follow: '俯视', shoulder: '肩后', first: '第一人称' };
/** 下一档 @param {View} v @returns {View} */
export function nextView(v) { return VIEWS[(VIEWS.indexOf(v) + 1) % VIEWS.length]; }
/** 存在浏览器里的那一档（存的东西不认识就回到俯视） @param {unknown} s @returns {View} */
export function readView(s) { return VIEWS.includes(/** @type {View} */ (s)) ? /** @type {View} */ (s) : 'follow'; }

export const LOCK = {
  /** "往前"每秒最多转几弧度 */
  turn: 2.4,
  /**
   * 肩后：在人身后几米、往右偏几米（横屏；画面窄按宽高比少偏）、多高；看人前面几米、多高的地方——
   * 往前下方看，人落在画面左下，身边和前面地上的预警看得见
   */
  back: 4.6, side: 1.2, up: 3.4, ahead: 3, lookY: 0,
  /** 第一人称：眼睛多高、往前探多少（别看见自己的头），看前面几米、多高（略往下，看得到前面的地） */
  eye: 1.62, nose: 0.2, far: 10, farY: 0.7,
  /** 第一人称时法术从哪出手：人前面几米、往右几米、多高（在镜头前面，不从镜头里钻出来） */
  hand: { ahead: 0.9, side: 0.25, y: 1.3 },
};

/**
 * 锁谁：有 boss 锁 boss；小怪潮里锁最近的一只；场上没有敌人给 null（保持原来的朝向）
 * @param {{ x: number, z: number }} p 人
 * @param {{ x: number, z: number } | null} boss
 * @param {{ x: number, z: number }[]} others 场上别的敌人
 * @returns {{ x: number, z: number } | null}
 */
export function lockTarget(p, boss, others) {
  if (boss) return boss;
  let best = null, bd = Infinity;
  for (const e of others) {
    const d = (e.x - p.x) ** 2 + (e.z - p.z) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/**
 * "往前"朝目标转一步：水平、长度 1，每秒最多转 rate 弧度，走近路（不绕远的那一边）；没有目标、目标就在脚下时不转
 * @param {THREE.Vector3} dir 现在朝哪（会被改掉） @param {{ x: number, z: number }} p
 * @param {{ x: number, z: number } | null} target @param {number} dt @param {number} [rate]
 */
export function turnToward(dir, p, target, dt, rate = LOCK.turn) {
  const cur = Math.atan2(dir.x, dir.z);
  let a = cur;
  if (target && Math.hypot(target.x - p.x, target.z - p.z) > 0.5) {
    let d = Math.atan2(target.x - p.x, target.z - p.z) - cur;
    d = Math.atan2(Math.sin(d), Math.cos(d));   // 收到 ±π：走近路
    a = cur + THREE.MathUtils.clamp(d, -rate * dt, rate * dt);
  }
  return dir.set(Math.sin(a), 0, Math.cos(a));
}

/**
 * 肩后 / 第一人称自己转（11-01 做，方案 A 第二步）：锁着时拖动是"看一眼"——松手后照锁定的转速转回目标，抬头低头也慢慢回平；
 * 解锁后拖到哪停在哪，"往前"跟着转。横着拖转"往前"，竖着拖抬头低头（tilt，正 = 抬头）。
 * 方向同俯视的 orbitDrag：往右拖往右看，往下拖往下看
 */
export const LOOK = {
  /** 抬头、低头最多偏几弧度：肩后抬到头镜头还在地面以上，第一人称低到头看得见脚边 */
  tiltMin: THREE.MathUtils.degToRad(-35), tiltMax: THREE.MathUtils.degToRad(30),
  /** 锁着时松手后抬低头每秒回平几成（指数）；左右照锁定的转速（LOCK.turn）转回去 */
  back: 3,
};
/** @typedef {{ tilt: number }} Look */

/** "往前"水平转 a 弧度（正 = 往左） @param {THREE.Vector3} dir 会被改掉 @param {number} a */
export function turnBy(dir, a) {
  const c = Math.atan2(dir.x, dir.z) + a;
  return dir.set(Math.sin(c), 0, Math.cos(c));
}

/** 肩后 / 第一人称拖了 dx、dy 像素（已乘灵敏度） @param {THREE.Vector3} dir 会被改掉 @param {Look} look 会被改掉 @param {number} dx @param {number} dy */
export function lookDrag(dir, look, dx, dy) {
  turnBy(dir, -dx * ORBIT.sens);
  look.tilt = THREE.MathUtils.clamp(look.tilt - dy * ORBIT.sens, LOOK.tiltMin, LOOK.tiltMax);
}

/**
 * 肩后 / 第一人称的机位和看的点
 * tilt：抬头低头。第一人称绕眼睛转；肩后绕视线经过人那一处（胸口高）转——抬头时镜头往下沉，人一直在画面里
 * @param {'shoulder' | 'first'} view @param {{ x: number, z: number }} p 人 @param {THREE.Vector3} dir "往前"（水平、长度 1）
 * @param {number} [aspect] 画面宽高比 @param {number} [tilt]
 * @returns {{ pos: THREE.Vector3, look: THREE.Vector3 }}
 */
export function lockPose(view, p, dir, aspect = 16 / 9, tilt = 0) {
  const L = LOCK, rx = -dir.z, rz = dir.x;   // 右手方向
  /** @type {{ pos: THREE.Vector3, look: THREE.Vector3 }} */
  let r;
  /** 绕哪一点抬头低头 @type {THREE.Vector3} */
  let pivot;
  if (view === 'first') {
    r = { pos: new THREE.Vector3(p.x + dir.x * L.nose, L.eye, p.z + dir.z * L.nose),
      look: new THREE.Vector3(p.x + dir.x * L.far, L.farY, p.z + dir.z * L.far) };
    pivot = r.pos.clone();
  } else {
    const side = L.side * THREE.MathUtils.clamp(aspect / 1.7, 0.25, 1);
    r = { pos: new THREE.Vector3(p.x - dir.x * L.back + rx * side, L.up, p.z - dir.z * L.back + rz * side),
      look: new THREE.Vector3(p.x + dir.x * L.ahead + rx * side, L.lookY, p.z + dir.z * L.ahead + rz * side) };
    pivot = new THREE.Vector3(p.x + rx * side, L.up + (L.lookY - L.up) * L.back / (L.back + L.ahead), p.z + rz * side);
  }
  if (tilt) {
    const c = Math.cos(tilt), s = Math.sin(tilt);
    for (const q of [r.pos, r.look]) {   // 在含"往前"的竖直面里绕 pivot 转
      const u = (q.x - pivot.x) * dir.x + (q.z - pivot.z) * dir.z, w = q.y - pivot.y;
      const u2 = u * c - w * s, w2 = u * s + w * c;
      q.set(q.x + dir.x * (u2 - u), pivot.y + w2, q.z + dir.z * (u2 - u));
    }
  }
  return r;
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
