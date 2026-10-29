// 语音施法：录音编成 16 kHz WAV（voice.js）；服务器听写（server/asr.ts，经北京函数的打包结果调；识别服务是内存里一对管道扮的，不连网）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { duplexPair } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
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

// 识别服务那一侧的包：服务器发的 WebSocket 帧不加掩码；它自己的包头见 server/asr.ts
const srvFrame = (payload, op = 2, fin = true) => {
  const n = payload.length;
  const h = n < 126 ? Buffer.from([(fin ? 0x80 : 0) | op, n]) : Buffer.from([(fin ? 0x80 : 0) | op, 126, n >> 8, n & 255]);
  return Buffer.concat([h, payload]);
};
const u32 = (v, signed = false) => { const b = Buffer.alloc(4); signed ? b.writeInt32BE(v) : b.writeUInt32BE(v); return b; };
/** 正常回包；flags 0b0011 = 最后一包（带负序号），0b0001 = 中间的（带正序号） */
const resp = (obj, flags = 0b0011, seq = -2) => {
  const z = gzipSync(Buffer.from(JSON.stringify(obj)));
  return Buffer.concat([Buffer.from([0x11, 0x90 | flags, 0x11, 0]), flags & 1 ? u32(seq, true) : Buffer.alloc(0), u32(z.length), z]);
};
const errPkt = (code, msg) => Buffer.concat([Buffer.from([0x11, 0xf0, 0x10, 0]), u32(code), u32(Buffer.byteLength(msg)), Buffer.from(msg)]);
/** 拆客户端发来的包（都不带序号） */
const readPkt = (b) => ({ type: b[1] >> 4, flags: b[1] & 15, json: b[2] >> 4 === 1, body: gunzipSync(b.subarray(8, 8 + b.readUInt32BE(4))) });
/** 最后一包音频到了就回整句 */
const sayOnLast = (obj) => (p, send) => { if (p.type === 2 && p.flags === 2) send(srvFrame(resp(obj))); };

/** 配上听写密钥、换上假的识别服务：serve(收到的包, 回一段字节, 这次连接的记录)；跑完复原 */
async function withAsr(serve, f) {
  process.env.ASR_API_KEY = 'test-asr-key';
  const opens = [], realOpen = asrMod.deps.open;
  asrMod.deps.open = async (url, headers, ms) => {
    if (typeof serve === 'object') throw Object.assign(new Error('refused'), serve);
    const [client, server] = duplexPair();
    const got = { url, headers, ms, pkts: [], ops: [] };
    opens.push(got);
    const reader = new asrMod.WsReader();
    server.on('data', (chunk) => {
      for (const fr of reader.push(chunk)) {
        got.ops.push(fr.op);
        if (fr.op !== 2) continue;
        const p = readPkt(fr.data);
        got.pkts.push(p);
        serve(p, (buf) => server.write(buf), got);
      }
    });
    server.on('error', () => {});
    return client;
  };
  try { return await f(opens); } finally { delete process.env.ASR_API_KEY; asrMod.deps.open = realOpen; }
}
const CLIP = /** @type {{ b64: string }} */ (encode(tone(1, 0.5), 48000)).b64;
const PCM = Buffer.from(CLIP, 'base64').subarray(44);

test('WebSocket 帧：照标准（RFC 6455 第 5.7 节）的例子拆——不加掩码、加掩码、分两片、心跳、两字节长度；半截的等下一段', () => {
  const r = new asrMod.WsReader();
  const hello = (b) => r.push(Buffer.from(b)).map((f) => [f.op, f.data.toString()]);
  assert.deepEqual(hello([0x81, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f]), [[1, 'Hello']]);
  assert.deepEqual(hello([0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58]), [[1, 'Hello']]);
  assert.deepEqual(hello([0x01, 0x03, 0x48, 0x65, 0x6c]), []);
  assert.deepEqual(hello([0x89, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x80, 0x02, 0x6c, 0x6f]), [[9, 'Hello'], [1, 'Hello']]);
  const big = Buffer.alloc(256, 7), whole = Buffer.concat([Buffer.from([0x82, 0x7e, 0x01, 0x00]), big]);
  assert.deepEqual(r.push(whole.subarray(0, 3)), []);
  assert.deepEqual(r.push(whole.subarray(3, 100)), []);
  const [f] = r.push(whole.subarray(100));
  assert.deepEqual([f.op, f.data.equals(big)], [2, true]);
});

