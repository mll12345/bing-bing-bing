// voice.js —— 把人声旋律「唱成冰」
// 1) FFT 自相关逐帧基频跟踪（16kHz，10ms 步长）
// 2) 连续浊音帧 → 音符（一个音符 = 一个字 = 一个「冰」）
// 3) 每个音符用共振峰合成一个 /piŋ/（冰），基频锁在该音符的音高上
import { makeFFT } from './fft.js';
import { resample, biquad } from './pcm.js';

const PITCH_SR = 16000;
const N = 1024;
const HOP = 160; // 10ms @16k

/** 逐帧基频跟踪 → {f0, clarity, rms, hopSec, frames} */
export function pitchTrack(mono, sr, progress = () => {}) {
  const factor = sr / PITCH_SR;
  const x = Math.abs(factor - 1) < 1e-6 ? mono : resample(mono, factor);
  const n = x.length;
  const frames = Math.max(1, Math.floor((n - N) / HOP) + 1);

  const fft = makeFFT(N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

  const re = new Float32Array(N);
  const im = new Float32Array(N);

  const minLag = Math.max(2, Math.floor(PITCH_SR / 720));
  const maxLag = Math.min((N >> 1) - 2, Math.floor(PITCH_SR / 62));

  const f0 = new Float32Array(frames);
  const clarity = new Float32Array(frames);
  const rms = new Float32Array(frames);

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    let e = 0;
    for (let i = 0; i < N; i++) {
      const j = off + i;
      const v = j < n ? x[j] : 0;
      re[i] = v * win[i];
      im[i] = 0;
      e += v * v;
    }
    rms[f] = Math.sqrt(e / N);

    fft(re, im, false);
    for (let k = 0; k < N; k++) {
      re[k] = re[k] * re[k] + im[k] * im[k];
      im[k] = 0;
    }
    fft(re, im, true);

    const r0 = re[0] || 1e-12;
    let best = 0;
    let bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const v = re[lag];
      if (v > best) { best = v; bestLag = lag; }
    }

    // 倍频纠正：若 lag/2、lag/3 处也够强，真周期更短
    for (const div of [2, 3]) {
      const l2 = bestLag / div;
      if (l2 < minLag) continue;
      const lo = Math.round(l2);
      const c = Math.max(re[lo] || 0, re[lo + 1] || 0);
      if (c > best * 0.86) { best = c; bestLag = l2; break; }
    }

    clarity[f] = Math.max(0, Math.min(1, best / r0));
    if (bestLag >= 1) {
      const i0 = Math.max(1, Math.min(N - 2, Math.round(bestLag)));
      const y0 = re[i0 - 1] || 0;
      const y1 = re[i0] || 1e-12;
      const y2 = re[i0 + 1] || 0;
      const den = y0 - 2 * y1 + y2;
      let shift = den !== 0 ? (0.5 * (y0 - y2)) / den : 0;
      if (shift > 1) shift = 1; else if (shift < -1) shift = -1;
      f0[f] = PITCH_SR / (i0 + shift);
    }
    if (f % 500 === 0) progress(0.3 * (f / frames), '听旋律…');
  }

  return { f0, clarity, rms, hopSec: HOP / PITCH_SR, frames };
}

const semi = (a, b) => 12 * Math.log2(Math.max(1, a) / Math.max(1, b));

/** 连续浊音帧 → 音符；一个音符 = 一个字 = 一个「冰」 */
export function toNotes(track, { minDur = 0.07, clarityMin = 0.26, jumpSemis = 1.4 } = {}) {
  const { f0, clarity, rms, hopSec, frames } = track;
  const notes = [];
  let i = 0;
  while (i < frames) {
    if (clarity[i] < clarityMin || rms[i] < 0.0035) { i++; continue; }
    let j = i + 1;
    let sum = f0[i];
    let cnt = 1;
    let eSum = rms[i];
    while (j < frames) {
      if (clarity[j] < clarityMin * 0.8 || rms[j] < 0.0025) break;
      if (semi(f0[j], sum / cnt) > jumpSemis) break;
      // 音量骤降 = 换字（同音高连唱时靠这个断开，保证「一个字一个冰」）
      if (j > i + 2 && rms[j] < 0.55 * (eSum / cnt)) break;
      sum += f0[j]; cnt++; eSum += rms[j]; j++;
    }
    const dur = (j - i) * hopSec;
    if (dur >= minDur) {
      // 中位数抗八度跳变
      const arr = Array.from(f0.slice(i, j)).sort((a, b) => a - b);
      let med = arr[arr.length >> 1];
      if (!(med >= 60) || !(med <= 800)) med = arr[arr.length >> 1] || 200;
      med = Math.max(65, Math.min(760, med));
      // 低于 82Hz 基本是贝斯/底鼓漏进来的人声，不是字
      if (med < 82) { i = Math.max(j, i + 1); continue; }
      let a = 0;
      for (let k = i; k < j; k++) a += rms[k] * rms[k];
      notes.push({ start: i * hopSec, dur, f0: med, amp: Math.sqrt(a / (j - i)) });
    }
    i = Math.max(j, i + 1);
  }

  // 合并 45ms 内的极短空隙 + 音高相近的碎片（避免一个长音被切成好几个冰）
  const merged = [];
  for (const nt of notes) {
    const p = merged[merged.length - 1];
    if (p && nt.start - (p.start + p.dur) < 0.045 && Math.abs(semi(nt.f0, p.f0)) < 1.2) {
      const total = p.dur + nt.dur + (nt.start - (p.start + p.dur));
      p.f0 = (p.f0 * p.dur + nt.f0 * nt.dur) / (p.dur + nt.dur);
      p.amp = Math.max(p.amp, nt.amp);
      p.dur = total;
    } else {
      merged.push({ ...nt });
    }
  }
  return merged;
}

