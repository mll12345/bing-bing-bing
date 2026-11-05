// shot-clean.js —— 关掉缓存再截图，验证线上真的更新了
const http = require('http');
const fs = require('fs');

const PAGE = process.argv[2];
const OUT = process.argv[3] || 'test/clean.png';
const W = Number(process.argv[4] || 1280);
const H = Number(process.argv[5] || 1400);

const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9222, path: p }, (r) => {
    let s = ''; r.on('data', (d) => (s += d)); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

(async () => {
  const list = await getJSON('/json/list');
  const t = list.find((x) => x.type === 'page' && /^https?:/.test(x.url));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, q = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: q })); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); }
  };
  await new Promise((r) => (ws.onopen = r));

  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: PAGE });
  await new Promise((r) => setTimeout(r, 3500));

  const probe = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      speedLbl: document.getElementById('vSpeed').textContent,
      speedVal: document.getElementById('speed').value,
      howto: document.querySelector('.howto').textContent.slice(0, 120)
    })`,
    returnByValue: true,
  });

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log(JSON.stringify({ out: OUT, probe: JSON.parse(probe.result.value) }, null, 2));
  ws.close();
  process.exit(0);
})();
