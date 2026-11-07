// @ts-check
/**
 * 全屏画框（设计文档第 4 节"全屏画框"）：放大招时左边、底边贴一道细笔触，人物立绘压在左下角的泼墨上，大字竖写在人物旁边，画面中间和右边都空着。
 * 三级：small 召龙、护身，亮一下就退；mid 化身亮相，之后四边留一圈呼吸（aura，单独一层）；large 法域，随着水墨铺开一笔笔落下，
 * 人物退场后几笔留在边上，底下那一笔当倒计时，收束时一笔斩过。
 * 用网页叠层画，不走后期，手机流畅档也有。两个同时来只放强的（outranks）。
 * 笔触是素材（public/frame/，tools/ink_art.py、ink_hero.py 画的）；还没下载到、下载不了时退回现画的墨带。计时用真实时间（法域里世界的钟是停的）。
 */

/** thick：现画的墨带多宽（屏幕短边的几成）；text：大字多大；hold：亮几秒（0 是一直留着）；rank：谁压谁 */
export const LEVELS = {
  small: { rank: 1, thick: 0.1, text: 0.09, hold: 1 },
  mid: { rank: 2, thick: 0.13, text: 0.1, hold: 1 },
  large: { rank: 3, thick: 0.15, text: 0.12, hold: 0 },
};

/** 素材：几笔、元素色那一团、收束那一笔、立绘 */
export const FRAME_ART = ['left', 'bottom', 'top', 'splash', 'tint', 'slash', 'hero'];
/** 法域的画框开多久之后人物退场、几笔收到边上，让出地方走位（秒） */
export const FRAME_SETTLE = 3;

/**
 * 新来的压不压得过现在这个：强的压弱的，一样强的新的换旧的，弱的不打断强的。退场了就不算占着
 * @param {{ level: keyof typeof LEVELS } | null} cur @param {keyof typeof LEVELS} next
 */
export const outranks = (cur, next) => !cur || LEVELS[next].rank >= LEVELS[cur.level].rank;

/** 墨带内沿那道亮色：比战斗里的元素色提一点亮度，压在黑墨上才跳 */
export const FRAME_GLOW = /** @type {Record<string, string>} */ ({ ice: '#7cc8ff', fire: '#ff8f45', thunder: '#ffdc55', wind: '#74e6b6', earth: '#dcaa64' });

