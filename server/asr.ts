/**
 * 语音识别：浏览器录的一小段话（16 kHz 单声道 WAV，base64）→ 一句文字，再由前端照打字那样施法。
 * 调火山引擎"流式语音识别 2.0"的流式输入模式（bigmodel_nostream）：录音切成 200 毫秒一包一口气发完，
 * 发完最后一包它回整句（不是边说边出字）。走 WebSocket，包是它自定的二进制格式：4 字节包头 + 4 字节长度 + gzip 过的内容。
 * 原来用的"录音文件识别·极速版"（一次 POST 拿整句）不再给新账号开通，10-29 换成这个；前端不受影响。
 * 密钥只在服务器上：新版控制台给的 API Key 放环境变量 ASR_API_KEY；旧版控制台给的是 APP ID 与 Access Token，
 * 放 ASR_APP_ID、ASR_ACCESS_TOKEN。都没配就答 no_key，前端提示先打字。照样计入限流。
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Duplex } from 'node:stream';
import { gunzipSync, gzipSync } from 'node:zlib';
import { checkLimits } from './limits';
import { INPUT_MAX_CHARS } from '../game/rules/numbers.js';
import { maskText } from '../game/rules/safety.js';

const STREAM_URL = process.env.ASR_URL || 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream';
/** 每次调用时读（测试里要改短）；比前端等的 6.5 秒短一截 */
const timeoutMs = () => Number(process.env.ASR_TIMEOUT_MS || 5000);
/** 包与包之间停多久（毫秒）。文档建议照说话的速度发，录好的整段一口气发完最快；对方嫌快再在平台上配这个 */
const gapMs = () => Number(process.env.ASR_GAP_MS || 0);
/** 识别成功 / 送去的录音是空的 */
export const ASR_OK = 20000000, ASR_EMPTY = 45000002;
/** 最长约 10 秒：16 kHz × 2 字节 × 10 秒 ≈ 320 KB，base64 后约 427 KB */
export const AUDIO_B64_MAX = 440_000;
/** 一包 200 毫秒（16 kHz × 2 字节 × 0.2 秒），文档说 100～200 毫秒一包最好 */
export const PACKET_BYTES = 6400;

/** 包头第 2 字节的高 4 位：消息类型；低 4 位：标志 */
export const MSG = { request: 0b0001, audio: 0b0010, response: 0b1001, error: 0b1111 };
/** 标志：0b0001 带正序号、0b0010 最后一包（不带序号）、0b0011 最后一包（带负序号） */
const HAS_SEQ = 0b0001, LAST = 0b0010;

type Reply = { status: number; json: Record<string, unknown> };
const fail = (reason: string, status = 200, ms?: number, extra?: Record<string, unknown>): Reply =>
  ({ status, json: { ok: false, reason, fallback: true, ms, ...extra } });

/** 按配了哪种密钥给握手时的请求头；都没配返回 null */
export function asrHeaders(env: Record<string, string | undefined> = process.env): Record<string, string> | null {
  const id = randomUUID();
  const base = { 'X-Api-Resource-Id': env.ASR_RESOURCE_ID || 'volc.seedasr.sauc.duration', 'X-Api-Request-Id': id, 'X-Api-Connect-Id': id };
  if (env.ASR_API_KEY) return { ...base, 'X-Api-Key': env.ASR_API_KEY };
  if (env.ASR_APP_ID && env.ASR_ACCESS_TOKEN) return { ...base, 'X-Api-App-Key': env.ASR_APP_ID, 'X-Api-Access-Key': env.ASR_ACCESS_TOKEN };
  return null;
}

/** 识别结果里取那句话（result 是对象或数组都认），去掉句末标点、盖敏感词、截到咒语的长度 */
export function pickText(data: unknown): string {
  const r = (data as { result?: unknown } | null)?.result;
  const t = Array.isArray(r) ? (r[0] as { text?: unknown } | undefined)?.text : (r as { text?: unknown } | undefined)?.text;
  if (typeof t !== 'string') return '';
  const s = t.trim().replace(/[。，、！？!?,.\s]+$/u, '');
  return [...maskText(s).text].slice(0, INPUT_MAX_CHARS).join('');
}

