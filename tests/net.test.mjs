// 换线路：北京连不上、网关报错、那边没配好 → 换新加坡；服务器正常答了"不行"或时间用完 → 不换。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { inspireRemote, parseRemote, resetRoutes, warmUp } from '../game/net.js';

const BJ = 'https://bj.example/parse';
const SG = '/api/parse';
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const GOOD = { ok: true, raw: { s: [] }, ms: 800, model: 'm' };

/** 按线路给出答复；记下每次请求的地址与请求头 */
function mockFetch(byUrl) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const h = byUrl[url];
    if (h === 'network') throw new TypeError('Failed to fetch');
    if (h === 'hang') {
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    }
    return typeof h === 'function' ? h() : h;
  };
  return calls;
}

beforeEach(() => resetRoutes());

test('北京连不上：换新加坡，之后一分钟内直接走新加坡', async () => {
  const calls = mockFetch({ [BJ]: 'network', [SG]: () => json(GOOD) });
  const r = await parseRemote([BJ, SG], '火球', 4500);
  assert.deepEqual(r, { raw: GOOD.raw, ms: 800, model: 'm' });
  assert.deepEqual(calls.map((c) => c.url), [BJ, SG]);
  await parseRemote([BJ, SG], '冰墙', 4500);
  assert.deepEqual(calls.map((c) => c.url), [BJ, SG, SG]);
});

test('网关报错（不是我们的答复）：换新加坡', async () => {
  const calls = mockFetch({ [BJ]: () => new Response('not found', { status: 404 }), [SG]: () => json(GOOD) });
  const r = await parseRemote([BJ, SG], '火球', 4500);
  assert.ok('raw' in r);
  assert.deepEqual(calls.map((c) => c.url), [BJ, SG]);
});

test('北京没配好（来源没放行、没配密钥）：换新加坡', async () => {
  for (const reason of ['origin', 'no_key']) {
    resetRoutes();
    const calls = mockFetch({ [BJ]: () => json({ ok: false, reason, fallback: true }, reason === 'origin' ? 403 : 200), [SG]: () => json(GOOD) });
    const r = await parseRemote([BJ, SG], '火球', 4500);
    assert.ok('raw' in r, reason);
    assert.deepEqual(calls.map((c) => c.url), [BJ, SG], reason);
  }
});

test('服务器正常答了"不行"：不换，带回原因与服务器耗时', async () => {
  for (const reason of ['model_error', 'timeout', 'rate']) {
    resetRoutes();
    const calls = mockFetch({ [BJ]: () => json({ ok: false, reason, fallback: true, ms: 3900 }, reason === 'rate' ? 429 : 200), [SG]: () => json(GOOD) });
    const r = await parseRemote([BJ, SG], '火球', 4500);
    assert.deepEqual(r, { fail: reason, ms: 3900 }, reason);
    assert.deepEqual(calls.map((c) => c.url), [BJ], reason);
  }
});

test('时间用完：不换线路，也不把北京记成连不上（下一句照样先走北京）', async () => {
  const byUrl = { [BJ]: 'hang', [SG]: () => json(GOOD) };
  const calls = mockFetch(byUrl);
  const r = await parseRemote([BJ, SG], '火球', 60);
  assert.deepEqual(r, { fail: 'timeout' });
  assert.deepEqual(calls.map((c) => c.url), [BJ]);
  byUrl[BJ] = () => json(GOOD);
  await parseRemote([BJ, SG], '冰墙', 4500);
  assert.deepEqual(calls.map((c) => c.url), [BJ, BJ]);
});

test('剩下的时间不够就不换', async () => {
  const calls = mockFetch({ [BJ]: () => new Promise((res) => setTimeout(() => res(new Response('bad gateway', { status: 502 })), 80)), [SG]: () => json(GOOD) });
  const r = await parseRemote([BJ, SG], '火球', 1500);
  assert.deepEqual(r, { fail: 'http_502', ms: undefined });
  assert.deepEqual(calls.map((c) => c.url), [BJ]);
});

test('请求体标成 text/plain（跨站不触发预检）；只给一条线路也照常', async () => {
  const calls = mockFetch({ [SG]: () => json(GOOD) });
  await parseRemote(SG, '火球', 4500);
  assert.equal(calls[0].init.headers['Content-Type'], 'text/plain;charset=UTF-8');
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: '火球' });
});

test('求灵感也走同样的换线路；预热只发第一条可用的线路', async () => {
  const calls = mockFetch({ [BJ]: 'network', [SG]: () => json({ ok: true, lines: ['一', ' ', 2, '二'] }) });
  assert.deepEqual(await inspireRemote([BJ, SG], { el: 'fire', talents: ['fire'], foes: {} }, 4500), ['一', '二']);
  warmUp([BJ, SG]);   // 北京刚被记为连不上，预热改发新加坡
  assert.equal(calls.at(-1).url, SG);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { warm: true });
});

test('没有线路：直接失败', async () => {
  assert.deepEqual(await parseRemote(undefined, '火球', 4500), { fail: 'offline' });
  assert.deepEqual(await inspireRemote([], { el: 'fire', talents: ['fire'], foes: {} }, 4500), []);
});
