// bing-fx.js —— 生成「冰冰冰」三连音效素材（参考 BV1HEho6LERf 里那三个冰声）
// 用法: node test/bing-fx.js [outBase] [timbre]
// 产物: demo/<outBase>.wav / .mp3
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

(async () => {
  const BASE = process.argv[2] || '冰冰冰_音效';
  const TIMBRE = Number(process.argv[3] || 2);
  const SR = 48000;

  const { synthBing } = await import('../src/voice.js');

  // 三连冰：音高上行（C5 → E5 → F#5，都落在合成器 65–760Hz 的可控区内），第三个拖长一点收尾
  const seq = [
    { f0: 523.25, dur: 0.20 },
    { f0: 659.25, dur: 0.20 },
    { f0: 739.99, dur: 0.34 },
  ];
  const gap = 0.035;
  let total = 0;
  for (const s of seq) total += s.dur + gap;
  total += 0.9; // 混响尾巴

  const len = Math.ceil(total * SR);
  const out = new Float32Array(len);
  let t = 0.05;
  const manifest = [];
  for (const s of seq) {
    const nt = synthBing({ sr: SR, f0: s.f0, dur: s.dur, amp: 0.95, timbre: TIMBRE });
    const off = Math.floor(t * SR);
    for (let i = 0; i < nt.length && off + i < len; i++) out[off + i] += nt[i];
    manifest.push({ at: +t.toFixed(3), dur: s.dur, f0: s.f0 });
    t += s.dur + gap;
  }

  // 简易冰洞尾：把尾巴做一次衰减回声，让"冰"有余韵
  const delay = Math.floor(0.11 * SR);
  for (let i = delay; i < len; i++) out[i] += out[i - delay] * 0.22;

  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = peak > 1e-6 ? 0.89 / peak : 1;
  for (let i = 0; i < len; i++) out[i] *= g;

  const outDir = path.resolve('demo');
  fs.mkdirSync(outDir, { recursive: true });
  const wavPath = path.join(outDir, BASE + '.wav');
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
    const s = Math.max(-1, Math.min(1, out[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.writeFileSync(wavPath, buf);
  const mp3 = path.join(outDir, BASE + '.mp3');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '192k', mp3]);

  console.log('WAV → ' + wavPath);
  console.log('MP3 → ' + mp3);
  console.log('三连冰: ' + JSON.stringify(manifest) + `  时长 ${(len / SR).toFixed(2)}s`);
})().catch((e) => { console.error(e); process.exit(1); });
