// one-shot: 20s 片段 → 冰声单轨，量测「像不像人声」
import fs from 'node:fs';
import { separate } from '../src/vocals.js';
import { biquad } from '../src/pcm.js';
import { pitchTrack, toNotes } from '../src/voice.js';
import { renderBank } from '../src/bank.js';

const SR = 48000;
const SEC = 20;
const raw = new Float32Array(fs.readFileSync(fs.readFileSync('test/src114.f32') ? 'test/src114.f32' : '').buffer.slice(0));
const frames = Math.min(Math.floor(raw.length / 2), SEC * SR);
const chs = [new Float32Array(frames), new Float32Array(frames)];
for (let i = 0; i < frames; i++) { chs[0][i] = raw[i * 2]; chs[1][i] = raw[i * 2 + 1]; }

const sep = separate(chs, SR, () => {});
const v = Float32Array.from(sep.vocal[0]);
biquad(v, SR, 'highpass', 170, 0.7);
const track = pitchTrack(v, SR, () => {});
const notes = toNotes(track, { minDur: 0.07, clarityMin: 0.26 });
console.log('notes', notes.length, notes.slice(0, 5).map((n) => `${n.start.toFixed(2)}s/${n.f0.toFixed(0)}Hz/${n.dur.toFixed(2)}s`).join(' '));

const meta = JSON.parse(fs.readFileSync('samples/bing-bank.json', 'utf8'));
const bin = fs.readFileSync('samples/bing-bank.bin');
const i16 = new Int16Array(bin.buffer, bin.byteOffset, bin.length / 2);
const pool = new Float32Array(i16.length);
for (let i = 0; i < i16.length; i++) pool[i] = i16[i] / 32768;
const ratio = meta.sr / SR;
const idx = {
  syllables: meta.syllables.map((s) => ({ off: Math.round(s.off / ratio), len: Math.round(s.len / ratio), f0: s.f0 })),
};
const pr = new Float32Array(Math.floor(pool.length / ratio));
for (let i = 0; i < pr.length; i++) { const x = i * ratio; const i0 = x | 0; const f = x - i0; pr[i] = (pool[i0] || 0) * (1 - f) + (pool[i0 + 1] || 0) * f; }

for (const g of [1, 2, 3, 4]) {
  const bing = renderBank(pr, idx, notes, { sr: SR, len: frames, gain: 1, group: g, progress: () => {} });
  // 周期性：最响窗口归一化自相关峰值
  let best = 0, bi = 0;
  for (let i = 0; i + 4800 <= frames; i += 1200) {
    let e = 0; for (let k = 0; k < 4800; k++) e += bing.data[i + k] * bing.data[i + k];
    if (e > best) { best = e; bi = i; }
  }
  const seg = bing.data.subarray(bi, bi + 4800);
  let r0 = 0; for (let k = 0; k < 4800; k++) r0 += seg[k] * seg[k];
  let bestR = 0;
  for (let lag = 40; lag < 400; lag++) {
    let s = 0; for (let k = 0; k + lag < 4800; k++) s += seg[k] * seg[k + lag];
    bestR = Math.max(bestR, s / (r0 + 1e-9));
  }
  let pk = 0, sq = 0;
  for (let i = 0; i < frames; i++) { pk = Math.max(pk, Math.abs(bing.data[i])); sq += bing.data[i] * bing.data[i]; }
  console.log(`组${g}: peak=${pk.toFixed(3)} rms=${Math.sqrt(sq / frames).toFixed(4)} 周期性=${bestR.toFixed(3)} count=${bing.count}`);
}
