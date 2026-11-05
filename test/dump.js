// dump.js —— 渲染并把输出 WAV 通过 /save/ 落到 test/out/，供 ffmpeg 分析
// 用法: node test/dump.js <pageUrl> <inputFile> <outName.wav> [voice] [timbre] [keep] [rev] [sparkle] [maxLen]
const http = require('http');
const fs = require('fs');
const path = require('path');

const PAGE = process.argv[2] || 'http://127.0.0.1:8199/';
const FILE = path.resolve(process.argv[3]);
const NAME = process.argv[4] || 'out.wav';
const voice = process.argv[5] || 1;
const timbre = process.argv[6] || 2;
const keep = process.argv[7] || 0;
const rev = process.argv[8] || 0.25;
const sparkle = process.argv[9] || 0.3;
const maxLen = process.argv[10] || 300;
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
    const host = new URL(PAGE).host;
    const t = list.find((x) => x.type === 'page' && x.url.includes(host))
      || list.find((x) => x.type === 'page' && /^https?:/.test(x.url))
      || list.find((x) => x.type === 'page');
    if (!t) throw new Error('no CDP page target');
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    let id = 0; const pend = new Map();
    const send = (m, q = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: q })); });
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
      if (m.method === 'Runtime.exceptionThrown') rep.errs.push(m.params.exceptionDetails?.exception?.description);
    };
    ws.onerror = (e) => { rep.errs.push('ws error: ' + (e.message || 'unknown')); };
    ws.onclose = () => { if (!rep.ok) rep.errs.push('ws closed early'); };
    await new Promise((r) => { ws.onopen = r; setTimeout(r, 8000); });
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

    // 直接注入 4 组里的一组，绕开滑块（线上页面也走这条路）
    await send('Runtime.evaluate', {
      expression: `(()=>{const s=(id,v)=>{const e=document.getElementById(id);if(e){e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))}};s('voice',${voice});s('timbre',${timbre});s('keep',${keep});s('rev',${rev});s('sparkle',${sparkle});s('maxLen',${maxLen});return 1})()`,
    });
    await send('Runtime.evaluate', { expression: `document.getElementById('btnRender').click()` });
    await waitFor('!!window.__ice?.state?.outBuffer', 300000, 'render');
    rep.info = JSON.parse((await send('Runtime.evaluate', { expression: `JSON.stringify(window.__ice.state.outInfo)`, returnByValue: true })).result.value);

    // 本地页面走 fetch POST 上传；线上页面（GitHub Pages 不支持 POST）回退成分片 base64 取回
    const up = await send('Runtime.evaluate', {
      expression: `(async()=>{try{
        const m=await import('./src/audio.js');const blob=m.encodeWav(window.__ice.state.outBuffer);
        const r=await fetch('/save/${encodeURIComponent(NAME)}',{method:'POST',body:blob});
        if(!r.ok) throw new Error('POST '+r.status);
        return 'POSTED';
      }catch(e){
        const m=await import('./src/audio.js');const blob=m.encodeWav(window.__ice.state.outBuffer);
        const buf=new Uint8Array(await blob.arrayBuffer());
        let s='';const CH=0x8000;
        for(let i=0;i<buf.length;i+=CH) s+=String.fromCharCode.apply(null,buf.subarray(i,i+CH));
        window.__dumpB64=btoa(s);
        return 'B64:'+window.__dumpB64.length;
      }})()`,
      returnByValue: true, awaitPromise: true,
    });
    rep.saved = up?.result?.value;
    const savedStr = String(rep.saved || '');
    if (savedStr.startsWith('B64:')) {
      const total = Number(savedStr.slice(4));
      const CH = 4 * 1024 * 1024;
      let b64 = '';
      for (let i = 0; i < total; i += CH) {
        const r = await send('Runtime.evaluate', {
          expression: `window.__dumpB64.slice(${i},${Math.min(total, i + CH)})`, returnByValue: true,
        });
        b64 += r.result.value;
      }
      const outDir = path.resolve('test/out');
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, NAME);
      fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
      rep.saved = 'FILE:' + outPath + ' (' + fs.statSync(outPath).size + ' bytes)';
      rep.fallback = true;
    } else if (savedStr === 'POSTED') {
      rep.saved = 'POST /save/' + NAME;
    }
    rep.ok = true;
  } catch (e) {
    rep.errs.push(String(e && e.stack || e));
  }
  fs.writeFileSync(REPORT, JSON.stringify(rep, null, 2));
  console.log('report ->', REPORT, rep.ok ? 'OK' : 'FAILED');
  process.exit(rep.ok ? 0 : 1);
})();
