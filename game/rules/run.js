// @ts-check
/**
 * 试炼的一局（设计文档第 4 节"试炼模式：一局与奖励"）。纯函数：
 *   一局怎么排（RUN_STAGES）、卡池（CARDS）、出哪几张（offer）、拿了（take）、重抽（reroll）、不拿（skip），
 *   拿过的卡合成这一局的加成（runMods）。
 * 卡的效果在用到它的地方生效（完美闪避的窗口、法力回复、召龙要几格气势……），这里只记"拿了什么、到几级"。
 * 卡池里写全了设计里的卡；ready 为假的是效果还没做的，不会出（做一样开一样）。
 */
import { ELEMENTS, FORMS, RUN, TALENT_DEFAULT, TRIAL, ULT_GAUGE } from './numbers.js';

/**
 * 一局：小怪潮 → 三选一 → boss → 三选一（第三张是领悟）→ …… → 第三个 boss → 结算；打完最后一个 boss 不再选卡。
 * boss 的 n 是第几个 boss（1 寒甲傀儡王、2 石甲巨像、3 火灵）。
 * @type {{ kind: 'wave' | 'pick' | 'boss', n?: number, insight?: boolean }[]}
 */
export const RUN_STAGES = [
  { kind: 'wave' }, { kind: 'pick' }, { kind: 'boss', n: 1 }, { kind: 'pick', insight: true },
  { kind: 'wave' }, { kind: 'pick' }, { kind: 'boss', n: 2 }, { kind: 'pick', insight: true },
  { kind: 'wave' }, { kind: 'pick' }, { kind: 'boss', n: 3 },
];
/** 一局几个 boss（也是几轮：每轮一段小怪潮加一个 boss） */
export const BOSS_COUNT = RUN_STAGES.filter((s) => s.kind === 'boss').length;

/**
 * @typedef {'move' | 'rune' | 'art' | 'insight'} CardKind 招式字 / 字诀 / 心法 / 领悟（合字属于领悟）
 * @typedef {{ id: string, kind: CardKind, name: string, text: string, max: number, ready: boolean,
 *             el?: string, need?: string[], lack?: string, fuse?: string }} Card
 *   el：这张卡属于哪个元素（字诀里的燎凝回返引）；need：手上要有这几个元素才出（合字）；lack：手上没有这个元素才出（领悟新元素）；
 *   fuse：合字领悟的是哪种融合（FUSIONS 的键）；max：最多拿几次，第二次起是升级
 */
export const KIND_NAMES = { move: '招式字', rune: '字诀', art: '心法', insight: '领悟' };

