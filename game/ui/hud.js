// @ts-check
/**
 * 界面（纯 DOM，不依赖框架）：输入框、法力条、阵眼血条、波次、咒语卡、浮字、大字、开始与结算、调试面板；试炼模式的 boss 血条、闪避键、开战按钮。
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
export const BRUSH = '"YC Brush", "YC Brush Rest", "STXingkai", "STKaiti", "KaiTi", "Kaiti SC", serif';
export const BRUSH_BIG = `"YC Brush Big", ${BRUSH}`;
/** 纸面板上的正文：系统自带的楷体；手机上多半没有，退成宋体也还是书卷气 */
const KAI = '"STKaiti", "KaiTi", "Kaiti SC", "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", serif';
/** 天赋印章的颜色：国画颜料（朱砂、石青、石绿、赭石、藤黄），比战斗里的元素色沉一些，压在宣纸上不刺眼 */
const SEAL_INK = /** @type {Record<string, string>} */ ({ fire: '#b8441c', ice: '#2a6aa8', wind: '#2a8065', earth: '#8a5a2a', thunder: '#b0861a' });
/** 三选一里不带元素的卡按种类上色（同样是压在纸上的沉色；战斗里的标记还用 KIND_COLOR） */
const PICK_INK = /** @type {Record<string, string>} */ ({ 招式字: '#2f4f86', 字诀: '#1f6f62', 心法: '#9a5a00', 领悟: '#a07a14' });
/** 宣纸的纸纹：一层压得很淡的分形噪声 */
const PAPER_GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .32 0 0 0 0 .25 0 0 0 0 .16 0 0 0 .09 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;
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
export const showName = (/** @type {string} */ s) => s.replace(/·/g, '•');

