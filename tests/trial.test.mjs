// 试炼模式的规则（game/rules/trial.js）：冰甲只怕火、石甲只怕雷、石甲巨像的落石与地刺、70% / 30% 换阶段、挑招、红圈与扇形的判定、玩家被挡在广场里、小怪潮。
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { damageTo } from '../game/rules/arbiter.js';
import { BOSS, ENEMIES, MINION, RUN, STONE, TRIAL } from '../game/rules/numbers.js';
import {
  archerIntent, bossHit, bossPhase, canDash, chargeLen, homingTurn, inCircle, inSector, inStrip, isPerfect, keepInArena, nextBatch, pickMinion, pickMove,
  recoverSec, regenStamina, rockSpots, slamCount, spawnSpot, spikeDirs, spikeReach, spiralAngles, teleSec,
} from '../game/rules/trial.js';

const MAX = ENEMIES.boss.hp;
const hit = (el, dmg, frozen = false) => damageTo({ type: 'boss', frozen }, { el, dmg });

test('冰甲：甲在时火照常伤害并削甲，别的元素只剩两成、也冻不住', () => {
  const b = { armor: BOSS.armor, freezeCd: 0 };
  const fire = bossHit(b, 'fire', hit('fire', 50));
  assert.equal(fire.r.dmg, 50);
  assert.equal(fire.armor, BOSS.armor - 50);
  assert.equal(fire.broke, false);
  for (const el of ['ice', 'wind', 'earth', 'thunder']) {
    const h = bossHit(b, el, hit(el, 50));
    assert.equal(h.r.dmg, 50 * BOSS.armoredMult, `${el} 打在冰甲上`);
    assert.equal(h.armor, BOSS.armor, `${el} 不削甲`);
    assert.equal(h.r.freezeSec, 0, `${el} 甲在时冻不住`);
    assert.equal(h.r.reaction, '冰甲');
  }
});

test('字诀「破」：甲在时伤害翻倍、不打两成，什么元素都削甲；没有甲就照常', () => {
  const b = { armor: BOSS.armor, freezeCd: 0 };
  for (const el of ['ice', 'fire', 'thunder']) {
    const h = bossHit(b, el, hit(el, 50), true);
    assert.equal(h.r.dmg, 50 * RUN.runes.po, `${el}`);
    assert.equal(h.armor, BOSS.armor - 50, `${el} 削掉的按翻倍前算`);
    assert.equal(h.r.freezeSec, 0, '甲在时照样冻不住');
  }
  assert.equal(bossHit(b, 'ice', hit('ice', 50), true).r.reaction, '破甲');
  assert.equal(bossHit({ armor: 40, freezeCd: 0 }, 'ice', hit('ice', 50), true).broke, true);
  assert.equal(bossHit({ armor: 0, freezeCd: 0 }, 'ice', hit('ice', 31.5), true).r.dmg, 31.5, '甲碎了不再翻倍');
});

test('冰甲：火削穿就碎，碎了之后冰能冻、伤害照常', () => {
  const broke = bossHit({ armor: 30, freezeCd: 0 }, 'fire', hit('fire', 58.5));
  assert.equal(broke.armor, 0);
  assert.equal(broke.broke, true);
  const ice = bossHit({ armor: 0, freezeCd: 0 }, 'ice', hit('ice', 31.5));
  assert.equal(ice.r.dmg, 31.5);
  assert.ok(ice.r.freezeSec > 0, '甲碎了冻得住');
  assert.equal(bossHit({ armor: 0, freezeCd: 0 }, 'fire', hit('fire', 40)).broke, false, '没有甲就谈不上碎');
});

test('boss 风推不动、麻痹有上限；冻过一次，化开后一段时间内冻不住', () => {
  const wind = bossHit({ armor: 0, freezeCd: 0 }, 'wind', hit('wind', 9));
  assert.equal(wind.r.push, 0);
  const th = bossHit({ armor: 0, freezeCd: 0 }, 'thunder', hit('thunder', 30));
  assert.ok(th.r.stunSec <= BOSS.stunMax);
  const again = bossHit({ armor: 0, freezeCd: 1.5 }, 'ice', hit('ice', 31.5));
  assert.equal(again.r.freezeSec, 0);
});