/** @type {Card[]} */
export const CARDS = [
  // 招式字：换掉一个按钮的形态、轨迹、颗数；拿了选换哪个按钮（轨迹、颗数只换得了弹）
  { id: 'burst', kind: 'move', name: '爆', text: '落点炸开一圈；换进已是「爆」的按钮，范围更大', max: 2, ready: true },
  { id: 'wall', kind: 'move', name: '墙', text: '一道墙横在前面，挡路也挡冰锥；再拿墙更长', max: 2, ready: true },
  { id: 'rain', kind: 'move', name: '雨', text: '两秒里从天上落六次；再拿铺得更开', max: 2, ready: true },
  { id: 'sky', kind: 'move', name: '天降', text: '弹从天而降，盾挡不住', max: 1, ready: true },
  { id: 'behind', kind: 'move', name: '绕后', text: '弹绕到背后再打', max: 1, ready: true },
  { id: 'three', kind: 'move', name: '三颗', text: '弹一次放三颗', max: 1, ready: true },
  // 字诀：写进按钮的咒语才生效
  { id: 'po', kind: 'rune', name: '破', text: '打有甲的目标伤害翻倍，不是火也能削甲', max: 1, ready: false },
  { id: 'lian', kind: 'rune', name: '连', text: '放完 0.5 秒自动再放一次，第二次半伤', max: 1, ready: false },
  { id: 'zhong', kind: 'rune', name: '重', text: '伤害 ×1.6；咏唱加倍，放完 0.5 秒内不能闪避', max: 1, ready: false },
  { id: 'ji', kind: 'rune', name: '疾', text: '咏唱 0.6 → 0.2 秒，法力多花三成', max: 1, ready: false },
  { id: 'sui', kind: 'rune', name: '随', text: '飞弹绕开障碍追着打', max: 1, ready: false },
  { id: 'liao', kind: 'rune', name: '燎', el: 'fire', text: '落地留火', max: 1, ready: false },
  { id: 'ning', kind: 'rune', name: '凝', el: 'ice', text: '冻得更久；boss 冻住时下一招预警变慢', max: 1, ready: false },
  { id: 'hui', kind: 'rune', name: '回', el: 'wind', text: '风刃飞出去再飞回来，打两次', max: 1, ready: false },
  { id: 'fan', kind: 'rune', name: '返', el: 'earth', text: '墙挡下的冰锥反弹回去', max: 1, ready: false },
  { id: 'yin', kind: 'rune', name: '引', el: 'thunder', text: '雷链多跳两次，能打碎冰锥', max: 1, ready: false },
  // 心法：拿了就生效
  { id: 'jianqie', kind: 'art', name: '见切', text: `完美闪避的窗口 ${TRIAL.perfect.window} → ${RUN.arts.window} 秒`, max: 1, ready: true },
  { id: 'chana', kind: 'art', name: '刹那', text: `完美闪避后 ${RUN.arts.slow.sec} 秒全场慢到三成，自己照常快`, max: 1, ready: true },
  { id: 'fanshou', kind: 'art', name: '反手', text: `完美闪避后 ${RUN.arts.counter.sec} 秒内，下一招 ×${RUN.arts.counter.mult}`, max: 1, ready: true },
  { id: 'canying', kind: 'art', name: '残影', text: '闪避处留下残影：追踪冰锥改追它，撞上就碎，骗过的不再回头', max: 1, ready: true },
  { id: 'juqi', kind: 'art', name: '聚气', text: `完美闪避加 ${RUN.arts.gauge} 格气势（原 ${TRIAL.perfect.gauge} 格）`, max: 1, ready: true },
  { id: 'huiyuan', kind: 'art', name: '回元', text: `法力回复 +${Math.round((RUN.arts.regen - 1) * 100)}%`, max: 1, ready: true },
  { id: 'longyin', kind: 'art', name: '龙吟', text: `召龙只要 ${RUN.arts.ult} 格气势（原 ${ULT_GAUGE} 格）`, max: 1, ready: true },
  { id: 'yuwei', kind: 'art', name: '余威', text: `龙落地后 ${RUN.arts.after.sec} 秒内，所有招 ×${RUN.arts.after.mult}`, max: 1, ready: true },
  // 领悟：打完 boss 才出
  { id: 'he-fire-wind', kind: 'insight', name: '火借风威', need: ['fire', 'wind'], fuse: 'fire>wind',
    text: '先按火、再按风，两招合成豪火灭却', max: 1, ready: true },
  { id: 'he-wind-fire', kind: 'insight', name: '风助火势', need: ['wind', 'fire'], fuse: 'wind>fire',
    text: '先按风、再按火，两招合成火卷风', max: 1, ready: true },
  ...[['fire', '火'], ['ice', '冰'], ['wind', '风'], ['earth', '土'], ['thunder', '雷']].map(([el, name]) => /** @type {Card} */ ({
    id: `learn-${el}`, kind: 'insight', name, lack: el, text: `领悟「${name}」，多一个${name}的按钮`, max: 1, ready: false })),
  { id: 'slot', kind: 'insight', name: '双诀', text: '每句咒多认一个字诀', max: 1, ready: false },
  { id: 'button', kind: 'insight', name: '一心二用', text: '多一个按钮，同一个元素能装两种招', max: 1, ready: false },
  { id: 'twin', kind: 'insight', name: '双龙', text: '一次召两条龙，各打六成，分扑两个目标', max: 1, ready: false },
  { id: 'guard', kind: 'insight', name: '护身', text: '龙不扑出去，绕着自己转 5 秒，挡掉碰到的冰锥', max: 1, ready: false },
];

/**
 * 一局的状态：选过几次、还能重抽几次、每张卡拿了几次、押过哪些元素（拿过带元素的卡、把招式字换进了哪个元素的按钮）、不拿过几次；
 * 招式字：每个元素的按钮换过哪几栏（moves，没换过就是本命招）、学会了哪些字（learned）、哪些形态升过级（up，键是「元素:形态」）。
 * @typedef {{ form?: string, path?: string, count?: number }} MoveSet
 * @typedef {{ picks: number, rerolls: number, have: Record<string, number>, invest: string[], skips: number,
 *             moves: Record<string, MoveSet>, learned: Record<string, string[]>, up: Record<string, number> }} Run
 * @returns {Run}
 */
export const newRun = () => ({ picks: 0, rerolls: RUN.rerolls, have: {}, invest: [], skips: 0, moves: {}, learned: {}, up: {} });

/** @param {Run} run @param {string} id */
export const level = (run, id) => run.have[id] ?? 0;

