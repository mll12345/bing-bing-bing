// ref-cut.mjs —— 把参考音频切成单个「冰」，按基频归成四组，导出母本池
import fs from 'node:fs';
import { pitchTrack } from '../src/voice.js';

const SR = 44100;
const raw = new Float32Array(fs.readFileSync('test/ref.f32').buffer.slice(0));
const n = Math.floor(raw.length / 2);
const mono = new Float32Array(n);
for (let i = 0; i < n; i++) mono[i] = (raw[i * 2] + raw[i * 2 + 1]) / 2;

// 2ms 包络
const hop = Math.floor(SR * 0.002);
const env = [];
for (let p = 0; p + hop <= n; p += hop) {
  let s = 0;
  for (let i = 0; i < hop; i++) s += mono[p + i] * mono[p + i];
  env.push(Math.sqrt(s / hop));
}
const sm = env.map((v, i) => {
  let a = 0; let c = 0;
  for (let k = -3; k <= 3; k++) { const j = i + k; if (j >= 0 && j < env.length) { a += env[j]; c++; } }
  return a / c;
});
const mx = Math.max(...sm);

// 有声片段
const regs = [];
let st = -1;
for (let i = 0; i < sm.length; i++) {
  if (st < 0 && sm[i] > mx * 0.14) st = i;
  else if (st >= 0 && sm[i] < mx * 0.07) { if (i - st > 15) regs.push([st, i]); st = -1; }
}
if (st >= 0) regs.push([st, sm.length]);

const track = pitchTrack(mono, SR, () => {});
const f0At = (t) => {
  const i = Math.round(t / track.hopSec);
  let best = 0; let bc = 0;
  for (let k = -3; k <= 3; k++) {
    const j = i + k;
    if (j >= 0 && j < track.frames && track.clarity[j] > bc) { bc = track.clarity[j]; best = track.f0[j]; }
  }
  return bc > 0.4 ? best : 0;
};

// 每段内部按谷点切成单字：谷点 = 局部极小且低于段峰值 70%（这些三连「冰冰冰」的谷不深）
const cuts = [];
for (const [a, b] of regs) {
  let pk = 0;
  for (let i = a; i < b; i++) pk = Math.max(pk, sm[i]);
  let cur = a;
  for (let i = a + 12; i < b - 12; i++) {
    if (sm[i] > pk * 0.72) continue;
    if (!(sm[i] <= sm[i - 1] && sm[i] <= sm[i + 1])) continue;
    let lo = true;
    for (let k = 1; k <= 8; k++) if (sm[i - k] < sm[i] || sm[i + k] < sm[i]) { lo = false; break; }
    if (!lo) continue;
    cuts.push([cur, i]);
    cur = i;
  }
  cuts.push([cur, b]);
}

// 过滤 + 求每个字的 f0
const syl = [];
for (const [a, b] of cuts) {
  const t0 = (a * hop) / SR;
  const t1 = (b * hop) / SR;
  const dur = t1 - t0;
  if (dur < 0.10 || dur > 0.45) continue;
  let pk = 0;
  for (let p = Math.floor(t0 * SR); p < Math.floor(t1 * SR); p++) pk = Math.max(pk, Math.abs(mono[p]));
  if (pk < mx * 0.25) continue;
  const f0s = [];
  for (let t = t0 + 0.02; t < t1 - 0.02; t += 0.01) { const f = f0At(t); if (f > 150 && f < 1000) f0s.push(f); }
  if (f0s.length < 3) continue;
  f0s.sort((x, y) => x - y);
  const f0 = f0s[f0s.length >> 1];
  syl.push({ t0, t1, dur, f0, peak: pk });
}
console.log('raw syllables', syl.length);
syl.forEach((s, i) => console.log(`${String(i + 1).padStart(2)} ${s.t0.toFixed(3)}-${s.t1.toFixed(3)} dur=${s.dur.toFixed(2)} f0=${s.f0.toFixed(0)} pk=${s.peak.toFixed(2)}`));

// 按 f0 升序排，等分成 4 组（每组取最靠近该组中位音高的那个母本，音质最好）
syl.sort((a, b) => a.f0 - b.f0);
const groups = [];
const per = Math.max(1, Math.floor(syl.length / 4));
for (let g = 0; g < 4; g++) {
  const slice = syl.slice(g * per, g === 3 ? syl.length : (g + 1) * per);
  if (!slice.length) continue;
  // 取该组内峰值最大的（最干净）
  slice.sort((a, b) => b.peak - a.peak);
  groups.push({ group: g + 1, ...slice[0] });
}
console.log('--- groups');
groups.forEach((g) => console.log(`组${g.group} f0=${g.f0.toFixed(0)} ${g.t0.toFixed(3)}-${g.t1.toFixed(3)}`));

// 导出母本池：每个候选音节一段 f32 + 元数据
const pool = [];
for (const s of syl) {
  const a = Math.max(0, Math.floor((s.t0 - 0.01) * SR));
  const b = Math.min(n, Math.floor((s.t1 + 0.03) * SR));
  pool.push({ f0: s.f0, dur: s.dur, data: mono.subarray(a, b) });
}
fs.mkdirSync('test/out', { recursive: true });
fs.writeFileSync('test/out/ref-pool.json', JSON.stringify({
  sr: SR,
  groups: groups.map((g) => ({ group: g.group, f0: g.f0, t0: g.t0, t1: g.t1 })),
  pool: pool.map((p) => ({ f0: p.f0, dur: p.dur, len: p.data.length })),
}, null, 2));

// 拼接池子成一个大 f32 便于网页加载
let total = 0;
for (const p of pool) total += p.data.length;
const big = new Float32Array(total);
let off = 0;
const idx = [];
for (const p of pool) { big.set(p.data, off); idx.push({ off, len: p.data.length, f0: p.f0, dur: p.dur }); off += p.data.length; }
fs.writeFileSync('test/out/ref-pool.f32', Buffer.from(big.buffer));
fs.writeFileSync('test/out/ref-pool.idx.json', JSON.stringify({ sr: SR, groups: groups.map((g) => ({ group: g.group, f0: g.f0, t0: g.t0, t1: g.t1 })), syllables: idx }, null, 2));
console.log('pool', pool.length, 'samples', total, (total / SR).toFixed(2) + 's');
