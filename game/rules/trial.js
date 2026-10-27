// @ts-check
/**
 * 试炼模式的规则（纯函数，有单测）：boss 挨打怎么算冰甲、什么时候换阶段、下一招出什么、站在哪算被打中、玩家走到哪被挡住。
 * 数值全在 numbers.js 的 BOSS、TRIAL。画面和 boss 的动作在 game/modes/trial.js。
 */
import { BOSS } from './numbers.js';

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
 * 下一招。召唤优先（场上小傀儡不超过 keep 只、离上次召过了冷却）；玩家在扫得到的距离内多半横扫，远了砸红圈。
 * @param {number} phase 1～3
 * @param {{ dist: number, minions: number, sinceSummon: number }} s dist：boss 到玩家的距离
 * @param {number} roll 0～1 的随机数（测试里给定）
 * @returns {'slam' | 'sweep' | 'summon'}
 */
export function pickMove(phase, s, roll) {
  const sm = BOSS.summon;
  if (s.sinceSummon >= sm.cd * BOSS.pace[phase - 1] && s.minions <= sm.keep) return 'summon';
  if (s.dist <= BOSS.sweep.reach && roll < 0.6) return 'sweep';
  return 'slam';
}

/** 狂暴时红圈连砸两下（第二下落在玩家那时站的地方） @param {number} phase */
export const slamCount = (phase) => (phase >= 3 ? 2 : 1);

/** 这一招预警多久（秒），阶段越后越快 @param {'slam' | 'sweep' | 'summon'} move @param {number} phase */
export function teleSec(move, phase) {
  return BOSS[move].tele * BOSS.pace[phase - 1];
}

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
