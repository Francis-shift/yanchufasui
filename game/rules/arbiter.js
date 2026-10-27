// @ts-check
/**
 * 裁决器：把清洗过的法术意图变成"这一发到底花多少、打多疼、打谁"。
 * 全部是纯函数（不碰画面、不读时间、不用随机数），所以能逐条写单测；
 * 会影响胜负的数字只在这里算，模型说"威力 999"也只按上限算。
 */
import {
  BOLT_COUNT_MAX, COMBO_DISCOUNT, ELEMENTS, ENEMIES, FIRST_DISCOVERY_MULT, FORMS, FUSION_DMG_MULT, FUSION_OPEN, FUSIONS,
  MANA_MAX, MANA_REGEN, MOMENTUM_MULT, MOMENTUM_RANGE, POWER_DEFAULT, REACTIONS, REPEAT_DECAY, SUMMON_OPEN, SUMMONS,
  ULT_GAUGE, boltCostFactor, boltTotalDmgFactor, powerFactor,
} from './numbers.js';

/** 「同一句话」的判定：去掉标点和空格后完全相同 */
export function sentenceKey(text) {
  return String(text).replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
}

/** @param {{ form: string, power: number, count: number }} s */
export function stepCost(s) {
  return FORMS[s.form].cost * powerFactor(s.power) * (s.form === 'bolt' ? boltCostFactor(s.count) : 1);
}

/** @param {{ form: string, power: number, count: number }[]} steps */
export function totalCost(steps) {
  const sum = steps.reduce((a, s) => a + stepCost(s), 0);
  return Math.round(sum * (steps.length > 1 ? COMBO_DISCOUNT : 1));
}

/**
 * @typedef {import('./intent.js').Intent} Intent
 * @typedef {import('./intent.js').Step} Step
 * @typedef {{ mana: number, lastCombo?: { key: string, streak: number } | null,
 *             seen?: Iterable<string>, said?: Iterable<string>, text?: string, gauge?: number, ult?: number, button?: boolean,
 *             fusions?: string[] }} CastContext
 *   button：按天赋按钮放的——不按描写加气势槽（按键的气势看打法，见 talents.js buttonGaugeGain）
 *   ult：召龙要几格气势（默认 ULT_GAUGE；试炼拿了心法「龙吟」变少，见 run.js runMods）
 *   fusions：能合成哪些融合（默认 FUSION_OPEN；试炼里只有领悟了的合字，见 run.js runFusions）
 * @typedef {Step & { cost: number, dmgTotal: number, dmgEach: number, first: boolean, repeat: number,
 *             fusion?: string, fusionName?: string, idiom?: string }} PlannedStep fusion 是融合的键（如 wind>fire）
 * @typedef {{ el: string, name: string, target: string, dmg: number, radius: number, cast: boolean, ghost: boolean,
 *             first?: boolean }} SummonPlan cast = 真召出来了；ghost = 差一口气，只演龙影（法术已换成 steps 里的雨）
 * @typedef {{ ok: boolean, steps: PlannedStep[], cost: number, momentum: number, momentumHalved: boolean,
 *             downgrades: string[], backlash: boolean, gaugeGain: number, gaugeSpent?: boolean, summon?: SummonPlan,
 *             lastCombo: { key: string, streak: number } | null, newlySeen: string[], saidKey: string }} CastPlan
 */

/**
 * 规划一次施法：气势（同句减半）→ 消耗（组合八折）→ 法力不够就降级 → 每步伤害。
 * 降级顺序：先把威力最高的一步降 1（直到全是 1）→ 再减弹的颗数 → 再去掉最后一步 → 还不够就哑火（不扣法力）。
 * @param {Intent} intent
 * @param {CastContext} ctx
 * @returns {CastPlan}
 */
