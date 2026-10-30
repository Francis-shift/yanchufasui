// 试炼的电脑键位：默认 Shift / Q / E / R / V / B，改键时撞了就互换，存的东西坏了回默认，走位与系统键不让占。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, DEFAULT_KEYS, actionOf, bindKey, bindable, keyLabel, readKeys } from '../game/rules/keymap.js';

test('默认键位照本人定的：Shift 闪避、Q E R 三招、V 大招、B 切视角；两个 Shift 都算', () => {
  const k = readKeys(null);
  assert.deepEqual(k, DEFAULT_KEYS);
  assert.equal(actionOf(k, 'ShiftLeft'), 'dash');
  assert.equal(actionOf(k, 'ShiftRight'), 'dash');
  assert.deepEqual(['KeyQ', 'KeyE', 'KeyR', 'KeyV', 'KeyB'].map((c) => actionOf(k, c)), ['skill1', 'skill2', 'skill3', 'ult', 'view']);
  assert.equal(actionOf(k, 'Digit1'), null, '数字键没被占：交给老规矩');
  assert.equal(actionOf(k, 'KeyW'), null);
});

test('改键：能绑的直接换；撞了别的动作就两个互换，每个键只管一件事、每个动作都有键', () => {
  const a = bindKey(DEFAULT_KEYS, 'dash', 'Space');
  assert.equal(a?.dash, 'Space');
  const b = bindKey(DEFAULT_KEYS, 'skill1', 'KeyR');
  assert.equal(b?.skill1, 'KeyR');
  assert.equal(b?.skill3, 'KeyQ', '原来按 R 的第三招换到 Q');
  for (const m of [a, b]) {
    assert.ok(m);
    assert.equal(new Set(ACTIONS.map((x) => m[x])).size, ACTIONS.length);
  }
  assert.deepEqual(bindKey(DEFAULT_KEYS, 'view', 'KeyB'), DEFAULT_KEYS, '绑回自己的键不变');
  assert.equal(bindKey(DEFAULT_KEYS, 'dash', 'ShiftRight')?.dash, 'ShiftLeft');
});

test('走位、Esc、回车、方向键、Ctrl / Alt / Win、Tab、功能键不让占', () => {
  for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Escape', 'Enter', 'ArrowUp', 'ControlLeft', 'AltLeft', 'MetaLeft', 'Tab', 'F5', 'Backquote']) {
    assert.equal(bindable(c), false, c);
    assert.equal(bindKey(DEFAULT_KEYS, 'dash', c), null, c);
  }
  for (const c of ['KeyF', 'Digit5', 'Space', 'CapsLock', 'Numpad0', 'Comma']) assert.equal(bindable(c), true, c);
});

test('读存下来的：好的照用，认不出的那项回默认，撞键整套回默认，坏 JSON 回默认', () => {
  assert.deepEqual(readKeys(JSON.stringify({ ...DEFAULT_KEYS, dash: 'Space' })), { ...DEFAULT_KEYS, dash: 'Space' });
  assert.deepEqual(readKeys(JSON.stringify({ dash: 'KeyW', skill1: 42 })), DEFAULT_KEYS);
  assert.deepEqual(readKeys(JSON.stringify({ skill1: 'KeyE' })), DEFAULT_KEYS, 'skill1 换成 E 就和 skill2 撞了');
  assert.deepEqual(readKeys('{坏的'), DEFAULT_KEYS);
});

test('键名：字母、数字、Shift、空格、标点写成玩家认得的样子', () => {
  assert.deepEqual(['KeyQ', 'Digit3', 'ShiftLeft', 'ShiftRight', 'Space', 'Numpad2', 'Comma'].map(keyLabel), ['Q', '3', 'Shift', 'Shift', '空格', '小键盘2', ',']);
});
