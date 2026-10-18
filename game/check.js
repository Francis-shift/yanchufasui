// @ts-check
/**
 * 手机检查页：在真游戏场景里自动跑三段负载，量帧率，给出物理引擎要不要换的结论（设计文档第 9 节：低于 45 帧再重议）。
 * 解析只走关键词，不连接口，不花调用额度。
 *   第 1 段 静止场景 → 第 2 段 12 个傀儡 + 连续施法 → 第 3 段 再撒 300 个物理方块
 * 每段前 1 秒不计（等画面稳定）；"卡顿时"取最慢 5% 帧的帧率。
 */
import { start } from './main.js';

const PHASES = [
  { name: '静止场景', sec: 8, battle: false, cubes: 0 },
  { name: '12 个傀儡 + 连续施法', sec: 15, battle: true, cubes: 0 },
  { name: '再加 300 个物理方块', sec: 12, battle: true, cubes: 300 },
];
const SPELLS = ['火球打最前面那只', '冰爆炸最密集的地方', '风爆把左边的吹下去', '三颗火弹从天而降', '冰锥打右边'];
const ENEMY_TARGET = 12;
const PASS_FPS = 45;
const WARMUP_SEC = 1;

/**
 * @param {HTMLElement} root
 * @returns {() => void}
 */