export function planCast(intent, ctx) {
  if (intent.summon) return planSummon(intent, ctx);
  const said = new Set(ctx.said || []);
  const seen = new Set(ctx.seen || []);
  const saidKey = sentenceKey(ctx.text || '');
  let momentum = intent.momentum;
  let momentumHalved = false;
  if (saidKey && said.has(saidKey) && momentum > 0) { momentum = Math.floor(momentum / 2); momentumHalved = true; }

  /** @type {string[]} */
  const downgrades = [];
  const steps = intent.steps.map((s) => ({ ...s }));
  while (steps.length && totalCost(steps) > ctx.mana) {
    let k = -1;
    for (let i = 0; i < steps.length; i++) if (steps[i].power > 1 && (k < 0 || steps[i].power >= steps[k].power)) k = i;
    if (k >= 0) {
      steps[k].power -= 1;
      downgrades.push(`法力不足，${label(steps[k])}威力降为 ${steps[k].power}`);
      continue;
    }
    const b = steps.findLastIndex((s) => s.form === 'bolt' && s.count > 1);
    if (b >= 0) {
      steps[b].count -= 1;
      downgrades.push(`法力不足，${label(steps[b])}减为 ${steps[b].count} 颗`);
      continue;
    }
    const gone = steps.pop();
    if (gone) downgrades.push(`法力不足，去掉了${label(gone)}`);
  }
  const ok = steps.length > 0;
  if (!ok && intent.steps.length) downgrades.push('法力不足，哑火（不扣法力）');

  let lastCombo = ctx.lastCombo || null;
  /** @type {string[]} */
  const newlySeen = [];
  /** @type {PlannedStep[]} */
  const planned = [];
  const mm = MOMENTUM_MULT[Math.max(0, Math.min(MOMENTUM_MULT.length - 1, momentum))];
  for (const s of steps) {
    const key = `${s.el}+${s.form}`;
    const streak = lastCombo && lastCombo.key === key ? lastCombo.streak + 1 : 0;
    lastCombo = { key, streak };
    const repeat = REPEAT_DECAY ** streak;
    const first = !seen.has(key);
    if (first) { seen.add(key); newlySeen.push(key); }
    const base = FORMS[s.form].dmg * (s.form === 'bolt' ? boltTotalDmgFactor(s.count) : 1);
    const dmgTotal = base * ELEMENTS[s.el].mult * powerFactor(s.power) * mm * repeat * (first ? FIRST_DISCOVERY_MULT : 1);
    planned.push({ ...s, cost: Math.round(stepCost(s)), dmgTotal, dmgEach: s.form === 'bolt' ? dmgTotal / s.count : dmgTotal,
      first, repeat });
  }
  fuse(planned, seen, newlySeen, ctx.fusions);
  return {
    ok, steps: planned, cost: ok ? totalCost(steps) : 0, momentum, momentumHalved, downgrades,
    backlash: intent.overreach, gaugeGain: ok && !ctx.button ? momentum : 0,
    lastCombo, newlySeen, saidKey,
  };
}

/** @param {{ el: string, form: string }} s */
const label = (s) => ELEMENTS[s.el].name + FORMS[s.form].name;

/**
 * 召唤：气势槽满、法力够、这条龙已开放，三样都满足才召得出；召出后气势槽清零。
 * 差一样就"差一口气"：龙影现身又散去，化作同元素的雨（照雨的规矩扣法力、可降级），咒语卡写明差在哪。
 * 龙俯冲砸向这句话第一步说的目标（没说就砸最密集的一群）；伤害吃气势倍数和首次发现加成，范围随气势变大。
 * @param {Intent} intent
 * @param {CastContext} ctx
 * @returns {CastPlan}
 */
function planSummon(intent, ctx) {
  const el = /** @type {keyof typeof SUMMONS} */ (intent.summon);
  const spec = SUMMONS[el];
  const target = intent.steps[0]?.target || 'densest';
  const gauge = ctx.gauge ?? 0, ult = ctx.ult ?? ULT_GAUGE;
  const why = !SUMMON_OPEN.includes(el) ? `${spec.name}尚未现世`
    : gauge < ult ? `气势 ${gauge}/${ult}，${spec.name}未至`
    : ctx.mana < spec.cost ? `法力不足，${spec.name}未至` : '';
  if (why) {
    const rest = { ...intent, summon: null };
    if (el in ELEMENTS) {
      // 化作同元素的雨，落在同一个目标上
      rest.steps = [{ el, form: 'rain', target, power: POWER_DEFAULT, count: 1, path: 'sky', words: {} }];
    }
    const plan = planCast(rest, ctx);
    const into = el in ELEMENTS && plan.ok ? `，化作${ELEMENTS[el].name}雨` : '';
    return { ...plan, downgrades: [why + into, ...plan.downgrades], summon: { el, name: spec.name, target, dmg: 0, radius: 0, cast: false, ghost: SUMMON_OPEN.includes(el) && plan.ok } };
  }
  const said = new Set(ctx.said || []);
  const saidKey = sentenceKey(ctx.text || '');
  let momentum = intent.momentum, momentumHalved = false;
  if (saidKey && said.has(saidKey) && momentum > 0) { momentum = Math.floor(momentum / 2); momentumHalved = true; }
  const seenKey = `召唤:${el}`;
  const first = !new Set(ctx.seen || []).has(seenKey);
  const dmg = spec.dmg * MOMENTUM_MULT[Math.min(MOMENTUM_MULT.length - 1, momentum)] * (first ? FIRST_DISCOVERY_MULT : 1);
  return {
    ok: true, steps: [], cost: spec.cost, momentum, momentumHalved, downgrades: [], backlash: intent.overreach,
    gaugeGain: 0, gaugeSpent: true, lastCombo: null, newlySeen: first ? [seenKey] : [], saidKey,
    summon: { el, name: spec.name, target, dmg, radius: spec.radius * MOMENTUM_RANGE[Math.min(MOMENTUM_RANGE.length - 1, momentum)], cast: true, ghost: false, first },
  };
}

