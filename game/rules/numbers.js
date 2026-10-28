// @ts-check
/**
 * 游戏数值（初值）。来源：docs/设计文档.md 第 4 节。
 * 改数值只改这里；规则代码一律引用这里的常量，不写死数字。
 */

/** 法力与阵眼 */
export const MANA_MAX = 100;
export const MANA_REGEN = 8;          // 每秒恢复
export const CORE_HP = 100;

/** 形态：基础消耗、基础伤害 */
export const FORMS = {
  bolt:  { name: '弹', cost: 10, dmg: 30 },                   // 单体，飞向目标
  burst: { name: '爆', cost: 20, dmg: 20, radius: 3 },        // 落点半径 3 米
  wall:  { name: '墙', cost: 15, dmg: 15, segments: 5 },      // 一条线，5 段
  rain:  { name: '雨', cost: 25, dmg: 10, hits: 6, sec: 2 },  // 2 秒内落 6 次
};

/** 元素：伤害系数与附加效果 */
export const ELEMENTS = {
  fire:  { name: '火', mult: 1.3, burnDps: 5, burnSec: 3 },
  ice:   { name: '冰', mult: 0.7, freezeSec: 2, frozenTakenMult: 1.5 },
  wind:  { name: '风', mult: 0.3, push: 12 },                 // push：推出去的初速度（米/秒，约滑 4 米），推下悬崖直接消灭
  earth: { name: '土', mult: 1.0, wallSec: 8 },
  // 连锁：命中后跳到 range 米内最近的敌人，最多 jumps 次，每跳伤害 × decay；麻痹：停下不动 stunSec 秒
  thunder: { name: '雷', mult: 1.1, chain: { jumps: 2, range: 3, decay: 0.6 }, stunSec: 0.5 },
};

/** 威力：1～5，没说按 2；消耗与伤害都乘 1 + 0.5 × (威力 − 1) */
export const POWER_MIN = 1;
export const POWER_MAX = 5;
export const POWER_DEFAULT = 2;
/** @param {number} p */
export const powerFactor = (p) => 1 + 0.5 * (p - 1);

/** 弹的数量（1～3 颗）：消耗随颗数加，总伤害略高、分摊到每一颗 */
export const BOLT_COUNT_MAX = 3;
/** @param {number} n */
export const boltCostFactor = (n) => 1 + 0.4 * (n - 1);
/** @param {number} n */
export const boltTotalDmgFactor = (n) => 1 + 0.25 * (n - 1);

/** 组合：最多 3 步，一句话说完总消耗打八折 */
export const COMBO_MAX_STEPS = 3;
export const COMBO_DISCOUNT = 0.8;

/** 同一种「元素 + 形态」连续使用，伤害逐次 × 0.8；换一次就清零 */
export const REPEAT_DECAY = 0.8;

/** 气势 0～3 档对应的伤害倍数；同一句话再说一次气势减半（向下取整） */
export const MOMENTUM_MULT = [1.0, 1.1, 1.2, 1.3];
export const MOMENTUM_MAX = 3;

/** 图鉴里第一次用出的组合，这一发 +20% */
export const FIRST_DISCOVERY_MULT = 1.2;

/** 大招：气势槽满 8 点才能召唤 */
export const ULT_GAUGE = 8;

/**
 * 召唤（设计文档第 4 节"气势""大招"）：说的内容决定召唤谁，程序决定召不召得出。
 * 气势槽满、法力够、这条龙已开放 → 龙按自己的一套动作飞向目标（冰龙从施法者身旁破土、绕场一周俯冲，其余四条见下），范围伤害并带元素效果；
 * 否则"差一口气"：龙影现身又散去，化作同元素的雨（按雨正常扣法力），咒语卡写明差在哪。
 * 10-27 五条都开放，各有一套动作和落地（设计文档第 4 节"五元素龙"）。dmg 是砸地那一下，范围 radius；
 * 雷龙、风龙不砸地（dmg 当作这一招的伤害基数，气势和首次发现的加成按它和表里的比例乘到下面各自的数上）：
 *   火龙：低空横扫、一路喷火，落点火海 sea.sec 秒、每秒 sea.dps；雷龙：在目标上空盘一圈劈 strikes 道雷，每道 strike、连锁跳 jumps 个，雷劈过的地方（俯看）两侧 clear 米内冰锥全碎；
 *   风龙：落点卷起龙卷 sec 秒、一共 total，小怪吸向中心，场上冰锥全吹散；土龙：从目标脚下破土，四周竖一圈半径 ring 米的石墙 wallSec 秒。
 */
