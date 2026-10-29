// @ts-check
/**
 * 声音：在浏览器里现场合成（Web Audio）；只有召龙的龙吟是一段现成录音（SAMPLES，第一次出声后才下载，没到之前用合成的顶上）。
 *   - 音效 play(名字, 参数)：配方在 RECIPES；同名的太密就丢掉（GAP），同时最多响 MAX_VOICES 个；
 *   - 背景乐 mood('calm' | 'battle' | 'boss' | null)：五声音阶现场生成——拨弦（像古筝）、笛子长音、低音铺底、堂鼓、梆子、锣；
 *   - duck(on)：玩家说话（录音）时把游戏声压低；setMuted(on)：静音，记在本机。
 * 浏览器要等玩家第一次点击或按键才肯出声（unlock）。音量、音色是按数值定的，好不好听要人来听。
 */

/** 同时响的音效最多几个（再多就丢掉新的） */
export const MAX_VOICES = 28;
/** 同名音效（同一元素）至少隔几秒；没写的 0.03 @type {Record<string, number>} */
export const GAP = { boom: 0.045, zap: 0.07, fly: 0.08, shatter: 0.05, spit: 0.12, warn: 0.3, hurt: 0.15, crack: 0.12, cast: 0.06 };
/** 五声音阶（D 宫）：宫商角徵羽比宫高几个半音 */
const PENTA = [0, 2, 4, 7, 9];
const ROOT = 146.83;   // D3
/** 五声音阶第 i 级的频率（每 5 级一个八度；0 是 D3 的宫，负数往下） @param {number} i */
export const pentaHz = (i) => { const o = Math.floor(i / 5); return ROOT * 2 ** (o + PENTA[i - o * 5] / 12); };
const rnd = (/** @type {number} */ a, /** @type {number} */ b) => a + Math.random() * (b - a);

/**
 * 三种背景乐（16 格一小节）：拍速、旋律疏密、音域（第几级到第几级）、主音（0 宫调，4 羽调）、低音每小节走哪级、
 * 铺底长音（null 不铺）、笛子每小节出来的机会、拨弦余音长短、堂鼓与梆子落在哪几格
 * @typedef {{ bpm: number, dense: number, low: number, high: number, home: number, bass: number[], drone: number[] | null, flute: number,
 *   ring: number, kick: number[], block: number[] }} MoodSpec
 */
/** @type {Record<'calm' | 'battle' | 'boss', MoodSpec>} */
export const MOODS = {
  calm: { bpm: 66, dense: 0.3, low: 5, high: 15, home: 0, bass: [-5, -5, -3, -2], drone: [-5, -2], flute: 0.4, ring: 1.6, kick: [], block: [] },
  battle: { bpm: 92, dense: 0.5, low: 5, high: 15, home: 0, bass: [-5, -2, -3, -1], drone: null, flute: 0.12, ring: 0.9, kick: [0, 6, 8, 11], block: [4, 12, 14] },
  boss: { bpm: 108, dense: 0.55, low: 6, high: 16, home: 4, bass: [-1, -1, -3, -2], drone: [-6, -3], flute: 0, ring: 0.7, kick: [0, 3, 6, 8, 10, 11, 14], block: [4, 12] },
};

/**
 * 旋律的下一个音：多半走一两级、偶尔跳三级，离音域中间越远越容易往回走；乐句收尾落到离得最近的主音
 * @param {number} deg 现在第几级 @param {{ low: number, high: number, home: number }} m @param {number} r @param {number} r2 两个 0～1 的随机数
 * @param {boolean} cadence 乐句收尾 @returns {number}
 */
export function nextDegree(deg, m, r, r2, cadence) {
  if (cadence) {
    let best = m.low, bd = Infinity;
    for (let i = m.low; i <= m.high; i++) if ((((i - m.home) % 5) + 5) % 5 === 0 && Math.abs(i - deg) < bd) { best = i; bd = Math.abs(i - deg); }
    return best;
  }
  const STEPS = [-3, -2, -1, -1, 1, 1, 2, 3];
  let s = STEPS[Math.min(STEPS.length - 1, Math.floor(r * STEPS.length))];
  const pull = (deg - (m.low + m.high) / 2) / ((m.high - m.low) / 2);   // -1～1：偏高为正
  if (pull * s > 0 && r2 < Math.abs(pull)) s = -s;
  return Math.max(m.low, Math.min(m.high, deg + s));
}

/** 锣的泛音（不成整数倍，听着才是金属），与各自的响度 */
const GONG = [1, 1.47, 2.09, 2.76, 3.52], GONG_AMP = [1, 0.6, 0.45, 0.3, 0.2];

/**
 * 一套合成"乐器"：每个方法在 t 时刻排一个声音，返回它响完的时刻。p 是这次的音高微差（play 时随机，音乐里是 1）
 * @typedef {{ type?: OscillatorType, f: number, to?: number, glide?: number, dur: number, peak: number, a?: number, lp?: number }} ToneOpts
 * @typedef {{ filter?: BiquadFilterType, f: number, to?: number, q?: number, dur: number, peak: number, a?: number }} HissOpts
 */
export class Kit {
  /** @param {BaseAudioContext} ctx @param {AudioNode} out */
  constructor(ctx, out) {
    this.ctx = ctx; this.out = out; this.p = 1;
    const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = b;
    // 拨弦的音色：泛音按 1/n 往下掉、单数略强；亮不亮由每次的低通包络管
    const amp = [0, 1, 0.6, 0.38, 0.28, 0.16, 0.12, 0.06, 0.05, 0.03];
    this.wave = ctx.createPeriodicWave(new Float32Array(amp.length), Float32Array.from(amp));
    /** 下载、解码好的现成录音（名字见 SAMPLES） @type {Record<string, AudioBuffer>} */
    this.samples = {};
  }

