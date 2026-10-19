// @ts-check
/**
 * 界面（纯 DOM，不依赖框架）：输入框、法力条、阵眼血条、波次、咒语卡、浮字、大字、开始与结算、调试面板。
 * 咒语卡：书法大字写名字；下面把原话里被听懂的词加下划线并注明变成了什么，没听懂的标灰。
 */
import { ELEMENTS, FORMS, INPUT_MAX_CHARS } from '../rules/numbers.js';
import { PATH_NAMES, TARGET_NAMES } from '../rules/intent.js';

/**
 * 书法字体（tools/subset_font.py 按字表裁剪，见 game/rules/charset.js）：
 *   - 咒语名用马善政，两份：core 开局就下载；rest 是其余一级字，遇到 core 里没有的字才去下，开局后也会预先下好；
 *   - 大字（屏幕中央闪的字、标题）用志莽行，只有固定的几十个字，一份很小。
 * 没下好或下载失败时，退回系统自带的行楷、楷体。
 */
const BRUSH = '"YC Brush", "YC Brush Rest", "STXingkai", "STKaiti", "KaiTi", "Kaiti SC", serif';
const BRUSH_BIG = `"YC Brush Big", ${BRUSH}`;
const FONT_CSS = `
@font-face { font-family: "YC Brush"; src: url("/fonts/brush-core.woff") format("woff"); font-display: swap; }
@font-face { font-family: "YC Brush Rest"; src: url("/fonts/brush-rest.woff") format("woff"); font-display: swap; }
@font-face { font-family: "YC Brush Big"; src: url("/fonts/brush-big.woff") format("woff"); font-display: swap; }
`;

/** 标题画面期间先下 core 和大字；开局后再下 rest。预览页里没有字体文件，失败就算了 */
export function preloadFonts(rest = false) {
  const fonts = /** @type {any} */ (document).fonts;
  if (!fonts?.load) return;
  fonts.load('40px "YC Brush"', '言').catch(() => {});
  fonts.load('64px "YC Brush Big"', '言').catch(() => {});
  if (rest) fonts.load('40px "YC Brush Rest"', '啊').catch(() => {});
}

/** 两款字体都没有间隔号"·"，名字显示时换成字体里有的"•" */
const showName = (s) => s.replace(/·/g, '•');

