// @ts-check
/**
 * 请服务器上的模型解析一句咒语。任何失败（没配密钥、超时、限流、断网）都返回 null，
 * 由调用方改用关键词解析——不让玩家对着法阵干等。
 */

/**
 * @param {string | undefined} url
 * @param {string} text
 * @param {number} timeoutMs
 * @returns {Promise<{ raw: any, ms: number, model: string } | { fail: string, ms?: number }>} ms 是服务器上调模型花的毫秒数
 */
export async function parseRemote(url, text, timeoutMs) {
  if (!url) return { fail: 'offline' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: ctrl.signal,
    });
    const data = await res.json().catch(() => null);
    if (!data || !data.ok) return { fail: (data && data.reason) || `http_${res.status}`, ms: data && data.ms };
    return { raw: data.raw, ms: data.ms, model: data.model };
  } catch {
    return { fail: ctrl.signal.aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 求灵感：请服务器上的模型看着天赋和眼前的敌人现写几句咒语（给按钮写咒时用）。
 * 任何失败都返回空数组，由调用方改给卷轴里写好的句子。
 * @param {string | undefined} url
 * @param {{ el: string, talents: string[], foes: Record<string, number> }} ask
 * @param {number} timeoutMs
 * @returns {Promise<string[]>}
 */
export async function inspireRemote(url, ask, timeoutMs) {
  if (!url) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inspire: ask }), signal: ctrl.signal,
    });
    const data = await res.json().catch(() => null);
    return data?.ok && Array.isArray(data.lines) ? data.lines.filter((s) => typeof s === 'string' && s.trim()).slice(0, 3) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 预热：标题画面一出来就发一个极小的请求，先把浏览器到服务器、服务器到模型的连接建好。
 * 实测每个模型的第一次调用要 4.5～6 秒（建连），之后约 1 秒；不预热的话玩家第一句很可能超时。
 * 结果不用，失败也不管。
 * @param {string | undefined} url
 */
export function warmUp(url) {
  if (!url) return;
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ warm: true }) }).catch(() => {});
}
