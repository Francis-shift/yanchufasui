// @ts-check
/**
 * 试炼模式的规则（纯函数，有单测）：boss 挨打怎么算冰甲、什么时候换阶段、下一招出什么、站在哪算被打中、玩家走到哪被挡住、
 * 完美闪避、追踪冰锥怎么转弯、旋转弹幕朝哪喷。
 * 数值全在 numbers.js 的 BOSS、TRIAL。画面和 boss 的动作在 game/modes/trial.js。
 */
import { BOSS, RUN, TRIAL } from './numbers.js';

/** @typedef {'slam' | 'sweep' | 'summon' | 'homing' | 'spiral'} Move */

/**
 * 血量 → 第几阶段（1～3）：降到 70% 进第 2 阶段，降到 30% 进第 3 阶段（狂暴）。
 * @param {number} hp @param {number} max
 */
export function bossPhase(hp, max) {
  const k = hp / max;
  return k > BOSS.phases[0] ? 1 : k > BOSS.phases[1] ? 2 : 3;
}

/**
 * boss 挨一下：先照常由 damageTo 算出这一下，再按冰甲改。
 * 甲在时：火照常伤害、同时削甲（削穿就碎）；别的元素只剩 armoredMult，也冻不住。boss 太重，风推不动；麻痹最多 stunMax 秒。
 * 冻过一次、化开后 freezeGrace 秒内（freezeCd > 0）再冻不住。
 * @template {{ dmg: number, reaction: string, freezeSec: number, push: number, stunSec: number }} R
 * @param {{ armor: number, freezeCd: number }} b
 * @param {string} el
 * @param {R} r
 * @returns {{ r: R, armor: number, broke: boolean }}
 */
export function bossHit(b, el, r) {
  const out = { ...r, push: 0, stunSec: Math.min(r.stunSec, BOSS.stunMax) };
  let armor = b.armor, broke = false;
  if (armor > 0) {
    if (el === 'fire') {
      armor = Math.max(0, armor - r.dmg);
      broke = armor === 0;
      out.reaction = out.reaction || '融甲';
    } else {
      out.dmg = r.dmg * BOSS.armoredMult;
      out.reaction = out.reaction || '冰甲';
    }
    out.freezeSec = 0;
  }
  if (b.freezeCd > 0) out.freezeSec = 0;
  return { r: out, armor, broke };
}

/**
 * 下一招。召唤优先（场上小傀儡不超过 keep 只、离上次召过了冷却）；其余在这一阶段放得出的招里按分量随机：
 * 玩家离得远时不横扫；刚出过的那招不连着出（只剩一招时除外）。
 * @param {number} phase 1～3
 * @param {{ dist: number, minions: number, sinceSummon: number, last?: string }} s dist：boss 到玩家的距离；last：上一招
 * @param {number} roll 0～1 的随机数（测试里给定）
 * @returns {Move}
 */
export function pickMove(phase, s, roll) {
  const sm = BOSS.summon, pool = /** @type {Move[]} */ (BOSS.moves[phase - 1]);
  if (pool.includes('summon') && s.sinceSummon >= sm.cd * BOSS.pace[phase - 1] && s.minions <= sm.keep) return 'summon';
  let c = pool.filter((m) => m !== 'summon' && (m !== 'sweep' || s.dist <= BOSS.sweep.reach));
  if (c.length > 1) c = c.filter((m) => m !== s.last);
  const w = (/** @type {Move} */ m) => /** @type {any} */ (BOSS)[m].weight;
  let x = roll * c.reduce((a, m) => a + w(m), 0);
  for (const m of c) { x -= w(m); if (x < 0) return m; }
  return c[c.length - 1];
}

/** 狂暴时红圈连砸两下（第二下落在玩家那时站的地方） @param {number} phase */
export const slamCount = (phase) => (phase >= 3 ? 2 : 1);

/** 这一招预警多久（秒），阶段越后越快 @param {Move} move @param {number} phase */
export function teleSec(move, phase) {
  return BOSS[move].tele * BOSS.pace[phase - 1];
}

/**
 * 算不算完美闪避：招落下（或冰锥穿身）前 window 秒内才按的闪避，而且按的那一刻本来站在打得到的地方。
 * 早早走开不算。窗口默认 TRIAL.perfect.window，拿了心法「见切」放宽（rules/run.js runMods）。
 * @param {number} dashAgo 离上次按闪避过了几秒（没闪过给 Infinity） @param {boolean} wasInside 按闪避那一刻在不在范围里
 * @param {number} [win] 窗口（秒）
 */
export const isPerfect = (dashAgo, wasInside, win = TRIAL.perfect.window) => wasInside && dashAgo <= win;

/**
 * 精力（10-27 本人提议）：够 1 格、离上次按闪避过了 gap 秒才闪得出。
 * @param {number} stamina 现在几格（可以是小数，攒到一半） @param {number} sinceDash 离上次按闪避过了几秒（玩家的时间）
 */
