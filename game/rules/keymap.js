// @ts-check
/**
 * 试炼的电脑键位（设计文档第 4 节"10-30 改：键位与设置"）：动作 → 按键（KeyboardEvent.code）。
 * 默认是本人定的 Shift 闪避、Q / E / R 三招、V 大招、B 切视角；设置里可以改，存在这台设备的浏览器里。
 * 走位（WASD、方向键）、Esc（设置）、回车（开战）、`（调试）不让占；Ctrl、Alt、Win 也不让占（按住它再按 W 会关掉网页之类）。
 * 守关要打字，不走这套，照旧用数字 1～4。
 */

export const ACTIONS = /** @type {const} */ (['dash', 'skill1', 'skill2', 'skill3', 'ult', 'view']);
/** @typedef {typeof ACTIONS[number]} Action */
/** @typedef {Record<Action, string>} KeyMap */

/** @type {Record<Action, string>} */
export const ACTION_NAMES = { dash: '闪避', skill1: '第一招', skill2: '第二招', skill3: '第三招', ult: '大招（召龙）', view: '切换视角' };

/** @type {KeyMap} */
export const DEFAULT_KEYS = { dash: 'ShiftLeft', skill1: 'KeyQ', skill2: 'KeyE', skill3: 'KeyR', ult: 'KeyV', view: 'KeyB' };

/** 走位键：不让占 */
const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
/** 能占的键：字母、数字、小键盘、空格、Shift、Caps Lock 和几个标点（方向键、功能键、Ctrl / Alt / Win、Tab、Esc、回车都不在里面） */
const BINDABLE = /^(Key[A-Z]|Digit\d|Numpad(\d|Add|Subtract|Multiply|Divide|Decimal)|Space|ShiftLeft|CapsLock|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash)$/;

/** 左右两个 Shift 当一个键 @param {string} code */
export function normCode(code) { return code === 'ShiftRight' ? 'ShiftLeft' : code; }

/** 这个键能不能拿来绑动作 @param {string} code */
export function bindable(code) { const c = normCode(code); return BINDABLE.test(c) && !MOVE.has(c); }

/**
 * 读存下来的键位：认不出、不能绑的那一项用默认的；读出来有两个动作撞了同一个键，整套回默认（不猜哪个是对的）
 * @param {string | null} s @returns {KeyMap}
 */
export function readKeys(s) {
  let o = null;
  try { o = s ? JSON.parse(s) : null; } catch { o = null; }
  const keys = { ...DEFAULT_KEYS };
  if (o && typeof o === 'object') for (const a of ACTIONS) if (typeof o[a] === 'string' && bindable(o[a])) keys[a] = normCode(o[a]);
  return new Set(Object.values(keys)).size === ACTIONS.length ? keys : { ...DEFAULT_KEYS };
}

/**
 * 把 action 改绑到 code：不能绑的键返回 null；这个键原来是别的动作的，两个动作互换（不会出现一个键管两件事、或者哪个动作没了键）
 * @param {KeyMap} keys @param {Action} action @param {string} code @returns {KeyMap | null}
 */
export function bindKey(keys, action, code) {
  if (!bindable(code)) return null;
  const c = normCode(code), next = { ...keys };
  const other = ACTIONS.find((a) => a !== action && keys[a] === c);
  if (other) next[other] = keys[action];
  next[action] = c;
  return next;
}

/** 按下的键是哪个动作（没绑就是 null；数字 1～4 没被占时调用方另按老规矩处理） @param {KeyMap} keys @param {string} code @returns {Action | null} */
export function actionOf(keys, code) {
  const c = normCode(code);
  return ACTIONS.find((a) => keys[a] === c) ?? null;
}

/** 画在按钮上、写在提示里的键名 @param {string} code */
export function keyLabel(code) {
  const c = normCode(code);
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^Numpad\d$/.test(c)) return `小键盘${c.slice(6)}`;
  return /** @type {Record<string, string>} */ ({
    ShiftLeft: 'Shift', Space: '空格', CapsLock: 'Caps', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', NumpadAdd: '小键盘+', NumpadSubtract: '小键盘-',
    NumpadMultiply: '小键盘*', NumpadDivide: '小键盘/', NumpadDecimal: '小键盘.',
  })[c] ?? c;
}
