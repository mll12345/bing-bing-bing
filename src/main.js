// main.js —— UI 装配：上传 → 参数 → 渲染 → 播放/导出
import { decodeMedia, encodeWav, recordVideo, getCtx } from './audio.js';
import { renderIce } from './engine.js';
import { envelope } from './pcm.js';

const $ = (id) => document.getElementById(id);
const el = {
  dropzone: $('dropzone'),
  fileInput: $('fileInput'),
  fileMeta: $('fileMeta'),
  pillName: $('pillName'),
  pillDur: $('pillDur'),
  pillBpm: $('pillBpm'),
  pillSr: $('pillSr'),
  cardParams: $('cardParams'),
  cardOut: $('cardOut'),
  voice: $('voice'),
  timbre: $('timbre'),
  keep: $('keep'),
  rev: $('rev'),
  sparkle: $('sparkle'),
  maxLen: $('maxLen'),
  title: $('title'),
  vVoice: $('vVoice'),
  vTimbre: $('vTimbre'),
  vKeep: $('vKeep'),
  vRev: $('vRev'),
  vSpark: $('vSpark'),
  vLen: $('vLen'),
  btnRender: $('btnRender'),
  btnReset: $('btnReset'),
  progWrap: $('progWrap'),
  progBar: $('progBar'),
  progText: $('progText'),
  errBox: $('errBox'),
  waveIn: $('waveIn'),
  waveOut: $('waveOut'),
  btnPlay: $('btnPlay'),
  seekFill: $('seekFill'),
  timeLbl: $('timeLbl'),
  btnWav: $('btnWav'),
  btnVideo: $('btnVideo'),
  btnShare: $('btnShare'),
  vidWrap: $('vidWrap'),
  vidBar: $('vidBar'),
  vidText: $('vidText'),
  stats: $('stats'),
  bgCanvas: $('bgCanvas'),
  seek: document.querySelector('.seek'),
};

const state = {
  file: null,
  srcBuffer: null,
  outBuffer: null,
  outInfo: null,
  playing: false,
  node: null,
  startedAt: 0,
  elapsedSec: 0,
  raf: 0,
  busy: false,
};

/* ================= 背景冰晶 ================= */
(function bg() {
  const c = el.bgCanvas;
  const ctx = c.getContext('2d');
  let w = 0, h = 0, dpr = Math.min(2, devicePixelRatio || 1);
  const flakes = [];
  const resize = () => {
    w = c.clientWidth; h = c.clientHeight;
    c.width = Math.floor(w * dpr); c.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const seed = () => {
    flakes.length = 0;
    const n = Math.min(80, Math.round((w * h) / 22000));
    for (let i = 0; i < n; i++) {
      flakes.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 1 + Math.random() * 3.4,
        vy: 6 + Math.random() * 22,
        vx: -6 + Math.random() * 12,
        a: 0.12 + Math.random() * 0.4,
        spin: Math.random() * Math.PI * 2,
      });
    }
  };
  let last = performance.now();
  const tick = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, w, h);
    for (const f of flakes) {
      f.x += f.vx * dt; f.y += f.vy * dt; f.spin += dt;
      if (f.y > h + 6) { f.y = -6; f.x = Math.random() * w; }
      if (f.x < -6) f.x = w + 6;
      if (f.x > w + 6) f.x = -6;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.spin);
      ctx.fillStyle = `rgba(150,232,255,${f.a})`;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        ctx.lineTo(Math.cos(a) * f.r * 2.2, Math.sin(a) * f.r * 2.2);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    requestAnimationFrame(tick);
  };
  resize(); seed();
  addEventListener('resize', () => { resize(); seed(); });
  requestAnimationFrame(tick);
})();