const CSS = FONT_CSS + `
.yc-ui { position: absolute; inset: 0; pointer-events: none; font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  color: #231f1a; --ink: #231f1a; --muted: #6a5c4b; --panel: rgba(241,234,220,0.92); --line: rgba(52,40,28,0.38); --grain: ${PAPER_GRAIN};
  --paper: #f1eadc; }
.yc-ui * { box-sizing: border-box; }
.yc-top { position: absolute; left: 16px; top: calc(14px + env(safe-area-inset-top, 0px)); display: flex; flex-direction: column; gap: 6px;
  padding: 10px 14px; min-width: 180px; }
/* 战斗里的界面（10-30 本人嫌"太塑料"，改成和结算页同一路）：左上面板、boss 血条、咒语卡是一张张小笺——米黄纸、纸纹、内外两道细框、方角；
   字用楷体，数字用书法字；条子是国画颜料色（气血石绿、法力石青、boss 朱砂），方头，槽是淡墨 */
.yc-top, .yc-boss, .yc-card { background: var(--grain), var(--panel); border: 1px solid rgba(52,40,28,0.5); border-radius: 2px; font-family: ${KAI};
  box-shadow: inset 0 0 0 3px var(--panel), inset 0 0 0 4px rgba(52,40,28,0.2), 0 12px 26px -14px rgba(8,12,18,0.75); }
.yc-mute { position: absolute; right: 12px; top: calc(12px + env(safe-area-inset-top, 0px)); width: 36px; height: 36px; padding: 0; border-radius: 50%;
  display: grid; place-items: center; border: 1px solid var(--line); background: var(--panel); color: var(--ink); cursor: pointer;
  pointer-events: auto; backdrop-filter: blur(6px); }
.yc-mute svg { width: 20px; height: 20px; } .yc-mute.off { color: var(--muted); }
/* 试炼的视角按钮（俯视 / 肩后 / 第一人称轮着切）：在声音开关下面 */
.yc-view { position: absolute; right: 12px; top: calc(56px + env(safe-area-inset-top, 0px)); height: 30px; padding: 0 11px; border-radius: 15px;
  border: 1px solid var(--line); background: var(--panel); color: var(--ink); font: 13px ${KAI}; white-space: nowrap; cursor: pointer;
  pointer-events: auto; backdrop-filter: blur(6px); }
.yc-view[hidden] { display: none; }
.yc-view small { margin-left: 6px; color: var(--muted); font-size: 11px; }
/* 设置（10-30）：齿轮在声音开关左边，点开是一张纸面板；开着时游戏停住（main.js） */
.yc-gear { position: absolute; right: 56px; top: calc(12px + env(safe-area-inset-top, 0px)); width: 36px; height: 36px; padding: 0; border-radius: 50%;
  display: grid; place-items: center; border: 1px solid var(--line); background: var(--panel); color: var(--ink); cursor: pointer;
  pointer-events: auto; backdrop-filter: blur(6px); }
.yc-gear svg { width: 20px; height: 20px; }
.yc-set { position: absolute; inset: 0; z-index: 3; display: flex; overflow-y: auto; padding: 10px 0; pointer-events: auto;
  background: radial-gradient(ellipse at center, rgba(14,18,24,0.3), rgba(14,18,24,0.66)); }
.yc-set[hidden] { display: none; }
.yc-set-box { margin: auto; width: min(760px, calc(100% - 24px)); padding: 22px 32px 18px; }
.yc-set-title { font: normal 34px/1.15 ${BRUSH}; letter-spacing: 8px; text-align: center; color: #15110d; }
.yc-set-main { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 28px; margin-top: 10px; }
.yc-set-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
.yc-set-k { flex: none; width: 2.6em; font-size: 15px; color: #3a3026; }
.yc-seg { display: flex; flex-wrap: wrap; gap: 6px; }
.yc-seg button, .yc-keybtn, .yc-set-mini { font: inherit; font-size: 14px; padding: 3px 11px; border-radius: 3px; border: 1px solid rgba(52,40,28,0.35);
  background: rgba(255,255,255,0.35); color: #2a231c; cursor: pointer; }
.yc-seg button.on { background: #2b2520; color: #f6f1e7; border-color: #2b2520; }
.yc-seg button:hover, .yc-keybtn:hover, .yc-set-mini:hover { border-color: rgba(52,40,28,0.7); }
.yc-set-row input[type=range] { flex: 1; min-width: 0; accent-color: #8a2a10; }
.yc-set-v { flex: none; width: 2.4em; text-align: right; font-size: 13px; color: #5a4d3e; }
.yc-set-note { margin: 6px 0 0; font-size: 12.5px; line-height: 1.6; color: #6a5c4b; text-wrap: balance; }
.yc-set-note:empty { display: none; }
.yc-set-note.warn { color: #8a2a10; }
.yc-set-keys[hidden] { display: none; }
.yc-set-sub { margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(52,40,28,0.25); font-size: 15px; color: #3a3026; }
.yc-set-sub small { margin-left: 8px; font-size: 12.5px; color: #6a5c4b; }
.yc-keygrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 22px; margin-top: 8px; }
.yc-keyrow { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 14px; min-width: 0; }
.yc-keybtn { min-width: 68px; font: 600 14px/1.4 system-ui, sans-serif; }
.yc-keybtn.wait { background: #8a2a10; color: #fff; border-color: #8a2a10; }
.yc-set-mini { font-size: 12.5px; padding: 1px 8px; margin-left: 6px; }
.yc-set-btns { display: flex; gap: 8px 34px; justify-content: center; align-items: center; flex-wrap: wrap; margin-top: 20px; }
.yc-set-btns .yc-ink:not(.yc-sub) { padding: 6px 24px 8px; } .yc-set-btns .yc-ink:not(.yc-sub) b { font-size: 26px; }
.yc-set-btns .yc-ink.yc-sub b { font-size: 18px; }
.yc-set-btns [hidden] { display: none; }
.yc-short .yc-set-box { padding: 14px 26px 12px; } .yc-short .yc-set-title { font-size: 26px; }
.yc-short .yc-set-main { margin-top: 4px; gap: 6px 24px; } .yc-short .yc-set-sub { margin-top: 8px; padding-top: 6px; }
.yc-short .yc-keygrid { gap: 5px 18px; margin-top: 5px; } .yc-short .yc-set-btns { margin-top: 10px; }
.yc-short .yc-set-btns .yc-ink:not(.yc-sub) b { font-size: 22px; }
.yc-narrow .yc-gear { right: 54px; top: calc(60px + env(safe-area-inset-top, 0px)); }
.yc-narrow .yc-set-main { grid-template-columns: 1fr; } .yc-narrow .yc-keygrid { grid-template-columns: repeat(2, 1fr); }
.yc-narrow .yc-set-box { padding: 18px 20px 14px; }
.yc-g { display: flex; flex-direction: column; gap: 6px; }
.yc-g + .yc-g { margin-top: 4px; }
.yc-label { font-size: 13px; color: var(--muted); display: flex; justify-content: space-between; align-items: baseline; gap: 12px; white-space: nowrap; }
.yc-label b { font: 13px/1.3 ${KAI}; color: #2b2520; }
.yc-label [data-core], .yc-label [data-mana] { font: normal 19px/1 ${BRUSH}; color: #15110d; }   /* 数字用书法字 */
.yc-bar { height: 8px; border-radius: 1px; background: rgba(52,40,28,0.13); box-shadow: inset 0 0 0 1px rgba(52,40,28,0.25); overflow: hidden; }
.yc-bar > i { display: block; height: 100%; width: 100%; transition: width .15s; }
.yc-core > i { background: linear-gradient(90deg, #2c6a50, #5f9c74); }
.yc-mana > i { background: linear-gradient(90deg, #24548f, #4f8cc6); }
/* 法力条和它的字直接压在画面上：字描一圈纸色，槽铺一层纸 */
.yc-bottom > .yc-label { font-family: ${KAI}; color: #2b2520; text-shadow: 0 0 5px var(--paper), 0 0 2px var(--paper); }
.yc-bottom > .yc-mana { height: 9px; background: var(--grain), rgba(241,234,220,0.78); box-shadow: inset 0 0 0 1px rgba(52,40,28,0.5), 0 4px 12px -6px rgba(8,12,18,0.7); }
.yc-gauge { display: flex; gap: 2px; background: none; box-shadow: none; }   /* 气势槽一格一格画，每格染加它的那个元素的颜色 */
.yc-gauge > i { flex: 1; width: auto; background: var(--c, transparent); box-shadow: inset 0 0 0 1px rgba(52,40,28,0.28); transition: background .15s; }
.yc-gauge > i.w { box-shadow: inset 0 0 0 1px rgba(52,40,28,0.55); }
.yc-top.gauge-full .yc-gauge { animation: yc-glow 1.1s ease-in-out infinite; }
.yc-top.gauge-full [data-gauge] { color: #9a2a1e; }
/* 满了：朱砂色的光一呼一吸（召唤印也是） */
@keyframes yc-glow { 50% { filter: drop-shadow(0 0 6px rgba(205,60,30,0.85)); } }
.yc-bottom { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  width: min(640px, calc(100% - 32px)); display: flex; flex-direction: column; gap: 6px; pointer-events: auto; }
.yc-input { width: 100%; font: inherit; font-size: 17px; padding: 12px 16px; border-radius: 3px; border: 1px solid rgba(52,40,28,0.5);
  background: var(--grain), rgba(246,241,231,0.94); color: var(--ink); outline: none; box-shadow: 0 8px 20px -10px rgba(8,12,18,0.6); }
.yc-input:focus { border-color: #8a2a10; box-shadow: 0 0 0 3px rgba(138,42,16,0.18), 0 8px 20px -10px rgba(8,12,18,0.6); }
.yc-input:disabled { opacity: 0.6; }
/* 输入框右边的麦克风：按住说话；输入框藏起来（试炼）时单独一个、带字 */
.yc-say { display: flex; gap: 8px; align-items: center; justify-content: center; }
.yc-say .yc-input { flex: 1; min-width: 0; }
.yc-mic { flex: none; height: 46px; min-width: 46px; padding: 0 14px; border-radius: 3px; border: 1px solid rgba(52,40,28,0.55); background: var(--grain), var(--paper);
  color: #2b2520; font: 15px ${KAI}; display: flex; align-items: center; justify-content: center; gap: 5px; cursor: pointer;
  touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  box-shadow: inset 0 0 0 3px var(--paper), inset 0 0 0 4px rgba(52,40,28,0.22), 0 8px 18px -10px rgba(8,12,18,0.7); }
.yc-mic svg { width: 22px; height: 22px; flex: none; }
.yc-mic[hidden] { display: none; }
.yc-mic span { white-space: nowrap; }
.yc-say .yc-input:not([hidden]) + .yc-mic { padding: 0; } .yc-say .yc-input:not([hidden]) + .yc-mic span { display: none; }
.yc-mic.rec { background: #b3261e; border-color: #b3261e; color: #fbefe6; box-shadow: inset 0 0 0 3px #b3261e, inset 0 0 0 4px rgba(251,239,230,0.7);
  animation: yc-glow 1s ease-in-out infinite; }
.yc-mic.busy { opacity: 0.6; cursor: progress; }
.yc-hint { font: 12.5px/1.6 ${KAI}; color: #3a3026; text-align: center; text-shadow: 0 0 5px var(--paper), 0 0 2px var(--paper); }
.yc-card { position: absolute; left: 50%; top: calc(14px + env(safe-area-inset-top, 0px)); transform: translate(-50%, -8px);
  width: min(560px, calc(100% - 32px)); padding: 12px 18px 14px; opacity: 0; transition: opacity .25s, transform .25s; }
.yc-card.show { opacity: 1; transform: translate(-50%, 0); }
.yc-name { font-family: ${BRUSH}; font-size: 40px; line-height: 1.15; text-align: center;
  letter-spacing: 4px; color: #15110d; }
.yc-said { margin-top: 8px; font-size: 15px; line-height: 1.9; }
.yc-said u { text-decoration-thickness: 2px; text-underline-offset: 4px; }
.yc-said .gray { color: #a3947f; text-decoration: line-through; }
.yc-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.yc-tag { font-size: 12px; padding: 2px 8px; border-radius: 2px; background: rgba(52,40,28,0.08); color: #3a3026; }
.yc-tag.gray { color: #9a8a76; }
.yc-meta { margin-top: 6px; font-size: 12px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 10px; }
.yc-meta .warn { color: #b4541a; }
.yc-float { position: absolute; transform: translate(-50%, -50%); font-weight: 700; font-size: 18px; white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0,0,0,0.65), 0 0 6px rgba(0,0,0,0.35); transition: transform .9s ease-out, opacity .9s ease-in; }
.yc-big { position: absolute; left: 50%; top: 38%; transform: translate(-50%, -50%) scale(0.9); font-family: ${BRUSH_BIG};
  font-size: 64px; letter-spacing: 8px; opacity: 0; transition: opacity .2s, transform .3s; text-shadow: 0 2px 12px rgba(255,255,255,0.7); }
.yc-big.show { opacity: 1; transform: translate(-50%, -50%) scale(1); }
/* 宣纸面板（结算页、封面第二步共用，10-30 本人嫌原来的白卡"太 low"）：米黄的纸、细细的纸纹、古籍那样的内外两道边栏；
   正文用楷体，数字用书法字 */
/* isolation：纸里的内容抬到边栏上面那层只在纸里算，不然会盖过后面弹出的战报卡和设置 */
.yc-paper { position: relative; isolation: isolate; color: #231f1a; font-family: ${KAI}; border-radius: 2px;
  background: radial-gradient(ellipse at 12% 8%, rgba(255,255,255,0.55), transparent 55%),
    radial-gradient(ellipse at 92% 100%, rgba(140,105,60,0.14), transparent 60%), ${PAPER_GRAIN}, #f1eadc;
  box-shadow: 0 26px 60px -26px rgba(8,12,18,0.85), 0 0 0 1px rgba(60,45,30,0.18); }
.yc-paper::before, .yc-paper::after { content: ""; position: absolute; pointer-events: none; border-radius: 1px; }
.yc-paper::before { inset: 7px; border: 1.5px solid rgba(52,40,28,0.62); }
.yc-paper::after { inset: 11px; border: 1px solid rgba(52,40,28,0.3); }
.yc-paper > * { position: relative; z-index: 1; }
/* 结算页：画面压暗（不糊），纸面板在正中；宽的时候分左右两栏：左边是这一局（标题、红印、几格数字），右边是再来一局（选天赋、按钮）。
   放不下时整块可以上下滚（margin: auto 居中，比 place-items 安全：太高时顶上不会被裁掉） */
.yc-overlay { position: absolute; inset: 0; display: flex; overflow-y: auto; padding: 10px 0; pointer-events: auto;
  background: radial-gradient(ellipse at center, rgba(14,18,24,0.22), rgba(14,18,24,0.62)); }
.yc-overlay[hidden] { display: none; }
.yc-overlay .yc-box { margin: auto; width: min(780px, calc(100% - 28px)); padding: 26px 34px 22px; text-align: center;
  display: grid; grid-template-columns: 1.05fr 1fr; column-gap: 34px; align-items: center; }
.yc-res-l { min-width: 0; }
.yc-res-r { min-width: 0; padding-left: 30px; border-left: 1px solid rgba(52,40,28,0.28); }
.yc-res-head { display: flex; align-items: center; justify-content: center; gap: 12px; }
.yc-box h1 { margin: 0; font: normal 46px/1.15 ${BRUSH_BIG}; letter-spacing: 6px; color: #15110d; }
.yc-res-head .yc-seal { margin: 0; font-size: 17px; transform: rotate(6deg); }
.yc-box p { margin: 8px 0 0; color: #5a4d3e; font-size: 13.5px; line-height: 1.7; text-wrap: balance; }   /* 折行时两行一样长，不甩一两个字到下一行 */
.yc-box p[hidden], .yc-best[hidden] { display: none; }
.yc-box [data-lead] { color: #2a241d; font-size: 15px; }
.yc-stats { display: grid; grid-template-columns: repeat(3, 1fr); margin: 14px 0 4px; }
.yc-stats[hidden] { display: none; }
.yc-stat { padding: 0 4px; }
.yc-stat + .yc-stat { border-left: 1px solid rgba(52,40,28,0.25); }
.yc-stat b { display: block; font: normal 18px/1.3 ${KAI}; color: #15110d; white-space: nowrap; }
.yc-stat b em { font: normal 34px/1.1 ${BRUSH}; font-style: normal; margin: 0 1px; }   /* 数字用书法字，单位楷体 */
.yc-stat span { font-size: 12px; color: #7a6a57; letter-spacing: 2px; }
.yc-best { display: inline-block; margin: 10px 0 0; font-size: 13.5px; color: #5a4d3e; }
.yc-best.hot { color: #9a2a1e; }
.yc-best.hot::after { content: "新纪录"; margin-left: 8px; padding: 1px 5px; font: normal 13px/1.3 ${BRUSH}; color: #fbefe6; background: #b3261e;
  border-radius: 2px; display: inline-block; transform: rotate(-4deg); }
.yc-btns { display: flex; gap: 8px 22px; justify-content: center; align-items: center; flex-wrap: wrap; margin-top: 12px; }
.yc-btns .yc-btn { margin-top: 0; }
.yc-btns [hidden] { display: none; }
.yc-overlay .yc-ink { align-items: center; min-width: 140px; padding: 8px 26px 10px; }
.yc-overlay .yc-btns::after { content: ""; order: 0; flex-basis: 100%; height: 0; }   /* 主按钮独占一行，三个次按钮排在下面一行 */
.yc-overlay .yc-ink:not(.yc-sub)::before { right: -16px; }
.yc-overlay .yc-ink b { font-size: 26px; letter-spacing: 0.1em; }
/* 次一等的按钮：墨字，底下只剩一道细笔画 */
.yc-ink.yc-sub { color: #1f1a15; min-width: 0; padding: 4px 4px 8px; }
.yc-ink.yc-sub::before { inset: auto -6px 0 -6px; height: 8px; opacity: 0.8; filter: none; }
.yc-ink.yc-sub b { font-size: 19px; letter-spacing: 0.08em; text-shadow: none; }
.yc-ink.yc-sub:hover::before, .yc-ink.yc-sub:focus-visible::before { height: 11px; opacity: 1; }
/* 战报卡：压在结算页上面看大图，下面保存、分享、关闭 */
.yc-report { position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  padding: 12px; background: rgba(20, 28, 38, 0.72); backdrop-filter: blur(3px); pointer-events: auto; }
.yc-report[hidden], .yc-report [hidden] { display: none; }
.yc-arrow { position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px; pointer-events: none;
  filter: drop-shadow(0 0 2px #fff) drop-shadow(0 2px 4px rgba(20, 0, 40, 0.5)); }
.yc-arrow[hidden] { display: none; }
.yc-arrow i { display: block; width: 100%; height: 100%; background: #8a2fc9; clip-path: polygon(100% 50%, 8% 8%, 30% 50%, 8% 92%);
  animation: yc-nudge 0.9s ease-in-out infinite; }
@keyframes yc-nudge { 50% { transform: translateX(5px); } }
.yc-report img { max-width: min(400px, 92%); max-height: calc(100% - 100px); border-radius: 10px; background: #f6f1e7;
  box-shadow: 0 10px 40px -10px rgba(0,0,0,0.6); -webkit-touch-callout: default; }
.yc-report-msg { margin: 0; color: #e8edf3; font-size: 13px; text-align: center; }
.yc-report-btns { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.yc-report-btns .yc-btn { margin-top: 0; padding: 8px 18px; font-size: 14px; text-decoration: none; }
.yc-box .yc-note { margin: 10px 0 0; font-size: 12px; line-height: 1.6; }
.yc-write .yc-box { background: rgba(255,255,255,0.86); border-radius: 18px; border: 1px solid var(--line); }   /* 写咒对话框还是原来的样子 */
.yc-btn { margin-top: 12px; font: inherit; font-size: 16px; padding: 10px 26px; border-radius: 12px; border: 1px solid #4a74d9;
  background: #4a74d9; color: #fff; cursor: pointer; }
.yc-btn:focus-visible { outline: 3px solid rgba(74,116,217,0.4); outline-offset: 2px; }
/* 天赋：选天赋（封面第二步与结算页上）、战斗中的按钮栏、给按钮写咒的对话框 */
/* 选天赋：五方印——选上的是填满颜色的白文印（里面一圈纸色细线、略歪），没选的只描边、淡一点；颜色是国画颜料（朱砂、石青、石绿、赭石、藤黄） */
.yc-picker { margin: 4px 0 2px; }
.yc-picker-title { font-size: 13px; color: #7a6a57; margin-bottom: 10px; letter-spacing: 2px; }
.yc-picker-title::before, .yc-picker-title::after { content: ""; display: inline-block; vertical-align: middle; width: 26px; height: 1px;
  margin: 0 10px; background: rgba(52,40,28,0.4); }
.yc-talents { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
.yc-tal { width: 50px; height: 50px; border-radius: 3px; border: 2px solid var(--c); background: rgba(255,252,246,0.5);
  font-family: ${BRUSH}; font-size: 28px; line-height: 1; color: var(--c); cursor: pointer; position: relative; padding: 0; opacity: 0.72;
  transition: transform .12s, opacity .12s; -webkit-tap-highlight-color: transparent; }
.yc-tal:hover { opacity: 1; }
.yc-tal.on { opacity: 1; background: var(--c); color: #f7efe2; transform: rotate(-4deg);
  box-shadow: inset 0 0 0 3px var(--c), inset 0 0 0 4.5px rgba(247,239,226,0.8), 0 3px 8px -3px rgba(40,20,10,0.45); }
.yc-tal:nth-child(even).on { transform: rotate(3deg); }
.yc-tal:disabled { opacity: 0.3; cursor: not-allowed; }
.yc-tal small { position: absolute; left: 50%; bottom: -17px; transform: translateX(-50%); font: 11px/1 ${KAI}; color: #7a6a57; white-space: nowrap; }
.yc-syn { margin-top: 14px; font-size: 12.5px; color: #7a6a57; min-height: 1.7em; line-height: 1.8; }
.yc-syn b { font: normal 17px/1 ${BRUSH}; color: #8e2a1f; margin-left: 2px; }
.yc-skills { display: flex; gap: 12px; justify-content: center; align-items: flex-end; margin-bottom: 4px; }
.yc-skills[hidden] { display: none; }
.yc-skill { position: relative; }
/* 招式钮、闪避钮是一方方圆印：纸底、颜料色的外圈加一道细内圈，书法字；咏唱时整方填满颜色、字留纸色（同选天赋的白文印）。
   颜色用印章那套沉色（SEAL_INK），闪避是墨色 */
.yc-cast, .yc-dash { width: 54px; height: 54px; border-radius: 50%; border: 2px solid var(--c); background: var(--grain), var(--paper);
  color: var(--c); font-family: ${BRUSH}; font-size: 27px; line-height: 1.05; padding: 2px; cursor: pointer; touch-action: manipulation; position: relative;
  box-shadow: inset 0 0 0 2.5px var(--paper), inset 0 0 0 3.5px var(--c), 0 8px 16px -8px rgba(8,12,18,0.75); }
.yc-dash { --c: #2b2520; line-height: 1; padding: 0; }
.yc-cast.named { font-size: 15px; letter-spacing: 1px; }
.yc-cast:active, .yc-dash:active { transform: scale(0.94); }
.yc-cast.charging { background: var(--c); color: var(--paper); animation: yc-charge .6s ease-out;
  box-shadow: inset 0 0 0 2.5px var(--c), inset 0 0 0 3.5px rgba(241,234,220,0.8); }
@keyframes yc-charge { from { filter: drop-shadow(0 0 0 var(--c)); } 30% { filter: drop-shadow(0 0 9px var(--c)); } }
.yc-pen { position: absolute; right: -6px; top: -6px; width: 22px; height: 22px; border-radius: 50%; border: 1px solid rgba(52,40,28,0.5);
  background: var(--paper); color: #3a3026; font-size: 12px; line-height: 20px; padding: 0; cursor: pointer; }
/* 键名：挂在印下沿的一小块墨签 */
.yc-key { position: absolute; left: 50%; bottom: -9px; transform: translateX(-50%); font: 11px/1 ${KAI}; color: var(--paper); white-space: nowrap;
  background: rgba(35,31,26,0.82); padding: 2px 4px 1px; border-radius: 2px; }
/* 召唤：一方朱文大印，略歪，朱砂色的光一呼一吸 */
.yc-summon { position: relative; height: 54px; padding: 0 14px; border: 0; border-radius: 3px; background: #b3261e; color: #fbefe6;
  font: normal 24px/1 ${BRUSH}; letter-spacing: 2px; cursor: pointer; transform: rotate(-3deg); animation: yc-glow 1.1s ease-in-out infinite;
  box-shadow: inset 0 0 0 2.5px #b3261e, inset 0 0 0 4px rgba(251,239,230,0.85), 0 8px 16px -8px rgba(60,8,0,0.8); }
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
.yc-short .yc-skills { margin-bottom: 3px; } .yc-short .yc-cast, .yc-short .yc-summon { height: 46px; } .yc-short .yc-cast { width: 46px; }
.yc-debug { position: absolute; right: 12px; bottom: calc(150px + env(safe-area-inset-bottom, 0px)); font: 12px/1.6 ui-monospace, Consolas, monospace;
  max-width: min(420px, calc(100vw - 24px)); overflow: hidden;
  background: rgba(20,24,32,0.72); color: #dfe7f1; padding: 8px 10px; border-radius: 10px; white-space: pre; }
.yc-debug[hidden] { display: none; }
/* 试炼模式：顶上居中的 boss 血条（下面一条细的是冰甲）、闪避键、开战按钮；战斗中不打字、不写咒 */
.yc-boss { position: absolute; left: 50%; transform: translateX(-50%); top: calc(14px + env(safe-area-inset-top, 0px));
  width: min(440px, calc(100% - 32px)); display: flex; flex-direction: column; gap: 5px; padding: 8px 14px 10px; }
.yc-boss[hidden] { display: none; }
.yc-boss.yc-side { right: 104px; width: auto; max-width: 440px; transform: none; }   /* 矮窗口：放到左上面板右边，left 由 placeBoss 给 */
.yc-boss [data-bossname] { font: normal 22px/1.1 ${BRUSH_BIG}; color: #15110d; letter-spacing: 2px; }   /* boss 名在大字那款字体里 */
.yc-boss .yc-label b { color: #9a2a1e; overflow: hidden; text-overflow: ellipsis; }
.yc-bosshp { height: 10px; } .yc-bosshp > i { background: linear-gradient(90deg, #7e1f16, #c0402a); }
.yc-armor { height: 5px; } .yc-armor > i { background: linear-gradient(90deg, #5d8db8, #a9c8e2); }
.yc-armor.stone > i { background: linear-gradient(90deg, #7a5230, #c49a66); }
.yc-armor.flame > i { background: linear-gradient(90deg, #b8441c, #e0904c); }
.yc-dash.cd { opacity: 0.45; }
/* 精力格：闪避按钮上方一排短条，攒到几成填几成（石青） */
.yc-pips { position: absolute; left: 50%; top: -11px; transform: translateX(-50%); display: flex; gap: 3px; pointer-events: none; }
.yc-pips > i { width: 13px; height: 5px; border-radius: 1px; box-shadow: 0 0 0 1px rgba(241,234,220,0.85);
  background: linear-gradient(90deg, #24548f calc(var(--f, 1) * 100%), rgba(52,40,28,0.4) 0); }
.yc-pad .yc-pips { top: -13px; } .yc-pad .yc-pips > i { width: 18px; height: 6px; }
.yc-ink.yc-go { align-self: center; margin-top: 6px; min-width: 0; align-items: center; padding: 6px 30px 8px 24px; }   /* 开战：水墨钮 */
.yc-ink.yc-go b { font-size: 28px; }
.yc-go[hidden], .yc-input[hidden] { display: none; }
.yc-nopen .yc-pen { display: none; }
.yc-short .yc-dash { width: 46px; height: 46px; }
/* 按游戏区域本身的尺寸切换（setLayout 加类名），不看整个浏览器窗口 */
/* 窄（手机竖屏）：阵眼、波次、气势排成顶上一行，省出画面给敌人的来路；咒语卡由 placeCard 放在这一行下面 */
.yc-narrow .yc-name { font-size: 32px; } .yc-narrow .yc-big { font-size: 46px; }
.yc-narrow .yc-top { left: 10px; right: 10px; top: calc(8px + env(safe-area-inset-top, 0px)); flex-direction: row; gap: 10px;
  padding: 7px 10px; min-width: 0; }
.yc-narrow .yc-g { flex: 1; min-width: 0; gap: 4px; }
.yc-narrow .yc-g + .yc-g { margin-top: 0; }
.yc-narrow .yc-g-gauge { flex: 1.35; }
.yc-narrow .yc-label { gap: 6px; }
.yc-narrow .yc-card { width: calc(100% - 20px); }
.yc-narrow .yc-mute { right: 10px; top: calc(60px + env(safe-area-inset-top, 0px)); }   /* 顶上一行占满了宽，挪到它下面 */
.yc-narrow .yc-view { right: 10px; top: calc(138px + env(safe-area-inset-top, 0px)); }   /* 落在 boss 血条下面（血条约到 129） */
.yc-narrow .yc-boss { left: 10px; right: 100px; width: auto; transform: none; }   /* boss 血条也在那一行下面：右边让出设置与声音开关 */
/* 矮（手机键盘弹起来了）：咒语卡只留名字、原话、一行结果，提示语不显示 */
.yc-short .yc-hint, .yc-short .yc-tags { display: none; }
.yc-short .yc-card { padding: 6px 12px 8px; }
.yc-short .yc-name { font-size: 24px; letter-spacing: 2px; }
.yc-short .yc-said { margin-top: 2px; font-size: 14px; line-height: 1.6; }
.yc-short .yc-meta { margin-top: 2px; gap: 2px 10px; }
.yc-short .yc-big { font-size: 40px; }
/* 横过来的手机（约 740×360）：面板放宽让字少折行、天赋钮缩小，整块不用滚就看得到按钮 */
.yc-short .yc-overlay .yc-box { padding: 16px 24px 14px; column-gap: 24px; }
.yc-short .yc-res-r { padding-left: 22px; }
.yc-short .yc-overlay .yc-tal { width: 40px; height: 40px; font-size: 23px; }
.yc-short .yc-overlay .yc-syn { margin-top: 8px; font-size: 11.5px; line-height: 1.6; } .yc-short .yc-syn b { font-size: 15px; }
.yc-short .yc-overlay h1 { font-size: 32px; }
.yc-short .yc-overlay p { margin: 4px 0 0; font-size: 12.5px; line-height: 1.55; }
.yc-short .yc-overlay [data-lead] { font-size: 13.5px; }
.yc-short .yc-stats { margin: 8px 0 2px; } .yc-short .yc-stat b em { font-size: 26px; } .yc-short .yc-stat b { font-size: 15px; }
.yc-short .yc-best { margin: 6px 0 0; font-size: 12.5px; }
.yc-short .yc-picker { margin: 0; } .yc-short .yc-overlay .yc-picker-title { display: none; }
.yc-short .yc-btns { margin-top: 6px; } .yc-short .yc-overlay .yc-ink:not(.yc-sub) b { font-size: 22px; }
.yc-short .yc-overlay .yc-ink:not(.yc-sub) { padding: 6px 22px 8px; } .yc-short .yc-ink.yc-sub b { font-size: 17px; }
/* 竖屏：结算页叠成一栏 */
.yc-narrow .yc-overlay .yc-box { grid-template-columns: 1fr; row-gap: 14px; padding: 22px 20px 18px; }
.yc-narrow .yc-res-r { padding: 14px 0 0; border-left: 0; border-top: 1px solid rgba(52,40,28,0.28); }
.yc-narrow .yc-box h1 { font-size: 38px; }
/* 试炼 · 手机（setPad）：左半边是摇杆（按哪儿就从哪儿起），右下角一簇按钮——大的"闪"在角上，天赋沿弧排开，召唤在最外 */
.yc-stick { position: absolute; width: 120px; height: 120px; margin: -60px 0 0 -60px; border-radius: 50%; display: none;
  border: 2px solid rgba(255,255,255,0.75); background: rgba(30,50,80,0.16); pointer-events: none; }
.yc-stick > i { position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px; border-radius: 50%;
  background: rgba(255,255,255,0.88); box-shadow: 0 2px 8px rgba(20,40,80,0.35); }
.yc-pad .yc-stick { display: block; opacity: 0.4; }
.yc-pad .yc-stick:not(.on) { left: 104px; top: calc(100% - 96px); }
.yc-pad .yc-stick.on { opacity: 0.9; }
.yc-pad .yc-bottom { left: auto; right: 14px; bottom: 10px; transform: none; width: 232px; pointer-events: none; }
.yc-pad .yc-bottom button { pointer-events: auto; }
.yc-pad .yc-skills:not([hidden]) { order: 5; display: block; position: relative; width: 232px; height: 200px; margin: 4px 0 0; }
.yc-pad .yc-key, .yc-pad .yc-view small { display: none; }
.yc-pad .yc-dash { position: absolute; right: 0; bottom: 0; width: 80px; height: 80px; font-size: 36px; }
.yc-pad .yc-skill { position: absolute; }
.yc-pad .yc-cast { width: 58px; height: 58px; }
.yc-pad .yc-skill:nth-of-type(1) { right: 111px; bottom: 11px; }
.yc-pad .yc-skill:nth-of-type(2) { right: 82px; bottom: 82px; }
.yc-pad .yc-skill:nth-of-type(3) { right: 11px; bottom: 111px; }
.yc-pad .yc-summon { position: absolute; left: 0; top: 0; height: 50px; }
/* boss 血条紧挨左上面板右边放（横屏手机只有 600～900 宽，居中会和面板撞上、被挤到画面中间） */
.yc-pad .yc-boss { left: 212px; right: 104px; width: auto; max-width: 440px; transform: none; }   /* 右边留出设置与声音开关 */
/* 法力条挪到下方正中（摇杆和按钮之间空着），不然右边一列太高，顶到 boss 血条 */
.yc-pad .yc-bottom > .yc-label, .yc-pad .yc-bottom > .yc-mana { position: absolute; right: 250px; width: 240px; }
.yc-pad .yc-bottom > .yc-label { bottom: 16px; }
.yc-pad .yc-bottom > .yc-mana { bottom: 4px; }
/* 试炼的三选一（10-30 换成和结算页同一种纸面）：三张笺一排（横屏手机也放得下），下面是重抽、不拿。
   笺是浅一点的纸、一道细框；种类是一方小印，名字用书法字、颜料色；领悟那张底下泛一点金 */
.yc-picks { position: absolute; inset: 0; display: flex; overflow-y: auto; padding: 10px 0; pointer-events: auto;
  background: radial-gradient(ellipse at center, rgba(14,18,24,0.16), rgba(14,18,24,0.56)); }
.yc-picks[hidden] { display: none; }
.yc-picks-box { margin: auto; width: min(640px, calc(100% - 24px)); padding: 22px 28px 18px; text-align: center; }
.yc-picks-title { font: normal 36px/1.15 ${BRUSH}; letter-spacing: 6px; color: #15110d; }
.yc-picks-sub { font-size: 13.5px; line-height: 1.6; color: #5a4d3e; margin: 4px 0 14px; text-wrap: balance; }
.yc-pick-row { display: flex; gap: 14px; justify-content: center; }
.yc-pick { flex: 1 1 0; min-width: 0; max-width: 190px; display: flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 14px 10px; border-radius: 2px; border: 1px solid rgba(52,40,28,0.38); background: rgba(255,252,244,0.6); color: #231f1a;
  font: inherit; cursor: pointer; position: relative; box-shadow: inset 0 0 0 3px rgba(255,252,244,0.6), inset 0 0 0 4px rgba(52,40,28,0.12);
  transition: transform .12s, border-color .12s, box-shadow .12s; -webkit-tap-highlight-color: transparent; }
.yc-pick:hover, .yc-pick:focus-visible { transform: translateY(-3px); outline: none; border-color: var(--c);
  box-shadow: inset 0 0 0 3px rgba(255,252,244,0.6), inset 0 0 0 4px var(--c), 0 12px 20px -12px rgba(40,20,10,0.55); }
.yc-pick-kind { font-size: 12px; line-height: 1.4; color: #f7efe2; background: var(--c); border-radius: 2px; padding: 1px 7px; letter-spacing: 1px;
  transform: rotate(-3deg); box-shadow: inset 0 0 0 1.5px var(--c), inset 0 0 0 2.5px rgba(247,239,226,0.7); }
.yc-pick-name { font: normal 40px/1.15 ${BRUSH}; color: var(--c); white-space: nowrap; }
.yc-pick-text { font-size: 12.5px; line-height: 1.6; color: #4a3f33; }
.yc-pick .yc-key { left: 9px; top: 6px; bottom: auto; transform: none; color: #9a8a76; background: none; padding: 0; }   /* 电脑上按 1～3 拿，标在笺的左上角 */
.yc-pick.insight { background: linear-gradient(180deg, rgba(214,168,60,0.2), rgba(255,252,244,0.6) 65%); border-color: rgba(160,122,20,0.75); }
.yc-picks-btns { display: flex; gap: 8px 28px; justify-content: center; flex-wrap: wrap; margin-top: 24px; }
.yc-picks-btns .yc-ink b { font-size: 17px; }
.yc-short .yc-picks-box { padding: 16px 24px 12px; }
.yc-short .yc-picks-title { font-size: 26px; } .yc-short .yc-picks-sub { margin-bottom: 10px; font-size: 12.5px; }
.yc-short .yc-pick { padding: 9px 8px 10px; } .yc-short .yc-pick-name { font-size: 30px; } .yc-short .yc-pick-text { font-size: 12px; line-height: 1.45; }
.yc-short .yc-picks-btns { margin-top: 16px; }
.yc-narrow .yc-picks-box { padding: 20px 16px 16px; }
.yc-narrow .yc-pick-row { gap: 8px; } .yc-narrow .yc-pick-name { font-size: 26px; white-space: normal; }
.yc-narrow .yc-picks-btns { margin-top: 14px; }
/* 首页封面（showCover，10-30）：不糊画面、不压白卡，山门就是背景（镜头慢慢摆、法术自己放）；左边竖排大标题加红印，
   下面两个水墨按钮；点了按钮出第二步纸面板：这个模式的说明、选天赋（结算页上那块挪过来）、开始 */
.yc-on-cover .yc-top, .yc-on-cover .yc-bottom, .yc-on-cover .yc-boss, .yc-on-cover .yc-card, .yc-on-cover .yc-big,
.yc-on-result .yc-top, .yc-on-result .yc-bottom, .yc-on-result .yc-boss, .yc-on-result .yc-card, .yc-on-result .yc-big { visibility: hidden; }
.yc-cover { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.yc-cover[hidden] { display: none; }
.yc-cover::before { content: ""; position: absolute; inset: 0;
  background: linear-gradient(90deg, rgba(246,241,231,0.62), rgba(246,241,231,0.3) 26%, rgba(246,241,231,0) 50%); }
.yc-cover-main { position: absolute; left: clamp(24px, 7vw, 120px); top: 0; bottom: 0; display: flex; flex-direction: column;
  justify-content: center; align-items: flex-start; gap: clamp(14px, 3.6vh, 36px); }
.yc-cover-head { display: flex; flex-direction: row-reverse; align-items: flex-start; gap: clamp(10px, 1.4vw, 20px); }
.yc-cover-tcol { display: flex; flex-direction: column; align-items: center; }
.yc-cover-title { margin: 0; writing-mode: vertical-rl; font: normal clamp(54px, 13vh, 136px)/1.05 ${BRUSH_BIG}; letter-spacing: 0.02em;
  color: #111821; text-shadow: 0 0 18px rgba(250,246,236,0.95), 0 0 4px rgba(250,246,236,0.9); }
.yc-seal { margin-top: 0.35em; writing-mode: vertical-rl; font: normal clamp(16px, 2.8vh, 28px)/1 ${BRUSH}; letter-spacing: 0.06em;
  padding: 0.24em 0.18em; color: #fbefe6; background: #b3261e; border-radius: 3px; transform: rotate(-4deg);
  box-shadow: inset 0 0 0 2px #b3261e, inset 0 0 0 3.5px rgba(251,239,230,0.85), 0 2px 8px -3px rgba(80,10,0,0.6); }
.yc-cover-tag { margin: 1.6em 0 0; writing-mode: vertical-rl; font: clamp(14px, 2.3vh, 20px)/1.9 "STKaiti", "KaiTi", "Kaiti SC", serif;
  letter-spacing: 0.22em; color: #26313d; text-shadow: 0 0 10px rgba(250,246,236,0.95), 0 0 3px rgba(250,246,236,0.9); }
.yc-cover-best { font: 14px/1.5 "STKaiti", "KaiTi", "Kaiti SC", serif; color: #26313d; text-shadow: 0 0 8px rgba(250,246,236,0.95); }
.yc-cover-best[hidden] { display: none; }
.yc-cover-modes { display: flex; gap: clamp(30px, 3.2vw, 46px); flex-wrap: wrap; }   /* 留出前一笔飞白伸出去的那截 */
/* 水墨按钮：底下一笔浓墨（inkStroke 画好放进 --yc-brush；画不了用这里的 SVG），字是米白的书法字，压在起笔浓的那头 */
.yc-ink { pointer-events: auto; position: relative; isolation: isolate; border: 0; background: none; cursor: pointer; font: inherit; color: #f6f1e7;
  min-width: clamp(136px, 15vw, 180px); padding: 12px 30px 14px 24px; display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  text-align: left; transition: transform .15s; -webkit-tap-highlight-color: transparent; }
.yc-ink::before { content: ""; position: absolute; inset: -8px -40px -6px -12px; z-index: -1; filter: drop-shadow(0 6px 10px rgba(10,16,24,0.3));
  background: var(--yc-brush) center / 100% 100% no-repeat; }
.yc-nobrush .yc-ink::before { inset: -6px -10px -4px -8px; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 80' preserveAspectRatio='none'%3E%3Cpath fill='%231b232d' d='M9 44C13 25 41 16 84 15c43-2 92-4 130 3 18 4 23 16 17 28-6 12-31 18-71 19-44 2-96 3-126-2C16 60 6 54 9 44z'/%3E%3Cpath fill='none' stroke='%231b232d' stroke-width='2.4' stroke-linecap='round' d='M212 22l25-3M219 55l19 4M14 36l-10-4'/%3E%3Cpath fill='none' stroke='%23f6f1e7' stroke-opacity='.09' stroke-width='1.6' d='M30 30c50-4 120-6 180-2M26 54c64 4 124 3 188-4M40 42c60-2 110-2 170 0'/%3E%3C/svg%3E")
    center / 100% 100% no-repeat; }
.yc-ink b { font: normal clamp(28px, 4.4vh, 40px)/1.05 ${BRUSH}; letter-spacing: 0.14em; }
.yc-ink b, .yc-ink span { text-shadow: 0 0 4px rgb(20,24,30), 0 0 2px rgb(20,24,30); }   /* 字压到飞白上也看得清 */
.yc-ink span { font-size: 12px; opacity: 0.85; white-space: nowrap; }
.yc-ink:hover, .yc-ink:focus-visible { transform: translateY(-2px) scale(1.03); outline: none; }
.yc-ink:active { transform: scale(0.97); }
.yc-ink:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
.yc-cover.step2 .yc-cover-modes, .yc-cover.step2 .yc-cover-best { display: none; }
.yc-cover-step { position: absolute; right: clamp(16px, 6vw, 110px); top: 50%; transform: translateY(-50%); width: min(400px, calc(100% - 32px));
  max-height: calc(100% - 24px); overflow-y: auto; padding: 24px 28px 18px; text-align: center; pointer-events: auto; }
.yc-cover-step[hidden] { display: none; }
.yc-cover-step h2 { margin: 0; font: normal 40px/1.15 ${BRUSH_BIG}; letter-spacing: 0.3em; text-indent: 0.3em; color: #15110d; }
.yc-cover-step p { margin: 6px 0 12px; font-size: 14px; line-height: 1.7; color: #4a3f33; }
.yc-cover-step .yc-btns { align-items: center; gap: 16px; margin-top: 14px; }
.yc-cover-step .yc-ink { min-width: 132px; align-items: center; padding: 8px 28px 10px; }
.yc-cover-step .yc-ink::before { right: -14px; }   /* 后面紧跟着"返回"，飞白别伸过去 */
.yc-cback { font: inherit; font-size: 14px; color: #5a4d3e; background: none; border: 0; cursor: pointer; padding: 6px 8px;
  text-decoration: underline; text-underline-offset: 4px; }
/* 手机竖屏：标题在左上，按钮并排压在最下面，中间留给画面；第二步是底部的纸面板 */
.yc-narrow .yc-cover::before { background: linear-gradient(180deg, rgba(246,241,231,0.55), rgba(246,241,231,0.18) 38%, rgba(246,241,231,0) 55%,
  rgba(246,241,231,0) 72%, rgba(246,241,231,0.4)); }
.yc-narrow .yc-cover-main { left: 0; right: 0; top: calc(18px + env(safe-area-inset-top, 0px)); bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  padding: 0 16px; justify-content: flex-start; align-items: stretch; gap: 12px; }
.yc-narrow .yc-cover-head { align-self: flex-start; margin-bottom: auto; padding-left: 6px; }
.yc-narrow .yc-cover-title { font-size: clamp(48px, 9.4vh, 84px); }
.yc-narrow .yc-cover-best { align-self: center; }
.yc-narrow .yc-cover-modes { flex-wrap: nowrap; justify-content: center; gap: 14px; }
.yc-narrow .yc-cover-modes .yc-ink { flex: 1 1 0; min-width: 0; max-width: 190px; padding: 12px 16px 14px 18px; }
.yc-narrow .yc-cover-modes .yc-ink::before { right: -14px; }
.yc-narrow .yc-cover-modes .yc-ink span { white-space: normal; font-size: 11px; line-height: 1.35; }
.yc-narrow .yc-cover-step { left: 10px; right: 10px; top: auto; bottom: calc(10px + env(safe-area-inset-bottom, 0px)); transform: none; width: auto; max-height: 72%; }
/* 横过来的手机：标题、按钮都缩一号，第二步纸面板放右边、天赋钮缩小 */
.yc-short .yc-cover-main { gap: 10px; }
.yc-short .yc-cover-title { font-size: clamp(40px, 12vh, 64px); }
.yc-short .yc-cover-tag { font-size: 13px; }
.yc-short .yc-ink b { font-size: 26px; } .yc-short .yc-cover-modes .yc-ink { padding: 8px 24px 10px 20px; }
.yc-short .yc-cover-step { width: min(440px, 58%); padding: 16px 22px 12px; }
.yc-short .yc-cover-step h2 { font-size: 26px; } .yc-short .yc-cover-step p { font-size: 12px; line-height: 1.5; margin-top: 2px; }
.yc-short .yc-cover-step .yc-picker-title { display: none; } .yc-short .yc-cover-step .yc-picker { margin: 8px 0 0; }
.yc-short .yc-cover-step .yc-tal { width: 42px; height: 42px; font-size: 22px; } .yc-short .yc-cover-step .yc-syn { margin-top: 12px; }
.yc-short .yc-cover-step .yc-btns { margin-top: 6px; }
`;