  /** 现成录音：在 t 时刻原样放一遍（不随机变调），返回放完的时刻；还没加载好返回 0 @param {string} name @param {number} t @param {number} gain @param {AudioNode} [dest] */
  sample(name, t, gain, dest = this.out) {
    const b = this.samples[name];
    if (!b) return 0;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    s.buffer = b; g.gain.value = gain;
    s.connect(g).connect(dest);
    s.start(t);
    return t + b.duration;
  }

  /** 振荡器：f 滑到 to（glide 秒），a 秒起音后指数衰减 dur 秒；lp 给了就过一道低通 @param {number} t @param {ToneOpts} o @param {AudioNode} [dest] */
  tone(t, o, dest = this.out) {
    const c = this.ctx, osc = c.createOscillator(), g = c.createGain(), a = o.a ?? 0.004, end = t + a + o.dur;
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.to && o.to !== o.f) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide ?? a + o.dur));
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(o.peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, end);
    /** @type {AudioNode} */
    let n = osc;
    if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); n = f; }
    n.connect(g).connect(dest);
    osc.start(t); osc.stop(end + 0.05);
    return end;
  }

  /** 滤过的噪声（风声、爆炸、碎裂都是它）：滤波频率 f 滑到 to @param {number} t @param {HissOpts} o @param {AudioNode} [dest] */
  hiss(t, o, dest = this.out) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), a = o.a ?? 0.004, end = t + a + o.dur;
    s.buffer = this.noise; s.loop = true;
    f.type = o.filter ?? 'bandpass'; f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.f, t);
    if (o.to && o.to !== o.f) f.frequency.exponentialRampToValueAtTime(o.to, end);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(o.peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, end);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5); s.stop(end + 0.05);
    return end;
  }

  /** spread 秒里随机撒 n 下短促的噼啪（碎冰、碎石、火星） @param {number} t @param {number} n @param {number} spread @param {number} f0 @param {number} f1 @param {number} peak @param {number} [q] @param {AudioNode} [dest] */
  ticks(t, n, spread, f0, f1, peak, q = 5, dest = this.out) {
    let e = t;
    for (let i = 0; i < n; i++) e = Math.max(e, this.hiss(t + Math.random() * spread, { f: rnd(f0, f1), q, dur: rnd(0.02, 0.05), peak: peak * rnd(0.5, 1) }, dest));
    return e;
  }

  /** 编钟似的"叮"：三个不成整数倍的泛音，高的先散 @param {number} t @param {number} f @param {number} dur @param {number} vel @param {AudioNode} [dest] */
  bell(t, f, dur, vel, dest = this.out) {
    this.tone(t, { f, dur, peak: vel, a: 0.002 }, dest);
    this.tone(t, { f: f * 2.76, dur: dur * 0.45, peak: vel * 0.4, a: 0.002 }, dest);
    this.tone(t, { f: f * 5.4, dur: dur * 0.25, peak: vel * 0.15, a: 0.002 }, dest);
    return t + dur;
  }

  /** 锣：几个金属泛音一起往下沉一点，加一层沙沙的余响 @param {number} t @param {number} f @param {number} dur @param {number} vel @param {AudioNode} [dest] @param {number[]} [ratios] */
  gong(t, f, dur, vel, dest = this.out, ratios = GONG) {
    ratios.forEach((r, i) => this.tone(t, { f: f * r, to: f * r * 0.985, dur: dur * (1 - i * 0.14), peak: vel * (GONG_AMP[i] ?? 0.2), a: 0.006 }, dest));
    this.hiss(t, { f: 3200, q: 1.5, dur: dur * 0.45, peak: vel * 0.12, a: 0.01 }, dest);
    return t + dur;
  }

  /** 拨弦（像古筝）：拨下去先略高、马上回到本音，越响越闷 @param {number} t @param {number} f @param {number} vel @param {number} dur @param {AudioNode} [dest] */
  pluck(t, f, vel, dur, dest = this.out) {
    const c = this.ctx, o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
    o.setPeriodicWave(this.wave);
    o.frequency.setValueAtTime(f * 1.015, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    lp.type = 'lowpass'; lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(Math.min(10000, f * 14), t); lp.frequency.exponentialRampToValueAtTime(Math.max(250, f * 2), t + dur * 0.7);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
    return t + dur;
  }

  /** 铺底长音：两支微微走音的三角波，慢起慢收 @param {number} t @param {number} f @param {number} dur @param {number} vel @param {AudioNode} [dest] */
  pad(t, f, dur, vel, dest = this.out) {
    const c = this.ctx, g = c.createGain(), lp = c.createBiquadFilter(), a = Math.min(1.5, dur * 0.3);
    lp.type = 'lowpass'; lp.frequency.value = 900;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + a);
    g.gain.setValueAtTime(vel, t + dur - a); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    lp.connect(g).connect(dest);
    for (const det of [-4, 4]) {
      const o = c.createOscillator();
      o.type = 'triangle'; o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + dur + 0.05);
    }
    return t + dur;
  }

  /** 笛子长音：正弦加一点八度、慢慢起来的揉音，带气声 @param {number} t @param {number} f @param {number} dur @param {number} vel @param {AudioNode} [dest] */
  flute(t, f, dur, vel, dest = this.out) {
    const c = this.ctx, o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), g2 = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    o.frequency.value = f; o2.type = 'triangle'; o2.frequency.value = f * 2; g2.gain.value = 0.18;
    lfo.frequency.value = 5.2; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.012, t + dur * 0.5);
    lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + 0.12); g.gain.setValueAtTime(vel, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); o2.connect(g2).connect(g); g.connect(dest);
    for (const x of [o, o2, lfo]) { x.start(t); x.stop(t + dur + 0.05); }
    this.hiss(t, { f: f * 2, q: 2, dur: dur * 0.9, peak: vel * 0.25, a: 0.08 }, dest);
    return t + dur;
  }

  /** 堂鼓：音高往下掉的一声闷响，加鼓槌的一下 @param {number} t @param {number} vel @param {AudioNode} [dest] @param {number} [f] */
  drum(t, vel, dest = this.out, f = 130) {
    this.tone(t, { f: f * this.p, to: f * 0.42, glide: 0.12, dur: 0.38, peak: vel }, dest);
    this.hiss(t, { filter: 'lowpass', f: 1400, dur: 0.04, peak: vel * 0.5 }, dest);
    return t + 0.4;
  }

  /** 梆子：两个高音很短地"笃"一下 @param {number} t @param {number} vel @param {AudioNode} [dest] */
  block(t, vel, dest = this.out) {
    this.tone(t, { f: 1150, dur: 0.05, peak: vel }, dest);
    return this.tone(t, { f: 1750, dur: 0.03, peak: vel * 0.5 }, dest);
  }
}