/**
 * 这张卡现在能不能出：效果做好了、还没拿满、元素条件满足（字诀里带元素的、合字要手上有那几个元素，领悟新元素要手上没有）；
 * 招式字还要有按钮换得上（轨迹、颗数只换得了弹）。
 * @param {Card} c @param {Run} run @param {string[]} els 玩家现有的元素
 */
export function eligible(c, run, els) {
  if (!c.ready || level(run, c.id) >= c.max) return false;
  if (c.el && !els.includes(c.el)) return false;
  if (c.need && !c.need.every((e) => els.includes(e))) return false;
  if (c.lack && els.includes(c.lack)) return false;
  if (c.kind === 'move' && !moveTargets(run, c, els).length) return false;
  return true;
}

// ---------------------------------------------------------------- 招式字（设计文档第 4 节"开局只会本命招""招式字"）
/** 每个招式字改按钮的哪一栏 @type {Record<string, MoveSet>} */
const MOVE_SET = { burst: { form: 'burst' }, wall: { form: 'wall' }, rain: { form: 'rain' }, sky: { path: 'sky' }, behind: { path: 'behind' },
  three: { count: 3 } };
/** 轨迹、颗数在卡上的叫法 @type {Record<string, string>} */
const CHAR = { sky: '天降', behind: '绕后', three: '三颗' };

/** 开局只会本命招：火、冰、雷是弹，风是爆，土是墙；单颗、直线 @param {string} el @returns {Required<MoveSet>} */
export const native = (el) => ({ form: TALENT_DEFAULT[el]?.form ?? 'bolt', path: 'straight', count: 1 });

/** 这个元素学没学会这个字（形态、轨迹、颗数；本命形态、直线、一颗生来就会） @param {Run} run @param {string} el @param {string} id */
export function knows(run, el, id) {
  return id === native(el).form || id === 'straight' || (run.learned[el] ?? []).includes(id);
}

/** 这个元素的按钮现在的招：本命招叠上换过的字；不是弹就没有轨迹、颗数 @param {Run} run @param {string} el @returns {Required<MoveSet>} */
export function buttonMove(run, el) {
  const m = { ...native(el), ...run.moves[el] };
  return m.form === 'bolt' ? m : { ...m, path: 'straight', count: 1 };
}

/** 这个元素的这个形态升过级没有（「爆·二」） @param {Run} run @param {string} el @param {string} form */
export const upgraded = (run, el, form) => (run.up[`${el}:${form}`] ?? 0) > 0;

/**
 * 这张招式字能换进哪几个按钮：形态字哪个都行（已经是这个形态、又升过级的除外——再换是升级）；轨迹、颗数只换得了现在是弹、还没有这一样的。
 * @param {Run} run @param {Card} c @param {string[]} els @returns {string[]}
 */
export function moveTargets(run, c, els) {
  const set = MOVE_SET[c.id];
  if (!set) return [];
  return els.filter((el) => {
    const m = buttonMove(run, el);
    if (set.form) return !(m.form === set.form && upgraded(run, el, set.form));
    if (m.form !== 'bolt') return false;
    return set.path ? m.path !== set.path : m.count < (set.count ?? 1);
  });
}

/** 招的叫法（选按钮时卡上写的）：火弹×3·天降、风爆·二 @param {Run} run @param {string} el @param {Required<MoveSet>} m */
export function moveName(run, el, m) {
  const path = CHAR[m.path] ? `·${CHAR[m.path]}` : '';
  return `${ELEMENTS[el].name}${FORMS[m.form].name}${m.count > 1 ? `×${m.count}` : ''}${path}${upgraded(run, el, m.form) ? '·二' : ''}`;
}

/**
 * 把招式字换进 el 的按钮之后，这个按钮是什么招（选按钮时预览用）。
 * @param {Run} run @param {Card} c @param {string} el
 */
export function previewMove(run, c, el) {
  const next = take(run, c, el);
  return { name: moveName(next, el, buttonMove(next, el)), up: !!MOVE_SET[c.id]?.form && knows(run, el, c.id) };
}

/**
 * 试炼里按钮放出去之前过一遍（守关不过这一遍，所有招全开）：
 *   - 装在 btn 这个按钮上的，这个元素的步换成按钮现在的招（换过的那几栏）；
 *   - 每一步写了没学会的形态、轨迹、颗数，按这个元素按钮现在的招放（轨迹按直线、颗数按学会的），notes 里记一句（咒语卡标灰）；
 *   - 升过级的形态带上范围倍数 wide。
 * @param {import('./intent.js').Intent} intent @param {Run} run @param {string} [btn]
 * @returns {import('./intent.js').Intent}
 */