/**
 * 水墨按钮底下那一笔（10-30 本人给了一张笔触图让我挑，选了"左边浓墨起笔、往右飞白散开"那种，照着用代码画）：
 * 一根根笔毛从左往右拖，每根蘸的墨不一样多，边上的少；墨少的先断、拖到后半段断断续续（飞白）；起笔那头按成圆钝的一团。
 * 固定随机种子，谁打开都是同一笔。画不了（没有 canvas）返回空串，CSS 里退回一笔简单的 SVG。
 * @param {number} [w] @param {number} [h]
 */
export function inkStroke(w = 600, h = 200) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!g) return '';
  let seed = 20261030;
  const rnd = () => {   // mulberry32
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const N = 130, x0 = w * 0.03, x1 = w * 0.985, cy = h * 0.55, half = h * 0.33, step = 3;
  const ph = [rnd() * 6.3, rnd() * 6.3, rnd() * 6.3, rnd() * 6.3];
  // 笔毛成簇：相邻几根蘸的墨差不多，干到后半段就分成一缕一缕
  const clump = (v) => 0.5 + 0.2 * Math.sin(v * 6 + ph[0]) + 0.17 * Math.sin(v * 15 + ph[1]) + 0.13 * Math.sin(v * 33 + ph[2]);
  // 起笔的轮廓：圆钝、略斜（上沿比下沿靠右一点）
  const head = (v) => half * 0.82 * (1 - Math.sqrt(Math.max(0, 1 - v * v))) - v * half * 0.12 + 2.5 * Math.sin(v * 4 + ph[3]);
  // 第 v 根笔毛走到 x 时在哪个高度：往右略收、略往上挑
  const midY = (x, v) => { const k = (x - x0) / (x1 - x0); return cy + v * half * (1 - 0.25 * k) - 16 * k * k; };
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (let j = 0; j < N; j++) {
    const v = (j / (N - 1)) * 2 - 1;   // 这根笔毛在笔锋里的位置：-1 上沿，1 下沿
    const ink = Math.max(0.04, Math.min(1, clump(v) * 0.8 + 0.35 * (rnd() - 0.3))) * (1 - 0.45 * v * v);   // 蘸了多少墨：边上的少
    const start = x0 + head(v) + rnd() ** 2 * 14 * (0.3 + Math.abs(v));
    const end = x0 + (x1 - x0) * Math.min(1, 0.42 + 0.66 * ink + (rnd() - 0.5) * 0.1) * (1 - 0.07 * Math.max(0, v));   // 上沿拖得最远
    const w0 = (2 * half / N) * (2.2 + 1.4 * rnd()) * (1 - 0.3 * Math.abs(v));
    g.strokeStyle = `rgba(20,24,30,${(0.82 + 0.18 * rnd()).toFixed(2)})`;
    let on = true, wob = 0, n = 0, px = start, py = midY(start, v);
    g.beginPath(); g.moveTo(px, py); g.lineWidth = w0;
    for (let x = start + step; x <= end; x += step) {
      const u = (x - start) / Math.max(1, end - start);   // 这根拖到哪了（0～1）
      wob += (rnd() - 0.5) * 0.6; wob *= 0.88;
      const y = midY(x, v) + wob;
      const edge = Math.abs(v) > 0.78 ? 0.01 : 0;          // 上下沿毛糙
      // 墨快干了：断开（过了四成才开始断，越往后、墨越少越容易断）；断了以后越靠前越容易接上
      if (on && rnd() < 0.0015 + edge + 0.3 * Math.max(0, u - 0.42) ** 1.5 * (1.3 - ink)) { on = false; g.stroke(); }
      else if (!on && rnd() < 0.05 + 0.5 * (1 - u) ** 2) { on = true; g.beginPath(); g.moveTo(px, py); }
      if (on) {
        g.lineTo(x, y);
        if (++n % 5 === 0) { g.stroke(); g.beginPath(); g.moveTo(x, y); g.lineWidth = w0 * (1 - 0.7 * u ** 1.6); }   // 越往后越细
      }
      px = x; py = y;
    }
    if (on) g.stroke();
  }
  // 起笔处按下去的一团（轮廓跟着起笔、后沿参差），盖住笔毛的头
  g.fillStyle = 'rgb(20,24,30)';
  g.beginPath();
  const M = 28;
  for (let i = 0; i <= M; i++) {
    const v = -0.9 + (i / M) * 1.8, x = x0 + head(v) + 6 + rnd() * 5;
    if (i) g.lineTo(x, midY(x, v)); else g.moveTo(x, midY(x, v));
  }
  for (let i = M; i >= 0; i--) {
    const v = -0.86 + (i / M) * 1.72, x = x0 + half * (1.3 + 1.6 * (1 - v * v)) + rnd() * 10;
    g.lineTo(x, midY(x, v));
  }
  g.closePath();
  g.fill();
  return c.toDataURL('image/png');
}

