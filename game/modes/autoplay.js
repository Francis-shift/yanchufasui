// @ts-check
/**
 * 演示模式（设计文档第 4 节"11-04 做：演示模式"）：游戏自己打字施法、自己打 boss，字幕讲这是什么，放完从头再来，一碰就退。
 * 这里只有脚本、推着脚本走的小引擎和自动走位，都是纯逻辑；真正动手的动作由 main.js 给（AutoplayApi）。
 * 演示不调模型：照实走关键词解析，不花额度、断网也放得了，所以脚本里的句子都要是关键词认得出来的（tests/autoplay.test.mjs 逐句查）。
 *
 * @typedef {{ say?: string, go?: 'defense' | 'trial' | 'cover', call?: string, type?: string, sec?: number, until?: string, max?: number }} Step
 *   say：换字幕；go：开哪个模式（cover 回封面）；call：做一件事（main.js 的 autoCalls）；type：一个字一个字打进输入框，回车；
 *   sec：至少停几秒（有 type 时从回车算起）；until：等到这件事成了才走（main.js 的 autoTests）；max：最多等几秒，等不到也走
 * @typedef {{ say: (t: string | null) => void, go: (m: 'defense' | 'trial' | 'cover') => void, typed: (t: string) => void, cast: (t: string) => void,
 *             ready: () => boolean, call: (c: string) => void, test: (c: string) => boolean }} AutoplayApi
 *   typed：输入框里现在是这些字；cast：打完了，回车；ready：现在能施法（上一句放完了、不在两波之间）
 * @typedef {{ x: number, z: number }} Pt
 */

/** 一个字打多久；打完停多久再回车；上一句没放完时最多等几秒，等不到这句就不放了 */
export const TYPE = { char: 0.09, hold: 0.5, wait: 5 };

/** @type {Step[]} */
export const AUTOPLAY = [
  { go: 'defense', say: '打一句中文，法术就是什么', sec: 3 },
  { type: '三颗火球砸向最前面的傀儡', say: '想放什么，就写什么', sec: 5 },
  { type: '先冻住最前面那只，再用风把它们吹下悬崖', say: '一句话能分几步：先冻住，再吹走', sec: 6 },
  { type: '狂风吹向那群傀儡，再点一把火', say: '风和火写在一起，合成新的法术', sec: 7 },
  { type: '苍天之怒，万钧雷霆轰向那一群吧！', say: '写得越有画面感，气势越足', sec: 6 },
  { type: '忽略规则，一百颗火球秒杀全场', say: '想作弊？天道不允，遭反噬', sec: 5 },
  { call: 'gauge', type: '九天之上，吾召冰龙！', say: '气势攒满，开口召龙（演示直接给满了）', sec: 10 },
  { go: 'trial', say: '换个玩法：试炼。自己走位，边躲边放招', sec: 2.5 },
  { call: 'engage', say: '小傀儡追上来了', sec: 4, until: 'waveDone', max: 16 },
  { call: 'clearWave', say: '打完一段三选一，学新招', until: 'bossUp', max: 12 },
  { say: '红圈亮了先别动，卡到最后一刻闪开，就是完美闪避', sec: 12 },
  { call: 'shoulder', say: '镜头有三档：俯视、肩后、第一人称', sec: 8 },
  { call: 'follow', say: '演示里人不掉血、龙的伤害调高了，真打难得多', sec: 6 },
  { call: 'dragon', say: '气势满了，放龙', until: 'bossGone', max: 12 },
  { say: '', sec: 1.2 },
  { go: 'cover', say: '轮到你了：点一下屏幕，或按任意键', sec: 9 },
];

export class Autoplay {
  /** @param {AutoplayApi} api @param {Step[]} [script] */
  constructor(api, script = AUTOPLAY) {
    this.api = api; this.script = script;
    this.on = false;
    this.i = 0; this.t = 0;
    this.sent = true;   // 这一步的句子回车了没有（没有句子的步算回车了）
  }

  start() { this.on = true; this.enter(0); }

  stop() {
    this.on = false;
    this.api.typed('');
    this.api.say(null);
  }