/* ================= 共振峰合成 /piŋ/ ================= */

const TIMBRES = {
  1: { name: '清脆', scale: 1.16, f1: 305, f2: 2560, f3: 3200, f4: 3950, nasF: 1480, tilt: 0.9 },
  2: { name: '中性', scale: 1.0, f1: 282, f2: 2300, f3: 2980, f4: 3720, nasF: 1310, tilt: 1.1 },
  3: { name: '厚实', scale: 0.92, f1: 262, f2: 2060, f3: 2720, f4: 3520, nasF: 1190, tilt: 1.3 },
};

const cycleCache = new Map();

/** 生成一个音高周期的「冰」谐波形态（歌声滤波后的单周期表） */
function cycles(sr, f0, timbreId) {
  const T = TIMBRES[timbreId] || TIMBRES[2];
  const f = Math.max(60, Math.min(800, f0));
  const key = `${sr}|${Math.round(f * 2) / 2}|${timbreId}`;
  const hit = cycleCache.get(key);
  if (hit) return hit;

  const L = Math.max(24, Math.round(sr / f));
  const CY = 14;
  const total = L * CY;
  const src = new Float32Array(total);

  // 声门源：Rosenberg 型脉冲，去直流
  const open = 0.42;
  let mean = 0;
  for (let c = 0; c < CY; c++) {
    for (let i = 0; i < L; i++) {
      const p = i / L;
      let v;
      if (p < open) {
        const q = p / open;
        v = Math.sin(Math.PI * q) ** 2;
      } else {
        const q = (p - open) / (1 - open);
        v = 0.1 * Math.exp(-7 * q);
      }
      src[c * L + i] = v;
    }
  }
  for (let i = 0; i < total; i++) mean += src[i];
  mean /= total;
  for (let i = 0; i < total; i++) src[i] -= mean;

  const bandpass = (input, freq, q, gain) => {
    const tmp = Float32Array.from(input);
    biquad(tmp, sr, 'bandpass', Math.max(60, freq), q, 0);
    // 每条共振带单独归一到单位 RMS，再按共振峰幅度加权 ——
    // 否则声门源 1/f 衰减会让 F2/F3 弱到听不见，只剩一个闷闷的嗡声。
    let s = 0;
    for (let i = 0; i < total; i++) s += tmp[i] * tmp[i];
    const r = Math.sqrt(s / total);
    const k = r > 1e-9 ? gain / r : 0;
    for (let i = 0; i < total; i++) tmp[i] *= k;
    return tmp;
  };

  // 元音 /i/：F1 约 300（i 的特征），F2 很高，F3/F4 提供「清脆」的齿音区
  const vowel = new Float32Array(total);
  for (const b of [
    bandpass(src, T.f1 * T.scale, 4.0, 1.0),
    bandpass(src, T.f2 * T.scale, 6.0, 0.62),
    bandpass(src, T.f3 * T.scale, 8.0, 0.34),
    bandpass(src, T.f4 * T.scale, 10, 0.16),
  ]) for (let i = 0; i < total; i++) vowel[i] += b[i];

  // 鼻音尾部 /ŋ/：F2 塌到鼻腔共振，加低频嗡嗡
  const nasal = new Float32Array(total);
  for (const b of [
    bandpass(src, 330, 3.2, 0.9),
    bandpass(src, T.nasF, 4.0, 0.5),
    bandpass(src, 250 * T.scale, 2.8, 0.7),
    bandpass(src, T.f3 * 0.84, 7.0, 0.2),
  ]) for (let i = 0; i < total; i++) nasal[i] += b[i];

  // 取最后一个整周期（滤波器已稳定）
  const off = (CY - 1) * L;
  const vOut = vowel.slice(off, off + L);
  const nOut = nasal.slice(off, off + L);
  norm(vOut);
  norm(nOut);
  const pack = { L, vowel: vOut, nasal: nOut };
  if (cycleCache.size > 4096) cycleCache.clear();
  cycleCache.set(key, pack);
  return pack;
}

