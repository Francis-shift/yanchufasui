// @ts-check
/**
 * 召唤：五元素龙（冰龙从法术 Demo 移植；五条的模型都由本人用 Tripo 生成，哪条的模型没给地址或下载失败，就借冰龙的模型换色顶上）。
 *
 * 做法：龙头沿一条预先设计的三维曲线按弧长前进；龙的模型是笔直的，
 * 每一帧把模型上每个点按"离龙头多远"贴到曲线的对应位置上（路径变形），整条龙就沿同一条路径游动。
 * 每条龙一套自己的动作，靠各自的曲线、速度、身体摆法编排（flightPlan，设计文档第 4 节"五元素龙"）：
 *   - 冰龙：施法者左前方破土，螺旋升起，绕广场上空一圈，俯冲砸向目标、灌进地里；
 *   - 火龙：从右边天上扑下来，贴着目标上空横扫过去、一路喷火，再拉起飞走（目标在牌坊背后就照冰龙的走法从门洞俯冲）；
 *   - 雷龙：从天上盘下来，在目标上空绕一圈多，边绕边劈五道雷，再冲回天上；
 *   - 风龙：从左边云海里升上来，绕着目标螺旋上升两圈，再直上云霄；
 *   - 土龙：目标脚下亮法阵，从地底直冲上来，拱成一道弧，扎回旁边的地里。
 * 砸中、劈雷时调用 main 给的钩子（伤害、火海、土墙圈、旋风都在 main 里结算），这里只演。
 *
 * 两种演法：
 *   - summon：真召出来；领悟了护身的不扑出去，从人脚下钻出来绕着人转（guardPlan）；
 *   - ghost：差一口气——只有一层发光的龙影从法阵里升起，盘到半空散掉，然后 main 放同元素的雨。
 * 可以同时演好几条（领悟了双龙一次两条）：模型共用，每条有自己的一份网格按自己的曲线变形；龙头的光只有一盏，跟最新的那条。
 * 正在演龙时差一口气，龙影就省掉，雨照放。
 *
 * 模型按需加载（第一次要用时，或气势槽过半时预先加载）：DRG2 格式（读法见 world/drg2.js）。
 * 没有模型（没给地址、加载失败、等了 3 秒还没到）照样按曲线飞、钩子照样触发，只是看不到龙身，只有一串光点。
 */
import * as THREE from 'three';
import { PALETTE, arcsTex, col, easeOutBack, easeOutCubic, perSec, rand, randDir, ringMat, scaleArr, sigilMat, sigilTex } from './common.js';
import { CASTER_POS, GATE, SOLIDS } from '../world/layout.js';
import { decodeDRG2, fetchBytes } from '../world/drg2.js';
import { SUMMONS } from '../rules/numbers.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DRAGON_LEN = 20;          // 龙身长（米）
const STATIONS = 160;           // 沿龙身取多少个截面算曲线位置，顶点在相邻截面之间插值
const REST = 7;                 // 每个顶点的预计算量：截面号、插值比例、侧偏移、上偏移、法线在侧/上/前三个方向的分量
/** 破土点：施法者左前方（广场上，地面以下看不见） */
const EMERGE = new THREE.Vector3(CASTER_POS.x - 3, 0, CASTER_POS.z - 1.2);
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp;

/**
 * 冰龙模型换色给别的龙用：贴图按亮度拉开（冰龙贴图亮度九成落在 0.42～0.87），暗处取 dark、亮处取 light（sRGB）；
 * emissive 是自发光的颜色（同一张贴图当自发光贴图）；flat 是没贴图的减面版用的底色。
 * 有自己模型的龙不换色，emissive、rough、metal 照样用这里的。
 */
const LOOK = {
  fire:    { dark: [0.30, 0.04, 0.01], light: [1.0, 0.62, 0.22], emissive: [0.85, 0.32, 0.08], rough: 0.45, metal: 0.15, flat: 0xff8a4a },
  thunder: { dark: [0.10, 0.08, 0.05], light: [1.0, 0.82, 0.34], emissive: [0.8, 0.58, 0.14], rough: 0.35, metal: 0.5, flat: 0xe0b44a },
  wind:    { dark: [0.04, 0.22, 0.16], light: [0.72, 1.0, 0.86], emissive: [0.25, 0.72, 0.5], rough: 0.3, metal: 0.1, flat: 0x8eeec0 },
  earth:   { dark: [0.18, 0.11, 0.05], light: [0.9, 0.66, 0.38], emissive: [0.35, 0.22, 0.08], rough: 0.8, metal: 0.05, flat: 0xb88a58 },
};
/** 身体怎么摆：侧摆、上下摆的幅度（米，越靠尾越大）、快慢、沿身体的相位差；zig 是折线摆（雷龙） */
const SWAY = {
  ice:     { side: 0.18, up: 0, w: 7, k: 0.13 },
  fire:    { side: 0.3, up: 0.12, w: 6, k: 0.16 },
  thunder: { side: 0.35, up: 0.12, w: 11, k: 0.4, zig: true },
  wind:    { side: 0.45, up: 0.2, w: 4, k: 0.22 },
  earth:   { side: 0.08, up: 0, w: 3, k: 0.08 },
};

/** @param {THREE.Vector3} p @param {{ min: number[], max: number[] }} b */
const boxDist = (p, b) => Math.hypot(
  Math.max(b.min[0] - p.x, 0, p.x - b.max[0]), Math.max(b.min[1] - p.y, 0, p.y - b.max[1]), Math.max(b.min[2] - p.z, 0, p.z - b.max[2]));
const _q = new THREE.Vector3();
/**
 * 一条路线离场景里的实心物件（layout.js SOLIDS）最近多远；砸中处 2 米内、地面（floor）以下不算。
 * 火龙、风龙、土龙召唤时在几种走法里挑第一种够远的（龙身半径加摆幅，见 need）。
 * @param {THREE.Vector3[]} pts @param {THREE.Vector3} at 砸中处 @param {number} floor
 */
export function pathClearance(pts, at, floor) {
  const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  let min = Infinity;
  for (let i = 0; i <= 200; i++) {
    const q = c.getPoint(i / 200, _q);
    if (q.y < floor || q.distanceToSquared(at) < 4) continue;
    for (const b of SOLIDS) min = Math.min(min, boxDist(q, b));
  }
  return min;
}
/** 离实心物件要多远：龙身中线 1.2 米加摆幅（尾巴摆得最大，是 1.3 倍） @param {typeof SWAY.ice} sw */
export const need = (sw) => 1.2 + Math.hypot(sw.side, sw.up) * 1.3;
/**
 * 几种走法挑一种：pick 给了（目标走动重算时）就用召唤时挑定的那种，免得中途换路线龙跳一下；
 * 没给就挑第一种离实心物件够远的，都不够就挑最远的。
 * @param {(() => FlightPlan)[]} cands @param {number | undefined} pick @returns {FlightPlan}
 */
function choose(cands, pick) {
  if (pick !== undefined) return { ...cands[Math.min(pick, cands.length - 1)](), pick };
  let best = null, bestD = -Infinity;
  for (const [i, make] of cands.entries()) {
    const p = make(), d = pathClearance(p.pts, p.pts[p.hit], Math.min(p.sigil.y, p.pts[p.hit].y) - 0.5);
    if (d >= need(p.sway)) return { ...p, pick: i };
    if (d > bestD) { bestD = d; best = { ...p, pick: i }; }
  }
  return /** @type {FlightPlan} */ (best);
}

/**
 * 俯冲段的五个控制点：拐弯点、俯冲起点、落点、钻地的两点（目标走动时整段跟着重算）。
 * 平常绕到右前方、从目标斜上方 5 米扑下去；目标在牌坊背后的石阶上时，这样扑会直接撞上柱子（10-21 实机截图），
 * 改成先拐到中线前方、对准门洞、贴着地面从镇山石底下穿过去（龙身中线离地约 2 米，石头底在 4 米）——
 * 从右前方直接斜插门洞会擦过右边华表的顶。
 * 走哪种在召唤那一刻定下（diveMode），之后目标走动只挪落点：中途换拐弯点，龙会在曲线上跳一下。
 * @param {THREE.Vector3} T 落点 @param {'open' | 'gate'} mode
 */