export const SUMMONS = {
  ice:     { name: '冰龙', cost: 40, dmg: 120, radius: 5 },
  fire:    { name: '火龙', cost: 40, dmg: 120, radius: 5, sea: { sec: 4, dps: 10 } },
  wind:    { name: '风龙', cost: 40, dmg: 120, radius: 5, sec: 3, total: 80 },
  earth:   { name: '土龙', cost: 40, dmg: 120, radius: 5, ring: 3.4, wallSec: 4 },
  thunder: { name: '雷龙', cost: 40, dmg: 120, radius: 5, strikes: 5, strike: 30, jumps: 3, clear: 2.5 },
};
export const SUMMON_OPEN = ['ice', 'fire', 'wind', 'earth', 'thunder'];

/**
 * 气势每一档都要看得出来（设计文档第 4 节）：伤害见 MOMENTUM_MULT；
 * 范围（爆的半径、雨的铺开、龙的砸地范围）× 下面第一行，特效大小与粒子量 × 第二行。
 */
export const MOMENTUM_RANGE = [1.0, 1.1, 1.2, 1.3];
export const MOMENTUM_FX = [1.0, 1.25, 1.5, 1.8];

/**
 * 天赋与按键（设计文档第 4 节"天赋与按键"，10-20 定）：开局从这几种元素里选，最多 TALENT_MAX 个；
 * 没开放的元素（PHASE.elements 里没有的，如还没做的雷）在选天赋界面上显示但选不了。
 */
export const TALENTS = ['fire', 'ice', 'wind', 'earth', 'thunder'];
export const TALENT_MAX = 3;
/** 每个天赋按钮的默认招（威力按 POWER_DEFAULT，照常扣法力） */
export const TALENT_DEFAULT = {
  fire:    { form: 'bolt',  target: 'front' },     // 火弹打最前面
  ice:     { form: 'bolt',  target: 'front' },     // 冰弹打最前面
  wind:    { form: 'burst', target: 'densest' },   // 风爆打最密集的一群，推下悬崖
  earth:   { form: 'wall',  target: 'front' },     // 土墙挡在最前面的敌人前方
  thunder: { form: 'bolt',  target: 'front' },     // 雷弹打最前面（连锁）
};
/** 按下天赋按钮后咏唱多久（毫秒）：这段时间里再按另一个天赋，两步合成一句（先后就是语序） */
export const BUTTON_CHANT_MS = 600;
/** 按键攒气势（按键的招不按描写打分）：一招打中 multiHitMin 个以上 +multiHit，打出融合或元素反应 +combo，一招最多 +max */
export const BUTTON_GAUGE = { multiHitMin: 3, multiHit: 1, combo: 2, max: 2 };

/** 输入与响应 */
export const INPUT_MAX_CHARS = 60;    // 一句最多 60 字（防刷）
export const SLOWMO_SCALE = 0.3;      // 开口就慢放到 0.3 倍
export const SLOWMO_MAX_SEC = 8;      // 单次最多 8 秒（现实时间）
export const PARSE_TIMEOUT_MS = 4500; // 超时就按关键词结果放（10-19 由 3.5 秒放宽：线上服务器到模型要 1～2.6 秒，常超时）
export const CHANT_MIN_MS = 800;      // 咏唱最短 0.8 秒

