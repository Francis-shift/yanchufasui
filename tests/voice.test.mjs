// 语音施法：录音编成 16 kHz WAV（voice.js）；服务器听写（server/asr.ts，经北京函数的打包结果调，假的网络请求，不连网）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../tools/build-cn-func.mjs';
import { base64, downsample, encode, MAX_SEC, RATE, wav } from '../game/voice.js';
import { INPUT_MAX_CHARS } from '../game/rules/numbers.js';
import { asrRemote, resetRoutes } from '../game/net.js';

/** rate 采样率下 sec 秒、振幅 amp 的 440 Hz 正弦，切成 4096 一块（同录音时 ScriptProcessor 给的） */
function tone(sec, amp, rate = 48000) {
  const n = Math.round(sec * rate), chunks = [];
  for (let o = 0; o < n; o += 4096) {
    const c = new Float32Array(Math.min(4096, n - o));
    for (let i = 0; i < c.length; i++) c[i] = amp * Math.sin((2 * Math.PI * 440 * (o + i)) / rate);
    chunks.push(c);
  }
  return chunks;
}
/** WAV（base64）→ 采样率与样本 */
function readWav(b64) {
  const b = Buffer.from(b64, 'base64');
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 16), 'WAVEfmt ');
  assert.equal(b.toString('ascii', 36, 40), 'data');
  const n = b.readUInt32LE(40) / 2, s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = b.readInt16LE(44 + i * 2) / 0x8000;
  return { rate: b.readUInt32LE(24), channels: b.readUInt16LE(22), bits: b.readUInt16LE(34), size: b.readUInt32LE(4) + 8, bytes: b.length, s };
}
const peak = (s) => s.reduce((a, x) => Math.max(a, Math.abs(x)), 0);

test('降采样：48k → 16k 长度三分之一，平的信号不变；本来就是 16k 的原样返回', () => {
  const x = new Float32Array(4800).fill(0.25);
  const y = downsample(x, 48000);
  assert.equal(y.length, 1600);
  assert.ok(y.every((v) => Math.abs(v - 0.25) < 1e-6));
  assert.equal(downsample(x, 16000), x);
  assert.equal(downsample(new Float32Array(441), 44100).length, 160);   // 不整除的采样率
});

test('WAV：头对、16 位单声道 16 kHz，样本夹在 ±1', () => {
  const w = readWav(base64(wav(new Float32Array([0, 0.5, -0.5, 2, -2]))));
  assert.deepEqual([w.rate, w.channels, w.bits, w.size, w.bytes], [RATE, 1, 16, 54, 54]);
  assert.deepEqual([...w.s].map((v) => +v.toFixed(3)), [0, 0.5, -0.5, 1, -1]);
});

test('base64：长过一段（0x8000 字节）也和 Node 的一致', () => {
  const u = new Uint8Array(100_003).map((_, i) => (i * 37) & 255);
  assert.equal(base64(u), Buffer.from(u).toString('base64'));
});

test('编码：太短、几乎没声音的不送；正常的一段放大到峰值 0.8，太小声的最多放大 6 倍', () => {
  assert.equal(encode(tone(0.2, 0.5), 48000), null);
  assert.equal(encode(tone(1, 0.002), 48000), null);
  assert.equal(encode([], 48000), null);
  const a = encode(tone(1, 0.5), 48000);
  assert.ok(a);
  const w = readWav(a.b64);
  assert.equal(w.s.length, 16000);
  assert.ok(Math.abs(a.sec - 1) < 0.01);
  assert.ok(Math.abs(peak(w.s) - 0.8) < 0.02, `峰值 ${peak(w.s)}`);
  const q = readWav(/** @type {{ b64: string }} */ (encode(tone(1, 0.03), 44100)).b64);
  assert.ok(Math.abs(peak(q.s) - 0.18) < 0.02, `小声的峰值 ${peak(q.s)}`);
});

// ---------------------------------------------------------------- 服务器
const SITE = 'https://www.yanchufasui.top';
let fn, asrMod, realFetch;
const ENV = ['ARK_API_KEY', 'ARK_MODEL', 'ASR_API_KEY', 'ASR_APP_ID', 'ASR_ACCESS_TOKEN', 'ASR_RESOURCE_ID', 'RATE_PER_MINUTE', 'DAILY_CALL_CAP', 'ALLOW_ORIGINS'];

before(async () => {
  for (const k of ENV) delete process.env[k];
  realFetch = globalThis.fetch;
  const dir = mkdtempSync(join(tmpdir(), 'cn-func-asr-'));
  const { files } = build(dir);
  assert.ok(files.includes('asr.mjs'), '听写跟着解析一起打进北京函数');
  fn = createRequire(import.meta.url)(join(dir, 'index.js'));
  asrMod = await import(pathToFileURL(join(dir, 'asr.mjs')).href);
});
after(() => { globalThis.fetch = realFetch; });

const call = async (body) => {
  const r = await fn.handler({ httpMethod: 'POST', headers: { Origin: SITE }, body: JSON.stringify(body) });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};
/** 配上听写密钥、换上假的听写服务（code 放在响应头 X-Api-Status-Code），跑完复原 */
async function withAsr(reply, f) {
  process.env.ASR_API_KEY = 'test-asr-key';
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (reply === 'hang') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('timeout', 'TimeoutError'))));
    return new Response(JSON.stringify(reply.json ?? {}), { status: 200, headers: { 'X-Api-Status-Code': reply.code } });
  };
  try { return await f(calls); } finally { delete process.env.ASR_API_KEY; globalThis.fetch = realFetch; }
}
const CLIP = /** @type {{ b64: string }} */ (encode(tone(1, 0.5), 48000)).b64;