const CSS = FONT_CSS + `
.yc-ui { position: absolute; inset: 0; pointer-events: none; font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  color: #1d2733; --ink: #1d2733; --muted: #5d6b7a; --panel: rgba(250, 252, 255, 0.78); --line: rgba(30, 50, 80, 0.16); }
.yc-ui * { box-sizing: border-box; }
.yc-top { position: absolute; left: 16px; top: calc(14px + env(safe-area-inset-top, 0px)); display: flex; flex-direction: column; gap: 6px;
  padding: 10px 14px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; backdrop-filter: blur(6px); min-width: 180px; }
.yc-label { font-size: 12px; color: var(--muted); display: flex; justify-content: space-between; gap: 12px; }
.yc-bar { height: 8px; border-radius: 4px; background: rgba(0,0,0,0.12); overflow: hidden; }
.yc-bar > i { display: block; height: 100%; width: 100%; border-radius: 4px; transition: width .15s; }
.yc-core > i { background: linear-gradient(90deg, #6b7cff, #39c6ff); }
.yc-mana > i { background: linear-gradient(90deg, #4f8dff, #7fe0ff); }
.yc-bottom { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  width: min(640px, calc(100vw - 32px)); display: flex; flex-direction: column; gap: 6px; pointer-events: auto; }
.yc-input { width: 100%; font: inherit; font-size: 17px; padding: 12px 16px; border-radius: 14px; border: 1px solid var(--line);
  background: rgba(255,255,255,0.9); color: var(--ink); outline: none; box-shadow: 0 6px 24px -10px rgba(20,40,80,0.4); }
.yc-input:focus { border-color: #5b8cff; box-shadow: 0 0 0 3px rgba(91,140,255,0.25), 0 6px 24px -10px rgba(20,40,80,0.4); }
.yc-input:disabled { opacity: 0.6; }
.yc-hint { font-size: 12px; color: var(--muted); text-align: center; text-shadow: 0 1px 0 rgba(255,255,255,0.6); }
.yc-card { position: absolute; left: 50%; top: calc(14px + env(safe-area-inset-top, 0px)); transform: translate(-50%, -8px);
  width: min(560px, calc(100vw - 32px)); padding: 12px 18px 14px; background: var(--panel); border: 1px solid var(--line);
  border-radius: 16px; backdrop-filter: blur(8px); opacity: 0; transition: opacity .25s, transform .25s; }
.yc-card.show { opacity: 1; transform: translate(-50%, 0); }
.yc-name { font-family: ${BRUSH}; font-size: 40px; line-height: 1.15; text-align: center;
  letter-spacing: 4px; color: #16202b; }
.yc-said { margin-top: 8px; font-size: 15px; line-height: 1.9; }
.yc-said u { text-decoration-thickness: 2px; text-underline-offset: 4px; }
.yc-said .gray { color: #9aa4ae; text-decoration: line-through; }
.yc-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.yc-tag { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: rgba(40,60,90,0.08); color: #2b3a4a; }
.yc-tag.gray { color: #8a949e; }
.yc-meta { margin-top: 6px; font-size: 12px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 10px; }
.yc-meta .warn { color: #b4541a; }
.yc-float { position: absolute; transform: translate(-50%, -50%); font-weight: 700; font-size: 18px; white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0,0,0,0.65), 0 0 6px rgba(0,0,0,0.35); transition: transform .9s ease-out, opacity .9s ease-in; }
.yc-big { position: absolute; left: 50%; top: 38%; transform: translate(-50%, -50%) scale(0.9); font-family: ${BRUSH_BIG};
  font-size: 64px; letter-spacing: 8px; opacity: 0; transition: opacity .2s, transform .3s; text-shadow: 0 2px 12px rgba(255,255,255,0.7); }
.yc-big.show { opacity: 1; transform: translate(-50%, -50%) scale(1); }
.yc-overlay { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(220, 232, 245, 0.55);
  backdrop-filter: blur(3px); pointer-events: auto; }
.yc-overlay[hidden] { display: none; }
.yc-box { text-align: center; padding: 28px 32px; background: rgba(255,255,255,0.86); border-radius: 18px; border: 1px solid var(--line);
  max-width: min(460px, calc(100vw - 32px)); }
.yc-box h1 { margin: 0 0 6px; font-family: ${BRUSH_BIG}; font-size: 48px; letter-spacing: 8px; }
.yc-box p { margin: 6px 0; color: var(--muted); font-size: 14px; line-height: 1.7; }
.yc-btn { margin-top: 12px; font: inherit; font-size: 16px; padding: 10px 26px; border-radius: 12px; border: 1px solid #4a74d9;
  background: #4a74d9; color: #fff; cursor: pointer; }
.yc-btn:focus-visible { outline: 3px solid rgba(74,116,217,0.4); outline-offset: 2px; }
.yc-debug { position: absolute; right: 12px; bottom: calc(150px + env(safe-area-inset-bottom, 0px)); font: 12px/1.6 ui-monospace, Consolas, monospace;
  max-width: min(420px, calc(100vw - 24px)); overflow: hidden;
  background: rgba(20,24,32,0.72); color: #dfe7f1; padding: 8px 10px; border-radius: 10px; white-space: pre; }
.yc-debug[hidden] { display: none; }
@media (max-width: 1000px) { .yc-card { top: calc(98px + env(safe-area-inset-top, 0px)); } }
@media (max-width: 600px) { .yc-name { font-size: 32px; } .yc-big { font-size: 46px; } .yc-top { min-width: 150px; } }
`;