/** 敌人 */
export const ENEMIES = {
  grunt:    { name: '小傀儡', hp: 40,  speed: 2.0, coreDmg: 10 },
  shield:   { name: '盾傀儡', hp: 80,  speed: 1.2, coreDmg: 20, frontReduce: 0.8 },
  colossus: { name: '巨像',   hp: 300, speed: 0.6, coreDmg: 50, freezeMult: 0.5 },
  boss:     { name: '寒甲傀儡王', hp: 1500, speed: 1.3, coreDmg: 0, freezeMult: 0.5 },   // 试炼模式的 boss，招式与冰甲见下面 BOSS
  stone:    { name: '石甲巨像', hp: 1800, speed: 1.0, coreDmg: 0, freezeMult: 0.5 },     // 试炼的第二个 boss（10-28 加），招式与石甲见下面 STONE
  flame:    { name: '火灵', hp: 2100, speed: 1.4, coreDmg: 0, freezeMult: 0.5 },         // 试炼的第三个 boss（10-28 加），招式与火罩见下面 FLAME
  // 只在试炼的小怪潮里出现（10-28 加），怎么打人见下面 MINION
  archer:   { name: '符箓傀儡', hp: 30,  speed: 1.6, coreDmg: 10 },
  charger:  { name: '铁头傀儡', hp: 70,  speed: 1.7, coreDmg: 20 },
};

/**
 * 小怪潮里的另外两种小怪（10-28 加，我定的初值，等本人试玩）：
 * 符箓傀儡（archer）：离玩家保持 keep 米（太远就靠近、太近就后退、在区间里横着挪，横挪的速度 × strafe），
 *   每隔 every 秒（区间里随机）站住蓄力 aim 秒，朝玩家射一颗紫火球：飞 speed 米/秒、伤害 dmg、半径 r、飞 life 秒。和冰锥一样飞在齐腰高、地上有红点。
 * 铁头傀儡（charger）：追到 reach 米内、到玩家的直线没被挡着，就站住，地上亮一条宽 w 米的红条 tele 秒，然后沿直线冲 len 米（遇到障碍、广场边提前停），
 *   速度 speed；冲的路上撞到玩家扣 dmg；冲完晕 daze 秒（这时打它最好），cd 秒后才能再冲。
 */
export const MINION = {
  archer: { keep: [5.5, 8.5], strafe: 0.6, every: [2.4, 3.4], aim: 0.6, speed: 6, dmg: 10, r: 0.32, life: 3.2 },
  charger: { reach: 7, w: 1.2, tele: 0.8, len: 9, speed: 12, dmg: 15, daze: 1.2, cd: 2.5 },
};

/**
 * 试炼模式的 boss（设计文档第 2 节"试炼模式"；10-25 灰盒初值，试玩后再写进设计文档）：五招加冰甲。
 * 招随阶段变多（moves）：第 1 阶段砸地红圈、扇形横扫、召小傀儡；第 2 阶段加追踪冰锥；第 3 阶段再加旋转弹幕。
 * 冰甲只怕火：甲在时火照常伤害并削甲，别的元素只剩 armoredMult，也冻不住；削穿就碎，之后谁打都照常。
 * 血量降到 phases 两档换阶段：第 2 阶段冰甲重凝，第 3 阶段狂暴（红圈连砸两下、召得更多、弹幕多一条臂）。
 * 弹幕（冰锥）飞在齐腰高，地上有红点标出落在哪；碰到土墙就碎。weight：挑招时的分量。
 * pace：每个阶段预警、喘息、召唤冷却的倍数（越小越快）。冻住过一次，化开后 freezeGrace 秒内冻不住（免得被冰弹冻到死）。
 */
