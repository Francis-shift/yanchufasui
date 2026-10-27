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
 * 气势槽满、法力够、这条龙已开放 → 龙从施法者身旁破土而出，绕场一周俯冲砸向目标，范围伤害并带元素效果；
 * 否则"差一口气"：龙影现身又散去，化作同元素的雨（按雨正常扣法力），咒语卡写明差在哪。
 * 第一批只开冰龙；火龙等第三批（换材质复用冰龙的模型与飞行路线）。
 */
export const SUMMONS = {
  ice:     { name: '冰龙', cost: 40, dmg: 120, radius: 5 },
  fire:    { name: '火龙', cost: 40, dmg: 120, radius: 5 },
  wind:    { name: '风龙', cost: 40, dmg: 120, radius: 5 },
  earth:   { name: '土龙', cost: 40, dmg: 120, radius: 5 },
  thunder: { name: '雷龙', cost: 40, dmg: 120, radius: 5 },
};
export const SUMMON_OPEN = ['ice'];

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
 * 试炼模式的玩家：气血、走速（米/秒）、闪避（冲多远、多少秒冲完、冷却；冲刺中不受伤）、挨打后多少秒不再受伤；
 * 小傀儡贴身自爆的伤害。
 * 完美闪避：招落下前 window 秒内才闪、而且闪之前本来站在打得到的地方（或冲刺中被冰锥穿过）——周身爆白光、顿帧 stop 秒，
 * 回 mana 点法力、加 gauge 点气势，闪避冷却清零。
 */
export const TRIAL = { hp: 100, speed: 4.2, dash: { dist: 3.6, sec: 0.18, cd: 0.9 }, hurtGrace: 0.7, touchDmg: 8,
  perfect: { window: 0.3, stop: 0.2, mana: 10, gauge: 1 } };

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
/** 火卷风：半径、往前卷的速度和时长；豪火灭却：火柱长度和宽度（米） */
export const TORNADO = { r: 2.2, speed: 3.2, sec: 3 };
export const BEAM = { len: 15, halfW: 1.8 };

/** 墙：段与段的间距（米）、持续时间（秒）。土墙是实心的，会挡路；火冰风墙是一道帘子，穿过就挨一下 */
export const WALL = { gap: 1.1, earthSec: 8, curtainSec: 4 };
/** 雨：落点在目标周围多大范围（米）、每一滴砸中多大范围 */
export const RAIN = { spread: 2.6, hitR: 1.6 };
