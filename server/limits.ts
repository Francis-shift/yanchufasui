/**
 * 防刷（基础版）：每个来源每分钟次数上限 + 每天总次数上限。超了就让前端改用关键词解析，游戏照样能玩。
 * 计数放在内存里：平台起了多个实例时各算各的、实例重启会清零，所以只是"挡住大部分"，
 * 严格的全局计数要换成平台的键值存储（第一批再做）。
 */
const PER_MINUTE = Number(process.env.RATE_PER_MINUTE || 12);
const PER_DAY = Number(process.env.DAILY_CALL_CAP || 2000);

const perIp = new Map<string, number[]>();
let day = '';
let dayCount = 0;

export type LimitResult = { ok: true } | { ok: false; reason: 'rate' | 'daily' };

export function checkLimits(ip: string, now = Date.now()): LimitResult {
  const today = new Date(now + 8 * 3600_000).toISOString().slice(0, 10);   // 按北京时间换日
  if (today !== day) { day = today; dayCount = 0; }
  if (dayCount >= PER_DAY) return { ok: false, reason: 'daily' };
  const list = (perIp.get(ip) || []).filter((t) => now - t < 60_000);
  if (list.length >= PER_MINUTE) { perIp.set(ip, list); return { ok: false, reason: 'rate' }; }
  list.push(now);
  perIp.set(ip, list);
  dayCount++;
  if (perIp.size > 5000) perIp.clear();          // 防止内存无限长
  return { ok: true };
}

/** headers 只要能按名字取值：网页请求的 Headers，或北京函数里自己包的一层 */
export function clientIp(headers: { get(name: string): string | null | undefined }): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return headers.get('x-real-ip') || headers.get('eo-client-ip') || 'unknown';
}