export const BOSS = {
  type: 'boss', el: 'ice', weak: 'fire', armorName: '冰甲', weakText: '融甲',   // 只怕 weak 这一种元素；挨那一下飘 weakText，别的元素飘 armorName
  armor: 120, armoredMult: 0.2, scale: 2.6, freezeGrace: 3, stunMax: 0.2,
  phases: [0.7, 0.3], pace: [1, 0.8, 0.62], recover: [1.3, 2.0], roarSec: 1.6, keepDist: 3.4, enrageSpeed: 1.3,
  moves: [['slam', 'sweep', 'summon'], ['slam', 'sweep', 'summon', 'homing'], ['slam', 'sweep', 'summon', 'homing', 'spiral']],
  slam:   { r: 2.6, tele: 1.2, dmg: 22, weight: 3 },                         // 红圈落在预警开始那一刻玩家站的地方
  sweep:  { r: 6, halfDeg: 60, tele: 1.0, dmg: 16, reach: 5, weight: 3 },     // 玩家在 reach 米内才用：朝玩家扫一扇
  summon: { tele: 0.9, n: [2, 3, 4], cd: 14, keep: 1 },                      // 场上小傀儡不超过 keep 只、离上次召过了 cd 秒才召
  // 追踪冰锥：先往上、往两边甩出去，落到齐腰高再追玩家；转向有上限（每秒 turn 弧度），侧着冲刺就甩得掉
  homing: { tele: 0.8, n: [3, 3, 5], speed: 6, turn: 1.8, life: 3.6, dmg: 12, r: 0.3, weight: 2 },
  // 旋转弹幕：原地转着往外喷冰锥，arms 条臂、每条每 every 秒一颗，持续 sec 秒；臂与臂之间的空当钻得过去
  spiral: { tele: 0.7, arms: [3, 3, 4], spin: 1.5, every: 0.14, sec: 2.4, speed: 5, dmg: 10, r: 0.3, weight: 2 },
};
/**
 * 第二个 boss 石甲巨像（土；设计文档第 4 节"第二个 boss"，10-28 我定的初值，等本人试玩）。换阶段、预警快慢（pace）、喘息、冻住后的保护照 BOSS。
 * 石甲只怕雷：雷照常伤害并削甲，别的元素只剩 armoredMult；削穿就碎，第 2 阶段重凝。
 * 招随阶段变多（moves）：第 1 阶段重踏（红圈，同寒甲傀儡王的砸地）、落石雨、蓄力冲撞、召小傀儡；第 2 阶段加一线地刺；第 3 阶段狂暴（落石更多、地刺三道、冲撞连冲两次）。
 * 落石雨（rocks）：在玩家四周落 n 块（第一块对准玩家此刻站的地方，其余落在玩家 spread 米内随机，块与块至少隔 apart 米），
 *   每块一个半径 r 的红圈，一块接一块落（间隔 gap 秒），每块预警 tele 秒。
 * 蓄力冲撞（charge）：蹲下蓄力，地上从脚下朝玩家亮一条宽 w 的红条（最长 len，撞到障碍、广场边就短），蓄力 tele 秒（按阶段，不跟 pace 走：
 *   要留得出打断的时间）；蓄力时挨够 breakDmg 伤害（石甲在时只有雷打得动）就被打断，硬直 stagger 秒、这时挨打 × staggerMult；
 *   没被打断就沿红条冲过去（每秒 speed 米），撞到人打 dmg；狂暴时冲完再蓄一次（times），第二次蓄力 × again。
 * 一线地刺（spikes）：从脚下朝玩家亮一条宽 w 的红条，tele 秒后地刺从近往远一路冒出来（每秒 speed 米，冒到广场边为止），刺到人打 dmg；
 *   狂暴时三道（lines），左右两道各偏 fanDeg 度。
 */
export const STONE = {
  type: 'stone', el: 'earth', weak: 'thunder', armorName: '石甲', weakText: '裂甲',
  armor: 150, armoredMult: 0.2, scale: 3.0,
  moves: [['slam', 'rocks', 'charge', 'summon'], ['slam', 'rocks', 'charge', 'spikes', 'summon'], ['slam', 'rocks', 'charge', 'spikes', 'summon']],
  slam:   { r: 3.0, tele: 1.3, dmg: 24, weight: 2 },
  rocks:  { tele: 1.1, n: [5, 6, 9], spread: 4.5, apart: 1.6, r: 1.3, gap: 0.22, dmg: 14, weight: 3 },
  charge: { tele: [2.2, 2.0, 1.8], again: 0.6, w: 2.4, len: 14, speed: 13, dmg: 26, breakDmg: 70, stagger: 2.6, staggerMult: 1.3, times: [1, 1, 2], weight: 3 },
  spikes: { tele: 0.9, w: 1.3, len: 16, speed: 11, dmg: 18, lines: [1, 1, 3], fanDeg: 28, weight: 3 },
  summon: { tele: 0.9, n: [2, 3, 3], cd: 16, keep: 1 },
};
/**
 * 第三个 boss 火灵（火；设计文档第 4 节"第三个 boss"，10-28 我定的初值，等本人试玩）。换阶段、预警快慢（pace）、喘息、冻住后的保护照 BOSS。
 * 火罩只怕冰：冰照常伤害并削罩，别的元素只剩 armoredMult；削穿就熄，第 2 阶段重燃（reform）。火灵不贴身，离玩家 keepDist 米就不再靠近。
 * 招随阶段变多（moves）：第 1 阶段满场火圈、追踪火球、召小傀儡；第 2 阶段加火环；第 3 阶段狂暴，加一道火浪，火圈烧两轮、火环连放两圈（times）。
 * 满场火圈（pyre）：第一个对准玩家此刻站的地方，其余 n - 1 个撒满整个广场，圈与圈至少隔 apart 米（放不下就少放），
 *   每个半径 r，tele 秒后一起喷火，人在圈里挨 dmg；第二轮重新对准人，预警 × again。
 * 追踪火球（homing）：同寒甲傀儡王的追踪冰锥，多一颗、转得快一点。
 * 火环（nova）：tele 秒后从脚下往外推一圈火，每秒 speed 米，一直推出广场；环上留一道 gapDeg 度的缺口（偏开玩家此刻的方向 gapOff 度区间里随机）。
 *   火环的前沿扫过人挨 dmg：跑进缺口，或者迎着火环闪避穿过去（完美闪避）；第二圈预警 × again、缺口另找地方。
 * 火浪（wave）：朝玩家亮一片越远越宽的红色梯形（形状同豪火灭却，BEAM），tele 秒后火浪推出去，浪头扫过人挨 dmg。
 */
