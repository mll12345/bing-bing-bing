// make-previews.mjs —— 每组只导「一声冰」（单音节），不放三连
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const SR = 44100;
const meta = JSON.parse(fs.readFileSync('samples/bing-bank.json', 'utf8'));
const bin = fs.readFileSync('samples/bing-bank.bin');
const i16 = new Int16Array(bin.buffer, bin.byteOffset, bin.length / 2);
const pool = new Float32Array(i16.length);
for (let i = 0; i < i16.length; i++) pool[i] = i16[i] / 32768;

function writeWav(p, d) {
  const n = d.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, d[i])) * 32767), 44 + i * 2);
  fs.writeFileSync(p, b);
}

// 每组只取第一个母本 = 单声「冰」
for (let g = 1; g <= 4; g++) {
  const s = meta.syllables[(g - 1) * 3];
  if (!s) continue;
  const tail = Math.floor(0.06 * SR);
  const total = Math.floor(0.05 * SR) + s.len + tail + Math.floor(0.05 * SR);
  const d = new Float32Array(total);
  const off = Math.floor(0.05 * SR);
  for (let i = 0; i < s.len; i++) {
    const t = i > s.len - tail ? (s.len - i) / tail : 1;
    d[off + i] = pool[s.off + i] * t;
  }
  let pk = 0;
  for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
  const gg = 0.93 / (pk || 1);
  for (let i = 0; i < d.length; i++) d[i] *= gg;
  writeWav(`test/out/one${g}.wav`, d);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `test/out/one${g}.wav`, '-b:a', '192k', `samples/group${g}.mp3`]);
  fs.copyFileSync(`samples/group${g}.mp3`, `samples/冰组${g}.mp3`);
  console.log(`组${g} 单声 f0=${s.f0} ${(d.length / SR).toFixed(2)}s`);
}
