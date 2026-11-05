// render-full.js —— 长曲渲染：注入文件 → 触发渲染 → 轮询进度 → WAV POST 落盘
// 用法: node test/render-full.js <pageUrl> <inputFile> <outName.wav> [voice] [timbre] [keep] [rev] [sparkle] [maxLen]
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const PAGE = process.argv[2] || 'http://127.0.0.1:8199/';
const INPUT = process.argv[3];
const OUTNAME = process.argv[4] || 'out.wav';
const num = (i, d) => {
  const v = Number(process.argv[i]);
  return Number.isFinite(v) ? v : d;
};
const OPTS = {
  voice: num(5, 1),
  timbre: num(6, 2),
  keep: num(7, 0),
  rev: num(8, 0.25),
  sparkle: num(9, 0.3),
  maxLen: num(10, 300),
};

const CDP = 'http://127.0.0.1:9222';

async function listTargets() {
  const res = await fetch(CDP + '/json/list');
  return res.json();
}

(async () => {
  if (!INPUT) { console.error('缺少输入文件'); process.exit(2); }
  const filePath = path.resolve(INPUT);
  if (!fs.existsSync(filePath)) { console.error('文件不存在: ' + filePath); process.exit(2); }

  const targets = (await listTargets()).filter((t) => t.type === 'page' && t.url.includes('8199'));
  let target = targets[0];
  if (!target) {
    const created = await (await fetch(CDP + '/json/new?' + encodeURIComponent(PAGE), { method: 'PUT' })).json();
    target = created;
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  const logs = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      logs.push('EXC ' + (msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      logs.push('ERR ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  });

  await new Promise((r) => ws.addEventListener('open', r));
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  await send('Page.navigate', { url: PAGE + (PAGE.includes('?') ? '&' : '?') + 'cb=' + Date.now() });
  await new Promise((r) => setTimeout(r, 1500));

  const doc = await send('DOM.getDocument', { depth: -1 });
  const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fileInput' });
  if (!q.nodeId) { console.error('找不到 #fileInput'); process.exit(2); }
  await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [filePath] });

  // 等 srcBuffer 就绪
  const waitFor = async (expr, timeoutMs, label) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.value) return r.result.value;
      await new Promise((res) => setTimeout(res, 400));
    }
    throw new Error('超时等待: ' + label);
  };

  await waitFor('window.__ice && window.__ice.state.srcBuffer ? window.__ice.state.srcBuffer.duration : 0', 120000, 'srcBuffer');
  const inDur = await send('Runtime.evaluate', {
    expression: 'window.__ice.state.srcBuffer.duration', returnByValue: true,
  });
  console.log('输入时长: ' + inDur.result.value.toFixed(2) + 's');

  // 设置参数并渲染
  const setup = `
    (() => {
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
      set('voice', ${OPTS.voice}); set('timbre', ${OPTS.timbre}); set('keep', ${OPTS.keep});
      set('rev', ${OPTS.rev}); set('sparkle', ${OPTS.sparkle});
      set('maxLen', ${OPTS.maxLen});
      document.getElementById('btnRender').click();
      return true;
    })()
  `;
  const t0 = Date.now();
  await send('Runtime.evaluate', { expression: setup, returnByValue: true });

  let last = '';
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const st = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        busy: window.__ice.state.busy,
        has: !!window.__ice.state.outBuffer,
        text: (document.getElementById('progText')||{}).textContent || '',
        bar: (document.getElementById('progBar')||{}).style ? (document.getElementById('progBar').style.width) : '',
        err: (document.getElementById('errBox')||{}).textContent || ''
      })`,
      returnByValue: true,
    });
    const s = JSON.parse(st.result.value);
    if (s.text !== last) { last = s.text; console.log(`  ${s.bar.padEnd(6)} ${s.text}`); }
    if (s.err) { console.error('页面错误: ' + s.err); break; }
    if (s.has && !s.busy) break;
    await new Promise((r) => setTimeout(r, 700));
  }
  console.log('渲染耗时: ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

  const info = await send('Runtime.evaluate', {
    expression: 'JSON.stringify(window.__iceInfo || {})', returnByValue: true,
  });
  console.log('info: ' + info.result.value);

  // WAV 由页面 fetch POST 落盘
  const save = await send('Runtime.evaluate', {
    expression: `(async () => {
      const mod = await import('/src/audio.js');
      const blob = mod.encodeWav(window.__ice.state.outBuffer);
      const r = await fetch('/save/${encodeURIComponent(OUTNAME)}', { method: 'POST', body: blob });
      return blob.size + '|' + r.status;
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (save.exceptionDetails) {
    console.error('保存失败: ' + (save.exceptionDetails.exception?.description || save.exceptionDetails.text));
  } else {
    console.log('WAV: ' + save.result.value);
  }
  if (logs.length) console.log(logs.join('\n'));
  ws.close();
  const ok = !save.exceptionDetails;
  fs.writeFileSync('test/render-report.json', JSON.stringify({ ok, opts: OPTS, info: info.result.value }, null, 2));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