test('冻住的 boss 吃火：蒸汽爆照常（甲碎了才冻得住，所以不会和冰甲冲突）', () => {
  const r = bossHit({ armor: 0, freezeCd: 0 }, 'fire', hit('fire', 40, true));
  assert.equal(r.r.reaction, '蒸汽爆');
  assert.ok(r.r.aoeBonus > 0);
});

test('阶段：70% 以上第 1 阶段，30%～70% 第 2 阶段，30% 及以下狂暴', () => {
  assert.equal(bossPhase(MAX, MAX), 1);
  assert.equal(bossPhase(MAX * 0.71, MAX), 1);
  assert.equal(bossPhase(MAX * 0.7, MAX), 2);
  assert.equal(bossPhase(MAX * 0.31, MAX), 2);
  assert.equal(bossPhase(MAX * 0.3, MAX), 3);
  assert.equal(bossPhase(0, MAX), 3);
});

test('阶段越后，预警越短、喘息越短；狂暴时红圈连砸两下', () => {
  for (const m of /** @type {const} */ (['slam', 'sweep', 'summon', 'homing', 'spiral'])) {
    assert.ok(teleSec(m, 1) > teleSec(m, 2) && teleSec(m, 2) > teleSec(m, 3), m);
  }
  assert.ok(recoverSec(1, 0.5) > recoverSec(3, 0.5));
  assert.deepEqual([1, 2, 3].map(slamCount), [1, 1, 2]);
  // 狂暴的红圈预警也要躲得开：走速 4.2 米/秒，从圆心走出圈（加身体半径）要的时间小于预警
  assert.ok((BOSS.slam.r + 0.35) / 4.2 < teleSec('slam', 3), '狂暴的红圈从圆心走得出去');
});

const ROLLS = Array.from({ length: 50 }, (_, i) => (i + 0.5) / 50);
const movesAt = (phase, s) => new Set(ROLLS.map((r) => pickMove(phase, s, r)));

test('挑招：冷却好了、场上小傀儡少就召；远了不横扫；招随阶段变多', () => {
  const far = { dist: 8, minions: 0, sinceSummon: 0 }, near = { ...far, dist: 3 };
  assert.deepEqual([...movesAt(1, far)], ['slam'], '第 1 阶段远了只砸红圈');
  assert.deepEqual([...movesAt(1, near)].sort(), ['slam', 'sweep'], '第 1 阶段近了砸或扫');
  assert.ok(movesAt(2, far).has('homing') && !movesAt(2, near).has('spiral'), '第 2 阶段加追踪冰锥，还没有旋转弹幕');
  assert.ok(movesAt(3, near).has('spiral') && movesAt(3, near).has('homing'), '第 3 阶段再加旋转弹幕');
  for (const ph of [1, 2, 3]) assert.ok(!movesAt(ph, far).has('sweep'), `第 ${ph} 阶段远了不横扫`);
  assert.equal(pickMove(1, { ...far, sinceSummon: BOSS.summon.cd }, 0.5), 'summon');
  assert.equal(pickMove(1, { ...far, sinceSummon: BOSS.summon.cd, minions: BOSS.summon.keep + 1 }, 0.5), 'slam', '场上傀儡多就不召');
  assert.equal(pickMove(3, { ...far, sinceSummon: BOSS.summon.cd * BOSS.pace[2] }, 0.5), 'summon', '狂暴时召得更勤');
});

