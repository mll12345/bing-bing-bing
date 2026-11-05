// bing-morph.js —— 用「原唱本人」的嗓子把每个字改成「冰」（共振峰替换），导出纯冰声轨
// 用法: node test/bing-morph.js <inputAudio> <outBase> [timbre] [maxSec]
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

(async () => {
  const INPUT = process.argv[2];
  const BASE = process.argv[3] || 'bing';
  const TIMBRE = Number(process.argv[4] || 2);
  const MAXSEC = Number(process.argv[5] || 600);
  if (!INPUT) { console.error('缺少输入文件'); process.exit(2); }
  const src = path.resolve(INPUT);
  if (!fs.existsSync(src)) { console.error('文件不存在: ' + src); process.exit(2); }

  const SR = 48000;
  const tmp = path.join(os.tmpdir(), 'bing-morph-' + Date.now() + '.raw');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-ac', '2', '-ar', String(SR), '-f', 'f32le', tmp]);
  const raw = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  const total = Math.floor(raw.length / 8);
  const n = Math.min(total, Math.floor(SR * MAXSEC));
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let i = 0; i < n; i++) {
    L[i] = dv.getFloat32(i * 8, true);
    R[i] = dv.getFloat32(i * 8 + 4, true);
  }
  console.log(`输入 ${(n / SR).toFixed(2)}s @${SR}Hz stereo`);

  const { separate } = await import('../src/vocals.js');
  const { pitchTrack, toNotes } = await import('../src/voice.js');
  const { renderMorphBing } = await import('../src/morph.js');

  const t0 = Date.now();
  console.log('分离中置人声 …');
  const sep = await separate([L, R], SR);
  console.log(`  分离 ${((Date.now() - t0) / 1000).toFixed(1)}s  centered=${sep.centered}`);

  // 人声轨：中置分离结果（单声道）限带到 100Hz 以上，去掉底鼓残留
  const vocal = sep.vocal
    ? Float32Array.from(sep.vocal[0])
    : (() => { const m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = (L[i] + R[i]) / 2; return m; })();
  if (sep.vocal) biquadHP(vocal, SR, 120);

  const t1 = Date.now();
  const track = pitchTrack(vocal, SR);
  const notes = toNotes(track, { minDur: 0.07, clarityMin: 0.26, jumpSemis: 1.4 });
  console.log(`  跟踪 ${((Date.now() - t1) / 1000).toFixed(1)}s  音符 ${notes.length} 个`);

  const t2 = Date.now();
  console.log('共振峰换元音 → /i/ → /ŋ/ …');
  const bing = renderMorphBing(vocal, SR, notes, { gain: 1, timbre: TIMBRE });
  console.log(`  变形 ${((Date.now() - t2) / 1000).toFixed(1)}s  ${bing.morphed}/${bing.count} 个字变成冰`);

  let peak = 0;
  for (let i = 0; i < bing.data.length; i++) peak = Math.max(peak, Math.abs(bing.data[i]));
  const g = peak > 1e-6 ? 0.89 / peak : 1;
  for (let i = 0; i < bing.data.length; i++) bing.data[i] *= g;

  const outDir = path.resolve('demo');
  fs.mkdirSync(outDir, { recursive: true });
  const wavPath = path.join(outDir, BASE + '.wav');
  writeWav(wavPath, bing.data, SR);
  console.log('WAV → ' + wavPath + '  ' + (fs.statSync(wavPath).size / 1048576).toFixed(2) + 'MB');

  const mp3 = path.join(outDir, BASE + '.mp3');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '192k', mp3]);
  const short = path.join(outDir, BASE + '_前35秒.mp3');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-t', '35', '-codec:a', 'libmp3lame', '-b:a', '192k', short]);
  console.log('MP3 → ' + mp3 + ' / ' + short);

  fs.writeFileSync(path.join(outDir, BASE + '.json'), JSON.stringify({
    input: src, mode: 'formant-morph', timbre: TIMBRE, sr: SR,
    durSec: +(bing.data.length / SR).toFixed(2), notes: notes.length, morphed: bing.morphed,
    first: notes.slice(0, 30).map((x) => ({ t: +x.start.toFixed(3), d: +x.dur.toFixed(3), f0: +x.f0.toFixed(1) })),
  }, null, 2));
  console.log(`总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})().catch((e) => { console.error(e); process.exit(1); });

function writeWav(p, data, sr) {
  const len = data.length;
  const buf = Buffer.alloc(44 + len * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + len * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(len * 2, 40);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.writeFileSync(p, buf);
}

function biquadHP(d, sr, f) {
  const w = 2 * Math.PI * f / sr;
  const alpha = Math.sin(w) / (2 * 0.7);
  const cw = Math.cos(w);
  const b0 = (1 + cw) / 2, b1 = -(1 + cw), b2 = (1 + cw) / 2;
  const a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y;
  }
}
