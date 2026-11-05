// audio.js —— 解码（含 mp4 音轨提取的三级回退）、WAV 编码、视频导出

let sharedCtx = null;
export function getCtx() {
  if (!sharedCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    sharedCtx = new AC({ latencyHint: 'interactive' });
  }
  return sharedCtx;
}

/**
 * 解码任意媒体文件（mp4/mp3/wav/m4a/mov/webm）为 AudioBuffer。
 * 1) decodeAudioData 直接解（mp4 里的 AAC 大多数浏览器支持）
 * 2) 失败 → 用 <video> + MediaElementSource + 实时录流补齐 PCM
 * 3) 再失败 → 抛错给 UI
 */
export async function decodeMedia(file, onProgress = () => {}) {
  const ctx = getCtx();
  const ab = await file.arrayBuffer();

  onProgress(0.1, '解码音频…');
  try {
    const buf = await ctx.decodeAudioData(ab.slice(0));
    onProgress(1, '解码完成');
    return { buffer: buf, method: 'decodeAudioData' };
  } catch (e) {
    console.warn('decodeAudioData 失败，改用实时解码', e);
  }

  const url = URL.createObjectURL(file);
  try {
    return await realtimeDecode(ctx, url, onProgress);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}

/** 实时解码回退（用于浏览器不支持的封装格式） */
function realtimeDecode(ctx, url, onProgress) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.src = url;
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';

    v.onerror = () => reject(new Error('这个文件浏览器解不了（编码可能是 AC-3/DTS 之类）。请先转成 MP4(H.264+AAC) 或 MP3。'));

    v.onloadedmetadata = async () => {
      const dur = Math.min(v.duration || 0, 600);
      if (!dur || !isFinite(dur)) return reject(new Error('读不到时长，可能文件损坏或编码不支持。'));
      const sr = ctx.sampleRate;
      const len = Math.ceil(dur * sr);
      const chans = 2;
      const out = [];
      for (let c = 0; c < chans; c++) out.push(new Float32Array(len));

      try {
        await ctx.resume();
        const src = ctx.createMediaElementSource(v);
        const proc = ctx.createScriptProcessor(4096, 2, 2);
        const sink = ctx.createGain();
        sink.gain.value = 0;
        let written = 0;
        proc.onaudioprocess = (ev) => {
          const ib = ev.inputBuffer;
          const n = ib.length;
          for (let c = 0; c < chans; c++) {
            const d = ib.getChannelData(Math.min(c, ib.numberOfChannels - 1));
            const dst = out[c];
            for (let i = 0; i < n && written + i < len; i++) dst[written + i] = d[i];
          }
          written += n;
          onProgress(Math.min(0.98, 0.15 + (written / len) * 0.8), `实时解码 ${(written / sr).toFixed(1)}s / ${dur.toFixed(1)}s`);
        };
        src.connect(proc);
        proc.connect(sink);
        sink.connect(ctx.destination);

        const finish = () => {
          try { src.disconnect(); proc.disconnect(); sink.disconnect(); } catch {}
          v.pause();
          const buf = ctx.createBuffer(2, len, sr);
          for (let c = 0; c < 2; c++) buf.getChannelData(c).set(out[c]);
          onProgress(1, '解码完成');
          resolve({ buffer: buf, method: 'realtime' });
        };

        v.onended = finish;
        v.currentTime = 0;
        await v.play();
        // 安全阀：dur+3s 后强制收尾
        setTimeout(() => { if (written < len * 0.98) finish(); }, (dur + 3) * 1000);
      } catch (err) {
        reject(err);
      }
    };
  });
}

/** AudioBuffer → 16bit PCM WAV Blob */
export function encodeWav(buffer, onProgress = () => {}) {
  const numCh = Math.min(2, buffer.numberOfChannels);
  const sr = buffer.sampleRate;
  const n = buffer.length;
  const bytes = 44 + n * numCh * 2;
  const ab = new ArrayBuffer(bytes);
  const view = new DataView(ab);

  const w = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  w(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  w(36, 'data');
  view.setUint32(40, n * numCh * 2, true);

  const chans = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));

  let off = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < numCh; c++) {
      let s = chans[c][i];
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
    if (i % 48000 === 0) onProgress(i / n, '编码 WAV…');
  }
  onProgress(1, 'WAV 就绪');
  return new Blob([ab], { type: 'audio/wav' });
}

/**
 * 实时录制「冰封视觉」视频（Canvas + MediaRecorder → WebM）
 * 画布动画与音频完全同步播放。
 */