/** @param {string} html */
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return /** @type {HTMLElement} */ (t.content.firstChild); };
/** @param {string} s */
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);

/**
 * 设置面板画成什么样（main.js 每次有变化重画一遍）。
 * quality：设置里选的档（auto 跟设备走），qualityNow：现在实际是哪档；qnote：画质那行下面的说明（warn 时标红）；
 * keys：试炼键位（触屏上不给 = 不显示这一节），wait：正在等哪一项按新键；inGame：在一局里（才有重新开始、回首页）；
 * confirm：哪个按钮等着再点一次确认
 * @typedef {{ quality: string, qualityNow: string, qnote: string, warn: boolean, view: string, sfx: number, music: number,
 *   keys: { act: string, name: string, label: string }[] | null, knote: string, wait: string | null, inGame: boolean, mode: string, confirm: string | null }} SettingsState
 * @typedef {{ quality: (v: string) => void, view: (v: string) => void, volume: (kind: 'sfx' | 'music', v: number) => void, key: (act: string) => void,
 *   keyReset: () => void, restart: () => void, quit: () => void, close: () => void }} SettingsHandlers
 */

export class Hud {
  /** @param {HTMLElement} root */
  constructor(root) {
    const style = document.createElement('style');
    style.textContent = CSS;
    this.root = el(`<div class="yc-ui"></div>`);
    this.root.append(style);
    let brush = '';
    try { brush = inkStroke(); } catch { /* 画不了就用 CSS 里那笔简单的 */ }
    if (brush) this.root.style.setProperty('--yc-brush', `url("${brush}")`);
    else this.root.classList.add('yc-nobrush');
    this.top = el(`<div class="yc-top">
      <div class="yc-g"><div class="yc-label"><span data-corename>阵眼</span><b data-core>100</b></div><div class="yc-bar yc-core"><i data-corebar></i></div></div>
      <div class="yc-g"><div class="yc-label"><span data-wave>准备守关</span><span data-left></span></div></div>
      <div class="yc-g yc-g-gauge"><div class="yc-label"><span>气势</span><b data-gauge>0 / 8</b></div><div class="yc-bar yc-gauge" data-gaugebar></div></div></div>`);
    this.bottom = el(`<div class="yc-bottom"><div class="yc-skills" hidden></div>
      <div class="yc-label"><span>法力</span><b data-mana>100</b></div><div class="yc-bar yc-mana"><i data-manabar></i></div>
      <div class="yc-say"><input class="yc-input" maxlength="${INPUT_MAX_CHARS}" enterkeyhint="send" autocomplete="off" aria-label="咒语" placeholder="说出你的咒语……（回车施法）">
        <button class="yc-mic" type="button" hidden></button></div>
      <button class="yc-ink yc-go" data-go hidden><b>开战</b></button>
      <div class="yc-hint" data-hint>开口就慢放，想好再说。例：先冻住最前面那只，再用风把它们吹下悬崖</div></div>`);
    this.boss = el(`<div class="yc-boss" hidden><div class="yc-label"><span data-bossname></span><b data-bossphase></b></div>
      <div class="yc-bar yc-bosshp"><i data-bosshp></i></div><div class="yc-bar yc-armor"><i data-armor></i></div></div>`);
    this.card = el(`<div class="yc-card" role="status" aria-live="polite"></div>`);
    this.big = el(`<div class="yc-big"></div>`);
    // 首页与结算页是同一块面板（内容由 showOverlay 填）
    this.overlay = el(`<div class="yc-overlay"><div class="yc-box yc-paper">
      <div class="yc-res-l"><div class="yc-res-head"><h1>言出法随</h1><i class="yc-seal" data-seal></i></div>
        <p data-lead></p><div class="yc-stats" hidden></div><p data-tip hidden></p><div class="yc-best" hidden></div></div>
      <div class="yc-res-r"><div class="yc-picker"><div class="yc-picker-title">选天赋（最多 3 个）</div><div class="yc-talents"></div><div class="yc-syn"></div></div>
        <div class="yc-btns"><button class="yc-ink" data-trial><b>开始试炼</b></button><button class="yc-ink yc-sub" data-start><b>守关模式</b></button>
          <button class="yc-ink yc-sub" data-report style="order:2" hidden><b>看战报</b></button><button class="yc-ink yc-sub" data-home style="order:3"><b>回首页</b></button></div>
        <p class="yc-note" data-note hidden></p></div></div></div>`);
    // 首页封面（showCover）：第二步选天赋用的就是上面结算页那块（picker 在两处之间挪）
    this.cover = el(`<div class="yc-cover" hidden><div class="yc-cover-main">
      <div class="yc-cover-head"><div class="yc-cover-tcol"><h1 class="yc-cover-title">言出法随</h1><i class="yc-seal">敕令</i></div>
        <p class="yc-cover-tag">打一句中文，法术就是什么<br>说得越有画面感，气势越足</p></div>
      <div class="yc-cover-best" hidden></div>
      <div class="yc-cover-modes"><button class="yc-ink" data-mode="trial"></button><button class="yc-ink" data-mode="defense"></button></div></div>
      <div class="yc-cover-step yc-paper" hidden><h2></h2><p></p>
        <div class="yc-btns"><button class="yc-ink" data-cgo><b>开始</b></button><button class="yc-cback" data-back>返回</button></div></div></div>`);
    this.picker = /** @type {HTMLElement} */ (this.overlay.querySelector('.yc-picker'));
    /** 封面上点了哪个模式（第二步"开始"就开这个） @type {'trial' | 'defense'} */
    this.coverMode = 'trial';
    /** @type {Record<string, { name: string, sub: string, desc: string }>} */
    this.coverModes = {};
    /** @type {((mode: 'trial' | 'defense') => void) | null} */
    this.coverGo = null;
    for (const b of this.cover.querySelectorAll('[data-mode]')) {
      b.addEventListener('click', () => this.coverStep(/** @type {'trial' | 'defense'} */ (/** @type {HTMLElement} */ (b).dataset.mode)));
    }
    /** @type {HTMLElement} */ (this.cover.querySelector('[data-back]')).addEventListener('click', () => this.coverStep(null));
    /** @type {HTMLElement} */ (this.cover.querySelector('[data-cgo]')).addEventListener('click', () => this.coverGo?.(this.coverMode));
    this.write = el(`<div class="yc-write" hidden><div class="yc-box">
      <div class="yc-write-title"></div>
      <input class="yc-input" maxlength="${INPUT_MAX_CHARS}" enterkeyhint="done" autocomplete="off" aria-label="给按钮写的咒" placeholder="写一句咒……（例：三颗火球从天而降）">
      <div class="yc-ideas"></div><div class="yc-write-msg"></div>
      <div class="yc-write-btns"><button class="yc-btn ghost" data-inspire>求灵感</button><button class="yc-btn ghost" data-reset>恢复默认</button>
        <button class="yc-btn ghost" data-cancel>取消</button><button class="yc-btn" data-ok>装进按钮</button></div></div></div>`);
    this.debug = el(`<div class="yc-debug" hidden></div>`);
    this.floats = el(`<div style="position:absolute;inset:0;overflow:hidden"></div>`);
    this.stick = el(`<div class="yc-stick"><i></i></div>`);
    this.knob = /** @type {HTMLElement} */ (this.stick.firstElementChild);
    this.picks = el(`<div class="yc-picks" hidden><div class="yc-picks-box yc-paper"><div class="yc-picks-title">三选一</div><div class="yc-picks-sub"></div>
      <div class="yc-pick-row"></div>
      <div class="yc-picks-btns"><button class="yc-ink yc-sub" data-reroll><b></b></button><button class="yc-ink yc-sub" data-skip><b>不拿，回满气血与法力</b></button></div></div></div>`);
    /** @type {{ pick: (i: number) => void, reroll: () => void, skip: () => void } | null} */
    this.pickOn = null;
    /** 精力最近一次画到几格（setStamina） */
    this.stamina = { v: 0, max: 0, locked: false };
    /** @type {HTMLElement} */ (this.picks.querySelector('[data-reroll]')).addEventListener('click', () => this.pickOn?.reroll());
    /** @type {HTMLElement} */ (this.picks.querySelector('[data-skip]')).addEventListener('click', () => this.pickOn?.skip());
    // 声音开关压在最上面（首页、结算页上也点得到）；点完把焦点还回去，免得试炼里按空格闪避时又点了它一下
    this.mute = el(`<button class="yc-mute" type="button"></button>`);
    /** @type {(() => void) | null} */
    this.onMute = null;
    this.mute.addEventListener('click', () => { this.mute.blur(); this.onMute?.(); });
    // 试炼的视角按钮（setView 写名字、管出不出）：同样点完还焦点
    this.viewBtn = el(`<button class="yc-view" type="button" hidden></button>`);
    /** @type {(() => void) | null} */
    this.onView = null;
    this.viewShown = '';
    this.viewBtn.addEventListener('click', () => { this.viewBtn.blur(); this.onView?.(); });
    /** 按钮下面、视角按钮上写的键名（setKeyLabels；守关是数字） */
    this.keyLabels = { dash: '空格', skills: ['1', '2', '3'], ult: '4', view: 'V' };
    // 设置：齿轮 + 纸面板（openSettings / renderSettings）；各项点了调 setOn 里对应的
    const tooth = (/** @type {number} */ a) => `<rect x="10.5" y="1.6" width="3" height="4.2" rx="0.8" transform="rotate(${a} 12 12)"/>`;
    this.gear = el(`<button class="yc-gear" type="button" title="设置（Esc）" aria-label="设置"><svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor">
      <path fill-rule="evenodd" d="M12 4.6a7.4 7.4 0 1 1 0 14.8a7.4 7.4 0 1 1 0-14.8zm0 4.3a3.1 3.1 0 1 0 0 6.2a3.1 3.1 0 1 0 0-6.2z"/>
      ${[0, 45, 90, 135, 180, 225, 270, 315].map(tooth).join('')}</g></svg></button>`);
    /** @type {(() => void) | null} */
    this.onGear = null;
    this.gear.addEventListener('click', () => { this.gear.blur(); this.onGear?.(); });
    const seg = (/** @type {string} */ k, /** @type {[string, string][]} */ opts) =>
      `<div class="yc-seg" data-seg="${k}">${opts.map(([v, t]) => `<button type="button" data-v="${v}">${t}</button>`).join('')}</div>`;
    const vol = (/** @type {string} */ k, /** @type {string} */ name) =>
      `<div class="yc-set-row"><span class="yc-set-k">${name}</span><input type="range" min="0" max="100" step="5" data-vol="${k}" aria-label="${name}音量"><span class="yc-set-v" data-volv="${k}"></span></div>`;
    this.set = el(`<div class="yc-set" hidden role="dialog" aria-label="设置"><div class="yc-set-box yc-paper">
      <div class="yc-set-title">设置</div>
      <div class="yc-set-main">
        <div class="yc-set-row"><span class="yc-set-k">画质</span>${seg('quality', [['auto', '自动'], ['cinema', '电影档'], ['smooth', '流畅档']])}</div>
        <div class="yc-set-row"><span class="yc-set-k">视角</span>${seg('view', [['follow', '俯视'], ['shoulder', '肩后'], ['first', '第一人称']])}</div>
        ${vol('sfx', '音效')}${vol('music', '音乐')}
      </div>
      <p class="yc-set-note" data-qnote></p>
      <div class="yc-set-keys" data-keys><div class="yc-set-sub">试炼键位<small>点一项，再按新的键；撞了别的就互换</small></div>
        <div class="yc-keygrid"></div>
        <p class="yc-set-note"><span data-knote></span><button type="button" class="yc-set-mini" data-keyreset>恢复默认</button></p></div>
      <div class="yc-set-btns"><button class="yc-ink yc-sub" data-restart><b></b></button><button class="yc-ink yc-sub" data-quit><b></b></button>
        <button class="yc-ink" data-close><b>继续</b></button></div></div></div>`);
    /** @type {SettingsHandlers | null} */
    this.setOn = null;
    for (const s of this.set.querySelectorAll('[data-seg]')) {
      s.addEventListener('click', (e) => {
        const b = /** @type {HTMLElement} */ (e.target).closest('button');
        if (!b) return;
        const v = /** @type {string} */ (b.dataset.v), k = /** @type {HTMLElement} */ (s).dataset.seg;
        if (k === 'quality') this.setOn?.quality(v); else this.setOn?.view(v);
      });
    }
    for (const r of this.set.querySelectorAll('[data-vol]')) {
      const inp = /** @type {HTMLInputElement} */ (r), k = /** @type {'sfx' | 'music'} */ (inp.dataset.vol);
      inp.addEventListener('input', () => { this.q(`[data-volv="${k}"]`).textContent = inp.value; this.setOn?.volume(k, +inp.value / 100); });
    }
    this.set.querySelector('.yc-keygrid')?.addEventListener('click', (e) => {
      const b = /** @type {HTMLElement} */ (e.target).closest('[data-act]');
      if (b) this.setOn?.key(/** @type {string} */ (/** @type {HTMLElement} */ (b).dataset.act));
    });
    const sb = (sel, fn) => /** @type {HTMLElement} */ (this.set.querySelector(sel)).addEventListener('click', fn);
    sb('[data-keyreset]', () => this.setOn?.keyReset());
    sb('[data-restart]', () => this.setOn?.restart());
    sb('[data-quit]', () => this.setOn?.quit());
    sb('[data-close]', () => this.setOn?.close());
    this.set.addEventListener('click', (e) => { if (e.target === this.set) this.setOn?.close(); });   // 点纸外面的暗处也是关
    this.report = el(`<div class="yc-report" hidden><img alt="战报卡"><p class="yc-report-msg"></p>
      <div class="yc-report-btns"><a class="yc-btn" data-save download="言出法随-战报.png">保存图片</a>
        <button class="yc-btn ghost" data-share>分享</button><button class="yc-btn ghost" data-close>关闭</button></div></div>`);
    /** 结算页上"看战报"要生成的那张（showOverlay 换） @type {(() => Promise<Blob | null>) | null} */
    this.reportMake = null;
    this.reportUrl = ''; this.reportSeq = 0;
    /** @type {HTMLElement} */ (this.overlay.querySelector('[data-report]')).addEventListener('click', () => { if (this.reportMake) this.openReport(this.reportMake); });
    /** @type {HTMLElement} */ (this.report.querySelector('[data-close]')).addEventListener('click', () => this.closeReport());
    // boss 跑出画面时指着它的箭头（试炼的跟随镜头）
    this.arrow = el(`<div class="yc-arrow" hidden><i></i></div>`);
    /** boss 血条下沿（界面坐标，没有血条为 0），placeBoss 量 */
    this.bossEdge = 0;
    this.root.append(this.floats, this.stick, this.arrow, this.top, this.boss, this.card, this.big, this.bottom, this.debug, this.write, this.picks, this.overlay, this.cover, this.report, this.mute, this.viewBtn, this.gear, this.set);
    root.append(this.root);
    this.input = /** @type {HTMLInputElement} */ (this.bottom.querySelector('input'));
    this.go = /** @type {HTMLButtonElement} */ (this.bottom.querySelector('[data-go]'));
    // 麦克风：按下就开始（不等松手），抓住这根手指，滑出按钮再松开也算松开；不抢输入框的焦点、长按不弹菜单
    this.mic = /** @type {HTMLButtonElement} */ (this.bottom.querySelector('.yc-mic'));
    /** @type {{ down: () => void, up: () => void } | null} */
    this.micOn = null;
    this.mic.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { this.mic.setPointerCapture(e.pointerId); } catch { /* 有的浏览器不让抓，照样能用 */ }
      this.micOn?.down();
    });
    for (const ev of ['pointerup', 'pointercancel']) this.mic.addEventListener(ev, () => this.micOn?.up());
    this.mic.addEventListener('contextmenu', (e) => e.preventDefault());
    this.setMicState('idle');
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
      const b = el(`<button class="yc-tal${t.on ? ' on' : ''}" style="--c:${SEAL_INK[t.el] ?? elColor(t.el)}" aria-pressed="${t.on}"${t.open ? '' : ' disabled'}>${esc(t.name)}${t.open ? '' : '<small>即将领悟</small>'}</button>`);
      b.addEventListener('click', () => onToggle(t.el));
      box.append(b);
    }
    const nm = (x) => list.find((t) => t.el === x)?.name || x;
    this.q('.yc-syn').innerHTML = syn.length
      ? '羁绊　' + syn.map((s) => `<span style="white-space:nowrap">先${esc(nm(s.a))}后${esc(nm(s.b))}：<b>${esc(s.name)}</b></span>`).join('　')
      : (list.some((t) => t.on) ? '再选一个，看看它们之间的羁绊' : '至少选一个天赋');
    for (const b of this.root.querySelectorAll('[data-start],[data-trial],[data-cgo]')) /** @type {HTMLButtonElement} */ (b).disabled = !list.some((t) => t.on);
  }

  /**
   * 战斗中的天赋按钮栏：每个天赋一个圆钮（右上角的笔用来写咒），后面是气势满了才出现的"召唤"。
   * 试炼模式另给 dash：天赋前面多一个"闪"（闪避）。
   * @param {{ el: string, label: string, named: boolean }[]} skills
   * @param {{ cast: (el: string) => void, pen: (el: string) => void, summon: () => void, dash?: () => void }} on
   */
  setSkills(skills, on) {
    const bar = this.q('.yc-skills');
    bar.innerHTML = '';
    if (on.dash) {
      const d = el(`<button class="yc-dash" aria-label="闪避">闪<span class="yc-key">${esc(this.keyLabels.dash)}</span><span class="yc-pips"></span></button>`);
      d.addEventListener('pointerdown', (e) => { e.preventDefault(); on.dash?.(); });
      bar.append(d);
      if (this.stamina.max) this.setStamina(this.stamina.v, this.stamina.max, this.stamina.locked);
    }
    skills.forEach((s, i) => {
      const w = el(`<div class="yc-skill" style="--c:${SEAL_INK[s.el] ?? elColor(s.el)}" data-el="${s.el}"><button class="yc-cast"></button>
        <button class="yc-pen" aria-label="给这个按钮写一句咒">✎</button><span class="yc-key">${esc(this.keyLabels.skills[i] ?? '')}</span></div>`);
      const cast = /** @type {HTMLElement} */ (w.querySelector('.yc-cast'));
      // 按下就放（不等松手），也不让按钮抢走输入框的焦点、收起手机键盘
      cast.addEventListener('pointerdown', (e) => { e.preventDefault(); on.cast(s.el); });
      /** @type {HTMLElement} */ (w.querySelector('.yc-pen')).addEventListener('click', () => on.pen(s.el));
      bar.append(w);
      this.setSkillLabel(s.el, s.label, s.named);
    });
    const sm = el(`<button class="yc-summon" hidden>召唤<span class="yc-key">${esc(this.keyLabels.ult)}</span></button>`);
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
  /** 左上第一条血叫什么：守关是"阵眼"，试炼是玩家自己的"气血" @param {string} name */
  setCoreName(name) { this.q('[data-corename]').textContent = name; }

  /**
   * 试炼模式的界面：不打字（藏起输入框）；开战后不能写咒（藏起按钮上的笔）；战前显示"开战"。
   * @param {boolean} on 是否在试炼模式 @param {boolean} fighting 是否已开战
   */
  setTrial(on, fighting) {
    this.input.hidden = on;
    this.go.hidden = !on || fighting;
    this.root.classList.toggle('yc-nopen', on && fighting);
    if (!on) this.setBoss(null);
  }
  /** 接上麦克风按钮（浏览器录不了音就不接，按钮一直藏着） @param {{ down: () => void, up: () => void }} on */
  setMic(on) { this.micOn = on; }
  /** 麦克风按钮显不显示（试炼开战后只在气势满了时出现） @param {boolean} on */
  setMicShown(on) { if (this.mic.hidden === on) this.mic.hidden = !on; }
  /**
   * 麦克风按钮的样子：idle 待命；wait 等麦克风打开；on 在录（松开施法）；tap 在录（点一下开始的，再点一下施法）；busy 识别中
   * @param {'idle' | 'wait' | 'on' | 'tap' | 'busy'} state
   */
  setMicState(state) {
    const label = { idle: '按住说话', wait: '正在打开麦克风', on: '松开施法', tap: '再点一下施法', busy: '正在听写' }[state];
    this.mic.classList.toggle('rec', state === 'on' || state === 'tap');
    this.mic.classList.toggle('busy', state === 'busy' || state === 'wait');
    this.mic.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/>'
      + '<path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
      + `<span>${label}</span>`;
    this.mic.title = label;
    this.mic.setAttribute('aria-label', label);
  }
  /** 试炼 · 手机布局：左手摇杆、右手一簇按钮 @param {boolean} on */
  setPad(on) { this.root.classList.toggle('yc-pad', on); this.showStick(null); }
  /**
   * 摇杆：底座放在 at（界面坐标，像素），中间的圆偏 (kx, ky)；null 回左下角待命。
   * @param {{ x: number, y: number } | null} at @param {number} [kx] @param {number} [ky]
   */
  showStick(at, kx = 0, ky = 0) {
    this.stick.classList.toggle('on', !!at);
    this.stick.style.left = at ? `${at.x}px` : '';
    this.stick.style.top = at ? `${at.y}px` : '';
    this.knob.style.transform = `translate(${kx}px, ${ky}px)`;
  }
  /**
   * 精力：闪避按钮上方的格子填到几成，不够 1 格、或被锁住（字诀「重」放完那一会儿）时按钮变淡（按钮栏重画后照上次的数补画）
   * @param {number} v @param {number} max @param {boolean} [locked]
   */
  setStamina(v, max, locked = false) {
    this.stamina = { v, max, locked };
    const d = this.root.querySelector('.yc-dash');
    if (!d) return;
    d.classList.toggle('cd', v < 1 || locked);
    const pips = /** @type {HTMLElement} */ (d.querySelector('.yc-pips'));
    if (pips.children.length !== max) pips.innerHTML = '<i></i>'.repeat(max);
    [...pips.children].forEach((p, i) => /** @type {HTMLElement} */ (p).style.setProperty('--f', String(Math.max(0, Math.min(1, v - i)))));
  }

  /**
   * boss 血条（null 收起）：名字、第几阶段、血、甲（kind 是哪个 boss：stone 石甲画成土色、flame 火罩画成橙色；别的是冰甲的淡蓝）。
   * @param {{ name: string, phase: string, hp: number, max: number, armor: number, armorMax: number, kind?: string } | null} b
   */
  setBoss(b) {
    this.boss.hidden = !b;
    if (!b) { this.bossEdge = 0; return; }
    this.q('[data-bossname]').textContent = b.name;
    this.q('[data-bossphase]').textContent = b.phase;
    this.q('[data-bosshp]').style.width = `${Math.max(0, b.hp / b.max) * 100}%`;
    const armor = this.q('[data-armor]');
    armor.style.width = `${Math.max(0, b.armor / b.armorMax) * 100}%`;
    for (const k of ['stone', 'flame']) armor.parentElement?.classList.toggle(k, b.kind === k);
    this.placeBoss();
  }
  /**
   * boss 血条居中靠上；和左上角的面板左右重叠时，面板右边放得下（矮窗口）就挪到面板右边，放不下（竖屏）才放到面板下面——
   * 矮窗口里放到面板下面就落在画面正中，正挡着试炼镜头框人和 boss 的地方
   */
  placeBoss() {
    this.bossEdge = 0;
    if (this.boss.hidden) return;
    const pad = this.root.classList.contains('yc-pad');   // 手机试炼布局由 CSS 放在面板右边
    const W = this.root.clientWidth, w = Math.min(440, W - 32), right = this.topRight() + 8;
    const overlaps = !pad && (W - w) / 2 < right;
    const side = overlaps && W - right - 104 >= 280;   // 右边让出设置与声音开关
    this.boss.classList.toggle('yc-side', side);
    this.boss.style.left = side ? `${right}px` : '';
    this.boss.style.top = overlaps && !side ? `${this.topBottom() + 6}px` : '';
    this.bossEdge = this.boss.offsetTop + this.boss.offsetHeight;
  }
  /** boss 血条下沿换成画面的投影坐标（顶上是 1）：试炼镜头别把 boss 放到它底下。没有血条给 1 */
  safeTop() {
    const H = this.root.clientHeight;
    return this.bossEdge && H ? 1 - 2 * (this.bossEdge + 8) / H : 1;
  }
  // 左上面板的右边、下边（界面坐标）：用布局尺寸，不用 getBoundingClientRect——试炼横过来转了 90° 时后者是转完的屏幕坐标
  topRight() { return this.top.offsetLeft + this.top.offsetWidth; }
  topBottom() { return this.top.offsetTop + this.top.offsetHeight; }
  setMana(m, max) { this.q('[data-mana]').textContent = String(Math.floor(m)); this.q('[data-manabar]').style.width = `${(m / max) * 100}%`; }
  setWave(text, left) { this.q('[data-wave]').textContent = text; this.q('[data-left]').textContent = left; }
  setHint(text) { this.q('[data-hint]').textContent = text; }
  /**
   * 气势槽：一格一格染色（完美闪避加的是白格），满了发光，写明能召哪条龙
   * @param {number} g @param {number} max @param {string[]} [cols] 每一格的元素（或 white） @param {string} [name] 满了召的龙
   */
  setGauge(g, max, cols = [], name = '冰龙') {
    this.q('[data-gauge]').textContent = g >= max ? `已满·可召唤${name}` : `${g} / ${max}`;
    const bar = this.q('[data-gaugebar]');
    if (bar.childElementCount !== max) bar.innerHTML = '<i></i>'.repeat(max);
    [...bar.children].forEach((c, i) => {
      const k = i < g ? cols[i] : undefined;
      /** @type {HTMLElement} */ (c).style.setProperty('--c', !k ? 'transparent' : k === 'white' ? '#fffdf6' : SEAL_INK[k] ?? elColor(k));
      c.classList.toggle('w', k === 'white');
    });
    this.top.classList.toggle('gauge-full', g >= max);
  }

  /** 游戏区域变了尺寸：窄（竖屏）、矮（键盘弹起）切换布局，再把咒语卡放到不挡面板的地方 @param {number} w @param {number} h */
  setLayout(w, h) {
    this.root.classList.toggle('yc-narrow', w <= 600);
    this.root.classList.toggle('yc-short', h <= 520);
    this.placeCard();
    this.placeBoss();
  }

  /** 咒语卡居中靠上；若和左上角的面板左右重叠，就放到面板下面 */
  placeCard() {
    const W = this.root.clientWidth, cardW = this.card.offsetWidth || Math.min(560, W - 32);
    const overlaps = (W - cardW) / 2 < this.topRight() + 8;
    this.card.style.top = overlaps ? `${this.topBottom() + 8}px` : '';
  }

  /**
   * boss 在画面外时的箭头：x、y 是在游戏区域里的位置（0～1，从左上角算），angle 朝哪（弧度，0 朝右、逆时针为正）；给 null 收起
   * @param {{ x: number, y: number, angle: number } | null} a
   */
  setArrow(a) {
    if (!a) { if (!this.arrow.hidden) this.arrow.hidden = true; return; }
    this.arrow.hidden = false;
    Object.assign(this.arrow.style, { left: `${(a.x * 100).toFixed(2)}%`, top: `${(a.y * 100).toFixed(2)}%`, transform: `rotate(${(-a.angle).toFixed(3)}rad)` });
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
    for (const r of intent.runes ?? []) marks.push({ w: r.ch, color: KIND_COLOR['字诀'], tag: `字诀·${r.tag}` });   // 试炼里写进按钮的字诀
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

  /**
   * 试炼的三选一。卡：种类（招式字、心法……）、书法名字（再拿是升级，名字后带「·二」）、说明、颜色（带元素的用元素色）。
   * 点卡、或按 1～3 拿那一张（按键由 main.js 转给 pickOn）；重抽每局有限，用完按钮灰掉。
   * 拿了招式字接着用同一个框选"换哪个按钮"：换标题，不给重抽（rerolls 为 null），下面那个按钮改成"返回"。
   * @param {{ kind: string, name: string, text: string, el?: string, insight: boolean }[]} cards
   * @param {{ title?: string, sub: string, rerolls: number | null, skipText?: string,
   *           pick: (i: number) => void, reroll: () => void, skip: () => void }} on
   */
  showPicks(cards, on) {
    this.q('.yc-picks-title').textContent = on.title ?? '三选一';
    /** @type {HTMLElement} */ (this.picks.querySelector('[data-skip] b')).textContent = on.skipText ?? '不拿，回满气血与法力';
    const row = this.q('.yc-pick-row');
    row.innerHTML = '';
    cards.forEach((c, i) => {
      const color = c.el ? SEAL_INK[c.el] ?? elColor(c.el) : PICK_INK[c.kind] || '#2f4f86';
      const b = el(`<button class="yc-pick${c.insight ? ' insight' : ''}" style="--c:${color}"><span class="yc-pick-kind">${esc(c.kind)}</span>
        <b class="yc-pick-name">${esc(showName(c.name))}</b><span class="yc-pick-text">${esc(c.text)}</span><span class="yc-key">${i + 1}</span></button>`);
      b.addEventListener('click', () => this.pickOn?.pick(i));
      row.append(b);
    });
    this.q('.yc-picks-sub').textContent = on.sub;
    const rr = /** @type {HTMLButtonElement} */ (this.picks.querySelector('[data-reroll]'));
    rr.hidden = on.rerolls === null;
    /** @type {HTMLElement} */ (rr.querySelector('b')).textContent = `重抽（还剩 ${on.rerolls} 次）`;
    rr.disabled = !on.rerolls || !cards.length;
    this.pickOn = on;
    this.picks.hidden = false;
  }
  closePicks() { this.picks.hidden = true; this.pickOn = null; }

  /**
   * 首页 / 结算页：标题（大字）、一行说明、几格数字（结算用）、一行提示、本机最佳（fresh：这局刚破的）、
   * 两个模式的按钮（main 那个是主按钮、排前面）、按钮下一行小字。
   * @param {string} title
   * report：结算页给了就出"看战报"按钮，点了才画（report.js makeReport）
   * @param {{ lead: string, stats?: { k: string, v: string }[], tip?: string, best?: string, fresh?: boolean,
   *           main: 'trial' | 'defense', trial: string, defense: string, note?: string, report?: () => Promise<Blob | null> }} o
   */
  showOverlay(title, o) {
    this.reportMake = o.report ?? null;
    /** @type {HTMLElement} */ (this.overlay.querySelector('[data-report]')).hidden = !o.report;
    const box = this.overlay;
    const set = (/** @type {string} */ sel, /** @type {string | undefined} */ text) => {
      const n = /** @type {HTMLElement} */ (box.querySelector(sel));
      n.textContent = text ?? ''; n.hidden = !text;
    };
    /** @type {HTMLElement} */ (box.querySelector('h1')).textContent = title;
    /** @type {HTMLElement} */ (box.querySelector('[data-seal]')).textContent = o.main === 'trial' ? '试炼' : '守关';
    set('[data-lead]', o.lead); set('[data-tip]', o.tip); set('[data-note]', o.note);
    set('.yc-best', o.best ? `本机最佳　${o.best}` : '');   // 新纪录是 .hot 加的红印
    this.q('.yc-best').classList.toggle('hot', !!o.fresh);
    const stats = this.q('.yc-stats');
    stats.innerHTML = (o.stats ?? []).map((s) =>
      `<div class="yc-stat"><b>${esc(s.v).replace(/\d+(:\d+)?/g, '<em>$&</em>')}</b><span>${esc(s.k)}</span></div>`).join('');
    stats.hidden = !o.stats?.length;
    const trialFirst = o.main === 'trial';
    for (const [sel, text, first] of /** @type {const} */ ([['[data-trial]', o.trial, trialFirst], ['[data-start]', o.defense, !trialFirst]])) {
      const b = /** @type {HTMLElement} */ (box.querySelector(sel));
      /** @type {HTMLElement} */ (b.querySelector('b')).textContent = text; b.classList.toggle('yc-sub', !first); b.style.order = first ? '0' : '1';
    }
    /** @type {HTMLElement} */ (box.querySelector('.yc-btns')).before(this.picker);   // 选天赋可能还在封面上
    this.hideCover();
    box.hidden = false;
    this.root.classList.add('yc-on-result');   // 结算页开着时战斗界面藏起来（和封面一样只是看不见）
  }
  hideOverlay() { this.overlay.hidden = true; this.root.classList.remove('yc-on-result'); this.closeReport(); this.hideCover(); }

  /**
   * 首页封面：竖排大标题、红印、两个水墨按钮（模式名 + 一行小字）、本机最佳。点模式按钮进第二步：模式名、说明、选天赋、开始 / 返回。
   * 封面开着时战斗界面（顶上的面板、输入框、按钮栏）藏起来（只是看不见，量尺寸照常）。
   * @param {{ best: string, modes: Record<'trial' | 'defense', { name: string, sub: string, desc: string }> }} o
   * @param {(mode: 'trial' | 'defense') => void} go 第二步点"开始"
   */
  showCover(o, go) {
    this.coverGo = go;
    this.coverModes = o.modes;
    for (const b of this.cover.querySelectorAll('[data-mode]')) {
      const m = o.modes[/** @type {'trial' | 'defense'} */ (/** @type {HTMLElement} */ (b).dataset.mode)];
      b.innerHTML = `<b>${esc(m.name)}</b><span>${esc(m.sub)}</span>`;
    }
    const best = /** @type {HTMLElement} */ (this.cover.querySelector('.yc-cover-best'));
    best.textContent = o.best; best.hidden = !o.best;
    this.overlay.hidden = true;
    this.root.classList.remove('yc-on-result');
    this.closeReport();
    this.cover.hidden = false;
    this.root.classList.add('yc-on-cover');
    this.coverStep(null);
  }
  /** 封面第一步（null：两个模式按钮）/ 第二步（点了哪个模式：说明、选天赋、开始） @param {'trial' | 'defense' | null} mode */
  coverStep(mode) {
    const step = /** @type {HTMLElement} */ (this.cover.querySelector('.yc-cover-step'));
    this.cover.classList.toggle('step2', !!mode);
    step.hidden = !mode;
    if (!mode) return;
    this.coverMode = mode;
    const m = this.coverModes[mode];
    /** @type {HTMLElement} */ (step.querySelector('h2')).textContent = m.name;
    /** @type {HTMLElement} */ (step.querySelector('p')).textContent = m.desc;
    /** @type {HTMLElement} */ (step.querySelector('.yc-btns')).before(this.picker);
  }
  hideCover() { this.cover.hidden = true; this.root.classList.remove('yc-on-cover'); }
  /** 封面开着没有 */
  get onCover() { return !this.cover.hidden; }

  /**
   * 看战报：先写"正在生成"，画好换成图片。保存在电脑上是下载；手机浏览器多半不认下载，长按图片保存（微信里也行）；
   * 能分享文件的浏览器另给"分享"
   * @param {() => Promise<Blob | null>} make
   */
  async openReport(make) {
    const box = this.report, img = /** @type {HTMLImageElement} */ (box.querySelector('img')), msg = /** @type {HTMLElement} */ (box.querySelector('.yc-report-msg'));
    const save = /** @type {HTMLAnchorElement} */ (box.querySelector('[data-save]')), share = /** @type {HTMLButtonElement} */ (box.querySelector('[data-share]'));
    this.closeReport();
    const seq = ++this.reportSeq;
    box.hidden = false; img.hidden = true; save.hidden = true; share.hidden = true;
    msg.textContent = '正在生成战报……';
    const blob = await make().catch(() => null);
    if (seq !== this.reportSeq || box.hidden) return;
    if (!blob) { msg.textContent = '战报没生成出来，关掉再点一次'; return; }
    this.reportUrl = URL.createObjectURL(blob);
    img.src = this.reportUrl; img.hidden = false;
    save.href = this.reportUrl; save.hidden = false;
    msg.textContent = '手机上长按图片，可以保存或发给朋友';
    const file = new File([blob], '言出法随-战报.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      share.hidden = false;
      share.onclick = () => { navigator.share({ files: [file], title: '言出法随' }).catch(() => {}); };
    }
  }
  closeReport() {
    this.reportSeq++;
    this.report.hidden = true;
    if (this.reportUrl) { URL.revokeObjectURL(this.reportUrl); this.reportUrl = ''; }
  }

  /** 视角按钮：写现在是哪一档、出不出（每帧调，没变就不动） @param {string} name @param {boolean} shown */
  setView(name, shown) {
    const key = shown ? `${name}|${this.keyLabels.view}` : '';
    if (key === this.viewShown) return;
    this.viewShown = key;
    this.viewBtn.hidden = !shown;
    if (!shown) return;
    this.viewBtn.innerHTML = `视角：${esc(name)}<small>${esc(this.keyLabels.view)}</small>`;
    this.viewBtn.title = '切换视角：俯视 / 肩后 / 第一人称';
    this.viewBtn.setAttribute('aria-label', `视角：${name}，点了换下一档`);
  }

  /** 打开设置面板（画成什么样由调用方接着 renderSettings） @param {SettingsHandlers} on */
  openSettings(on) { this.setOn = on; this.set.hidden = false; }
  closeSettings() { this.set.hidden = true; this.setOn = null; }
  get settingsOn() { return !this.set.hidden; }
  /** 按现在的设置重画面板（选中哪档、音量、键位、按钮字） @param {SettingsState} s */
  renderSettings(s) {
    for (const g of this.set.querySelectorAll('[data-seg]')) {
      const cur = /** @type {HTMLElement} */ (g).dataset.seg === 'quality' ? s.quality : s.view;
      for (const b of g.querySelectorAll('button')) {
        const on = b.dataset.v === cur;
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
      }
    }
    for (const k of /** @type {const} */ (['sfx', 'music'])) {
      const v = String(Math.round(s[k] * 100));
      /** @type {HTMLInputElement} */ (this.q(`[data-vol="${k}"]`)).value = v;
      this.q(`[data-volv="${k}"]`).textContent = v;
    }
    const qn = this.q('[data-qnote]');
    qn.textContent = s.qnote; qn.classList.toggle('warn', s.warn);
    const keys = /** @type {HTMLElement} */ (this.set.querySelector('[data-keys]'));
    keys.hidden = !s.keys;
    if (s.keys) {
      /** @type {HTMLElement} */ (this.set.querySelector('.yc-keygrid')).innerHTML = s.keys.map((k) => `<div class="yc-keyrow"><span>${esc(k.name)}</span>`
        + `<button type="button" class="yc-keybtn${s.wait === k.act ? ' wait' : ''}" data-act="${k.act}" aria-label="${esc(k.name)}：${esc(k.label)}，点了改">`
        + `${s.wait === k.act ? '按新键…' : esc(k.label)}</button></div>`).join('');
      this.q('[data-knote]').textContent = s.knote;
    }
    const rs = /** @type {HTMLElement} */ (this.set.querySelector('[data-restart]')), qt = /** @type {HTMLElement} */ (this.set.querySelector('[data-quit]'));
    rs.hidden = qt.hidden = !s.inGame;
    /** @type {HTMLElement} */ (rs.querySelector('b')).textContent = s.confirm === 'restart' ? '再点一次确认' : s.mode === 'trial' ? '重新开始' : '重新守关';
    /** @type {HTMLElement} */ (qt.querySelector('b')).textContent = s.confirm === 'quit' ? '再点一次确认' : '回首页';
  }

  /**
   * 按钮下面、视角按钮上写的键名：试炼电脑上按设置里绑的，守关是数字（触屏上 .yc-pad 不显示）
   * @param {{ dash: string, skills: string[], ult: string, view: string }} k
   */
  setKeyLabels(k) {
    this.keyLabels = k;
    const d = this.root.querySelector('.yc-dash .yc-key');
    if (d) d.textContent = k.dash;
    this.root.querySelectorAll('.yc-skill .yc-key').forEach((s, i) => { s.textContent = k.skills[i] ?? ''; });
    const u = this.root.querySelector('.yc-summon .yc-key');
    if (u) u.textContent = k.ult;
    if (this.viewShown) this.setView(this.viewShown.split('|')[0], true);
  }

  /** 声音开关画成开着还是关着；toggle 给了就换成点它时调的 @param {boolean} muted @param {() => void} [toggle] */
  setMuted(muted, toggle) {
    if (toggle) this.onMute = toggle;
    const waves = muted ? 'M16 9l5 6M21 9l-5 6' : 'M16 8.5a4.5 4.5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12';
    this.mute.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>`
      + `<path d="${waves}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    this.mute.classList.toggle('off', muted);
    this.mute.title = muted ? '打开声音' : '关掉声音';
    this.mute.setAttribute('aria-label', this.mute.title);
  }

  dispose() { clearTimeout(this.cardTimer); clearTimeout(this.bigTimer); this.root.remove(); }
}

/** 三选一卡面的颜色（不带元素的卡按种类；紫色只给敌人，这里不用） @type {Record<string, string>} */
const KIND_COLOR = { 招式字: '#4a74d9', 字诀: '#2a8a7a', 心法: '#b06d00', 领悟: '#c9a03a' };

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
