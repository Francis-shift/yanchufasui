// @ts-check
/**
 * 试炼模式的规则（纯函数，有单测）：boss 挨打怎么算冰甲、什么时候换阶段、下一招出什么、站在哪算被打中、玩家走到哪被挡住、
 * 完美闪避、追踪冰锥怎么转弯、旋转弹幕朝哪喷；石甲巨像的落石落在哪、地刺朝哪几个方向、地刺冒到人没有；
 * 火灵的火圈落在哪（同落石）、火环和火浪扫到人没有；
 * 小怪潮冒几只、冒在哪、冒哪种，符箓傀儡往哪挪，铁头傀儡冲多远、冲到谁。
 * 数值全在 numbers.js 的 BOSS（寒甲傀儡王，也是各个 boss 共用的换阶段、快慢）、STONE（石甲巨像）、FLAME（火灵）、TRIAL、RUN、MINION。
 * 画面和 boss 的动作在 game/modes/trial.js。
 */
import { BOSS, FLAME, MINION, RUN, STONE, TRIAL } from './numbers.js';
import { waveHalfW } from './fusion.js';

/** @typedef {'slam' | 'sweep' | 'summon' | 'homing' | 'spiral' | 'rocks' | 'charge' | 'spikes' | 'pyre' | 'nova' | 'wave'} Move */
/** 哪个 boss 的招式表（BOSS 寒甲傀儡王、STONE 石甲巨像、FLAME 火灵） @typedef {typeof BOSS | typeof STONE | typeof FLAME} BossCfg */

/**
 * 血量 → 第几阶段（1～3）：降到 70% 进第 2 阶段，降到 30% 进第 3 阶段（狂暴）。
 * @param {number} hp @param {number} max
 */
export function bossPhase(hp, max) {
  const k = hp / max;
  return k > BOSS.phases[0] ? 1 : k > BOSS.phases[1] ? 2 : 3;
}

/**
 * boss 挨一下：先照常由 damageTo 算出这一下，再按甲改（寒甲傀儡王的冰甲只怕火，石甲巨像的石甲只怕雷：cfg.weak）。
 * 甲在时：怕的那种元素照常伤害、同时削甲（削穿就碎）；别的元素只剩 armoredMult，也冻不住。boss 太重，风推不动；麻痹最多 stunMax 秒。
 * 冻过一次、化开后 freezeGrace 秒内（freezeCd > 0）再冻不住。
 * 字诀「破」（po）：甲在时伤害 × RUN.runes.po、不打折，什么元素都照常削甲（削掉的按翻倍前算）。
 * @template {{ dmg: number, reaction: string, freezeSec: number, push: number, stunSec: number }} R
 * @param {{ armor: number, freezeCd: number }} b
 * @param {string} el
 * @param {R} r
 * @param {boolean} [po]
 * @param {BossCfg} [cfg]
 * @returns {{ r: R, armor: number, broke: boolean }}
 */
