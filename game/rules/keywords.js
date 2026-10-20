// @ts-check
/**
 * 关键词解析：不联网、立刻出结果。三个用处——
 *   1. 回车瞬间先猜元素，法阵马上变成对应颜色（玩家第一眼就看到"它听懂了"）；
 *   2. 模型超时（4.5 秒）或断网时直接用它的结果施法；
 *   3. 每日额度用完后的保底。
 * 只认得关键词，听不懂复杂句子；输出格式与模型一致，同样要经过 sanitizeIntent。
 */

/** 元素关键词（按出现位置决定先后） */
const ELEMENT_WORDS = {
  fire: ['火', '焰', '炎', '烧', '燃', '焚', '烈', '灼'],
  ice: ['冰', '冻', '霜', '寒', '雪', '凝'],
  wind: ['风', '吹', '推', '飓', '旋', '卷', '刮'],
  earth: ['土', '石', '岩', '地裂'],
  thunder: ['雷', '电', '霆', '霹雳', '劈'],
};
const FORM_WORDS = {
  burst: ['爆', '炸', '轰', '一片', '范围', '全场', '一群', '全部'],
  wall: ['墙', '壁', '屏障'],
  rain: ['雨', '天降', '倾泻'],
  bolt: ['弹', '球', '箭', '枪', '刺'],
};
const TARGET_WORDS = [
  ['strongest', ['最强', '最大', '巨像', '大块头', '最壮']],
  ['densest', ['最密', '密集', '一群', '一堆', '那群', '扎堆']],
  ['left', ['左']],
  ['right', ['右']],
  ['center', ['中间', '正中']],
  ['self', ['脚下', '身边', '自己']],
  ['rope', ['绳']],
  ['censer', ['香炉', '炉']],
  ['bridge', ['桥']],
  ['pillar', ['华表', '柱']],
  ['front', ['最前', '前面', '领头', '第一个']],
];
const PATH_WORDS = [
  ['sky', ['从天而降', '天上', '上方', '头顶', '从天']],
  ['behind', ['背后', '身后', '绕后', '后面']],
];
const COUNT_WORDS = [[3, ['三', '3']], [2, ['两', '二', '双', '2']]];
const POWER_MAX_WORDS = ['全力', '最强一击', '倾尽'];
const POWER_UP = ['狠狠', '极'];
const POWER_DOWN = ['轻轻', '小小', '一点点'];
/** 意象词：关键词模式下粗略估气势（模型模式由模型打分） */
const VIVID = ['之', '如', '似', '吧', '！', '!', '啊', '吾', '尔', '天地', '万', '九天', '苍', '怒'];
/** 越权词：说了就截断数值并演法则反噬（模型和程序各查一遍）。比对前先把原话归一，见 normalizeForCheck */
export const OVERREACH_WORDS = ['无限', '秒杀', '无敌', '全部消灭', '直接赢', '999', '满分', '气势拉满', '最大值', '管理员', '忽略规则',
  '一百', '百颗', '千颗', '万颗', '十连', '十步', '无数颗', '开发者', '调试模式', 'system', 'ignore'];
/** 繁体常见字 → 简体（只收越权词和敏感词会用到的字） */
export const TRAD = { 員: '员', 規: '规', 則: '则', 顆: '颗', 彈: '弹', 無: '无', 殺: '杀', 滿: '满', 勢: '势', 連: '连', 統: '统', 調: '调', 試: '试', 數: '数', 開: '开', 發: '发',
  媽: '妈', 幹: '干', 雞: '鸡', 賤: '贱', 騷: '骚', 習: '习', 澤: '泽', 東: '东', 鄧: '邓', 濤: '涛', 輪: '轮', 獨: '独', 腦: '脑', 殘: '残', 癡: '痴', 豬: '猪', 買: '买', 賣: '卖' };
/**
 * 归一后再查越权词，防换写法绕过：全角转半角（ＳＹＳＴＥＭ、９９９９）、繁体转简体、
 * 去掉空格和符号（「忽 略 规 则」「9_9_9_9」）、英文转小写。
 * @param {string} text
 */