export const FLAME = {
  type: 'flame', el: 'fire', weak: 'ice', armorName: '火罩', weakText: '熄焰', reform: '重燃',
  armor: 160, armoredMult: 0.2, scale: 2.4, keepDist: 6,
  moves: [['pyre', 'homing', 'summon'], ['pyre', 'homing', 'nova', 'summon'], ['pyre', 'homing', 'nova', 'wave', 'summon']],
  pyre:   { tele: 1.3, n: [7, 9, 11], apart: 3.6, r: 1.4, dmg: 16, times: [1, 1, 2], again: 0.7, weight: 3 },
  homing: { tele: 0.8, n: [3, 4, 5], speed: 6.5, turn: 2.0, life: 3.8, dmg: 12, r: 0.32, weight: 2 },
  nova:   { tele: 1.0, speed: 7, gapDeg: 50, gapOff: [45, 100], dmg: 18, times: [1, 1, 2], again: 0.8, weight: 2 },
  wave:   { tele: 1.4, dmg: 24, weight: 3 },
  summon: { tele: 0.9, n: [2, 3, 3], cd: 16, keep: 1 },
};
/**
 * 试炼模式的玩家：气血、走速（米/秒）、闪避（冲多远、多少秒冲完；冲刺中不受伤）、挨打后多少秒不再受伤；小傀儡贴身自爆的伤害。
 * 精力（10-27 本人提议）：满 max 格，闪一次花 1 格，每 regen 秒回 1 格；两次闪避之间至少隔 gap 秒（从按下算）。
 * 完美闪避：招落下前 window 秒内才闪、而且闪之前本来站在打得到的地方（或冲刺中被冰锥穿过）——周身爆白光、顿帧 stop 秒，
 * 回 mana 点法力、加 gauge 点气势、回 stamina 格精力。
 */
export const TRIAL = { hp: 100, speed: 4.2, dash: { dist: 3.6, sec: 0.18, gap: 0.35 }, stamina: { max: 3, regen: 1.2 },
  hurtGrace: 0.7, touchDmg: 8, perfect: { window: 0.3, stop: 0.2, mana: 10, gauge: 1, stamina: 1 } };
