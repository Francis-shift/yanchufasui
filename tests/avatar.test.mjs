// 化身的规则：一局一次、低血才能自己开、亮相走真实时间、变身走玩家的钟
import test from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_OFF, avatarFree, avatarHeal, avatarOn, canAvatar, canSave, openAvatar, tickAvatar } from '../game/rules/avatar.js';
import { RUN, TRIAL } from '../game/rules/numbers.js';
import { CARDS, newRun, runMods } from '../game/rules/run.js';
import { DEFAULT_KEYS, readKeys } from '../game/rules/keymap.js';

const A = RUN.avatar, low = { has: true, fighting: true, hp: TRIAL.hp * A.low, max: TRIAL.hp };
const on = () => tickAvatar(openAvatar(), A.pose, 0).a;

test('气血归零救得了：要领悟了，这一局没用过，不在变身中', () => {
  assert.equal(canSave(AVATAR_OFF, true), true);
  assert.equal(canSave(AVATAR_OFF, false), false);
  assert.equal(canSave(openAvatar(), true), false);
  assert.equal(canSave(on(), true), false);
  assert.equal(canSave({ ...AVATAR_OFF, used: true }, true), false);
});

test('自己开：气血到 low 成及以下、开战了才亮', () => {
  assert.equal(canAvatar(AVATAR_OFF, low), true);
  assert.equal(canAvatar(AVATAR_OFF, { ...low, hp: TRIAL.hp * A.low + 1 }), false);
  assert.equal(canAvatar(AVATAR_OFF, { ...low, fighting: false }), false);
  assert.equal(canAvatar(AVATAR_OFF, { ...low, has: false }), false);
  assert.equal(canAvatar({ ...AVATAR_OFF, used: true }, low), false);
});

test('回血：归零回 heal，低血加 heal，回不过上限', () => {
  assert.equal(avatarHeal(0, TRIAL.hp), A.heal);
  assert.equal(avatarHeal(20, TRIAL.hp), 20 + A.heal);
  assert.equal(avatarHeal(TRIAL.hp - 1, TRIAL.hp), TRIAL.hp);
});

test('亮相走真实时间：世界停着也往前走，到点变身，时长是 sec', () => {
  const a = openAvatar();
  assert.deepEqual([a.phase, a.t, a.used], ['pose', A.pose, true]);
  const half = tickAvatar(a, A.pose / 2, 0);
  assert.deepEqual([half.a.phase, half.event], ['pose', '']);
  const r = tickAvatar(a, A.pose, 0);
  assert.deepEqual([r.a.phase, r.a.t, r.event], ['on', A.sec, 'on']);
});

test('亮相时世界的钟不算数，变身时真实时间不算数', () => {
  assert.equal(tickAvatar(openAvatar(), 0, 99).a.phase, 'pose');
  assert.equal(tickAvatar(on(), 99, 0).a.phase, 'on');
});

test('变身走完：回到关着，用过了不能再开，只报一次', () => {
  const r = tickAvatar(on(), 0, A.sec);
  assert.deepEqual([r.a.phase, r.a.used, r.event], ['off', true, 'end']);
  assert.equal(canSave(r.a, true), false);
  assert.equal(tickAvatar(r.a, 1, 1).event, '');
});

test('没开时走钟什么都不变', () => {
  assert.equal(tickAvatar(AVATAR_OFF, 1, 1).a, AVATAR_OFF);
});

test('亮相、变身都算开着；只有变身中法力和闪避不花', () => {
  assert.equal(avatarOn(AVATAR_OFF), false);
  assert.equal(avatarOn(openAvatar()), true);
  assert.equal(avatarOn(on()), true);
  assert.equal(avatarFree(openAvatar()), false);
  assert.equal(avatarFree(on()), true);
});

test('化身是领悟卡，做好了，拿了才算有', () => {
  const c = CARDS.find((x) => x.id === 'avatar');
  assert.equal(c?.kind, 'insight');
  assert.equal(c?.ready, true);
  assert.equal(c?.max, 1);
  assert.match(c?.text ?? '', /低于 30% /);
  assert.equal(runMods(newRun()).avatar, false);
  assert.equal(runMods({ ...newRun(), have: { avatar: 1 } }).avatar, true);
});

test('改过键的老存档没有化身这一键：给它默认键，不和老键撞', () => {
  const { avatar: _, ...old } = DEFAULT_KEYS;
  assert.equal(readKeys(JSON.stringify(old)).avatar, DEFAULT_KEYS.avatar);
  const taken = readKeys(JSON.stringify({ ...old, dash: DEFAULT_KEYS.avatar }));
  assert.notEqual(taken.avatar, DEFAULT_KEYS.avatar);
  assert.ok(taken.avatar);
});

test('化身的数：亮相够看清，回的血扛得住，低血线不到一半', () => {
  assert.ok(A.pose >= 0.6 && A.pose <= 1.2, '亮相太长打断手感，太短看不清');
  assert.ok(A.heal >= TRIAL.hp * 0.3);
  assert.ok(A.low < 0.5);
  assert.ok(A.burst.r >= 4);
});