test('挑招：刚出过的那招不连着出（只剩一招时除外）', () => {
  assert.ok(!movesAt(3, { dist: 3, minions: 9, sinceSummon: 0, last: 'slam' }).has('slam'));
  assert.ok(!movesAt(2, { dist: 8, minions: 9, sinceSummon: 0, last: 'homing' }).has('homing'));
  assert.deepEqual([...movesAt(1, { dist: 8, minions: 9, sinceSummon: 0, last: 'slam' })], ['slam'], '远处第 1 阶段只有红圈');
});

test('完美闪避：落下前 0.3 秒内才闪、闪前站在范围里才算', () => {
  assert.equal(isPerfect(0.1, true), true);
  assert.equal(isPerfect(TRIAL.perfect.window + 0.05, true), false, '闪早了');
  assert.equal(isPerfect(0.1, false), false, '本来就不在范围里');
  assert.equal(isPerfect(Infinity, true), false, '没闪');
});

test('追踪冰锥：转向有上限、快慢不变；贴脸时侧闪一下，这一趟追不上', () => {
  const v = { x: 6, z: 0 };
  homingTurn(v, { x: 0, z: 0 }, { x: 0, z: 10 }, BOSS.homing.turn, 0.1);
  assert.ok(Math.abs(Math.atan2(v.z, v.x) - BOSS.homing.turn * 0.1) < 1e-9, '一帧只转 turn × dt');
  assert.ok(Math.abs(Math.hypot(v.x, v.z) - 6) < 1e-9);
  // 冰锥 1.5 米外直冲过来，玩家往侧面闪 3.6 米：跟着拐的这 0.8 秒里碰不到人
  const H = BOSS.homing, b = { x: -1.5, z: 0 }, bv = { x: H.speed, z: 0 }, me = { x: 0, z: TRIAL.dash.dist };
  let closest = Infinity;
  for (let t = 0; t < 0.8; t += 1 / 60) {
    homingTurn(bv, b, me, H.turn, 1 / 60);
    b.x += bv.x / 60; b.z += bv.z / 60;
    closest = Math.min(closest, Math.hypot(b.x - me.x, b.z - me.z));
  }
  assert.ok(closest > H.r + 0.35, `最近 ${closest.toFixed(2)} 米`);
  // 站着不动就会被追上
  const b2 = { x: -6, z: 2 }, v2 = { x: H.speed, z: 0 }, still = { x: 0, z: 0 };
  let hit = false;
  for (let t = 0; t < H.life && !hit; t += 1 / 60) {
    homingTurn(v2, b2, still, H.turn, 1 / 60);
    b2.x += v2.x / 60; b2.z += v2.z / 60;
    hit = Math.hypot(b2.x, b2.z) < H.r + 0.35;
  }
  assert.ok(hit, '站着不动会被追上');
});

