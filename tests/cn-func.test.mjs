// 北京函数的外壳：打包结果能载入；跨域只认自己的网站；base64 请求体能解开；限流默认放宽。都不连网。
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../tools/build-cn-func.mjs';

const SITE = 'https://www.yanchufasui.top';
let fn;

before(() => {
  delete process.env.ARK_API_KEY;
  delete process.env.ARK_MODEL;
  delete process.env.RATE_PER_MINUTE;
  delete process.env.DAILY_CALL_CAP;
  delete process.env.ALLOW_ORIGINS;
  const dir = mkdtempSync(join(tmpdir(), 'cn-func-'));
  const { files } = build(dir);
  assert.ok(files.includes('index.js') && files.includes('parse-core.mjs'));
  fn = createRequire(import.meta.url)(join(dir, 'index.js'));
});

const call = async (event) => {
  const r = await fn.handler(event);
  return { status: r.statusCode, headers: r.headers, body: r.body ? JSON.parse(r.body) : null };
};
const withKey = async (f) => {
  process.env.ARK_API_KEY = 'test-key';
  process.env.ARK_MODEL = 'test-model';
  try { return await f(); } finally { delete process.env.ARK_API_KEY; delete process.env.ARK_MODEL; }
};

test('打包后的 import 都改成同目录的 .mjs，入口能载入、初始化', async () => {
  assert.equal(typeof fn.handler, 'function');
  await fn.initializer();
});

test('预检：自己的网站放行并回允许的方法与请求头', async () => {
  const r = await call({ httpMethod: 'OPTIONS', headers: { Origin: SITE } });
  assert.equal(r.status, 204);
  assert.equal(r.headers['Access-Control-Allow-Origin'], SITE);
  assert.match(r.headers['Access-Control-Allow-Methods'], /POST/);
  assert.match(r.headers['Access-Control-Allow-Headers'], /Content-Type/);
});

test('别的网站来调：拒绝，且不给跨域头', async () => {
  const r = await call({ httpMethod: 'POST', headers: { origin: 'https://evil.example' }, body: '{"text":"火"}' });
  assert.equal(r.status, 403);
  assert.equal(r.body.reason, 'origin');
  assert.equal(r.headers['Access-Control-Allow-Origin'], undefined);
});

test('没配密钥：照常答"不行"，自己的网站拿得到跨域头', async () => {
  const r = await call({ httpMethod: 'POST', headers: { Origin: SITE }, body: '{"text":"火球"}' });
  assert.equal(r.status, 200);
  assert.equal(r.body.reason, 'no_key');
  assert.equal(r.headers['Access-Control-Allow-Origin'], SITE);
});

test('base64 编码的请求体先解开再解析', async () => {
  await withKey(async () => {
    const body = Buffer.from(JSON.stringify({ text: '   ' })).toString('base64');
    const r = await call({ httpMethod: 'POST', headers: {}, isBase64Encoded: true, body });
    assert.equal(r.status, 400);
    assert.equal(r.body.reason, 'empty');   // 没解开的话是 bad_request
  });
});

test('坏请求体与超长咒语：在调模型之前就拒', async () => {
  await withKey(async () => {
    assert.equal((await call({ httpMethod: 'POST', headers: {}, body: '不是 JSON' })).body.reason, 'bad_request');
    assert.equal((await call({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ text: '火'.repeat(200) }) })).status, 413);
    const d = await call({ httpMethod: 'GET', headers: {}, queryStringParameters: { diag: '9' } });
    assert.equal(d.status, 400);
    assert.equal(d.body.where, 'cn-beijing');
  });
});

test('限流默认放宽到每分钟 30 次、每天 6000 次（平台配了就以平台为准）', () => {
  assert.equal(process.env.RATE_PER_MINUTE, '30');
  assert.equal(process.env.DAILY_CALL_CAP, '6000');
});
