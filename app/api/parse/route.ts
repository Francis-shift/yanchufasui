/**
 * POST /api/parse  { text } → { ok, raw, ms, model } 或 { ok: false, reason, fallback: true }
 *                  { inspire: { el, talents, foes } } → { ok, lines, ms }（求灵感，见 inspire）
 * 密钥只在服务器上（环境变量 ARK_API_KEY），前端拿不到。失败一律让前端改用关键词解析，不让玩家干等。
 * 模型返回的 JSON 只做"是不是对象"的检查；字段清洗与数值裁决在 game/rules/ 里由程序完成。
 */
import { checkLimits, clientIp } from '../../../server/limits';
import { INSPIRE_PROMPT, SYSTEM_PROMPT, inspireMessage, userMessage } from '../../../server/prompt';
import { ENEMIES, INPUT_MAX_CHARS, TALENT_MAX } from '../../../game/rules/numbers.js';
import { maskText } from '../../../game/rules/safety.js';
import { talentOpen } from '../../../game/rules/talents.js';
import dns from 'node:dns';
import net from 'node:net';

// 模型服务同时有 IPv4 与 IPv6 地址。Node 默认两种轮流试、每个地址只等 250 毫秒，
// 境外节点到北京建连常超过 250 毫秒，于是每个新起的函数第一次调用都在 0.25 秒报 ETIMEDOUT（10-19 实测 3 次诊断次次如此）。
// 改成先用 IPv4、不轮流试，建连按系统默认的超时等。
if (typeof dns.setDefaultResultOrder === 'function') dns.setDefaultResultOrder('ipv4first');
if (typeof net.setDefaultAutoSelectFamily === 'function') net.setDefaultAutoSelectFamily(false);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
// 比前端的 4.5 秒短一截，留出手机到服务器路上的时间；部署节点在境外，调北京的模型要 1～2.6 秒（10-19 实测）
const TIMEOUT_MS = Number(process.env.PARSE_SERVER_TIMEOUT_MS || 4000);
const RAW_MAX = 2000;

function fail(reason: string, status = 200, ms?: number, extra?: Record<string, unknown>) {
  return Response.json({ ok: false, reason, fallback: true, ms, ...extra }, { status });
}

/** "fetch failed" 背后的具体原因（DNS 失败、建连超时、连接被掐断……），写进日志与诊断结果 */
function errCode(e: unknown): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string } };
  return err?.cause?.code || (err?.name === 'TimeoutError' || err?.name === 'AbortError' ? err.name : String(err?.message || e).slice(0, 40));
}

