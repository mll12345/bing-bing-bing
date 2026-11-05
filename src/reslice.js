// reslice.js —— 不做频谱合成，只做「借」：
// 从原唱里挑出最像「冰」的几个真实音节当母本，再用 PSOLA 把它们拉到每个音符的音高上复用。
// 每个「冰」都是从原唱身上真实录下来的波形，只改音高和长度，不改频谱包络，所以不会出现「雷霆 / 电味」。

import { makeFFT } from './fft.js';

const BANDS = {
  f1: [230, 430],
  f2: [2050, 2750],
  f3: [2850, 3550],
  hi: [3600, 6500],
};

/** 简单汉宁窗 */
function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/** 取一段频谱（幅度），用于给音节打分 */
function spectrum(src, sr, at, dur) {
  const N = 1024;
  const fft = makeFFT(N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const w = hann(N);
  const hop = Math.floor(N / 2);
  const start = Math.max(0, Math.floor(at * sr));
  const end = Math.min(src.length, Math.floor((at + dur) * sr));
  const acc = new Float32Array(N / 2);
  let cnt = 0;
  for (let p = start; p + N <= end; p += hop) {
    for (let i = 0; i < N; i++) { re[i] = src[p + i] * w[i]; im[i] = 0; }
    fft(re, im, false);
    for (let i = 1; i < N / 2; i++) acc[i] += Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    cnt++;
  }
  if (!cnt) return null;
  for (let i = 0; i < acc.length; i++) acc[i] /= cnt;
  return acc;
}

function bandE(acc, sr, lo, hi, N) {
  const binHz = sr / N;
  const a = Math.max(1, Math.floor(lo / binHz));
  const b = Math.min(acc.length - 1, Math.ceil(hi / binHz));
  let s = 0;
  for (let i = a; i <= b; i++) s += acc[i] * acc[i];
  return s;
}

/**
 * 给一个音节打分：F2/F3 越强、低频越不闷、起始越有摩擦音，越像「冰」。
 */
function scoreNote(src, sr, nt) {
  const acc = spectrum(src, sr, nt.start, Math.max(0.06, Math.min(nt.dur, 0.5)));
  if (!acc) return -1;
  const N = 1024;
  const e1 = bandE(acc, sr, BANDS.f1[0], BANDS.f1[1], N);
  const e2 = bandE(acc, sr, BANDS.f2[0], BANDS.f2[1], N);
  const e3 = bandE(acc, sr, BANDS.f3[0], BANDS.f3[1], N);
  const ehi = bandE(acc, sr, BANDS.hi[0], BANDS.hi[1], N);
  const tot = e1 + e2 + e3 + ehi + 1e-12;
  const harmony = (e2 / tot) * 1.35 + (e3 / tot) * 0.7 + (ehi / tot) * 0.55;
  const mud = (e1 / tot) * 0.45;
  const centroid = (e2 / tot) * 2200 + (e3 / tot) * 3100 + (ehi / tot) * 4800;
  return { score: harmony - mud, centroid, f2: e2 / tot, ehi: ehi / tot };
}

/**
 * PSOLA：保持时长映射，把源波形的基频改到 targetF0，共振峰不动（不像重采样那样变花栗鼠）。
 * 关键点：源域取「一个源周期」，输出域铺「一个输出周期」——两边的窗宽必须不同，
 * 否则等于加窗平均，周期性会被洗掉（听起来就是气声/沙沙声）。
 */
export function psola(src, sr, srcF0, targetF0, outLen) {
  const out = new Float32Array(outLen);
  const norm = new Float32Array(outLen);
  if (!src.length || outLen <= 0) return out;

  const Ps = Math.max(2, Math.round(sr / Math.max(60, srcF0))); // 源周期（样点）
  const Po = Math.max(2, Math.round(sr / Math.max(70, targetF0))); // 目标周期（样点）
  const map = src.length / outLen; // 输出时间 → 源时间

  const win = (t, half) => 0.5 + 0.5 * Math.cos((Math.PI * t) / (half + 1));

  for (let o = 0; o < outLen; o += Po) {
    const sCenter = Math.round(o * map);
    // 源域：以 sCenter 为中心的一个源周期
    for (let i = -Ps; i <= Ps; i++) {
      const so = sCenter + i;
      if (so < 0 || so >= src.length) continue;
      const g = win(i, Ps);
      // 输出域：以 o 为中心的一个目标周期
      const oo = o + Math.round((i * Po) / Ps);
      if (oo < 0 || oo >= outLen) continue;
      out[oo] += src[so] * g;
      norm[oo] += g;
    }
  }
  for (let i = 0; i < outLen; i++) if (norm[i] > 0.35) out[i] /= norm[i];
  return out;
}

/**
 * 从原唱里挑母本，再给每个音符「借」一个真实音节。
 */
export function buildBank(src, sr, notes) {
  const scored = [];
  for (let i = 0; i < notes.length; i++) {
    const nt = notes[i];
    if (nt.dur < 0.09 || nt.f0 < 90 || nt.f0 > 900) continue;
    const s = scoreNote(src, sr, nt);
    if (!s || s.score <= 0) continue;
    scored.push({ i, nt, ...s });
  }
  scored.sort((a, b) => b.score - a.score);
  // 去重：相邻太近的同一个字不要重复当母本
  const bank = [];
  for (const c of scored) {
    if (bank.some((b) => Math.abs(b.nt.start - c.nt.start) < 0.55)) continue;
    bank.push(c);
    if (bank.length >= 24) break;
  }
  // 按亮度排一下，四组取不同亮度的
  bank.sort((a, b) => a.centroid - b.centroid);
  return bank;
}

/**
 * 把挑好的母本铺到整首歌的音符上。
 * group 1..4 → 从 bank 里按亮度四分位取四个不同的母本，保证四组听感不同。
 */
export function renderReslice(src, sr, notes, { gain = 1, group = 2, progress = () => {} } = {}) {
  const totalLen = notes.length ? Math.ceil((notes[notes.length - 1].start + notes[notes.length - 1].dur + 0.6) * sr) : 0;
  const out = new Float32Array(totalLen);
  if (!totalLen) return { data: out, count: 0, bank: 0 };

  const bank = buildBank(src, sr, notes);
  if (!bank.length) return { data: out, count: 0, bank: 0 };

  const pick = (g) => {
    const n = bank.length;
    const frac = (Math.min(4, Math.max(1, g)) - 1) / 3; // 0..1
    return bank[Math.min(n - 1, Math.round(frac * (n - 1)))];
  };
  const master = pick(group);

  let count = 0;
  for (let k = 0; k < notes.length; k++) {
    const nt = notes[k];
    if (k % 40 === 0) progress(0.45 + 0.5 * (k / notes.length));

    // 母本：默认用本组的那个，偶尔换成相邻亮度的母本，避免整首完全一个模子
    let src0 = master;
    if (bank.length > 1 && k % 7 === 5) {
      const alt = pick(group === 4 ? 3 : group + 1);
      if (alt && alt !== master) src0 = alt;
    }

    const pad = 0.03;
    const s0 = Math.max(0, Math.floor((src0.nt.start - pad) * sr));
    const s1 = Math.min(src.length, Math.floor((src0.nt.start + src0.nt.dur + 0.10) * sr));
    const chunk = src.subarray(s0, s1);
    if (chunk.length < 64) continue;

    // 目标长度：音符时长 + 一点鼻音余韵；PSOLA 一次性完成「变调 + 变长」，不再二次重采样
    const outLen = Math.max(Math.floor(0.10 * sr), Math.floor((nt.dur * 0.92 + 0.06) * sr));
    const dst = psola(chunk, sr, src0.nt.f0, nt.f0, outLen);
    if (!dst.length) continue;

    // 峰值定标到该音符的响度
    let peak = 1e-6;
    for (let i = 0; i < outLen; i++) peak = Math.max(peak, Math.abs(dst[i]));
    const target = Math.min(0.9, Math.max(0.08, nt.amp * 1.15)) * gain;
    const g = target / peak;

    // 两端淡入淡出，防爆音
    const fadeIn = Math.min(Math.floor(0.004 * sr), outLen >> 2);
    const fadeOut = Math.min(Math.floor(0.02 * sr), outLen >> 2);
    const at = Math.max(0, Math.floor(nt.start * sr));
    for (let i = 0; i < outLen; i++) {
      const j = at + i;
      if (j >= out.length) break;
      let w = 1;
      if (i < fadeIn) w = i / fadeIn;
      else if (i > outLen - fadeOut) w = (outLen - i) / fadeOut;
      out[j] += dst[i] * g * w;
    }
    count++;
  }

  progress(0.98);
  return { data: out, count, bank: bank.length };
}
