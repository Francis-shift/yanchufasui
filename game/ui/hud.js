// @ts-check
/**
 * 界面（纯 DOM，不依赖框架）：输入框、法力条、阵眼血条、波次、咒语卡、浮字、大字、开始与结算、调试面板。
 * 咒语卡：书法大字写名字；下面把原话里被听懂的词加下划线并注明变成了什么，没听懂的标灰。
 */
import { ELEMENTS, FORMS, INPUT_MAX_CHARS, SUMMONS } from '../rules/numbers.js';
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
.yc-g { display: flex; flex-direction: column; gap: 6px; }
.yc-g + .yc-g { margin-top: 4px; }
.yc-label { font-size: 12px; color: var(--muted); display: flex; justify-content: space-between; gap: 12px; white-space: nowrap; }
.yc-bar { height: 8px; border-radius: 4px; background: rgba(0,0,0,0.12); overflow: hidden; }
.yc-bar > i { display: block; height: 100%; width: 100%; border-radius: 4px; transition: width .15s; }
.yc-core > i { background: linear-gradient(90deg, #6b7cff, #39c6ff); }
.yc-mana > i { background: linear-gradient(90deg, #4f8dff, #7fe0ff); }
.yc-gauge > i { background: linear-gradient(90deg, #f0b24a, #ffd98a); }
.yc-top.gauge-full .yc-gauge { box-shadow: 0 0 10px 2px rgba(255, 196, 80, 0.75); animation: yc-pulse 1.1s ease-in-out infinite; }
.yc-top.gauge-full [data-gauge] { color: #b06d00; }
@keyframes yc-pulse { 50% { box-shadow: 0 0 16px 4px rgba(255, 196, 80, 0.95); } }
.yc-bottom { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  width: min(640px, calc(100% - 32px)); display: flex; flex-direction: column; gap: 6px; pointer-events: auto; }
.yc-input { width: 100%; font: inherit; font-size: 17px; padding: 12px 16px; border-radius: 14px; border: 1px solid var(--line);
  background: rgba(255,255,255,0.9); color: var(--ink); outline: none; box-shadow: 0 6px 24px -10px rgba(20,40,80,0.4); }
.yc-input:focus { border-color: #5b8cff; box-shadow: 0 0 0 3px rgba(91,140,255,0.25), 0 6px 24px -10px rgba(20,40,80,0.4); }
.yc-input:disabled { opacity: 0.6; }
.yc-hint { font-size: 12px; color: var(--muted); text-align: center; text-shadow: 0 1px 0 rgba(255,255,255,0.6); }
.yc-card { position: absolute; left: 50%; top: calc(14px + env(safe-area-inset-top, 0px)); transform: translate(-50%, -8px);
  width: min(560px, calc(100% - 32px)); padding: 12px 18px 14px; background: var(--panel); border: 1px solid var(--line);
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
/* 天赋：选天赋（开始与结算页上）、战斗中的按钮栏、给按钮写咒的对话框 */
.yc-picker { margin: 14px 0 2px; }
.yc-picker-title { font-size: 13px; color: var(--muted); margin-bottom: 8px; }
.yc-talents { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.yc-tal { width: 52px; height: 52px; border-radius: 50%; border: 2px solid var(--c); background: rgba(255,255,255,0.92);
  font-family: ${BRUSH}; font-size: 26px; line-height: 1; color: var(--c); cursor: pointer; position: relative; padding: 0; }
.yc-tal.on { background: var(--c); color: #fff; box-shadow: 0 4px 14px -4px var(--c); }
.yc-tal:disabled { opacity: 0.35; cursor: not-allowed; }
.yc-tal small { position: absolute; left: 50%; bottom: -17px; transform: translateX(-50%); font: 11px/1 system-ui, sans-serif; color: var(--muted); white-space: nowrap; }
.yc-syn { margin-top: 18px; font-size: 12px; color: var(--muted); min-height: 1.7em; line-height: 1.7; }
.yc-syn b { color: #2b3a4a; font-weight: 600; }
.yc-skills { display: flex; gap: 12px; justify-content: center; align-items: flex-end; margin-bottom: 4px; }
.yc-skills[hidden] { display: none; }
.yc-skill { position: relative; }
.yc-cast { width: 54px; height: 54px; border-radius: 50%; border: 2px solid var(--c); background: rgba(255,255,255,0.9);
  color: var(--c); font-family: ${BRUSH}; font-size: 26px; line-height: 1.05; padding: 2px; cursor: pointer; touch-action: manipulation;
  box-shadow: 0 6px 18px -8px rgba(20,40,80,0.5); }
.yc-cast.named { font-size: 15px; letter-spacing: 1px; }
.yc-cast:active { transform: scale(0.94); }
.yc-cast.charging { background: var(--c); color: #fff; animation: yc-charge .6s ease-out; }
@keyframes yc-charge { from { box-shadow: 0 0 0 0 var(--c); } to { box-shadow: 0 0 0 12px transparent; } }
.yc-pen { position: absolute; right: -6px; top: -6px; width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--line);
  background: #fff; color: #4a5a6a; font-size: 12px; line-height: 20px; padding: 0; cursor: pointer; }
.yc-key { position: absolute; left: 50%; bottom: -14px; transform: translateX(-50%); font-size: 10px; color: var(--muted); }
.yc-summon { height: 54px; padding: 0 14px; border-radius: 27px; border: 2px solid #d99a1e; background: linear-gradient(180deg, #ffe6a3, #f0b24a);
  color: #6b3f00; font-family: ${BRUSH}; font-size: 22px; cursor: pointer; animation: yc-pulse 1.1s ease-in-out infinite; }
.yc-summon[hidden] { display: none; }
.yc-write { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(220, 232, 245, 0.45); pointer-events: auto; }
.yc-write[hidden] { display: none; }
.yc-write .yc-box { width: min(460px, calc(100% - 24px)); text-align: left; padding: 18px; }
.yc-write-title { font-size: 15px; margin-bottom: 10px; }
.yc-write-title b { font-family: ${BRUSH}; font-size: 22px; color: var(--c); }
.yc-ideas { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.yc-idea { text-align: left; font: inherit; font-size: 14px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line);
  background: rgba(255,255,255,0.8); cursor: pointer; color: var(--ink); }
.yc-idea small { color: var(--muted); margin-left: 6px; font-size: 11px; }
.yc-write-msg { min-height: 1.4em; margin-top: 8px; font-size: 12px; color: #b4541a; }
.yc-write-btns { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; margin-top: 8px; }
.yc-write-btns .yc-btn { margin-top: 0; padding: 8px 14px; font-size: 14px; }
.yc-btn.ghost { background: #fff; color: #4a74d9; }
.yc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.yc-narrow .yc-key { display: none; }
.yc-short .yc-skills { margin-bottom: 0; } .yc-short .yc-cast, .yc-short .yc-summon { height: 46px; } .yc-short .yc-cast { width: 46px; }
.yc-debug { position: absolute; right: 12px; bottom: calc(150px + env(safe-area-inset-bottom, 0px)); font: 12px/1.6 ui-monospace, Consolas, monospace;
  max-width: min(420px, calc(100vw - 24px)); overflow: hidden;
  background: rgba(20,24,32,0.72); color: #dfe7f1; padding: 8px 10px; border-radius: 10px; white-space: pre; }
.yc-debug[hidden] { display: none; }
/* 按游戏区域本身的尺寸切换（setLayout 加类名），不看整个浏览器窗口 */
/* 窄（手机竖屏）：阵眼、波次、气势排成顶上一行，省出画面给敌人的来路；咒语卡由 placeCard 放在这一行下面 */
.yc-narrow .yc-name { font-size: 32px; } .yc-narrow .yc-big { font-size: 46px; }
.yc-narrow .yc-top { left: 10px; right: 10px; top: calc(8px + env(safe-area-inset-top, 0px)); flex-direction: row; gap: 10px;
  padding: 7px 10px; min-width: 0; border-radius: 10px; }
.yc-narrow .yc-g { flex: 1; min-width: 0; gap: 4px; }
.yc-narrow .yc-g + .yc-g { margin-top: 0; }
.yc-narrow .yc-g-gauge { flex: 1.35; }
.yc-narrow .yc-label { gap: 6px; }
.yc-narrow .yc-card { width: calc(100% - 20px); }
/* 矮（手机键盘弹起来了）：咒语卡只留名字、原话、一行结果，提示语不显示 */
.yc-short .yc-hint, .yc-short .yc-tags { display: none; }
.yc-short .yc-card { padding: 6px 12px 8px; }
.yc-short .yc-name { font-size: 24px; letter-spacing: 2px; }
.yc-short .yc-said { margin-top: 2px; font-size: 14px; line-height: 1.6; }
.yc-short .yc-meta { margin-top: 2px; gap: 2px 10px; }
.yc-short .yc-big { font-size: 40px; }
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
      <div class="yc-g"><div class="yc-label"><span>阵眼</span><b data-core>100</b></div><div class="yc-bar yc-core"><i data-corebar></i></div></div>
      <div class="yc-g"><div class="yc-label"><span data-wave>准备守关</span><span data-left></span></div></div>
      <div class="yc-g yc-g-gauge"><div class="yc-label"><span>气势</span><b data-gauge>0 / 8</b></div><div class="yc-bar yc-gauge"><i data-gaugebar style="width:0"></i></div></div></div>`);
    this.bottom = el(`<div class="yc-bottom"><div class="yc-skills" hidden></div>
      <div class="yc-label"><span>法力</span><b data-mana>100</b></div><div class="yc-bar yc-mana"><i data-manabar></i></div>
      <input class="yc-input" maxlength="${INPUT_MAX_CHARS}" enterkeyhint="send" autocomplete="off" aria-label="咒语" placeholder="说出你的咒语……（回车施法）">
      <div class="yc-hint" data-hint>开口就慢放，想好再说。例：先冻住最前面那只，再用风把它们吹下悬崖</div></div>`);
    this.card = el(`<div class="yc-card" role="status" aria-live="polite"></div>`);
    this.big = el(`<div class="yc-big"></div>`);
    this.overlay = el(`<div class="yc-overlay"><div class="yc-box"><h1>言出法随</h1>
      <p>傀儡大军从云海里沿石阶和索桥攻上山门。你是守山门的修士，守住身后的护山大阵。</p>
      <p>打一句中文，法术就是什么；说得越有画面感，气势越足。不想打字，就点天赋按钮。</p>
      <div class="yc-picker"><div class="yc-picker-title">选天赋（最多 3 个）</div><div class="yc-talents"></div><div class="yc-syn"></div></div>
      <button class="yc-btn" data-start>开始守关</button></div></div>`);
    this.write = el(`<div class="yc-write" hidden><div class="yc-box">
      <div class="yc-write-title"></div>
      <input class="yc-input" maxlength="${INPUT_MAX_CHARS}" enterkeyhint="done" autocomplete="off" aria-label="给按钮写的咒" placeholder="写一句咒……（例：三颗火球从天而降）">
      <div class="yc-ideas"></div><div class="yc-write-msg"></div>
      <div class="yc-write-btns"><button class="yc-btn ghost" data-inspire>求灵感</button><button class="yc-btn ghost" data-reset>恢复默认</button>
        <button class="yc-btn ghost" data-cancel>取消</button><button class="yc-btn" data-ok>装进按钮</button></div></div></div>`);
    this.debug = el(`<div class="yc-debug" hidden></div>`);
    this.floats = el(`<div style="position:absolute;inset:0;overflow:hidden"></div>`);
    this.root.append(this.floats, this.top, this.card, this.big, this.bottom, this.debug, this.write, this.overlay);
    root.append(this.root);
    this.input = /** @type {HTMLInputElement} */ (this.bottom.querySelector('input'));
    this.q = (sel) => /** @type {HTMLElement} */ (this.root.querySelector(sel));
    this.cardTimer = 0; this.bigTimer = 0;
    // 写咒对话框的按钮只绑一次，回调在 openWrite 时换成当前这个天赋的
    /** @type {{ ok: (text: string) => void, inspire: () => void, reset: () => void, cancel: () => void } | null} */
    this.writeOn = null;
    this.writeInput = /** @type {HTMLInputElement} */ (this.write.querySelector('input'));
    const wb = (sel, fn) => /** @type {HTMLElement} */ (this.write.querySelector(sel)).addEventListener('click', fn);
    wb('[data-ok]', () => this.writeOn?.ok(this.writeInput.value));
    wb('[data-inspire]', () => this.writeOn?.inspire());
    wb('[data-reset]', () => this.writeOn?.reset());
    wb('[data-cancel]', () => this.writeOn?.cancel());
    this.writeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); this.writeOn?.ok(this.writeInput.value); }
      else if (e.key === 'Escape') this.writeOn?.cancel();
    });
  }

  /**
   * 选天赋：画出几个天赋（没开放的灰掉），点了回调；下面写已选天赋之间的羁绊。至少选一个才能开始。
   * @param {{ el: string, name: string, open: boolean, on: boolean }[]} list
   * @param {{ a: string, b: string, kind: string, name: string }[]} syn
   * @param {(el: string) => void} onToggle
   */
  renderPicker(list, syn, onToggle) {
    const box = this.q('.yc-talents');
    box.innerHTML = '';
    for (const t of list) {
      const b = el(`<button class="yc-tal${t.on ? ' on' : ''}" style="--c:${elColor(t.el)}" aria-pressed="${t.on}"${t.open ? '' : ' disabled'}>${esc(t.name)}${t.open ? '' : '<small>即将领悟</small>'}</button>`);
      b.addEventListener('click', () => onToggle(t.el));
      box.append(b);
    }
    const nm = (x) => list.find((t) => t.el === x)?.name || x;
    this.q('.yc-syn').innerHTML = syn.length
      ? '羁绊　' + syn.map((s) => `<span style="white-space:nowrap">先${esc(nm(s.a))}后${esc(nm(s.b))}：<b>${esc(s.name)}</b></span>`).join('　')
      : (list.some((t) => t.on) ? '再选一个，看看它们之间的羁绊' : '至少选一个天赋');
    /** @type {HTMLButtonElement} */ (this.q('[data-start]')).disabled = !list.some((t) => t.on);
  }

  /**
   * 战斗中的天赋按钮栏：每个天赋一个圆钮（右上角的笔用来写咒），后面是气势满了才出现的"召唤"。
   * @param {{ el: string, label: string, named: boolean }[]} skills
   * @param {{ cast: (el: string) => void, pen: (el: string) => void, summon: () => void }} on
   */
  setSkills(skills, on) {
    const bar = this.q('.yc-skills');
    bar.innerHTML = '';
    skills.forEach((s, i) => {
      const w = el(`<div class="yc-skill" style="--c:${elColor(s.el)}" data-el="${s.el}"><button class="yc-cast"></button>
        <button class="yc-pen" aria-label="给这个按钮写一句咒">✎</button><span class="yc-key">${i + 1}</span></div>`);
      const cast = /** @type {HTMLElement} */ (w.querySelector('.yc-cast'));
      // 按下就放（不等松手），也不让按钮抢走输入框的焦点、收起手机键盘
      cast.addEventListener('pointerdown', (e) => { e.preventDefault(); on.cast(s.el); });
      /** @type {HTMLElement} */ (w.querySelector('.yc-pen')).addEventListener('click', () => on.pen(s.el));
      bar.append(w);
      this.setSkillLabel(s.el, s.label, s.named);
    });
    const sm = el(`<button class="yc-summon" hidden>召唤</button>`);
    sm.addEventListener('pointerdown', (e) => { e.preventDefault(); on.summon(); });
    bar.append(sm);
    bar.hidden = !skills.length;
  }
  /** @param {string} elKey @param {string} label @param {boolean} named 写过咒的按钮显示咒语名（小一号） */
  setSkillLabel(elKey, label, named) {
    const b = this.root.querySelector(`.yc-skill[data-el="${elKey}"] .yc-cast`);
    if (!b) return;
    b.textContent = showName(label);
    b.classList.toggle('named', named);
    b.setAttribute('aria-label', `放${label}`);
  }
  /** 正在咏唱的按钮亮起来 @param {string[]} els */
  setCharging(els) {
    for (const w of this.root.querySelectorAll('.yc-skill')) {
      const b = /** @type {HTMLElement} */ (w.querySelector('.yc-cast'));
      b.classList.toggle('charging', els.includes(/** @type {HTMLElement} */ (w).dataset.el || ''));
    }
  }
  /** @param {boolean} on */
  setSummonReady(on) { const b = this.root.querySelector('.yc-summon'); if (b) /** @type {HTMLElement} */ (b).hidden = !on; }

  /**
   * 给按钮写咒的对话框。
   * @param {string} name 天赋名 @param {string} elKey
   * @param {{ ok: (text: string) => void, inspire: () => void, reset: () => void, cancel: () => void }} on
   */
  openWrite(name, elKey, on) {
    this.write.style.setProperty('--c', elColor(elKey));
    this.q('.yc-write-title').innerHTML = `给 <b>${esc(name)}</b> 的按钮写一句咒`;
    this.writeInput.value = '';
    this.q('.yc-ideas').innerHTML = '';
    this.setWriteMsg('');
    this.setWriteBusy(false);
    this.writeOn = on;
    this.write.hidden = false;
    this.writeInput.focus();
  }
  closeWrite() { this.write.hidden = true; this.writeOn = null; }
  /** @param {string} text */
  setWriteMsg(text) { this.q('.yc-write-msg').textContent = text; }
  /** @param {boolean} busy */
  setWriteBusy(busy) {
    for (const b of this.write.querySelectorAll('[data-ok],[data-inspire]')) /** @type {HTMLButtonElement} */ (b).disabled = busy;
  }
  /** 灵感：点一句就填进输入框（还能再改） @param {{ text: string, from: string }[]} ideas */
  setWriteIdeas(ideas) {
    const box = this.q('.yc-ideas');
    box.innerHTML = '';
    for (const it of ideas) {
      const b = el(`<button class="yc-idea">${esc(it.text)}<small>${esc(it.from)}</small></button>`);
      b.addEventListener('click', () => { this.writeInput.value = it.text; this.writeInput.focus(); });
      box.append(b);
    }
  }

  setCore(hp, max) { this.q('[data-core]').textContent = String(Math.max(0, Math.ceil(hp))); this.q('[data-corebar]').style.width = `${Math.max(0, hp / max) * 100}%`; }
  setMana(m, max) { this.q('[data-mana]').textContent = String(Math.floor(m)); this.q('[data-manabar]').style.width = `${(m / max) * 100}%`; }
  setWave(text, left) { this.q('[data-wave]').textContent = text; this.q('[data-left]').textContent = left; }
  setHint(text) { this.q('[data-hint]').textContent = text; }
  /** 气势槽：满了发光，提示可以召唤 @param {number} g @param {number} max */
  setGauge(g, max) {
    this.q('[data-gauge]').textContent = g >= max ? '已满·可召唤冰龙' : `${g} / ${max}`;
    this.q('[data-gaugebar]').style.width = `${Math.min(1, g / max) * 100}%`;
    this.top.classList.toggle('gauge-full', g >= max);
  }

  /** 游戏区域变了尺寸：窄（竖屏）、矮（键盘弹起）切换布局，再把咒语卡放到不挡面板的地方 @param {number} w @param {number} h */
  setLayout(w, h) {
    this.root.classList.toggle('yc-narrow', w <= 600);
    this.root.classList.toggle('yc-short', h <= 520);
    this.placeCard();
  }

  /** 咒语卡居中靠上；若和左上角的面板左右重叠，就放到面板下面 */
  placeCard() {
    const ui = this.root.getBoundingClientRect(), top = this.top.getBoundingClientRect();
    const cardW = this.card.offsetWidth || Math.min(560, ui.width - 32);
    const overlaps = (ui.width - cardW) / 2 < top.right - ui.left + 8;
    this.card.style.top = overlaps ? `${Math.round(top.bottom - ui.top + 8)}px` : '';
  }

  /** 画面上、下被界面挡住的比例（给镜头取景用） @returns {{ top: number, bottom: number }} */
  insets() {
    const ui = this.root.getBoundingClientRect();
    if (!ui.height) return { top: 0, bottom: 0 };
    const t = this.top.getBoundingClientRect(), b = this.bottom.getBoundingClientRect();
    return { top: Math.max(0, (t.bottom - ui.top) / ui.height), bottom: Math.max(0, (ui.bottom - b.top) / ui.height) };
  }

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
    const sm = intent.summon ? SUMMONS[intent.summon] : null;
    if (sm && c.text.includes(sm.name)) marks.unshift({ w: sm.name, color: elColor(intent.summon || ''), tag: plan.summon?.cast ? '召唤' : '未至' });
    let html = esc(c.text);
    const tags = [];
    for (const m of marks) {
      const e = esc(m.w);
      if (!html.includes(e)) continue;
      html = html.replace(e, m.gray ? `<span class="gray">${e}</span>` : `<u style="text-decoration-color:${m.color}">${e}</u>`);
      tags.push(`<span class="yc-tag${m.gray ? ' gray' : ''}">${e} → ${esc(m.tag)}</span>`);
    }
    const summoned = plan.summon?.cast ? `召唤·${plan.summon.name}${plan.summon.first ? '（新发现 +20%）' : ''}` : '';
    const steps = summoned || plan.steps.map((s) => (s.fusionName ? `融合·${s.fusionName}`
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
    this.placeCard();
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
    /** @type {HTMLElement} */ (this.overlay.querySelector('[data-start]')).textContent = btn;
    this.overlay.hidden = false;
  }
  hideOverlay() { this.overlay.hidden = true; }

  dispose() { clearTimeout(this.cardTimer); clearTimeout(this.bigTimer); this.root.remove(); }
}

/** @param {string} el */
function elColor(el) {
  // 雷是金雷（我方用金、紫色只给敌人，10-21 定）；认不出的元素也用金
  return { fire: '#e8611c', ice: '#2f8de8', wind: '#2fbf86', earth: '#b07a3a', thunder: '#e0a816' }[el] || '#c9a03a';
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