/** WAV → 里面的样本（只认 16 位、单声道、16 kHz，就是浏览器那边编的格式）；别的返回 null */
export function wavPcm(b: Buffer): Buffer | null {
  if (b.length < 12 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return null;
  let fmt = false;
  for (let o = 12; o + 8 <= b.length;) {
    const id = b.toString('ascii', o, o + 4), n = b.readUInt32LE(o + 4);
    if (id === 'fmt ' && o + 24 <= b.length) {
      fmt = b.readUInt16LE(o + 8) === 1 && b.readUInt16LE(o + 10) === 1 && b.readUInt32LE(o + 12) === 16000 && b.readUInt16LE(o + 22) === 16;
    }
    if (id === 'data') return fmt ? b.subarray(o + 8, Math.min(b.length, o + 8 + n)) : null;
    o += 8 + n + (n & 1);
  }
  return null;
}

// ---------------------------------------------------------------- 识别服务自己的包格式

/** 打一个包：版本 1、包头 4 字节；内容一律 gzip（json 为真时标成 JSON，录音标成不序列化） */
export function packet(type: number, flags: number, json: boolean, body: Buffer): Buffer {
  const z = gzipSync(body), size = Buffer.alloc(4);
  size.writeUInt32BE(z.length);
  return Buffer.concat([Buffer.from([0x11, (type << 4) | flags, ((json ? 1 : 0) << 4) | 1, 0]), size, z]);
}

export type ServerMsg = { last: boolean; code: number; data?: unknown; message?: string };

/** 拆对方回的包：正常回包取出 JSON；出错包取出错误码和说明 */
export function parseServer(b: Buffer): ServerMsg {
  const type = b[1] >> 4, flags = b[1] & 0x0f, gz = (b[2] & 0x0f) === 1;
  let o = (b[0] & 0x0f) * 4;
  if (type === MSG.error) {
    const n = b.readUInt32BE(o + 4);
    return { last: true, code: b.readUInt32BE(o), message: b.toString('utf8', o + 8, o + 8 + n) };
  }
  if (type !== MSG.response) return { last: true, code: 0, message: `type ${type}` };
  if (flags & HAS_SEQ) o += 4;
  const n = b.readUInt32BE(o);
  let body = b.subarray(o + 4, o + 4 + n);
  if (gz && n) body = gunzipSync(body);
  return { last: (flags & LAST) !== 0, code: ASR_OK, data: n ? JSON.parse(body.toString('utf8')) : null };
}

// ---------------------------------------------------------------- 最简 WebSocket（握手要带鉴权请求头，Node 自带的那个带不了）

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** 客户端发出去的帧：一帧发完、加掩码（协议规定客户端必须加） */
export function wsFrame(payload: Buffer, opcode = 2): Buffer {
  const n = payload.length, mask = randomBytes(4);
  let head: Buffer;
  if (n < 126) head = Buffer.from([0x80 | opcode, 0x80 | n]);
  else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 0x80 | 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(n), 2); }
  const body = Buffer.alloc(n);
  for (let i = 0; i < n; i++) body[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([head, mask, body]);
}

/** 从收到的字节里切出完整的消息：可能一次来半帧、也可能一次来几帧；分片的拼好再交出，控制帧（关闭、心跳）单独交出 */
export class WsReader {
  buf = Buffer.alloc(0);
  parts: Buffer[] = [];
  op = 0;

  push(chunk: Buffer): { op: number; data: Buffer }[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: { op: number; data: Buffer }[] = [];
    for (;;) {
      const b = this.buf;
      if (b.length < 2) break;
      let n = b[1] & 0x7f, o = 2;
      if (n === 126) { if (b.length < 4) break; n = b.readUInt16BE(2); o = 4; }
      else if (n === 127) { if (b.length < 10) break; n = Number(b.readBigUInt64BE(2)); o = 10; }
      const masked = (b[1] & 0x80) !== 0;
      if (b.length < o + (masked ? 4 : 0) + n) break;
      const mask = masked ? b.subarray(o, o + 4) : null;
      if (masked) o += 4;
      const data = Buffer.from(b.subarray(o, o + n));
      if (mask) for (let i = 0; i < n; i++) data[i] ^= mask[i & 3];
      this.buf = b.subarray(o + n);
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f;
      if (op >= 8) { out.push({ op, data }); continue; }
      if (op) this.op = op;
      this.parts.push(data);
      if (fin) { out.push({ op: this.op, data: Buffer.concat(this.parts) }); this.parts = []; }
    }
    return out;
  }
}

type WsError = Error & { status?: number; code?: string; logid?: string };

