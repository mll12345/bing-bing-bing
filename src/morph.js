// morph.js —— 把人声的「元音」换成 /i/、尾音换成 /ŋ/，得到真正的「冰」
//
// 思路：不去凭空合成一个音，而是**借用原唱本人**——
// 拿原唱那个字的音频，做 STFT，逐帧求出它的频谱包络，
// 然后把包络替换成「冰」的共振峰包络（/i/ → /ŋ/），保留原唱的基频、颤音、气声与辅音。
// 结果是「同一个歌手在唱 bīng」，而不是一个合成的号声/音效。
import { makeFFT } from './fft.js';

const N = 2048;
const HOP = 512;
const BINS = N / 2 + 1;
const EPS = 1e-9;

let fft = null;
let win = null;

/**
 * 四个「冰声组」——对应参考音频里 3 个一模一样的冰 × 4 组。
 * 每组是同一个冰的音色，组与组之间在共振峰、鼻音比例、起音上明显不同，方便试听后挑一组。
 */
export const BING_GROUPS = {
  1: {
    name: '第 1 组 · 低沉',
    v: [[268, 62, 1.0], [2050, 110, 0.80], [2680, 160, 0.42], [3450, 215, 0.20], [4300, 290, 0.10]],
    n: [[250, 92, 1.0], [900, 280, 0.36], [2050, 380, 0.14]],
    nasal: 0.58,
    tiltEnd: 0.40,
  },
  2: {
    name: '第 2 组 · 中性',
    v: [[300, 65, 1.0], [2350, 110, 0.92], [3000, 160, 0.55], [3800, 220, 0.30], [4600, 300, 0.16]],
    n: [[280, 95, 1.0], [1050, 300, 0.30], [2300, 400, 0.12]],
    nasal: 0.44,
    tiltEnd: 0.34,
  },
  3: {
    name: '第 3 组 · 清亮',
    v: [[322, 66, 1.0], [2660, 118, 1.00], [3250, 170, 0.72], [4050, 230, 0.40], [4900, 300, 0.22]],
    n: [[300, 100, 1.0], [1180, 320, 0.26], [2500, 420, 0.09]],
    nasal: 0.34,
    tiltEnd: 0.28,
  },
  4: {
    name: '第 4 组 · 尖细',
    v: [[352, 70, 1.0], [2920, 125, 1.05], [3420, 180, 0.86], [4300, 240, 0.52], [5200, 320, 0.28]],
    n: [[318, 105, 1.0], [1320, 340, 0.22], [2700, 440, 0.07]],
    nasal: 0.24,
    tiltEnd: 0.22,
  },
};

// 兼容旧调用
export const FORMANT_SETS = BING_GROUPS;

/** 洛伦兹共振峰叠加 + 轻微声源倾斜，返回线性幅度包络 */
function envAt(formants, f) {
  let v = 0;
  for (let i = 0; i < formants.length; i++) {
    const F = formants[i][0];
    const h = formants[i][1] / 2;
    const d = f - F;
    v += formants[i][2] * (h * h) / (d * d + h * h);
  }
  return Math.max(v, 1e-4) / (1 + Math.pow(f / 3200, 0.85));
}

function prepare(sr) {
  if (fft) return;
  fft = makeFFT(N);
  win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
}

/** 每帧统计包络时的频带半宽（以倍频程计） */
const HALF_OCT = 0.13;

function buildRangeTable(sr) {
  const lo = new Int32Array(BINS);
  const hi = new Int32Array(BINS);
  const f0 = 30;
  for (let k = 0; k < BINS; k++) {
    const f = Math.max(f0, (k * sr) / N);
    const a = f * Math.pow(2, -HALF_OCT);
    const b = f * Math.pow(2, HALF_OCT);
    lo[k] = Math.max(1, Math.min(BINS - 1, Math.round((a * N) / sr)));
    hi[k] = Math.max(lo[k] + 1, Math.min(BINS - 1, Math.round((b * N) / sr)));
  }
  return { lo, hi };
}

function buildTarget(sr, timbre) {
  const set = BING_GROUPS[timbre] || BING_GROUPS[2];
  const tv = new Float32Array(BINS);
  const tn = new Float32Array(BINS);
  for (let k = 0; k < BINS; k++) {
    const f = (k * sr) / N;
    tv[k] = Math.log(envAt(set.v, f) + EPS);
    tn[k] = Math.log(envAt(set.n, f) + EPS);
  }
  return { tv, tn };
}

/**
 * 把一个音节的元音改成 /i/、尾音改成 /ŋ/
 * @param {Float32Array} src 人声音轨
 * @param {number} sr 采样率
 * @param {number} at 起始采样点
 * @param {number} len 长度（采样点）
 * @param {object} opt { timbre, nasal, tiltEnd }
 * @returns {Float32Array} 变形后的音节（长度 = len）
 */
