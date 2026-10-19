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
// 比前端的 4.5 秒短一截，留出手机到服务器路上的时间；部署节点在境外，调北京的模型要 1～2.6 秒（10-19 实测）
const TIMEOUT_MS = Number(process.env.PARSE_SERVER_TIMEOUT_MS || 4000);
const RAW_MAX = 2000;

function fail(reason: string, status = 200, ms?: number) {
  return Response.json({ ok: false, reason, fallback: true, ms }, { status });
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

/**
 * 预热：发一个只要 1 个词元的请求，把到模型服务的连接建好（第一次调用要多花 4～5 秒建连）。
 * 照样计入限流，免得被拿来白嫖调用。平台若每次请求换一台机器，预热的作用会打折扣，但不会出错。
 */
async function warm() {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const body: Record<string, unknown> = { model: process.env.ARK_MODEL, messages: [{ role: 'user', content: '1' }], max_tokens: 1 };
    if (process.env.ARK_DISABLE_THINKING !== '0') body.thinking = { type: 'disabled' };
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.ARK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    await res.text();
    return Response.json({ ok: res.ok, warm: true, ms: Date.now() - t0 });
  } catch {
    return fail('warm_failed');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/parse?diag=1：诊断线上慢在哪。同一次请求里连着调两次只要 1 个词元的模型请求：
 * 第一次要新建连接，第二次能复用连接；两次差得多，说明慢在建连（平台每次换机器就每次都要建）。
 * 另外查一下函数实际跑在哪个地区（出口 IP 的归属地）。照样计入限流。
 */
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get('diag') !== '1') return fail('bad_request', 400);
  if (!process.env.ARK_API_KEY || !process.env.ARK_MODEL) return fail('no_key');
  const limit = checkLimits(clientIp(req.headers));
  if (!limit.ok) return fail(limit.reason, 429);
  const tiny = async () => {
    const t0 = Date.now();
    const body: Record<string, unknown> = { model: process.env.ARK_MODEL, messages: [{ role: 'user', content: '1' }], max_tokens: 1 };
    if (process.env.ARK_DISABLE_THINKING !== '0') body.thinking = { type: 'disabled' };
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.ARK_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
      });
      await res.text();
      return { status: res.status, ms: Date.now() - t0 };
    } catch (e) {
      return { status: 0, ms: Date.now() - t0, err: String(e).slice(0, 80) };
    }
  };
  const first = await tiny();
  const second = await tiny();
  let where: unknown = null;
  try {
    const r = await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    where = { city: j.city, region: j.region, country: j.country, org: j.org };
  } catch { /* 查不到就算了 */ }
  return Response.json({ ok: true, first, second, where });
}

export async function POST(req: Request) {
  if (!process.env.ARK_API_KEY || !process.env.ARK_MODEL) return fail('no_key');
  let text = '';
  try {
    const body = await req.json();
    if (body?.warm === true) {
      const limit = checkLimits(clientIp(req.headers));
      return limit.ok ? warm() : fail(limit.reason, 429);
    }
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
    // 带上服务器这一侧花的时间，前端咒语卡能分清是"手机到服务器"慢还是"服务器到模型"慢
    return fail(ctrl.signal.aborted ? 'timeout' : 'model_error', 200, Date.now() - t0);
  } finally {
    clearTimeout(timer);
  }
}
