/**
 * 语音识别：浏览器录的一小段话（16 kHz 单声道 WAV，base64）→ 一句文字，再由前端照打字那样施法。
 * 调火山引擎"录音文件识别大模型·极速版"：一次传完、一次拿回整句（不是边说边出字）。
 * 密钥只在服务器上：新版控制台给的 API Key 放环境变量 ASR_API_KEY；旧版控制台给的是 APP ID 与 Access Token，
 * 放 ASR_APP_ID、ASR_ACCESS_TOKEN。都没配就答 no_key，前端提示先打字。照样计入限流。
 */
import { randomUUID } from 'node:crypto';
import { checkLimits } from './limits';
import { INPUT_MAX_CHARS } from '../game/rules/numbers.js';
import { maskText } from '../game/rules/safety.js';

const FLASH_URL = process.env.ASR_URL || 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';
/** 每次调用时读（测试里要改短）；比前端等的 6.5 秒短一截 */
const timeoutMs = () => Number(process.env.ASR_TIMEOUT_MS || 5000);
/** 识别成功 / 整段是静音（极速版在响应头 X-Api-Status-Code 里给） */
export const ASR_OK = '20000000', ASR_SILENT = '20000003';
/** 最长约 10 秒：16 kHz × 2 字节 × 10 秒 ≈ 320 KB，base64 后约 427 KB */
export const AUDIO_B64_MAX = 440_000;

type Reply = { status: number; json: Record<string, unknown> };
const fail = (reason: string, status = 200, ms?: number, extra?: Record<string, unknown>): Reply =>
  ({ status, json: { ok: false, reason, fallback: true, ms, ...extra } });

/** 按配了哪种密钥给请求头；都没配返回 null */
export function asrHeaders(env: Record<string, string | undefined> = process.env): Record<string, string> | null {
  const base = {
    'Content-Type': 'application/json', 'X-Api-Resource-Id': env.ASR_RESOURCE_ID || 'volc.bigasr.auc_turbo',
    'X-Api-Request-Id': randomUUID(), 'X-Api-Sequence': '-1',
  };
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

export async function asr(audio: unknown, ip: string): Promise<Reply> {
  if (typeof audio !== 'string' || audio.length < 100 || audio.length > AUDIO_B64_MAX || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) return fail('bad_request', 400);
  const headers = asrHeaders();
  if (!headers) return fail('no_key');
  const limit = checkLimits(ip);
  if (!limit.ok) return fail(limit.reason, 429);
  const t0 = Date.now();
  try {
    const res = await fetch(FLASH_URL, {
      method: 'POST', headers, signal: AbortSignal.timeout(timeoutMs()),
      body: JSON.stringify({ user: { uid: 'yanchufasui' }, audio: { data: audio }, request: { model_name: 'bigmodel', enable_itn: true, enable_punc: false } }),
    });
    const code = res.headers.get('x-api-status-code') || '';
    const text = pickText(await res.json().catch(() => null));
    const ms = Date.now() - t0;
    if (code === ASR_SILENT || (code === ASR_OK && !text)) return fail('silence', 200, ms);
    if (code !== ASR_OK || !text) {
      console.error('asr failed', res.status, code, (res.headers.get('x-api-message') || '').slice(0, 80));
      return fail('asr_error', 200, ms, { code });
    }
    return { status: 200, json: { ok: true, text, ms } };
  } catch (e) {
    const err = e as { name?: string };
    console.error('asr failed', err?.name);
    return fail(err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'asr_error', 200, Date.now() - t0);
  }
}