test('旋转弹幕：几条臂均匀分开、跟着时间转', () => {
  const a = spiralAngles(0, 4, 0), b = spiralAngles(1, 4, 0);
  assert.ok(Math.abs(a[1] - a[0] - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(b[0] - a[0] - BOSS.spiral.spin) < 1e-9);
  // 离 boss 4 米处，两条臂之间的空当比人宽得多（钻得过去）；同一条臂上前后两颗隔 speed × every
  const gap = (2 * Math.PI * 4) / BOSS.spiral.arms[2] - 2 * BOSS.spiral.r;
  assert.ok(gap > 2, `空当 ${gap.toFixed(1)} 米`);
});

test('判定：红圈碰到身体就算；扇形只打前方', () => {
  const c = { x: 0, z: 0 };
  assert.ok(inCircle({ x: 2.8, z: 0 }, c, 2.6, 0.35));
  assert.ok(!inCircle({ x: 3.0, z: 0 }, c, 2.6, 0.35));
  const dir = { x: 0, z: -1 }, half = (60 * Math.PI) / 180;
  assert.ok(inSector({ x: 0, z: -4 }, c, dir, half, 6), '正前方');
  assert.ok(inSector({ x: 3, z: -2 }, c, dir, half, 6), '前方偏 56°');
  assert.ok(!inSector({ x: 3, z: -1 }, c, dir, half, 6), '偏 72°，在扇形外');
  assert.ok(!inSector({ x: 0, z: 4 }, c, dir, half, 6), '背后');
  assert.ok(!inSector({ x: 0, z: -6.5 }, c, dir, half, 6, 0.35), '太远');
});

test('走位：撞进障碍推到边上，走出广场拉回来', () => {
  const p = keepInArena({ x: 0.2, z: 0 }, [{ x: 0, z: 0, r: 1 }], 10, 0.35);
  assert.ok(Math.abs(Math.hypot(p.x, p.z) - 1.35) < 1e-9);
  const q = keepInArena({ x: 30, z: 40 }, [], 10);
  assert.ok(Math.abs(Math.hypot(q.x, q.z) - 10) < 1e-9);
  assert.ok(q.x > 0 && q.z > 0, '方向不变');
});

test('精力：够 1 格、离上次按闪避过了间隙才闪得出；每 regen 秒回 1 格，不超过上限', () => {
  const S = TRIAL.stamina, G = TRIAL.dash.gap;
  assert.equal(canDash(S.max, Infinity), true);
  assert.equal(canDash(0.99, Infinity), false, '差一点不到 1 格闪不出');
  assert.equal(canDash(S.max, G - 0.01), false, '连按太快：间隙没到');
  // 满格狂按 6 秒（每 0.05 秒按一下）：前 max 下隔着间隙连着闪出来，之后要等精力回上来，大约每 regen 秒一下
  const dt = 0.05, at = /** @type {number[]} */ ([]);
  let s = S.max;
  for (let i = 0; i < 120; i++) {
    const t = i * dt;
    if (canDash(s, at.length ? t - at[at.length - 1] + 1e-9 : Infinity)) { s -= 1; at.push(t); }
    s = regenStamina(s, dt);
  }
  for (let i = 1; i < S.max; i++) assert.ok(at[i] - at[i - 1] <= G + dt + 1e-9, `第 ${i + 1} 下跟着间隙连上`);
  assert.ok(at[S.max] - at[S.max - 1] > G + dt, '满格用完要等精力');
  const tail = at.slice(S.max), avg = (tail[tail.length - 1] - tail[0]) / (tail.length - 1);
  assert.ok(Math.abs(avg - S.regen) <= dt + 1e-9, `用完之后平均 ${avg.toFixed(2)} 秒一下`);
  assert.equal(regenStamina(0, S.regen), 1);
  assert.equal(regenStamina(S.max - 0.1, 10), S.max);
  // 完美闪避回的精力不比闪一次花的多：冲刺中被打到也算完美，不能靠它无限闪
  assert.ok(TRIAL.perfect.stamina <= 1);
  assert.ok(G > TRIAL.dash.sec, '两次闪避之间有一段不是无敌的');
});

/** 固定种子的随机数 @param {number} seed */
const seeded = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

test('小怪潮：每批冒的只数、间隔在设定的区间里，不超过还剩的；落点在广场上、离玩家够远', () => {
  const W = RUN.wave, rnd = seeded(7);
  for (let i = 0; i < 200; i++) {
    const b = nextBatch(10, rnd);
    assert.ok(b.n >= W.batch[0] && b.n <= W.batch[1]);
    assert.ok(b.gap >= W.gap[0] && b.gap <= W.gap[1]);
  }
  assert.equal(nextBatch(1, rnd).n, 1, '只剩一只就冒一只');
  const R = 8, me = { x: 2, z: 1 }, block = [{ x: 0, z: 0, r: 1.5 }];
  const spots = Array.from({ length: 300 }, () => spawnSpot(rnd, me, R, W.away, block));
  for (const p of spots) {
    assert.ok(Math.hypot(p.x, p.z) <= R + 1e-9, '在广场上');
    assert.ok(Math.hypot(p.x, p.z) >= 1.5 + 0.3 - 1e-9, '不在障碍里');
    assert.ok(Math.hypot(p.x - me.x, p.z - me.z) >= W.away, '离玩家够远');
  }
  // 随机：落点散在四个象限里，不是只在一条边上
  const quads = new Set(spots.map((p) => `${p.x > 0}${p.z > 0}`));
  assert.equal(quads.size, 4);
  // 广场太小、离谁都近：取试过里最远的，不卡死
  const p = spawnSpot(rnd, { x: 0, z: 0 }, 2, 10, []);
  assert.ok(Math.hypot(p.x, p.z) <= 2 + 1e-9);
});
test('小怪潮：第一段只有小傀儡；后面按分量混进新小怪，到了同时上限就不再抽它', () => {
  const W = RUN.wave, rnd = seeded(11);
  for (let i = 0; i < 100; i++) assert.equal(pickMinion(W.mix[0], {}, W.cap, rnd), 'grunt');
  const count = (mix, alive) => {
    const c = {};
    for (let i = 0; i < 2000; i++) { const k = pickMinion(mix, alive, W.cap, rnd); c[k] = (c[k] ?? 0) + 1; }
    return c;
  };
  const c3 = count(W.mix[2], {});
  for (const k of Object.keys(W.mix[2])) assert.ok(Math.abs(c3[k] / 2000 - W.mix[2][k]) < 0.05, `${k} 的比例接近分量`);
  // 符箓傀儡满了：只剩另外两种
  const full = count(W.mix[2], { archer: W.cap.archer });
  assert.equal(full.archer, undefined);
  assert.ok(full.charger > 0 && full.grunt > 0);
  // 新小怪都满了：只冒小傀儡
  assert.deepEqual(Object.keys(count(W.mix[2], { archer: 9, charger: 9 })), ['grunt']);
  // 每段都有小傀儡兜底，分量加起来是 1
  for (const m of W.mix) {
    assert.ok(m.grunt > 0);
    assert.ok(Math.abs(Object.values(m).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  }
});

test('符箓傀儡：太远靠近、太近后退、在区间里横挪；射程够得到它站的最远处', () => {
  const k = MINION.archer.keep;
  assert.equal(archerIntent(k[1] + 0.1), 1);
  assert.equal(archerIntent(k[0] - 0.1), -1);
  assert.equal(archerIntent((k[0] + k[1]) / 2), 0);
  const a = MINION.archer;
  assert.ok(a.speed * a.life > k[1] + 2, '火球飞得到');
  // 火球比玩家走得慢，看见了就躲得开
  assert.ok(a.speed < TRIAL.speed * 1.5);
});

test('铁头傀儡：冲到障碍或广场边就停，直冲不受挡时冲满；红条判定含两头和宽度', () => {
  const C = MINION.charger, R = 8, body = 0.4;
  const from = { x: -6, z: 0 }, dir = { x: 1, z: 0 };
  assert.equal(chargeLen(from, dir, [], R, C.len, body), C.len, '前面空：冲满');
  const L = chargeLen(from, dir, [{ x: 0, z: 0, r: 1.5 }], R, C.len, body);
  assert.ok(L < 6 - 1.5 - body + 1e-9 && L > 6 - 1.5 - body - 0.11, `停在柱子前（${L}）`);
  const edge = chargeLen({ x: 5, z: 0 }, dir, [], R, C.len, body);
  assert.ok(edge <= R - 5 + 1e-9 && edge > R - 5 - 0.11, '停在广场边');
  // 贴着障碍：一步都冲不出去
  assert.equal(chargeLen({ x: -1.9, z: 0 }, dir, [{ x: 0, z: 0, r: 1.5 }], R, C.len, body), 0);
  // 红条：长 len、宽 w
  const s = { x: 0, z: 0 };
  assert.ok(inStrip({ x: 4, z: 0 }, s, dir, 9, C.w));
  assert.ok(inStrip({ x: 4, z: C.w / 2 - 0.01 }, s, dir, 9, C.w));
  assert.ok(!inStrip({ x: 4, z: C.w / 2 + 0.01 }, s, dir, 9, C.w));
  assert.ok(!inStrip({ x: 9.2, z: 0 }, s, dir, 9, C.w), '冲不到的地方');
  assert.ok(!inStrip({ x: -0.5, z: 0 }, s, dir, 9, C.w), '身后');
  assert.ok(inStrip({ x: 4, z: C.w / 2 + 0.2 }, s, dir, 9, C.w, 0.35), '身体半径算进去');
  // 预警够看清：蓄力时间里玩家能横着走出半条宽度加身体
  assert.ok(TRIAL.speed * C.tele > C.w / 2 + 0.35);
});
// ---------------------------------------------------------------- 第二个 boss 石甲巨像（numbers.js STONE）
const stoneMoves = (phase, s) => new Set(ROLLS.map((r) => pickMove(phase, s, r, STONE)));

test('石甲：甲在时只有雷照常伤害并削甲，别的元素（连火）只剩两成；字诀「破」照样破', () => {
  const b = { armor: STONE.armor, freezeCd: 0 };
  const th = bossHit(b, 'thunder', hit('thunder', 50), false, STONE);
  assert.equal(th.r.dmg, 50);
  assert.equal(th.armor, STONE.armor - 50);
  assert.equal(th.r.reaction, '裂甲');
  for (const el of ['fire', 'ice', 'wind', 'earth']) {
    const h = bossHit(b, el, hit(el, 50), false, STONE);
    assert.equal(h.r.dmg, 50 * STONE.armoredMult, `${el} 打在石甲上`);
    assert.equal(h.armor, STONE.armor, `${el} 不削甲`);
    assert.equal(h.r.reaction, '石甲');
  }
  assert.equal(bossHit(b, 'fire', hit('fire', 50), true, STONE).armor, STONE.armor - 50, '「破」什么元素都削甲');
  assert.equal(bossHit({ armor: 30, freezeCd: 0 }, 'thunder', hit('thunder', 50), false, STONE).broke, true);
  assert.equal(bossHit({ armor: BOSS.armor, freezeCd: 0 }, 'fire', hit('fire', 50)).armor, BOSS.armor - 50, '不给 boss 就是寒甲傀儡王：火照常削冰甲');
});

test('石甲巨像挑招：第 1 阶段重踏、落石、冲撞，第 2 阶段起加地刺；远近都出；不出寒甲傀儡王的招；冷却好了照样召', () => {
  const far = { dist: 8, minions: 0, sinceSummon: 0 }, near = { ...far, dist: 3 };
  assert.deepEqual([...stoneMoves(1, far)].sort(), ['charge', 'rocks', 'slam']);
  assert.deepEqual([...stoneMoves(1, near)].sort(), ['charge', 'rocks', 'slam']);
  for (const ph of [2, 3]) assert.deepEqual([...stoneMoves(ph, far)].sort(), ['charge', 'rocks', 'slam', 'spikes'], `第 ${ph} 阶段`);
  assert.equal(pickMove(1, { ...far, sinceSummon: STONE.summon.cd }, 0.5, STONE), 'summon');
  assert.ok(!stoneMoves(2, { ...far, last: 'charge' }).has('charge'), '刚冲过不连着冲');
});

test('蓄力冲撞：蓄力按阶段单写、不跟着越来越快；石甲在时两发雷弹打得断、两发火弹打不断；红条躲得开', () => {
  const C = STONE.charge;
  assert.deepEqual([1, 2, 3].map((p) => teleSec('charge', p, STONE)), C.tele);
  assert.ok(teleSec('rocks', 3, STONE) < teleSec('rocks', 1, STONE), '别的招照样越来越快');
  // 按键默认的弹：威力 2 时雷 30 × 1.1 × 1.5、火 30 × 1.3 × 1.5
  const on = (el, dmg) => bossHit({ armor: STONE.armor, freezeCd: 0 }, el, hit(el, dmg), false, STONE).r.dmg;
  assert.ok(2 * on('thunder', 49.5) >= C.breakDmg, '两发雷弹');
  assert.ok(2 * on('fire', 58.5) < C.breakDmg, '两发火弹打在石甲上');
  assert.ok(2 * 58.5 >= C.breakDmg, '石甲碎了以后两发火弹也打得断');
  // 狂暴时连冲的第二下蓄力最短，也要横着走得出半条宽度加身体
  assert.ok(TRIAL.speed * C.tele[2] * C.again > C.w / 2 + 0.35);
});

test('落石雨：第一块对准人，其余落在人身边、彼此隔得开、都在广场里、不落进障碍', () => {
  const S = STONE.rocks, R = 9.5, pillar = { x: 3, z: 3, r: 1 };
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const me of [{ x: 0, z: 2 }, { x: 8.5, z: 0 }]) {
    for (const n of S.n) {
      const s = rockSpots(me, n, rnd, [pillar], R);
      assert.equal(s.length, n);
      assert.deepEqual(s[0], me, '第一块对准人');
      for (const [i, p] of s.entries()) {
        assert.ok(Math.hypot(p.x, p.z) <= R + 1e-9, '在广场里');
        assert.ok(Math.hypot(p.x - pillar.x, p.z - pillar.z) >= pillar.r - 1e-9, '不在柱子里');
        assert.ok(Math.hypot(p.x - me.x, p.z - me.z) <= S.spread + 1e-9, '在人身边');
        for (const q of s.slice(i + 1)) assert.ok(Math.hypot(p.x - q.x, p.z - q.z) >= S.apart - 1e-9, `隔得开（人在 ${me.x}, ${me.z}，${n} 块）`);
      }
    }
  }
  // 预警够看清：一块落下前横着走得出红圈半径加身体
  assert.ok(TRIAL.speed * S.tele * BOSS.pace[2] > S.r + 0.35);
});

test('一线地刺：一道朝人，狂暴三道左右对称；冒到人那一段才算，宽度含身体；一帧冒多冒少都不漏不重', () => {
  const S = STONE.spikes, from = { x: 0, z: 0 }, dir = { x: 1, z: 0 }, me = { x: 5, z: 0 };
  const one = spikeDirs({ x: 0, z: 1 }, 1);
  assert.ok(Math.abs(one[0].x) < 1e-9 && Math.abs(one[0].z - 1) < 1e-9);
  const three = spikeDirs(dir, 3).map((d) => (Math.atan2(d.z, d.x) * 180) / Math.PI);
  assert.ok(Math.abs(three[0] + S.fanDeg) < 1e-9 && Math.abs(three[1]) < 1e-9 && Math.abs(three[2] - S.fanDeg) < 1e-9);
  assert.ok(spikeReach(me, from, dir, 4.8, 5.1, S.w, 0.35));
  assert.ok(!spikeReach(me, from, dir, 2, 3, S.w, 0.35), '还没冒到');
  assert.ok(!spikeReach(me, from, dir, 6, 7, S.w, 0.35), '已经冒过去了');
  assert.ok(spikeReach({ x: 5, z: S.w / 2 + 0.3 }, from, dir, 4.8, 5.1, S.w, 0.35), '身子挨着边');
  assert.ok(!spikeReach({ x: 5, z: S.w / 2 + 0.4 }, from, dir, 4.8, 5.1, S.w, 0.35), '站在边外');
  assert.ok(!spikeReach({ x: -1, z: 0 }, from, dir, 0, S.len, S.w, 0.35), '身后不挨');
  for (const step of [0.05, 0.3, 0.9]) {
    let n = 0;
    for (let f = 0; f < S.len; f += step) if (spikeReach(me, from, dir, f, f + step, S.w)) n++;
    assert.equal(n, 1, `每帧冒 ${step} 米`);
  }
  assert.ok(TRIAL.speed * S.tele * BOSS.pace[2] > S.w / 2 + 0.35, '预警时间里横着走得出去');
});