export function bossHit(b, el, r, po = false, cfg = BOSS) {
  const out = { ...r, push: 0, stunSec: Math.min(r.stunSec, BOSS.stunMax) };
  let armor = b.armor, broke = false;
  if (armor > 0) {
    if (el === cfg.weak || po) {
      armor = Math.max(0, armor - r.dmg);
      broke = armor === 0;
      out.reaction = out.reaction || (po ? '破甲' : cfg.weakText);
      if (po) out.dmg = r.dmg * RUN.runes.po;
    } else {
      out.dmg = r.dmg * cfg.armoredMult;
      out.reaction = out.reaction || cfg.armorName;
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
 * @param {BossCfg} [cfg] 哪个 boss
 * @returns {Move}
 */
export function pickMove(phase, s, roll, cfg = BOSS) {
  const sm = cfg.summon, pool = /** @type {Move[]} */ (cfg.moves[phase - 1]);
  if (pool.includes('summon') && s.sinceSummon >= sm.cd * BOSS.pace[phase - 1] && s.minions <= sm.keep) return 'summon';
  let c = pool.filter((m) => m !== 'summon' && (m !== 'sweep' || s.dist <= BOSS.sweep.reach));
  if (c.length > 1) c = c.filter((m) => m !== s.last);
  const w = (/** @type {Move} */ m) => /** @type {any} */ (cfg)[m].weight;
  let x = roll * c.reduce((a, m) => a + w(m), 0);
  for (const m of c) { x -= w(m); if (x < 0) return m; }
  return c[c.length - 1];
}

/** 狂暴时红圈连砸两下（第二下落在玩家那时站的地方） @param {number} phase */
export const slamCount = (phase) => (phase >= 3 ? 2 : 1);

/**
 * 这一招预警多久（秒），阶段越后越快（× pace）；按阶段单写了的（石甲巨像的蓄力冲撞，要留出打断的时间）就照写的
 * @param {Move} move @param {number} phase @param {BossCfg} [cfg]
 */
export function teleSec(move, phase, cfg = BOSS) {
  const t = /** @type {any} */ (cfg)[move].tele;
  return Array.isArray(t) ? t[phase - 1] : t * BOSS.pace[phase - 1];
}

/**
 * 石甲巨像落石雨的落点：第一块对准玩家此刻站的地方，其余落在玩家 spread 米内随机（拉回广场里、推出障碍），
 * 块与块至少隔 apart 米（挑 20 次都隔不开就用最后一次挑的）。
 * @param {P} me @param {number} n @param {() => number} rnd @param {{ x: number, z: number, r: number }[]} obstacles @param {number} R
 * @returns {P[]}
 */
export function rockSpots(me, n, rnd, obstacles, R) {
  const S = STONE.rocks, out = [keepInArena({ x: me.x, z: me.z }, obstacles, R, 0)];
  while (out.length < n) {
    let p = out[0];
    for (let k = 0; k < 20; k++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * S.spread;
      p = keepInArena({ x: me.x + Math.cos(a) * r, z: me.z + Math.sin(a) * r }, obstacles, R, 0);
      if (out.every((q) => Math.hypot(p.x - q.x, p.z - q.z) >= S.apart)) break;
    }
    out.push(p);
  }
  return out;
}

/**
 * 火灵满场火圈的位置：第一个对准玩家此刻站的地方，其余在整个广场里均匀随机（推出障碍），圈与圈至少隔 apart 米。
 * 和落石不同，挑 30 次都隔不开就少放一个：圈挤在一起，人从脚下那个圈走出来会踩进隔壁的。
 * @param {P} me @param {number} n @param {() => number} rnd @param {{ x: number, z: number, r: number }[]} obstacles @param {number} R
 * @returns {P[]}
 */
export function pyreSpots(me, n, rnd, obstacles, R) {
  const S = FLAME.pyre, out = [keepInArena({ x: me.x, z: me.z }, obstacles, R, 0)];
  for (let i = 1; i < n; i++) {
    for (let k = 0; k < 30; k++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R;
      const p = keepInArena({ x: Math.cos(a) * r, z: Math.sin(a) * r }, obstacles, R, 0);
      if (out.every((q) => Math.hypot(p.x - q.x, p.z - q.z) >= S.apart)) { out.push(p); break; }
    }
  }
  return out;
}

/** 一线地刺朝哪几个方向：一道就朝 dir；狂暴时三道，左右各偏 fanDeg 度 @param {P} dir 单位向量 @param {number} n @returns {P[]} */
export function spikeDirs(dir, n) {
  const a0 = Math.atan2(dir.z, dir.x), f = (STONE.spikes.fanDeg * Math.PI) / 180;
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + (i - (n - 1) / 2) * f;
    return { x: Math.cos(a), z: Math.sin(a) };
  });
}

/**
 * 地刺这一帧从 f0 冒到 f1（离起点多远），冒到站在 p 的人没有：人在这一道的宽度里（w，身体半径 body 加在宽度上），
 * 而且身体（顺着这一道量，前后各 body）跟这一帧冒出来的那一段有重叠。
 * @param {P} p @param {P} from 起点 @param {P} dir 单位向量 @param {number} f0 @param {number} f1 @param {number} w @param {number} [body]
 */
export function spikeReach(p, from, dir, f0, f1, w, body = 0) {
  const x = p.x - from.x, z = p.z - from.z, along = x * dir.x + z * dir.z, side = Math.abs(x * dir.z - z * dir.x);
  return side <= w / 2 + body && along + body > f0 && along - body <= f1;
}

/**
 * 火灵火环的缺口：偏开玩家此刻的方向（aim，弧度）gapOff 度区间里随机一个角度、随机往左或往右；半角 gapDeg 的一半。
 * 缺口不会正对着人，站着不动躲不掉。连放的第二圈给上一圈的缺口 prev：缺口换到人的另一侧，躲进第一个缺口的人还得再动。
 * @param {number} aim @param {() => number} rnd @param {number | null} [prev] @returns {{ a: number, half: number }}
 */
export function novaGap(aim, rnd, prev = null) {
  const N = FLAME.nova, [o0, o1] = N.gapOff, off = ((o0 + (o1 - o0) * rnd()) * Math.PI) / 180;
  const side = prev === null ? (rnd() < 0.5 ? -1 : 1) : Math.sin(prev - aim) > 0 ? -1 : 1;
  return { a: aim + side * off, half: (N.gapDeg * Math.PI) / 360 };
}

/**
 * 火灵的火环这一帧从半径 f0 推到 f1（以 c 为圆心），推到站在 p 的人没有：身体（半径 body）跟这一帧扫过的那一圈有重叠，
 * 而且不在缺口里（缺口朝 gap.a 弧度、半角 gap.half；整个身子都在缺口的角度里才算躲开）。
 * @param {P} p @param {P} c @param {number} f0 @param {number} f1 @param {number} [body] @param {{ a: number, half: number } | null} [gap]
 */
export function ringReach(p, c, f0, f1, body = 0, gap = null) {
  const x = p.x - c.x, z = p.z - c.z, d = Math.hypot(x, z);
  if (!(d + body > f0 && d - body <= f1)) return false;
  if (!gap || d < 1e-6) return true;
  const a = Math.atan2(z, x) - gap.a;
  return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) + Math.asin(Math.min(1, body / d)) > gap.half;
}