export function morphSyllable(src, sr, at, len, opt = {}) {
  const timbre = opt.timbre == null ? 2 : opt.timbre;
  const set = BING_GROUPS[timbre] || BING_GROUPS[2];
  const nasal = opt.nasal == null ? set.nasal : opt.nasal;
  const tiltEnd = opt.tiltEnd == null ? set.tiltEnd : opt.tiltEnd;
  prepare(sr);
  const n = Math.max(64, len | 0);
  const out = new Float32Array(n + N);
  const wsum = new Float32Array(n + N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const logm = new Float32Array(BINS);
  const srcEnv = new Float32Array(BINS);
  const pre = new Float64Array(BINS + 1);
  const { lo, hi } = buildRangeTable(sr);
  const { tv, tn } = buildTarget(sr, timbre);

  const gainMin = Math.log(0.30);
  const gainMax = Math.log(3.20);
  const frames = Math.ceil(n / HOP) + 1;

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < N; i++) {
      const s = at + off + i;
      re[i] = (s >= 0 && s < src.length ? src[s] : 0) * win[i];
      im[i] = 0;
    }
    fft(re, im, false);

    // 逐帧源包络（对数域，按倍频程半宽做区间平均）
    for (let k = 0; k < BINS; k++) {
      const m = Math.hypot(re[k], im[k]);
      logm[k] = Math.log(m + EPS);
      pre[k + 1] = pre[k] + logm[k];
    }
    for (let k = 0; k < BINS; k++) {
      const a = lo[k];
      const b = hi[k];
      srcEnv[k] = (pre[b + 1] - pre[a]) / (b - a + 1);
    }

    // 尾部往鼻音走
    const t = f / Math.max(1, frames - 1);
    let w = 0;
    if (t > 1 - tiltEnd) w = Math.min(1, (t - (1 - tiltEnd)) / tiltEnd);
    w = w * w * (3 - 2 * w) * nasal;

    for (let k = 0; k < BINS; k++) {
      const tgt = tv[k] * (1 - w) + tn[k] * w;
      let g = tgt - srcEnv[k];
      if (g < gainMin) g = gainMin; else if (g > gainMax) g = gainMax;
      // 相邻频点平滑，避免高频纹波
      const gPrev = k > 0 ? g : g;
      const scale = Math.exp(gPrev);
      re[k] *= scale;
      im[k] *= scale;
    }
    // 共轭对称，保证逆变换是实信号
    for (let k = 1; k < N / 2; k++) {
      re[N - k] = re[k];
      im[N - k] = -im[k];
    }
    im[0] = 0;
    im[N / 2] = 0;

    fft(re, im, true);
    for (let i = 0; i < N; i++) {
      const o = off + i;
      if (o >= out.length) break;
      out[o] += re[i] * win[i];
      wsum[o] += win[i] * win[i];
    }
  }

  const res = new Float32Array(n);
  for (let i = 0; i < n; i++) res[i] = out[i] / Math.max(1e-6, wsum[i]);
  return res;
}

function rms(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, a.length));
}

/**
 * 整条人声轨 → 整条「冰声」轨
 * 每个音符对应原唱的一个字，取那段音频做共振峰替换，音量沿用原字。
 * @returns {{data:Float32Array, count:number, morphed:number}}
 */
export function renderMorphBing(vocal, sr, notes, { gain = 1, timbre = 2, progress = () => {} } = {}) {
  const len = vocal.length;
  const data = new Float32Array(len);
  let morphed = 0;

  notes.forEach((nt, idx) => {
    const at = Math.max(0, Math.round(nt.start * sr));
    if (at >= len) return;
    const dur = Math.max(0.06, Math.min(nt.dur, 6));
    const n = Math.min(len - at, Math.round(dur * sr) + Math.round(0.02 * sr));
    if (n < 64) return;

    let seg = new Float32Array(n);
    for (let i = 0; i < n; i++) seg[i] = vocal[at + i];

    const inRms = rms(seg);
    if (inRms < 2e-4) return;

    let voiced = morphSyllable(vocal, sr, at, n, { timbre });
    const outRms = rms(voiced);
    const k = outRms > 1e-6 ? (inRms * 1.05) / outRms : 0;
    for (let i = 0; i < n; i++) voiced[i] *= k;

    // 短促淡入淡出，避免接缝
    const fade = Math.min(Math.round(0.006 * sr), n >> 2);
    for (let i = 0; i < fade; i++) {
      const g = i / fade;
      voiced[i] *= g;
      voiced[n - 1 - i] *= g;
    }

    for (let i = 0; i < n; i++) data[at + i] += voiced[i] * gain;
    morphed++;
    if (idx % 80 === 0) progress(0.55 + 0.25 * (idx / Math.max(1, notes.length)), '唱冰…');
  });

  return { data, count: notes.length, morphed };
}