/** 放出瞬间，按元素 @type {Record<string, (k: Kit, t: number) => number>} */
const CAST = {
  fire: (k, t) => Math.max(k.hiss(t, { f: 500 * k.p, to: 2400, q: 0.9, dur: 0.3, peak: 0.32, a: 0.03 }), k.tone(t, { f: 110 * k.p, to: 55, dur: 0.22, peak: 0.3 })),
  ice: (k, t) => Math.max(k.hiss(t, { filter: 'highpass', f: 6000, dur: 0.22, peak: 0.1 }),
    ...[0, 1, 2].map((i) => k.bell(t + i * 0.025, pentaHz(15 + i * 2) * k.p, 0.5, 0.07))),
  wind: (k, t) => k.hiss(t, { f: 300 * k.p, to: 1500, q: 2.5, dur: 0.38, peak: 0.65, a: 0.1 }),   // 窄带噪声量出来比火小一截（离线实测），抬高
  thunder: (k, t) => Math.max(RECIPES.zap(k, t, {}), k.tone(t, { type: 'square', f: 80, to: 40, dur: 0.12, peak: 0.06, lp: 900 })),
  earth: (k, t) => Math.max(k.tone(t, { f: 75 * k.p, to: 38, dur: 0.36, peak: 0.45 }), k.hiss(t, { filter: 'lowpass', f: 500, to: 120, dur: 0.32, peak: 0.36 })),
  arcane: (k, t) => k.bell(t, pentaHz(12) * k.p, 0.7, 0.12),
};

/** 落点炸开，按元素；s 是特效的规模（小命中 0.45，大招 1.6），v 由它定响度 @type {Record<string, (k: Kit, t: number, s: number, v: number) => number>} */
const BOOM = {
  fire: (k, t, s, v) => Math.max(k.hiss(t, { filter: 'lowpass', f: 3500, to: 260, q: 0.7, dur: 0.35 + 0.45 * s, peak: 0.55 * v }),
    k.tone(t, { f: 120 * k.p, to: 38, dur: 0.28 + 0.2 * s, peak: 0.6 * v }), s >= 0.8 ? k.ticks(t + 0.05, 6, 0.5, 1500, 4000, 0.12 * v, 4) : t),
  ice: (k, t, s, v) => Math.max(k.tone(t, { f: 180 * k.p, to: 70, dur: 0.15, peak: 0.4 * v }), k.ticks(t, 5 + Math.round(8 * s), 0.05 + 0.18 * s, 3000, 7500, 0.32 * v, 8),
    k.bell(t + 0.02, pentaHz(16) * k.p, 0.6, 0.07 * v), k.bell(t + 0.07, pentaHz(18) * k.p, 0.5, 0.05 * v)),
  wind: (k, t, s, v) => Math.max(k.hiss(t, { f: 1200 * k.p, to: 250, q: 1.2, dur: 0.45 + 0.3 * s, peak: 0.65 * v, a: 0.02 }),
    k.hiss(t, { filter: 'highpass', f: 4000, dur: 0.14, peak: 0.15 * v })),
  thunder: (k, t, s, v) => Math.max(k.hiss(t, { filter: 'highpass', f: 2000, dur: 0.06, peak: 0.6 * v }),
    k.hiss(t + 0.02, { filter: 'lowpass', f: 900, to: 120, q: 0.5, dur: 0.8 + 0.6 * s, peak: 0.45 * v, a: 0.03 }), k.tone(t, { f: 60, to: 35, dur: 0.5, peak: 0.3 * v })),
  earth: (k, t, s, v) => Math.max(k.tone(t, { f: 90 * k.p, to: 32, dur: 0.45 + 0.3 * s, peak: 0.75 * v }), k.hiss(t, { filter: 'lowpass', f: 700, to: 90, dur: 0.5, peak: 0.45 * v }),
    k.ticks(t + 0.02, 6, 0.35, 1500, 3000, 0.14 * v, 4)),
  enemy: (k, t, s, v) => Math.max(k.hiss(t, { filter: 'lowpass', f: 1400, to: 200, dur: 0.3, peak: 0.4 * v }), k.tone(t, { f: 150 * k.p, to: 60, dur: 0.2, peak: 0.32 * v })),
  arcane: (k, t, s, v) => Math.max(k.bell(t, pentaHz(10) * k.p, 0.8, 0.15 * v), k.hiss(t, { filter: 'lowpass', f: 2000, to: 300, dur: 0.3, peak: 0.3 * v })),
};

/** 咏唱起来时那声"叮"按元素用哪一级 @type {Record<string, number>} */
const CHANT_DEG = { fire: 10, ice: 12, wind: 11, thunder: 13, earth: 8, arcane: 10 };

/**
 * 现成录音：名字 → 地址（放在 public/ 下）。龙吟是 Freesound 上 Dreeme 的 "Dragon Roar"（编号 546391，CC0 公有领域），
 * 10-29 本人从网上找来的十条里挑的；剪了开头那一声（原 0.3～4.7 秒，末尾 0.6 秒淡出），峰值压到 -1 dB。
 */
export const SAMPLES = { dragon: '/sfx/dragon-roar.mp3' };
/** 龙吟录音放多响：离线量过，和 boss 倒地那声差不多响 */
const ROAR_GAIN = 0.75;

