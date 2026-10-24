// @ts-check
/**
 * 模型文件（DRG2）的读取：冰龙和场景物件共用。格式由打包脚本写出（冰龙见 spell-demo/tools/dragonpack.py，
 * 物件见 tools/pack_prop.py），文件可以是原样或 gzip 压过的（看开头两个字节）。
 */
import * as THREE from 'three';

/**
 * 解开 DRG2：坐标、贴图坐标、索引、法线。
 * @param {ArrayBuffer} buf
 */
export function decodeDRG2(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x32475244) throw new Error('不是 DRG2 格式');    // 'DRG2'
  const nv = dv.getUint32(4, true), nf = dv.getUint32(8, true), flags = dv.getUint32(12, true);
  const f32 = (i) => dv.getFloat32(16 + i * 4, true);
  const lo = [f32(0), f32(1), f32(2)], hi = [f32(3), f32(4), f32(5)], axis = [f32(6), f32(7)];
  const anc = Array.from({ length: 9 }, (_, i) => f32(8 + i));
  let off = 84;
  const P = new Float32Array(nv * 3);
  for (let k = 0; k < 3; k++) {                       // x、y、z 各一段，存的是与上一个顶点的差
    const d = new Int16Array(buf, off, nv); off += nv * 2;
    let q = 0;
    for (let i = 0; i < nv; i++) {
      q = ((q + d[i] + 32768) % 65536 + 65536) % 65536 - 32768;
      P[i * 3 + k] = lo[k] + ((q + 32768) / 65535) * (hi[k] - lo[k]);
    }
  }
  let uv = null;
  if (flags & 1) {
    uv = new Float32Array(nv * 2);
    for (let k = 0; k < 2; k++) {
      const u16 = new Uint16Array(buf, off, nv); off += nv * 2;
      for (let i = 0; i < nv; i++) uv[i * 2 + k] = u16[i] / 65535;
    }
  }
  const zz = new Uint16Array(buf, off, nf * 3), index = new Uint16Array(nf * 3);
  off += nf * 6;
  for (let i = 0, prev = 0; i < nf * 3; i++) {        // 索引差分 + zigzag 的逆变换
    const z = zz[i];
    prev += (z & 1) ? -(z + 1) / 2 : z / 2;
    index[i] = prev;
  }
  let N = null;
  if (flags & 2) {
    N = new Float32Array(nv * 3);
    for (let k = 0; k < 3; k++) {
      const s8 = new Int8Array(buf, off, nv); off += nv;
      for (let i = 0; i < nv; i++) N[i * 3 + k] = s8[i] / 127;
    }
  }
  return { nv, lo, hi, axis, anc, P, uv, index, N };
}

/** @param {string} url @returns {Promise<ArrayBuffer>} 原样或 gzip 压过的都行 */
export async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  const buf = await res.arrayBuffer();
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return buf;
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

/**
 * DRG2 → 静止的几何体（物件用；龙要逐帧变形，自己建）。零长度法线改成朝上，免得着色器里归一化出 NaN。
 * @param {ReturnType<typeof decodeDRG2>} d
 */
export function staticGeometry(d) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(d.P, 3));
  if (d.uv) geo.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
  if (d.N) {
    const N = d.N;
    for (let i = 0; i < d.nv; i++) {
      if (Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) < 0.01) { N[i * 3] = 0; N[i * 3 + 1] = 1; N[i * 3 + 2] = 0; }
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  } else {
    geo.computeVertexNormals();
  }
  geo.setIndex(new THREE.BufferAttribute(d.index, 1));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * 山石模型的顶面在哪（模型坐标）：高、平均宽，顶上一段的水平中心（取范围的中点：顶面不一定在整体正中），
 * 顶面高度（顶上一薄层的中位数：顶面高低不平，取最高点会让放上去的东西悬空）。摆楼阁、拿石柱托索桥的落脚台用。
 * @param {THREE.BufferGeometry} geo 底面在 y = 0
 */