/**
 * 试炼的一局（设计文档第 4 节"试炼模式：一局与奖励"，10-27 定；初值，试玩再调）：
 * 小怪潮第几段出几只小傀儡（n）；开打后 first 秒冒第一批，之后隔 gap 秒（区间里随机）冒一批 batch 只（随机），
 * 每只落在广场上随机一处、离玩家至少 away 米，先冒 warn 秒紫烟再出来；场上同时最多 alive 只，满了等打掉再冒（10-27 本人：数量少、要随机刷新）；
 * 每只是哪种按这一段的 mix 抽（分量），符箓傀儡、铁头傀儡同时最多 cap 只，满了就出小傀儡（10-28：第 2 段加符箓傀儡，第 3 段再加铁头傀儡）；
 * 一段打完（小怪清空、boss 碎了）喘 rest 秒再选卡；每局重抽 rerolls 次；已经押过的元素，带这个元素的卡出现的分量 × owned。
 * 心法的数：见切把完美闪避窗口放到 window 秒，聚气完美闪避加 gauge 格，回元法力回复 × regen，龙吟召龙只要 ult 格；
 * 刹那：完美闪避后 slow.sec 秒（现实时间）全场慢到 slow.scale 倍，自己照常快；反手：完美闪避后 counter.sec 秒内下一招 × counter.mult；
 * 残影：闪避处留一个残影 ghost.sec 秒，追踪冰锥改追它、撞上就碎（ghost.r 是它的身宽）；余威：龙落地后 after.sec 秒内所有招 × after.mult。
 * 招式字升级（「爆·二」「墙·二」「雨·二」）：范围 × up（墙按段数算，5 段变 7 段）、伤害 × upDmg（10-27 本人：只加范围不够）。
 * 字诀（写进按钮的咒才生效，见 run.js runesOf）：破——打有甲的目标伤害 × po、不是火也削甲；连——放完 lian.sec 秒再放一次，伤害 × lian.mult、不花法力；
 * 重——伤害 × zhong.dmg、咏唱 × zhong.chant、放完 zhong.lock 秒不能闪避；疾——咏唱只要 ji.chantMs 毫秒、法力 × ji.cost；
 * 燎——落地留一片火 liao.sec 秒，每 liao.tick 秒烧一下（这一下伤害的 liao.k），同时最多 liao.max 片；凝——冻住的时间 × ning.freeze，
 * boss 被冻住后下一招预警 × ning.tele；回——风飞回施法者手上，路线两侧 hui.r 米内再挨一下（伤害 × hui.mult）；
 * 返——土墙把冰锥弹回 boss（快 fan.speed 倍、伤害 × fan.mult）；引——雷链多跳 yin.jumps 下，闪电两侧 yin.r 米内的冰锥打碎。
 * 领悟里改"怎么召龙"的两张（dragon）：
 *   双龙——一次两条，各打满额（10-28 本人：不打六成）；第二条晚 twin.delay 秒出，扑离第一条落点至少 twin.apart 米的另一群，没有就在同一处再砸一下；
 *   护身——龙不扑出去，从脚下钻出来绕着人转 guard.sec 秒（半径 r、离地 h、每秒 speed 米，人走圈跟着走），再冲上天：
 *   龙身贴地那几段 block 米内的冰锥打碎；碰到龙身（reach 米加敌人身宽）的敌人挨这条龙伤害的 touch 倍、吃它的元素效果，
 *   同一只每 every 秒最多挨一下。两张都拿了：第二条在外圈（半径 + outer.dr、高 + outer.dh）反着转。
 */
export const RUN = {
  wave: { n: [16, 22, 28], first: 1.2, gap: [1.2, 2.8], batch: [2, 3], away: 5, warn: 0.8, alive: 10,
    mix: [{ grunt: 1 }, { grunt: 0.7, archer: 0.3 }, { grunt: 0.55, archer: 0.25, charger: 0.2 }], cap: { archer: 3, charger: 2 } },
  rest: 1.6, rerolls: 1, owned: 2,
  up: 1.35, upDmg: 1.3,
  arts: { window: 0.45, gauge: 2, regen: 1.3, ult: 6, slow: { sec: 1, scale: 0.3 }, counter: { sec: 1.5, mult: 1.5 },
    ghost: { sec: 1.5, r: 0.45 }, after: { sec: 4, mult: 1.3 } },
  runes: { po: 2, lian: { sec: 0.5, mult: 0.5 }, zhong: { dmg: 1.6, chant: 2, lock: 0.5 }, ji: { chantMs: 200, cost: 1.3 },
    liao: { sec: 3, r: 1.3, tick: 0.5, k: 0.1, max: 10 }, ning: { freeze: 1.5, tele: 1.5 }, hui: { mult: 0.6, r: 1.1 },
    fan: { speed: 1.3, mult: 2 }, yin: { jumps: 2, r: 0.9 } },
  dragon: { twin: { delay: 1.2, apart: 6 },
    guard: { sec: 5, r: 3.6, h: 1.2, speed: 13, block: 1.0, reach: 0.9, touch: 0.25, every: 0.8, outer: { dr: 1.6, dh: 0.7 } } },
};