test('录满一次最长的时长，base64 后也在服务器收的上限以内', () => {
  const longest = encode(tone(MAX_SEC, 0.5, 16000), 16000);
  assert.ok(longest && longest.b64.length < asrMod.AUDIO_B64_MAX, `${longest?.b64.length} / ${asrMod.AUDIO_B64_MAX}`);
});

test('请求头：新版 API Key、旧版 APP ID + Access Token 都认；都没配是 null', () => {
  assert.equal(asrMod.asrHeaders({}), null);
  assert.equal(asrMod.asrHeaders({ ASR_APP_ID: 'a' }), null);
  const k = asrMod.asrHeaders({ ASR_API_KEY: 'k' });
  assert.equal(k['X-Api-Key'], 'k');
  assert.equal(k['X-Api-Resource-Id'], 'volc.bigasr.auc_turbo');
  assert.equal(k['X-Api-Sequence'], '-1');
  assert.match(k['X-Api-Request-Id'], /^[0-9a-f-]{36}$/);
  assert.notEqual(k['X-Api-Request-Id'], asrMod.asrHeaders({ ASR_API_KEY: 'k' })['X-Api-Request-Id'], '每次一个新的请求号');
  const old = asrMod.asrHeaders({ ASR_APP_ID: 'a', ASR_ACCESS_TOKEN: 't', ASR_RESOURCE_ID: 'r' });
  assert.deepEqual([old['X-Api-App-Key'], old['X-Api-Access-Key'], old['X-Api-Resource-Id'], old['X-Api-Key']], ['a', 't', 'r', undefined]);
});

test('取文字：对象或数组都认，去掉句末标点，截到咒语长度', () => {
  assert.equal(asrMod.pickText({ result: { text: ' 三颗火球从天而降。' } }), '三颗火球从天而降');
  assert.equal(asrMod.pickText({ result: [{ text: '冰墙！' }] }), '冰墙');
  assert.equal(asrMod.pickText({ result: {} }), '');
  assert.equal(asrMod.pickText(null), '');
  assert.equal([...asrMod.pickText({ result: { text: '火'.repeat(200) } })].length, INPUT_MAX_CHARS);
});

test('没配听写密钥：答 no_key（前端换下一条线路），也不去调听写', async () => {
  const calls = [];
  globalThis.fetch = async (...a) => { calls.push(a); throw new Error('不该调'); };
  try {
    const r = await call({ asr: CLIP });
    assert.equal(r.body.reason, 'no_key');
    assert.equal(calls.length, 0);
  } finally { globalThis.fetch = realFetch; }
});

test('听写成功：没配解析模型的密钥也能用；带着录音和密钥调极速版', async () => {
  await withAsr({ code: '20000000', json: { result: { text: '冰龙出来。' } } }, async (calls) => {
    const r = await call({ asr: CLIP });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.text, '冰龙出来');
    assert.equal(typeof r.body.ms, 'number');
    assert.equal(calls.length, 1);
    assert.match(String(calls[0].url), /\/api\/v3\/auc\/bigmodel\/recognize\/flash$/);
    assert.equal(calls[0].init.headers['X-Api-Key'], 'test-asr-key');
    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.audio.data, CLIP);
    assert.equal(sent.request.model_name, 'bigmodel');
  });
});

test('听写的几种"不行"：静音、空结果、出错、超时', async () => {
  await withAsr({ code: '20000003' }, async () => assert.equal((await call({ asr: CLIP })).body.reason, 'silence'));
  await withAsr({ code: '20000000', json: { result: { text: '。' } } }, async () => assert.equal((await call({ asr: CLIP })).body.reason, 'silence'));
  await withAsr({ code: '45000001' }, async () => {
    const r = await call({ asr: CLIP });
    assert.equal(r.body.reason, 'asr_error');
    assert.equal(r.body.code, '45000001');
  });
  process.env.ASR_TIMEOUT_MS = '50';
  try {
    await withAsr('hang', async () => assert.equal((await call({ asr: CLIP })).body.reason, 'timeout'));
  } finally { delete process.env.ASR_TIMEOUT_MS; }
});

test('前端：听写结果走和解析同一套线路；北京没开通听写就换新加坡，空结果算没听清', async () => {
  resetRoutes();
  const BJ = 'https://bj.example/parse', SG = '/api/parse', sent = [];
  const reply = (obj) => new Response(JSON.stringify(obj), { status: 200 });
  globalThis.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return url === BJ ? reply({ ok: false, reason: 'no_key', fallback: true }) : reply({ ok: true, text: '火球', ms: 320 });
  };
  try {
    assert.deepEqual(await asrRemote([BJ, SG], CLIP, 6500), { text: '火球', ms: 320 });
    assert.deepEqual(sent.map((s) => s.url), [BJ, SG]);
    assert.equal(sent[0].body.asr, CLIP);
    globalThis.fetch = async () => reply({ ok: true, text: '', ms: 1 });
    assert.deepEqual(await asrRemote(SG, CLIP, 6500), { fail: 'silence' });
  } finally { globalThis.fetch = realFetch; resetRoutes(); }
});

test('坏录音：太短、不是 base64、太长、不是字符串，都在调听写之前拒', async () => {
  await withAsr({ code: '20000000', json: { result: { text: '火' } } }, async (calls) => {
    for (const bad of ['AAAA', '这不是base64'.repeat(20), 'A'.repeat(asrMod.AUDIO_B64_MAX + 4), 123, null]) {
      const r = await call({ asr: bad });
      assert.equal(r.status, 400, String(bad).slice(0, 10));
      assert.equal(r.body.reason, 'bad_request');
    }
    assert.equal(calls.length, 0);
  });
});
