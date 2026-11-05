// bank-node.mjs —— 用真母本池渲染纯冰声轨，验证「借真人的冰」这条路
import fs from 'node:fs';
import { separate } from '../src/vocals.js';
import { biquad } from '../src/pcm.js';
import { pitchTrack, toNotes } from '../src/voice.js';
import { renderBank } from '../src/bank.js';

const SR = 48000;
const raw = new Float32Array(fs.readFileSync(process.argv[2]).buffer.slice(0));
const frames = Math.floor(raw.length / 2);
const chs = [new Float32Array(frames), new Float32Array(frames)];
for (let i = 0; i < frames; i++) { chs[0][i] = raw[i * 2]; chs[1][i] = raw[i * 2 + 1]; }

const sep = separate(chs, SR, () => {});
const voc = sep.vocal ? Float32Array.from(sep.vocal[0]) : Float32Array.from(chs[0]);
biquad(voc, SR, 'highpass', 120, 0.7);
const track = pitchTrack(voc, SR, () => {});
const notes = toNotes(track, { minDur: 0.07, clarityMin: 0.26 });
console.log('notes', notes.length);

// 母本池（44.1k）→ 48k 线性重采样
const poolRaw = new Float32Array(fs.readFileSync('test/out/ref-pool.f32').buffer.slice(0));
const idx = JSON.parse(fs.readFileSync('test/out/ref-pool.idx.json', 'utf8'));
const ratio = idx.sr / SR;
const nOut = Math.floor(poolRaw.length / ratio);
const pool = new Float32Array(nOut);
for (let i = 0; i < nOut; i++) {
  const x = i * ratio;
  const i0 = x | 0;
  const f = x - i0;
  pool[i] = (poolRaw[i0] || 0) * (1 - f) + (poolRaw[i0 + 1] || 0) * f;
}
idx.syllables = idx.syllables.map((s) => ({ off: Math.round(s.off / ratio), len: Math.round(s.len / ratio), f0: s.f0 }));

for (const g of [1, 2, 3, 4]) {
  const r = renderBank(pool, idx, notes, { sr: SR, len: frames, gain: 1, group: g });
  let peak = 1e-9;
  for (let i = 0; i < r.data.length; i++) peak = Math.max(peak, Math.abs(r.data[i]));
  const gg = 0.89 / peak;
  const buf = Buffer.alloc(44 + r.data.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + r.data.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(r.data.length * 2, 40);
  for (let i = 0; i < r.data.length; i++) {
    const v = Math.max(-1, Math.min(1, r.data[i] * gg));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  const p = `test/out/bank${g}.wav`;
  fs.writeFileSync(p, buf);
  console.log(`组${g} count=${r.count} -> ${p} ${(r.data.length / SR).toFixed(2)}s`);
}
