// 声音（game/fx/sound.js）：五声音阶的频率、旋律不出音域且收尾落主音；每个配方、每种背景乐在假的音频环境里跑一遍，
// 查排的时间与数值（往 0 指数滑在浏览器里直接报错）、一次建多少个节点；代码里点到的音效名都有配方，配方也都有人用
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { Kit, MOODS, RECIPES, beat, nextDegree, pentaHz } from '../game/fx/sound.js';

/** 假的音频环境：只记账、查数 */
function fakeCtx() {
  const bad = [];
  let nodes = 0;
  const ok = (v, t, what) => { if (!Number.isFinite(v) || !Number.isFinite(t) || t < 0) bad.push(`${what}(${v}, ${t})`); };
  const param = () => ({
    value: 0,
    setValueAtTime(v, t) { ok(v, t, 'set'); },
    linearRampToValueAtTime(v, t) { ok(v, t, 'linear'); },
    exponentialRampToValueAtTime(v, t) { ok(v, t, 'exp'); if (!(v > 0)) bad.push(`exp 到 ${v}`); },
    setTargetAtTime(v, t) { ok(v, t, 'target'); },
  });
  const node = () => {
    nodes++;
    let t0 = -1;
    return {
      gain: param(), frequency: param(), detune: param(), Q: param(), type: '', buffer: null, loop: false,
      connect: (n) => n, setPeriodicWave() {},
      start(t, off = 0) { ok(t, off, 'start'); t0 = t; },
      stop(t) { ok(t, 0, 'stop'); if (t < t0) bad.push(`stop ${t} 早于 start ${t0}`); },
    };
  };
  const ctx = {
    sampleRate: 8000, currentTime: 0,
    createGain: node, createOscillator: node, createBiquadFilter: node, createBufferSource: node,
    createBuffer: (ch, n) => ({ duration: n / 8000, getChannelData: () => new Float32Array(n) }),
    createPeriodicWave: () => ({}),
  };
  return { ctx, bad, count: () => nodes };
}

test('五声音阶：宫是 D3，五级一个八度，往下也对', () => {
  assert.ok(Math.abs(pentaHz(0) - 146.83) < 0.01);
  assert.ok(Math.abs(pentaHz(5) - 2 * pentaHz(0)) < 0.01);
  assert.ok(Math.abs(pentaHz(3) - 220) < 0.1);       // 徵 = A3
  assert.ok(Math.abs(pentaHz(-1) - 123.47) < 0.05);  // 羽 = B2
  for (let i = -10; i < 20; i++) assert.ok(pentaHz(i + 1) > pentaHz(i));
});

test('旋律不出音域；收尾落在最近的主音上（宫调落宫，boss 的羽调落羽）', () => {
  for (const m of Object.values(MOODS)) {
    let deg = Math.round((m.low + m.high) / 2);
    for (let i = 0; i < 3000; i++) {
      deg = nextDegree(deg, m, Math.random(), Math.random(), false);
      assert.ok(deg >= m.low && deg <= m.high, `${deg} 出了 ${m.low}～${m.high}`);
    }
    for (let d = m.low; d <= m.high; d++) {
      const c = nextDegree(d, m, Math.random(), Math.random(), true);
      assert.equal((((c - m.home) % 5) + 5) % 5, 0);
      assert.ok(Math.abs(c - d) <= 3, `从 ${d} 收到 ${c}，跳太远`);
    }
  }
});

test('每个配方：时间、数值都合法，响完的时刻在 6 秒内，一次最多建 160 个节点', () => {
  const opts = [{}, { scale: 0.3 }, { scale: 2 }, { short: true }, { flame: true }, { phase: 3 },
    ...['fire', 'ice', 'wind', 'thunder', 'earth', 'arcane', 'enemy', 'nope'].map((el) => ({ el, scale: 1 })),
    ...['boss', 'stone', 'flame'].map((type) => ({ type, phase: 1 }))];
  for (const [name, r] of Object.entries(RECIPES)) {
    for (const o of opts) {
      const f = fakeCtx(), k = new Kit(/** @type {any} */ (f.ctx), /** @type {any} */ ({})), base = f.count();
      const end = r(k, 1, o);
      assert.deepEqual(f.bad, [], `${name} ${JSON.stringify(o)}`);
      assert.ok(Number.isFinite(end) && end > 1 && end < 7, `${name} 响到 ${end}`);
      assert.ok(f.count() - base <= 160, `${name} 建了 ${f.count() - base} 个节点`);
    }
  }
});

test('背景乐：三种各排 8 小节，数值合法；鼓谱落在一小节的 16 格里', () => {
  for (const [name, m] of Object.entries(MOODS)) {
    const f = fakeCtx(), k = new Kit(/** @type {any} */ (f.ctx), /** @type {any} */ ({})), st = { deg: 9 };
    for (let i = 0; i < 128; i++) beat(k, /** @type {any} */ ({}), m, i, 1 + (i * 15) / m.bpm, st);
    assert.deepEqual(f.bad, [], name);
    for (const s of [...m.kick, ...m.block]) assert.ok(s >= 0 && s < 16);
  }
});

test('代码里点到的音效名都有配方，配方也都有地方用', () => {
  /** @param {string} dir @returns {string[]} */
  const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });
  const used = new Set();
  for (const f of walk('game')) for (const m of readFileSync(f, 'utf8').matchAll(/sound\??\.play\('(\w+)'/g)) used.add(m[1]);
  for (const m of readFileSync('game/fx/sound.js', 'utf8').matchAll(/RECIPES\.(\w+)\(/g)) used.add(m[1]);   // 配方之间互相借的（雷的放出借 zap）
  for (const n of used) assert.ok(n in RECIPES, `没有配方：${n}`);
  for (const n of Object.keys(RECIPES)) assert.ok(used.has(n), `配方没人用：${n}`);
});
