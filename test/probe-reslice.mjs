// probe-reslice.mjs —— 检查「借来的冰」是不是真嗓音：周期性 + 反测基频 + 谱峰
import fs from 'node:fs';
import { makeFFT } from '../src/fft.js';
import { pitchTrack } from '../src/voice.js';

const FILE = process.argv[2];
const SR = 48000;

function readWav(p) {
  const b = fs.readFileSync(p);
  let off = 12;
  let data = null;
  while (off < b.length - 8) {
    const id = b.toString('ascii', off, off + 4);
    const sz = b.readUInt32LE(off + 4);
    if (id === 'data') { data = b.subarray(off + 8, off + 8 + sz); break; }
    off += 8 + sz + (sz & 1);
  }
  const n = data.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data.readInt16LE(i * 2) / 32768;
  return out;
}

const x = readWav(FILE);

// 1) 周期性：自相关在 lag∈[2ms,15ms] 的最大值 / 零延迟
function periodicity(seg) {
  let r0 = 0;
  for (let i = 0; i < seg.length; i++) r0 += seg[i] * seg[i];
  if (r0 < 1e-9) return 0;
  let best = 0;
  const lo = Math.floor(SR * 0.002);
  const hi = Math.floor(SR * 0.015);
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0;
    for (let i = 0; i < seg.length - lag; i += 2) s += seg[i] * seg[i + lag];
    const r = s / r0 * (seg.length / (seg.length - lag));
    if (r > best) best = r;
  }
  return best;
}
// 取最响的 8 个窗口平均
const W = Math.floor(SR * 0.06);
const scores = [];
for (let p = 0; p + W < x.length; p += W) {
  let e = 0;
  for (let i = 0; i < W; i++) e += x[p + i] * x[p + i];
  scores.push({ p, e });
}
scores.sort((a, b) => b.e - a.e);
const top = scores.slice(0, 8);
const per = top.map((s) => periodicity(x.subarray(s.p, s.p + W)));
const avg = per.reduce((a, b) => a + b, 0) / per.length;

// 2) 反测基频
const track = pitchTrack(x, SR, () => {});
const f0 = [];
for (let i = 0; i < track.f0.length; i++) if (track.clarity[i] > 0.5 && track.f0[i] > 60) f0.push(track.f0[i]);
f0.sort((a, b) => a - b);
const med = f0.length ? f0[f0.length >> 1] : 0;

// 3) 最响窗口谱峰
const seg = x.subarray(top[0].p, top[0].p + 2048);
const N = 2048;
const fft = makeFFT(N);
const re = new Float32Array(N); const im = new Float32Array(N);
for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)); re[i] = (seg[i] || 0) * w; }
fft(re, im, false);
const mag = [];
for (let i = 1; i < N / 2; i++) mag.push({ hz: Math.round((i * SR) / N), m: Math.hypot(re[i], im[i]) });
mag.sort((a, b) => b.m - a.m);
const peaks = mag.slice(0, 6).map((p) => p.hz);

console.log(JSON.stringify({
  file: FILE,
  durSec: +(x.length / SR).toFixed(2),
  periodicity: +avg.toFixed(3),
  periodicityEach: per.map((v) => +v.toFixed(3)),
  f0Median: +med.toFixed(0),
  f0Range: f0.length ? [+f0[0].toFixed(0), +f0[f0.length - 1].toFixed(0)] : null,
  voicedFrames: f0.length,
  peaks,
}, null, 2));