export const FRAME_CSS = `
.yc-frame { position: absolute; inset: 0; overflow: hidden; pointer-events: none; opacity: 0; transition: opacity .12s; }
.yc-frame.on { opacity: 1; }
.yc-frame.out { transition: opacity .3s; }
.yc-frame canvas { position: absolute; inset: 0; width: 100%; height: 100%; transform: scale(1.12); transition: transform .12s ease-out; }
.yc-frame.on canvas { transform: none; }
.yc-frame.large canvas { transform: scale(1.3); transition: transform .5s cubic-bezier(.2,.8,.2,1); }
.yc-frame.large.on canvas { transform: none; }
.yc-aura { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: 0; transform: scale(1.09); transition: opacity .4s; }
.yc-aura.inked { transform: none; }
.yc-aura.on { opacity: 1; animation: yc-fbreath 1.6s ease-in-out infinite; }
@keyframes yc-fbreath { 50% { opacity: .55; } }
.yc-frame s, .yc-frame em { position: absolute; display: none; background: center / 100% 100% no-repeat; transition: transform .7s ease-in-out, opacity .7s ease-in; }
.yc-frame.inked s, .yc-frame.inked em { display: block; }
.yc-frame.inked .yc-fbar { display: none; }
.yc-frame { --d: .14s; --g: .05s; --h: min(50vh, 42vw); }
.yc-frame.mid { --d: .18s; --g: .07s; --h: min(56vh, 46vw); }
.yc-frame.large { --d: .5s; --g: .34s; --h: min(62vh, 50vw); }
.yc-frame .l { left: -9.6vmin; top: 0; height: 100%; width: 24vmin; background-image: var(--ink-left); }
.yc-frame .d { left: 0; right: 24%; bottom: -4.5vmin; height: 18vmin; background-image: var(--ink-bottom); }
.yc-frame .p { left: 0; bottom: 0; height: calc(var(--h) * 1.08); width: calc(var(--h) * .92); background-image: var(--ink-splash); }
.yc-frame em { left: 2vmin; bottom: 0; height: var(--h); aspect-ratio: 908 / 1200; background-image: var(--ink-hero); }
.yc-frame.on .l { animation: yc-sup var(--d) ease-out backwards; }
.yc-frame.inked.on canvas { animation: yc-sfade calc(var(--d) * 2) ease-out backwards; }
.yc-frame.on .d { animation: yc-srt var(--d) ease-out var(--g) backwards; }
.yc-frame.on .p { animation: yc-srt var(--d) ease-out calc(var(--g) * 2) backwards; }
.yc-frame.on em { animation: yc-shero calc(var(--d) * 1.8) cubic-bezier(.2,.8,.2,1) calc(var(--g) * 3) backwards; }
.yc-frame.settle .p, .yc-frame.settle em { opacity: 0; transform: translateX(-14%); }
.yc-frame.settle canvas { opacity: 0; transition: opacity .7s ease-in; }
.yc-frame.settle b, .yc-frame.settle i { opacity: 0; }
@keyframes yc-sup { from { clip-path: inset(100% 0 0 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes yc-srt { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes yc-sfade { from { opacity: 0; } }
@keyframes yc-shero { from { opacity: 0; transform: translateX(-7%) scale(1.04); } }
.yc-frame b { position: absolute; left: 3.2vmin; top: 50%; transform: translateY(-50%); writing-mode: vertical-rl; font-weight: normal; line-height: 1; letter-spacing: .08em;
  color: #fbf4e6; text-shadow: 0 0 .35em var(--c), 0 .04em .12em rgba(0,0,0,.8); transition: opacity .25s; }
.yc-frame.inked b { left: calc(2vmin + var(--h) * .62); top: auto; bottom: 18vmin; transform: none; white-space: nowrap; text-shadow: 0 0 .1em #000, 0 0 .3em #000, 0 0 .6em rgba(0,0,0,.7); }
.yc-frame i { position: absolute; font-style: normal; width: 1.1em; height: 1.1em; line-height: 1.1em; text-align: center; border-radius: 2px; background: #b3261e; color: #fbefe6; transform: rotate(-4deg); transition: opacity .25s; }
.yc-fbar { position: absolute; left: 12%; right: 12%; bottom: 2.4vmin; height: 3px; background: rgba(251,244,230,.28); }
.yc-fbar[hidden] { display: none; }
.yc-fbar u { position: absolute; inset: 0; background: var(--c); transform-origin: 50% 50%; box-shadow: 0 0 6px var(--c); }
.yc-sky { position: absolute; left: 0; right: 0; top: max(15%, 92px); display: flex; flex-direction: column; align-items: center; gap: .1em; pointer-events: none;
  font-size: clamp(30px, 7vmin, 60px); line-height: 1.12; transition: transform .4s ease-in, opacity .4s ease-in; }
.yc-sky span { max-width: 78%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--c); text-shadow: 0 0 .2em rgba(255,250,240,.95), 0 0 .05em rgba(255,250,240,.9);
  animation: yc-fink .32s ease-out both; }
@keyframes yc-fink { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
.yc-sky.cut { transform: translateY(-.6em) skewX(-14deg); opacity: 0; }
.yc-slash { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: 0; }
.yc-slash.go { opacity: 1; animation: yc-fslash .16s cubic-bezier(.5,0,.8,.6) both; }
.yc-slash.out { opacity: 0; transition: opacity .8s ease-in; }
@keyframes yc-fslash { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
.yc-on-cover .yc-frame, .yc-on-result .yc-frame, .yc-on-cover .yc-sky, .yc-on-result .yc-sky, .yc-on-cover .yc-aura, .yc-on-result .yc-aura { visibility: hidden; }
`;

/** 不跟着 Math.random 走：同一个种子画出来一样，也不多耗随机数 @param {number} seed */
const rng = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