/* ================= 波形绘制 ================= */
function drawWave(canvas, data, opts = {}) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 120;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  if (!data || !data.length) return;

  const env = envelope(data, Math.max(60, Math.floor(w)));
  const mid = h / 2;

  // 中线
  g.strokeStyle = 'rgba(127,233,255,.14)';
  g.beginPath(); g.moveTo(0, mid); g.lineTo(w, mid); g.stroke();

  const grad = g.createLinearGradient(0, 0, w, 0);
  if (opts.frozen) {
    grad.addColorStop(0, '#4dffd2');
    grad.addColorStop(0.45, '#38d9ff');
    grad.addColorStop(1, '#5b8dff');
  } else {
    grad.addColorStop(0, '#2f7fa8');
    grad.addColorStop(1, '#3ec6ff');
  }
  g.fillStyle = grad;

  const step = w / env.length;
  for (let i = 0; i < env.length; i++) {
    const a = Math.min(1, env[i] * 1.25);
    const bh = Math.max(1, a * (h * 0.46));
    g.fillRect(i * step, mid - bh, Math.max(1, step * 0.82), bh * 2);
  }
}

/* ================= 上传处理 ================= */
el.dropzone.addEventListener('click', () => el.fileInput.click());
el.dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); }
});
el.fileInput.addEventListener('change', () => {
  if (el.fileInput.files[0]) handleFile(el.fileInput.files[0]);
});
['dragenter', 'dragover'].forEach((ev) =>
  el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) =>
  el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.remove('over'); }));
el.dropzone.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) handleFile(f);
});

async function handleFile(file) {
  if (state.busy) return;
  showErr(null);
  state.busy = true;
  setBusy(true);
  try {
    if (file.size > 120 * 1024 * 1024) throw new Error('文件超过 120MB，请先用工具压缩或截取片段。');
    state.file = file;
    el.pillName.textContent = file.name;
    el.fileMeta.classList.remove('hidden');
    showProgress(0.02, '读取文件…');
    el.cardParams.classList.add('disabled');

    const { buffer, method } = await decodeMedia(file, (p, label) => showProgress(p, label));
    state.srcBuffer = buffer;

    const ch = buffer.numberOfChannels;
    const mono = new Float32Array(buffer.length);
    for (let c = 0; c < ch; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < buffer.length; i++) mono[i] += d[i] / ch;
    }
    state.mono = mono;

    el.pillDur.textContent = fmtTime(buffer.duration);
    el.pillSr.textContent = `${(buffer.sampleRate / 1000).toFixed(1)} kHz · ${ch === 1 ? '单声道' : '立体声'}`;
    el.pillBpm.textContent = method === 'realtime' ? '实时解码' : '就绪';
    if (!el.title.value) {
      el.title.value = file.name.replace(/\.[^.]+$/, '').slice(0, 20);
    }

    drawWave(el.waveIn, mono, {});

    el.cardParams.classList.remove('disabled');
    hideProgress();
    setBusy(false);
    el.cardParams.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    console.error(err);
    showErr(String(err.message || err));
    hideProgress();
    setBusy(false);
  } finally {
    state.busy = false;
  }
}

/* ================= 参数绑定 ================= */
const fmtLen = (v) => (v >= 300 ? '完整' : v + ' 秒');
const TIMBRE_NAME = { 1: '清脆', 2: '中性', 3: '厚实' };
function syncLabels() {
  el.vVoice.textContent = Number(el.voice.value).toFixed(2);
  el.vTimbre.textContent = TIMBRE_NAME[Number(el.timbre.value)] || '中性';
  el.vKeep.textContent = Number(el.keep.value).toFixed(2);
  el.vRev.textContent = Number(el.rev.value).toFixed(2);
  el.vSpark.textContent = Number(el.sparkle.value).toFixed(2);
  el.vLen.textContent = fmtLen(Number(el.maxLen.value));
}
[el.voice, el.timbre, el.keep, el.rev, el.sparkle, el.maxLen].forEach((i) =>
  i.addEventListener('input', syncLabels));
syncLabels();