/** 元素反应（只在程序里判断）：先中的元素 + 后来的元素 */
export const REACTIONS = {
  'ice+fire':   { name: '蒸汽爆', bonusAoe: 40 },   // 解除冻结，额外 40 点范围伤害
  'ice+wind':   { name: '碎冰', frozenMult: 2 },    // 被冻住的目标受 2 倍伤害
  'wind+fire':  { name: '火旋风', radiusMult: 1.5 },// 火的作用范围 × 1.5
  'earth+wind': { name: '落石', rockDmg: 30 },      // 石墙被风推出
  'ice+thunder': { name: '导电' },                  // 冻住的敌人之间连锁不衰减
};
/** 已经做好的反应（arbiter.js damageTo / chainTargets 里判断的）；火旋风、落石 10-20 顺延到第二批，选天赋的羁绊里先不列 */
export const REACTION_OPEN = ['ice+fire', 'ice+wind', 'ice+thunder'];

/**
 * 当前批次开放的原件。中期只开火 / 冰 / 风 × 弹 / 爆，第一批起火冰风土雷 × 弹爆墙雨全开；
 * 设计里有、还没做的，说到时未生效或降级成最接近的开放原件，并在咒语卡上注明。
 */
export const PHASE = {
  elements: ['fire', 'ice', 'wind', 'earth', 'thunder'],   // 第一批起土开放；雷 10-20 开放（天赋要用，从第二批提前）
  forms: ['bolt', 'burst', 'wall', 'rain'],
  /** 未开放形态 → 降级成哪个（现在全开，留着给以后的新形态用） */
  formFallback: {},
};

/**
 * 法术融合（设计文档第 4 节）：同一句里相邻两步、元素不同、目标相同、且在这张表里，就合成一个法术。
 * 键是「先>后」，顺序决定结果。先控后打的（冰→火、冰→风）不在表里，仍走打在敌人身上的反应。
 */
export const FUSIONS = {
  'wind>fire':    { name: '火卷风',   el: 'fire',    idiom: '风助火势' },   // 龙卷风被点燃，往前卷，把敌人卷起来烧
  'fire>wind':    { name: '豪火灭却', el: 'fire',    idiom: '火借风威' },   // 从身前推出一整片往前翻滚的火浪，越推越宽（10-27 由"烈焰冲击"改名）
  'wind>ice':     { name: '暴风雪',   el: 'ice',     idiom: '风雪交加' },   // 第二批
  'wind>thunder': { name: '雷暴',     el: 'thunder', idiom: '风雷激荡' },   // 第二批（雷开放后）
  'earth>fire':   { name: '陨火',     el: 'fire',    idiom: '天火坠石' },   // 第二批
};
/** 当前开放的融合（第一批只开风火两种） */
export const FUSION_OPEN = ['wind>fire', 'fire>wind'];
/** 融合伤害 = 两步之和 × 1.2（消耗沿用组合八折，不另算） */
export const FUSION_DMG_MULT = 1.2;
/**
 * 火卷风：半径、往前卷的速度和时长。
 * 豪火灭却（10-27 由直的火柱改成往前推的火浪）：推多远（米）、起点和尽头的半宽（越推越宽）、浪头每秒推几米。
 * 浪头扫到谁才烧谁，判定见 rules/fusion.js。
 */
export const TORNADO = { r: 2.2, speed: 3.2, sec: 3 };
export const BEAM = { len: 14, w0: 1.2, w1: 4.2, speed: 13 };

/** 墙：段与段的间距（米）、持续时间（秒）。土墙是实心的，会挡路；火冰风墙是一道帘子，穿过就挨一下 */
export const WALL = { gap: 1.1, earthSec: 8, curtainSec: 4 };
/** 雨：落点在目标周围多大范围（米）、每一滴砸中多大范围 */
export const RAIN = { spread: 2.6, hitR: 1.6 };
