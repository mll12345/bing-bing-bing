// api-push.js —— git HTTPS 通道不通时，用 GitHub REST API 把本地提交同步到远端
// 原理：本地 git 的 blob sha1 与 GitHub 的 blob sha 同算法 → 比对 tree，只传差异
// token 从环境变量 GITHUB_TOKEN 或 git credential helper 里取，不写死在文件里
// 用法: node test/api-push.js "提交信息"
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const REPO = process.env.GITHUB_REPO || 'mll12345/bing-bing-bing';
const BR = process.env.GITHUB_BRANCH || 'main';
const MSG = process.argv[2] || 'sync';

function readToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const m = out.match(/^password=(.+)$/m);
  if (!m) throw new Error('取不到 GitHub token（设 GITHUB_TOKEN 或检查 git credential helper）');
  return m[1].trim();
}

const TOKEN = readToken();
const H = {
  Authorization: 'token ' + TOKEN,
  'User-Agent': 'dsh',
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
};

const api = async (p, opt = {}) => {
  const r = await fetch('https://api.github.com' + p, { ...opt, headers: H });
  const t = await r.text();
  if (!r.ok) throw new Error(p + ' -> ' + r.status + ' ' + t.slice(0, 400));
  return t ? JSON.parse(t) : {};
};

(async () => {
  const ls = execFileSync('git', ['ls-files', '-s', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const local = new Map();
  for (const line of ls) {
    const m = line.match(/^(\d+) ([0-9a-f]{40}) \d+\t(.+)$/);
    if (m) local.set(m[3].replace(/\\/g, '/'), m[2]);
  }
  console.log('local files', local.size);

  const ref = await api(`/repos/${REPO}/git/ref/heads/${BR}`);
  const parent = ref.object.sha;
  const parentCommit = await api(`/repos/${REPO}/git/commits/${parent}`);
  const remoteTree = await api(`/repos/${REPO}/git/trees/${parentCommit.tree.sha}?recursive=1`);
  const remote = new Map();
  for (const e of remoteTree.tree || []) if (e.type === 'blob') remote.set(e.path, e.sha);
  console.log('remote files', remote.size);

  const entries = [];
  let add = 0;
  let del = 0;

  for (const [p, sha] of local) {
    if (remote.get(p) === sha) continue;
    // 注意：git/trees 的内联 content 按 UTF-8 文本存，base64 会让远端变成一串编码。
    // 所有文件都必须先走 /git/blobs（那里 encoding:base64 才生效），tree 只引用 sha。
    const b = fs.readFileSync(p);
    const blob = await api(`/repos/${REPO}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: b.toString('base64'), encoding: 'base64' }),
    });
    entries.push({ path: p, mode: '100644', type: 'blob', sha: blob.sha });
    add++;
  }
  for (const p of remote.keys()) {
    if (!local.has(p)) { entries.push({ path: p, mode: '100644', type: 'blob', sha: null }); del++; }
  }
  console.log('changed/added', add, 'deleted', del);
  if (!entries.length) { console.log('远端已是最新'); return; }

  const tree = await api(`/repos/${REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: parentCommit.tree.sha, tree: entries }),
  });
  const nc = await api(`/repos/${REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message: MSG, tree: tree.sha, parents: [parent] }),
  });
  await api(`/repos/${REPO}/git/refs/heads/${BR}`, { method: 'PATCH', body: JSON.stringify({ sha: nc.sha, force: false }) });
  console.log('PUSHED', nc.sha);
})();
