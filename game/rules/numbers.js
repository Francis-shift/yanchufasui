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
};

/** 元素反应（只在程序里判断）：先中的元素 + 后来的元素 */
export const REACTIONS = {
  'ice+fire':   { name: '蒸汽爆', bonusAoe: 40 },   // 解除冻结，额外 40 点范围伤害
  'ice+wind':   { name: '碎冰', frozenMult: 2 },    // 被冻住的目标受 2 倍伤害
  'wind+fire':  { name: '火旋风', radiusMult: 1.5 },// 火的作用范围 × 1.5
  'earth+wind': { name: '落石', rockDmg: 30 },      // 石墙被风推出
};

/**
 * 当前批次开放的原件。中期：火 / 冰 / 风 × 弹 / 爆；其余在设计里有、还没做，
 * 说到时降级成最接近的开放原件并在咒语卡上注明。
 */
export const PHASE = {
  elements: ['fire', 'ice', 'wind'],
  forms: ['bolt', 'burst'],
  /** 未开放形态 → 降级成哪个 */
  formFallback: { wall: 'burst', rain: 'burst' },
};