/** 握手连上，返回底层连接；对方不升级（密钥不对、没开通）就把它回的状态码、错误码带出来。ms 内没连上算超时 */
function openWs(url: string, headers: Record<string, string>, ms: number): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const u = new URL(url), key = randomBytes(16).toString('base64');
    const req = (u.protocol === 'wss:' ? httpsRequest : httpRequest)({
      hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search,
      headers: { ...headers, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key },
    });
    // 不用 signal：握手之后它再触发会把已经交出去的连接也掐断
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), ms);
    req.on('close', () => clearTimeout(timer));
    req.on('upgrade', (res, socket, head) => {
      clearTimeout(timer);
      if (res.headers['sec-websocket-accept'] !== createHash('sha1').update(key + WS_GUID).digest('base64')) {
        socket.destroy();
        reject(Object.assign(new Error('bad handshake'), { status: 101 }));
        return;
      }
      if (head.length) socket.unshift(head);
      resolve(socket);
    });
    req.on('response', (res) => {
      const h = (k: string) => String(res.headers[k] ?? '');
      let said = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => { if (said.length < 200) said += d; });
      res.on('end', () => reject(Object.assign(new Error(`refused ${said.slice(0, 200)}`), {
        status: res.statusCode, code: h('x-api-status-code') || `http_${res.statusCode}`, logid: h('x-tt-logid'),
      }) as WsError));
    });
    req.on('error', reject);
    req.end();
  });
}

/** 换连接的口子：测试里换成内存里的一对管道 */
export const deps = { open: openWs };

const REQUEST = {
  user: { uid: 'yanchufasui' },
  audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 },
  request: { model_name: 'bigmodel', enable_itn: true, enable_punc: false },
};

/** 在连好的连接上跑一次：发参数，录音分包发完（最后一包打上标志），等对方回带"最后"标志的包或出错包 */
export function recognize(sock: Duplex, pcm: Buffer, ms: number): Promise<ServerMsg> {
  return new Promise((resolve, reject) => {
    const reader = new WsReader();
    let latest: ServerMsg | null = null, settled = false;
    const finish = (f: () => void) => { if (!settled) { settled = true; clearTimeout(timer); f(); } };
    const timer = setTimeout(() => finish(() => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))), ms);
    sock.on('data', (chunk: Buffer) => {
      for (const f of reader.push(chunk)) {
        if (f.op === 9) sock.write(wsFrame(f.data, 10));
        else if (f.op === 8) finish(() => (latest ? resolve(latest) : reject(new Error('closed'))));
        else if (f.op === 1 || f.op === 2) {
          let m: ServerMsg;
          try { m = parseServer(f.data); } catch (e) { finish(() => reject(e)); return; }
          if (m.code !== ASR_OK || m.last) finish(() => resolve(m));
          else latest = m;
        }
      }
    });
    sock.on('error', (e) => finish(() => reject(e)));
    sock.on('close', () => finish(() => (latest ? resolve(latest) : reject(new Error('closed')))));
    (async () => {
      sock.write(wsFrame(packet(MSG.request, 0, true, Buffer.from(JSON.stringify(REQUEST)))));
      for (let o = 0; !settled; o += PACKET_BYTES) {
        const end = o + PACKET_BYTES >= pcm.length;
        sock.write(wsFrame(packet(MSG.audio, end ? LAST : 0, false, pcm.subarray(o, o + PACKET_BYTES))));
        if (end) break;
        if (gapMs() > 0) await new Promise((r) => setTimeout(r, gapMs()));
      }
    })().catch((e) => finish(() => reject(e)));
  });
}

export async function asr(audio: unknown, ip: string): Promise<Reply> {
  if (typeof audio !== 'string' || audio.length < 100 || audio.length > AUDIO_B64_MAX || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) return fail('bad_request', 400);
  const pcm = wavPcm(Buffer.from(audio, 'base64'));
  if (!pcm) return fail('bad_request', 400);
  const headers = asrHeaders();
  if (!headers) return fail('no_key');
  const limit = checkLimits(ip);
  if (!limit.ok) return fail(limit.reason, 429);
  const t0 = Date.now(), total = timeoutMs();
  let sock: Duplex | null = null;
  try {
    sock = await deps.open(STREAM_URL, headers, total);
    const m = await recognize(sock, pcm, total - (Date.now() - t0));
    const ms = Date.now() - t0, text = m.code === ASR_OK ? pickText(m.data) : '';
    if (m.code === ASR_EMPTY || (m.code === ASR_OK && !text)) return fail('silence', 200, ms);
    if (m.code !== ASR_OK) {
      console.error('asr failed', m.code, (m.message || '').slice(0, 80));
      return fail('asr_error', 200, ms, { code: String(m.code) });
    }
    return { status: 200, json: { ok: true, text, ms } };
  } catch (e) {
    const err = e as WsError;
    console.error('asr failed', err?.name, err?.message, err?.status ?? '', err?.code ?? '', err?.logid ?? '');
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return fail(timeout ? 'timeout' : 'asr_error', 200, Date.now() - t0, err?.code ? { code: err.code } : undefined);
  } finally {
    if (sock && !sock.destroyed) sock.end(wsFrame(Buffer.from([0x03, 0xe8]), 8), () => sock?.destroy());
  }
}