export function divePoints(T, mode) {
  let turn = v3(7.2, 6.5, 0.5), dive = v3(T.x + 1.5, T.y + 5.5, T.z + 6);
  if (mode === 'gate') { turn = v3(2.5, 5.5, 1.5); dive = v3(0, 2.2, GATE.z + 2.2); }
  const dir = T.clone().sub(dive).normalize();
  return { dir, pts: [turn, dive, T.clone(), T.clone().addScaledVector(dir, 1.2).add(v3(0, -3, 0)), T.clone().add(v3(dir.x * 2, -30, dir.z * 2))] };
}

/**
 * 冰龙整条曲线的控制点（14 个，落点是第 11 个）：地下 → 破土 → 螺旋上升 → 绕广场上空 → 俯冲（divePoints）。
 * 绕场高度按固定镜头算过：后排 10 米高会出画面顶边（10-19 截图），压到 7～7.6 米；
 * 后排原在 z ≈ -8.5，牌坊换成 13 米宽的模型后正好穿过横梁和屋顶（10-21 实机截图），挪到牌坊前面 z ≈ -4.2
 * （两点之间的曲线会往后鼓约 1 米）。
 * @param {THREE.Vector3} T 落点 @param {'open' | 'gate'} [mode]
 */
export function summonPoints(T, mode = diveMode(T)) {
  const E = EMERGE;
  return [
    E.clone().add(v3(0, -4, 0)), E.clone().add(v3(0, -0.5, 0)),                  // 地下 → 破土
    E.clone().add(v3(0.9, 1.6, -0.7)), E.clone().add(v3(2.1, 3.1, 0.5)),         // 螺旋上升
    E.clone().add(v3(0.7, 4.4, 1.9)), E.clone().add(v3(-1.6, 5.2, 0.8)),
    v3(-6.8, 7, 0.5), v3(-5, 7.6, -4.2), v3(5, 7.6, -4.0),                      // 绕场
    ...divePoints(T, mode).pts,
  ];
}

/**
 * 目标在门洞里或牌坊背后的石阶上（中线 3 米以内、在柱子前沿以后）就走门洞：
 * 平常的扑法在这里要么撞柱子，要么从右前方斜下来擦着右边华表的顶过去。
 * @param {THREE.Vector3} T @returns {'open' | 'gate'}
 */
export function diveMode(T) {
  return T.z < GATE.z + 1.6 && Math.abs(T.x) < 3 ? 'gate' : 'open';
}

/**
 * 一条龙的一套动作。pts 是曲线控制点；hit 是砸中（调 impact 钩子）的那个控制点；目标走动时第 move 个起的控制点跟着重算
 * （move 不小于点数就不跟）；sigil 是法阵亮在哪（地面）；rise 是从地下钻出来（破土有特效）；slam 是砸中时炸开；
 * strikes 是劈雷的那几个控制点；pour 是砸中后身体灌进地里（'in'）还是从地里钻出来（'out'）时落点冒碎屑；
 * speed 按龙头走到哪给速度（米/秒）；breath 是这时喷不喷龙息，down 是龙息往下压多少；pick 是几种走法里挑了哪种（choose）。
 * 土龙砸的是法阵所在处（从地里钻出来的地方），别的龙砸目标。
 * @typedef {{ pts: THREE.Vector3[], hit: number, move: number, sigil: THREE.Vector3, rise: boolean, slam: boolean,
 *   strikes?: number[], pour?: 'in' | 'out', speed: (s: number, f: Flight) => number, sway: typeof SWAY.ice,
 *   breath?: (s: number, f: Flight) => boolean, down?: number, pick?: number }} FlightPlan
 */

/**
 * 分段速度：龙头走到第 i 个控制点之前是 v 米/秒，过了最后一段是 last
 * @param {[number, number][]} list @param {number} last @returns {(s: number, f: Flight) => number}
 */
const segs = (list, last) => (s, f) => {
  for (const [i, v] of list) if (s < f.knots[i]) return v;
  return last;
};

/** @param {THREE.Vector3} T @param {'open' | 'gate'} mode @returns {FlightPlan} */
function icePlan(T, mode) {
  return { pts: summonPoints(T, mode), hit: 11, move: 9, sigil: EMERGE, rise: true, slam: true, pour: 'in', sway: SWAY.ice,
    // 地下段快速通过；破土盘旋放慢让人看清；绕场；俯冲与灌入
    speed: (s, f) => (s < f.sEmerge ? 14 : s < f.sEmerge + 9 ? 8.5 : s < f.sHit - 8 ? 17 : 30),
    breath: (s, f) => s > f.sHit - 7 };
}

/**
 * 火龙：从右边天上斜扑下来，压到目标上空约 6 米横扫过去（从右往左，整条横在画面里），一路喷火、地上留焦痕，过了目标再拉起飞走。
 * 横扫这条线左右各拉开三四十米，从牌坊附近过时会撞柱子、擦屋顶：先试贴着目标那条线，
 * 不行就把线挪到牌坊前面（z = 牌坊 + 3.2，龙息斜着喷过去），再不行抬高一点（choose 挑）。
 * 目标在牌坊背后（diveMode 是 gate）扫不到，照冰龙的走法从门洞俯冲。
 * @param {THREE.Vector3} T @param {'open' | 'gate'} mode @param {number} [pick] @returns {FlightPlan}
 */
function firePlan(T, mode, pick) {
  const base = { sigil: EMERGE, rise: false, slam: true, sway: SWAY.fire, down: 8 };
  if (mode === 'gate') {
    return { ...base, pts: [v3(30, 22, -1), v3(15, 10.5, 0), v3(6.5, 6.6, 1), ...divePoints(T, 'gate').pts], hit: 5, move: 4, pour: 'in',
      speed: segs([[3, 24]], 30), breath: (s, f) => s > f.knots[3] && s < f.sHit + 2 };
  }
  /** @param {number} z 横扫那条线 @param {number} h 扫过目标时多高 @returns {FlightPlan} */
  const line = (z, h) => {
    const x = T.x, y = T.y;
    return { ...base, hit: 4, move: 0,
      pts: [v3(x + 36, y + 24, z + 2), v3(x + 18, y + 13, z + 1), v3(x + 8, y + h + 0.8, z), v3(x + 3, y + h + 0.2, z), v3(x, y + h, z),
        v3(x - 4, y + h + 0.2, z), v3(x - 10, y + h + 2, z + 1), v3(x - 20, y + 15, z + 2), v3(x - 36, y + 27, z - 2)],
      speed: segs([[2, 26], [6, 12]], 22), breath: (s, f) => s > f.knots[2] - 2 && s < f.knots[6] };
  };
  const front = Math.max(T.z, GATE.z + 3.2);
  return choose([() => line(T.z, 5.6), () => line(front, 5.6), () => line(T.z, 6.4), () => line(front, 6.4)], pick);
}

/**
 * 雷龙：从左边天上沿着圈的后沿斜插下来，在目标上空 7.2 米绕一圈多（半径 4 米），绕的时候劈五道雷（劈谁由 main 的 strike 钩子定），
 * 绕完冲回天上。圈心夹在广场中间一块：绕圈的后沿离牌坊屋顶 2 米，前沿不出画面。目标走动不挪圈，雷跟着锁定的敌人劈。
 * @param {THREE.Vector3} T @returns {FlightPlan}
 */