/**
 * 融合：找第一对相邻、元素不同、目标相同、且在开放融合表里的两步，合成一步（一句最多融合一次）。
 * 合成后的一步按"爆"的样子结算范围（具体怎么演由 fusion 键决定），伤害 = 两步之和 × 1.2，
 * 第一次用出这种融合再 × 1.2（图鉴单独一格）。消耗不变：总价本来就是两步之和打八折。
 * @param {PlannedStep[]} planned 会被就地修改
 * @param {Set<string>} seen @param {string[]} newlySeen @param {string[]} [open] 能合成的融合（试炼里是领悟了的合字）
 */
export function fuse(planned, seen, newlySeen, open = FUSION_OPEN) {
  for (let i = 0; i + 1 < planned.length; i++) {
    const a = planned[i], b = planned[i + 1];
    const key = `${a.el}>${b.el}`;
    if (a.el === b.el || a.target !== b.target || !open.includes(key)) continue;
    const f = FUSIONS[/** @type {keyof typeof FUSIONS} */ (key)];
    const seenKey = `融合:${key}`;
    const first = !seen.has(seenKey);
    if (first) { seen.add(seenKey); newlySeen.push(seenKey); }
    const dmgTotal = (a.dmgTotal + b.dmgTotal) * FUSION_DMG_MULT * (first ? FIRST_DISCOVERY_MULT : 1);
    planned.splice(i, 2, {
      ...a, el: f.el, form: 'burst', count: 1, path: 'straight', power: Math.max(a.power, b.power),
      words: { ...a.words, ...b.words }, cost: a.cost + b.cost, dmgTotal, dmgEach: dmgTotal, first, repeat: 1,
      fusion: key, fusionName: f.name, idiom: f.idiom,
    });
    return;
  }
}

/** 法力恢复；mult 是回复倍数（试炼拿了心法「回元」） @param {number} mana @param {number} dt @param {number} [mult] */
export function regenMana(mana, dt, mult = 1) {
  return Math.min(MANA_MAX, mana + MANA_REGEN * mult * dt);
}

/**
 * 语义目标 → 具体打谁。方位按屏幕说（镜头固定，屏幕左 ≈ 世界 −x）。
 * @typedef {{ id: string, x: number, z: number, hp: number, distToCore: number }} EnemyView
 * @param {string} target
 * @param {EnemyView[]} enemies 活着的敌人
 * @param {{ count?: number, caster?: { x: number, z: number }, objects?: Record<string, { x: number, z: number }>,
 *           sideX?: number, clusterR?: number }} [opt]
 * @returns {{ ids: string[], point: { x: number, z: number } | null }}
 */
export function resolveTarget(target, enemies, opt = {}) {
  const n = Math.max(1, Math.min(BOLT_COUNT_MAX, opt.count || 1));
  const sideX = opt.sideX ?? 1.5, R = opt.clusterR ?? 3;
  const byFront = [...enemies].sort((a, b) => a.distToCore - b.distToCore || a.id.localeCompare(b.id));
  const pick = (list) => {
    const ids = list.slice(0, n).map((e) => e.id);
    const head = list[0];
    return { ids, point: head ? { x: head.x, z: head.z } : null };
  };
  if (opt.objects && target in opt.objects) {
    const o = opt.objects[target];
    return { ids: [], point: { x: o.x, z: o.z } };
  }
  switch (target) {
    case 'self': return { ids: [], point: opt.caster ? { ...opt.caster } : null };
    case 'strongest': return pick([...byFront].sort((a, b) => b.hp - a.hp || a.distToCore - b.distToCore));
    case 'left': return pick(byFront.filter((e) => e.x < -sideX));
    case 'right': return pick(byFront.filter((e) => e.x > sideX));
    case 'center': return pick(byFront.filter((e) => Math.abs(e.x) <= sideX));
    case 'densest': {
      let best = null, bestN = -1;
      for (const e of byFront) {
        const near = byFront.filter((o) => (o.x - e.x) ** 2 + (o.z - e.z) ** 2 <= R * R);
        if (near.length > bestN) { bestN = near.length; best = near; }
      }
      if (!best) return { ids: [], point: null };
      const cx = best.reduce((a, e) => a + e.x, 0) / best.length, cz = best.reduce((a, e) => a + e.z, 0) / best.length;
      return { ids: best.slice(0, n).map((e) => e.id), point: { x: cx, z: cz } };
    }
    default: return pick(byFront);
  }
}

