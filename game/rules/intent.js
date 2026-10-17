// @ts-check
/**
 * 法术意图：模型（或关键词解析）输出的固定格式，以及进入规则前的清洗。
 *
 * 模型输出的原始格式（字段名用短词，输出越短越快；顺序按用到的先后，咒语名放最后）：
 *   { "s": [ { "e": "ice", "f": "bolt", "t": "front", "p": 2, "n": 1, "r": "straight",
 *              "w": { "e": "冻住", "t": "最前面那只" } } ],
 *     "m": 2, "x": ["变成猫"], "o": false, "nm": "霜缚" }
 *   s 步骤（≤3）：e 元素、f 形态、t 目标、p 威力、n 颗数（只对弹）、r 轨迹（只对弹）、w 每一栏来自原话的哪几个字
 *   m 气势 0～3；x 游戏里没有的要求（原话片段）；o 是否越权；nm 给这句话起的名字
 *
 * 清洗原则：模型说什么都不直接信——枚举不在表里就丢或降级，数值夹到上限，来源词必须真在原话里。
 */
import {
  BOLT_COUNT_MAX, COMBO_MAX_STEPS, ELEMENTS, FORMS, MOMENTUM_MAX, PHASE, POWER_DEFAULT, POWER_MAX, POWER_MIN,
} from './numbers.js';
import { OVERREACH_WORDS } from './keywords.js';

export const TARGETS = ['front', 'strongest', 'densest', 'left', 'right', 'center', 'self', 'rope', 'censer', 'bridge', 'pillar'];
export const TARGET_NAMES = {
  front: '最前面', strongest: '最强', densest: '最密集', left: '左边', right: '右边', center: '中间', self: '自己脚下',
  rope: '吊石的绳子', censer: '香炉', bridge: '索桥', pillar: '华表',
};
export const PATHS = ['straight', 'sky', 'behind'];
export const PATH_NAMES = { straight: '直线', sky: '从天而降', behind: '绕到背后' };

/** 模型偶尔会直接输出中文，按别名收下 */
const ELEMENT_ALIAS = { 火: 'fire', 冰: 'ice', 风: 'wind', 土: 'earth' };
const FORM_ALIAS = { 弹: 'bolt', 爆: 'burst', 墙: 'wall', 雨: 'rain' };

const NAME_MAX = 8;
const WORD_MAX = 12;

/**
 * @typedef {{ el: string, form: string, target: string, power: number, count: number, path: string,
 *             words: Record<string, string> }} Step
 * @typedef {{ steps: Step[], momentum: number, name: string, unknown: string[], overreach: boolean,
 *             notes: string[] }} Intent
 */

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @param {unknown} v @param {number} lo @param {number} hi @param {number} dflt */
function intIn(v, lo, hi, dflt) {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return { value: dflt, over: false };
  const r = Math.round(n);
  return { value: Math.min(hi, Math.max(lo, r)), over: r > hi };
}

/** 只留真在原话里出现过的来源词（防止模型编造），长度限制防止整句塞进来 */
function cleanWords(w, text) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!isObj(w)) return out;
  for (const [k, v] of Object.entries(w)) {
    if (typeof v === 'string' && v.length > 0 && v.length <= WORD_MAX && text.includes(v)) out[k] = v;
  }
  return out;
}

/** 咒语名：只留汉字和间隔号，最多 8 个字；内容安全过滤在第一批接入 */
export function cleanName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[^一-鿿·]/g, '').replace(/^·+|·+$/g, '').slice(0, NAME_MAX);
}

/** 没有名字时按步骤拼一个，如「冰弹·风爆」 */
export function defaultName(steps) {
  return steps.map((s) => ELEMENTS[s.el].name + FORMS[s.form].name).join('·').slice(0, NAME_MAX) || '无名';
}

/**
 * 清洗一份原始意图。
 * @param {unknown} raw 模型或关键词解析的输出
 * @param {string} text 玩家原话
 * @param {{ elements: string[], forms: string[], formFallback: Record<string, string> }} [phase]
 * @returns {Intent}
 */
export function sanitizeIntent(raw, text, phase = PHASE) {
  /** @type {string[]} */
  const notes = [];
  const r = isObj(raw) ? raw : {};
  let overreach = r.o === true;
  /** @type {Step[]} */
  const steps = [];
  const rawSteps = Array.isArray(r.s) ? r.s : [];
  if (rawSteps.length > COMBO_MAX_STEPS) notes.push(`一句最多 ${COMBO_MAX_STEPS} 步，后面的不算`);
  for (const s of rawSteps.slice(0, COMBO_MAX_STEPS)) {
    if (!isObj(s)) continue;
    const words = cleanWords(s.w, text);
    let el = typeof s.e === 'string' ? (ELEMENT_ALIAS[s.e] || s.e) : '';
    let form = typeof s.f === 'string' ? (FORM_ALIAS[s.f] || s.f) : '';
    if (!(el in ELEMENTS)) { notes.push('有一步没说清是什么元素，未生效'); continue; }
    if (!phase.elements.includes(el)) { notes.push(`${ELEMENTS[el].name}系尚未开放，这一步未生效`); continue; }
    if (!(form in FORMS)) form = 'bolt';
    if (!phase.forms.includes(form)) {
      const fb = phase.formFallback[form] || phase.forms[0];
      notes.push(`${ELEMENTS[el].name}${FORMS[form].name}尚未开放，改为${ELEMENTS[el].name}${FORMS[fb].name}`);
      form = fb;
    }
    const target = TARGETS.includes(s.t) ? s.t : 'front';
    const p = intIn(s.p, POWER_MIN, POWER_MAX, POWER_DEFAULT);
    if (p.over) overreach = true;
    let count = 1, path = 'straight';
    if (form === 'bolt') {
      const n = intIn(s.n, 1, BOLT_COUNT_MAX, 1);
      count = n.value;
      if (n.over) notes.push(`一次最多 ${BOLT_COUNT_MAX} 颗`);
      path = PATHS.includes(s.r) ? s.r : 'straight';
    }
    steps.push({ el, form, target, power: p.value, count, path, words });
  }
  const m = intIn(r.m, 0, MOMENTUM_MAX, 0);
  // 越权词由程序再查一遍，不只靠模型自觉（「给我满分」「威力无限」之类）
  if (OVERREACH_WORDS.some((w) => text.includes(w))) overreach = true;
  const unknown = (Array.isArray(r.x) ? r.x : [])
    .filter((x) => typeof x === 'string' && x.length > 0 && x.length <= WORD_MAX && text.includes(x))
    .slice(0, 3);
  const name = cleanName(r.nm) || (steps.length ? defaultName(steps) : '');
  return { steps, momentum: overreach ? 0 : m.value, name, unknown, overreach, notes };
}