function thunderPlan(T) {
  const C = v3(clamp(T.x, -6, 6), 7.2, clamp(T.z, -1.2, 3)), R = 4, n = 14, turns = 1.15;
  const ring = Array.from({ length: n + 1 }, (_, i) => {
    const a = -Math.PI / 2 + (i / n) * turns * Math.PI * 2;
    return v3(C.x + Math.cos(a) * R, C.y + Math.sin(i * 1.7) * 0.4, C.z + Math.sin(a) * R);
  });
  const m = SUMMONS.thunder.strikes;   // 劈几道：从圈上第 2 个点到倒数第 1 个点均匀排开
  return { sigil: EMERGE, rise: false, slam: false, hit: 2 + n, move: Infinity, sway: SWAY.thunder,
    pts: [v3(C.x - 20, 30, C.z - R), v3(C.x - 9, 13, C.z - R), ...ring, v3(C.x + 6, 11, C.z + 1), v3(C.x + 12, 26, C.z - 6), v3(C.x + 18, 46, C.z - 16)],
    strikes: Array.from({ length: m }, (_, j) => 4 + Math.round((j * (n - 3)) / Math.max(1, m - 1))), speed: segs([[2, 34], [2 + n, 11]], 26) };
}

/**
 * 风龙：从左边云海里升上来，绕着目标螺旋上升两圈（6.5 米升到 9.3 米，半径 3.4 收到 2.4），再直上云霄。
 * 龙一开始绕圈（hit），main 就在目标处起旋风。目标在牌坊前后（左右 12 米内）时圈挪到牌坊前面，免得缠到牌坊上；
 * 还会擦到什么就再往前挪（choose 挑）。
 * @param {THREE.Vector3} T @param {number} [pick] @returns {FlightPlan}
 */
function windPlan(T, pick) {
  /** @param {number} dz 圈心再往前挪多少 @returns {FlightPlan} */
  const make = (dz) => {
    const H = T.clone();
    if (Math.abs(H.x) < 12 && H.z < -1.5 && H.z > -13.5) { H.z = -1.5; H.y = 0; }
    H.z += dz;
    const n = 24, turns = 2, r0 = 3.4;
    const helix = Array.from({ length: n + 1 }, (_, i) => {
      const f = i / n, a = -Math.PI / 2 + f * turns * Math.PI * 2, r = r0 - f;
      return v3(H.x + Math.cos(a) * r, H.y + 6.5 + f * 2.8, H.z + Math.sin(a) * r);
    });
    return { sigil: EMERGE, rise: false, slam: false, hit: 3, move: 0, sway: SWAY.wind,
      pts: [v3(H.x - 40, H.y - 6, H.z - 14), v3(H.x - 24, H.y - 1, H.z - 6), v3(H.x - 12, H.y + 7.5, H.z - r0), ...helix,
        v3(H.x + 1.5, H.y + 13, H.z + 0.5), v3(H.x + 5, H.y + 28, H.z - 8), v3(H.x + 9, H.y + 46, H.z - 18)],
      speed: segs([[3, 26], [3 + n, 16]], 28) };
  };
  return choose([() => make(0), () => make(1), () => make(2)], pick);
}

/**
 * 土龙：法阵亮在目标脚下，龙从地底直冲上来（冲出地面那一下就是砸中），拱成一道 7.4 米高、9 米宽的弧，扎回旁边的地里。
 * 钻出来的地方：目标在牌坊底下前后 2.9 米内就挪到牌坊前面（屋顶和镇山石挡着）；离柱子、石兽、华表的底座不到 1.3 米就往前挪开。
 * 往哪边拱：先试横着往广场中间那边（从镜头看整道弧都在画面里），撞东西就换另一边，再不行斜着往镜头这边（choose 挑）。
 * @param {THREE.Vector3} T @param {number} [pick] @returns {FlightPlan}
 */
function earthPlan(T, pick) {
  const E = T.clone();
  if (Math.abs(E.x) < 7 && Math.abs(E.z - GATE.z) < 2.9) E.z = GATE.z + 2.9;
  const foot = () => Math.min(...SOLIDS.filter((b) => b.min[1] < 4).map((b) => Math.hypot(Math.max(b.min[0] - E.x, 0, E.x - b.max[0]), Math.max(b.min[2] - E.z, 0, E.z - b.max[2]))));
  for (let i = 0; i < 15 && foot() < 1.3; i++) E.z += 0.3;
  /** @param {number} dx @param {number} dz 往哪边拱（水平方向，单位长） @returns {FlightPlan} */
  const make = (dx, dz) => {
    const p = (d, dy) => v3(E.x + dx * d, E.y + dy, E.z + dz * d);
    return { sigil: E, rise: true, slam: true, hit: 2, move: 0, pour: 'out', sway: SWAY.earth,
      pts: [p(0, -28), p(0, -6), p(0, 0), p(1.4, 4.4), p(4.6, 7.4), p(7.8, 4.6), p(9.2, 0), p(9.6, -6), p(9.8, -30)],
      speed: segs([[1, 30], [2, 22], [4, 14], [5, 10]], 22) };
  };
  const s = E.x > 0.5 ? -1 : 1, d = Math.SQRT1_2;
  return choose([() => make(s, 0), () => make(-s, 0), () => make(s * d, d), () => make(-s * d, d)], pick);
}

/**
 * 召唤时这条龙怎么飞；目标走动时用召唤时定下的 mode、pick 重算。
 * @param {string} el @param {THREE.Vector3} T 落点（地面） @param {'open' | 'gate'} [mode] @param {number} [pick] @returns {FlightPlan}
 */
export function flightPlan(el, T, mode = diveMode(T), pick = undefined) {
  if (el === 'fire') return firePlan(T, mode, pick);
  if (el === 'thunder') return thunderPlan(T);
  if (el === 'wind') return windPlan(T, pick);
  if (el === 'earth') return earthPlan(T, pick);
  return icePlan(T, mode);
}

/** 龙影：从法阵里升起、盘到半空 @param {string} el @returns {FlightPlan} */
function ghostPlan(el) {
  const E = EMERGE;
  const pts = [v3(0, -4, 0), v3(0, -0.5, 0), v3(0.9, 1.8, -0.7), v3(2, 3.6, 0.5), v3(0.5, 5.2, 1.6), v3(-1.8, 6.4, 0.6), v3(-2.4, 7.6, -1.5)]
    .map((d) => E.clone().add(d));
  return { pts, hit: pts.length - 1, move: Infinity, sigil: E, rise: true, slam: false, sway: SWAY[el] || SWAY.ice,
    speed: (s, f) => (s < f.sEmerge ? 16 : 10) };
}

/**
 * 护身（领悟）：龙从人脚下钻出来，贴着地绕人转 g.sec 秒（半径 g.r、离地 g.h、每秒 g.speed 米；g.dir 是转的方向，
 * 双龙护身的第二条在外圈反着转），转完盘上天。人走动时整圈跟着挪（move 是 0：每帧整条重算，龙随人平移）。
 * hit 是转完那一点：不砸，main 拿它知道护身结束了。
 * @param {THREE.Vector3} C 人站的地方（地面） @param {string} el
 * @param {{ r: number, h: number, dir: number, speed: number, sec: number }} g @returns {FlightPlan}
 */
export function guardPlan(C, el, g) {
  const turns = (g.speed * g.sec) / (2 * Math.PI * g.r), n = Math.ceil(turns * 12);
  const a0 = Math.PI / 2;   // 从人前面（朝镜头那一侧）钻出来
  const at = (/** @type {number} */ a, /** @type {number} */ r, /** @type {number} */ y) => v3(C.x + Math.cos(a) * r, C.y + y, C.z + Math.sin(a) * r);
  const ring = Array.from({ length: n + 1 }, (_, i) => at(a0 + g.dir * (i / n) * turns * Math.PI * 2, g.r, g.h));
  const end = a0 + g.dir * turns * Math.PI * 2;
  return { sigil: C.clone(), rise: true, slam: false, hit: 2 + n, move: 0, sway: SWAY[/** @type {keyof typeof SWAY} */ (el)] || SWAY.ice,
    pts: [at(a0 - g.dir * 0.7, g.r * 0.5, -6), at(a0 - g.dir * 0.35, g.r * 0.85, -0.6), ...ring,
      at(end + g.dir * 0.8, g.r * 1.1, g.h + 3), at(end + g.dir * 1.4, g.r * 1.4, g.h + 12), at(end + g.dir * 1.8, g.r * 1.6, g.h + 32)],
    speed: segs([[1, 22], [2 + n, g.speed]], 26) };
}