export function limitToLearned(intent, run, btn) {
  /** @type {string[]} */
  const notes = [];
  const note = (/** @type {string} */ s) => { if (!notes.includes(s)) notes.push(s); };
  const steps = intent.steps.map((s0) => {
    const s = { ...s0, ...(s0.el === btn ? run.moves[btn] : {}) };
    const m = buttonMove(run, s.el);
    if (!knows(run, s.el, s.form)) { note(`尚未领悟「${FORMS[s.form].name}」，按「${FORMS[m.form].name}」放`); s.form = m.form; }
    if (s.form !== 'bolt') { s.path = 'straight'; s.count = 1; }
    if (s.path !== 'straight' && !knows(run, s.el, s.path)) { note(`尚未领悟「${CHAR[s.path] ?? s.path}」，按直线放`); s.path = 'straight'; }
    const most = knows(run, s.el, 'three') ? 3 : 1;
    if (s.count > most) { note('尚未领悟「三颗」，按一颗放'); s.count = most; }
    if (upgraded(run, s.el, s.form)) s.wide = RUN.up; else delete s.wide;
    return s;
  });
  return { ...intent, steps, notes: [...intent.notes, ...notes] };
}

/** 试炼里能合成的融合：领悟了哪几个合字（守关不用这个，融合全开） @param {Run} run @returns {string[]} */
export const runFusions = (run) => CARDS.filter((c) => c.fuse && level(run, c.id) > 0).map((c) => /** @type {string} */ (c.fuse));

/**
 * 出现的分量：押过的元素（拿过这个元素的字、或把招式字换进了这个元素的按钮）× RUN.owned，其余 1。
 * 设计里写"已有元素的字出现概率加倍"；手上没有的元素的字本来就不出，所以按"押过"算，越押越容易成流派。
 * @param {Card} c @param {Run} run
 */
export function weight(c, run) {
  const els = c.el ? [c.el] : c.need ?? [];
  return els.some((e) => run.invest.includes(e)) ? RUN.owned : 1;
}

/** 按分量抽一张 @param {Card[]} list @param {Run} run @param {() => number} rnd */
function draw(list, run, rnd) {
  const total = list.reduce((a, c) => a + weight(c, run), 0);
  let x = rnd() * total;
  for (const c of list) { x -= weight(c, run); if (x < 0) return c; }
  return list[list.length - 1];
}

/**
 * 出卡：三张——第一张从招式字和字诀里抽，第二张心法，第三张随机（打完 boss 那次必是领悟）；第一次选卡，第一张必是招式字。
 * 哪一格这一类抽不出（拿完了、效果还没做），就从剩下能出的卡里补（领悟只在打完 boss 那次出）；再没有就少一张。
 * avoid：重抽时尽量不出刚才那几张（不够了才出）。
 * @param {Run} run @param {{ els: string[], insight: boolean }} ctx els：玩家现有的元素；insight：打完 boss 的那次
 * @param {() => number} rnd @param {string[]} [avoid] @param {Card[]} [pool] 测试时可换一池卡
 * @returns {Card[]}
 */
export function offer(run, ctx, rnd, avoid = [], pool = CARDS) {
  const all = pool.filter((c) => eligible(c, run, ctx.els));
  const of = (/** @type {CardKind[]} */ kinds) => all.filter((c) => kinds.includes(c.kind));
  const firstMove = run.picks === 0 && of(['move']).length > 0;
  /** @type {CardKind[][]} */
  const slots = [firstMove ? ['move'] : ['move', 'rune'], ['art'], ctx.insight ? ['insight'] : ['move', 'rune', 'art']];
  const common = of(['move', 'rune', 'art']);
  /** @type {Card[]} */
  const out = [];
  for (const kinds of slots) {
    const free = (/** @type {Card[]} */ l) => l.filter((c) => !out.includes(c));
    const fresh = (/** @type {Card[]} */ l) => free(l).filter((c) => !avoid.includes(c.id));
    const tries = [fresh(of(kinds)), fresh(common), free(of(kinds)), free(common)];
    const list = tries.find((l) => l.length);
    if (list) out.push(draw(list, run, rnd));
  }
  return out;
}

/**
 * 拿了一张卡：记一级；带元素的卡、换进了某个元素按钮的招式字，押在那个元素上。
 * 招式字换进 el 的按钮：按钮的那一栏换掉；没学过的字记成学会，学过的形态（含本命形态，如风的爆）再换进来就是升级。
 * @param {Run} run @param {Card} c @param {string} [el] 招式字换进了哪个元素的按钮
 * @returns {Run}
 */
