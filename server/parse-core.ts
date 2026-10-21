/**
 * 解析接口的核心，与平台无关：新加坡的网站路由（app/api/parse/route.ts）和北京的函数（cn-func/）共用这一份。
 * 进来的是请求体原文和来源 IP，出去的是状态码和 JSON；HTTP 怎么收发、跨域怎么放行，由各自的外壳管。
 *
 * POST { text } → { ok, raw, ms, model } 或 { ok: false, reason, fallback: true }
 *      { inspire: { el, talents, foes } } → { ok, lines, ms }（求灵感，见 inspire）
 *      { warm: true } → 预热
 * 密钥只在服务器上（环境变量 ARK_API_KEY），前端拿不到。失败一律让前端改用关键词解析，不让玩家干等。
 * 模型返回的 JSON 只做"是不是对象"的检查；字段清洗与数值裁决在 game/rules/ 里由程序完成。
 */
import { checkLimits } from './limits';
import { INSPIRE_PROMPT, SYSTEM_PROMPT, inspireMessage, userMessage } from './prompt';
import { ENEMIES, INPUT_MAX_CHARS, TALENT_MAX } from '../game/rules/numbers.js';
import { maskText } from '../game/rules/safety.js';
import { talentOpen } from '../game/rules/talents.js';

const BASE = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
// 比前端的 4.5 秒短一截，留出手机到服务器路上的时间
const TIMEOUT_MS = Number(process.env.PARSE_SERVER_TIMEOUT_MS || 4000);
const RAW_MAX = 2000;

export type Reply = { status: number; json: Record<string, unknown> };

const ok = (json: Record<string, unknown>): Reply => ({ status: 200, json });

function fail(reason: string, status = 200, ms?: number, extra?: Record<string, unknown>): Reply {
  return { status, json: { ok: false, reason, fallback: true, ms, ...extra } };
}

/** "fetch failed" 背后的具体原因（DNS 失败、建连超时、连接被掐断……），写进日志与诊断结果 */
function errCode(e: unknown): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string } };
  return err?.cause?.code || (err?.name === 'TimeoutError' || err?.name === 'AbortError' ? err.name : String(err?.message || e).slice(0, 40));
}

const hasKey = () => !!(process.env.ARK_API_KEY && process.env.ARK_MODEL);

function modelBody(extra: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = { model: process.env.ARK_MODEL, ...extra };
  // 带"深度思考"的模型会先想几秒再答，必须关掉；不支持这个参数的模型把 ARK_DISABLE_THINKING 设为 0
  if (process.env.ARK_DISABLE_THINKING !== '0') body.thinking = { type: 'disabled' };
  return body;
}

function postModel(body: Record<string, unknown>, signal: AbortSignal) {
  return fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.ARK_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

/** 调模型、要回一个 JSON 对象（格式不对就抛错，由调用方决定重不重试） */
async function chatJson(system: string, user: string, o: { maxTokens: number; temperature: number }, signal: AbortSignal) {
  const res = await postModel(modelBody({
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: o.temperature,
    max_tokens: o.maxTokens,
    response_format: { type: 'json_object' },
  }), signal);
  if (!res.ok) throw new Error(`model http ${res.status}`);
  const data = await res.json();
  const content: unknown = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length > RAW_MAX) throw new Error('bad content');
  const raw = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('not an object');
  return raw;
}

/**
 * 求灵感：{ el, talents, foes } → 三句咒语。
 * 只认已开放的元素和已知的敌人；写出来的句子过一遍敏感词，被盖住的那句不要，超长的不要。照样计入限流。
 */
async function inspire(ask: unknown, ip: string): Promise<Reply> {
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
  const limit = checkLimits(ip);
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
    return ok({ ok: true, lines, ms: Date.now() - t0 });
  } catch (e) {
    console.error('inspire failed', errCode(e));
    return fail(ctrl.signal.aborted ? 'timeout' : 'model_error', 200, Date.now() - t0);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 预热：发一个只要 1 个词元的请求，把到模型服务的连接建好（北京函数还顺带把睡着的实例叫醒）。
 * 照样计入限流，免得被拿来白嫖调用。平台若每次请求换一台机器，预热的作用会打折扣，但不会出错。
 */
async function warm(): Promise<Reply> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await postModel(modelBody({ messages: [{ role: 'user', content: '1' }], max_tokens: 1 }), ctrl.signal);
    await res.text();
    return ok({ ok: res.ok, warm: true, ms: Date.now() - t0 });
  } catch {
    return fail('warm_failed');
  } finally {
    clearTimeout(timer);
  }
}

/** 解析一句咒语。格式不对、连接被掐断都再试，最多 3 次；超时或剩下的时间不够就不试了 */
async function parse(text: string, ip: string): Promise<Reply> {
  if (!text) return fail('empty', 400);
  if ([...text].length > INPUT_MAX_CHARS) return fail('too_long', 413);
  text = maskText(text).text;   // 游戏页已经盖过一次敏感词；直接调接口的也要盖，模型收不到就编不进名字
  const limit = checkLimits(ip);
  if (!limit.ok) return fail(limit.reason, 429);

  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const errs: string[] = [];
  try {
    for (let i = 0; i < 3; i++) {
      try {
        const raw = await chatJson(SYSTEM_PROMPT, userMessage(text), { maxTokens: 260, temperature: 0 }, ctrl.signal);
        return ok({ ok: true, raw, ms: Date.now() - t0, model: process.env.ARK_MODEL, tries: i + 1 });
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

/** POST：请求体原文 → 解析 / 求灵感 / 预热 */
export async function handlePost(bodyText: string, ip: string): Promise<Reply> {
  if (!hasKey()) return fail('no_key');
  let body: { warm?: unknown; inspire?: unknown; text?: unknown } | null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return fail('bad_request', 400);
  }
  if (body?.warm === true) {
    const limit = checkLimits(ip);
    return limit.ok ? warm() : fail(limit.reason, 429);
  }
  if (body?.inspire) return inspire(body.inspire, ip);
  return parse(typeof body?.text === 'string' ? body.text.trim() : '', ip);
}

/**
 * GET ?diag=n：诊断慢在哪。同一次请求里连着调几次只要 1 个词元的模型请求（diag=1 调两次，diag=2～6 调这么多次）：
 * 第一次要新建连接，之后能复用连接；差得多，说明慢在建连（平台每次换机器就每次都要建）。
 * 失败的带上具体原因（errCode），分清是 DNS、建连还是连接被掐断。照样计入限流。
 */
export async function handleDiag(n: number, ip: string): Promise<Reply> {
  if (!Number.isInteger(n) || n < 1 || n > 6) return fail('bad_request', 400);
  if (!hasKey()) return fail('no_key');
  const limit = checkLimits(ip);
  if (!limit.ok) return fail(limit.reason, 429);
  const calls: { status: number; ms: number; err?: string }[] = [];
  for (let i = 0; i < Math.max(2, n); i++) {
    const t0 = Date.now();
    try {
      const res = await postModel(modelBody({ messages: [{ role: 'user', content: '1' }], max_tokens: 1 }), AbortSignal.timeout(8000));
      await res.text();
      calls.push({ status: res.status, ms: Date.now() - t0 });
    } catch (e) {
      calls.push({ status: 0, ms: Date.now() - t0, err: errCode(e) });
    }
  }
  return ok({ ok: true, calls, node: process.version });
}