/** 外层辉光：同一份网格再画一遍，越是侧对镜头的面越亮（菲涅尔）。法线由屏幕空间导数算出，模型不必带法线 */
function glowMat(color, alpha) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, depthFunc: THREE.LessEqualDepth,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    uniforms: { uColor: { value: color }, uAlpha: { value: alpha } },
    vertexShader: `varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); vV = mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec3 vV;
      void main(){ vec3 c = cross(dFdx(vV), dFdy(vV));
        float l = length(c);
        if (l < 1e-12) discard;                    // 退化的面求不出法线，直接不画，免得归一化出 NaN
        vec3 n = c / l;
        float f = pow(1. - abs(dot(n, normalize(-vV))), 2.);
        gl_FragColor = vec4(uColor * f * uAlpha, 1.); }`,
  });
}

/**
 * 冰龙贴图换色（LOOK 的说明）：亮度拉开后在 dark、light 之间插值，画到一张新画布上。
 * @param {THREE.Texture} tex @param {typeof LOOK.fire} look
 */
function tintTexture(tex, look) {
  const img = /** @type {HTMLImageElement} */ (tex.image), w = img.width, h = img.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true }));
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h), a = d.data;
  const lo = look.dark.map((x) => x * 255), hi = look.light.map((x) => x * 255);
  for (let i = 0; i < a.length; i += 4) {
    const t = clamp(((0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]) / 255 - 0.42) / 0.45, 0, 1);
    a[i] = lo[0] + (hi[0] - lo[0]) * t; a[i + 1] = lo[1] + (hi[1] - lo[1]) * t; a[i + 2] = lo[2] + (hi[2] - lo[2]) * t;
  }
  g.putImageData(d, 0, 0);
  const out = new THREE.CanvasTexture(c);
  out.colorSpace = THREE.SRGBColorSpace; out.flipY = false; out.anisotropy = 4;
  return out;
}

/** 别的龙借冰龙模型时的材质：有贴图就换色，没贴图（减面版）就换底色 @param {any} base @param {typeof LOOK.fire} look */
function tintMaterial(base, look) {
  const opt = { roughness: look.rough, metalness: look.metal };
  if (base.tex) {
    try {
      const t = tintTexture(base.tex, look);
      return new THREE.MeshStandardMaterial({ ...opt, map: t, emissiveMap: t, emissive: col(look.emissive) });
    } catch (e) { console.warn('龙贴图换色失败，改用纯色：', e); }
  }
  return new THREE.MeshStandardMaterial({ ...opt, color: look.flat, emissive: col(look.emissive, 0.45), flatShading: true });
}

/** @typedef {{ mesh: string, tex?: string | null }} ModelUrls */

export class DragonFx {
  /**
   * @param {import('./spells.js').SpellFx} fx
   * @param {import('./particles.js').Particles} particles
   * @param {{ mesh?: string, tex?: string | null, models?: Record<string, ModelUrls> }} [urls]
   *   mesh、tex 是冰龙（也是别的龙没有自己模型时借用的那份）；models 里按元素给各自的模型
   */
  constructor(fx, particles, urls = {}) {
    this.fx = fx; this.p = particles; this.urls = urls;
    /** @type {Record<string, Promise<any>>} */
    this.loads = {};
    /** @type {Record<string, any>} 已下好的模型：冰龙在 ice，有自己模型的龙在各自的元素名下 */
    this.models = {};
    /** @type {Record<string, THREE.Material>} 借冰龙模型的龙换好色的材质 */
    this.tints = {};
    this.busy = 0;                                   // 正在下载的模型数
    /** @type {Flight[]} 正在演的（双龙同时两条；每条有自己的一份网格） */
    this.flights = [];
    /** @type {Flight | null} 龙头的光跟着哪一条（只有一盏，跟最新的那条，它演完了交给还在演的） */
    this.lit = null;
    this.light = new THREE.PointLight(0x66ccff, 0, 0, 2);   // 常驻，只改强度（增减灯光会让材质重编译）
    fx.scene.add(this.light);
    this.glow = glowMat(col(PALETTE.ice.secondary, 1.1), 0.55);
    // 龙影：白天只靠叠加的边缘光几乎看不见（10-19 截图），再垫一层半透明的身体
    this.ghostMat = new THREE.MeshBasicMaterial({ color: col(PALETTE.ice.secondary, 0.95), transparent: true, opacity: 0.5, depthWrite: false });
    this.sigilTex = sigilTex(); this.arcsTex = arcsTex();
  }

  /** 开始下载这条龙要用的模型（重复调用无妨）：有自己的模型下自己的，下不成或没有就下冰龙的 @param {string} [el] */
  preload(el = 'ice') {
    const own = el !== 'ice' ? this.urls.models?.[el] : undefined;
    if (own) return this.fetch(el, own).then((m) => m || this.preload('ice'));
    return this.urls.mesh ? this.fetch('ice', { mesh: this.urls.mesh, tex: this.urls.tex }) : Promise.resolve(null);
  }

  /** @param {string} key @param {ModelUrls} u */
  fetch(key, u) {
    if (!this.loads[key]) {
      this.busy++;
      this.loads[key] = this.load(u, key).then((m) => (this.models[key] = m))
        .catch((e) => { console.warn(`龙模型（${key}）加载失败：`, e); return null; })
        .finally(() => { this.busy--; });
    }
    return this.loads[key];
  }

  /**
   * 这条龙现在用哪份网格、什么材质：有自己的模型用自己的，没有就借冰龙的换色；都没下好返回 null。
   * @param {string} el @returns {{ model: any, material: THREE.Material } | null}
   */
  lookFor(el) {
    const own = this.models[el];
    if (own) return { model: own, material: own.material };
    const base = this.models.ice;
    if (!base) return null;
    if (el === 'ice' || !(el in LOOK)) return { model: base, material: base.material };
    if (!this.tints[el]) this.tints[el] = tintMaterial(base, LOOK[/** @type {keyof typeof LOOK} */ (el)]);
    return { model: base, material: this.tints[el] };
  }