export function take(run, c, el) {
  const add = /** @type {string[]} */ ([c.el, ...(c.need ?? []), el].filter((e) => typeof e === 'string' && !run.invest.includes(e)));
  const next = { ...run, picks: run.picks + 1, have: { ...run.have, [c.id]: level(run, c.id) + 1 }, invest: [...run.invest, ...new Set(add)] };
  const set = MOVE_SET[c.id];
  if (c.kind !== 'move' || !set || !el) return next;
  const known = knows(run, el, c.id);
  return {
    ...next,
    moves: { ...run.moves, [el]: { ...run.moves[el], ...set } },
    learned: known ? run.learned : { ...run.learned, [el]: [...(run.learned[el] ?? []), c.id] },
    up: known && set.form ? { ...run.up, [`${el}:${set.form}`]: 1 } : run.up,
  };
}

/** 一张不拿（换回满气血与法力，由调用方去回满） @param {Run} run @returns {Run} */
export const skip = (run) => ({ ...run, picks: run.picks + 1, skips: run.skips + 1 });

/**
 * 重抽：每局 RUN.rerolls 次，用完返回 null。尽量不出刚才那几张。
 * @param {Run} run @param {{ els: string[], insight: boolean }} ctx @param {() => number} rnd @param {Card[]} shown 刚才那几张
 * @param {Card[]} [pool]
 * @returns {{ run: Run, cards: Card[] } | null}
 */
export function reroll(run, ctx, rnd, shown, pool = CARDS) {
  if (run.rerolls <= 0) return null;
  const next = { ...run, rerolls: run.rerolls - 1 };
  return { run: next, cards: offer(next, ctx, rnd, shown.map((c) => c.id), pool) };
}

/** 卡面上的升级标记：再拿第二次是「·二」（招式字升不升级看换进哪个按钮，选按钮时再标） @param {Run} run @param {Card} c */
export const upLabel = (run, c) => (c.kind !== 'move' && level(run, c.id) > 0 ? `·${'一二三四五'[level(run, c.id)]}` : '');

/**
 * 这一局拿过的心法合成的加成（守关、没拿的时候就是原值）。
 * @param {Run} run
 * @returns {{ perfectWindow: number, perfectGauge: number, manaRegen: number, ult: number,
 *             chana: boolean, fanshou: boolean, canying: boolean, yuwei: boolean }}
 *   perfectWindow：完美闪避窗口（秒）；perfectGauge：完美闪避加几格气势；manaRegen：法力回复倍数；ult：召龙要几格气势；
 *   chana / fanshou / canying / yuwei：拿没拿刹那、反手、残影、余威（怎么生效在 main.js 与 modes/trial.js）
 */
export function runMods(run) {
  const has = (/** @type {string} */ id) => level(run, id) > 0;
  return {
    perfectWindow: has('jianqie') ? RUN.arts.window : TRIAL.perfect.window,
    perfectGauge: has('juqi') ? RUN.arts.gauge : TRIAL.perfect.gauge,
    manaRegen: has('huiyuan') ? RUN.arts.regen : 1,
    ult: has('longyin') ? RUN.arts.ult : ULT_GAUGE,
    chana: has('chana'), fanshou: has('fanshou'), canying: has('canying'), yuwei: has('yuwei'),
  };
}

/**
 * 这一招吃不吃反手、余威：反手窗口里 × counter.mult（用掉这次窗口），余威窗口里 × after.mult，两个都在就相乘。
 * 窗口只在拿了对应心法时才会开（main.js），这里只看还剩几秒。
 * @param {{ counter: number, after: number }} t 两个窗口各还剩几秒
 * @returns {{ k: number, counter: boolean, after: boolean }}
 */
export function artBoost(t) {
  const counter = t.counter > 0, after = t.after > 0;
  return { k: (counter ? RUN.arts.counter.mult : 1) * (after ? RUN.arts.after.mult : 1), counter, after };
}

/**
 * 一招的伤害乘 k：每一步的总伤害、每颗伤害，召出来的龙也算。k 为 1 原样返回。
 * @template {{ steps: { dmgTotal: number, dmgEach: number }[], summon?: { dmg: number } }} P
 * @param {P} plan @param {number} k @returns {P}
 */
export function boostPlan(plan, k) {
  if (k === 1) return plan;
  const steps = plan.steps.map((s) => ({ ...s, dmgTotal: s.dmgTotal * k, dmgEach: s.dmgEach * k }));
  return { ...plan, steps, ...(plan.summon ? { summon: { ...plan.summon, dmg: plan.summon.dmg * k } } : {}) };
}