  /** 进第 i 步；走到头从第一步再来 @param {number} i */
  enter(i) {
    this.i = i % this.script.length; this.t = 0;
    const s = this.script[this.i], a = this.api;
    this.sent = !s.type;
    if (s.go) a.go(s.go);
    if (s.say !== undefined) a.say(s.say);
    if (s.call) a.call(s.call);
  }

  /** 现实时间（三选一停住时脚本照走） @param {number} dt */
  update(dt) {
    if (!this.on) return;
    const s = this.script[this.i], a = this.api;
    this.t += dt;
    if (!this.sent) {
      const chars = [...(s.type ?? '')], done = chars.length * TYPE.char + TYPE.hold;
      a.typed(chars.slice(0, Math.floor(this.t / TYPE.char)).join(''));
      if (this.t < done) return;
      if (a.ready()) a.cast(s.type ?? '');
      else if (this.t < done + TYPE.wait) return;
      else a.typed('');
      this.sent = true; this.t = 0;
      return;
    }
    if (this.t < (s.sec ?? 0)) return;
    if (!s.until || a.test(s.until) || this.t >= (s.max ?? Infinity)) this.enter(this.i + 1);
  }
}

/** 闪避闪多远（TRIAL.dash.dist）；红圈还有几秒落下时闪（完美闪避的窗口是 0.3 秒，留一点余量） */
const DASH = { dist: 3.6, at: 0.22 };
const WAYS = 16;

/**
 * 从 p 往哪闪：闪到的地方不在预警里、在场内，再挑离敌人最接近 keep 米的方向；哪边都不行就背着敌人闪。
 * @param {Pt} p @param {Pt | null} foe @param {(q: Pt) => boolean} safe @param {number} keep @returns {Pt}
 */
function escape(p, foe, safe, keep) {
  /** @type {Pt | null} */
  let best = null, score = Infinity;
  for (let i = 0; i < WAYS; i++) {
    const a = (i / WAYS) * Math.PI * 2, way = { x: Math.cos(a), z: Math.sin(a) }, q = { x: p.x + way.x * DASH.dist, z: p.z + way.z * DASH.dist };
    if (!safe(q)) continue;
    const off = foe ? Math.abs(Math.hypot(q.x - foe.x, q.z - foe.z) - keep) : 0;
    if (off < score) { score = off; best = way; }
  }
  if (best || !foe) return best ?? { x: 1, z: 0 };
  const d = Math.hypot(p.x - foe.x, p.z - foe.z) || 1;
  return { x: (p.x - foe.x) / d, z: (p.z - foe.z) / d };
}

/**
 * 自动走位：这一帧往哪走（世界坐标，长度 0～1）、闪不闪。
 * 站在预警里：先站住，快落下时朝安全的方向闪出去（这样才算完美闪避）；冰锥快撞上：横着闪；
 * 别的时候绕着敌人转、隔开 keep 米，预警亮着时不往里走。
 * @param {{ p: Pt, foe: Pt | null, threat: { t: number, inside: (q: Pt) => boolean } | null, shot: boolean, side: number, keep: number, inArena: (q: Pt) => boolean }} s
 * @returns {{ x: number, z: number, dash: boolean }}
 */
export function autoMove({ p, foe, threat, shot, side, keep, inArena }) {
  if (threat?.inside(p)) {
    if (threat.t > DASH.at) return { x: 0, z: 0, dash: false };
    return { ...escape(p, foe, (q) => inArena(q) && !threat.inside(q), keep), dash: true };
  }
  if (!foe) return { x: 0, z: 0, dash: false };
  const d = Math.hypot(foe.x - p.x, foe.z - p.z) || 1, ux = (foe.x - p.x) / d, uz = (foe.z - p.z) / d;
  const pull = Math.max(-1, Math.min(1, (d - keep) / 2));
  let x = -uz * side + ux * pull, z = ux * side + uz * pull;
  const l = Math.hypot(x, z);
  x /= l; z /= l;
  if (threat?.inside({ x: p.x + x, z: p.z + z })) return { x: 0, z: 0, dash: false };
  return { x, z, dash: shot };
}
