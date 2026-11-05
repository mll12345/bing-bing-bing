// drive.js —— 用 CDP 驱动 Chrome 跑测试页，抓 window.__RESULT
// 用法: node drive.js <url> [port] [waitMs]
const http = require('http');

const url = process.argv[2] || 'http://127.0.0.1:8199/test/harness.html';
const cdpPort = Number(process.argv[3] || 9222);
const waitMs = Number(process.argv[4] || 120000);

const getJSON = (p) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: cdpPort, path: p }, (res) => {
    let s = '';
    res.on('data', (d) => (s += d));
    res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
  }).on('error', reject);
});

(async () => {
  // 找到页面 target
  let target = null;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await getJSON('/json/list');
      target = list.find((t) => t.type === 'page' && t.url.startsWith(url.split('/test/')[0]));
      if (!target) target = list.find((t) => t.type === 'page');
      if (target && target.webSocketDebuggerUrl) break;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!target) { console.log(JSON.stringify({ fatal: 'no target' })); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const logs = [];
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
    }
  };

  await new Promise((r) => (ws.onopen = r));
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });

  const t0 = Date.now();
  let result = null;
  while (Date.now() - t0 < waitMs) {
    await new Promise((r) => setTimeout(r, 700));
    const r = await send('Runtime.evaluate', {
      expression: 'JSON.stringify({done: !!window.__DONE, result: window.__RESULT || null})',
      returnByValue: true,
    });
    const v = r?.result?.value;
    if (v) {
      const o = JSON.parse(v);
      if (o.done) { result = o.result; break; }
    }
  }
  console.log(JSON.stringify({ result, logs: logs.slice(-30) }, null, 2));
  ws.close();
  process.exit(0);
})();
