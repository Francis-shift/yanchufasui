// 测试脚本共用：读 .env.local，调一次方舟的解析（与 app/api/parse 同样的请求参数）。不打印密钥。
import { readFileSync } from 'node:fs';

/** @returns {Record<string, string>} */
export function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch { /* 没有文件时由调用方报缺什么 */ }
  return env;
}

/** ARK_MODELS=甲,乙（或只填 ARK_MODEL） */
export const modelsOf = (env) => (env.ARK_MODELS || env.ARK_MODEL || '').split(',').map((s) => s.trim()).filter(Boolean);

const { SYSTEM_PROMPT, userMessage } = await import('../server/prompt.ts');
export { SYSTEM_PROMPT };

/**
 * @returns {Promise<{ ms: number, content?: string, raw?: any, real?: string, out?: number, err?: string }>}
 */
export async function callParse(env, model, text) {
  const base = env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
  const body = { model, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage(text) }],
    temperature: 0, max_tokens: 260, response_format: { type: 'json_object' } };
  if (env.ARK_DISABLE_THINKING !== '0') body.thinking = { type: 'disabled' };
  const t0 = performance.now();
  try {
    const res = await fetch(`${base}/chat/completions`, { method: 'POST',
      headers: { Authorization: `Bearer ${env.ARK_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000) });
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) return { ms, err: `http ${res.status} ${(await res.text()).slice(0, 160)}` };
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || '';
    let raw;
    try { raw = JSON.parse(content); } catch { return { ms, content, err: '不是 JSON：' + content.slice(0, 80) }; }
    return { ms, content, raw, real: data?.model, out: data?.usage?.completion_tokens };
  } catch (e) {
    return { ms: Math.round(performance.now() - t0), err: String(e) };
  }
}