export function startCheck(root) {
  const disposeGame = start(root, {});
  const demo = /** @type {any} */ (window).demo;

  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;'
    + 'background:rgba(16,24,36,.55);font:15px/1.6 system-ui,sans-serif;color:#16202b;padding:16px;box-sizing:border-box';
  const card = document.createElement('div');
  card.style.cssText = 'background:#f7f4ee;border-radius:12px;padding:18px 20px;max-width:440px;width:100%;'
    + 'max-height:100%;overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,.25)';
  panel.append(card);
  root.append(panel);

  const status = document.createElement('div');
  status.style.cssText = 'position:absolute;left:12px;bottom:110px;z-index:50;background:rgba(247,244,238,.92);border-radius:8px;'
    + 'padding:6px 10px;font:14px system-ui,sans-serif;color:#16202b;display:none';
  root.append(status);

  const btn = (label, onClick) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'margin:12px 8px 0 0;padding:10px 18px;font-size:15px;border:0;border-radius:8px;background:#2f5d8a;color:#fff';
    b.addEventListener('click', onClick);
    return b;
  };

  function showIntro() {
    card.innerHTML = '<h2 style="margin:0 0 8px;font-size:19px">言出法随 · 手机检查</h2>'
      + '<p style="margin:0">点下面的按钮后会自动跑三段，共约 40 秒：静止场景、12 个傀儡加连续施法、再加 300 个物理方块。'
      + '期间<b>不要切出页面、不要锁屏</b>。跑完会出结果，截图发回来就行。</p>';
    card.append(btn('开始检测', run));
    panel.style.display = 'flex';
  }

  /** @type {{ name: string, avg: number, low: number, calls: number, tris: number }[]} */
  let results = [];
  let stopped = false;
  let raf = 0;
  /** @type {number[]} */
  let timers = [];

  async function run() {
    panel.style.display = 'none';
    status.style.display = 'block';
    results = [];
    demo.start();
    demo.endless(true);
    /** @type {any} */ (document.activeElement)?.blur?.();   // 别让手机键盘弹出来挤小画面
    for (const ph of PHASES) {
      if (stopped) return;
      results.push(await measure(ph));
    }
    demo.endless(false);
    showResult();
  }

  /** @param {typeof PHASES[number]} ph */
  function measure(ph) {
    return new Promise((resolve) => {
      /** @type {number[]} */
      const gaps = [];
      let calls = 0, tris = 0, n = 0, spell = 0, path = 0;
      const t0 = performance.now();
      let last = t0;
      if (ph.cubes) demo.cubes(ph.cubes, ph.sec + 2);
      const keep = () => {
        demo.refill();
        if (!ph.battle) return;
        const alive = demo.state().enemies.length;
        for (let i = alive; i < ENEMY_TARGET; i++) demo.spawn('grunt', path++ % 2);
      };
      keep();
      timers.push(window.setInterval(keep, 1000));
      if (ph.battle) timers.push(window.setInterval(() => { demo.cast(SPELLS[spell++ % SPELLS.length]); }, 1500));
      const tick = () => {
        const now = performance.now();
        const el = (now - t0) / 1000;
        if (el > WARMUP_SEC) {
          gaps.push(now - last);
          const g = demo.gl(); calls += g.calls; tris += g.tris; n++;
        }
        last = now;
        status.textContent = `第 ${results.length + 1}/3 段：${ph.name}　${Math.max(0, ph.sec - el).toFixed(0)} 秒`;
        if (el < ph.sec) { raf = requestAnimationFrame(tick); return; }
        timers.forEach((t) => clearInterval(t)); timers = [];
        const sum = gaps.reduce((a, b) => a + b, 0);
        const sorted = [...gaps].sort((a, b) => a - b);
        const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1000;
        resolve({ name: ph.name, avg: gaps.length / (sum / 1000), low: 1000 / p95, calls: Math.round(calls / (n || 1)), tris: Math.round(tris / (n || 1)) });
      };
      raf = requestAnimationFrame(tick);
    });
  }

  function gpuName() {
    try {
      const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
      if (!gl) return '无 WebGL';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    } catch { return '读不到'; }
  }

  function showResult() {
    status.style.display = 'none';
    const g = demo.gl();
    // 分段判断瓶颈在哪：静止就慢 → 画面；加傀儡和施法才慢 → 特效与敌人；加方块才慢 → 物理
    const [idle, battle, phys] = results.map((r) => Math.round(r.avg));
    const pass = phys >= PASS_FPS;
    const verdict = pass ? `通过：最重的一段平均 ${phys} 帧（≥ ${PASS_FPS}），物理引擎不用换。`
      : idle < PASS_FPS ? `静止场景就只有 ${idle} 帧：瓶颈在画面，不在物理。要加一档更低的手机画质，物理引擎先不换。`
      : battle < PASS_FPS ? `傀儡加施法时降到 ${battle} 帧：瓶颈在特效和敌人，要降粒子和泛光，物理引擎先不换。`
      : `加了 300 个物理方块才降到 ${phys} 帧：瓶颈在物理，按设计文档重议物理引擎。`;
    const ua = navigator.userAgent;
    const wechat = /MicroMessenger/i.test(ua);
    const rows = results.map((r) => `<tr><td>${r.name}</td><td>${r.avg.toFixed(0)}</td><td>${r.low.toFixed(0)}</td><td>${r.calls}</td></tr>`).join('');
    card.innerHTML = '<h2 style="margin:0 0 8px;font-size:19px">检测结果</h2>'
      + `<p style="margin:0 0 8px;font-weight:600;color:${pass ? '#2c6e3f' : '#b3261e'}">`
      + verdict + '</p>'
      + '<table style="width:100%;border-collapse:collapse;font-size:14px" border="1" cellpadding="4">'
      + '<tr><th>段</th><th>平均帧率</th><th>卡顿时</th><th>每帧绘制</th></tr>' + rows + '</table>'
      + '<p style="margin:10px 0 0;font-size:13px;color:#4a5866">'
      + `浏览器：${wechat ? '微信内置' : '普通浏览器'}<br>屏幕：${innerWidth}×${innerHeight}，像素比 ${devicePixelRatio}，渲染 ${g.size.join('×')}（×${g.ratio}）<br>`
      + `显卡：${gpuName()}<br>画质档：${g.mobile ? '手机' : '电脑'}<br><span style="word-break:break-all">${ua}</span></p>`
      + '<p style="margin:10px 0 0"><b>还有一步：</b>点"试打字"，用手机键盘输入"冰锥打右边"再点回车，看两件事：输入框会不会被键盘挡住、咒语卡能不能出来。也截一张图。</p>';
    card.append(btn('试打字', tryTyping), btn('再测一次', run));
    panel.style.display = 'flex';
  }

  function tryTyping() {
    panel.style.display = 'none';
    demo.refill();
    const input = /** @type {HTMLInputElement | null} */ (root.querySelector('input, textarea'));
    input?.focus();
  }

  showIntro();
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    timers.forEach((t) => clearInterval(t));
    panel.remove(); status.remove();
    disposeGame();
  };
}
