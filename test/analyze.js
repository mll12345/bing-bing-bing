// analyze.js —— 读 WAV，做客观量测：BPM、kick 网格对齐、低频/高频能量、stutter 重复度
const fs = require('fs');

function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not RIFF');
  let off = 12, fmt = null, data = null;
  while (off < buf.length - 8) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = {
        ch: buf.readUInt16LE(off + 10),
        sr: buf.readUInt32LE(off + 12),
        bits: buf.readUInt16LE(off + 22),
      };
    } else if (id === 'data') {
      data = buf.subarray(off + 8, off + 8 + sz);
    }
    off += 8 + sz + (sz & 1);
  }
  const n = data.length / (fmt.bits / 8) / fmt.ch;
  const chans = Array.from({ length: fmt.ch }, () => new Float32Array(n));
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < fmt.ch; c++) {
      const idx = (i * fmt.ch + c) * 2;
      chans[c][i] = dv.getInt16(idx, true) / 32768;
    }
  }
  return { sr: fmt.sr, ch: fmt.ch, len: n, chans };
}

const a = (x) => Math.abs(x);
const fmt = (v, d = 4) => Number(v.toFixed(d));

function rms(x, s, e) { let t = 0; for (let i = s; i < e; i++) t += x[i] * x[i]; return Math.sqrt(t / (e - s)); }

function peak(x, s, e) { let m = 0; for (let i = s; i < e; i++) { const v = a(x[i]); if (v > m) m = v; } return m; }

// 简易一阶带通（用于分离低频 kick）
function lp(x, sr, fc) {
  const y = new Float32Array(x.length); const k = 1 - Math.exp(-2 * Math.PI * fc / sr); let s = 0;
  for (let i = 0; i < x.length; i++) { s += k * (x[i] - s); y[i] = s; }
  return y;
}
function hp(x, sr, fc) {
  const y = new Float32Array(x.length); const k = 1 - Math.exp(-2 * Math.PI * fc / sr); let s = 0;
  for (let i = 0; i < x.length; i++) { s += k * (x[i] - s); y[i] = x[i] - s; }
  return y;
}

function onsetEnv(x, sr, hopSec = 0.005) {
  const hop = Math.round(sr * hopSec);
  const frames = Math.floor(x.length / hop);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) env[f] = rms(x, f * hop, Math.min(x.length, (f + 1) * hop));
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) { const d = env[f] - env[f - 1]; flux[f] = d > 0 ? d : 0; }
  return { env, flux, hopSec };
}

function bestBpm(flux, hopSec, lo = 60, hi = 200) {
  const minLag = Math.round((60 / hi) / hopSec), maxLag = Math.round((60 / lo) / hopSec);
  let best = 0, bestS = -1; const scores = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = lag; i < flux.length; i++) acc += flux[i] * flux[i - lag];
    acc /= (flux.length - lag);
    scores.push([lag, acc]);
    if (acc > bestS) { bestS = acc; best = lag; }
  }
  return { bpm: fmt(60 / (best * hopSec), 1), lag: best, scores };
}

const file = process.argv[2];
const { sr, ch, len, chans } = readWav(file);
const L = chans[0], R = chans[1] || chans[0];
const mono = new Float32Array(len);
for (let i = 0; i < len; i++) mono[i] = (L[i] + R[i]) / 2;

const report = { file, sr, ch, durSec: fmt(len / sr, 2), peak: fmt(peak(mono, 0, len)), rms: fmt(rms(mono, 0, len)) };

// ---- 低频（kick）/ 高频（hat）能量占比 ----
const lowB = lp(mono, sr, 120);
const highB = hp(mono, sr, 6000);
const lowRms = rms(lowB, 0, len), highRms = rms(highB, 0, len);
report.lowEnergy = fmt(lowRms), report.highEnergy = fmt(highRms);
report.lowRatio = fmt(lowRms / (report.rms || 1), 3);
report.highRatio = fmt(highRms / (report.rms || 1), 3);

