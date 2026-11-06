// @ts-check
/**
 * 咒语图鉴的纸面板（格子和规则在 rules/book.js，样子跟设置面板一套）：亮的写名字，没亮的写"？"。
 * 点一格，底下那行写第一次怎么念的；没亮的写怎么点亮。玩家的原话只走 textContent。
 */
import { BOOK, BOOK_TOTAL } from '../rules/book.js';
import { BRUSH } from './hud.js';

const CSS = `
.yc-book-box { width: min(820px, calc(100% - 24px)); }
.yc-book-box .yc-set-title small { margin-left: 12px; font: 15px/1 "STKaiti", "KaiTi", "Kaiti SC", serif; letter-spacing: 1px; color: #6a5c4b; }
.yc-book-main { display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px; }
.yc-book-sec { margin-top: 10px; font-size: 13px; letter-spacing: 2px; color: #6a5c4b; }
.yc-book-grid { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 4px; margin-top: 4px; }
.yc-book-cell { min-width: 0; padding: 3px 0 2px; border: 1px solid rgba(52,40,28,0.32); border-radius: 3px; background: rgba(179,38,30,0.07);
  font: 18px/1.25 ${BRUSH}; color: #15110d; white-space: nowrap; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.yc-book-cell.off { border-style: dashed; background: none; color: rgba(52,40,28,0.38); }
.yc-book-cell.sel { border-color: #8a2a10; box-shadow: inset 0 0 0 1px #8a2a10; }
.yc-book-note { margin: 12px 0 0; min-height: 3.2em; font-size: 15px; line-height: 1.6; color: #3a3026; text-align: center; overflow-wrap: anywhere; }
.yc-book-note b { font: normal 20px/1.3 ${BRUSH}; margin-right: 8px; color: #15110d; }
.yc-book-box .yc-set-btns { margin-top: 6px; }
.yc-narrow .yc-book-main { grid-template-columns: 1fr; }
.yc-short .yc-book-sec { margin-top: 5px; } .yc-short .yc-book-cell { font-size: 15px; padding: 1px 0; } .yc-short .yc-book-note { margin-top: 6px; min-height: 2em; }
`;

export class BookPanel {
  /** @param {HTMLElement} root */
  constructor(root) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    const secs = BOOK.map((s) => `<div class="yc-book-sec">${s.title}</div><div class="yc-book-grid" style="--n:${s.n}">`
      + s.cells.map((c) => `<button type="button" class="yc-book-cell" data-k="${c.key}"></button>`).join('') + '</div>');
    this.el = document.createElement('div');
    this.el.className = 'yc-set';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', '咒语图鉴');
    this.el.innerHTML = `<div class="yc-set-box yc-book-box yc-paper"><div class="yc-set-title">咒语图鉴<small></small></div>
      <div class="yc-book-main"><div>${secs[0]}</div><div>${secs.slice(1).join('')}</div></div>
      <p class="yc-book-note"></p><div class="yc-set-btns"><button class="yc-ink" data-close><b>合上</b></button></div></div>`;
    root.append(this.el);
    /** @type {Record<string, string>} */
    this.book = {};
    this.note = /** @type {HTMLElement} */ (this.el.querySelector('.yc-book-note'));
    /** @param {KeyboardEvent} e */
    this.onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); } };
    this.el.addEventListener('click', (e) => {
      const t = /** @type {HTMLElement} */ (e.target), cell = t.closest('[data-k]');
      if (cell) this.pick(/** @type {HTMLElement} */ (cell));
      else if (t === this.el || t.closest('[data-close]')) this.close();
    });
  }

  /** @param {Record<string, string>} book */
  open(book) {
    this.book = book;
    const lit = BOOK.flatMap((s) => s.cells).filter((c) => Object.hasOwn(book, c.key)).length;
    /** @type {HTMLElement} */ (this.el.querySelector('small')).textContent = `${lit} / ${BOOK_TOTAL}`;
    for (const b of this.el.querySelectorAll('[data-k]')) {
      const c = BOOK.flatMap((s) => s.cells).find((x) => x.key === /** @type {HTMLElement} */ (b).dataset.k), on = Object.hasOwn(book, c?.key ?? '');
      b.textContent = on ? (c?.name ?? '') : '？';
      b.classList.toggle('off', !on);
      b.classList.remove('sel');
    }
    this.note.textContent = lit ? '点一格，看看第一次是怎么念的' : '一格还没亮。念出一个新法术，就亮一格';
    this.el.hidden = false;
    document.addEventListener('keydown', this.onKey, true);
  }

  close() {
    this.el.hidden = true;
    document.removeEventListener('keydown', this.onKey, true);
  }

  /** @param {HTMLElement} b */
  pick(b) {
    for (const x of this.el.querySelectorAll('.sel')) x.classList.remove('sel');
    b.classList.add('sel');
    const c = BOOK.flatMap((s) => s.cells).find((x) => x.key === b.dataset.k);
    if (!c) return;
    const on = Object.hasOwn(this.book, c.key), said = this.book[c.key];
    const name = document.createElement('b');
    name.textContent = on ? c.name : '还没亮';
    this.note.replaceChildren(name, on ? (said ? `第一次这样念：「${said}」` : '第一次是按钮放出来的') : c.hint);
  }
}