/**
 * 火灵的火浪（形状同豪火灭却：从 from 朝 dir 推 BEAM.len 米，越远越宽）这一帧浪头从 f0 推到 f1，推到站在 p 的人没有：
 * 身体（顺着浪量，前后各 body）跟这一帧推过的那一段有重叠，而且在那里的宽度里（身体半径加在半宽上）。
 * @param {P} p @param {P} from @param {P} dir 单位向量 @param {number} f0 @param {number} f1 @param {number} [body]
 */
export function waveReach(p, from, dir, f0, f1, body = 0) {
  const x = p.x - from.x, z = p.z - from.z, along = x * dir.x + z * dir.z, side = Math.abs(x * dir.z - z * dir.x);
  return along + body > f0 && along - body <= f1 && side <= waveHalfW(along) + body;
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

/**
 * 小怪潮的下一只是哪种：按这一段的分量抽；某种已经到了同时上限（场上连同冒烟的算），就不抽它，都抽不到就是小傀儡。
 * @param {Record<string, number>} mix 这一段各种的分量 @param {Record<string, number>} alive 每种现在有几只
 * @param {Record<string, number>} cap 每种同时最多几只（没写的不限） @param {() => number} rnd
 */
export function pickMinion(mix, alive, cap, rnd) {
  const ok = Object.entries(mix).filter(([k, w]) => w > 0 && (alive[k] ?? 0) < (cap[k] ?? Infinity));
  const sum = ok.reduce((a, [, w]) => a + w, 0);
  let x = rnd() * sum;
  for (const [k, w] of ok) if ((x -= w) < 0) return k;
  return 'grunt';
}

/**
 * 符箓傀儡这一刻怎么挪：离玩家比 keep 远就靠近（1）、比 keep 近就后退（-1）、在区间里横着挪（0）。
 * @param {number} d 离玩家多远 @param {number[]} [keep]
 */
export const archerIntent = (d, keep = MINION.archer.keep) => (d > keep[1] ? 1 : d < keep[0] ? -1 : 0);

/**
 * 铁头傀儡从 from 朝 dir（单位向量）最多冲多远：每 0.1 米量一次，身体（半径 body）碰到障碍、出了广场（半径 R）就停在前一步。
 * @param {P} from @param {P} dir @param {{ x: number, z: number, r: number }[]} obstacles @param {number} R @param {number} max @param {number} [body]
 */
export function chargeLen(from, dir, obstacles, R, max, body = 0.4) {
  const step = 0.1;
  for (let s = step; s <= max + 1e-9; s += step) {
    const x = from.x + dir.x * s, z = from.z + dir.z * s;
    if (Math.hypot(x, z) > R || obstacles.some((o) => (x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + body) ** 2)) return Math.max(0, s - step);
  }
  return max;
}

/**
 * 站在铁头傀儡要冲的那条红条里吗：从 from 朝 dir 长 len、宽 w 的长条（身体半径 body 加在宽度和两头上）。
 * @param {P} p @param {P} from @param {P} dir @param {number} len @param {number} w @param {number} [body]
 */
export function inStrip(p, from, dir, len, w, body = 0) {
  const x = p.x - from.x, z = p.z - from.z, along = x * dir.x + z * dir.z, side = Math.abs(x * dir.z - z * dir.x);
  return along >= -body && along <= len + body && side <= w / 2 + body;
}
