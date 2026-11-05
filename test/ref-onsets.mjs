// ref-onsets.mjs —— 用起音检测切参考音频里的每一个「冰」
// 每个「冰」的特征：10ms 内能量陡升（/p/ 爆破 + 元音进入），之后 150-200ms 衰减。
import fs from 'node:fs';
import { pitchTrack } from '../src/voice.js';

const SR = 44100;
const raw = new Float32Array(fs.readFileSync('test/ref.f32').buffer.slice(0));
const n = Math.floor(raw.length / 2);
const mono = new Float32Array(n);
for (let i = 0; i < n; i++) mono[i] = (raw[i * 2] + raw[i * 2 + 1]) / 2;

const hop = Math.floor(SR * 0.005); // 5ms
const env = [];
for (let p = 0; p + hop <= n; p += hop) {
  let s = 0;
  for (let i = 0; i < hop; i++) s += mono[p + i] * mono[p + i];
  env.push(Math.sqrt(s / hop));
}
const mx = Math.max(...env);

// 起音：5ms 内升幅 > 全局峰值的 25%，且此前 20ms 平均低于当前一半
const onsets = [];
for (let i = 3; i < env.length; i++) {
  const rise = env[i] - env[i - 2];
  if (rise < mx * 0.22) continue;
  if (env[i] < mx * 0.30) continue;
  let before = 0;
  for (let k = i - 5; k < i - 1; k++) if (k >= 0) before += env[k];
  before /= 4;
  if (before > env[i] * 0.6) continue;
  if (onsets.length && (i - onsets[onsets.length - 1]) * 0.005 < 0.10) continue;
  onsets.push(i);
}

const track = pitchTrack(mono, SR, () => {});
const f0Near = (t) => {
  const i = Math.round(t / track.hopSec);
  const vals = [];
  for (let k = 1; k <= 8; k++) {
    const j = i + k;
    if (j < track.frames && track.clarity[j] > 0.45 && track.f0[j] > 150 && track.f0[j] < 1000) vals.push(track.f0[j]);
  }
  if (!vals.length) return 0;
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
};

console.log('onsets', onsets.length);
const list = [];
for (let k = 0; k < onsets.length; k++) {
  const t0 = onsets[k] * 0.005;
  const nextT = k + 1 < onsets.length ? onsets[k + 1] * 0.005 : n / SR;
  const t1 = Math.min(t0 + 0.20, nextT - 0.01);
  const f0 = f0Near(t0 + 0.03);
  let pk = 0;
  for (let p = Math.floor(t0 * SR); p < Math.floor(t1 * SR); p++) pk = Math.max(pk, Math.abs(mono[p]));
  list.push({ t0: +t0.toFixed(3), t1: +t1.toFixed(3), dur: +(t1 - t0).toFixed(3), f0: Math.round(f0), peak: +pk.toFixed(2) });
}
list.forEach((s, i) => console.log(`${String(i + 1).padStart(2)} ${s.t0.toFixed(3)} dur=${s.dur.toFixed(2)} f0=${s.f0} pk=${s.peak}`));

// 四组：每 3 个一组，取前 12 个
const groups = [];
for (let g = 0; g < 4; g++) {
  const tri = list.slice(g * 3, g * 3 + 3);
  if (tri.length < 3) break;
  groups.push({ group: g + 1, f0: Math.round(tri.reduce((a, b) => a + (b.f0 || 400), 0) / 3), t: tri.map((x) => x.t0) });
}
console.log('--- 4 组');
groups.forEach((g) => console.log(`组${g.group} f0≈${g.f0} 三个起点 ${g.t.map((t) => t.toFixed(3)).join(', ')}`));

// 导出：每组把 3 个音节拼成一个母本（3 连「冰冰冰」，与参考一致）
fs.mkdirSync('demo', { recursive: true });
function writeWav(path, data, sr) {
  const nn = data.length;
  const buf = Buffer.alloc(44 + nn * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + nn * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(nn * 2, 40);
  for (let i = 0; i < nn; i++) {
    const v = Math.max(-1, Math.min(1, data[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(path, buf);
}

// 全池导出（单个音节，带 10ms 前导 + 40ms 尾部）
const single = [];
for (const s of list) {
  const a = Math.max(0, Math.floor((s.t0 - 0.010) * SR));
  const b = Math.min(n, Math.floor((s.t1 + 0.030) * SR));
  single.push({ ...s, data: mono.subarray(a, b) });
}
let total = 0;
for (const s of single) total += s.data.length;
const big = new Float32Array(total);
const idx = [];
let off = 0;
for (const s of single) {
  big.set(s.data, off);
  idx.push({ off, len: s.data.length, f0: s.f0, dur: s.dur });
  off += s.data.length;
}
fs.writeFileSync('test/out/ref-pool.f32', Buffer.from(big.buffer));
fs.writeFileSync('test/out/ref-pool.idx.json', JSON.stringify({ sr: SR, groups, syllables: idx }, null, 2));
console.log('pool', single.length, 'syllables', (total / SR).toFixed(2) + 's');
