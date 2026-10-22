// @ts-check
/**
 * 特效试验场的面板（地址加 ?lab，或调试接口 demo.lab()）：
 * 挑元素、形态、颗数、轨迹、威力、气势放一发；招牌特效一键放；放慢、定格、锁定压暗、切画质档，逐个看、逐个改。
 * 只是一层按钮，放法术走的是游戏本身的流程（main.js labCast），看到的就是玩家会看到的。
 */

const CSS = `
.yc-lab{position:absolute;top:10px;right:10px;width:300px;max-height:calc(100% - 20px);overflow:auto;z-index:30;
  background:rgba(14,18,26,.86);color:#e8edf5;border-radius:10px;padding:10px 12px;font:13px/1.5 system-ui,"PingFang SC","Microsoft YaHei",sans-serif;
  box-shadow:0 6px 24px rgba(0,0,0,.35);backdrop-filter:blur(6px)}
.yc-lab h3{margin:0 0 6px;font-size:14px;display:flex;justify-content:space-between;align-items:center}
.yc-lab .row{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:4px 0}
.yc-lab .row>span{width:34px;color:#9fb0c5;flex:none}
.yc-lab button{border:1px solid #3a4658;background:#1d2533;color:#e8edf5;border-radius:6px;padding:3px 8px;font:inherit;cursor:pointer}
.yc-lab button.on{background:#3d6fe0;border-color:#6d93ff}
.yc-lab button.go{width:100%;padding:7px;margin:6px 0;background:#c2552a;border-color:#e98a5e;font-weight:600}
.yc-lab .st{margin-top:6px;color:#9fb0c5;font-size:12px;white-space:pre-line}
.yc-lab.min>*:not(h3){display:none}
@media (max-width:700px){.yc-lab{top:auto;bottom:0;right:0;left:0;width:auto;max-height:46%;border-radius:10px 10px 0 0}}
`;

/** @type {[string, string][]} */
const ELS = [['fire', '火'], ['ice', '冰'], ['wind', '风'], ['earth', '土'], ['thunder', '雷']];
/** @type {[string, string][]} */
const FORMS = [['bolt', '弹'], ['burst', '爆'], ['wall', '墙'], ['rain', '雨']];
/** @type {[string, string][]} */
const PATHS = [['straight', '直线'], ['sky', '天降'], ['behind', '绕后']];

/** 招牌特效：直接给模型格式的原始意图（见 rules/intent.js），走同一套清洗与裁决 */
export const LAB_PRESETS = [
  ['火卷风', { s: [{ e: 'wind', f: 'burst', t: 'densest' }, { e: 'fire', f: 'bolt', t: 'densest' }], m: 2 }],
  ['烈焰冲击', { s: [{ e: 'fire', f: 'bolt', t: 'front' }, { e: 'wind', f: 'burst', t: 'front' }], m: 2 }],
  ['蒸汽爆', { s: [{ e: 'ice', f: 'bolt', t: 'front' }, { e: 'fire', f: 'bolt', t: 'front' }], m: 1 }],
  ['碎冰', { s: [{ e: 'ice', f: 'bolt', t: 'front' }, { e: 'wind', f: 'bolt', t: 'front' }], m: 1 }],
  ['导电', { s: [{ e: 'ice', f: 'burst', t: 'densest' }, { e: 'thunder', f: 'bolt', t: 'densest' }], m: 1 }],
  ['召唤冰龙', { s: [], c: 'ice', m: 3 }],
  ['法则反噬', { s: [{ e: 'fire', f: 'bolt', t: 'front', p: 5 }], o: true }],
];

/**
 * @param {HTMLElement} root
 * @param {{
 *   cast: (raw: object, label: string) => void, speed: (s: number) => void, dim: (v: number) => void,
 *   targets: () => void, clear: () => void, quality: string,
 * }} api
 */