/** 一条毛边：沿着长度 len 走，每点的墨带厚度（低频起伏 + 高频毛刺） @param {number} len @param {number} t @param {() => number} rnd */
function brushLine(len, t, rnd) {
  const n = Math.ceil(len / 9), a = rnd() * 6, b = rnd() * 6, f = 4 + rnd() * 3;
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n;
    return t * (0.76 + 0.17 * Math.sin(u * f + a) + 0.06 * Math.sin(u * f * 4.3 + b) + 0.035 * (rnd() - 0.5));
  });
}

/**
 * 四边的墨：每边一块毛边的墨，内沿描一道元素色，再用干笔的细缝把墨带刮花
 * @param {CanvasRenderingContext2D} g @param {number} W @param {number} H @param {number} t 墨带厚（像素） @param {string} color @param {() => number} rnd
 */
function paintBand(g, W, H, t, color, rnd) {
  g.clearRect(0, 0, W, H);
  /** @type {((u: number, d: number) => [number, number])[]} */
  const sides = [(u, d) => [u * W, d], (u, d) => [W - d, u * H], (u, d) => [W - u * W, H - d], (u, d) => [d, H - u * H]];
  const inner = sides.map((at, i) => { const line = brushLine(i % 2 ? H : W, t, rnd); return line.map((d, k) => at(k / (line.length - 1), d)); });
  sides.forEach((at, i) => {
    g.beginPath();
    g.moveTo(...at(0, 0));
    for (const p of inner[i]) g.lineTo(p[0], p[1]);
    g.lineTo(...at(1, 0));
    g.closePath();
    g.fillStyle = '#0d0c0b';
    g.fill();
  });
  // 内沿：一层化开的元素色压在墨下面，再顺着笔势甩几十道飞白的墨丝，不是一条线
  g.lineJoin = g.lineCap = 'round';
  g.globalCompositeOperation = 'destination-over';
  g.shadowColor = color; g.shadowBlur = t * 0.45; g.strokeStyle = color; g.lineWidth = Math.max(1, t * 0.02);
  g.globalAlpha = 0.75;
  for (const line of inner) {
    g.beginPath();
    line.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.stroke();
  }
  g.shadowBlur = 0;
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = '#0d0c0b';
  for (let i = 0; i < 220; i++) {
    const s = i % 4, line = inner[s], k = Math.floor(rnd() * (line.length - 1)), at = sides[s], d0 = (s % 2 ? H : W) * 0.02;
    const p = line[k], u = k / (line.length - 1), reach = t * (0.05 + 0.32 * rnd() ** 2), to = at(Math.min(1, u + d0 / (s % 2 ? H : W) * rnd() * 4), 0), q = at(u, 0);
    const nx = (p[0] - q[0]) / (t || 1), ny = (p[1] - q[1]) / (t || 1);   // 从墨里朝画面中间甩一小笔，顺带往走笔方向带一点
    g.globalAlpha = 0.4 + 0.5 * rnd();
    g.lineWidth = 0.6 + 2.4 * rnd();
    g.beginPath();
    g.moveTo(p[0], p[1]);
    g.lineTo(p[0] + nx * reach + (to[0] - q[0]), p[1] + ny * reach + (to[1] - q[1]));
    g.stroke();
  }
  // 干笔：顺着边刮出几道细缝，墨带才有笔痕
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 150; i++) {
    const at = sides[i % 4], u = rnd(), d = t * (0.1 + 0.55 * rnd()), l = 0.03 + 0.14 * rnd();
    g.globalAlpha = 0.1 + 0.4 * rnd();
    g.lineWidth = 0.6 + 1.8 * rnd();
    g.beginPath();
    g.moveTo(...at(u, d));
    g.lineTo(...at(Math.min(1, u + l), d + (rnd() - 0.5) * 3));
    g.stroke();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

/**
 * 化身那一圈（素材版）：同样的笔触收窄了贴四边，缝里透一点元素色
 * @param {CanvasRenderingContext2D} g @param {number} W @param {number} H @param {Record<string, HTMLImageElement>} art @param {string} color
 */
function paintStrokes(g, W, H, art, color) {
  g.clearRect(0, 0, W, H);
  tinted(g, art.tint, color, -0.26 * H, 0.15 * H, 0.5 * H, 0.8 * H, 0.4);
  tinted(g, art.tint, color, W - 0.24 * H, 0.05 * H, 0.5 * H, 0.8 * H, 0.4);
  const lw = H * 0.34;
  g.drawImage(art.left, -lw * 0.42, 0, lw, H);
  g.save(); g.translate(W, H); g.rotate(Math.PI); g.drawImage(art.left, -lw * 0.42, 0, lw, H); g.restore();
  g.drawImage(art.bottom, 0, H * 0.82, W, H * 0.24);
  g.drawImage(art.top, W * 0.3, -H * 0.04, W * 0.7, H * 0.2);
}

/**
 * 笔触底下化开的元素色：只在左下角人物背后一团
 * @param {CanvasRenderingContext2D} g @param {number} W @param {number} H @param {Record<string, HTMLImageElement>} art @param {string} color
 */
function paintWash(g, W, H, art, color) {
  g.clearRect(0, 0, W, H);
  tinted(g, art.tint, color, -0.2 * H, 0.42 * H, 0.75 * H, 0.7 * H, 0.5);
}

/**
 * 元素色化在纸上的一团：tint 素材是遮罩，换一块小画布上色再贴
 * @param {CanvasRenderingContext2D} g @param {HTMLImageElement} tint @param {string} color
 * @param {number} x @param {number} y @param {number} w @param {number} h @param {number} a 浓淡
 */
function tinted(g, tint, color, x, y, w, h, a) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const t = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  t.drawImage(tint, 0, 0, 256, 256);
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = color;
  t.fillRect(0, 0, 256, 256);
  g.globalAlpha = a;
  g.drawImage(c, x, y, w, h);
  g.globalAlpha = 1;
}