/**
 * 一次命中对一个敌人造成多少伤害、附加什么效果。反应只在这里判断。
 * @param {{ type: string, frozen: boolean, lastEl?: string }} enemy
 * @param {{ el: string, dmg: number, fromAbove?: boolean, fromBehind?: boolean }} hit
 * @returns {{ dmg: number, reaction: string, freezeSec: number, burnSec: number, unfreeze: boolean, push: number, aoeBonus: number,
 *             stunSec: number }}
 */
export function damageTo(enemy, hit) {
  const spec = ENEMIES[enemy.type] || ENEMIES.grunt;
  let dmg = hit.dmg, reaction = '', unfreeze = false, aoeBonus = 0;
  if (enemy.frozen && hit.el === 'fire') {
    reaction = REACTIONS['ice+fire'].name; unfreeze = true; aoeBonus = REACTIONS['ice+fire'].bonusAoe;
  } else if (enemy.frozen && hit.el === 'wind') {
    reaction = REACTIONS['ice+wind'].name; dmg *= REACTIONS['ice+wind'].frozenMult;
  } else if (enemy.frozen) {
    dmg *= ELEMENTS.ice.frozenTakenMult;
    if (hit.el === 'thunder') reaction = REACTIONS['ice+thunder'].name;   // 导电：连锁在冻住的之间不衰减（见 chainTargets）
  }
  if ('frontReduce' in spec && !hit.fromAbove && !hit.fromBehind) dmg *= 1 - spec.frontReduce;
  const freezeSec = hit.el === 'ice' ? ELEMENTS.ice.freezeSec * ('freezeMult' in spec ? spec.freezeMult : 1) : 0;
  const burnSec = hit.el === 'fire' ? ELEMENTS.fire.burnSec : 0;
  const push = hit.el === 'wind' ? ELEMENTS.wind.push : 0;
  const stunSec = hit.el === 'thunder' ? ELEMENTS.thunder.stunSec : 0;
  return { dmg, reaction, freezeSec, burnSec, unfreeze, push, aoeBonus, stunSec };
}

/**
 * 雷的连锁：从被打中的敌人跳向 range 米内最近、这一下还没打过的敌人，最多跳 jumps 次；
 * 每跳伤害 × decay，但从冻住的跳到冻住的不衰减（导电）。返回按跳的先后排的落点。
 * @param {string} fromId 先被打中的那只
 * @param {{ id: string, x: number, z: number, frozen?: boolean }[]} enemies 活着的敌人
 * @param {number} dmg 先被打中那一下的伤害（结算前）
 * @returns {{ id: string, from: string, dmg: number, conduct: boolean }[]}
 */
export function chainTargets(fromId, enemies, dmg) {
  const { jumps, range, decay } = ELEMENTS.thunder.chain;
  const done = new Set([fromId]);
  /** @type {{ id: string, from: string, dmg: number, conduct: boolean }[]} */
  const out = [];
  let cur = enemies.find((e) => e.id === fromId), d = dmg;
  for (let k = 0; k < jumps && cur; k++) {
    let next = null, best = Infinity;
    for (const e of enemies) {
      if (done.has(e.id)) continue;
      const dd = Math.hypot(e.x - cur.x, e.z - cur.z);
      if (dd <= range && dd < best) { best = dd; next = e; }
    }
    if (!next) break;
    const conduct = !!(cur.frozen && next.frozen);
    if (!conduct) d *= decay;
    out.push({ id: next.id, from: cur.id, dmg: d, conduct });
    done.add(next.id);
    cur = next;
  }
  return out;
}
