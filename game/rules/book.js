// @ts-check
/**
 * 咒语图鉴（设计文档第 2 节"咒语图鉴"）：用出过的法术点亮一格，记下第一次是怎么念的。
 * 存在这台设备的浏览器里，一局一局攒下去。"这一局第一次 +20%"仍归 planCast 和 S.seen 管，图鉴不动数值。
 * 前三种键和 planCast 的 newlySeen 同一个写法；反应按 damageTo 给的名字，物件按 target。
 */
import { ELEMENTS, FORMS, FUSION_OPEN, FUSIONS, INPUT_MAX_CHARS, REACTION_OPEN, REACTIONS, SUMMON_OPEN, SUMMONS } from './numbers.js';

/** @param {string} k */
const zh = (k) => ELEMENTS[/** @type {keyof typeof ELEMENTS} */ (k)].name;

/** 每种形态给一句能用的话：测试拿它走一遍关键词解析，确实点得亮这一格 @type {Record<string, (e: string) => string>} */
const FORM_SAY = {
  bolt: (e) => `${e}弹打最前面那只`,
  burst: (e) => `${e}爆打最密集的那群`,
  wall: (e) => `在中间立一道${e}墙`,
  rain: (e) => `下一场${e}雨`,
};
/** @type {Record<string, string>} */
const REACTION_SAY = {
  'ice+fire': '先冻住敌人，再用火打它',
  'ice+wind': '先冻住敌人，再用风打它',
  'ice+thunder': '先冻住敌人，再用雷劈它',
  'wind+fire': '先用风吹敌人，再用火打它',
  'earth+wind': '先立一道土墙，再用风把它掀出去',
};

/** @typedef {{ key: string, name: string, hint: string }} BookCell */
/** @type {{ title: string, n: number, cells: BookCell[] }[]} n：一行几格 */
export const BOOK = [
  { title: '五行四式', n: 4, cells: Object.keys(ELEMENTS).flatMap((e) => Object.entries(FORMS).map(([f, spec]) =>
    ({ key: `${e}+${f}`, name: zh(e) + spec.name, hint: `说：${FORM_SAY[f](zh(e))}` }))) },
  { title: '融合', n: 2, cells: FUSION_OPEN.map((k) => {
    const [a, b] = k.split('>');
    return { key: `融合:${k}`, name: FUSIONS[/** @type {keyof typeof FUSIONS} */ (k)].name, hint: `一句话里先${zh(a)}后${zh(b)}，打同一个目标` };
  }) },
  { title: '反应', n: 5, cells: REACTION_OPEN.map((k) => {
    const { name } = REACTIONS[/** @type {keyof typeof REACTIONS} */ (k)];
    return { key: `反应:${name}`, name, hint: REACTION_SAY[k] };
  }) },
  { title: '召龙', n: 5, cells: SUMMON_OPEN.map((k) => {
    const { name } = SUMMONS[/** @type {keyof typeof SUMMONS} */ (k)];
    return { key: `召唤:${k}`, name, hint: `气势攒够了，说：召唤${name}` };
  }) },
  { title: '山门物件', n: 4, cells: [
    { key: '物件:pillar', name: '华表倒地', hint: '说：推倒华表' },
    { key: '物件:rope', name: '镇山石落', hint: '说：烧断铁链' },
    { key: '物件:censer', name: '香炉倾翻', hint: '说：踢翻香炉' },
    { key: '物件:bridge', name: '索桥冰封', hint: '说：冻住索桥' },
  ] },
];

const NAMES = new Map(BOOK.flatMap((s) => s.cells.map((c) => [c.key, c.name])));
/** 一共几格 */
export const BOOK_TOTAL = NAMES.size;

/**
 * 从浏览器里存的那串字读回图鉴（格的键 → 第一次念的话）；没有、读不出、被改坏了的都不要。
 * @param {string | null} raw @returns {Record<string, string>}
 */
export function readBook(raw) {
  /** @type {Record<string, string>} */
  const book = {};
  try {
    const o = JSON.parse(raw ?? 'null');
    if (o && typeof o === 'object') for (const k of NAMES.keys()) if (typeof o[k] === 'string') book[k] = o[k].slice(0, INPUT_MAX_CHARS);
  } catch { /* 坏了当没有 */ }
  return book;
}

/**
 * 点亮这几格（已经亮的留着第一次的话，不认识的不管）。
 * @param {Record<string, string>} book @param {string[]} keys @param {string} text 这回念的话
 * @returns {{ book: Record<string, string>, fresh: string[] }} 新的图鉴（没点亮新的就是原来那份）、新亮的名字
 */
export function lightCells(book, keys, text) {
  const fresh = [...new Set(keys)].filter((k) => NAMES.has(k) && !Object.hasOwn(book, k));
  if (!fresh.length) return { book, fresh: [] };
  const said = text.slice(0, INPUT_MAX_CHARS);
  return { book: { ...book, ...Object.fromEntries(fresh.map((k) => [k, said])) }, fresh: fresh.map((k) => /** @type {string} */ (NAMES.get(k))) };
}