/**
 * 收束那一笔（素材版）：笔底下化开一点元素色，再落那一笔
 * @param {CanvasRenderingContext2D} g @param {number} W @param {number} H @param {Record<string, HTMLImageElement>} art @param {string} color
 */
function inkSlash(g, W, H, art, color) {
  g.clearRect(0, 0, W, H);
  tinted(g, art.tint, color, -0.02 * W, 0.42 * H, 0.5 * W, 0.7 * H, 0.7);
  tinted(g, art.tint, color, 0.4 * W, 0.02 * H, 0.5 * W, 0.7 * H, 0.55);
  g.drawImage(art.slash, 0, 0, W, H);
}

/**
 * 一笔：从左下斜着扫到右上，中段最粗、两头收尖，边上带毛刺和飞白
 * @param {CanvasRenderingContext2D} g @param {number} W @param {number} H @param {string} color @param {() => number} rnd
 */
function paintSlash(g, W, H, color, rnd) {
  g.clearRect(0, 0, W, H);
  const x0 = -0.04 * W, y0 = 0.74 * H, x1 = 1.04 * W, y1 = 0.26 * H, n = 90, thick = Math.min(W, H) * 0.075;
  const nx = -(y1 - y0), ny = x1 - x0, nl = Math.hypot(nx, ny);
  /** @param {number} sign */
  const edge = (sign) => Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n, w = thick * Math.sin(Math.PI * u ** 0.8) ** 0.7 * (1 + 0.14 * (rnd() - 0.5));
    return [x0 + (x1 - x0) * u + (sign * w * nx) / nl, y0 + (y1 - y0) * u + (sign * w * ny) / nl];
  });
  const a = edge(1), b = edge(-1).reverse();
  g.beginPath();
  [...a, ...b].forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
  g.closePath();
  g.fillStyle = '#0d0c0b'; g.shadowColor = color; g.shadowBlur = thick * 0.9;
  g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = color; g.lineWidth = 2;
  for (const l of [a, b]) {
    g.beginPath();
    l.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.stroke();
  }
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 70; i++) {
    const u = rnd(), off = (rnd() - 0.5) * thick * 1.5, l = 0.05 + 0.18 * rnd();
    const X = (/** @type {number} */ o) => x0 + (x1 - x0) * o + (off * nx) / nl, Y = (/** @type {number} */ o) => y0 + (y1 - y0) * o + (off * ny) / nl;
    g.globalAlpha = 0.35 + 0.5 * rnd(); g.lineWidth = 0.8 + 2 * rnd();
    g.beginPath(); g.moveTo(X(u), Y(u)); g.lineTo(X(u + l), Y(u + l)); g.stroke();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

export class ScreenFrame {
  /**
   * @param {HTMLElement} root @param {string} font 大字的书法字体
   * @param {(name: string) => string} [url] 素材在哪（检查页是内嵌的，游戏里在 public/frame/）
   */
  constructor(root, font, url = (name) => `/frame/${name}.webp`) {
    const make = (/** @type {string} */ html) => { const t = document.createElement('template'); t.innerHTML = html; return /** @type {HTMLElement} */ (t.content.firstElementChild); };
    this.el = make('<div class="yc-frame"><canvas></canvas><s class="p"></s><s class="l"></s><s class="d"></s><em></em>'
      + '<b></b><i>敕</i><div class="yc-fbar" hidden><u></u></div></div>');
    this.sky = make('<div class="yc-sky"></div>');
    this.cut = /** @type {HTMLCanvasElement} */ (make('<canvas class="yc-slash"></canvas>'));
    this.halo = /** @type {HTMLCanvasElement} */ (make('<canvas class="yc-aura"></canvas>'));
    this.canvas = /** @type {HTMLCanvasElement} */ (this.el.querySelector('canvas'));
    this.text = /** @type {HTMLElement} */ (this.el.querySelector('b'));
    this.seal = /** @type {HTMLElement} */ (this.el.querySelector('i'));
    this.bar = /** @type {HTMLElement} */ (this.el.querySelector('.yc-fbar'));
    this.fill = /** @type {HTMLElement} */ (this.el.querySelector('u'));
    this.under = /** @type {HTMLElement} */ (this.el.querySelector('.d'));
    this.el.style.fontFamily = this.sky.style.fontFamily = font;
    this.root = root;
    root.prepend(this.halo, this.el, this.sky, this.cut);   // 排在最前：压在界面下面，按钮和血条照常露着
    /** @type {{ level: keyof typeof LEVELS } | null} */
    this.cur = null;
    this.seed = 20261106;
    this.left = -1;
    /** @type {number | undefined} */ this.timer = undefined;
    /** @type {number | undefined} */ this.cutTimer = undefined;
    /** 素材：全到了才换成笔触，半路开着的画框不受影响 @type {Record<string, HTMLImageElement> | null} */
    this.art = null;
    this.ready = Promise.all(FRAME_ART.map((n) => { const im = new Image(); im.src = url(n); return im.decode().then(() => /** @type {[string, HTMLImageElement]} */ ([n, im])); })).then((list) => {
      for (const n of FRAME_ART) this.el.style.setProperty(`--ink-${n}`, `url("${url(n)}")`);
      this.art = Object.fromEntries(list);
    }).catch(() => {});   // 下载不了：一直用现画的墨带
  }

  /** 按现在的屏幕大小定画布（物理像素太奢侈，墨迹本来就是毛的，按 CSS 像素画，封顶 1280 宽） @param {HTMLCanvasElement} c */
  fit(c) {
    const k = Math.min(1, 1600 / Math.max(1, this.root.clientWidth));
    c.width = Math.max(2, Math.round(this.root.clientWidth * k)); c.height = Math.max(2, Math.round(this.root.clientHeight * k));
    return /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  }

  /**
   * 亮一个画框。压不过现在这个就不亮（返回 false）
   * @param {keyof typeof LEVELS} level @param {{ text: string, color: string }} o
   */
  show(level, o) {
    if (!outranks(this.cur, level)) return false;
    const L = LEVELS[level], g = this.fit(this.canvas), W = this.canvas.width, H = this.canvas.height, sh = Math.min(this.root.clientWidth, this.root.clientHeight);
    clearTimeout(this.timer);
    if (this.art) paintWash(g, W, H, this.art, o.color);
    else paintBand(g, W, H, Math.min(W, H) * L.thick, o.color, rng(this.seed++));
    this.el.style.setProperty('--c', o.color);
    this.text.textContent = o.text;
    const size = Math.round(sh * (this.art ? L.text : L.thick * (level === 'large' ? 0.95 : 0.85)));
    this.text.style.fontSize = `${size}px`;
    this.seal.style.fontSize = `${Math.round(size * 0.34)}px`;
    this.seal.style.left = this.art ? `calc(2vmin + var(--h) * .62 + ${Math.round(size * 0.16)}px)` : `calc(3.2vmin + ${Math.round(size * 0.3)}px)`;
    this.seal.style.top = this.art ? 'auto' : `calc(50% + ${Math.round((size * [...o.text].length * 1.08) / 2 + size * 0.2)}px)`;
    this.seal.style.bottom = this.art ? `calc(18vmin - ${Math.round(size * 0.52)}px)` : 'auto';
    this.bar.hidden = level !== 'large';
    this.under.style.clipPath = '';
    this.left = -1;
    this.progress(1);
    this.el.className = `yc-frame ${level}${this.art ? ' inked' : ''}`;
    this.cur = { level };
    void this.el.offsetWidth;   // 换了类名、位置，要先落一帧，过渡才走得起来
    this.el.classList.add('on');
    if (L.hold) this.timer = window.setTimeout(() => this.close(), L.hold * 1000);
    else this.timer = window.setTimeout(() => this.el.classList.add('settle'), FRAME_SETTLE * 1000);
    return true;
  }

  /**
   * 化身期间四边留一圈呼吸：单独一层，别的画框来了又走都碰不到它。不给颜色就收掉
   * @param {string} [color]
   */
  aura(color) {
    const c = this.halo;
    if (color) {
      const g = this.fit(c);
      if (this.art) paintStrokes(g, c.width, c.height, this.art, color);
      else paintBand(g, c.width, c.height, Math.min(c.width, c.height) * LEVELS.mid.thick, color, rng(this.seed++));
    }
    c.classList.toggle('on', !!color);
    c.classList.toggle('inked', !!this.art);
  }

  /** 收掉画框 */
  close() {
    clearTimeout(this.timer);
    this.cur = null;
    this.el.classList.add('out');
    this.el.classList.remove('on');
  }

  /** 倒计时：底下那一笔从尾巴往回收（没素材时是底边一道线） @param {number} k 还剩几成 */
  progress(k) {
    if (Math.abs(k - this.left) < 0.004) return;
    this.left = k;
    this.fill.style.transform = `scaleX(${k.toFixed(3)})`;
    if (this.art && this.cur?.level === 'large') this.under.style.clipPath = `inset(0 ${((1 - k) * 100).toFixed(1)}% 0 0)`;
  }

  /** 念成一句：写到天上 @param {string} text @param {string} color */
  line(text, color) {
    const s = document.createElement('span');
    s.textContent = text;
    s.style.setProperty('--c', color);
    this.sky.classList.remove('cut');
    this.sky.append(s);
  }

  /** 收束：一笔斩过全屏，天上的字跟着散掉 @param {string} color */
  slash(color) {
    clearTimeout(this.cutTimer);
    const g = this.fit(this.cut);
    if (this.art) inkSlash(g, this.cut.width, this.cut.height, this.art, color);
    else paintSlash(g, this.cut.width, this.cut.height, color, rng(this.seed++));
    this.cut.className = 'yc-slash';
    void this.cut.offsetWidth;
    this.cut.classList.add('go');
    this.sky.classList.add('cut');
    this.close();
    this.cutTimer = window.setTimeout(() => {
      this.cut.classList.add('out');
      this.cut.classList.remove('go');
      this.sky.replaceChildren();
      this.sky.classList.remove('cut');
    }, 760);   // 这一笔留在纸上多看一眼，再慢慢褪
  }

  /** 这一局没了（重开、回首页）：什么都不留 */
  clear() {
    clearTimeout(this.timer); clearTimeout(this.cutTimer);
    this.cur = null;
    this.el.className = 'yc-frame';
    this.cut.className = 'yc-slash';
    this.halo.className = 'yc-aura';
    this.sky.replaceChildren();
    this.sky.classList.remove('cut');
  }
}