/* ================= 渲染 ================= */
el.btnRender.addEventListener('click', async () => {
  if (!state.srcBuffer || state.busy) return;
  stopPlayback();
  showErr(null);
  state.busy = true;
  setBusy(true);
  el.cardOut.classList.add('disabled');

  try {
    const opts = {
      voice: Number(el.voice.value),
      timbre: Number(el.timbre.value),
      keep: Number(el.keep.value),
      rev: Number(el.rev.value),
      sparkle: Number(el.sparkle.value),
      maxLen: Number(el.maxLen.value),
    };
    showProgress(0.01, '开始冰冻…');
    // 让出一帧，确保进度条先画出来
    await new Promise((r) => requestAnimationFrame(() => r()));

    const { buffer, info } = await renderIce(state.srcBuffer, opts, (p, label) => showProgress(p, label));
    state.outBuffer = buffer;
    state.outInfo = info;

    el.pillBpm.textContent = `${info.notes} 个冰`;

    const ch = buffer.numberOfChannels;
    const mono = new Float32Array(buffer.length);
    for (let c = 0; c < ch; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < buffer.length; i++) mono[i] += d[i] / ch;
    }
    drawWave(el.waveOut, mono, { frozen: true });

    el.stats.innerHTML = [
      ['时长', fmtTime(buffer.duration)],
      ['冰声', `${info.notes} 个`],
      ['音色', TIMBRE_NAME[info.timbre] || '中性'],
      ['原唱', info.keptVocal <= 0.02 ? '已替换' : `残留 ${info.keptVocal.toFixed(2)}`],
      ['人声分离', info.separated ? '立体声中置' : '单声道（叠加）'],
    ].map(([k, v]) => `<div class="s"><b>${v}</b>${k}</div>`).join('');

    el.cardOut.classList.remove('disabled');
    el.timeLbl.textContent = '0:00 / ' + fmtTime(buffer.duration);
    el.seekFill.style.width = '0%';
    hideProgress();
  } catch (err) {
    console.error(err);
    showErr('渲染失败：' + (err.message || err));
    hideProgress();
  } finally {
    state.busy = false;
    setBusy(false);
  }
});

el.btnReset.addEventListener('click', () => {
  stopPlayback();
  el.fileInput.value = '';
  state.file = null; state.srcBuffer = null; state.outBuffer = null; state.mono = null;
  el.fileMeta.classList.add('hidden');
  el.cardParams.classList.add('disabled');
  el.cardOut.classList.add('disabled');
  el.title.value = '';
  el.pillBpm.textContent = '—';
  showErr(null); hideProgress();
});

/* ================= 播放 ================= */
el.btnPlay.addEventListener('click', () => {
  if (!state.outBuffer) return;
  if (state.playing) { stopPlayback(); return; }
  startPlayback(Number(state.elapsedSec || 0));
});

el.seek?.addEventListener('click', (e) => {
  if (!state.outBuffer) return;
  const r = el.seek.getBoundingClientRect();
  const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const t = p * state.outBuffer.duration;
  if (state.playing) { stopPlayback(); startPlayback(t); }
  else { state.elapsedSec = t; updateProgressUI(t); }
});

