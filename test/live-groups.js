const PAGE = process.argv[2];
(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const host = new URL(PAGE).host;
  const t = list.find((x) => x.type === 'page' && x.url.includes(host)) || list.find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const wait = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.navigate', { url: PAGE + (PAGE.includes('?') ? '&' : '?') + 'cb=' + Date.now() });
  await new Promise((r) => setTimeout(r, 3500));
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r.result?.result?.value;
  };
  console.log('group buttons:', await ev(`document.querySelectorAll('.group-btn').length`));
  console.log('label default:', await ev(`document.getElementById('vTimbre').textContent`));
  // 点第 3 组
  await ev(`document.querySelector('.group-btn[data-g="3"]').click()`);
  await new Promise((r) => setTimeout(r, 1200));
  console.log('after click label:', await ev(`document.getElementById('vTimbre').textContent`));
  console.log('slider value:', await ev(`document.getElementById('timbre').value`));
  console.log('audio src:', await ev(`document.getElementById('groupAudio').src.split('/').slice(-1)[0]`));
  console.log('audio readyState/dur:', await ev(`(a=>a.readyState+'/'+a.duration.toFixed(2))(document.getElementById('groupAudio'))`));
  console.log('playing state:', await ev(`(a=>a.paused?'paused':'playing')(document.getElementById('groupAudio'))`));
  console.log('on class count:', await ev(`document.querySelectorAll('.group-btn.on').length`));
  ws.close();
  process.exit(0);
})();
