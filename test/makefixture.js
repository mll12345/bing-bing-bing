// makefixture.js —— 在 node 里合成「测试曲」WAV，用来验证 analyzeTempo 的准确度
// 用法：node test/makefixture.js <bpm> <seconds> <out.wav> [style]
// style: dance(强 kick 四四拍) / weak(弱鼓、只有军鼓) / offbeat(kick 在 1、3 拍)
import fs from 'node:fs';

const bpm = +process.argv[2] || 128;
const seconds = +process.argv[3] || 20;
const out = process.argv[4] || 'test/fixture.wav';
const style = process.argv[5] || 'dance';
const sr = 48000;

const n = Math.floor(seconds * sr);
const L = new Float32Array(n), R = new Float32Array(n);

let seed = 1234567;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const beat = 60 / bpm;
const bar = beat * 4;

const addKick = (t0, amp) => {
  const len = Math.floor(0.28 * sr);
  const s0 = Math.floor(t0 * sr);
  for (let i = 0; i < len; i++) {
    const j = s0 + i;
    if (j < 0 || j >= n) continue;
    const t = i / sr;
    const f = 140 * Math.exp(-t * 22) + 45;
    const env = Math.exp(-t * 11);
    const v = Math.sin(2 * Math.PI * f * t) * env * amp;
    L[j] += v; R[j] += v;
  }
};
const addNoise = (t0, amp, dur, hp = 4000) => {
  const len = Math.floor(dur * sr);
  const s0 = Math.floor(t0 * sr);
  const a = Math.exp(-2 * Math.PI * hp / sr);
  let y = 0, prev = 0;
  for (let i = 0; i < len; i++) {
    const j = s0 + i;
    const w = rnd() * 2 - 1;
    y = a * (y + w - prev); prev = w; // 一阶高通
    const env = Math.exp(-(i / sr) * 40);
    if (j >= 0 && j < n) { L[j] += y * env * amp; R[j] += y * env * amp * 0.9; }
  }
};
const addTone = (t0, dur, f, amp, pan = 0) => {
  const len = Math.floor(dur * sr);
  const s0 = Math.floor(t0 * sr);
  for (let i = 0; i < len; i++) {
    const j = s0 + i;
    if (j < 0 || j >= n) continue;
    const t = i / sr;
    const env = Math.min(1, t / 0.02) * Math.exp(-t * 1.6);
    const v = (Math.sin(2 * Math.PI * f * t) * 0.6 + Math.sin(2 * Math.PI * f * 2 * t) * 0.25) * env * amp;
    L[j] += v * (1 - pan); R[j] += v * (1 + pan);
  }
};

const chords = [[261.63, 329.63, 392.0], [220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66]];
const bars = Math.ceil(seconds / bar);
for (let b = 0; b < bars; b++) {
  const t0 = b * bar;
  chords[b % 4].forEach((f, k) => addTone(t0, Math.min(bar, seconds - t0), f, 0.16, k % 2 ? 0.25 : -0.25));
  // 「人声」旋律每拍一个
  for (let k = 0; k < 4; k++) addTone(t0 + k * beat, beat * 0.9, 523.25 * (1 + (k % 3) * 0.12), 0.22, 0);
}

for (let b = 0; b < bars; b++) {
  const t0 = b * bar;
  for (let k = 0; k < 4; k++) {
    const t = t0 + k * beat;
    if (t > seconds) break;
    if (style === 'dance') addKick(t, 1.0);
    else if (style === 'offbeat') { if (k === 0 || k === 2) addKick(t, 0.9); }
    else if (style === 'weak') { if (k === 0) addKick(t, 0.55); }
    // 军鼓在 2、4 拍
    if (k === 1 || k === 3) addNoise(t, 0.35, 0.12, 2200);
    // hihat 八分
    addNoise(t + beat * 0.5, 0.1, 0.035, 9000);
  }
}

// 归一化
let mx = 0;
for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(L[i]), Math.abs(R[i]));
const k = 0.9 / (mx || 1);

const buf = Buffer.alloc(44 + n * 4);
buf.write('RIFF', 0, 'ascii');
buf.writeUInt32LE(36 + n * 4, 4);
buf.write('WAVE', 8, 'ascii');
buf.write('fmt ', 12, 'ascii');
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(sr, 24);
buf.writeUInt32LE(sr * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36, 'ascii');
buf.writeUInt32LE(n * 4, 40);
for (let i = 0; i < n; i++) {
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * k * 32767))), 44 + i * 4);
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * k * 32767))), 46 + i * 4);
}
fs.writeFileSync(out, buf);
console.log(`wrote ${out}  ${bpm} BPM  ${seconds}s  style=${style}`);
