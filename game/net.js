// @ts-check
/**
 * 请服务器上的模型解析一句咒语。任何失败（没配密钥、超时、限流、断网）都返回失败，
 * 由调用方改用关键词解析——不让玩家对着法阵干等。
 *
 * 线路可以给一串：先走第一条（北京，与模型同机房），连不上或网关出错就在剩下的时间里换下一条（新加坡）；
 * 连不上的那条记下来，一分钟内直接跳过。服务器正常回了"不行"（模型出错、限流、超时）就不换：
 * 两条线路调的是同一个模型，换了多半也一样，还白白多等。
 * 请求体是 JSON，但标成 text/plain：跨站请求不触发预检，少一次来回（两边服务器都按原文解析）。
 */

const SKIP_MS = 60_000;
const MIN_LEFT_MS = 1500;
/** 这几种"不行"是那条线路没配好（来源没放行、没配密钥），换一条就好 */
const CONFIG_FAIL = new Set(['origin', 'no_key']);
/** @type {Map<string, number>} 线路 → 跳过到什么时候 */
const downUntil = new Map();

/** @param {string | string[] | undefined} url @returns {string[]} */
function routes(url) {
  /** @type {string[]} */
  const list = [];
  for (const u of Array.isArray(url) ? url : [url]) if (typeof u === 'string' && u) list.push(u);
  const now = Date.now();
  const up = list.filter((u) => !(Number(downUntil.get(u)) > now));
  return up.length ? up : list.slice(-1);   // 全被跳过就硬着头皮走最后一条
}

/**
 * @param {string} url
 * @param {object} payload
 * @param {number} timeoutMs
 * @returns {Promise<{ data: any, status: number } | { error: 'timeout' | 'network' }>}
 */
async function post(url, payload, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(payload), signal: ctrl.signal,
    });
    const data = await res.json().catch(() => null);
    return { data, status: res.status };
  } catch {
    return { error: ctrl.signal.aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 按线路顺序发，返回第一份成功的答复；都不行就返回最后一次的失败原因。
 * @param {string | string[] | undefined} url
 * @param {object} payload
 * @param {number} timeoutMs
 * @returns {Promise<{ data: any, via: number } | { fail: string, ms?: number }>} via：答复来自给定的第几条线路（0 是首选）
 */
async function ask(url, payload, timeoutMs) {
  const list = routes(url);
  if (!list.length) return { fail: 'offline' };
  const all = Array.isArray(url) ? url : [url];
  const t0 = Date.now();
  /** @type {{ fail: string, ms?: number }} */
  let last = { fail: 'offline' };
  for (const u of list) {
    const left = timeoutMs - (Date.now() - t0);
    if (left < MIN_LEFT_MS && u !== list[0]) break;
    const r = await post(u, payload, left);
    if ('error' in r) {
      last = { fail: r.error };
      if (r.error === 'timeout') break;   // 时间用完了，换线路也来不及
      downUntil.set(u, Date.now() + SKIP_MS);
      continue;
    }
    const ours = !!r.data && typeof r.data.ok === 'boolean';   // 是我们的接口答的，不是网关的报错页
    if (ours && r.data.ok) { downUntil.delete(u); return { data: r.data, via: all.indexOf(u) }; }
    last = { fail: (ours && r.data.reason) || `http_${r.status}`, ms: ours ? r.data.ms : undefined };
    if (ours && r.status < 500 && !CONFIG_FAIL.has(r.data.reason)) break;   // 服务器正常答了"不行"，不换
    downUntil.set(u, Date.now() + SKIP_MS);   // 网关报错、页面不存在、那边没配好之类，换下一条
  }
  return last;
}

/**
 * @param {string | string[] | undefined} url
 * @param {string} text
 * @param {number} timeoutMs
 * @returns {Promise<{ raw: any, ms: number, model: string, via: number } | { fail: string, ms?: number }>} ms 是服务器上调模型花的毫秒数；via 见 ask
 */
export async function parseRemote(url, text, timeoutMs) {
  const r = await ask(url, { text }, timeoutMs);
  return 'data' in r ? { raw: r.data.raw, ms: r.data.ms, model: r.data.model, via: r.via } : r;
}

/**
 * 求灵感：请服务器上的模型看着天赋和眼前的敌人现写几句咒语（给按钮写咒时用）。
 * 任何失败都返回空数组，由调用方改给卷轴里写好的句子。
 * @param {string | string[] | undefined} url
 * @param {{ el: string, talents: string[], foes: Record<string, number> }} req
 * @param {number} timeoutMs
 * @returns {Promise<string[]>}
 */
export async function inspireRemote(url, req, timeoutMs) {
  const r = await ask(url, { inspire: req }, timeoutMs);
  const lines = 'data' in r ? r.data.lines : null;
  return Array.isArray(lines) ? lines.filter((s) => typeof s === 'string' && s.trim()).slice(0, 3) : [];
}

/**
 * 语音识别：一段录音（16 kHz 单声道 WAV 的 base64，见 voice.js）→ 一句文字。线路与解析共用（服务器那头按 asr 字段分开处理）。
 * @param {string | string[] | undefined} url
 * @param {string} audio
 * @param {number} timeoutMs
 * @returns {Promise<{ text: string, ms: number } | { fail: string, ms?: number }>} ms 是服务器上识别花的毫秒数
 */
export async function asrRemote(url, audio, timeoutMs) {
  const r = await ask(url, { asr: audio }, timeoutMs);
  if (!('data' in r)) return r;
  return typeof r.data.text === 'string' && r.data.text ? { text: r.data.text, ms: r.data.ms } : { fail: 'silence' };
}

/**
 * 预热：标题画面一出来就发一个极小的请求，先把浏览器到服务器、服务器到模型的连接建好，
 * 北京的函数没人用时会睡着，这一下也把它叫醒。只预热第一条线路；结果不用，失败也不管。
 * @param {string | string[] | undefined} url
 */
export function warmUp(url) {
  const first = routes(url)[0];
  if (!first) return;
  fetch(first, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ warm: true }) }).catch(() => {});
}

/** 测试用：清掉"一分钟内跳过"的记录 */
export function resetRoutes() {
  downUntil.clear();
}