test('发出去的帧：加了掩码，按掩码解回来是原样；长度分 7 位、16 位、64 位三档', () => {
  for (const n of [5, 300, 70000]) {
    const p = Buffer.alloc(n).map((_, i) => i * 31), fr = asrMod.wsFrame(p);
    assert.equal(fr[0], 0x82);
    assert.ok(fr[1] & 0x80, '客户端必须加掩码');
    const o = n < 126 ? 2 : n < 65536 ? 4 : 10;
    assert.equal(n < 126 ? fr[1] & 0x7f : n < 65536 ? fr.readUInt16BE(2) : Number(fr.readBigUInt64BE(2)), n);
    const mask = fr.subarray(o, o + 4), body = fr.subarray(o + 4).map((x, i) => x ^ mask[i & 3]);
    assert.ok(body.equals(p));
  }
});

test('WAV 拆样本：浏览器编的格式取出 data 段；不是 16 kHz、不是单声道、不是 WAV 都不认', () => {
  const b = Buffer.from(CLIP, 'base64');
  assert.ok(asrMod.wavPcm(b).equals(PCM));
  const rate = Buffer.from(b); rate.writeUInt32LE(48000, 24);
  const stereo = Buffer.from(b); stereo.writeUInt16LE(2, 22);
  for (const bad of [rate, stereo, Buffer.from('RIFF0000WAVX'), b.subarray(0, 30)]) assert.equal(asrMod.wavPcm(bad), null);
});

test('录满一次最长的时长，base64 后也在服务器收的上限以内', () => {
  const longest = encode(tone(MAX_SEC, 0.5, 16000), 16000);
  assert.ok(longest && longest.b64.length < asrMod.AUDIO_B64_MAX, `${longest?.b64.length} / ${asrMod.AUDIO_B64_MAX}`);
});

