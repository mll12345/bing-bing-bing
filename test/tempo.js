// tempo.js —— 直接在 node 里跑 analyzeTempo，验证 BPM / 相位 / 下拍
// 用法：node test/tempo.js file1.wav [file2.wav ...]
import fs from 'node:fs';
import { analyzeTempo } from '../src/pcm.js';

function readWav(f) {
  const b = fs.readFileSync(f);
  let o = 12, fmt, data;
  while (o < b.length - 8) {
    const id = b.toString('ascii', o, o + 4);
    const sz = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    else if (id === 'data') data = b.subarray(o + 8, o + 8 + sz);
    o += 8 + sz + (sz & 1);
  }
  const n = Math.floor(data.length / (fmt.bits / 8) / fmt.ch);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) s += dv.getInt16((i * fmt.ch + c) * 2, true) / 32768;
    mono[i] = s / fmt.ch;
  }
  return { sr: fmt.sr, mono, n };
}

for (const f of process.argv.slice(2)) {
  const { sr, mono, n } = readWav(f);
  const t0 = performance.now();
  const r = analyzeTempo(mono, sr);
  const ms = Math.round(performance.now() - t0);
  console.log(`\n${f}  (${(n / sr).toFixed(1)}s, ${sr}Hz, ${ms}ms)`);
  console.log(`  bpm=${r.bpm}  beat=${(r.beat * 1000).toFixed(1)}ms  phase=${(r.phase * 1000).toFixed(1)}ms  downbeat=${(r.downbeat * 1000).toFixed(1)}ms`);
  console.log(`  strength=${r.strength}  octaveCertain=${r.octaveCertain}`);
  // 倍频对照：写成整数拍是否落在整毫秒内
  for (const k of [0.5, 2]) {
    const b = r.bpm * k;
    if (b >= 40 && b <= 300) console.log(`  (${k}x → ${b.toFixed(1)} BPM)`);
  }
}
