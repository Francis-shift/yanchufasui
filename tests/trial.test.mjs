// 试炼模式的规则（game/rules/trial.js）：冰甲只怕火、70% / 30% 换阶段、挑招、红圈与扇形的判定、玩家被挡在广场里。
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { damageTo } from '../game/rules/arbiter.js';
import { BOSS, ENEMIES, TRIAL } from '../game/rules/numbers.js';
import {
  bossHit, bossPhase, homingTurn, inCircle, inSector, isPerfect, keepInArena, pickMove, recoverSec, slamCount, spiralAngles, teleSec,
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
