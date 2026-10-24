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