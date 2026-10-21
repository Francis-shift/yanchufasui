// 北京线路的解析函数（火山引擎函数服务的事件函数，经 API 网关的默认域名访问，与模型同在华北2）。
// 这里只管 HTTP 收发、跨域和来源 IP；解析逻辑与新加坡线路共用 server/parse-core.ts。
// 打包：node tools/build-cn-func.mjs → cn-func/dist/ 与 cn-func/yanchu-parse.zip，在函数服务控制台上传；打包后本文件改名为 index.js。
'use strict';

// 展会现场许多人共用一个出口 IP，按 IP 每分钟 12 次太紧、每天 2000 次也不够；北京这边默认放宽。
// 平台上配了同名环境变量就以平台为准；花多少钱的硬上限在方舟的"模型用量上限"。
process.env.RATE_PER_MINUTE ||= '30';
process.env.DAILY_CALL_CAP ||= '6000';

const ALLOW = (process.env.ALLOW_ORIGINS || 'https://www.yanchufasui.top,https://yanchufasui.top,http://localhost:3000')
  .split(',').map((s) => s.trim()).filter(Boolean);

let core;
const load = () => (core ||= import('./parse-core.mjs'));

// 实例启动时先把模块载入，第一位玩家少等一点
exports.initializer = async () => { await load(); };

exports.handler = async function handler(event) {
  const h = {};
  for (const [k, v] of Object.entries((event && event.headers) || {})) h[k.toLowerCase()] = Array.isArray(v) ? String(v[0]) : String(v);
  const origin = h.origin || '';
  const allowed = ALLOW.includes(origin);
  const cors = allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
  const method = String((event && event.httpMethod) || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' },
      body: '',
    };
  }
  // 浏览器从别的网站来调会带上那个网站的 Origin，不认就拒；不带 Origin 的（测速脚本、命令行）放行，照样受限流
  if (origin && !allowed) return reply(403, { ok: false, reason: 'origin', fallback: true }, cors);

  const { handleDiag, handlePost } = await load();
  const ip = (h['x-forwarded-for'] || '').split(',')[0].trim() || h['x-real-ip'] || 'unknown';

  if (method === 'GET') {
    const q = (event && event.queryStringParameters) || {};
    const r = await handleDiag(Number(q.diag), ip);
    // 只说认没认出来源 IP，不回显 IP 本身：认不出来时所有人共用一个限流名额，要尽早发现
    return reply(r.status, { ...r.json, where: 'cn-beijing', ipKnown: ip !== 'unknown' }, cors);
  }

  let body = event && event.body != null ? event.body : '';
  if (event && event.isBase64Encoded && typeof body === 'string') body = Buffer.from(body, 'base64').toString('utf8');
  if (typeof body !== 'string') body = JSON.stringify(body);
  const r = await handlePost(body, ip);
  return reply(r.status, r.json, cors);
};

function reply(statusCode, json, cors) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
    body: JSON.stringify(json),
  };
}
