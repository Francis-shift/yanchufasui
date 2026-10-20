// @ts-check
/**
 * 天赋与按键（设计文档第 4 节"天赋与按键"）。纯函数：
 *   选天赋（最多 3 个、没开放的选不了）、羁绊提示、按钮的默认招、两个按钮合成一句、给按钮写的咒能不能用、按键攒气势。
 * 按键放的招和打字一样交给裁决器（planCast），这里只负责把"按了哪几个钮"变成法术意图，不另算伤害。
 */
import {
  BUTTON_GAUGE, COMBO_MAX_STEPS, ELEMENTS, FUSION_OPEN, FUSIONS, PHASE, POWER_DEFAULT, REACTION_OPEN, REACTIONS, TALENT_DEFAULT, TALENT_MAX,
  TALENTS,
} from './numbers.js';
import { defaultName } from './intent.js';

/** 元素的中文名（雷还没进 ELEMENTS，单独补上） @param {string} el */
export const elName = (el) => ELEMENTS[el]?.name ?? { thunder: '雷' }[el] ?? el;

/** 这个天赋现在能不能选（规则里已开放的元素才行） @param {string} el */
export const talentOpen = (el) => TALENTS.includes(el) && PHASE.elements.includes(el);

/**
 * 点一下天赋：没选就选上（满了或没开放就不变），选了就取消。
 * @param {string[]} chosen @param {string} el @returns {string[]}
 */
export function toggleTalent(chosen, el) {
  if (chosen.includes(el)) return chosen.filter((x) => x !== el);
  if (!talentOpen(el) || chosen.length >= TALENT_MAX) return chosen;
  return [...chosen, el];
}

/**
 * 羁绊：这些元素两两之间能出的融合（同一句里先后两步）和反应（先中一种、再被另一种打中）。
 * 只列已经做好的（FUSION_OPEN、REACTION_OPEN），不让玩家冲着还没做的羁绊去选。
 * @param {string[]} els @returns {{ a: string, b: string, kind: '融合' | '反应', name: string }[]}
 */
export function synergies(els) {
  /** @type {{ a: string, b: string, kind: '融合' | '反应', name: string }[]} */
  const out = [];
  for (const a of els) {
    for (const b of els) {
      if (a === b) continue;
      const f = `${a}>${b}`;
      if (FUSION_OPEN.includes(f)) out.push({ a, b, kind: '融合', name: FUSIONS[f].name });
      const rk = `${a}+${b}`;
      if (REACTION_OPEN.includes(rk)) out.push({ a, b, kind: '反应', name: REACTIONS[rk].name });
    }
  }
  return out;
}

/**
 * 天赋按钮的默认招，做成和打字解析出来一样的法术意图。
 * @param {string} el @returns {import('./intent.js').Intent}
 */
export function defaultIntent(el) {
  const d = TALENT_DEFAULT[el];
  const steps = [{ el, form: d.form, target: d.target, power: POWER_DEFAULT, count: 1, path: 'straight', words: {} }];
  return { steps, momentum: 0, name: defaultName(steps), unknown: [], overreach: false, notes: [], summon: null };
}

/**
 * 咏唱中又按了别的天赋：两句合成一句，先后就是语序。后一句的第一步改打前一句第一步的目标——
 * 融合要"目标相同"，按键时玩家没法说目标，默认就是一起打同一处。步数超过上限的截掉。
 * 气势取两句里较低的（升级过的按钮带着写那句话时的气势档）。
 * @param {import('./intent.js').Intent[]} intents @returns {import('./intent.js').Intent}
 */
export function combineButtons(intents) {
  const first = intents[0];
  const steps = [];
  for (const [i, it] of intents.entries()) {
    for (const [j, s] of it.steps.entries()) {
      steps.push(i > 0 && j === 0 && first.steps[0] ? { ...s, target: first.steps[0].target, words: {} } : { ...s, words: {} });
    }
  }
  const capped = steps.slice(0, COMBO_MAX_STEPS);
  return {
    steps: capped, momentum: Math.min(...intents.map((it) => it.momentum)),
    name: intents.length > 1 ? '' : first.name, unknown: [], overreach: false, notes: [], summon: null,
  };
}

