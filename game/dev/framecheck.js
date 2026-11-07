// @ts-check
/**
 * 画框检查页（只给本机预览面板用）：python tools/build_preview.py frames --asset public/frame/left.webp ...（素材一张张列出来，再加一张当背景的 scene.webp）。
 * 笔触和立绘塞进游戏页会超过面板 512 KB 的上限，所以只摆一张景、一个画框，看三级画框、化身那一圈、收束那一笔长什么样。游戏本身不引用这个文件。
 * 调试接口 window.fc：show(级别, 字, 元素, 技能图)、aura(元素)、slash(元素)、clear()、ready。技能图太大，一次只塞几张（--asset skill-ice.webp），没塞的退回立绘。
 */
import { FRAME_CSS, FRAME_GLOW, ScreenFrame } from '../ui/frame.js';

/** @param {HTMLElement} root @param {Record<string, string>} assets 文件名 → 地址 */
export function startFrameCheck(root, assets) {
  const style = document.createElement('style');
  style.textContent = `${FRAME_CSS} html, body, #app { margin: 0; height: 100%; overflow: hidden; background: #6d7480; }`;
  document.head.append(style);
  root.style.cssText = `position: relative; width: 100%; height: 100%; overflow: hidden; background: url("${assets['scene.webp']}") center / cover;`;
  const f = new ScreenFrame(root, '"STKaiti", "KaiTi", serif', (n) => assets[`${n}.webp`]);
  /** @type {any} */ (window).fc = {
    ready: f.ready, f,
    /** @param {'small' | 'mid' | 'large'} level @param {string} text @param {string} el @param {string} [skill] */
    show: (level, text, el, skill) => f.show(level, { text, color: FRAME_GLOW[el], skill }),
    /** @param {string} [el] */
    aura: (el) => f.aura(el && FRAME_GLOW[el]),
    /** @param {string} el */
    slash: (el) => f.slash(FRAME_GLOW[el]),
    clear: () => f.clear(),
  };
}
