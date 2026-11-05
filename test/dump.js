// dump.js —— 渲染并把输出 WAV 通过 /save/ 落到 test/out/，供 ffmpeg 分析
// 用法: node dump.js <pageUrl> <inputFile> <outName.wav> [ice] [speed] [drum] [rev] [maxLen]
const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGE = process.argv[2] || 'http://127.0.0.1:8199/';
const FILE = path.resolve(process.argv[3]);
const NAME = process.argv[4] || 'out.wav';
const ice = process.argv[5] || 3;
const speed = process.argv[6] || 1.25;
const drum = process.argv[7] || 0.8;
const rev = process.argv[8] || 0.3;
const maxLen = process.argv[9] || 180;
const REPORT = path.resolve('test/dump-report.json');

const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9222, path: p }, (r) => {
    let s = ''; r.on('data', (d) => (s += d)); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

(async () => {
  const rep = { page: PAGE, file: FILE, name: NAME, ok: false, errs: [] };
  try {
    const list = await getJSON('/json/list');
    const t = list.find((x) => x.type === 'page');
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    let id = 0; const pend = new Map();
    const send = (m, q = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: q })); });
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
      if (m.method === 'Runtime.exceptionThrown') rep.errs.push(m.params.exceptionDetails?.exception?.description);
    };
    await new Promise((r) => (ws.onopen = r));
    await send('Runtime.enable'); await send('DOM.enable'); await send('Page.enable');
    await send('Page.navigate', { url: PAGE });
    await new Promise((r) => setTimeout(r, 1500));

    const doc = await send('DOM.getDocument', { depth: -1 });
    const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fileInput' });
    await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [FILE] });

    const waitFor = async (expr, ms, label) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
        if (r?.result?.value) return;
        await new Promise((r2) => setTimeout(r2, 300));
      }
      throw new Error('timeout ' + label);
    };
    await waitFor('!!window.__ice?.state?.srcBuffer', 60000, 'decode');
    rep.decoded = JSON.parse((await send('Runtime.evaluate', {
      expression: `JSON.stringify({dur:window.__ice.state.srcBuffer.duration,sr:window.__ice.state.srcBuffer.sampleRate,ch:window.__ice.state.srcBuffer.numberOfChannels})`,
      returnByValue: true })).result.value);

    await send('Runtime.evaluate', {
      expression: `(()=>{const s=(id,v)=>{const e=document.getElementById(id);if(e){e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))}};s('voice',${ice});s('timbre',2);s('keep',0);s('rev',${rev});s('sparkle',0.3);s('maxLen',${maxLen});return 1})()`,
    });
    await send('Runtime.evaluate', { expression: `document.getElementById('btnRender').click()` });
    await waitFor('!!window.__ice?.state?.outBuffer', 300000, 'render');
    rep.info = JSON.parse((await send('Runtime.evaluate', { expression: `JSON.stringify(window.__ice.state.outInfo)`, returnByValue: true })).result.value);

    // 页面内 fetch POST 上传 WAV（避免 CDP 传大 base64）
    const up = await send('Runtime.evaluate', {
      expression: `(async()=>{const m=await import('./src/audio.js');const blob=m.encodeWav(window.__ice.state.outBuffer);const r=await fetch('/save/${encodeURIComponent(NAME)}',{method:'POST',body:blob});return await r.text();})()`,
      returnByValue: true, awaitPromise: true,
    });
    rep.saved = up?.result?.value;
    rep.ok = true;
  } catch (e) {
    rep.errs.push(String(e && e.stack || e));
  }
  fs.writeFileSync(REPORT, JSON.stringify(rep, null, 2));
  console.log('report ->', REPORT, rep.ok ? 'OK' : 'FAILED');
  process.exit(rep.ok ? 0 : 1);
})();
