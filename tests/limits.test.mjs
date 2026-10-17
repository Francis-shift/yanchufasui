// 防刷计数单测（Node 直接跑 TypeScript：只去掉类型，不做类型检查）
import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.RATE_PER_MINUTE = '3';
process.env.DAILY_CALL_CAP = '5';
const { checkLimits, clientIp } = await import('../server/limits.ts');

test('每个来源每分钟次数上限，过了一分钟恢复；每天总次数上限按北京时间换日', () => {
  const t0 = Date.UTC(2026, 9, 18, 2, 0, 0);
  for (let i = 0; i < 3; i++) assert.equal(checkLimits('1.1.1.1', t0 + i).ok, true);
  assert.deepEqual(checkLimits('1.1.1.1', t0 + 10), { ok: false, reason: 'rate' });
  assert.equal(checkLimits('2.2.2.2', t0 + 20).ok, true, '别的来源不受影响');
  assert.equal(checkLimits('1.1.1.1', t0 + 61_000).ok, true, '一分钟后恢复');
  assert.deepEqual(checkLimits('3.3.3.3', t0 + 62_000), { ok: false, reason: 'daily' }, '当天第 6 次被挡');
  assert.equal(checkLimits('3.3.3.3', Date.UTC(2026, 9, 18, 16, 0, 1)).ok, true, '北京时间零点后清零');
});

test('来源地址取转发头的第一个', () => {
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' })), '9.9.9.9');
  assert.equal(clientIp(new Headers()), 'unknown');
});