export function topOf(geo) {
  const p = geo.attributes.position, n = p.count;
  let H = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) { H = Math.max(H, p.getY(i)); x0 = Math.min(x0, p.getX(i)); x1 = Math.max(x1, p.getX(i)); z0 = Math.min(z0, p.getZ(i)); z1 = Math.max(z1, p.getZ(i)); }
  let tx0 = Infinity, tx1 = -Infinity, tz0 = Infinity, tz1 = -Infinity;
  const ys = [];
  for (let i = 0; i < n; i++) {
    const y = p.getY(i);
    if (y > H * 0.9) { tx0 = Math.min(tx0, p.getX(i)); tx1 = Math.max(tx1, p.getX(i)); tz0 = Math.min(tz0, p.getZ(i)); tz1 = Math.max(tz1, p.getZ(i)); }
    if (y > H * 0.94) ys.push(y);
  }
  ys.sort((a, b) => a - b);
  return { H, W: (x1 - x0 + z1 - z0) / 2, x: (tx0 + tx1) / 2, z: (tz0 + tz1) / 2, y: ys[ys.length >> 1] ?? H };
}

/**
 * 模型某处 (x, z) 的地面有多高（模型坐标）：盖住这一点的三角形里最高的那个面；没有就是 -Infinity（悬空）。
 * 只收高过 from 的三角形，按 1 米的格子分好桶，查一次只看一个格子
 * @param {THREE.BufferGeometry} geo @param {number} from
 */
export function heightField(geo, from) {
  const p = geo.attributes.position, idx = /** @type {THREE.BufferAttribute} */ (geo.index);
  /** @type {number[]} */
  const T = [];
  /** @type {Map<number, number[]>} */
  const cells = new Map();
  const key = (/** @type {number} */ i, /** @type {number} */ j) => (i + 2048) * 4096 + j + 2048;
  for (let i = 0; i < idx.count; i += 3) {
    const v = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    if (Math.max(...v.map((k) => p.getY(k))) < from) continue;
    const t = T.length;
    for (const k of v) T.push(p.getX(k), p.getY(k), p.getZ(k));
    const xs = v.map((k) => p.getX(k)), zs = v.map((k) => p.getZ(k));
    for (let gx = Math.floor(Math.min(...xs)); gx <= Math.floor(Math.max(...xs)); gx++) {
      for (let gz = Math.floor(Math.min(...zs)); gz <= Math.floor(Math.max(...zs)); gz++) {
        const c = cells.get(key(gx, gz));
        if (c) c.push(t); else cells.set(key(gx, gz), [t]);
      }
    }
  }
  return (/** @type {number} */ x, /** @type {number} */ z) => {
    let h = -Infinity;
    for (const t of cells.get(key(Math.floor(x), Math.floor(z))) ?? []) {
      const [x0, y0, z0, x1, y1, z1, x2, y2, z2] = T.slice(t, t + 9);
      const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
      if (Math.abs(d) < 1e-9) continue;
      const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d, l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
      if (l0 >= 0 && l1 >= 0 && l0 + l1 <= 1) h = Math.max(h, l0 * y0 + l1 * y1 + (1 - l0 - l1) * y2);
    }
    return h;
  };
}

/**
 * 山石顶上能种树的地方（模型坐标）：朝上（三个顶点法线的平均 y > 0.8）、高过 0.9H 的三角形中心，
 * 而且根盘底下整片都托得住：在半径 clear 和一半的两圈上各量 12 处地面，没有一处比这里低过 0.35——离边够远、不在台阶边上，
 * 根盘放下去不会一半悬空（10-24 本人看出原来种在边上的黄山松树根整团露在外面）。
 * 给出的高度取量到的最低处，根按最低处落，高的那边只是埋得深一点。
 * 从离顶面中心最近的一个开始，每次挑离已挑的都最远的（尽量铺开），最多 n 个；所以排在前面的靠中间、后面的靠外。
 * @param {THREE.BufferGeometry} geo 底面在 y = 0 @param {number} n @param {number} [clear]
 */
