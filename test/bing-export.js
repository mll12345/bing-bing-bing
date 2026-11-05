// bing-export.js —— 在 Node 里直接跑完整「冰声」管线，导出纯冰声轨
// 用法: node test/bing-export.js <inputAudio> <outBaseName> [timbre] [maxSec]
// 产物: demo/<outBaseName>.wav (纯冰声，单声道) + .mp3
const fs = require('node:fs');
const path = require('node:path');
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
  const tmp = path.join(require('node:os').tmpdir(), 'bing-export-' + Date.now() + '.raw');
  console.log('解码 → f32le 48k stereo …');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-ac', '2', '-ar', String(SR), '-f', 'f32le', tmp], { stdio: 'inherit' });
  const raw = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  const total = Math.floor(raw.length / 8);
  const n = Math.min(total, Math.floor(SR * MAXSEC));
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let i = 0; i < n; i++) {
    L[i] = dv.getFloat32(i * 8, true);
    R[i + 0] = dv.getFloat32(i * 8 + 4, true);
  }
  console.log(`输入 ${(n / SR).toFixed(2)}s @${SR}Hz stereo`);

  const { separate } = await import('../src/vocals.js');
  const { pitchTrack, toNotes, renderBingTrack, synthBing } = await import('../src/voice.js');

  console.log('分离中置人声 …');
  const t0 = Date.now();
  const sep = await separate([L, R], SR);
  console.log(`  分离 ${((Date.now() - t0) / 1000).toFixed(1)}s  centered=${sep.centered}`);

  // 与 engine.js 一致：人声限带 170Hz 后再跟踪，伴奏减掉限带人声
  const vocHP = [];
  const inst = [];
  for (let c = 0; c < 2; c++) {
    const v = sep.vocal ? Float32Array.from(sep.vocal[Math.min(c, sep.vocal.length - 1)]) : null;
    if (v) biquadHP(v, SR, 170);
    vocHP.push(v);
    const base = Float32Array.from(c === 0 ? L : R);
    if (v) {
      for (let i = 0; i < base.length; i++) base[i] -= v[i] * 0.92;
    }
    inst.push(base);
  }

  console.log('跟踪旋律 …');
  const t1 = Date.now();
  const track = pitchTrack(vocHP[0] || sep.mono, SR);
  const notes = toNotes(track, { minDur: 0.07, clarityMin: 0.26, jumpSemis: 1.4 });
  console.log(`  跟踪 ${((Date.now() - t1) / 1000).toFixed(1)}s  音符 ${notes.length} 个`);

  console.log('合成冰声 …');
  const t2 = Date.now();
  const bing = renderBingTrack(notes, SR, n, { gain: 1, timbre: TIMBRE });
  console.log(`  合成 ${((Date.now() - t2) / 1000).toFixed(1)}s  ${bing.count} 个冰`);

  // 归一化到 0.89 峰值
  let peak = 0;
  for (let i = 0; i < bing.data.length; i++) peak = Math.max(peak, Math.abs(bing.data[i]));
  const g = peak > 1e-6 ? 0.89 / peak : 1;
  for (let i = 0; i < bing.data.length; i++) bing.data[i] *= g;
  console.log(`  峰值 ${peak.toFixed(4)} → ×${g.toFixed(3)}`);

  // 写 WAV（16bit 单声道）
  const outDir = path.resolve('demo');
  fs.mkdirSync(outDir, { recursive: true });
  const wavPath = path.join(outDir, BASE + '.wav');
  const len = bing.data.length;
  const buf = Buffer.alloc(44 + len * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + len * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(len * 2, 40);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, bing.data[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.writeFileSync(wavPath, buf);
  console.log('WAV → ' + wavPath + '  ' + (buf.length / 1048576).toFixed(2) + 'MB');

  // MP3 完整版 + 前 35 秒试听
  const mp3 = path.join(outDir, BASE + '.mp3');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '192k', mp3]);
  console.log('MP3 → ' + mp3);
  const mp3short = path.join(outDir, BASE + '_前35秒.mp3');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-t', '35', '-codec:a', 'libmp3lame', '-b:a', '192k', mp3short]);
  console.log('MP3 → ' + mp3short);

  // 冰声独奏清单，方便核对
  const manifest = {
    input: src, timbre: TIMBRE, sr: SR, durSec: +(len / SR).toFixed(2),
    noteCount: notes.length, notes: notes.slice(0, 40).map((x) => ({
      t: +x.start.toFixed(3), dur: +x.dur.toFixed(3), f0: +x.f0.toFixed(1), amp: +x.amp.toFixed(3),
    })),
  };
  fs.writeFileSync(path.join(outDir, BASE + '.json'), JSON.stringify(manifest, null, 2));
  console.log(`总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s  输出 ${manifest.durSec}s / ${notes.length} 个冰`);
})().catch((e) => { console.error(e); process.exit(1); });

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
