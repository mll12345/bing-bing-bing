// bing-full-morph.js —— 成品：伴奏 + 原唱本人嗓子的「冰声」+ 母带近似
// 用法: node test/bing-full-morph.js <inputAudio> <outBase> [timbre] [rev] [maxSec]
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

(async () => {
  const INPUT = process.argv[2];
  const BASE = process.argv[3] || 'bing';
  const TIMBRE = Number(process.argv[4] || 2);
  const REV = Number(process.argv[5] || 0.22);
  const MAXSEC = Number(process.argv[6] || 600);
  if (!INPUT) { console.error('缺少输入文件'); process.exit(2); }
  const src = path.resolve(INPUT);
  if (!fs.existsSync(src)) { console.error('文件不存在: ' + src); process.exit(2); }

  const SR = 48000;
  const tmp = path.join(os.tmpdir(), 'bing-full-' + Date.now() + '.raw');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-ac', '2', '-ar', String(SR), '-f', 'f32le', tmp]);
  const raw = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  const n = Math.min(Math.floor(raw.length / 8), Math.floor(SR * MAXSEC));
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let i = 0; i < n; i++) { L[i] = dv.getFloat32(i * 8, true); R[i] = dv.getFloat32(i * 8 + 4, true); }
  console.log(`输入 ${(n / SR).toFixed(2)}s`);

  const { separate } = await import('../src/vocals.js');
  const { pitchTrack, toNotes } = await import('../src/voice.js');
  const { renderMorphBing } = await import('../src/morph.js');

  const t0 = Date.now();
  const sep = await separate([L, R], SR);
  console.log(`分离 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // 伴奏：原曲 − 限带人声（与 engine.js 一致，保住 kick/贝斯）
  const vocalM = sep.vocal ? Float32Array.from(sep.vocal[0]) : (() => {
    const m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = (L[i] + R[i]) / 2; return m;
  })();
  const vocalHP = Float32Array.from(vocalM);
  biquadHP(vocalHP, SR, 170);

  const inst = [Float32Array.from(L), Float32Array.from(R)];
  for (let c = 0; c < 2; c++) {
    const base = inst[c];
    for (let i = 0; i < n; i++) base[i] -= vocalHP[i] * 0.92;
    biquadHP(base, SR, 24);
  }
  console.log('伴奏就绪');

  const vocalForPitch = Float32Array.from(vocalM);
  biquadHP(vocalForPitch, SR, 120);
  const track = pitchTrack(vocalForPitch, SR);
  const notes = toNotes(track, { minDur: 0.07, clarityMin: 0.26, jumpSemis: 1.4 });
  console.log(`音符 ${notes.length} 个`);

  const t2 = Date.now();
  const bing = renderMorphBing(vocalForPitch, SR, notes, { gain: 1, timbre: TIMBRE });
  console.log(`冰声 ${((Date.now() - t2) / 1000).toFixed(1)}s  ${bing.morphed}/${bing.count}`);

  // 冰声按伴奏能量定标
  const rmsOf = (a) => { let s = 0, c = 0; for (let i = 0; i < a.length; i += 3) { s += a[i] * a[i]; c++; } return Math.sqrt(s / Math.max(1, c)); };
  const instRms = 0.5 * (rmsOf(inst[0]) + rmsOf(inst[1]));
  const bingRms = rmsOf(bing.data);
  const bingGain = bingRms > 1e-6 ? (instRms * 1.25) / bingRms : 0;
  console.log(`instRms ${instRms.toFixed(4)} bingRms ${bingRms.toFixed(4)} → ×${bingGain.toFixed(2)}`);

  // 混音 + 冰洞混响（简单梳状 + 全通，够用）
  const wet = new Float32Array(n);
  const combDelays = [0.0297, 0.0371, 0.0411, 0.0437].map((d) => Math.round(d * SR));
  for (const d of combDelays) {
    for (let i = d; i < n; i++) wet[i] += wet[i - d] * 0.72 + bing.data[i - d] * bingGain;
  }
  for (const d of combDelays) {
    const delay = Math.round(d * 0.37);
    for (let i = delay; i < n; i++) wet[i] -= wet[i - delay] * 0.4;
  }
  const revAmt = 0.10 + REV * 0.5;

  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dry = bing.data[i] * bingGain;
    const d = dry + wet[i] * revAmt;
    outL[i] = inst[0][i] * 0.98 + d;
    outR[i] = inst[1][i] * 0.98 + d * 0.96;
  }

  // 母带：高通 → 软削波 → 峰值归一 → 尾部淡出
  biquadHP(outL, SR, 28);
  biquadHP(outR, SR, 28);
  for (let i = 0; i < n; i++) {
    outL[i] = Math.tanh(outL[i] * 1.12) / Math.tanh(1.12);
    outR[i] = Math.tanh(outR[i] * 1.12) / Math.tanh(1.12);
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
  const g = peak > 1e-6 ? 0.955 / peak : 1;
  const fade = Math.round(1.4 * SR);
  for (let i = 0; i < n; i++) {
    let k = g;
    if (i > n - fade) k *= Math.max(0, (n - i) / fade);
    outL[i] *= k; outR[i] *= k;
  }

  const outDir = path.resolve('demo');
  fs.mkdirSync(outDir, { recursive: true });
  const wavPath = path.join(outDir, BASE + '.wav');
  writeWavStereo(wavPath, outL, outR, SR);
  console.log('WAV → ' + wavPath + '  ' + (fs.statSync(wavPath).size / 1048576).toFixed(2) + 'MB');

  const mp3 = path.join(outDir, BASE + '.mp3');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '192k', mp3]);
  const short = path.join(outDir, BASE + '_前35秒.mp3');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-t', '35', '-codec:a', 'libmp3lame', '-b:a', '192k', short]);
  console.log('MP3 → ' + mp3 + ' / ' + short);
  console.log(`总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})().catch((e) => { console.error(e); process.exit(1); });

function writeWavStereo(p, l, r, sr) {
  const len = l.length;
  const buf = Buffer.alloc(44 + len * 4);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + len * 4, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(len * 4, 40);
  for (let i = 0; i < len; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i])) * 32767), 46 + i * 4);
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