/**
 * 录音没到时顶上的合成龙吼（10-29 本人说原来那声"太难听了，应该是龙吟"：原来是一支锯齿波从 330 滑到 820 Hz，听着像警笛；
 * 改成这个后又从网上挑了录音）。f0：起音的基频；up：挑上去几倍；hold：拖多长；T：整声多长；growl：沙哑有多重（开头 / 拖长时）；
 * formants：三个共鸣峰（起、张到最大、收）；ring：第三个共鸣峰；sub：低八度喉音；echo：山谷回声
 */
const ROAR = { f0: 82, up: 1.9, hold: 1.2, T: 2.4, growl: [0.7, 0.35], rough: 31, formants: [[480, 760, 420], [900, 1200, 760], [2300, 2600, 2200]], ring: 0.25, sub: 0.45, echo: 0.3, vib: 18 };

/** 软削波的曲线（给声音加毛边） */
let shapeCurve = /** @type {Float32Array<ArrayBuffer> | null} */ (null);
const softClip = () => shapeCurve ??= new Float32Array(Array.from({ length: 1025 }, (_, i) => Math.tanh(2.6 * (i / 512 - 1)) / Math.tanh(2.6)));

/** 召龙：放龙吟录音（没加载好就用合成的），再按元素补一层 @param {Kit} k @param {number} t @param {string} el */
function dragonRoar(k, t, el) {
  const voice = k.sample('dragon', t, ROAR_GAIN) || synthRoar(k, t);
  const extra = {
    fire: () => k.hiss(t + 0.3, { filter: 'lowpass', f: 1500, to: 300, dur: 1.4, peak: 0.3 }),
    ice: () => k.ticks(t + 0.3, 8, 1, 3000, 7000, 0.1, 8),
    wind: () => k.hiss(t + 0.2, { f: 300, to: 1100, q: 2.5, dur: 1.5, peak: 0.25, a: 0.3 }),
    thunder: () => BOOM.thunder(k, t + 0.4, 1, 1),
    earth: () => k.tone(t + 0.2, { f: 50, to: 32, dur: 1.4, peak: 0.45 }),
  }[el];
  return Math.max(voice, extra ? extra() : t);
}

/**
 * 合成的龙吼，压着低频、锣：
 *   声源：三支微微走音的锯齿波（体量大）加低八度一支（喉音），音高从低处挑上去、拖长、揉一揉、再落下；
 *   沙哑：三十几赫兹的振幅抖动，开头重、拖长时轻，再过一道软削波；
 *   口腔：并联三个带通（共鸣峰"嗷——呜"：先张开、再收拢），气息噪声也走这组共鸣峰；
 *   回荡：一道 0.3 秒的山谷回声，越回越闷。
 * @param {Kit} k @param {number} t
 */
function synthRoar(k, t) {
  const c = k.ctx, S = ROAR, T = S.T, f0 = S.f0 * k.p;
  const top = t + 0.42, hold = t + 0.42 + S.hold;
  // 共鸣峰组：输入 → 三个带通 → 总包络 → 出去（另分一路进回声）
  const bank = c.createGain(), env = c.createGain(), L = 0.55;   // L：整声响度（离线量过，和 boss 倒地那声差不多响）
  env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(0.8 * L, t + 0.16); env.gain.linearRampToValueAtTime(L, top);
  env.gain.setValueAtTime(L, hold); env.gain.exponentialRampToValueAtTime(0.0001, t + T);
  S.formants.forEach(([a, b, z], i) => {
    const f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'bandpass'; f.Q.value = [4.5, 7, 9][i];
    f.frequency.setValueAtTime(a, t); f.frequency.linearRampToValueAtTime(b, top); f.frequency.setValueAtTime(b * 0.97, hold); f.frequency.exponentialRampToValueAtTime(z, t + T);
    g.gain.value = [1.7, 1.2, S.ring * 2.2][i];
    bank.connect(f).connect(g).connect(env);
  });
  const chest = c.createBiquadFilter(), cg = c.createGain();   // 胸腔：低频不过共鸣峰，直接垫底
  chest.type = 'lowpass'; chest.frequency.value = 320; cg.gain.value = 0.55;
  bank.connect(chest).connect(cg).connect(env);
  env.connect(k.out);
  if (S.echo > 0) {
    const d = c.createDelay(1), fb = c.createGain(), lp = c.createBiquadFilter(), wet = c.createGain();
    d.delayTime.value = 0.31; fb.gain.value = 0.38; lp.type = 'lowpass'; lp.frequency.value = 1600; wet.gain.value = S.echo;
    env.connect(d); d.connect(lp).connect(fb).connect(d); lp.connect(wet).connect(k.out);
  }
  // 声源：削波 → 沙哑（振幅抖动） → 共鸣峰组
  const shaper = c.createWaveShaper(), am = c.createGain(), rough = c.createOscillator(), depth = c.createGain();
  shaper.curve = softClip(); shaper.oversample = '2x';
  rough.type = 'triangle'; rough.frequency.setValueAtTime(S.rough, t); rough.frequency.linearRampToValueAtTime(S.rough * 0.8, t + T);
  depth.gain.setValueAtTime(S.growl[0], t); depth.gain.linearRampToValueAtTime(S.growl[1], hold);
  am.gain.value = 1 - S.growl[0] / 2;
  rough.connect(depth).connect(am.gain);
  shaper.connect(am).connect(bank);
  const vib = c.createOscillator(), vib2 = c.createOscillator(), vg = c.createGain(), vg2 = c.createGain();   // 揉音：两个不成倍数的慢颤，不像机器
  vib.frequency.value = 4.6; vib2.frequency.value = 7.1;
  vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(S.vib, hold); vg2.gain.value = S.vib * 0.4;
  vib.connect(vg); vib2.connect(vg2);
  const voices = [[-9, 0.32], [0, 0.36], [11, 0.3], [-1200, S.sub]];   // 走音（音分）、响度；最后一支低八度
  const srcs = [rough, vib, vib2];
  for (const [det, amp] of voices) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sawtooth'; o.detune.value = det;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * S.up, top);
    o.frequency.linearRampToValueAtTime(f0 * S.up * 0.92, hold); o.frequency.exponentialRampToValueAtTime(f0 * 1.1, t + T);
    vg.connect(o.detune); vg2.connect(o.detune);
    g.gain.value = amp;
    o.connect(g).connect(shaper);
    srcs.push(o);
  }
  for (const x of srcs) { x.start(t); x.stop(t + T + 0.05); }
  k.hiss(t, { filter: 'highpass', f: 250, dur: T * 0.85, peak: 0.5, a: 0.12 }, bank);   // 气息
  return Math.max(t + T + (S.echo > 0 ? 1.2 : 0), k.tone(t, { f: 48, to: 36, dur: T * 0.7, peak: 0.3, a: 0.2 }), k.gong(t + 0.05, 73, 3, 0.18));
}

