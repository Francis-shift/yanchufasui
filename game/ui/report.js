// @ts-check
/**
 * 战报卡（设计文档第 2 节"战报卡"）：一局结束后点"看战报"生成一张竖图，供保存、转发。
 * 上面是标题与胜负，中间是"最佳一击"打中那一刻的画面和那一招的名字，下面是这一局念成的几句咒、几个数、二维码。
 * 只放咒语名，不放玩家原话（原话可能是随口一句，转出去不合适）。名字都过了内容安全与字表（intent.js usableName）。
 */
import { BRUSH, BRUSH_BIG, showName } from './hud.js';
import { qrMatrix } from './qr.js';

export const REPORT_W = 720, REPORT_H = 1080;
/** 二维码打开的地址（正式站；预览页、后备站生成的卡也指向它） */
export const SITE = 'https://www.yanchufasui.top';
const SANS = 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';

/**
 * 这一局念成的咒：同名的合在一起，按打出的伤害从高到低取前 n 个（没打出伤害的不算）
 * @param {{ name: string, dmg: number }[]} tallies @param {number} [n] @returns {string[]}
 */
export function topNames(tallies, n = 6) {
  /** @type {Map<string, number>} */
  const sum = new Map();
  for (const t of tallies) if (t.name && t.dmg > 0) sum.set(t.name, (sum.get(t.name) ?? 0) + t.dmg);
  return [...sum].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

/**
 * 一排排摆名字：每排不超过 maxW 宽，最多 rows 排，放不下的不放
 * @param {string[]} names @param {(s: string) => number} width @param {number} maxW @param {number} gap @param {number} rows
 * @returns {string[][]}
 */
export function wrapNames(names, width, maxW, gap, rows) {
  /** @type {string[][]} */
  const out = [];
  let line = /** @type {string[]} */ ([]), w = 0;
  for (const s of names) {
    const sw = width(s);
    if (sw > maxW) continue;   // 一个就超宽的不放，也不为它换排
    if (line.length && w + gap + sw > maxW) { out.push(line); line = []; w = 0; if (out.length >= rows) return out; }
    w += (line.length ? gap : 0) + sw;
    line.push(s);
  }
  if (line.length && out.length < rows) out.push(line);
  return out;
}

/**
 * @typedef {{ title: string, sub: string, won: boolean, best: { name: string, dmg: number } | null, shot: HTMLCanvasElement | null,
 *             names: string[], stats: string }} ReportData
 */

/** 画好的战报卡（PNG） @param {ReportData} d @returns {Promise<Blob | null>} */
export async function makeReport(d) {
  // 书法字体按要画的字下好（大字那份只有固定的字；名字那份不够就下其余一级字）
  const fonts = /** @type {any} */ (document).fonts;
  const text = [d.best?.name ?? '', ...d.names].join('');
  await Promise.all([
    fonts?.load?.(`60px ${BRUSH_BIG}`, d.title + d.sub), fonts?.load?.(`40px ${BRUSH}`, text),
  ].map((p) => Promise.resolve(p).catch(() => null)));

  const c = document.createElement('canvas');
  c.width = REPORT_W; c.height = REPORT_H;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const W = REPORT_W, ink = '#16202b', muted = '#6b7580', accent = d.won ? '#a8650a' : '#4f5d6b';

  // 底：宣纸色，一圈细框
  const bg = g.createLinearGradient(0, 0, 0, REPORT_H);
  bg.addColorStop(0, '#f6f1e7'); bg.addColorStop(1, '#e8dfcf');
  g.fillStyle = bg; g.fillRect(0, 0, W, REPORT_H);
  g.strokeStyle = 'rgba(90, 64, 30, 0.28)'; g.lineWidth = 2; g.strokeRect(18, 18, W - 36, REPORT_H - 36);

  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillStyle = ink; g.font = `60px ${BRUSH_BIG}`; g.fillText('言出法随', W / 2, 98);
  g.fillStyle = accent; g.font = `34px ${BRUSH_BIG}`; g.fillText(d.sub, W / 2, 148);

  // 最佳一击：画面按 4:3 框住、取中间（竖屏手机截的也一样），下沿压暗写名字
  const bx = 36, by = 178, bw = W - 72, bh = 486;
  g.save();
  rounded(g, bx, by, bw, bh, 16); g.clip();
  if (d.shot && d.shot.width && d.shot.height) {
    const s = Math.max(bw / d.shot.width, bh / d.shot.height), sw = bw / s, sh = bh / s;
    g.drawImage(d.shot, (d.shot.width - sw) / 2, (d.shot.height - sh) / 2, sw, sh, bx, by, bw, bh);
  } else {
    const dark = g.createLinearGradient(0, by, 0, by + bh);
    dark.addColorStop(0, '#5d7896'); dark.addColorStop(1, '#2b3a4a');
    g.fillStyle = dark; g.fillRect(bx, by, bw, bh);
  }
  if (d.best) {
    const fade = g.createLinearGradient(0, by + bh * 0.55, 0, by + bh);
    fade.addColorStop(0, 'rgba(10, 16, 24, 0)'); fade.addColorStop(1, 'rgba(10, 16, 24, 0.66)');
    g.fillStyle = fade; g.fillRect(bx, by, bw, bh);
    g.textAlign = 'left'; g.fillStyle = '#ffffff';
    g.shadowColor = 'rgba(0, 0, 0, 0.5)'; g.shadowBlur = 8;
    g.font = `56px ${BRUSH}`; g.fillText(showName(d.best.name), bx + 24, by + bh - 62, bw - 48);
    g.shadowBlur = 0;
    g.font = `22px ${SANS}`; g.fillStyle = 'rgba(255, 255, 255, 0.92)';
    g.fillText(`最佳一击 · 伤害 ${Math.round(d.best.dmg)}`, bx + 26, by + bh - 24);
  }
  g.restore();
  g.strokeStyle = 'rgba(40, 30, 20, 0.25)'; g.lineWidth = 1.5; rounded(g, bx, by, bw, bh, 16); g.stroke();

  // 这一局念成的咒
  g.textAlign = 'center'; g.fillStyle = muted; g.font = `22px ${SANS}`;
  g.fillText(d.names.length ? '这一局念成的咒' : '这一局还没念成一句咒', W / 2, 712);
  g.font = `36px ${BRUSH}`; g.fillStyle = '#2b3a4a';
  const gap = 30, rows = wrapNames(d.names.map(showName), (s) => g.measureText(s).width, W - 100, gap, 2);
  const top = rows.length === 1 ? 788 : 766;   // 只有一排就放在两排的位置中间
  rows.forEach((row, i) => {
    const total = row.reduce((a, s) => a + g.measureText(s).width, 0) + gap * (row.length - 1);
    let x = (W - total) / 2;
    g.textAlign = 'left';
    for (const s of row) { g.fillText(s, x, top + i * 50); x += g.measureText(s).width + gap; }
  });

  g.textAlign = 'center'; g.fillStyle = '#2b3a4a'; g.font = `24px ${SANS}`;
  g.fillText(d.stats, W / 2, 878, W - 80);
  g.strokeStyle = 'rgba(90, 64, 30, 0.22)'; g.beginPath(); g.moveTo(48, 904); g.lineTo(W - 48, 904); g.stroke();

  // 二维码（右下，白底）与一句邀请：每格取整数像素，格子边缘不发虚；四周至少留 3 格白边，外面是浅色纸底
  const m = qrMatrix(SITE), q = 140, cell = Math.floor(q / (m.length + 6)), qx = W - 48 - q, qy = 916;
  const off = Math.round((q - m.length * cell) / 2);
  g.fillStyle = '#ffffff'; g.fillRect(qx, qy, q, q);
  g.fillStyle = '#111111';
  m.forEach((row, y) => row.forEach((dark, x) => { if (dark) g.fillRect(qx + off + x * cell, qy + off + y * cell, cell, cell); }));
  g.textAlign = 'left'; g.fillStyle = ink; g.font = `bold 30px ${SANS}`; g.fillText('扫码，念一句咒', 52, 972);
  g.fillStyle = muted; g.font = `20px ${SANS}`;
  g.fillText('打一句中文，法术就是什么', 52, 1010);
  g.fillText(SITE.replace('https://', ''), 52, 1042);

  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
}

/** @param {CanvasRenderingContext2D} g @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r */
function rounded(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