test('请求头：新版 API Key、旧版 APP ID + Access Token 都认；都没配是 null', () => {
  assert.equal(asrMod.asrHeaders({}), null);
  assert.equal(asrMod.asrHeaders({ ASR_APP_ID: 'a' }), null);
  const k = asrMod.asrHeaders({ ASR_API_KEY: 'k' });
  assert.equal(k['X-Api-Key'], 'k');
  assert.equal(k['X-Api-Resource-Id'], 'volc.seedasr.sauc.duration', '流式 2.0、按时长计费');
  assert.match(k['X-Api-Request-Id'], /^[0-9a-f-]{36}$/);
  assert.equal(k['X-Api-Connect-Id'], k['X-Api-Request-Id']);
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

test('没配听写密钥：答 no_key（前端换下一条线路），也不去连识别服务', async () => {
  const realOpen = asrMod.deps.open;
  let opened = 0;
  asrMod.deps.open = async () => { opened++; throw new Error('不该连'); };
  try {
    const r = await call({ asr: CLIP });
    assert.equal(r.body.reason, 'no_key');
    assert.equal(opened, 0);
  } finally { asrMod.deps.open = realOpen; }
});

test('听写成功：没配解析模型的密钥也能用；先发参数，录音 200 毫秒一包发完、最后一包打标志，收到最后的回包取整句', async () => {
  const serve = (p, send) => {
    if (p.type === 1) send(srvFrame(resp({ result: { text: '' } }, 0b0001, 1)));   // 中间回包：还没字
    else sayOnLast({ result: { text: '冰龙出来。' }, audio_info: { duration: 1000 } })(p, send);
  };
  await withAsr(serve, async (opens) => {
    const r = await call({ asr: CLIP });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.text, '冰龙出来');
    assert.equal(typeof r.body.ms, 'number');
    assert.equal(opens.length, 1);
    const { url, headers, pkts } = opens[0];
    assert.match(url, /^wss:\/\/openspeech\.bytedance\.com\/api\/v3\/sauc\/bigmodel_nostream$/);
    assert.equal(headers['X-Api-Key'], 'test-asr-key');
    const [first, ...audio] = pkts;
    assert.deepEqual([first.type, first.flags, first.json], [1, 0, true]);
    const req = JSON.parse(first.body.toString());
    assert.deepEqual(req.audio, { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 });
    assert.equal(req.request.model_name, 'bigmodel');
    assert.equal(audio.length, Math.ceil(PCM.length / asrMod.PACKET_BYTES));
    assert.ok(audio.every((p) => p.type === 2 && !p.json && p.body.length <= asrMod.PACKET_BYTES));
    assert.deepEqual(audio.map((p) => p.flags), [...audio.slice(1).map(() => 0), 2], '只有最后一包打标志');
    assert.ok(Buffer.concat(audio.map((p) => p.body)).equals(PCM), '拼回来就是原录音去掉文件头');
  });
});

test('对方的回包拆成几段到、心跳要回；最后没打标志就关了连接，用最近一次的结果', async () => {
  await withAsr((p, send) => {
    if (p.type === 1) send(srvFrame(Buffer.from('hi'), 9));
    if (p.flags !== 2) return;
    const fr = srvFrame(resp({ result: { text: '火球' } }));
    send(fr.subarray(0, 5)); setTimeout(() => send(fr.subarray(5)), 5);
  }, async (opens) => {
    assert.equal((await call({ asr: CLIP })).body.text, '火球');
    assert.ok(opens[0].ops.includes(10), '回了心跳');
  });
  await withAsr((p, send, got) => {
    if (p.type !== 1) return;
    send(srvFrame(resp({ result: { text: '雷' } }, 0b0001, 1)));
    setTimeout(() => send(srvFrame(Buffer.from([0x03, 0xe8]), 8)), 5);
  }, async () => assert.equal((await call({ asr: CLIP })).body.text, '雷'));
});

test('听写的几种"不行"：没字、录音为空、出错包、握手被拒、超时', async () => {
  await withAsr(sayOnLast({ result: { text: '。' } }), async () => assert.equal((await call({ asr: CLIP })).body.reason, 'silence'));
  await withAsr((p, send) => p.flags === 2 && send(srvFrame(errPkt(45000002, 'empty audio'))), async () => assert.equal((await call({ asr: CLIP })).body.reason, 'silence'));
  await withAsr((p, send) => p.type === 1 && send(srvFrame(errPkt(45000001, 'bad params'))), async () => {
    const r = await call({ asr: CLIP });
    assert.deepEqual([r.body.reason, r.body.code], ['asr_error', '45000001']);
  });
  await withAsr({ status: 401, code: '45000010' }, async () => {
    const r = await call({ asr: CLIP });
    assert.deepEqual([r.body.reason, r.body.code], ['asr_error', '45000010']);
  });
  process.env.ASR_TIMEOUT_MS = '50';
  try {
    await withAsr(() => {}, async () => assert.equal((await call({ asr: CLIP })).body.reason, 'timeout'));
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

test('坏录音：太短、不是 base64、太长、不是字符串、不是 16 kHz 的 WAV，都在连识别服务之前拒', async () => {
  const b = Buffer.from(CLIP, 'base64');
  b.writeUInt32LE(48000, 24);
  await withAsr(sayOnLast({ result: { text: '火' } }), async (opens) => {
    for (const bad of ['AAAA', '这不是base64'.repeat(20), 'A'.repeat(asrMod.AUDIO_B64_MAX + 4), 123, null, 'A'.repeat(200), b.toString('base64')]) {
      const r = await call({ asr: bad });
      assert.equal(r.status, 400, String(bad).slice(0, 10));
      assert.equal(r.body.reason, 'bad_request');
    }
    assert.equal(opens.length, 0);
  });
});
