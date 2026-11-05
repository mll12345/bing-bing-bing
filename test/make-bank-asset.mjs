// make-bank-asset.mjs —— 把参考音频切出的真母本导出成网页可加载的静态资源
// 产物：samples/bing-bank.bin（int16 PCM）+ samples/bing-bank.json（元数据）
import fs from 'node:fs';
import path from 'node:path';

const SR = 44100;
const poolRaw = new Float32Array(fs.readFileSync('test/out/ref-pool.f32').buffer.slice(0));
const idx = JSON.parse(fs.readFileSync('test/out/ref-pool.idx.json', 'utf8'));

// 保留 12 个母本，按音频里出现的先后顺序分组（与原参考的 4 组三连一一对应）
const keep = idx.syllables.slice(0, 12);

let total = 0;
for (const s of keep) total += s.len;
const pcm = Buffer.alloc(total * 2);
const out = [];
let off = 0;
for (let i = 0; i < keep.length; i++) {
  const s = keep[i];
  for (let k = 0; k < s.len; k++) {
    const v = Math.max(-1, Math.min(1, poolRaw[s.off + k]));
    pcm.writeInt16LE(Math.round(v * 32767), (off + k) * 2);
  }
  out.push({ off, len: s.len, f0: s.f0 });
  off += s.len;
}

const groups = [];
for (let g = 0; g < 4; g++) {
  const tri = out.slice(g * 3, g * 3 + 3);
  if (tri.length < 3) break;
  const f0 = Math.round(tri.reduce((a, b) => a + (b.f0 || 400), 0) / 3);
  groups.push({ group: g + 1, f0 });
}

fs.mkdirSync('samples', { recursive: true });
fs.writeFileSync(path.join('samples', 'bing-bank.bin'), pcm);
fs.writeFileSync(path.join('samples', 'bing-bank.json'), JSON.stringify({
  sr: SR,
  groups,
  syllables: out,
}, null, 2));

console.log('bin', (pcm.length / 1024).toFixed(0) + 'KB', 'syllables', out.length, 'dur', (total / SR).toFixed(2) + 's');
console.log(JSON.stringify(groups));