/**
 * 给按钮写的这句咒能不能装进去：必须用到这个按钮的元素；用到的其他元素也得在自己的天赋里，
 * 不在的那几步拿掉，记进 notes（咒语卡上提示"尚未领悟"）。召唤、越权的句子不能装进按钮。
 * @param {string} el 按钮的元素 @param {import('./intent.js').Intent} intent 这句话清洗后的意图 @param {string[]} chosen 已选天赋
 * @returns {{ ok: true, intent: import('./intent.js').Intent } | { ok: false, why: string }}
 */
export function bindSpell(el, intent, chosen) {
  if (intent.summon) return { ok: false, why: '召唤不能装进按钮，气势满了点"召唤"或直接开口' };
  if (intent.overreach) return { ok: false, why: '天道不允：越权的话装不进按钮' };
  if (!intent.steps.some((s) => s.el === el)) return { ok: false, why: `这句没有用到「${elName(el)}」，装不进${elName(el)}的按钮` };
  const kept = intent.steps.filter((s) => chosen.includes(s.el));
  const lost = [...new Set(intent.steps.filter((s) => !chosen.includes(s.el)).map((s) => `尚未领悟「${elName(s.el)}」，这一步不生效`))];
  return { ok: true, intent: { ...intent, steps: kept, notes: [...intent.notes, ...lost] } };
}

/**
 * 卷轴：给按钮写咒时"求灵感"的后备（模型连不上时给这些）。每句标明用到哪些元素，只给天赋里都有的；
 * 装进按钮时模型也可能连不上，所以句子要让关键词解析也读得对——单测核对读出的元素与标的一致。
 */
export const SCROLLS = {
  fire: [
    { text: '三颗火球从天而降，砸向最前面的傀儡', els: ['fire'] },
    { text: '烈焰化作火雨，落在最密集的那群', els: ['fire'] },
    { text: '怒火炸开，轰向最强的那只', els: ['fire'] },
    { text: '先用狂风卷起它们，再以烈火焚之', els: ['wind', 'fire'] },
  ],
  ice: [
    { text: '九天寒霜化作冰雨，落向来犯之敌', els: ['ice'] },
    { text: '寒冰之弹，冻住最前面那只', els: ['ice'] },
    { text: '冰墙横在索桥口，挡住它们', els: ['ice'] },
    { text: '先冰封最前面那只，再用火球砸碎它', els: ['ice', 'fire'] },
  ],
  wind: [
    { text: '狂风把它们吹下悬崖', els: ['wind'] },
    { text: '风刃绕到背后，斩向最前面那只', els: ['wind'] },
    { text: '一阵旋风卷向最密集的一群', els: ['wind'] },
    { text: '风墙拦在索桥口', els: ['wind'] },
  ],
  earth: [
    { text: '土墙拔地而起，挡在最前面', els: ['earth'] },
    { text: '巨石从天而降，砸向最强的那只', els: ['earth'] },
    { text: '大地裂开，岩块炸向最密集的一群', els: ['earth'] },
    { text: '三颗石弹从天而降', els: ['earth'] },
  ],
  thunder: [
    { text: '天雷劈向最前面那只', els: ['thunder'] },
  ],
};

/**
 * 从卷轴里给这个按钮挑 n 句（只挑用到的元素都在天赋里的），从第 from 句起轮着给，每次求灵感换一批。
 * @param {string} el @param {string[]} talents @param {number} n @param {number} [from]
 */
export function scrollsFor(el, talents, n, from = 0) {
  const ok = (SCROLLS[el] || []).filter((s) => s.els.every((e) => talents.includes(e)));
  return Array.from({ length: Math.min(n, ok.length) }, (_, i) => ok[(from + i) % ok.length].text);
}

/**
 * 按键攒气势（不看描写，看打法）：打中的敌人数、有没有打出融合或反应。返回这一招一共该加几点。
 * @param {{ hits: number, combo: boolean }} r
 */
export function buttonGaugeGain(r) {
  const g = (r.hits >= BUTTON_GAUGE.multiHitMin ? BUTTON_GAUGE.multiHit : 0) + (r.combo ? BUTTON_GAUGE.combo : 0);
  return Math.min(BUTTON_GAUGE.max, g);
}
