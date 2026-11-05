// render-full.js —— 渲染一整首歌并落盘，带进度轮询（长时间渲染用）
// 用法: node render-full.js <pageUrl> <inputFile> <outName.wav> [ice] [speed] [drum] [rev] [maxLen]
const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGE = process.argv[2] || 'http://127.0.0.1:8199/';
const FILE = path.resolve(process.argv[3]);
const NAME = process.argv[4] || 'full.wav';
const ice = process.argv[5] || 3;
const speed = process.argv[6] || 1;
const drum = process.argv[7] || 0.8;
const rev = process.argv[8] || 0.3;
const maxLen = process.argv[9] || 180;

const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9222, path: p }, (r) => {
    let s = ''; r.on('data', (d) => (s += d)); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

(async () => {
  const list = await getJSON('/json/list');
  const t = list.find((x) => x.type === 'page' && /^https?:/.test(x.url));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errs = [];
  const send = (m, q = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: q })); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Runtime.enable'); await send('DOM.enable'); await send('Page.enable');
  await send('Page.navigate', { url: PAGE });
  await new Promise((r) => setTimeout(r, 2000));

  const doc = await send('DOM.getDocument', { depth: -1 });
  const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fileInput' });
  await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [FILE] });

  const evalJS = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
    return r?.result?.value;
  };

  const deadline = Date.now() + 900000;
  while (Date.now() < deadline) {
    if (await evalJS('!!window.__ice?.state?.srcBuffer')) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  const dec = JSON.parse(await evalJS(`JSON.stringify({dur:__ice.state.srcBuffer.duration,sr:__ice.state.srcBuffer.sampleRate,ch:__ice.state.srcBuffer.numberOfChannels})`));
  console.log('decoded', dec);

  await evalJS(`(()=>{const s=(id,v)=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};s('iceLevel',${ice});s('speed',${speed});s('drum',${drum});s('rev',${rev});s('maxLen',${maxLen});return 1})()`);
  const t0 = Date.now();
  await evalJS(`document.getElementById('btnRender').click()`);

  let last = '';
  while (Date.now() - deadline < 0) {
    const st = await evalJS(`JSON.stringify({done:!!__ice.state.outBuffer,busy:__ice.state.busy,txt:document.getElementById('progText')?.textContent||'',err:document.getElementById('errBox')?.textContent||''})`);
    const o = JSON.parse(st);
    if (o.txt !== last) { last = o.txt; console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', o.txt); }
    if (o.err) { console.log('ERRBOX', o.err); break; }
    if (o.done) break;
    await new Promise((r) => setTimeout(r, 700));
  }

  const info = JSON.parse(await evalJS(`JSON.stringify(__ice.state.outInfo)`));
  console.log('info', info);
  const save = await evalJS(
    `(async()=>{const m=await import('./src/audio.js');const blob=m.encodeWav(__ice.state.outBuffer);const r=await fetch('/save/${encodeURIComponent(NAME)}',{method:'POST',body:blob});return await r.text();})()`,
    true,
  );
  console.log('saved', save);
  if (errs.length) console.log('errs', errs);
  ws.close();
  process.exit(0);
})();
