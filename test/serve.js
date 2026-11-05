// serve.js —— 极简静态服务器（测试用）
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

const port = Number(process.argv[2] || 8199);
http.createServer((req, res) => {
  // POST /save/<name> → 落盘（测试用，把页面里生成的 WAV/WebM 存下来）
  if (req.method === 'POST' && req.url.startsWith('/save/')) {
    const name = path.basename(decodeURIComponent(req.url.slice(6)));
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const out = path.join(root, 'test', 'out', name);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.concat(chunks));
      console.log('saved ' + out + ' ' + fs.statSync(out).size + 'B');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: out, bytes: fs.statSync(out).size }));
    });
    return;
  }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root)) { res.writeHead(403).end('no'); return; }
  fs.readFile(f, (e, buf) => {
    if (e) { res.writeHead(404).end('404 ' + p); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(port, '127.0.0.1', () => console.log('serving ' + root + ' on http://127.0.0.1:' + port));
