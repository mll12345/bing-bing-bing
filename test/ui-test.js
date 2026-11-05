// ui-test.js —— 端到端：注入文件 → 点「冰冰冰！」→ 校验输出 → 导出 WAV
const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGE = process.argv[2] || 'http://127.0.0.1:8199/';
const FILE = path.resolve(process.argv[3] || 'test/sample.mp4');
const OUT = path.resolve(process.argv[4] || 'test/ui-out.wav');

const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9222, path: p }, (r) => {
    let s = ''; r.on('data', (d) => (s += d)); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

(async () => {
  const list = await getJSON('/json/list');
  const t = list.find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errs = [];
  const send = (m, q = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: q })); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Runtime.enable');
  await send('DOM.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: PAGE });
  await new Promise((r) => setTimeout(r, 1800));

  // 注入文件
  const doc = await send('DOM.getDocument', { depth: -1 });
  const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fileInput' });
  const setRes = await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [FILE] });
  if (setRes?.error) throw new Error('setFileInputFiles: ' + JSON.stringify(setRes.error));

  // 等解码完成
  const waitFor = async (expr, ms = 30000, label = '') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (r?.result?.value) return r.result.value;
      await new Promise((r2) => setTimeout(r2, 350));
    }
    throw new Error('timeout waiting: ' + (label || expr));
  };

  await waitFor('!!window.__ice?.state?.srcBuffer', 40000, 'decode');
  const decoded = await send('Runtime.evaluate', {
    expression: `(()=>{const b=window.__ice.state.srcBuffer;return JSON.stringify({dur:b.duration,sr:b.sampleRate,ch:b.numberOfChannels,name:document.getElementById('pillName').textContent,durLbl:document.getElementById('pillDur').textContent,srLbl:document.getElementById('pillSr').textContent,paramsCard:document.getElementById('cardParams').className,waveW:document.getElementById('waveIn').getBoundingClientRect().width})})()`,
    returnByValue: true,
  });

  // 点渲染
  await send('Runtime.evaluate', { expression: `document.getElementById('btnRender').click()` });
  await waitFor('!!window.__ice?.state?.outBuffer', 180000, 'render');

  const rendered = await send('Runtime.evaluate', {
    expression: `(()=>{const s=window.__ice.state;const b=s.outBuffer;const i=s.outInfo;let peak=0,rms=0;for(let c=0;c<b.numberOfChannels;c++){const d=b.getChannelData(c);for(let k=0;k<d.length;k++){const a=Math.abs(d[k]);if(a>peak)peak=a;rms+=d[k]*d[k];}}return JSON.stringify({dur:+b.duration.toFixed(2),peak:+peak.toFixed(3),rms:+Math.sqrt(rms/(b.length*b.numberOfChannels)).toFixed(3),info:i&&{bpm:i.bpm,notes:i.notes,timbre:i.timbre,voice:i.voice,keptVocal:i.keptVocal,speed:i.speed,drum:i.drum,separated:i.separated},statsHTML:document.getElementById('stats').textContent.trim(),outCard:document.getElementById('cardOut').className,waveOutW:document.getElementById('waveOut').getBoundingClientRect().width,waveOutH:document.getElementById('waveOut').getBoundingClientRect().height,errVisible:!document.getElementById('errBox').classList.contains('hidden')});})()`,
    returnByValue: true,
  });

  // 播放测试：点播放，1 秒后看进度是否前进
  await send('Runtime.evaluate', { expression: `document.getElementById('btnPlay').click()` });
  await new Promise((r) => setTimeout(r, 1200));
  const play = await send('Runtime.evaluate', {
    expression: `JSON.stringify({playing:window.__ice.state.playing, t:+ (window.__ice.state.elapsedSec||0).toFixed(2), fill:document.getElementById('seekFill').style.width, label:document.getElementById('timeLbl').textContent})`,
    returnByValue: true,
  });
  await send('Runtime.evaluate', { expression: `document.getElementById('btnPlay').click()` });

  // 导出 WAV：直接调 encodeWav（避免下载目录问题）
  const wavInfo = await send('Runtime.evaluate', {
    expression: `(async()=>{const m=await import('./src/audio.js');const b=window.__ice.state.outBuffer;const blob=m.encodeWav(b);const ab=await blob.arrayBuffer();const u=new Uint8Array(ab);window.__WAVB64=btoa(String.fromCharCode(...u.slice(0,4096)));return JSON.stringify({size:blob.size,type:blob.type,head:[...u.slice(0,4)].map(c=>String.fromCharCode(c)).join('')});})()`,
    returnByValue: true, awaitPromise: true,
  });

  // 视频录制能力检查（不真录，只验 API 与画布尺寸）
  const vid = await send('Runtime.evaluate', {
    expression: `JSON.stringify({mr:typeof MediaRecorder,vp9:MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus'),cv:(()=>{const c=document.getElementById('videoCanvas');const r=c.getBoundingClientRect();return {w:r.width,h:r.height,cw:c.width}})(),ctxx:!!document.getElementById('videoCanvas').getContext('2d'),capStream:typeof document.getElementById('videoCanvas').captureStream})`,
    returnByValue: true,
  });

  console.log(JSON.stringify({
    decoded: JSON.parse(decoded.result.value),
    rendered: JSON.parse(rendered.result.value),
    play: JSON.parse(play.result.value),
    wav: JSON.parse(wavInfo.result.value),
    video: JSON.parse(vid.result.value),
    errs,
  }, null, 2));
  ws.close(); process.exit(0);
})();