function startPlayback(fromSec = 0) {
  const ctx = getCtx();
  ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = state.outBuffer;
  src.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.02;
  src.start(t0, Math.min(fromSec, state.outBuffer.duration - 0.01));
  state.node = src;
  state.startedAt = t0 - fromSec;
  state.playing = true;
  el.btnPlay.textContent = '⏸';

  const dur = state.outBuffer.duration;
  const tick = () => {
    if (!state.playing) return;
    const t = ctx.currentTime - state.startedAt;
    state.elapsedSec = Math.min(t, dur);
    updateProgressUI(state.elapsedSec);
    if (t >= dur) { stopPlayback(); state.elapsedSec = 0; updateProgressUI(0); return; }
    state.raf = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(state.raf);
  tick();
  src.onended = () => { if (state.playing) stopPlayback(); };
}

function stopPlayback() {
  state.playing = false;
  cancelAnimationFrame(state.raf);
  el.btnPlay.textContent = '▶';
  if (state.node) {
    try { state.node.onended = null; state.node.stop(); } catch {}
    state.node.disconnect?.();
    state.node = null;
  }
}

function updateProgressUI(t) {
  const dur = state.outBuffer?.duration || 1;
  el.seekFill.style.width = `${Math.min(100, (t / dur) * 100)}%`;
  el.timeLbl.textContent = `${fmtTime(t)} / ${fmtTime(dur)}`;
}

/* ================= 导出 ================= */
el.btnWav.addEventListener('click', () => {
  if (!state.outBuffer) return;
  el.btnWav.disabled = true;
  const name = safeName(el.title.value || 'ice') + '_冰冰冰版.wav';
  try {
    const blob = encodeWav(state.outBuffer, (p, label) => {
      el.btnWav.textContent = `⬇ ${label} ${Math.round(p * 100)}%`;
    });
    download(blob, name);
  } catch (e) {
    showErr('WAV 导出失败：' + e.message);
  } finally {
    el.btnWav.disabled = false;
    el.btnWav.textContent = '⬇ 下载 WAV';
  }
});

el.btnVideo.addEventListener('click', async () => {
  if (!state.outBuffer || state.busy) return;
  if (!window.MediaRecorder) {
    showErr('这个浏览器不支持 MediaRecorder，换个 Chrome / Edge 就能导出视频。');
    return;
  }
  state.busy = true;
  el.btnVideo.disabled = true;
  el.vidWrap.classList.remove('hidden');
  el.vidText.textContent = '准备录制…（实时，时长＝歌曲长度）';
  stopPlayback();
  try {
    const info = state.outInfo || {};
    const blob = await recordVideo(state.outBuffer, {
      title: el.title.value || '',
      subtitle: `🧊 BING BING BING · ${TIMBRE_NAME[info.timbre] || '中性'} · ${info.notes || 0} 个冰`,
    }, (p, label) => {
      el.vidBar.style.width = `${Math.min(100, p * 100)}%`;
      el.vidText.textContent = label;
    });
    download(blob, safeName(el.title.value || 'ice') + '_冰冰冰版.webm');
    el.vidText.textContent = '✅ 视频已开始下载（WebM，可直接传 B 站/剪映）';
  } catch (e) {
    console.error(e);
    showErr('视频导出失败：' + e.message);
  } finally {
    state.busy = false;
    el.btnVideo.disabled = false;
    setTimeout(() => el.vidWrap.classList.add('hidden'), 2600);
  }
});

el.btnShare.addEventListener('click', async () => {
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    el.btnShare.textContent = '✅ 已复制';
  } catch {
    el.btnShare.textContent = url;
  }
  setTimeout(() => (el.btnShare.textContent = '🔗 复制网页链接'), 1800);
});

/* ================= 小工具 ================= */
function download(blob, name) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 6000);
}

function safeName(s) {
  return (s || 'ice').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
}

function fmtTime(sec) {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function showProgress(p, label) {
  el.progWrap.classList.remove('hidden');
  el.progBar.style.width = `${Math.max(1, Math.min(100, p * 100))}%`;
  el.progText.textContent = label || '处理中…';
}
function hideProgress() { el.progWrap.classList.add('hidden'); el.progBar.style.width = '0%'; }
function showErr(msg) {
  if (!msg) { el.errBox.classList.add('hidden'); el.errBox.textContent = ''; return; }
  el.errBox.classList.remove('hidden');
  el.errBox.textContent = msg;
}
function setBusy(b) {
  el.btnRender.disabled = b;
  el.btnRender.textContent = b ? '❄ 冰冻中…' : '🧊 冰冰冰！';
}

// 键盘：空格播放/暂停
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && document.activeElement === document.body && state.outBuffer) {
    e.preventDefault();
    el.btnPlay.click();
  }
});

// 暴露一点调试接口，方便自测
window.__ice = { state, renderIce, decodeMedia };
