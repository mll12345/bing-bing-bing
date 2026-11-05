// video-test.js —— 单独验证 recordVideo：真录 4 秒，检查 blob 大小/时长是否合理
const http = require('http');

const PAGE = process.argv[2] || 'http://127.0.0.1:8199/';

const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9222, path: p }, (r) => {
    let s = ''; r.on('data', (d) => (s += d)); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

(async () => {
  const list = await getJSON('/json/list');
  const t = list.find((x) => x.type === 'page' && /^https?:/.test(x.url));
  if (!t) throw new Error('no page target');

  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, q = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: q })); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); }
  };
  await new Promise((r) => (ws.onopen = r));

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: PAGE });
  await new Promise((r) => setTimeout(r, 2500));

  const expr = `(async () => {
    const mod = await import('./src/audio.js');
    const ctx = mod.getCtx();
    await ctx.resume();
    // 4 秒测试音：正弦 + 每 0.5 秒一个脉冲，方便听出录制是否跟拍
    const sr = 48000, dur = 4;
    const buf = ctx.createBuffer(2, sr * dur, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) {
        const tt = i / sr;
        d[i] = Math.sin(2 * Math.PI * 440 * tt) * 0.25
             + (tt % 0.5 < 0.03 ? Math.sin(2 * Math.PI * 80 * tt) * 0.5 : 0);
      }
    }
    const t0 = performance.now();
    const blob = await mod.recordVideo(buf, { title: '测试歌名', subtitle: '🧊 TEST', bpm: 128 });
    const ms = performance.now() - t0;
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    return {
      type: blob.type,
      size: blob.size,
      wallMs: Math.round(ms),
      head: Array.from(head).map((b) => b.toString(16).padStart(2, '0')).join(' '),
      // 1a 45 df a3 = EBML 头（webm）
    };
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result?.value ?? r, null, 2));
  ws.close();
  process.exit(0);
})();
