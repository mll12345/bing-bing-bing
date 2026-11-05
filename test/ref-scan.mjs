// ref-scan.mjs —— 扫描参考音频里所有「冰」的候选：分段 RMS + 基频 + 时长
import fs from 'node:fs';
import { pitchTrack } from '../src/voice.js';

const SR = 44100;
const raw = new Float32Array(fs.readFileSync(process.argv[2]).buffer.slice(0));
const n = Math.floor(raw.length / 2);
const mono = new Float32Array(n);
for (let i = 0; i < n; i++) mono[i] = (raw[i * 2] + raw[i * 2 + 1]) / 2;

// 10ms 一格的 RMS
const hop = Math.floor(SR * 0.01);
const rms = [];
for (let p = 0; p + hop <= n; p += hop) {
  let s = 0;
  for (let i = 0; i < hop; i++) s += mono[p + i] * mono[p + i];
  rms.push(Math.sqrt(s / hop));
}
const mx = Math.max(...rms);
const thr = mx * 0.10;
const segs = [];
let st = -1;
for (let i = 0; i < rms.length; i++) {
  const on = rms[i] > thr;
  if (on && st < 0) st = i;
  if (!on && st >= 0) { if (i - st >= 4) segs.push([st, i]); st = -1; }
}
if (st >= 0) segs.push([st, rms.length]);

const track = pitchTrack(mono, SR, () => {});
console.log('mono dur', (n / SR).toFixed(3), 'maxRms', mx.toFixed(4), 'segments', segs.length);
for (const [a, b] of segs) {
  const t0 = a * 0.01;
  const t1 = b * 0.01;
  // 该段的基频中位数
  const f0s = [];
  for (let i = 0; i < track.frames; i++) {
    const t = i * track.hopSec;
    if (t >= t0 && t <= t1 && track.clarity[i] > 0.5 && track.f0[i] > 60) f0s.push(track.f0[i]);
  }
  f0s.sort((x, y) => x - y);
  const med = f0s.length ? f0s[f0s.length >> 1] : 0;
  let pk = 0;
  for (let p = Math.floor(t0 * SR); p < Math.floor(t1 * SR); p++) pk = Math.max(pk, Math.abs(mono[p]));
  console.log(`seg ${t0.toFixed(2)}-${t1.toFixed(2)} dur=${(t1 - t0).toFixed(2)} f0=${med.toFixed(0)} peak=${pk.toFixed(3)}`);
}
