// reslice-node.mjs —— 在 Node 里跑「借原唱嗓子」的管线，导出纯冰声 WAV
// 用法: node test/reslice-node.mjs <src.f32> <out.wav> [group] [maxSec]
import fs from 'node:fs';
import path from 'node:path';
import { separate } from '../src/vocals.js';
import { biquad } from '../src/pcm.js';
import { pitchTrack, toNotes } from '../src/voice.js';
import { renderReslice } from '../src/reslice.js';

const SRC = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const GROUP = Number(process.argv[4] || 2);
const MAXSEC = Number(process.argv[5] || 45);
const SR = 48000;

const raw = new Float32Array(fs.readFileSync(SRC).buffer.slice(0));
const frames = Math.min(Math.floor(raw.length / 2), Math.floor(MAXSEC * SR));
const chs = [new Float32Array(frames), new Float32Array(frames)];
for (let i = 0; i < frames; i++) { chs[0][i] = raw[i * 2]; chs[1][i] = raw[i * 2 + 1]; }

const t0 = Date.now();
const sep = separate(chs, SR, () => {});
console.log('separate', Date.now() - t0, 'ms centered=', sep.centered);

const voc = sep.vocal ? Float32Array.from(sep.vocal[0]) : Float32Array.from(chs[0]);
biquad(voc, SR, 'highpass', 120, 0.7);
const t1 = Date.now();
const track = pitchTrack(voc, SR, () => {});
const notes = toNotes(track, { minDur: 0.07, clarityMin: 0.26 });
console.log('track', Date.now() - t1, 'ms notes=', notes.length);

const t2 = Date.now();
const bing = renderReslice(voc, SR, notes, { gain: 1, group: GROUP, progress: () => {} });
console.log('reslice', Date.now() - t2, 'ms count=', bing.count, 'bank=', bing.bank);

// 峰值归一并写 WAV
const d = bing.data;
let peak = 1e-9;
for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
const g = 0.89 / peak;
const n = d.length;
const buf = Buffer.alloc(44 + n * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) {
  let v = d[i] * g;
  v = Math.max(-1, Math.min(1, v));
  buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buf);
console.log('wrote', OUT, (n / SR).toFixed(2) + 's', (fs.statSync(OUT).size / 1048576).toFixed(2) + 'MB');
