/**
 * 新加坡线路的解析接口（网站自带，部署在境外）：POST /api/parse、GET /api/parse?diag=n。
 * 解析逻辑在 server/parse-core.ts，与北京的函数（cn-func/）共用；这里只管收发 HTTP。
 * 10-21 起网页先走北京线路，这条留作后备（北京不通时自动换过来）。
 */
import { clientIp } from '../../../server/limits';
import { handleDiag, handlePost } from '../../../server/parse-core';
import dns from 'node:dns';
import net from 'node:net';

// 模型服务同时有 IPv4 与 IPv6 地址。Node 默认两种轮流试、每个地址只等 250 毫秒，
// 境外节点到北京建连常超过 250 毫秒，于是每个新起的函数第一次调用都在 0.25 秒报 ETIMEDOUT（10-19 实测 3 次诊断次次如此）。
// 改成先用 IPv4、不轮流试，建连按系统默认的超时等。
if (typeof dns.setDefaultResultOrder === 'function') dns.setDefaultResultOrder('ipv4first');
if (typeof net.setDefaultAutoSelectFamily === 'function') net.setDefaultAutoSelectFamily(false);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 诊断时另外查一下函数实际跑在哪个地区（出口 IP 的归属地） */
export async function GET(req: Request) {
  const r = await handleDiag(Number(new URL(req.url).searchParams.get('diag')), clientIp(req.headers));
  if (r.json.ok) {
    try {
      const res = await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(3000) });
      const j = await res.json();
      r.json.where = { city: j.city, region: j.region, country: j.country, org: j.org };
    } catch { /* 查不到就算了 */ }
  }
  return Response.json(r.json, { status: r.status });
}

export async function POST(req: Request) {
  const r = await handlePost(await req.text(), clientIp(req.headers));
  return Response.json(r.json, { status: r.status });
}
