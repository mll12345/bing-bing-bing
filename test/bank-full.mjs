// bank-full.mjs —— 用真母本池整曲渲染（Node，快），产出 demo mp3
// 用法: node test/bank-full.mjs <src.f32> <group> <outBase>
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { separate } from '../src/vocals.js';
import { biquad, normalize } from '../src/pcm.js';
import { pitchTrack, toNotes } from '../src/voice.js';
import { renderBank } from '../src/bank.js';

const SR = 48000;
const SRC = process.argv[2];
const GROUP = Number(process.argv[3] || 2);
const OUT = process.argv[4] || `demo/冰冰冰_真冰_组${GROUP}`;

const raw = new Float32Array(fs.readFileSync(SRC).buffer.slice(0));
const frames = Math.floor(raw.length / 2);
const chs = [new Float32Array(frames), new Float32Array(frames)];
for (let i = 0; i < frames; i++) { chs[0][i] = raw[i * 2]; chs[1][i] = raw[i * 2 + 1]; }
console.log('in', (frames / SR).toFixed(2) + 's');

const t0 = Date.now();
const sep = separate(chs, SR, () => {});
const vocHP = [];
const inst = [];
for (let c = 0; c < 2; c++) {
  const v = sep.vocal ? Float32Array.from(sep.vocal[Math.min(c, sep.vocal.length - 1)]) : null;
  if (v) biquad(v, SR, 'highpass', 170, 0.7);
  vocHP.push(v);
  const base = Float32Array.from(chs[c]);
  if (v) { for (let i = 0; i < frames; i++) base[i] -= v[i] * 0.92; biquad(base, SR, 'highpass', 22, 0.7); }
  inst.push(base);
}
console.log('separate', Date.now() - t0, 'ms centered=', sep.centered);

const track = pitchTrack(vocHP[0], SR, () => {});
const notes = toNotes(track, { minDur: 0.07, clarityMin: 0.26 });
console.log('notes', notes.length);

// 母本池
const meta = JSON.parse(fs.readFileSync('samples/bing-bank.json', 'utf8'));
const bin = fs.readFileSync('samples/bing-bank.bin');
const i16 = new Int16Array(bin.buffer, bin.byteOffset, bin.length / 2);
const poolRaw = new Float32Array(i16.length);
for (let i = 0; i < i16.length; i++) poolRaw[i] = i16[i] / 32768;
let pool = poolRaw;
const idx = { ...meta };
if (meta.sr !== SR) {
  const ratio = meta.sr / SR;
  const nOut = Math.floor(poolRaw.length / ratio);
  pool = new Float32Array(nOut);
  for (let i = 0; i < nOut; i++) {
    const x = i * ratio; const i0 = x | 0; const f = x - i0;
    pool[i] = (poolRaw[i0] || 0) * (1 - f) + (poolRaw[i0 + 1] || 0) * f;
  }
  idx.syllables = meta.syllables.map((s) => ({ off: Math.round(s.off / ratio), len: Math.round(s.len / ratio), f0: s.f0 }));
}

const t1 = Date.now();
const bing = renderBank(pool, idx, notes, { sr: SR, len: frames, gain: 1, group: GROUP, progress: () => {} });
console.log('bank', Date.now() - t1, 'ms count=', bing.count);
biquad(bing.data, SR, 'highshelf', 7000, 0.7, -5.5);
biquad(bing.data, SR, 'highpass', 150, 0.7);

const rmsOf = (a) => { let s = 0; for (let i = 0; i < a.length; i += 3) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, Math.ceil(a.length / 3))); };
const instRms = 0.5 * (rmsOf(inst[0]) + rmsOf(inst[1]));
// 冰声只在音符处发声，按「发声区间内的 rms」定标，否则会被大量静音摊薄、导致峰值过高
let bs = 0; let bn = 0;
for (const nt of notes) {
  const a = Math.max(0, Math.floor(nt.start * SR));
  const b = Math.min(frames, a + Math.floor((nt.dur + 0.06) * SR));
  for (let i = a; i < b; i += 2) { bs += bing.data[i] * bing.data[i]; bn++; }
}
const bingRms = Math.sqrt(bs / Math.max(1, bn));
const scale = bingRms > 1e-6 ? (instRms * 0.85) / bingRms : 0;

const out = [new Float32Array(frames), new Float32Array(frames)];
for (let c = 0; c < 2; c++) {
  const d = out[c];
  for (let i = 0; i < frames; i++) d[i] = inst[c][i] + bing.data[i] * scale;
}
// 软膝限幅 + 提响度
let pre = 0;
for (const d of out) for (let i = 0; i < d.length; i++) pre = Math.max(pre, Math.abs(d[i]));
pre = pre > 0 ? 0.86 / pre : 1;
const knee = 0.66;
for (const d of out) {
  for (let i = 0; i < d.length; i++) {
    let v = d[i] * pre;
    const a = Math.abs(v);
    if (a > knee) v = Math.sign(v) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
    d[i] = v;
  }
}

// WAV（16bit 立体声）
const n = frames;
const buf = Buffer.alloc(44 + n * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
let peak = 0;
for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[c][i]));
const g = peak > 0 ? 0.95 / peak : 1;
for (let i = 0; i < n; i++) {
  for (let c = 0; c < 2; c++) {
    const v = Math.max(-1, Math.min(1, out[c][i] * g));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 4 + c * 2);
  }
}
fs.mkdirSync('demo', { recursive: true });
const wav = `test/out/真冰_组${GROUP}.wav`;
fs.writeFileSync(wav, buf);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-b:a', '192k', `${OUT}.mp3`]);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-t', '35', '-b:a', '192k', `${OUT}_前35秒.mp3`]);
console.log('wrote', `${OUT}.mp3`, (fs.statSync(`${OUT}.mp3`).size / 1048576).toFixed(2) + 'MB');
