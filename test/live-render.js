const fs = require('node:fs');
const path = require('node:path');
const LOG = 'test/trace3.log';
fs.writeFileSync(LOG, '');
const log = (...a) => fs.appendFileSync(LOG, a.join(' ') + '\n');
process.on('exit', (c) => log('EXIT', c));
process.on('uncaughtException', (e) => { log('UNCAUGHT', String(e && e.stack || e)); process.exit(9); });
const http = require('node:http');
const PAGE = process.argv[2];
const TIMBRE = Number(process.argv[3] || 2);
(async () => {
  const list = await new Promise((res, rej) => http.get({ host: '127.0.0.1', port: 9222, path: '/json/list' }, (r) => { let s = ''; r.on('data', (d) => (s += d)); r.on('end', () => res(JSON.parse(s))); }).on('error', rej));
  const host = new URL(PAGE).host;
  const t = list.find((x) => x.type === 'page' && x.url.includes(host));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, q = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: q })); });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.navigate', { url: PAGE + '?cb=' + Date.now() });
  await new Promise((r) => setTimeout(r, 2500));
  const doc = await send('DOM.getDocument', { depth: -1 });
  const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fileInput' });
  await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [path.resolve('test/song45.mp4')] });
  for (let i = 0; i < 200; i++) {
    const r = await send('Runtime.evaluate', { expression: '!!(window.__ice&&window.__ice.state&&window.__ice.state.srcBuffer)', returnByValue: true });
    if (r && r.result && r.result.value) break;
    await new Promise((r2) => setTimeout(r2, 300));
  }
  log('decoded');
  await send('Runtime.evaluate', { expression: `(()=>{const s=(i,v)=>{const e=document.getElementById(i);if(e){e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))}};s('voice',1);s('timbre',${TIMBRE});s('keep',0);s('rev',0.25);s('sparkle',0.3);s('maxLen',180);document.querySelector('.group-btn[data-g="${TIMBRE}"]').click();return document.getElementById('vTimbre').textContent})()` , returnByValue: true });
  log('params set');
  await send('Runtime.evaluate', { expression: `document.getElementById('btnRender').click()` });
  let info = null;
  for (let i = 0; i < 600; i++) {
    const r = await send('Runtime.evaluate', { expression: 'window.__ice&&window.__ice.state&&window.__ice.state.outBuffer?JSON.stringify(window.__ice.state.outInfo):""', returnByValue: true });
    const v = r && r.result && r.result.value;
    if (v) { info = v; break; }
    await new Promise((r2) => setTimeout(r2, 500));
  }
  log('info', info);
  const stats = await send('Runtime.evaluate', { expression: `document.getElementById('stats')?document.getElementById('stats').innerText.replace(/\\n/g,' '):''`, returnByValue: true });
  log('stats', stats && stats.result && stats.result.value);
  const err = await send('Runtime.evaluate', { expression: `document.getElementById('errBox')?document.getElementById('errBox').innerText:''`, returnByValue: true });
  log('err', JSON.stringify(err && err.result && err.result.value));
  console.log('INFO', info);
  console.log('STATS', stats && stats.result && stats.result.value);
  ws.close();
  process.exit(0);
})();