/** @param {string} html */
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return /** @type {HTMLElement} */ (t.content.firstChild); };
/** @param {string} s */
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);

export class Hud {
  /** @param {HTMLElement} root */
  constructor(root) {
    const style = document.createElement('style');
    style.textContent = CSS;
    this.root = el(`<div class="yc-ui"></div>`);
    this.root.append(style);
    this.top = el(`<div class="yc-top">
      <div class="yc-label"><span>阵眼</span><b data-core>100</b></div><div class="yc-bar yc-core"><i data-corebar></i></div>
      <div class="yc-label" style="margin-top:4px"><span data-wave>准备守关</span><span data-left></span></div></div>`);
    this.bottom = el(`<div class="yc-bottom">
      <div class="yc-label"><span>法力</span><b data-mana>100</b></div><div class="yc-bar yc-mana"><i data-manabar></i></div>
      <input class="yc-input" maxlength="${INPUT_MAX_CHARS}" enterkeyhint="send" autocomplete="off" aria-label="咒语" placeholder="说出你的咒语……（回车施法）">
      <div class="yc-hint" data-hint>开口就慢放，想好再说。例：先冻住最前面那只，再用风把它们吹下悬崖</div></div>`);
    this.card = el(`<div class="yc-card" role="status" aria-live="polite"></div>`);
    this.big = el(`<div class="yc-big"></div>`);
    this.overlay = el(`<div class="yc-overlay"><div class="yc-box"><h1>言出法随</h1>
      <p>傀儡大军从云海里沿石阶和索桥攻上山门。你是守山门的修士，守住身后的护山大阵。</p>
      <p>没有技能按钮：打一句中文，法术就是什么。说得越有画面感，气势越足。</p>
      <button class="yc-btn" data-start>开始守关</button></div></div>`);
    this.debug = el(`<div class="yc-debug" hidden></div>`);
    this.floats = el(`<div style="position:absolute;inset:0;overflow:hidden"></div>`);
    this.root.append(this.floats, this.top, this.card, this.big, this.bottom, this.debug, this.overlay);
    root.append(this.root);
    this.input = /** @type {HTMLInputElement} */ (this.bottom.querySelector('input'));
    this.q = (sel) => /** @type {HTMLElement} */ (this.root.querySelector(sel));
    this.cardTimer = 0; this.bigTimer = 0;
  }

  setCore(hp, max) { this.q('[data-core]').textContent = String(Math.max(0, Math.ceil(hp))); this.q('[data-corebar]').style.width = `${Math.max(0, hp / max) * 100}%`; }
  setMana(m, max) { this.q('[data-mana]').textContent = String(Math.floor(m)); this.q('[data-manabar]').style.width = `${(m / max) * 100}%`; }
  setWave(text, left) { this.q('[data-wave]').textContent = text; this.q('[data-left]').textContent = left; }
  setHint(text) { this.q('[data-hint]').textContent = text; }