/** boss 现身、换阶段时吼一声：两支低沉的锯齿波打着拍，寒甲傀儡王带冰甲的嗡鸣，石甲巨像更沉、掉碎石，火灵是呼呼的火；狂暴再擂两下鼓 */
const ROAR_HZ = /** @type {Record<string, number>} */ ({ boss: 62, stone: 46, flame: 78 });
/** @param {Kit} k @param {number} t @param {string} type @param {number} phase */
function bossRoar(k, t, type, phase) {
  const f = ROAR_HZ[type] ?? 62;
  let e = Math.max(k.tone(t, { type: 'sawtooth', f, to: f * 0.8, dur: 1.2, peak: 0.24, a: 0.12, lp: 480 }),
    k.tone(t, { type: 'sawtooth', f: f * 1.03, to: f * 0.78, dur: 1.2, peak: 0.18, a: 0.12, lp: 480 }), k.hiss(t, { f: 300, to: 600, q: 0.7, dur: 1.1, peak: 0.3, a: 0.15 }));
  if (type === 'stone') e = Math.max(e, k.tone(t, { f: 38, to: 30, dur: 1.2, peak: 0.45 }), k.ticks(t + 0.1, 8, 0.9, 1200, 2600, 0.1, 4));
  else if (type === 'flame') e = Math.max(e, k.hiss(t, { filter: 'lowpass', f: 1800, to: 400, dur: 1.3, peak: 0.36 }), k.ticks(t + 0.1, 8, 1, 1500, 4000, 0.08, 4));
  else e = Math.max(e, k.gong(t, 196, 1.6, 0.08, k.out, [1, 2.4, 3.9]));
  if (phase >= 3) e = Math.max(e, k.drum(t + 0.9, 0.5), k.drum(t + 1.1, 0.55));
  return e;
}

