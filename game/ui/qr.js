// @ts-check
/**
 * 二维码（战报卡上那个，扫了打开游戏）：只做字节模式、纠错 M 级、版本 1～4（最多 62 个字节，放一个网址够了）。
 * 按标准（ISO/IEC 18004）一步步来：编码数据 → 分块加纠错码 → 摆定位、时序、校正图形 → 蛇形填数据 → 八种掩码挑罚分最低的 → 写格式信息。
 * 网页里不另外引库（预览页的体积很紧）；对不对由测试里的纠错码样例和 OpenCV 实际解码核过。
 */

/** 版本 1～4、M 级：每块的纠错码个数、分几块（每块数据一样长）；总码字数 */
const M_LEVEL = [null, { ec: 10, blocks: 1, total: 26 }, { ec: 16, blocks: 1, total: 44 }, { ec: 26, blocks: 1, total: 70 }, { ec: 18, blocks: 2, total: 100 }];
/** 校正图形中心的坐标（版本 1 没有） */
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26]];

/** GF(256) 乘法（本原多项式 x^8 + x^4 + x^3 + x^2 + 1） @param {number} x @param {number} y */
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** 里德-所罗门纠错码：data 的 n 个纠错码字 @param {number[]} data @param {number} n @returns {number[]} */
export function rsEcc(data, n) {
  // 生成多项式 (x - α^0)(x - α^1)…(x - α^(n-1)) 的系数（不含最高次项的 1）
  const gen = new Array(n).fill(0);
  gen[n - 1] = 1;
  let root = 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      gen[j] = gfMul(gen[j], root);
      if (j + 1 < n) gen[j] ^= gen[j + 1];
    }
    root = gfMul(root, 2);
  }
  const rem = new Array(n).fill(0);
  for (const b of data) {
    const f = b ^ /** @type {number} */ (rem.shift());
    rem.push(0);
    for (let j = 0; j < n; j++) rem[j] ^= gfMul(gen[j], f);
  }
  return rem;
}

/** 格式信息 15 位：纠错级别（M 是 00）与掩码号，BCH 校验后异或 0x5412 @param {number} mask */
export function formatBits(mask) {
  const data = (0 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** 八种掩码：第 y 行第 x 列要不要翻 */
const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** 罚分（标准里的四条：连着同色、2×2 同色块、像定位图形的 1:1:3:1:1、深色占比偏离一半） @param {boolean[][]} m */
function penalty(m) {
  const n = m.length;
  let p = 0, dark = 0;
  const finder = (/** @type {boolean[]} */ a, /** @type {number} */ i) =>
    a[i] && !a[i + 1] && a[i + 2] && a[i + 3] && a[i + 4] && !a[i + 5] && a[i + 6]
    && ((i >= 4 && !a[i - 1] && !a[i - 2] && !a[i - 3] && !a[i - 4]) || (i + 10 < a.length && !a[i + 7] && !a[i + 8] && !a[i + 9] && !a[i + 10]));
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < n; i++) {
      const line = k ? m.map((r) => r[i]) : m[i];
      let run = 1;
      for (let j = 1; j <= n; j++) {
        if (j < n && line[j] === line[j - 1]) run++;
        else { if (run >= 5) p += run - 2; run = 1; }
      }
      for (let j = 0; j + 6 < n; j++) if (finder(line, j)) p += 40;
    }
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (m[y][x]) dark++;
      if (y + 1 < n && x + 1 < n && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
    }
  }
  return p + Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
}

/**
 * 文字 → 二维码的模块矩阵（true 是深色；不含四周的空白，画的时候四周要留出浅色的边）
 * @param {string} text @returns {boolean[][]}
 */
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  const ver = [1, 2, 3, 4].find((v) => {
    const cfg = /** @type {{ ec: number, blocks: number, total: number }} */ (M_LEVEL[v]);
    return 4 + 8 + bytes.length * 8 <= (cfg.total - cfg.ec * cfg.blocks) * 8;
  });
  if (!ver) throw new Error('二维码装不下这么长');
  const cfg = /** @type {{ ec: number, blocks: number, total: number }} */ (M_LEVEL[ver]);
  const dataLen = cfg.total - cfg.ec * cfg.blocks;

  // 数据：模式 0100、8 位长度、各字节、最多 4 个 0 结束、补齐到整字节、再轮流补 0xEC 0x11
  /** @type {number[]} */
  const bits = [];
  const put = (/** @type {number} */ v, /** @type {number} */ n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4); put(bytes.length, 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, dataLen * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataLen; pad ^= 0xec ^ 0x11) data.push(pad);

  // 分块、各加纠错码，再交错排：先各块的第 1 个数据码字，再第 2 个……最后同样交错纠错码
  const per = dataLen / cfg.blocks, blocks = [], eccs = [];
  for (let b = 0; b < cfg.blocks; b++) { const d = data.slice(b * per, (b + 1) * per); blocks.push(d); eccs.push(rsEcc(d, cfg.ec)); }
  const words = [];
  for (let i = 0; i < per; i++) for (const d of blocks) words.push(d[i]);
  for (let i = 0; i < cfg.ec; i++) for (const e of eccs) words.push(e[i]);

  // 功能图形：时序线、三个定位图形（连同一圈白边）、校正图形、格式信息的位置、那一个固定的深色模块
  const n = 17 + ver * 4;
  const mod = Array.from({ length: n }, () => new Array(n).fill(false));
  const fn = Array.from({ length: n }, () => new Array(n).fill(false));
  const set = (/** @type {number} */ x, /** @type {number} */ y, /** @type {boolean} */ dark) => { mod[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < n && y >= 0 && y < n) set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const al = /** @type {number[]} */ (ALIGN[ver]);
  for (const cy of al) {
    for (const cx of al) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === al[al.length - 1]) || (cx === al[al.length - 1] && cy === 6)) continue;   // 和定位图形撞上的不放
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  const drawFormat = (/** @type {number} */ f) => {
    const bit = (/** @type {number} */ i) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(i));
    set(8, n - 8, true);
  };
  drawFormat(0);   // 先占住位置，挑好掩码再写真的

  // 数据蛇形填：从右下角起，两列一组上下来回，跳过第 6 列（竖的时序线）；填不满的剩余位留白
  let k = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < n; v++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? n - 1 - v : v;
        if (fn[y][x] || k >= words.length * 8) continue;
        mod[y][x] = ((words[k >>> 3] >>> (7 - (k & 7))) & 1) === 1;
        k++;
      }
    }
  }

  // 八种掩码各试一遍，挑罚分最低的
  let best = null, bestP = Infinity;
  for (let mk = 0; mk < 8; mk++) {
    const m = mod.map((row, y) => row.map((d, x) => (fn[y][x] ? d : d !== MASKS[mk](x, y))));
    const saved = mod.map((r) => [...r]);
    for (let y = 0; y < n; y++) mod[y] = m[y];
    drawFormat(formatBits(mk));
    const p = penalty(mod);
    if (p < bestP) { bestP = p; best = mod.map((r) => [...r]); }
    for (let y = 0; y < n; y++) mod[y] = saved[y];
  }
  return /** @type {boolean[][]} */ (best);
}