  /**
   * 咒语卡。
   * @param {{ name: string, text: string, plan: import('../rules/arbiter.js').CastPlan, intent: import('../rules/intent.js').Intent,
   *           source: string, ms: number }} c
   */
  showCard(c) {
    const { plan, intent } = c;
    // 原话标注：被听懂的词下划线（按元素上色），没听懂的标灰
    const marks = [];
    for (const s of intent.steps) {
      for (const [k, w] of Object.entries(s.words)) marks.push({ w, color: elColor(s.el), tag: wordTag(k, s) });
    }
    for (const w of intent.unknown) marks.push({ w, gray: true, tag: '超出法则，未生效' });
    let html = esc(c.text);
    const tags = [];
    for (const m of marks) {
      const e = esc(m.w);
      if (!html.includes(e)) continue;
      html = html.replace(e, m.gray ? `<span class="gray">${e}</span>` : `<u style="text-decoration-color:${m.color}">${e}</u>`);
      tags.push(`<span class="yc-tag${m.gray ? ' gray' : ''}">${e} → ${esc(m.tag)}</span>`);
    }
    const steps = plan.steps.map((s) => (s.fusionName ? `融合·${s.fusionName}`
      : `${ELEMENTS[s.el].name}${FORMS[s.form].name}${s.form === 'bolt' && s.count > 1 ? '×' + s.count : ''}`) +
      `（威力 ${s.power}${s.first ? '，新发现 +20%' : ''}）`).join(' → ');
    const meta = [
      plan.ok ? `消耗 ${plan.cost}` : '哑火',
      `气势 ${plan.momentum}${plan.momentumHalved ? '（同一句话再说，减半）' : ''}`,
      `${c.source}${c.ms ? ` · 共等 ${c.ms} 毫秒` : ''}`,
    ];
    const warns = [...intent.notes, ...plan.downgrades];
    this.card.innerHTML = `<div class="yc-name">${esc(showName(c.name || '……'))}</div>
      <div class="yc-said">${html}</div>
      ${tags.length ? `<div class="yc-tags">${tags.join('')}</div>` : ''}
      <div class="yc-meta"><span>${esc(steps || '没有可放的法术')}</span>${meta.map((m) => `<span>${esc(m)}</span>`).join('')}
      ${warns.map((w) => `<span class="warn">${esc(w)}</span>`).join('')}</div>`;
    this.card.classList.add('show');
    clearTimeout(this.cardTimer);
    this.cardTimer = window.setTimeout(() => this.card.classList.remove('show'), 4200);
  }

  /** 大字（天道不允、守住了……） @param {string} text @param {string} color @param {number} ms */
  bigText(text, color = '#16202b', ms = 1400) {
    this.big.textContent = text;
    this.big.style.color = color;
    this.big.classList.add('show');
    clearTimeout(this.bigTimer);
    this.bigTimer = window.setTimeout(() => this.big.classList.remove('show'), ms);
  }

  /** 屏幕位置上飘一个字 @param {number} x @param {number} y @param {string} text @param {string} color */
  floatText(x, y, text, color) {
    const f = el(`<div class="yc-float"></div>`);
    f.textContent = text;
    f.style.left = `${x}px`; f.style.top = `${y}px`; f.style.color = color;
    this.floats.append(f);
    requestAnimationFrame(() => { f.style.transform = 'translate(-50%, -160%)'; f.style.opacity = '0'; });
    setTimeout(() => f.remove(), 950);
  }

  /** 开始 / 结算页 @param {string} title @param {string} body @param {string} btn */
  showOverlay(title, body, btn) {
    /** @type {HTMLElement} */ (this.overlay.querySelector('h1')).textContent = title;
    const ps = this.overlay.querySelectorAll('p');
    ps[0].textContent = body; ps[1].textContent = '';
    /** @type {HTMLElement} */ (this.overlay.querySelector('button')).textContent = btn;
    this.overlay.hidden = false;
  }
  hideOverlay() { this.overlay.hidden = true; }

  dispose() { clearTimeout(this.cardTimer); clearTimeout(this.bigTimer); this.root.remove(); }
}

/** @param {string} el */
function elColor(el) {
  return { fire: '#e8611c', ice: '#2f8de8', wind: '#2fbf86', earth: '#c08a3e' }[el] || '#5b5bd6';
}

/** 每一栏来源词旁边注明变成了什么 */
function wordTag(k, s) {
  switch (k) {
    case 'e': return ELEMENTS[s.el].name;
    case 'f': return FORMS[s.form].name;
    case 't': return TARGET_NAMES[s.target] || s.target;
    case 'p': return `威力 ${s.power}`;
    case 'n': return `×${s.count}`;
    case 'r': return PATH_NAMES[s.path] || s.path;
    default: return '';
  }
}