/** @typedef {{ el?: string, scale?: number, type?: string, phase?: number, flame?: boolean, short?: boolean }} PlayOpts */
/** 所有音效：在 t 时刻排好、返回响完的时刻 @type {Record<string, (k: Kit, t: number, o: PlayOpts) => number>} */
export const RECIPES = {
  // ---- 施法
  chant: (k, t, o) => { const f = pentaHz(CHANT_DEG[o.el ?? ''] ?? 10), d = o.short ? 0.35 : 0.9; return Math.max(k.pad(t, f / 2, d, 0.07), k.bell(t + 0.04, f, d, 0.06)); },
  cast: (k, t, o) => (CAST[o.el ?? ''] ?? CAST.arcane)(k, t),
  fly: (k, t) => k.hiss(t, { f: 600 * k.p, to: 1400, q: 3, dur: 0.2, peak: 0.1, a: 0.05 }),
  boom: (k, t, o) => { const s = Math.min(2, Math.max(0.3, o.scale ?? 1)); return (BOOM[o.el ?? ''] ?? BOOM.arcane)(k, t, s, Math.min(1.3, Math.sqrt(s))); },
  zap: (k, t) => Math.max(k.tone(t, { type: 'square', f: 120, dur: 0.12, peak: 0.05, lp: 2000 }),
    ...[0, 1, 2, 3].map((i) => k.hiss(t + i * 0.028, { filter: 'highpass', f: 2500, dur: 0.02, peak: rnd(0.15, 0.35) }))),
  crack: (k, t) => Math.max(k.hiss(t, { f: 2500, to: 600, q: 2, dur: 0.22, peak: 0.22 }), k.ticks(t, 5, 0.25, 1200, 2800, 0.12, 4)),
  card: (k, t) => Math.max(k.bell(t, pentaHz(10), 1.4, 0.2), k.bell(t + 0.09, pentaHz(13), 1.2, 0.13)),
  fail: (k, t) => Math.max(k.tone(t, { type: 'triangle', f: pentaHz(7), to: pentaHz(4), glide: 0.25, dur: 0.32, peak: 0.12 }), k.hiss(t, { filter: 'lowpass', f: 500, dur: 0.14, peak: 0.15 })),
  backlash: (k, t) => Math.max(k.gong(t, 98, 2.2, 0.35, k.out, [1, 1.41, 2.13, 2.9]), k.tone(t, { type: 'square', f: 220, to: 110, dur: 0.6, peak: 0.07, lp: 1200 }),
    k.hiss(t, { filter: 'lowpass', f: 600, to: 150, dur: 1.0, peak: 0.3 })),
  surge: (k, t) => Math.max(k.gong(t, 82, 2.5, 0.3), k.drum(t, 0.5)),
  ghost: (k, t) => Math.max(k.hiss(t, { f: 900, to: 300, q: 1.5, dur: 1.1, peak: 0.18, a: 0.3 }), k.tone(t, { f: pentaHz(12), to: pentaHz(5), dur: 1.1, peak: 0.05, a: 0.2 })),
  dragon: (k, t, o) => dragonRoar(k, t, o.el ?? 'ice'),
  wall: (k, t, o) => (o.el === 'earth'
    ? Math.max(k.tone(t, { f: 60, to: 40, dur: 0.6, peak: 0.4 }), k.hiss(t, { filter: 'lowpass', f: 300, dur: 0.6, peak: 0.34, a: 0.1 }), k.ticks(t + 0.1, 5, 0.4, 1200, 2600, 0.1, 4))
    : k.hiss(t, { f: 600, to: 1500, q: 1, dur: 0.6, peak: 0.2, a: 0.15 })),
  tornado: (k, t) => Math.max(k.hiss(t, { f: 300, to: 900, q: 3, dur: 2, peak: 0.7, a: 0.3 }), k.hiss(t + 0.2, { f: 1200, to: 600, q: 4, dur: 1.8, peak: 0.35, a: 0.3 }),
    k.hiss(t, { filter: 'lowpass', f: 1500, to: 400, dur: 1.6, peak: 0.3, a: 0.1 }), k.tone(t, { f: 70, to: 45, dur: 1.2, peak: 0.3 })),   // 融合是招牌：风声之外压一层火的呼呼与低响
  beam: (k, t) => Math.max(k.hiss(t, { filter: 'lowpass', f: 2500, to: 500, q: 0.5, dur: 1.6, peak: 0.5, a: 0.08 }), k.tone(t, { f: 80, to: 45, dur: 1.2, peak: 0.4 }),
    k.ticks(t + 0.1, 8, 1.2, 1500, 4000, 0.1, 4)),
  gale: (k, t) => k.hiss(t, { f: 400, to: 1200, q: 2, dur: 1.4, peak: 0.6, a: 0.25 }),
  // ---- 敌人与阵眼
  shatter: (k, t) => Math.max(k.hiss(t, { f: 1800 * k.p, to: 900, q: 3, dur: 0.08, peak: 0.24 }), k.ticks(t, 3, 0.1, 1500, 3500, 0.1, 5), k.tone(t, { f: 300 * k.p, to: 120, dur: 0.08, peak: 0.12 })),
  fall: (k, t) => k.tone(t, { f: 900, to: 180, dur: 0.8, peak: 0.05, a: 0.02 }),
  core: (k, t) => Math.max(k.tone(t, { f: 55, dur: 0.8, peak: 0.4 }), k.tone(t, { f: 110.5, dur: 0.6, peak: 0.15 }), k.hiss(t, { f: 2400, q: 3, dur: 0.15, peak: 0.2 })),
  // ---- 试炼：玩家
  dash: (k, t) => k.hiss(t, { f: 900 * k.p, to: 2600, q: 1.2, dur: 0.14, peak: 0.2, a: 0.02 }),
  perfect: (k, t) => Math.max(k.bell(t, pentaHz(15), 0.9, 0.18), k.hiss(t, { f: 3000, to: 800, q: 1, dur: 0.24, peak: 0.12 }),
    ...[10, 12, 14, 16].map((d, i) => k.pluck(t + 0.03 + i * 0.04, pentaHz(d), 0.1, 0.6))),
  hurt: (k, t) => Math.max(k.tone(t, { type: 'triangle', f: 240, to: 90, dur: 0.18, peak: 0.3 }), k.hiss(t, { filter: 'lowpass', f: 1200, dur: 0.12, peak: 0.32 }),
    k.tone(t, { type: 'square', f: 70, dur: 0.14, peak: 0.05, lp: 600 })),
  // ---- 试炼：boss
  roar: (k, t, o) => bossRoar(k, t, o.type ?? 'boss', o.phase ?? 1),
  warn: (k, t) => Math.max(k.tone(t, { f: 220, to: 196, dur: 0.22, peak: 0.06 }), k.hiss(t, { f: 1800, q: 12, dur: 0.28, peak: 0.06, a: 0.05 })),
  volley: (k, t, o) => Math.max(k.hiss(t, { f: 700, to: 1800, q: 1.5, dur: 0.28, peak: 0.18 }),
    o.flame ? k.hiss(t, { filter: 'lowpass', f: 900, dur: 0.4, peak: 0.2 }) : k.bell(t, pentaHz(17), 0.3, 0.05)),
  spit: (k, t) => k.hiss(t, { f: 1500 * k.p, to: 2500, q: 4, dur: 0.06, peak: 0.07 }),
  rush: (k, t) => Math.max(k.tone(t, { f: 55, to: 40, dur: 0.8, peak: 0.38 }), k.hiss(t, { filter: 'lowpass', f: 400, dur: 0.8, peak: 0.32, a: 0.1 })),
  armor: (k, t, o) => Math.max(k.ticks(t, 14, 0.35, 2500, 8000, 0.24, 6), k.tone(t, { f: 160, to: 60, dur: 0.3, peak: 0.4 }), k.hiss(t, { filter: 'highpass', f: 3000, dur: 0.4, peak: 0.18 }),
    ...(o.el === 'ice' ? [0, 1, 2].map((i) => k.bell(t + 0.05 + i * 0.06, pentaHz(15 + i * 2), 0.8, 0.06)) : [])),
  clang: (k, t) => Math.max(k.gong(t, 220, 0.9, 0.28, k.out, [1, 2.4, 3.9, 5.3]), k.tone(t, { f: 110, to: 50, dur: 0.3, peak: 0.45 }), k.hiss(t, { filter: 'highpass', f: 4000, dur: 0.05, peak: 0.35 })),
  bossdown: (k, t) => Math.max(k.gong(t, 65, 4, 0.45), BOOM.earth(k, t, 1.6, 1.2), ...[10, 12, 14, 15, 17, 19].map((d, i) => k.pluck(t + 0.4 + i * 0.08, pentaHz(d), 0.12, 1.2))),
  // ---- 波次、胜负、三选一
  drums: (k, t) => Math.max(...[0, 0.32, 0.56, 0.72, 0.88].map((d, i) => k.drum(t + d, 0.35 + i * 0.08)), k.gong(t + 1.04, 82, 2.8, 0.3)),
  clear: (k, t) => Math.max(...[5, 7, 9, 10, 12].map((d, i) => k.pluck(t + i * 0.09, pentaHz(d), 0.14, 1.2)), k.bell(t + 0.5, pentaHz(15), 1.4, 0.12)),
  win: (k, t) => Math.max(...[0, 2, 4, 5, 7, 9, 10].map((d, i) => k.pluck(t + i * 0.11, pentaHz(d + 5), 0.15, 1.4)),
    k.gong(t + 0.85, 82, 3.5, 0.32), k.bell(t + 0.85, pentaHz(15), 2, 0.12), k.bell(t + 0.85, pentaHz(17), 2, 0.08)),
  lose: (k, t) => Math.max(...[9, 8, 6, 4].map((d, i) => k.pluck(t + i * 0.22, pentaHz(d), 0.15, 1.6)), k.gong(t + 0.95, 55, 4, 0.3), k.drum(t + 0.95, 0.5, k.out, 90)),
  pick: (k, t) => Math.max(k.bell(t, pentaHz(12), 1.0, 0.13), k.bell(t + 0.12, pentaHz(14), 0.9, 0.09)),
  take: (k, t) => Math.max(k.pluck(t, pentaHz(10), 0.16, 0.9), k.pluck(t + 0.07, pentaHz(12), 0.14, 1.0)),
  tick: (k, t) => k.tone(t, { f: 1800, dur: 0.03, peak: 0.05 }),
};