// ---- BPM ----
const { env, flux, hopSec } = onsetEnv(lowB, sr, 0.005);
report.bpmLowBand = bestBpm(flux, hopSec).bpm;

// 全频带 onset
const all = onsetEnv(mono, sr, 0.005);
report.bpmFull = bestBpm(all.flux, hopSec).bpm;

// ---- kick 网格：flux 加权的圆均值，测「低频打击点整体是否落在网格上」 ----
const lockZero = process.argv.includes('--lock');
const bpm = report.bpmFull;
const beat = 60 / bpm;

// flux 加权相位（比挑峰更抗噪：低音通奏不会被当成鼓点）
function weightedPhase(flux, beat, hopSec) {
  let sx = 0, sy = 0, sw = 0;
  for (let i = 1; i < flux.length; i++) {
    const w = flux[i];
    if (w <= 0) continue;
    const ang = ((i * hopSec) % beat) / beat * 2 * Math.PI;
    sx += Math.cos(ang) * w; sy += Math.sin(ang) * w; sw += w;
  }
  const phase = Math.atan2(sy, sx) / (2 * Math.PI) * beat;
  const strength = Math.hypot(sx, sy) / (sw || 1); // 0 = 完全散开，1 = 全在同一相位
  return { phase: (phase + beat) % beat, strength };
}

const wp = weightedPhase(flux, beat, hopSec);
report.gridPhaseMs = fmt(wp.phase * 1000, 1);
report.gridStrength = fmt(wp.strength, 3);
// 与 t=0 网格的相位差（合成鼓组就打在 0 上），折算成毫秒
const off = Math.min(wp.phase, beat - wp.phase);
report.gridOffsetMs = fmt(off * 1000, 1);

// 旧指标保留（挑峰统计），便于对比
const th = Math.max(...flux) * 0.35;
const peaks = [];
for (let i = 2; i < flux.length - 2; i++) {
  if (flux[i] > th && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1]) {
    const t = i * hopSec;
    if (!peaks.length || t - peaks[peaks.length - 1] > 0.12) peaks.push(t);
  }
}
let bestPhase = 0, bestScore = -1;
if (lockZero) {
  bestPhase = 0;
} else {
  for (let p = 0; p < beat; p += 0.002) {
    let sc = 0;
    for (const t of peaks) {
      const ph = ((t - p) % beat + beat) % beat;
      sc += Math.cos((ph / beat) * 2 * Math.PI);
    }
    if (sc > bestScore) { bestScore = sc; bestPhase = p; }
  }
}
let devSum = 0, onGrid = 0;
for (const t of peaks) {
  const ph = ((t - bestPhase) % beat + beat) % beat;
  const d = Math.min(ph, beat - ph);
  devSum += d;
  if (d < 0.035) onGrid++;
}
report.onsetPeaks = peaks.length;
report.gridOnsetRatio = fmt(onGrid / (peaks.length || 1), 3);
report.meanGridDeviationMs = fmt((devSum / (peaks.length || 1)) * 1000, 1);

// ---- 段首/尾：前奏是否非静音、结尾是否淡出 ----
const seg = (s, e) => fmt(rms(mono, Math.floor(s * sr), Math.min(len, Math.floor(e * sr))));
report.introRms = seg(0, 1.2);
report.midRms = seg(report.durSec / 2, report.durSec / 2 + 1.2);
report.tailRms = seg(report.durSec - 1.2, report.durSec);
report.last100msRms = seg(report.durSec - 0.1, report.durSec);

// ---- 削波计数 ----
let clipped = 0;
for (let i = 0; i < len; i++) if (a(mono[i]) > 0.995) clipped++;
report.clippedSamples = clipped;

// ---- 频谱平衡（用零交叉近似亮暗） ----
let zc = 0;
for (let i = 1; i < len; i++) if ((mono[i - 1] < 0) !== (mono[i] < 0)) zc++;
report.zeroCrossRate = fmt(zc / (len / sr), 0);

console.log(JSON.stringify(report, null, 2));