export function flatSpots(geo, n, clear = 1.5) {
  const p = geo.attributes.position, nm = geo.attributes.normal, idx = /** @type {THREE.BufferAttribute} */ (geo.index), top = topOf(geo);
  const ground = heightField(geo, top.H * 0.8);
  /** @type {THREE.Vector3[]} */
  const cand = [];
  for (let i = 0; i < idx.count; i += 3) {
    const [a, b, c] = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    const y = (p.getY(a) + p.getY(b) + p.getY(c)) / 3;
    if (y < top.H * 0.9 || (nm.getY(a) + nm.getY(b) + nm.getY(c)) / 3 < 0.8) continue;
    const x = (p.getX(a) + p.getX(b) + p.getX(c)) / 3, z = (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3;
    let low = y;
    for (let k = 0; k < 24 && low >= y - 0.35; k++) {
      const ang = (k % 12) * (Math.PI / 6), r = k < 12 ? clear : clear / 2;
      low = Math.min(low, ground(x + Math.cos(ang) * r, z + Math.sin(ang) * r));
    }
    if (low >= y - 0.35) cand.push(new THREE.Vector3(x, low, z));
  }
  if (!cand.length) return [];
  const flat = (/** @type {THREE.Vector3} */ u, /** @type {THREE.Vector3} */ v) => Math.hypot(u.x - v.x, u.z - v.z);
  const centre = new THREE.Vector3(top.x, 0, top.z);
  const out = [cand.reduce((best, q) => (flat(q, centre) < flat(best, centre) ? q : best))];
  const gap = cand.map((q) => flat(q, out[0]));
  while (out.length < n) {
    let k = 0;
    for (let i = 1; i < cand.length; i++) if (gap[i] > gap[k]) k = i;
    if (gap[k] < 1e-6) break;
    out.push(cand[k]);
    cand.forEach((q, i) => { gap[i] = Math.min(gap[i], flat(q, cand[k])); });
  }
  return out;
}

/**
 * 根团的外沿（模型坐标，相对 rootOf 的根）：底下两层（0～0.15、0.15～0.45 米），每层每 30° 取离根最远的一个顶点。
 * 树种进石壁时这一圈都要在石头里，根团才不露（props.js pinePlacements）
 * @param {THREE.BufferGeometry} geo
 */
export function rootRim(geo) {
  const p = geo.attributes.position, root = rootOf(geo);
  /** @type {(THREE.Vector3 | null)[]} */
  const best = new Array(24).fill(null);
  const d = new Float32Array(24);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y >= 0.45) continue;
    const dx = p.getX(i) - root.x, dz = p.getZ(i) - root.z, r = Math.hypot(dx, dz);
    const k = (y < 0.15 ? 0 : 12) + (Math.floor((Math.atan2(dz, dx) + Math.PI) / (Math.PI / 6)) % 12);
    if (r > d[k]) { d[k] = r; best[k] = new THREE.Vector3(dx, y, dz); }
  }
  return /** @type {THREE.Vector3[]} */ (best.filter(Boolean));
}

/** 树根在哪（模型坐标，底面一薄层顶点的平均）：黄山松的根在一头，摆的时候按根对位置 @param {THREE.BufferGeometry} geo */
export function rootOf(geo) {
  const p = geo.attributes.position;
  let H = 0, x = 0, z = 0, k = 0;
  for (let i = 0; i < p.count; i++) H = Math.max(H, p.getY(i));
  for (let i = 0; i < p.count; i++) if (p.getY(i) < H * 0.04) { x += p.getX(i); z += p.getZ(i); k++; }
  return new THREE.Vector3(x / Math.max(k, 1), 0, z / Math.max(k, 1));
}