/**
 * 背景乐的一格（十六分音符）：铺底、锣、钹、笛子在小节头；低音每两拍一下；堂鼓、梆子照鼓谱；boss 每四小节末尾滚一串鼓；
 * 旋律两小节一句，八分音符上按疏密下音，最后落主音、空一拍
 * @param {Kit} k @param {AudioNode} out @param {MoodSpec} m @param {number} step @param {number} t @param {{ deg: number }} st 旋律走到第几级
 */
export function beat(k, out, m, step, t, st) {
  const s = step % 16, bar = Math.floor(step / 16), q = 60 / m.bpm, boss = m === MOODS.boss;
  if (s === 0) {
    if (m.drone && bar % 2 === 0) for (const d of m.drone) k.pad(t, pentaHz(d), q * 8 + 1.5, 0.05, out);
    if (boss && bar % 4 === 0) k.gong(t, 73, 3.5, 0.22, out);
    else if (m === MOODS.battle && bar % 8 === 0) k.gong(t, 82, 3, 0.14, out);
    if (boss && bar % 2 === 0) k.hiss(t, { filter: 'highpass', f: 5000, dur: 1, peak: 0.06 }, out);
    if (Math.random() < m.flute) k.flute(t + (Math.random() < 0.5 ? 0 : q), pentaHz(nextDegree(st.deg, m, Math.random(), Math.random(), false) + 5), q * (2 + Math.floor(Math.random() * 2)), 0.045, out);
  }
  const bass = m.bass[bar % m.bass.length];
  if (s % 8 === 0) k.pluck(t, pentaHz(bass), 0.2, q * 3, out);
  else if (s % 4 === 0 && m !== MOODS.calm) k.pluck(t, pentaHz(bass + 5), 0.08, q, out);
  if (m.kick.includes(s)) k.drum(t, s === 0 ? 0.5 : 0.32, out);
  if (m.block.includes(s)) k.block(t, s === 14 ? 0.05 : 0.09, out);
  if (boss && bar % 4 === 3 && s >= 12) k.drum(t, 0.18 + (s - 12) * 0.06, out, 170);
  const ph = step % 32;
  if (ph >= 30) return;
  const cad = ph === 28;
  const on = s % 2 === 0 ? cad || Math.random() < m.dense : boss && s % 4 === 3 && Math.random() < 0.2;
  if (!on) return;
  st.deg = nextDegree(st.deg, m, Math.random(), Math.random(), cad);
  k.pluck(t, pentaHz(st.deg), cad ? 0.2 : 0.13 + Math.random() * 0.06, m.ring * (cad ? 1.8 : 1), out);
}

/** 混响的冲激响应：两路噪声，越往后越闷、越弱（山谷里的回声） @param {BaseAudioContext} c @param {number} sec @param {number} decay */
function impulse(c, sec, decay) {
  const n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) { const k = i / n; lp += (Math.random() * 2 - 1 - lp) * (0.5 - 0.4 * k); d[i] = lp * (1 - k) ** decay; }
  }
  return b;
}

/** 音效、音乐两路，各送一点进混响 @param {BaseAudioContext} c @param {AudioNode} out */
function chain(c, out) {
  const sfx = c.createGain(), music = c.createGain(), verb = c.createConvolver(), wet = c.createGain(), s1 = c.createGain(), s2 = c.createGain();
  sfx.gain.value = 0.85; music.gain.value = 0.22; wet.gain.value = 0.5; s1.gain.value = 0.2; s2.gain.value = 0.5;
  verb.buffer = impulse(c, 2.4, 2.6);
  sfx.connect(out); music.connect(out); verb.connect(wet).connect(out);
  sfx.connect(s1).connect(verb); music.connect(s2).connect(verb);
  return { sfx, music };
}

const STORE = 'yc-sound';
/** @typedef {'calm' | 'battle' | 'boss' | null} Mood */

export class Sound {
  constructor() {
    /** @type {AudioContext | null} */
    this.ctx = null;
    /** @type {Kit | null} */
    this.kit = null;
    /** @type {GainNode | null} */
    this.duckG = null;
    /** @type {AudioNode | null} */
    this.musicOut = null;
    this.muted = (() => { try { return localStorage.getItem(STORE) === 'off'; } catch { return false; } })();
    this.hidden = typeof document !== 'undefined' && document.hidden;
    this.voices = 0;
    /** @type {Record<string, number>} */
    this.last = {};
    /** @type {Mood} */
    this.moodName = null;
    this.step = 0; this.nextT = 0; this.timer = 0;
    this.st = { deg: 9 };
    this.onVis = () => { this.hidden = document.hidden; this.wake(); };
    document.addEventListener('visibilitychange', this.onVis);
  }

