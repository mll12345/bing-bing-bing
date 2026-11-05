// make-previews.mjs —— 用真母本生成 4 组试听（每组 3 个「冰」连着，与参考一致）
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

for (let g = 1; g <= 4; g++) {
  const tri = meta.syllables.slice((g - 1) * 3, g * 3);
  if (tri.length < 3) continue;
  // 每个音节：源码 + 40ms 尾部衰减
  const total = tri.reduce((a, s) => a + s.len + Math.floor(0.04 * SR), 0) + Math.floor(0.25 * SR);
  const d = new Float32Array(total);
  let off = Math.floor(0.03 * SR);
  for (const s of tri) {
    for (let i = 0; i < s.len; i++) {
      const tail = i > s.len - 0.04 * SR ? (s.len - i) / (0.04 * SR) : 1;
      d[off + i] = pool[s.off + i] * tail;
    }
    off += s.len + Math.floor(0.04 * SR);
  }
  let pk = 0;
  for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
  const gg = 0.92 / (pk || 1);
  for (let i = 0; i < d.length; i++) d[i] *= gg;
  writeWav(`test/out/prev${g}.wav`, d);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `test/out/prev${g}.wav`, '-b:a', '192k', `samples/冰组${g}.mp3`]);
  console.log(`组${g}`, tri.map((s) => s.f0).join('/'), (d.length / SR).toFixed(2) + 's');
}