function norm(a) {
  let p = 1e-9;
  for (let i = 0; i < a.length; i++) p = Math.max(p, Math.abs(a[i]));
  const g = 1 / p;
  for (let i = 0; i < a.length; i++) a[i] *= g;
  return a;
}

const readCycle = (tab, phase01) => {
  const L = tab.L;
  const p = phase01 * L;
  const i0 = p | 0;
  const fr = p - i0;
  const a = tab.c[i0 % L];
  const b = tab.c[(i0 + 1) % L];
  return a + (b - a) * fr;
};

/** 生成一个「冰」音节 */
export function synthBing({ sr, f0, dur, amp = 1, timbre = 2, fromF0 = 0 }) {
  const n = Math.max(64, Math.round(dur * sr));
  const target = Math.max(65, Math.min(760, f0));
  const from = fromF0 > 0 ? Math.max(65, Math.min(760, fromF0)) : target * 0.93;

  const A = cycles(sr, from, timbre);
  const B = cycles(sr, target, timbre);
  const ta = { L: A.L, c: A.vowel };
  const tb = { L: B.L, c: B.vowel };
  const na = { L: A.L, c: A.nasal };
  const nb = { L: B.L, c: B.nasal };

  const out = new Float32Array(n);
  const glide = Math.min(0.06, dur * 0.55);
  const vibStart = Math.max(0.09, dur * 0.35);
  const nasalAt = Math.round(n * 0.66);
  const fade = Math.max(8, Math.round(n * 0.09));

  let phA = 0;
  let phB = 0;

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let g = glide > 0 ? Math.min(1, t / glide) : 1;
    g = g * g * (3 - 2 * g);

    let vib = 0;
    if (t > vibStart) vib = 0.0065 * Math.sin(2 * Math.PI * 5.2 * (t - vibStart)) * Math.min(1, (t - vibStart) / 0.18);

    // phase 单位是「周期」(0..1)，readCycle 再乘表长 → 增量必须是 f/sr
    phA += (Math.min(760, Math.max(65, from)) / sr) * (1 + vib);
    phB += (Math.min(760, Math.max(65, target)) / sr) * (1 + vib);
    phA -= Math.floor(phA); phB -= Math.floor(phB);

    const v = readCycle(ta, phA) * (1 - g) + readCycle(tb, phB) * g;
    const nz = readCycle(na, phA) * (1 - g) + readCycle(nb, phB) * g;

    let w = 0;
    if (i >= nasalAt) {
      w = Math.min(1, (i - nasalAt) / fade);
      w = w * w * (3 - 2 * w);
    }
    out[i] = v * (1 - w) + nz * w;
  }

  // 辅音 /p/ 爆破
  const burstLen = Math.max(8, Math.min(Math.round(0.014 * sr), (n / 5) | 0));
  const burst = new Float32Array(burstLen * 6);
  let seed = 86420;
  for (let i = 0; i < burst.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    burst[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  biquad(burst, sr, 'bandpass', 1500, 1.4);
  for (let i = 0; i < burstLen; i++) {
    out[i] += burst[burstLen + i] * 0.34 * Math.exp(-i / (0.004 * sr));
  }

  // 包络
  const atk = Math.max(4, Math.round(0.007 * sr));
  const rel = Math.max(6, Math.round(Math.min(0.055, dur * 0.4) * sr));
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const gNorm = amp / peak;
  for (let i = 0; i < n; i++) {
    let e = gNorm;
    if (i < atk) e *= i / atk;
    if (i > n - rel) e *= Math.max(0, (n - i) / rel);
    out[i] *= e;
  }
  return out;
}

/**
 * 音符序列 → 整条冰声轨
 * @returns {{data:Float32Array, count:number}}
 */
export function renderBingTrack(notes, sr, len, { gain = 1, timbre = 2, progress = () => {} } = {}) {
  const data = new Float32Array(len);
  let prevF0 = 0;
  notes.forEach((nt, idx) => {
    const at = Math.round(nt.start * sr);
    if (at >= len) return;
    const amp = Math.min(1.15, Math.max(0.12, nt.amp * 8)) * gain;
    const buf = synthBing({
      sr,
      f0: nt.f0,
      dur: Math.min(nt.dur + 0.03, 6),
      amp,
      timbre,
      fromF0: idx > 0 ? prevF0 : 0,
    });
    const m = Math.min(buf.length, len - at);
    for (let i = 0; i < m; i++) data[at + i] += buf[i];
    prevF0 = nt.f0;
    if (idx % 80 === 0) progress(0.55 + 0.25 * (idx / Math.max(1, notes.length)), '唱冰…');
  });
  return { data, count: notes.length };
}