  /** 玩家点击、按键时调（浏览器只在这种时候允许出声）：第一次建好音频，之后把睡着的叫醒 */
  unlock() {
    if (this.muted) return;
    if (!this.ctx) this.build();
    this.wake();
  }

  /** 静音或切到后台时整个挂起（不占电），回来再接着 */
  wake() {
    const c = this.ctx;
    if (!c) return;
    if (this.muted || this.hidden) { if (c.state === 'running') c.suspend().catch(() => {}); }
    else if (c.state !== 'running') c.resume().catch(() => {});
  }

  build() {
    const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    if (!AC) return;
    /** @type {AudioContext} */
    let c;
    try { c = new AC({ latencyHint: 'interactive' }); } catch { return; }
    this.ctx = c;
    const comp = c.createDynamicsCompressor();   // 几个大爆炸叠在一起也不破音
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
    this.duckG = c.createGain();
    this.duckG.connect(comp).connect(c.destination);
    const { sfx, music } = chain(c, this.duckG);
    this.kit = new Kit(c, sfx);
    this.musicOut = music;
    const kit = this.kit;
    for (const [name, url] of Object.entries(SAMPLES)) {   // 下载失败（离线、预览页）就一直用合成的；解码用回调写法，老的苹果浏览器只认这个
      fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((buf) => new Promise((ok, no) => c.decodeAudioData(buf, ok, no)))
        .then((b) => { kit.samples[name] = /** @type {AudioBuffer} */ (b); })
        .catch(() => {});
    }
    const s = c.createBufferSource();   // 老的 iOS 要先在点击里放一段空声才解锁
    s.buffer = c.createBuffer(1, 1, 22050); s.connect(c.destination); s.start(0);
    this.timer = window.setInterval(() => this.tickMusic(), 40);
  }

  /** 放一个音效（还没解锁、静音、太密都直接不放） @param {string} name RECIPES 里的名字 @param {PlayOpts} [o] */
  play(name, o = {}) {
    const c = this.ctx, k = this.kit, r = RECIPES[name];
    if (!c || !k || !r || c.state !== 'running') return;
    const now = c.currentTime, key = name + (o.el ?? '');
    if (now - (this.last[key] ?? -9) < (GAP[name] ?? 0.03) || this.voices >= MAX_VOICES) return;
    this.last[key] = now;
    this.voices++;
    k.p = 1 + (Math.random() - 0.5) * 0.08;   // 同一个声音每次音高差一点，连着响不像复读
    const end = r(k, now + 0.01, o);
    k.p = 1;
    window.setTimeout(() => { this.voices--; }, Math.max(50, (end - now) * 1000));
  }

  /** 背景乐换成哪一种（同一种不重来），null 停；换了从小节头起 @param {Mood} m */
  mood(m) {
    if (m === this.moodName) return;
    this.moodName = m;
    this.step = 0;
    if (this.ctx) this.nextT = this.ctx.currentTime + 0.1;
  }

  /** 每 40 毫秒排好接下来 0.18 秒里的音（卡顿、挂起过就从现在重新对齐，不补放） */
  tickMusic() {
    const c = this.ctx, k = this.kit, out = this.musicOut, m = this.moodName ? MOODS[this.moodName] : null;
    if (!c || !k || !out || !m || c.state !== 'running') return;
    if (this.nextT < c.currentTime) this.nextT = c.currentTime + 0.05;
    while (this.nextT < c.currentTime + 0.18) { beat(k, out, m, this.step, this.nextT, this.st); this.nextT += 15 / m.bpm; this.step++; }
  }

  /** 玩家说话（录音）时把游戏声压到一成五，说完慢慢回来 @param {boolean} on */
  duck(on) {
    const c = this.ctx;
    if (c && this.duckG) this.duckG.gain.setTargetAtTime(on ? 0.15 : 1, c.currentTime, on ? 0.04 : 0.25);
  }

  /** 静音开关（记在这台设备的浏览器里；存不进去就只管这次打开） @param {boolean} on */
  setMuted(on) {
    this.muted = on;
    try { localStorage.setItem(STORE, on ? 'off' : 'on'); } catch { /* 无痕窗口之类 */ }
    if (!on && !this.ctx) this.build();
    this.wake();
  }

  dispose() {
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onVis);
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  /**
   * 检查用（听不了，只能先看数）：离线渲染一个音效，或 mood 名字渲染 sec 秒背景乐，量峰值、均方根、响到第几秒；
   * 峰值是 NaN 说明配方里有坏数
   * @param {string} name @param {PlayOpts} [o] @param {number} [sec]
   */
  static async measure(name, o = {}, sec = 5) {
    const sr = 22050, d = await Sound.render(name, o, sec, sr);
    let peak = 0, sq = 0, last = 0;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (!(a <= peak)) peak = a; sq += d[i] * d[i]; if (a > 0.003) last = i; }
    return { peak: +peak.toFixed(3), rms: +Math.sqrt(sq / d.length).toFixed(4), sec: +(last / sr).toFixed(2) };
  }

  /** 离线渲染一个音效（或 sec 秒背景乐），连同混响，给出单声道采样（量数、导出试听用） @param {string} name @param {PlayOpts} [o] @param {number} [sec] @param {number} [sr] */
  static async render(name, o = {}, sec = 5, sr = 22050) {
    const c = new OfflineAudioContext(1, Math.round(sr * sec), sr), { sfx, music } = chain(c, c.destination), k = new Kit(c, sfx);
    const m = /** @type {Record<string, MoodSpec>} */ (MOODS)[name];
    if (m) { const st = { deg: 9 }; for (let i = 0, t = 0.01; t < sec - 0.2; i++, t += 15 / m.bpm) beat(k, music, m, i, t, st); }
    else RECIPES[name](k, 0.01, o);
    return (await c.startRendering()).getChannelData(0);
  }
}
