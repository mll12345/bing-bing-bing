const fs = require('node:fs');
const LOG = 'test/trace2.log';
fs.writeFileSync(LOG, '');
const log = (...a) => fs.appendFileSync(LOG, a.join(' ') + '\n');
process.on('exit', (c) => log('EXIT', c));
process.on('uncaughtException', (e) => { log('UNCAUGHT', e && e.stack); process.exit(9); });
process.on('unhandledRejection', (e) => log('UNHANDLED', String(e && e.stack || e)));
const http = require('node:http');
const PAGE = process.argv[2];
(async () => {
  log('start', PAGE);
  const list = await new Promise((res, rej) => http.get({ host: '127.0.0.1', port: 9222, path: '/json/list' }, (r) => { let s = ''; r.on('data', (d) => (s += d)); r.on('end', () => res(JSON.parse(s))); }).on('error', rej));
  const host = new URL(PAGE).host;
  const t = list.find((x) => x.type === 'page' && x.url.includes(host));
  log('target', t && t.url);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, q = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: q })); });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
  await new Promise((r) => (ws.onopen = r));
  log('open');
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  log('enabled');
  await send('Page.navigate', { url: PAGE });
  log('navigated');
  await new Promise((r) => setTimeout(r, 2000));
  const doc = await send('DOM.getDocument', { depth: -1 });
  const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fileInput' });
  log('input node', q && q.nodeId);
  await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [require('node:path').resolve('test/song45.mp4')] });
  log('file set');
  for (let i = 0; i < 60; i++) {
    const r = await send('Runtime.evaluate', { expression: '!!(window.__ice && window.__ice.state && window.__ice.state.srcBuffer)', returnByValue: true });
    if (r && r.result && r.result.value) { log('decoded at', i * 300, 'ms'); break; }
    await new Promise((r2) => setTimeout(r2, 300));
    if (i === 59) log('decode TIMEOUT');
  }
  log('done');
  ws.close();
  process.exit(0);
})();
