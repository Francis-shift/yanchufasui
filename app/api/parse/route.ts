/**
 * POST /api/parse  { text } → { ok, raw, ms, model } 或 { ok: false, reason, fallback: true }
 * 密钥只在服务器上（环境变量 ARK_API_KEY），前端拿不到。失败一律让前端改用关键词解析，不让玩家干等。
 * 模型返回的 JSON 只做"是不是对象"的检查；字段清洗与数值裁决在 game/rules/ 里由程序完成。
 */
import { checkLimits, clientIp } from '../../../server/limits';
import { SYSTEM_PROMPT, userMessage } from '../../../server/prompt';
import { INPUT_MAX_CHARS } from '../../../game/rules/numbers.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
const TIMEOUT_MS = Number(process.env.PARSE_SERVER_TIMEOUT_MS || 3000);
const RAW_MAX = 2000;

function fail(reason: string, status = 200) {
  return Response.json({ ok: false, reason, fallback: true }, { status });
}

async function callModel(text: string, signal: AbortSignal) {
  const body: Record<string, unknown> = {
    model: process.env.ARK_MODEL,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage(text) }],
    temperature: 0,
    max_tokens: 260,
    response_format: { type: 'json_object' },
  };
  // 带"深度思考"的模型会先想几秒再答，必须关掉；不支持这个参数的模型把 ARK_DISABLE_THINKING 设为 0
  if (process.env.ARK_DISABLE_THINKING !== '0') body.thinking = { type: 'disabled' };
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.ARK_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`model http ${res.status}`);
  const data = await res.json();
  const content: unknown = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length > RAW_MAX) throw new Error('bad content');
  const raw = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('not an object');
  return raw;
}

export async function POST(req: Request) {
  if (!process.env.ARK_API_KEY || !process.env.ARK_MODEL) return fail('no_key');
  let text = '';
  try {
    const body = await req.json();
    text = typeof body?.text === 'string' ? body.text.trim() : '';
  } catch {
    return fail('bad_request', 400);
  }
  if (!text) return fail('empty', 400);
  if ([...text].length > INPUT_MAX_CHARS) return fail('too_long', 413);
  const limit = checkLimits(clientIp(req.headers));
  if (!limit.ok) return fail(limit.reason, 429);

  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let raw;
    try {
      raw = await callModel(text, ctrl.signal);
    } catch (e) {
      // 格式不对重试一次；超时或时间不够就不重试
      if (ctrl.signal.aborted || Date.now() - t0 > TIMEOUT_MS - 1200) throw e;
      raw = await callModel(text, ctrl.signal);
    }
    return Response.json({ ok: true, raw, ms: Date.now() - t0, model: process.env.ARK_MODEL });
  } catch (e) {
    return fail(ctrl.signal.aborted ? 'timeout' : 'model_error');
  } finally {
    clearTimeout(timer);
  }
}