export const canDash = (stamina, sinceDash) => stamina >= 1 && sinceDash >= TRIAL.dash.gap;

/** 精力回一帧：每 regen 秒回 1 格，不超过上限 @param {number} stamina @param {number} dt */
export const regenStamina = (stamina, dt) => Math.min(TRIAL.stamina.max, stamina + dt / TRIAL.stamina.regen);

/**
 * 追踪冰锥转一帧：速度方向朝目标转，每秒最多 turn 弧度，快慢不变。改的是 v 本身。
 * 转弯半径 = 速度 / turn：比闪避的距离大，贴脸时侧着一闪它就拐不过来。
 * @param {P} v 速度 @param {P} from 冰锥位置 @param {P} to 目标 @param {number} turn @param {number} dt
 */
export function homingTurn(v, from, to, turn, dt) {
  const sp = Math.hypot(v.x, v.z);
  if (sp < 1e-9) return v;
  const a = Math.atan2(v.z, v.x);
  let d = Math.atan2(to.z - from.z, to.x - from.x) - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  const na = a + Math.max(-turn * dt, Math.min(turn * dt, d));
  v.x = Math.cos(na) * sp; v.z = Math.sin(na) * sp;
  return v;
}

/** 旋转弹幕第 t 秒各条臂朝哪（弧度，从 +x 往 +z 量） @param {number} t @param {number} arms @param {number} a0 起始角 */
export const spiralAngles = (t, arms, a0) => Array.from({ length: arms }, (_, i) => a0 + t * BOSS.spiral.spin + (i * 2 * Math.PI) / arms);

/** 出完一招喘多久（秒） @param {number} phase @param {number} roll 0～1 */
export function recoverSec(phase, roll) {
  const [a, b] = BOSS.recover;
  return (a + (b - a) * roll) * BOSS.pace[phase - 1];
}

/** @typedef {{ x: number, z: number }} P */

/** 站在红圈里吗（body：身体半径，碰到圈边就算） @param {P} p @param {P} c @param {number} r @param {number} [body] */
export function inCircle(p, c, r, body = 0) {
  return (p.x - c.x) ** 2 + (p.z - c.z) ** 2 <= (r + body) ** 2;
}

/**
 * 站在扇形里吗：圆心 o、朝向 dir（单位向量）、半角 half（弧度）、半径 r。
 * 身体半径 body 只加在半径上；角度按身体中心算。
 * @param {P} p @param {P} o @param {P} dir @param {number} half @param {number} r @param {number} [body]
 */
export function inSector(p, o, dir, half, r, body = 0) {
  const x = p.x - o.x, z = p.z - o.z, d = Math.hypot(x, z);
  if (d > r + body) return false;
  if (d < 1e-6) return true;
  return (x * dir.x + z * dir.z) / d >= Math.cos(half);
}

/**
 * 只能在广场上走：撞进障碍就推到障碍边上，出了圈就拉回圈里。改的是 p 本身。
 * @param {P} p @param {{ x: number, z: number, r: number }[]} obstacles @param {number} R 能走的半径 @param {number} [body] 身体半径
 */
export function keepInArena(p, obstacles, R, body = 0.35) {
  for (const o of obstacles) {
    const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), min = o.r + body;
    if (d >= min) continue;
    if (d < 1e-6) { p.x = o.x + min; continue; }
    p.x = o.x + (dx / d) * min; p.z = o.z + (dz / d) * min;
  }
  const d = Math.hypot(p.x, p.z);
  if (d > R) { p.x *= R / d; p.z *= R / d; }
  return p;
}

/**
 * 小怪潮的下一批：冒几只（batch 区间里随机，不超过还剩的）、再过几秒冒下一批（gap 区间里随机）。
 * @param {number} left 这一段还剩几只没冒 @param {() => number} rnd
 */
export function nextBatch(left, rnd) {
  const [a, b] = RUN.wave.batch, [g0, g1] = RUN.wave.gap;
  return { n: Math.min(left, a + Math.floor(rnd() * (b - a + 1))), gap: g0 + rnd() * (g1 - g0) };
}

/**
 * 小傀儡冒在哪：广场上均匀随机一点（不在障碍里），离玩家至少 away 米；试 12 次都太近，就取试过的里面离玩家最远的。
 * @param {() => number} rnd @param {P} me 玩家 @param {number} R 能走的半径 @param {number} away
 * @param {{ x: number, z: number, r: number }[]} obstacles
 * @returns {P}
 */
export function spawnSpot(rnd, me, R, away, obstacles) {
  let best = { x: 0, z: 0 }, far = -1;
  for (let i = 0; i < 12; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R;
    const p = keepInArena({ x: Math.cos(a) * r, z: Math.sin(a) * r }, obstacles, R, 0.3);
    const d = Math.hypot(p.x - me.x, p.z - me.z);
    if (d >= away) return p;
    if (d > far) { best = p; far = d; }
  }
  return best;
}