export function mountLab(root, api) {
  if (!document.getElementById('yc-lab-css')) {
    const st = document.createElement('style');
    st.id = 'yc-lab-css';
    st.textContent = CSS;
    document.head.append(st);
  }
  const sel = { el: 'fire', f: 'burst', n: 1, r: 'straight', p: 3, m: 2 };
  const el = document.createElement('div');
  el.className = 'yc-lab';
  /** 一排单选按钮 @param {string} label @param {[any, string][]} opts @param {() => any} get @param {(v: any) => void} set */
  const radio = (label, opts, get, set) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span>${label}</span>`;
    const btns = opts.map(([v, text]) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.onclick = () => { set(v); btns.forEach((x, i) => x.classList.toggle('on', opts[i][0] === get())); };
      b.classList.toggle('on', v === get());
      row.append(b);
      return b;
    });
    el.append(row);
  };
  const head = document.createElement('h3');
  head.innerHTML = `<span>特效试验场 · ${api.quality === 'cinema' ? '电影档' : '流畅档'}</span>`;
  const fold = document.createElement('button');
  fold.textContent = '收起';
  fold.onclick = () => { el.classList.toggle('min'); fold.textContent = el.classList.contains('min') ? '展开' : '收起'; };
  head.append(fold);
  el.append(head);

  radio('元素', ELS, () => sel.el, (v) => { sel.el = v; });
  radio('形态', FORMS, () => sel.f, (v) => { sel.f = v; });
  radio('颗数', [[1, '1'], [2, '2'], [3, '3']], () => sel.n, (v) => { sel.n = v; });
  radio('轨迹', PATHS, () => sel.r, (v) => { sel.r = v; });
  radio('威力', [1, 2, 3, 4, 5].map((v) => [v, String(v)]), () => sel.p, (v) => { sel.p = v; });
  radio('气势', [0, 1, 2, 3].map((v) => [v, String(v)]), () => sel.m, (v) => { sel.m = v; });

  const go = document.createElement('button');
  go.className = 'go';
  go.textContent = '放 出';
  go.onclick = () => {
    const name = ELS.find((x) => x[0] === sel.el)?.[1] + (FORMS.find((x) => x[0] === sel.f)?.[1] || '');
    api.cast({ s: [{ e: sel.el, f: sel.f, t: sel.f === 'wall' ? 'center' : 'densest', p: sel.p, n: sel.n, r: sel.r }], m: sel.m }, `试验·${name}`);
  };
  el.append(go);

  const presets = document.createElement('div');
  presets.className = 'row';
  presets.innerHTML = '<span>招牌</span>';
  for (const [label, raw] of LAB_PRESETS) {
    const b = document.createElement('button');
    b.textContent = /** @type {string} */ (label);
    b.onclick = () => api.cast(/** @type {object} */ (raw), `试验·${label}`);
    presets.append(b);
  }
  el.append(presets);

  let speed = 1;
  radio('时间', [[1, '×1'], [0.5, '×0.5'], [0.25, '×0.25'], [0.1, '×0.1'], [0, '定格']], () => speed, (v) => { speed = v; api.speed(v); });
  let dim = -1;
  radio('压暗', [[-1, '自动'], [0, '不压'], [0.5, '一半'], [0.85, '压满']], () => dim, (v) => { dim = v; api.dim(v); });
  if (/^https?:$/.test(location.protocol)) {
    radio('画质', [['cinema', '电影档'], ['smooth', '流畅档']], () => api.quality, (v) => {
      const u = new URL(location.href);
      u.searchParams.set('q', v);
      u.searchParams.set('lab', '1');
      location.href = u.toString();
    });
  }
  const tg = document.createElement('div');
  tg.className = 'row';
  tg.innerHTML = '<span>靶子</span>';
  const more = document.createElement('button');
  more.textContent = '放一排';
  more.onclick = () => api.targets();
  const clr = document.createElement('button');
  clr.textContent = '清场';
  clr.onclick = () => api.clear();
  tg.append(more, clr);
  el.append(tg);

  const status = document.createElement('div');
  status.className = 'st';
  el.append(status);
  root.append(el);
  return {
    el,
    /** @param {string} text */
    setStatus(text) { status.textContent = text; },
  };
}
