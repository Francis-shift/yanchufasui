// @ts-check
/**
 * 内容安全：展台的大屏谁都看得见，玩家原话会显示在咒语卡上，模型起的名字会用书法大字闪出来。
 *
 *   - 玩家原话：命中脏话、色情、歧视、政治人物等词，那几个字换成"＊"再往下走——
 *     咒语卡上看不到，模型也收不到（就没法把它编进名字），其余部分照常施法；
 *   - 咒语名：命中上面的词，或命中只针对名字的一组（骂人的轻话、广告），整个名字作废，换默认名。
 *
 * 比对前先归一（全角转半角、繁体转简体、去空格和符号、英文转小写），防"傻 逼""傻_逼"这种拆写。
 * 只收两个字以上的词：游戏里"干掉他们""逼近""操控"都是正常说法，单字一律不拦。
 * 这是展台用的基础过滤，挡常见情况；模型自己的安全规则是第二道。
 */
import { TRAD } from './keywords.js';

/** 原话和名字都拦 */
export const BLOCK_WORDS = [
  // 脏话
  // 注意别收会撞上正常说法的词："日你"会撞"今日你们"，"我操"会撞"我操控"，"大麻"会撞"大麻烦"
  '傻逼', '傻b', '煞笔', '沙比', '傻比', '傻屌', '操你', '草你', '艹你', '日你妈', '日你娘', '干你娘', '你妈的', '他妈的', '去你妈',
  '尼玛', '妈的', '卧槽', '草泥马', '狗日', '王八蛋', '杂种', '贱人', '婊子',
  'nmsl', 'wdnmd', 'cnm', 'sb', 'fuck', 'shit', 'bitch',
  // 色情
  '鸡巴', '鸡吧', '做爱', '性交', '强奸', '轮奸', '口交', '肛交', '射精', '自慰', '打飞机', '嫖娼', '卖淫', '妓女',
  '骚货', '荡妇', '裸体', '黄片', '色情', '屁眼', '奶子',
  // 歧视
  '黑鬼', '支那', '尼哥', 'nigger', '基佬', '娘炮',
  // 政治人物与敏感议题（展台在国内，咒语名不碰这些）
  '习近平', '胡锦涛', '江泽民', '温家宝', '李克强', '毛泽东', '邓小平', '彭丽媛', '共产党', '共匪', '反共',
  '法轮', '李洪志', '台独', '藏独', '疆独', '港独', '六四', '达赖',
  // 毒品
  '冰毒', '海洛因', '摇头丸', '吸毒', '贩毒',
];

/** 只拦名字（原话里说了无妨，但不能变成书法大字闪出来） */
export const NAME_ONLY_WORDS = ['笨蛋', '傻瓜', '白痴', '智障', '脑残', '废物', '弱智', '蠢货', '猪头', '垃圾', '去死',
  '微信', '加群', '充值', '代练', '优惠', '领取', '二维码', '网址', '买', '卖'];

/** 归一时整个丢掉的字符（与 normalizeForCheck 一致） */
const DROP = /[\s_\-·.,，。、；;：:！!？?"'“”‘’（）()【】*＊]/;

/**
 * 归一并记下每个归一后的字来自原话的第几个字。
 * @param {string[]} chars 原话按字拆开
 */
function normalizeWithMap(chars) {
  let out = ''; /** @type {number[]} */ const map = [];
  chars.forEach((c, i) => {
    for (const d of c.normalize('NFKC')) {
      const n = (TRAD[d] || d).toLowerCase();
      if (DROP.test(n)) continue;
      out += n;
      for (let k = 0; k < n.length; k++) map.push(i);
    }
  });
  return { out, map };
}

/** @param {string} norm @param {string[]} words @returns {[number, number][]} 命中的区间（归一后的下标，含头不含尾） */
function findAll(norm, words) {
  /** @type {[number, number][]} */ const hits = [];
  for (const w of words) {
    for (let i = norm.indexOf(w); i >= 0; i = norm.indexOf(w, i + 1)) hits.push([i, i + w.length]);
  }
  return hits;
}

/**
 * 把原话里的敏感词换成"＊"（拆写的，中间的空格符号一并盖住）。
 * @param {string} text
 * @returns {{ text: string, hit: boolean }}
 */
export function maskText(text) {
  const chars = [...text];
  const { out, map } = normalizeWithMap(chars);
  const hits = findAll(out, BLOCK_WORDS);
  if (!hits.length) return { text, hit: false };
  for (const [a, b] of hits) {
    for (let i = map[a]; i <= map[b - 1]; i++) if (!/\s/.test(chars[i])) chars[i] = '＊';
  }
  return { text: chars.join(''), hit: true };
}

/** @param {string} name @returns {boolean} 名字能用（不含任何敏感词与只针对名字的词） */
export function nameIsClean(name) {
  const { out } = normalizeWithMap([...name]);
  return !findAll(out, BLOCK_WORDS).length && !findAll(out, NAME_ONLY_WORDS).length;
}