  /** @param {ModelUrls} urls @param {string} el 这是哪条龙的模型（定材质） */
  async load(urls, el) {
    const [buf, tex] = await Promise.all([fetchBytes(urls.mesh), urls.tex ? new THREE.TextureLoader().loadAsync(urls.tex).catch(() => null) : null]);
    const d = decodeDRG2(buf);
    let material;
    if (tex && d.uv) {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;                               // 贴图坐标按 glTF 约定（v 从上往下）
      tex.anisotropy = 4;
      // 上色版：贴图当底色，同一张贴图再当自发光贴图，龙会透出自己的颜色，泛光也是冰蓝、火红而不是白
      const look = LOOK[/** @type {keyof typeof LOOK} */ (el)];
      material = new THREE.MeshStandardMaterial(look
        ? { map: tex, emissiveMap: tex, emissive: col(look.emissive), roughness: look.rough, metalness: look.metal }
        : { map: tex, emissiveMap: tex, emissive: new THREE.Color(0.35, 0.55, 0.9), roughness: 0.3, metalness: 0.1 });
    } else {
      // 没有贴图（预览页用的减面版）：冰晶材质，平面着色，不需要法线
      material = new THREE.MeshStandardMaterial({ color: 0xa8e2ff, emissive: new THREE.Color(0.05, 0.3, 0.72), roughness: 0.12, metalness: 0.15, flatShading: true });
    }
    const { nv, lo, hi, axis, anc, P, uv, index, N } = d;
    // 每个顶点：在龙身上的位置（换成相邻两个截面号 + 插值比例），相对中心线的侧向、上向偏移（米），
    // 以及法线在"侧、上、前"三个方向上的分量（模型坐标里侧 = x、上 = y、前 = z）
    const len = hi[2] - lo[2], scale = DRAGON_LEN / len;
    const toRest = (x, y, z, out, o) => {
      const f = THREE.MathUtils.clamp((hi[2] - z) / len, 0, 1) * (STATIONS - 1);
      const k0 = Math.min(Math.floor(f), STATIONS - 2);
      out[o] = k0; out[o + 1] = f - k0; out[o + 2] = (x - axis[0]) * scale; out[o + 3] = (y - axis[1]) * scale;
      return out;
    };
    const rest = new Float32Array(nv * REST);
    for (let i = 0; i < nv; i++) {
      toRest(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], rest, i * REST);
      if (N) {
        let nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
        // 零长度法线在着色器里归一化会得到 NaN，泛光把它放大成整屏闪烁。打包时已修补，这里再兜一次底：改成朝上
        if (Math.hypot(nx, ny, nz) < 0.01) { nx = 0; ny = 1; nz = 0; }
        rest[i * REST + 4] = nx; rest[i * REST + 5] = ny; rest[i * REST + 6] = nz;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    if (N) geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    const tail = [];                                     // 后 40% 龙身的顶点，尾部的雾从这里冒
    for (let i = 0; i < nv; i++) if (rest[i * REST] > STATIONS * 0.6) tail.push(i);
    const anchor = (j) => toRest(anc[j * 3], anc[j * 3 + 1], anc[j * 3 + 2], new Float32Array(4), 0);
    return { geo, rest, nv, tail, hasNormals: !!N, material, tex: tex && d.uv ? tex : null,
      anchors: { whiskers: [anchor(0), anchor(1)], mouth: anchor(2) } };
  }

  /** 正在演的第一条（调试接口用） */
  get active() { return this.flights[0] ?? null; }

  /**
   * 真召唤：照这条龙的一套动作飞（flightPlan），砸中时调用 hooks.impact，雷龙每劈一道调用 hooks.strike（伤害都在 main 里结算）。
   * 模型还在下载就先亮法阵等着，最多等 3 秒；没有模型就不画龙身，照样飞、照样触发钩子。
   * 龙要飞好几秒，敌人在走：follow 每帧给出目标现在的位置，龙的后半段跟着挪，砸的就是锁定的那几只。
   * guard 给了就是护身（guardPlan）：target、follow 是人，绕人转完调用 hooks.impact；转的时候每帧把龙身中线上的点交给 hooks.tick。
   * @param {THREE.Vector3} target @param {string} el
   * @param {Hooks} hooks
   * @param {() => THREE.Vector3 | null} [follow]
   * @param {{ r: number, h: number, dir: number, speed: number, sec: number }} [guard]
   */
  summon(target, el, hooks, follow, guard) {
    this.preload(el);
    this.flights.push(new Flight(this, 'summon', target, el, hooks, follow, guard));
    this.fx.pulseDim(0.85, 3.2);   // 龙出场：世界压暗，龙和它的光成为画面里最亮的东西
  }

  /**
   * 差一口气：龙影升起又散去，然后调用 onDone（main 在这里放雨）。正在演别的龙、或模型没下好时不演，直接 onDone。
   * @param {string} el @param {() => void} onDone
   */
  ghost(el, onDone) {
    this.preload(el);
    if (this.flights.length || !this.lookFor(el)) { onDone(); return; }
    this.flights.push(new Flight(this, 'ghost', EMERGE.clone().add(new THREE.Vector3(0, 7, 0)), el, { impact: () => onDone() }));
  }

  /** @param {number} dt */
  update(dt) {
    let n = 0;
    for (const f of this.flights) if (f.update(dt)) this.flights[n++] = f;
    this.flights.length = n;
  }

  clear() { for (const f of this.flights) f.finish(); this.flights.length = 0; this.lit = null; }
}

/**
 * @typedef {{ impact: (p: THREE.Vector3) => void, strike?: (from: THREE.Vector3, i: number) => void,
 *   tick?: (spine: THREE.Vector3[], dt: number) => void }} Hooks
 */

const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _s = new THREE.Vector3(), _u = new THREE.Vector3();
const _d = new THREE.Vector3(), _m = new THREE.Vector3(), _b = new THREE.Vector3(), _anc = new Float32Array(3);

/** 一次飞行（真召唤或龙影） */
class Flight {
  /**
   * @param {DragonFx} owner @param {'summon' | 'ghost'} kind @param {THREE.Vector3} target @param {string} el
   * @param {Hooks} hooks
   * @param {() => THREE.Vector3 | null} [follow]
   * @param {{ r: number, h: number, dir: number, speed: number, sec: number }} [guard] 护身：绕人转（guardPlan）
   */
  constructor(owner, kind, target, el, hooks, follow, guard) {
    this.o = owner; this.kind = kind; this.el = el; this.hooks = hooks; this.follow = follow; this.guard = guard;
    this.pal = PALETTE[el] || PALETTE.ice;
    this.target = target.clone();
    this.mode = diveMode(this.target);
    this.plan = kind === 'ghost' ? ghostPlan(el) : this.planFor(this.target);
    this.done = false;
    /** @type {THREE.Vector3[]} 龙身中线上隔一段取一个点（护身的 tick 用，每帧重写） */
    this.spinePts = Array.from({ length: 17 }, () => new THREE.Vector3());
    /** @type {THREE.BufferGeometry | null} 这一条自己的网格（同一个模型两条同时飞，各变形各的） */
    this.geo = null;
    owner.lit = this;
    this.sig = this.plan.sigil.clone();                // 法阵在哪（地面）；土龙的跟着目标挪
    this.curve = new THREE.CatmullRomCurve3(this.plan.pts.map((q) => q.clone()), false, 'centripetal');
    this.curve.arcLengthDivisions = 1500;
    /** @type {number[]} */ this.knots = [];
    this.L = 0; this.sHit = 0;
    this.measure();
    this.sEmerge = 0;                                  // 龙头钻出地面时走过的弧长（冰龙按它分段调速）
    if (this.plan.rise) {
      for (let i = 0; i <= 3000; i++) if (this.curve.getPointAt(i / 3000).y > this.sig.y) { this.sEmerge = (i / 3000) * this.L; break; }
    }
    this.age = 0; this.s = 0; this.emerged = !this.plan.rise; this.impacted = false; this.waitT = 0; this.started = false;
    this.tailUp = false;                               // 龙尾出过地面：之后再钻回地下就收场
    this.nextStrike = 0; this.arcT = 0; this.scorchAt = -1;
    /** @type {any} */ this.model = null;
    this.lastS = new THREE.Vector3(1, 0, 0);
    this.st = new Float32Array(STATIONS * 12);    // 每个截面的位置、侧向、上向、前向（各 3 个数），每帧重算
    this.headPos = new THREE.Vector3(0, -50, 0); this.headT = new THREE.Vector3(0, 0, 1); this.headU = new THREE.Vector3(0, 1, 0);
    this.tailPos = new THREE.Vector3(0, -50, 0);
    /** @type {THREE.Mesh | null} */ this.body = null;
    /** @type {THREE.Mesh | null} */ this.glowMesh = null;

    // 召唤法阵：先亮 0.45 秒，龙才动
    const scene = owner.fx.scene;
    this.sigil = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 7.2), sigilMat(owner.sigilTex, col(this.pal.primary, 1.6)));
    this.arcs = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 8.4), sigilMat(owner.arcsTex, col(this.pal.secondary, 1.3)));
    for (const m of [this.sigil, this.arcs]) { m.rotation.x = -Math.PI / 2; scene.add(m); }
    this.placeSigil();
    owner.light.color.copy(col(this.pal.primary));
    owner.glow.uniforms.uColor.value.copy(col(this.pal.secondary, 1.1));
    owner.ghostMat.color.copy(col(this.pal.secondary, 0.95));
  }

  placeSigil() { for (const m of [this.sigil, this.arcs]) m.position.set(this.sig.x, this.sig.y + 0.04, this.sig.z); }

  /** 目标在 T 时怎么飞：护身绕人转，别的照这条龙的走法（走法沿用召唤时定下的 mode、pick） @param {THREE.Vector3} T @returns {FlightPlan} */
  planFor(T) {
    return this.guard ? guardPlan(T, this.el, this.guard) : flightPlan(this.el, T, this.mode, this.plan?.pick);
  }

  /** 曲线变了（刚建好、目标走动）：重算全长、每个控制点所在的弧长、砸中处的弧长 */
  measure() {
    this.curve.updateArcLengths();
    const lens = this.curve.getLengths(), n = this.curve.points.length;
    this.L = lens[lens.length - 1];
    this.knots = this.curve.points.map((_, i) => lens[Math.round((i / (n - 1)) * (lens.length - 1))]);
    this.sHit = this.knots[this.plan.hit];
  }

  /** 模型到了才挂上网格 @param {{ model: any, material: THREE.Material }} look */
  attach(look) {
    const scene = this.o.fx.scene, src = look.model.geo;
    this.model = look.model;
    // 位置、法线每帧按这条龙的曲线重写，所以每条龙一份；贴图坐标、三角形共用模型那份
    const geo = this.geo = new THREE.BufferGeometry();
    for (const k of ['position', 'normal']) {
      if (src.attributes[k]) geo.setAttribute(k, new THREE.BufferAttribute(new Float32Array(src.attributes[k].array.length), 3).setUsage(THREE.DynamicDrawUsage));
    }
    if (src.attributes.uv) geo.setAttribute('uv', src.attributes.uv);
    geo.setIndex(src.index);
    this.body = new THREE.Mesh(geo, this.kind === 'summon' ? look.material : this.o.ghostMat);
    this.body.castShadow = this.kind === 'summon';
    this.body.frustumCulled = false;
    scene.add(this.body);
    this.glowMesh = new THREE.Mesh(geo, this.o.glow);
    this.glowMesh.frustumCulled = false;
    this.glowMesh.renderOrder = 1;
    scene.add(this.glowMesh);
    this.o.glow.uniforms.uAlpha.value = this.kind === 'ghost' ? 1.1 : 0.55;
    this.o.ghostMat.opacity = 0.5;
  }

  /**
   * 目标走动了：从第 move 个控制点起按这条龙的走法重算（走法沿用召唤时定下的 mode），前面的不动；土龙的法阵跟着挪。
   * @param {THREE.Vector3 | null} p
   */
  retarget(p) {
    const pts = this.curve.points;
    if (!p || this.plan.move >= pts.length || p.distanceToSquared(this.target) < 0.0025) return;
    this.target.copy(p);
    const np = this.planFor(this.target);
    for (let k = this.plan.move; k < pts.length; k++) pts[k].copy(np.pts[k]);
    if (!np.sigil.equals(this.sig)) { this.sig.copy(np.sigil); this.placeSigil(); }
    this.measure();
  }

  frameAt(s, outP, outT) {                      // 弧长 s 处的位置、切线，以及侧向 _s、上向 _u
    const u = THREE.MathUtils.clamp(s / this.L, 0, 1);
    this.curve.getPointAt(u, outP); this.curve.getTangentAt(u, outT);
    // 必须是右手系（侧 × 上 = 前），否则 makeBasis 得到的是镜像矩阵：朝向算错、正反面颠倒
    _s.crossVectors(WORLD_UP, outT);
    if (_s.lengthSq() < 1e-4) _s.copy(this.lastS); else { _s.normalize(); this.lastS.copy(_s); }
    _u.crossVectors(outT, _s).normalize();
  }

  // 模型上一点（rest 里从 ri 起：截面号、插值比例、侧偏移、上偏移）→ 世界坐标，写进 out[oi..oi+2]
  restToWorld(rest, ri, out, oi) {
    const st = this.st, k = rest[ri] * 12, t = rest[ri + 1], ox = rest[ri + 2], oy = rest[ri + 3];
    for (let c = 0; c < 3; c++) {
      const p = st[k + c] + (st[k + 12 + c] - st[k + c]) * t;
      const sv = st[k + 3 + c] + (st[k + 15 + c] - st[k + 3 + c]) * t;
      const uv = st[k + 6 + c] + (st[k + 18 + c] - st[k + 6 + c]) * t;
      out[oi + c] = p + sv * ox + uv * oy;
    }
  }

  // 法线跟着截面一起转：世界法线 = 侧向 × 侧分量 + 上向 × 上分量 + 前向 × 前分量
  restNormal(rest, ri, out, oi) {
    const st = this.st, k = rest[ri] * 12, t = rest[ri + 1], ns = rest[ri + 4], nu = rest[ri + 5], nf = rest[ri + 6];
    for (let c = 0; c < 3; c++) {
      const sv = st[k + 3 + c] + (st[k + 15 + c] - st[k + 3 + c]) * t;
      const uv = st[k + 6 + c] + (st[k + 18 + c] - st[k + 6 + c]) * t;
      const tv = st[k + 9 + c] + (st[k + 21 + c] - st[k + 9 + c]) * t;
      out[oi + c] = sv * ns + uv * nu + tv * nf;
    }
  }

  anchor(a, v) { this.restToWorld(a, 0, _anc, 0); return v.set(_anc[0], _anc[1], _anc[2]); }

  /** 龙嘴在哪（没有模型就是龙头） @param {THREE.Vector3} v */
  mouth(v) { return this.model ? this.anchor(this.model.anchors.mouth, v) : v.copy(this.headPos); }

  /**
   * 龙身上随便一点（有模型取一个顶点，没有取一个截面中心）；tail 只从后 40% 取。
   * @param {THREE.Vector3} v @param {boolean} [tail] @returns {THREE.Vector3}
   */
  bodyPoint(v, tail = false) {
    if (this.model && this.geo) {
      const m = this.model, pos = this.geo.attributes.position.array;
      const j = (tail ? m.tail[Math.floor(Math.random() * m.tail.length)] : Math.floor(Math.random() * m.nv)) * 3;
      return v.set(pos[j], pos[j + 1], pos[j + 2]);
    }
    const k = Math.floor((tail ? 0.6 + Math.random() * 0.4 : Math.random()) * (STATIONS - 1)) * 12;
    return v.set(this.st[k], this.st[k + 1], this.st[k + 2]);
  }

  emit(...a) { /** @type {any} */ (this.o.p).emit(...a); }

  /** @param {number} dt @returns {boolean} 还要继续 */
  update(dt) {
    this.age += dt;
    const T = this.target, G = this.sig, pal = this.pal, o = this.o, plan = this.plan;

    // 法阵：亮起 → 旋转 → 龙出完后淡出
    const sk = Math.min(this.age / 0.35, 1), fade = 1 - THREE.MathUtils.clamp((this.age - 2.6) / 0.8, 0, 1);
    this.sigil.material.opacity = sk * fade; this.arcs.material.opacity = sk * fade * 0.8;
    this.sigil.scale.setScalar(Math.max(easeOutBack(sk), 0.001)); this.arcs.scale.copy(this.sigil.scale);
    this.sigil.rotation.z += dt * 0.8; this.arcs.rotation.z -= dt * 1.5;

    // 模型还在下载：法阵转着等，最多 3 秒；之后有模型就挂上，没有就不画龙身照样飞
    if (!this.started) {
      const look = o.lookFor(this.el);
      if (!look && o.busy > 0 && this.waitT < 3) { this.waitT += dt; this.chargeParticles(dt); return true; }
      this.started = true;
      if (look) this.attach(look);
      this.age = Math.min(this.age, 0.45);
    }
    if (this.age < 0.5) this.chargeParticles(dt);
    if (this.age > 0.45) this.s += plan.speed(this.s, this) * dt;
    if (this.follow && !this.impacted && this.s < this.sHit - 3) this.retarget(this.follow());

    // 沿龙身取截面：第 k 个截面在龙头身后 k/(N−1) × 龙身长处，再叠这条龙的摆法（越靠尾摆得越大）
    const st = this.st, N = STATIONS, sw = plan.sway;
    for (let k = 0; k < N; k++) {
      this.frameAt(this.s - (k / (N - 1)) * DRAGON_LEN, _p, _t);
      if (k === 0) { this.headPos.copy(_p); this.headT.copy(_t); this.headU.copy(_u); }
      const ph = this.age * sw.w - k * sw.k, amp = 0.3 + k / N;
      const side = sw.zig ? (2 / Math.PI) * Math.asin(Math.sin(ph)) : Math.sin(ph);
      _p.addScaledVector(_s, side * sw.side * amp).addScaledVector(_u, Math.cos(ph * 0.9) * sw.up * amp);
      const q = k * 12;
      st[q] = _p.x; st[q + 1] = _p.y; st[q + 2] = _p.z;
      st[q + 3] = _s.x; st[q + 4] = _s.y; st[q + 5] = _s.z;
      st[q + 6] = _u.x; st[q + 7] = _u.y; st[q + 8] = _u.z;
      st[q + 9] = _t.x; st[q + 10] = _t.y; st[q + 11] = _t.z;
    }
    this.tailPos.set(st[(N - 1) * 12], st[(N - 1) * 12 + 1], st[(N - 1) * 12 + 2]);
    // 路径变形：每个顶点 = 两个截面之间插值出的中心点 + 侧向 × 侧偏移 + 上向 × 上偏移；有法线的模型法线一起转
    const model = this.model;
    if (model && this.geo) {
      const rest = model.rest, attrs = this.geo.attributes, out = attrs.position.array;
      for (let i = 0, nv = model.nv; i < nv; i++) this.restToWorld(rest, i * REST, out, i * 3);
      attrs.position.needsUpdate = true;
      if (model.hasNormals && this.kind === 'summon') {
        const nout = attrs.normal.array;
        for (let i = 0, nv = model.nv; i < nv; i++) this.restNormal(rest, i * REST, nout, i * 3);
        attrs.normal.needsUpdate = true;
      }
    }
    const headPos = this.headPos, headT = this.headT, headU = this.headU;

    if (!this.emerged && headPos.y > G.y - 0.1) {                         // 破土瞬间
      this.emerged = true;
      o.fx.shake = Math.max(o.fx.shake, this.kind === 'ghost' ? 0.12 : 0.3);
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ringMat(col(pal.secondary, 2)));
      ring.rotation.x = -Math.PI / 2; ring.position.set(G.x, G.y + 0.06, G.z);
      o.fx.addTimed(ring, 0.9, (k) => { ring.scale.setScalar(0.01 + easeOutCubic(k) * 10); ring.material.uniforms.uAlpha.value = Math.pow(1 - k, 1.6) * 1.3; });
      for (let i = 0; i < 120; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 1.5;
        this.emit(G.x + Math.cos(a) * r, G.y + 0.1, G.z + Math.sin(a) * r, Math.cos(a) * rand(1, 3), rand(4, 10), Math.sin(a) * rand(1, 3),
          rand(0.6, 1.2), rand(0.06, 0.12), scaleArr(pal.secondary, 2.4), scaleArr(pal.primary, 1), { drag: 1.2, grav: -5 });
      }
      if (this.kind === 'summon' && this.el === 'ice') o.fx.frostShards(G, 10, 0.7);
    }

    if (this.kind === 'ghost') return this.updateGhost(dt);
    if (!this.tailUp && this.tailPos.y > G.y + 0.5) this.tailUp = true;

    if (this.emerged && !this.impacted) this.bodyParticles(dt);
    if (this.emerged && (!this.impacted || plan.pour !== 'in')) this.elementParticles(dt);
    if (plan.breath?.(this.s, this)) this.breathe(dt);

    // 雷龙：绕圈时过了劈雷的控制点就劈一道（从龙嘴劈下去，劈谁由 main 定）
    const strikes = plan.strikes;
    while (strikes && this.nextStrike < strikes.length && this.s >= this.knots[strikes[this.nextStrike]]) {
      this.hooks.strike?.(this.mouth(_m).clone(), this.nextStrike++);
    }

    // 护身：转的时候把龙身中线交给 main（打碎冰锥、撞敌人）
    if (this.hooks.tick && this.emerged && !this.impacted) this.hooks.tick(this.spine(), dt);

    // 光跟着龙头：照亮身体和地面。灯放在龙头上方 4.5 米、身后 1.5 米，否则近景龙头发白（两条同时飞时只跟一条）
    if (o.lit === this) {
      o.light.position.copy(headPos).addScaledVector(headU, 4.5).addScaledVector(headT, -1.5);
      o.light.intensity = this.emerged && (!this.impacted || plan.pour !== 'in') ? 22 : Math.max(o.light.intensity - dt * 60, 0);
    }

    const at = plan.pour === 'out' ? G : T;            // 土龙砸的是它钻出来的地方
    if (!this.impacted && this.s >= this.sHit) {
      this.impacted = true;
      this.impactFx(at);
      this.hooks.impact(at.clone());
    }
    if (this.impacted) {
      // 落点冒碎屑：冰龙（和从门洞俯冲的火龙）身体灌进地里时，土龙身体从地里钻出来时
      if ((plan.pour === 'in' && this.tailPos.y > at.y - 0.3) || (plan.pour === 'out' && this.tailPos.y < at.y)) {
        for (let i = perSec(300, dt); i > 0; i--) {
          const v = randDir(); v.y = Math.abs(v.y); v.multiplyScalar(rand(3, 9));
          this.emit(at.x, at.y + 0.2, at.z, v.x, v.y, v.z, rand(0.6, 1.2), rand(0.06, 0.12),
            scaleArr(pal.secondary, 2.4), scaleArr(pal.primary, 1), { drag: 1, grav: -6 });
        }
      }
      // 收场：龙尾出过地面又钻回去了（冰、土、门洞的火），或者整条飞完了曲线（飞回天上的火、雷、风）
      if ((this.tailUp && this.tailPos.y < G.y - 1.5 && this.tailPos.y < T.y - 1.5) || this.s - DRAGON_LEN > this.L - 0.5) { this.finish(); return false; }
    }
    return true;
  }

  /** 龙身表面的闪光、尾部的雾、两道龙须拖痕（颜色、往上飘还是往下掉看元素） @param {number} dt */
  bodyParticles(dt) {
    const pal = this.pal, grav = pal.emberGravity ?? 0, floor = Math.min(this.sig.y, this.target.y) + 0.1;
    for (let i = perSec(this.model ? 260 : 160, dt); i > 0; i--) {
      const q = this.bodyPoint(_b);
      if (q.y < floor) continue;
      const v = randDir().multiplyScalar(0.6);
      this.emit(q.x + v.x * 0.2, q.y + v.y * 0.2, q.z + v.z * 0.2, v.x, v.y + 0.3, v.z, rand(0.6, 1.2), rand(0.05, 0.1),
        scaleArr(pal.secondary, 2.4), scaleArr(pal.primary, 1.0), { drag: 1.2, grav });
    }
    for (let i = perSec(30, dt); i > 0; i--) {
      const q = this.bodyPoint(_b, true);
      if (q.y < floor) continue;
      this.emit(q.x, q.y, q.z, rand(-0.3, 0.3), rand(-0.2, 0.2), rand(-0.3, 0.3), rand(1, 1.6), rand(0.5, 0.9),
        scaleArr(pal.primary, 0.7), scaleArr(pal.secondary, 0.3), { alpha: 0.12, drag: 1 });
    }
    if (!this.model) return;
    for (const a of this.model.anchors.whiskers) {
      const w = this.anchor(a, _d);
      for (let i = perSec(120, dt); i > 0; i--) {
        this.emit(w.x, w.y, w.z, rand(-0.1, 0.1), rand(-0.1, 0.1), rand(-0.1, 0.1), 0.5, rand(0.035, 0.05),
          scaleArr(pal.secondary, 3), scaleArr(pal.primary, 1.2));
      }
    }
  }

  /** 各元素自己的：雷龙身上跳电弧，土龙往下掉碎石 @param {number} dt */
  elementParticles(dt) {
    const fx = this.o.fx, floor = Math.min(this.sig.y, this.target.y) + 0.3;
    if (this.el === 'thunder' && !this.impacted) {
      this.arcT -= dt;
      if (this.arcT <= 0) {
        this.arcT = rand(0.16, 0.3);
        const a = this.bodyPoint(new THREE.Vector3()), b = this.bodyPoint(new THREE.Vector3());
        if (a.y > floor && b.y > floor && a.distanceTo(b) < 6) fx.arc(a, b, { jitter: 0.3, forks: 0 });
      }
    } else if (this.el === 'earth') {
      for (let i = perSec(90, dt); i > 0; i--) {
        const q = this.bodyPoint(_b);
        if (q.y < floor) continue;
        this.emit(q.x, q.y, q.z, rand(-1, 1), rand(0, 1.5), rand(-1, 1), rand(0.8, 1.4), rand(0.07, 0.14),
          [0.55, 0.4, 0.26], [0.25, 0.18, 0.12], { drag: 0.3, grav: -9 });
      }
    }
  }

  /** 龙息：从龙嘴往前喷（down 往下压）；火龙喷到的地上每隔一段留一块焦痕 @param {number} dt */
  breathe(dt) {
    const pal = this.pal, m = this.mouth(_m), headT = this.headT, down = this.plan.down ?? 0;
    for (let i = perSec(500, dt); i > 0; i--) {
      const v = randDir().multiplyScalar(2.5).addScaledVector(headT, rand(8, 14));
      v.y -= down;
      this.emit(m.x, m.y, m.z, v.x, v.y, v.z, rand(0.35, 0.6), rand(0.1, 0.22),
        scaleArr(pal.core, 2.2), scaleArr(pal.secondary, 1.2), { drag: 2 });
    }
    if (this.el !== 'fire' || this.s - this.scorchAt < 1.8) return;
    this.scorchAt = this.s;
    const x = m.x + headT.x * 3, z = m.z + headT.z * 3, gy = this.o.fx.groundAt?.(x, z);
    if (gy === null || gy === undefined || m.y - gy > 9) return;
    this.o.fx.scorch(new THREE.Vector3(x, gy, z), rand(0.8, 1.1));
    for (let i = 0; i < 14; i++) {
      this.emit(x + rand(-0.6, 0.6), gy + 0.1, z + rand(-0.6, 0.6), rand(-0.5, 0.5), rand(1.5, 3.5), rand(-0.5, 0.5), rand(0.3, 0.6), rand(0.14, 0.24),
        [1.4, 0.55, 0.1], [0.35, 0.03, 0.005], { drag: 1.5, grav: 1.5, alpha: 0.5 });
    }
  }

  /** 龙影：升到半空、发光变淡，最后整条散掉 */
  updateGhost(dt) {
    const o = this.o, pal = this.pal;
    const end = 1.9;   // 升起后多久开始散
    const k = this.age < end ? 1 : Math.max(0, 1 - (this.age - end) / 0.4);
    o.glow.uniforms.uAlpha.value = 1.1 * k;
    o.ghostMat.opacity = 0.5 * k;
    if (o.lit === this) {
      o.light.position.copy(this.headPos).add(new THREE.Vector3(0, 3, 0));
      o.light.intensity = this.age < end + 0.4 ? 10 : 0;
    }
    if (this.age >= end && !this.impacted) {
      this.impacted = true;
      for (let i = 0; i < 700; i++) {
        const q = this.bodyPoint(_b);
        if (q.y < 0.1) continue;
        const v = randDir().multiplyScalar(rand(1, 4));
        this.emit(q.x, q.y, q.z, v.x, v.y, v.z, rand(0.6, 1.3), rand(0.05, 0.12),
          scaleArr(pal.secondary, 2.2), scaleArr(pal.primary, 1), { drag: 1.5, grav: -2 });
      }
      this.hooks.impact(this.target.clone());
    }
    if (this.age > end + 0.45) { this.finish(); return false; }
    return true;
  }

  /** 蓄力：元素碎屑沿地面旋入法阵中心 */
  chargeParticles(dt) {
    const G = this.sig, pal = this.pal;
    for (let i = perSec(320, dt); i > 0; i--) {
      const a = Math.random() * Math.PI * 2, r = rand(2.6, 3.4);
      const cx = Math.cos(a), cz = Math.sin(a);
      this.emit(G.x + cx * r, G.y + 0.08, G.z + cz * r, -cx * 4 - cz * 3, rand(0.2, 0.8), -cz * 4 + cx * 3, 0.45, rand(0.05, 0.1),
        scaleArr(pal.secondary, 2), scaleArr(pal.primary, 1.5), { drag: 0.6 });
    }
  }

  /** 砸中：大号爆炸 + 地面的雾；冰龙再加冰棱和一阵落雪。风龙、雷龙不砸（旋风、雷由 main 演） @param {THREE.Vector3} T */
  impactFx(T) {
    if (!this.plan.slam) return;
    const fx = this.o.fx, pal = this.pal;
    fx.burst(T, this.el, 4.5, 1.6);
    fx.impact(T, 1);
    fx.pulseDim(0.62, 1.2);
    fx.shake = Math.max(fx.shake, this.el === 'earth' ? 0.7 : 0.55);
    fx.hitStop = Math.max(fx.hitStop, 0.09);
    for (let i = 0; i < 50; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(3, 7);
      this.emit(T.x, T.y + 0.3, T.z, Math.cos(a) * sp, rand(0, 0.4), Math.sin(a) * sp, rand(1.2, 2), rand(0.8, 1.4),
        scaleArr(pal.primary, 0.9), scaleArr(pal.secondary, 0.25), { alpha: 0.12, drag: 1.4 });
    }
    if (this.el === 'ice') {
      fx.frostShards(T, 22, 1.4);
      let t = 0;
      fx.fx.push({
        update: (dt) => {
          t += dt;
          for (let i = perSec(110 * (1 - t / 4), dt); i > 0; i--) {
            this.emit(T.x + rand(-9, 9), T.y + rand(6, 9), T.z + rand(-7, 7), rand(-0.3, 0.3), rand(-1.4, -0.8), rand(-0.3, 0.3),
              rand(3, 5), rand(0.04, 0.07), [1.6, 1.9, 2.2], [0.5, 0.7, 1.0], { alpha: 0.8, drag: 0.2 });
          }
          return t < 4;
        },
        dispose() {},
      });
    }
  }

  /** 龙身中线上从头到尾隔一段取的点（截面中心，不带摆动后的模型表面） @returns {THREE.Vector3[]} */
  spine() {
    const pts = this.spinePts, n = pts.length;
    for (let i = 0; i < n; i++) {
      const k = Math.round((i / (n - 1)) * (STATIONS - 1)) * 12;
      pts[i].set(this.st[k], this.st[k + 1], this.st[k + 2]);
    }
    return pts;
  }

  finish() {
    if (this.done) return;
    this.done = true;
    const o = this.o, scene = o.fx.scene;
    for (const m of [this.body, this.glowMesh, this.sigil, this.arcs]) if (m) scene.remove(m);
    this.sigil.material.dispose(); this.arcs.material.dispose();
    this.geo?.dispose();
    if (o.lit === this) {   // 光交给还在演的那条
      o.lit = o.flights.find((f) => !f.done) ?? null;
      if (!o.lit) o.light.intensity = 0;
    }
  }
}
