// ref-split.mjs —— 把参考音频切成单个「冰」音节：能量包络谷点切分
import fs from 'node:fs';
import { pitchTrack } from '../src/voice.js';

const SR = 44100;
const raw = new Float32Array(fs.readFileSync(process.argv[2]).buffer.slice(0));
const n = Math.floor(raw.length / 2);
const mono = new Float32Array(n);
for (let i = 0; i < n; i++) mono[i] = (raw[i * 2] + raw[i * 2 + 1]) / 2;

// 3ms 包络（带一点平滑，抗单点噪声）
const hop = Math.floor(SR * 0.003);
const env = [];
for (let p = 0; p + hop <= n; p += hop) {
  let s = 0;
  for (let i = 0; i < hop; i++) s += mono[p + i] * mono[p + i];
  env.push(Math.sqrt(s / hop));
}
const sm = env.map((v, i) => {
  let a = 0; let c = 0;
  for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < env.length) { a += env[j]; c++; } }
  return a / c;
});
const mx = Math.max(...sm);
const onThr = mx * 0.12;   // 起点阈值
const offThr = mx * 0.16;  // 谷点阈值

// 先找「有声区间」
const regs = [];
let st = -1;
for (let i = 0; i < sm.length; i++) {
  if (st < 0 && sm[i] > onThr) st = i;
  else if (st >= 0 && sm[i] < offThr * 0.5) { regs.push([st, i]); st = -1; }
}
if (st >= 0) regs.push([st, sm.length]);

// 每个有声区间内部按谷点再切
function splits(a, b) {
  const out = [];
  let cur = a;
  for (let i = a + 3; i < b - 3; i++) {
    const isMin = sm[i] <= sm[i - 1] && sm[i] <= sm[i + 1] && sm[i] < sm[i - 3] && sm[i] < sm[i + 3];
    if (!isMin) continue;
    if (sm[i] > mx * 0.42) continue; // 谷必须明显下陷
    if (i - cur < 8) continue;       // 至少 24ms
    out.push([cur, i]);
    cur = i;
  }
  if (b - cur >= 8) out.push([cur, b]);
  return out;
}

const track = pitchTrack(mono, SR, () => {});
const all = [];
for (const [a, b] of regs) for (const s of splits(a, b)) all.push(s);

let idx = 0;
for (const [a, b] of all) {
  const t0 = a * 0.003;
  const t1 = b * 0.003;
  const f0s = [];
  for (let i = 0; i < track.frames; i++) {
    const t = i * track.hopSec;
    if (t >= t0 && t <= t1 && track.clarity[i] > 0.45 && track.f0[i] > 60) f0s.push(track.f0[i]);
  }
  f0s.sort((x, y) => x - y);
  const med = f0s.length ? f0s[f0s.length >> 1] : 0;
  let pk = 0;
  for (let p = Math.floor(t0 * SR); p < Math.floor(t1 * SR); p++) pk = Math.max(pk, Math.abs(mono[p]));
  const dur = t1 - t0;
  idx++;
  console.log(`${String(idx).padStart(2)} ${t0.toFixed(3)}-${t1.toFixed(3)} dur=${dur.toFixed(2)} f0=${med.toFixed(0)} peak=${pk.toFixed(2)} ${dur < 0.18 ? 'short' : ''}`);
}
console.log('total', all.length);