export function normalizeForCheck(text) {
  return text.normalize('NFKC').replace(/./gu, (c) => TRAD[c] || c)
    .replace(/[\s_\-·.,，。、；;：:！!？?"'“”‘’（）()【】]/g, '').toLowerCase();
}
/** @param {string} text */
export const hasOverreach = (text) => { const t = normalizeForCheck(text); return OVERREACH_WORDS.some((w) => t.includes(w)); };
/** 分句：一句话里的组合 */
const SPLIT = /(?:然后|接着|之后|再|随后|，|,|；|;)/;

/** @param {string} s @param {string[]} words @returns {string} 命中的那个词，没有返回空串 */
function find(s, words) {
  let best = '', at = Infinity;
  for (const w of words) {
    const i = s.indexOf(w);
    if (i >= 0 && i < at) { best = w; at = i; }
  }
  return best;
}

/**
 * 只猜第一个元素，给法阵上色用。猜不出返回空串。
 * @param {string} text
 */
export function guessElement(text) {
  let best = '', at = Infinity;
  for (const [el, words] of Object.entries(ELEMENT_WORDS)) {
    for (const w of words) {
      const i = text.indexOf(w);
      if (i >= 0 && i < at) { best = el; at = i; }
    }
  }
  return best;
}

/**
 * @param {string} text
 * @returns {Record<string, any>} 与模型输出同格式的原始意图
 */
export function parseKeywords(text) {
  const parts = text.split(SPLIT).map((p) => p.trim()).filter(Boolean);
  const steps = [];
  let carryTarget = '';
  for (const part of parts) {
    const el = guessElement(part);
    if (!el) continue;
    const elWord = find(part, ELEMENT_WORDS[el]);
    /** @type {Record<string, string>} */
    const w = { e: elWord };
    let form = 'bolt';
    for (const f of ['burst', 'wall', 'rain', 'bolt']) {
      const hit = find(part, FORM_WORDS[f]);
      if (hit) { form = f; w.f = hit; break; }
    }
    let target = '';
    for (const [t, words] of TARGET_WORDS) {
      const hit = find(part, /** @type {string[]} */ (words));
      if (hit) { target = /** @type {string} */ (t); w.t = hit; break; }
    }
    // 只是在召唤（「召唤冰龙」）、没说要放什么：不算一步，龙怎么打看后半句。只认龙名，别把「龙卷风」也吞了
    if (!w.f && (/召唤|神龙/.test(part) || Object.values(DRAGON_WORDS).flat().some((d) => part.includes(d)))) continue;
    // 同一个元素、这半句又没说新形态：是在补充上一步（如「狂风爆裂，把那群吹下悬崖」），并进上一步，不另算一步
    const prev = steps[steps.length - 1];
    if (prev && prev.e === el && !w.f) {
      if (target && !prev.w.t) { prev.t = target; prev.w.t = w.t; }
      continue;
    }
    if (!target) target = carryTarget || (form === 'burst' ? 'densest' : 'front');
    carryTarget = target;
    let path = 'straight';
    for (const [pth, words] of PATH_WORDS) {
      const hit = find(part, /** @type {string[]} */ (words));
      if (hit) { path = /** @type {string} */ (pth); w.r = hit; break; }
    }
    let n = 1;
    for (const [c, words] of COUNT_WORDS) {
      const hit = find(part, /** @type {string[]} */ (words));
      if (hit && form === 'bolt') { n = /** @type {number} */ (c); w.n = hit; break; }
    }
    let p = 2;
    const max = find(part, POWER_MAX_WORDS), up = find(part, POWER_UP), down = find(part, POWER_DOWN);
    if (max) { p = 5; w.p = max; } else if (up) { p = 4; w.p = up; } else if (down) { p = 1; w.p = down; }
    steps.push({ e: el, f: form, t: target, p, n, r: path, w });
    if (steps.length === 3) break;
  }
  let vivid = 0;
  for (const v of VIVID) if (text.includes(v)) vivid++;
  const m = text.length >= 8 ? Math.min(3, Math.floor(vivid / 2)) : 0;
  return { s: steps, m, x: [], o: hasOverreach(text), c: summonOf(text, steps), nm: '' };
}

/** 召唤：「冰龙」「火龙」直接认；只说「召唤神龙」之类没说哪条，就按这句的第一个元素，再没有就是冰龙 */
const DRAGON_WORDS = { ice: ['冰龙', '寒龙', '霜龙', '雪龙'], fire: ['火龙', '炎龙', '焰龙'], wind: ['风龙'], earth: ['土龙', '石龙', '岩龙'], thunder: ['雷龙'] };
/** @param {string} text @param {{ e: string }[]} steps */
function summonOf(text, steps) {
  let best = null, at = Infinity;
  for (const [el, words] of Object.entries(DRAGON_WORDS)) {
    for (const w of words) { const i = text.indexOf(w); if (i >= 0 && i < at) { best = el; at = i; } }
  }
  if (best) return best;
  if (/召唤.{0,6}龙|神龙/.test(text)) return steps[0]?.e || 'ice';
  return null;
}