/** 调模型、要回一个 JSON 对象（格式不对就抛错，由调用方决定重不重试） */
async function chatJson(system: string, user: string, o: { maxTokens: number; temperature: number }, signal: AbortSignal) {
  const body: Record<string, unknown> = {
    model: process.env.ARK_MODEL,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: o.temperature,
    max_tokens: o.maxTokens,
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

const callModel = (text: string, signal: AbortSignal) => chatJson(SYSTEM_PROMPT, userMessage(text), { maxTokens: 260, temperature: 0 }, signal);

/**
 * 求灵感：POST { inspire: { el, talents, foes } } → { ok, lines: [三句], ms }。
 * 只认已开放的元素和已知的敌人；写出来的句子过一遍敏感词，被盖住的那句不要，超长的不要。照样计入限流。
 */
async function inspire(ask: unknown, req: Request) {
  const a = (ask ?? {}) as { el?: unknown; talents?: unknown; foes?: unknown };
  const known = (x: unknown): x is string => typeof x === 'string' && talentOpen(x);
  if (!known(a.el) || !Array.isArray(a.talents) || !a.talents.every(known) || a.talents.length > TALENT_MAX || !a.talents.includes(a.el)) {
    return fail('bad_request', 400);
  }
  const foes: Record<string, number> = {};
  if (a.foes && typeof a.foes === 'object') {
    for (const k of Object.keys(ENEMIES)) {
      const n = Number((a.foes as Record<string, unknown>)[k]);
      if (Number.isInteger(n) && n > 0) foes[k] = Math.min(n, 99);
    }
  }
  const limit = checkLimits(clientIp(req.headers));
  if (!limit.ok) return fail(limit.reason, 429);
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const raw = await chatJson(INSPIRE_PROMPT, inspireMessage(a.el, a.talents as string[], foes), { maxTokens: 200, temperature: 0.9 }, ctrl.signal);
    const s: unknown = (raw as { s?: unknown }).s;
    const lines = (Array.isArray(s) ? s : [])
      .filter((x): x is string => typeof x === 'string')
      .map((x) => maskText(x.trim()).text)
      .filter((x) => x && [...x].length <= INPUT_MAX_CHARS && !x.includes('＊'))
      .slice(0, 3);
    if (!lines.length) return fail('model_error', 200, Date.now() - t0);
    return Response.json({ ok: true, lines, ms: Date.now() - t0 });
  } catch (e) {
    console.error('inspire failed', errCode(e));
    return fail(ctrl.signal.aborted ? 'timeout' : 'model_error', 200, Date.now() - t0);
  } finally {
    clearTimeout(timer);
  }
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
 * GET /api/parse?diag=1：诊断线上慢在哪。同一次请求里连着调几次只要 1 个词元的模型请求（diag=1 调两次，diag=2～6 调这么多次）：
 * 第一次要新建连接，之后能复用连接；差得多，说明慢在建连（平台每次换机器就每次都要建）。
 * 失败的带上具体原因（errCode），分清是 DNS、建连还是连接被掐断。
 * 另外查一下函数实际跑在哪个地区（出口 IP 的归属地）。照样计入限流。
 */
export async function GET(req: Request) {
  const n = Number(new URL(req.url).searchParams.get('diag'));
  if (!Number.isInteger(n) || n < 1 || n > 6) return fail('bad_request', 400);
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
      return { status: 0, ms: Date.now() - t0, err: errCode(e) };
    }
  };
  const calls: { status: number; ms: number; err?: string }[] = [];
  for (let i = 0; i < Math.max(2, n); i++) calls.push(await tiny());
  let where: unknown = null;
  try {
    const r = await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    where = { city: j.city, region: j.region, country: j.country, org: j.org };
  } catch { /* 查不到就算了 */ }
  return Response.json({ ok: true, calls, where, node: process.version });
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
    if (body?.inspire) return inspire(body.inspire, req);
    text = typeof body?.text === 'string' ? body.text.trim() : '';
  } catch {
    return fail('bad_request', 400);
  }
  if (!text) return fail('empty', 400);
  if ([...text].length > INPUT_MAX_CHARS) return fail('too_long', 413);
  text = maskText(text).text;   // 游戏页已经盖过一次敏感词；直接调接口的也要盖，模型收不到就编不进名字
  const limit = checkLimits(clientIp(req.headers));
  if (!limit.ok) return fail(limit.reason, 429);

  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  // 格式不对、连接被掐断（境外节点调北京的模型，10-19 夜里实测常在 0.3 秒内就断）都再试，最多 3 次；超时或剩下的时间不够就不试了
  const errs: string[] = [];
  try {
    for (let i = 0; i < 3; i++) {
      try {
        const raw = await callModel(text, ctrl.signal);
        return Response.json({ ok: true, raw, ms: Date.now() - t0, model: process.env.ARK_MODEL, tries: i + 1 });
      } catch (e) {
        errs.push(errCode(e));
        if (ctrl.signal.aborted || Date.now() - t0 > TIMEOUT_MS - 1200) break;
      }
    }
    console.error('parse failed', errs.join(' | '));
    // 带上服务器这一侧花的时间，前端咒语卡能分清是"手机到服务器"慢还是"服务器到模型"慢
    return fail(ctrl.signal.aborted ? 'timeout' : 'model_error', 200, Date.now() - t0, { tries: errs.length, errs });
  } finally {
    clearTimeout(timer);
  }
}
