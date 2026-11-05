// bing-group-samples.js —— 每组单独一段「一个冰」的试听素材，给网页试听按钮用
// 用法: node test/bing-group-samples.js [inputAudio]
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

(async () => {
  const INPUT = process.argv[2] || 'C:\\Users\\mll12\\Desktop\\11\\114.mp3';
  const SR = 48000;

  const tmp = path.join(os.tmpdir(), 'bing-gs-' + Date.now() + '.raw');
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
  const pick = notes.filter((x) => x.dur > 0.3 && x.start > 5 && x.start < 30).sort((a, b) => b.dur - a.dur)[0]
    || notes.filter((x) => x.dur > 0.2)[0];
  const at = Math.round(pick.start * SR);
  const nlen = Math.min(n - at, Math.round(Math.min(pick.dur, 1.2) * SR));
  console.log(`母本 t=${pick.start.toFixed(2)} d=${pick.dur.toFixed(2)} f0=${pick.f0.toFixed(0)}`);

  const outDir = path.resolve('demo');
  fs.mkdirSync(outDir, { recursive: true });
  for (let g = 1; g <= 4; g++) {
    const buf = morphSyllable(vocal, SR, at, nlen, { timbre: g });
    let pk = 0; for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i]));
    const k = pk > 1e-9 ? 0.85 / pk : 1;
    // 前面补 80ms 静音，后面留 500ms 余韵
    const pre = Math.round(0.08 * SR);
    const post = Math.round(0.5 * SR);
    const out = new Float32Array(pre + buf.length + post);
    for (let i = 0; i < buf.length; i++) out[pre + i] = buf[i] * k;
    const d = Math.round(0.11 * SR);
    for (let i = d; i < out.length; i++) if (i - d >= pre) out[i] += out[i - d] * 0.18;
    let p2 = 0; for (let i = 0; i < out.length; i++) p2 = Math.max(p2, Math.abs(out[i]));
    const g2 = p2 > 1e-6 ? 0.89 / p2 : 1;
    for (let i = 0; i < out.length; i++) out[i] *= g2;
    const wav = path.join(outDir, `_组${g}.wav`);
    writeWav(wav, out, SR);
    const mp3 = path.join(outDir, `冰组${g}.mp3`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '192k', mp3]);
    fs.unlinkSync(wav);
    console.log(`  ${BING_GROUPS[g].name} → 冰组${g}.mp3  ${(out.length / SR).toFixed(2)}s  ${(fs.statSync(mp3).size / 1024).toFixed(0)}KB`);
  }
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