export async function recordVideo(audioBuffer, { title = '', subtitle = '', bpm = 120 } = {}, onProgress = () => {}) {
  const canvas = document.getElementById('videoCanvas');
  const W = 1280, H = 720;
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');

  const ctx = getCtx();
  await ctx.resume();

  const src = ctx.createBufferSource();
  src.buffer = audioBuffer;
  const dest = ctx.createMediaStreamDestination();
  src.connect(dest);
  src.connect(ctx.destination);

  const stream = canvas.captureStream(30);
  dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));

  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || 'video/webm';

  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 192_000 });
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  const done = new Promise((res) => { rec.onstop = res; });

  const dur = audioBuffer.duration;
  const t0 = performance.now();

  let raf = 0;
  const draw = () => {
    const el = (performance.now() - t0) / 1000;
    drawFrame(g, W, H, el, dur, title, subtitle, bpm);
    onProgress(Math.min(1, el / dur), `录制中 ${el.toFixed(1)}s / ${dur.toFixed(1)}s`);
    if (el < dur + 0.4) raf = requestAnimationFrame(draw);
  };

  rec.start(200);
  src.start();
  draw();

  await new Promise((r) => setTimeout(r, (dur + 0.5) * 1000));
  cancelAnimationFrame(raf);
  try { src.stop(); } catch {}
  rec.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());
  onProgress(1, '视频就绪');

  return new Blob(chunks, { type: 'video/webm' });
}

/** 冰晶视觉帧 */
function drawFrame(g, W, H, t, dur, title, subtitle, bpm) {
  // 背景渐变
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#04121f');
  bg.addColorStop(0.5, '#082a44');
  bg.addColorStop(1, '#020a12');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  const beat = 60 / bpm;
  const pulse = Math.pow(1 - ((t % beat) / beat), 3);

  // 放射光束
  g.save();
  g.translate(W / 2, H / 2);
  g.globalAlpha = 0.16 + pulse * 0.22;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 + t * 0.12;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * W, Math.sin(a) * W);
    g.lineTo(Math.cos(a + 0.06) * W, Math.sin(a + 0.06) * W);
    g.closePath();
    g.fillStyle = i % 2 ? '#7fe9ff' : '#1976ff';
    g.fill();
  }
  g.restore();

  // 冰晶碎块
  g.save();
  g.globalAlpha = 0.85;
  for (let i = 0; i < 46; i++) {
    const seed = i * 7.13;
    const speed = 26 + (i % 9) * 13;
    const x = ((seed * 97) % W + Math.sin(t * 0.6 + i) * 26 + W) % W;
    const y = ((seed * 53 + t * speed) % (H + 120)) - 60;
    const s = 5 + (i % 6) * 4 + pulse * 5;
    g.save();
    g.translate(x, y);
    g.rotate(t * 0.6 + i);
    g.beginPath();
    g.moveTo(0, -s); g.lineTo(s * 0.8, 0); g.lineTo(0, s); g.lineTo(-s * 0.8, 0);
    g.closePath();
    g.fillStyle = `rgba(160,236,255,${0.1 + (i % 5) * 0.06})`;
    g.fill();
    g.restore();
  }
  g.restore();

  // 中心冰环
  g.save();
  g.translate(W / 2, H / 2 - 30);
  for (let r = 0; r < 3; r++) {
    const rad = 90 + r * 46 + pulse * (14 + r * 8);
    g.beginPath();
    g.arc(0, 0, rad, 0, Math.PI * 2);
    g.strokeStyle = `rgba(127,233,255,${0.5 - r * 0.13})`;
    g.lineWidth = 2 + pulse * 2;
    g.stroke();
  }
  g.restore();

  // 文字
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const cx = W / 2;

  g.save();
  g.shadowColor = '#38d9ff';
  g.shadowBlur = 34 + pulse * 26;
  g.fillStyle = '#ffffff';
  g.font = '700 96px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  g.fillText('🧊 冰 冰 冰 🧊', cx, H / 2 - 30);
  g.restore();

  if (title) {
    g.fillStyle = 'rgba(230,247,255,.94)';
    g.font = '600 40px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    g.fillText(title.slice(0, 22), cx, H / 2 + 66);
  }
  if (subtitle) {
    g.fillStyle = 'rgba(127,233,255,.75)';
    g.font = '400 22px ui-monospace,Consolas,monospace';
    g.fillText(subtitle, cx, H / 2 + 116);
  }

  // 进度条
  const pad = 90;
  const pw = W - pad * 2;
  const px = pad + pw * Math.min(1, t / (dur || 1));
  g.fillStyle = 'rgba(255,255,255,.12)';
  g.fillRect(pad, H - 74, pw, 4);
  const gr = g.createLinearGradient(pad, 0, pad + pw, 0);
  gr.addColorStop(0, '#4dffd2');
  gr.addColorStop(0.5, '#38d9ff');
  gr.addColorStop(1, '#1976ff');
  g.fillStyle = gr;
  g.fillRect(pad, H - 74, pw * Math.min(1, t / (dur || 1)), 4);
  g.beginPath();
  g.arc(px, H - 72, 6, 0, Math.PI * 2);
  g.fillStyle = '#e6f7ff';
  g.fill();

  // 水印
  g.fillStyle = 'rgba(200,235,255,.5)';
  g.font = '400 18px "PingFang SC",system-ui,sans-serif';
  g.textAlign = 'left';
  g.fillText('冰冰冰版生成器', pad, H - 38);
  g.textAlign = 'right';
  g.fillText('🧊 bing-bing-bing', W - pad, H - 38);
}
