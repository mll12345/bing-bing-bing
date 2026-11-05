// bing-groups.js —— 生成「4 组 × 3 个完全相同的冰」试听素材，供用户挑一组
// 用法: node test/bing-groups.js [inputAudio] [outBase]
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

(async () => {
  const INPUT = process.argv[2] || 'C:\\Users\\mll12\\Desktop\\11\\114.mp3';
  const BASE = process.argv[3] || '冰声_4组试听';
  const SR = 48000;

  const tmp = path.join(os.tmpdir(), 'bing-groups-' + Date.now() + '.raw');
  // 只取前 40 秒，找一句唱得稳的长音当"母本字"
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.resolve(INPUT), '-t', '40', '-ac', '2', '-ar', String(SR), '-f', 'f32le', tmp]);
  const raw = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  const n = Math.floor(raw.length / 8);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let i = 0; i < n; i++) { L[i] = dv.getFloat32(i * 8, true); R[i] = dv.getFloat32(i * 8 + 4, true); }

  const { separate } = await import('../src/vocals.js');
  const { pitchTrack, toNotes } = await import('../src/voice.js');
  const { morphSyllable, BING_GROUPS } = await import('../src/morph.js');

  const sep = await separate([L, R], SR);
  const vocal = sep.vocal ? Float32Array.from(sep.vocal[0]) : (() => {
    const m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = (L[i] + R[i]) / 2; return m;
  })();
  const track = pitchTrack(vocal, SR);
  const notes = toNotes(track, { minDur: 0.07, clarityMin: 0.30 });
  // 挑一个足够长的字当母本（>0.3s），尽量在 5-30 秒之间
  const pick = notes.filter((x) => x.dur > 0.3 && x.start > 5 && x.start < 30).sort((a, b) => b.dur - a.dur)[0]
    || notes.filter((x) => x.dur > 0.2)[0];
  if (!pick) { console.error('没找到可用的字'); process.exit(1); }
  console.log(`母本字：t=${pick.start.toFixed(2)}s  dur=${pick.dur.toFixed(2)}s  f0=${pick.f0.toFixed(0)}Hz`);

  const at = Math.round(pick.start * SR);
  const nlen = Math.min(n - at, Math.round(Math.min(pick.dur, 1.2) * SR));

  // 4 组 × 3 个，组内三个逐字节相同
  const speechGap = 0.30;
  const groupGap = 0.75;
  const seq = [];
  for (let g = 1; g <= 4; g++) {
    for (let k = 0; k < 3; k++) seq.push({ group: g, at: 0 });
  }
  const total = [];
  let t = 0.15;
  const rendered = {};
  for (let g = 1; g <= 4; g++) {
    const buf = morphSyllable(vocal, SR, at, nlen, { timbre: g });
    let pk = 0; for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i]));
    const k = pk > 1e-9 ? 0.85 / pk : 1;
    for (let i = 0; i < buf.length; i++) buf[i] *= k;
    rendered[g] = buf;
    for (let j = 0; j < 3; j++) { total.push({ group: g, at: t, buf }); t += buf.length / SR + speechGap; }
    t += groupGap - speechGap;
  }

  const outLen = Math.ceil((t + 1.5) * SR);
  const out = new Float32Array(outLen);
  for (const seg of total) {
    const o = Math.round(seg.at * SR);
    for (let i = 0; i < seg.buf.length && o + i < outLen; i++) out[o + i] += seg.buf[i];
  }
  // 轻混响
  const d1 = Math.round(0.11 * SR);
  for (let i = d1; i < outLen; i++) out[i] += out[i - d1] * 0.16;

  let pk = 0; for (let i = 0; i < outLen; i++) pk = Math.max(pk, Math.abs(out[i]));
  const g = pk > 1e-6 ? 0.89 / pk : 1;
  for (let i = 0; i < outLen; i++) out[i] *= g;

  const outDir = path.resolve('demo');
  fs.mkdirSync(outDir, { recursive: true });
  const wavPath = path.join(outDir, BASE + '.wav');
  writeWav(wavPath, out, SR);
  const mp3 = path.join(outDir, BASE + '.mp3');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '192k', mp3]);
  console.log('WAV → ' + wavPath);
  console.log('MP3 → ' + mp3);
  console.log('序列：' + total.map((s) => `${s.group}@${s.at.toFixed(2)}s`).join(' '));
  console.log('时长 ' + (outLen / SR).toFixed(2) + 's');
  Object.keys(BING_GROUPS).forEach((k) => console.log(`  第 ${k} 组 ${BING_GROUPS[k].name}`));
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
  for (let i = 0; i < len; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2);
  fs.writeFileSync(p, buf);
}
