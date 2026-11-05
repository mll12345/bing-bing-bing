// vocals.js —— 立体声中置人声提取（STFT 相干性软掩蔽）
// 原理：录音里演唱几乎总在正中（L≈R），伴奏/混响偏向两侧。
// 对每帧每个频点算「中置占比」→ 软掩蔽 → 只留中置成分即人声，其余即伴奏。
// 单声道文件没有相位差可依，退化为无法分离，由调用方走叠加 + 原唱让位方案。
import { makeFFT } from './fft.js';

const N = 1024;
const HOP = 512;
const HALF = N >> 1;

/**
 * @param {Float32Array[]} chs 1 或 2 声道
 * @param {number} sr
 * @returns {{vocal:Float32Array[]|null, inst:Float32Array[], mono:Float32Array, centered:boolean}}
 */
export function separate(chs, sr, progress = () => {}) {
  const L = chs[0];
  const R = chs.length > 1 ? chs[1] : chs[0];
  const n = L.length;

  if (chs.length === 1) {
    const mono = Float32Array.from(L);
    return { vocal: null, inst: [Float32Array.from(L)], mono, centered: false };
  }

  const fft = makeFFT(N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

  const vL = new Float32Array(n);
  const vR = new Float32Array(n);
  const wsum = new Float32Array(n);
  const reM = new Float32Array(N);
  const imM = new Float32Array(N);
  const reS = new Float32Array(N);
  const imS = new Float32Array(N);

  const frames = Math.max(1, Math.ceil(Math.max(0, n - N) / HOP) + 1);
  const every = Math.max(1, Math.floor(frames / 50));

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    reM.fill(0); imM.fill(0); reS.fill(0); imS.fill(0);
    for (let i = 0; i < N; i++) {
      const j = off + i;
      const a = j < n ? L[j] : 0;
      const b = j < n ? R[j] : 0;
      const w = win[i];
      reM[i] = (a + b) * 0.5 * w; // mid
      reS[i] = (a - b) * 0.5 * w; // side
    }
    fft(reM, imM, false);
    fft(reS, imS, false);

    for (let k = 0; k <= HALF; k++) {
      const mr = reM[k], mi = imM[k];
      const sr2 = reS[k], si = imS[k];
      const pm = mr * mr + mi * mi;
      const ps = sr2 * sr2 + si * si;
      // 中置占比，平方收紧，压掉半中置的军鼓/贝斯残留
      let g = pm / (pm + ps + 1e-12);
      g *= g;
      const keep = 0.05 + 0.95 * g; // 留一点点原始 mid，避免齿音被切秃
      reM[k] *= keep; imM[k] *= keep;
      if (k > 0 && k < HALF) { reM[N - k] *= keep; imM[N - k] *= keep; }
    }

    fft(reM, imM, true);

    for (let i = 0; i < N; i++) {
      const j = off + i;
      if (j >= n) break;
      const v = reM[i] * win[i];
      vL[j] += v;
      vR[j] += v;
      wsum[j] += win[i] * win[i];
    }
    if (f % every === 0) progress((f / frames) * 0.9, '分离人声…');
  }

  for (let j = 0; j < n; j++) {
    const w = wsum[j] > 1e-6 ? 1 / wsum[j] : 0;
    vL[j] *= w;
    vR[j] *= w;
  }

  const iL = new Float32Array(n);
  const iR = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    iL[j] = clamp2(L[j] - vL[j]);
    iR[j] = clamp2(R[j] - vR[j]);
  }

  const mono = new Float32Array(n);
  for (let j = 0; j < n; j++) mono[j] = (vL[j] + vR[j]) * 0.5;

  progress(0.95, '分离人声…');
  return { vocal: [vL, vR], inst: [iL, iR], mono, centered: true };
}

const clamp2 = (v) => (v > 2 ? 2 : v < -2 ? -2 : v);
