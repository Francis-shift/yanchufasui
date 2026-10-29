// @ts-check
/**
 * 语音施法的录音：按住时从麦克风收音，松开后把这一段降到 16 kHz 单声道、编成 WAV（base64），交给服务器识别（net.js asrRemote）。
 * 每次说完就关掉麦克风：开着时浏览器一直亮"正在录音"，苹果手机还会把游戏声改从听筒出、变得很小。
 * 打开回声消除（手机外放的游戏声少录进去），录音时游戏声另由 Sound.duck 压低。
 */

/** 送去识别的采样率；一次最长录几秒；比这短、或几乎没声音就不送 */
export const RATE = 16000, MAX_SEC = 8, MIN_SEC = 0.35, MIN_RMS = 0.004;
/** 等识别结果最多多久（服务器那头 5 秒，加上路上的时间） */
export const ASR_TIMEOUT_MS = 6500;

/** 降采样：每个输出点取对应那一段的平均（顺带滤掉高频，免得折返成杂音） @param {Float32Array} x @param {number} from @param {number} [to] */
export function downsample(x, from, to = RATE) {
  if (from <= to) return x;
  const k = from / to, n = Math.floor(x.length / k), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * k), b = Math.max(a + 1, Math.min(x.length, Math.floor((i + 1) * k)));
    let s = 0;
    for (let j = a; j < b; j++) s += x[j];
    out[i] = s / (b - a);
  }
  return out;
}

/** 16 位单声道 PCM 的 WAV 文件 @param {Float32Array} x @param {number} [rate] @returns {Uint8Array} */
export function wav(x, rate = RATE) {
  const v = new DataView(new ArrayBuffer(44 + x.length * 2));
  const str = (/** @type {number} */ o, /** @type {string} */ s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) { const s = Math.max(-1, Math.min(1, x[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Uint8Array(v.buffer);
}

/** @param {Uint8Array} u */
export function base64(u) {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * 录下的一块块 → 要送去识别的 WAV（base64）。太短、几乎没声音返回 null；声音小的放大到峰值 0.8（最多 6 倍）
 * @param {Float32Array[]} chunks @param {number} rate 录音时的采样率 @returns {{ b64: string, sec: number, rms: number } | null}
 */
export function encode(chunks, rate) {
  const n = chunks.reduce((a, c) => a + c.length, 0), all = new Float32Array(n);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  const x = downsample(all, rate);
  let peak = 0, sq = 0;
  for (const s of x) { peak = Math.max(peak, Math.abs(s)); sq += s * s; }
  const sec = x.length / RATE, rms = x.length ? Math.sqrt(sq / x.length) : 0;
  if (sec < MIN_SEC || rms < MIN_RMS) return null;
  const g = Math.min(6, 0.8 / Math.max(peak, 1e-6));
  if (g > 1) for (let i = 0; i < x.length; i++) x[i] *= g;
  return { b64: base64(wav(x)), sec, rms };
}

export class Recorder {
  constructor() {
    /** @type {MediaStream | null} */
    this.stream = null;
    /** @type {AudioContext | null} */
    this.ctx = null;
    /** @type {MediaStreamAudioSourceNode | null} */
    this.src = null;
    /** @type {ScriptProcessorNode | null} */
    this.node = null;
    /** @type {Float32Array[]} */
    this.chunks = [];
    this.n = 0;
  }

  /** 这个浏览器能不能录（要 https；微信、手机浏览器较新的版本都行） */
  static supported() {
    return typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia
      && !!(window.AudioContext || /** @type {any} */ (window).webkitAudioContext);
  }

  /** 开始收音（第一次会弹出麦克风授权）；拿不到麦克风就抛错 */
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    this.ctx ||= new AC();
    if (this.ctx.state !== 'running') await this.ctx.resume();
    const c = this.ctx;
    this.src = c.createMediaStreamSource(this.stream);
    // ScriptProcessor 已不推荐，但苹果、微信里都能用，也不用另起一个文件；输出不写东西，接到扬声器只为让它跑起来
    this.node = c.createScriptProcessor(4096, 1, 1);
    this.chunks = []; this.n = 0;
    this.node.onaudioprocess = (e) => {
      if (this.n >= c.sampleRate * MAX_SEC) return;
      const d = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(d)); this.n += d.length;
    };
    this.src.connect(this.node); this.node.connect(c.destination);
  }

  /** 停下、关麦克风，返回这段话（encode 的结果；没录到东西是 null） */
  stop() {
    if (this.node) this.node.onaudioprocess = null;
    this.src?.disconnect(); this.node?.disconnect();
    this.src = null; this.node = null;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    const rate = this.ctx?.sampleRate ?? RATE;
    this.ctx?.suspend().catch(() => {});
    const r = encode(this.chunks, rate);
    this.chunks = [];
    return r;
  }

  dispose() { this.stop(); this.ctx?.close().catch(() => {}); this.ctx = null; }
}
