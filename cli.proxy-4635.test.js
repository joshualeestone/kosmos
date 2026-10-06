'use strict';
/**
 * #4635 (#4580 items 6 and 10): In a shell with a proxy set (lowercase http_proxy or ALL_PROXY),
 * `kosmos start` must not kill a healthy board as "your own stale Kosmos", and `status` must
 * report that Kosmos is running.
 *
 *   - A PROXIED shell (lowercase http_proxy, all_proxy, or ALL_PROXY): curl sends loopback
 *     directly via exported NO_PROXY/no_proxy loopback exemptions (install/kosmos). `status`
 *     reports running, `post` posts, and `start` sees the board is already running and leaves
 *     it alive (both as a person and as an agent).
 *   - Belt and braces: even if the probe cannot read the board (proxy bypass removed),
 *     _listener_is_our_board recognises the recorded pid and start leaves it alive.
 *   - CONTROL: without both fixes, the unfixed CLI reproduces the #4635 bug and kills the board.
 *   - A truly HUNG board (accepts the connection, never answers) is still recovered by the
 *     watchdog start (KOSMOS_RECLAIM_BUSY=1), with or without a proxy. A person's start on a
 *     hung board says busy and leaves it alone.
 *   - Diagnostic N13 (#4933): in a proxy-only sandbox where direct loopback is blocked and a
 *     proxy forwards to Kosmos, loopback calls route through the proxy.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4635-'));
process.env.AGENT_WORKFORCE_DATA = path.join(ROOT, 'data');
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const APP_DIR = path.join(ROOT, 'app');
fs.mkdirSync(APP_DIR, { recursive: true });
const STUB = path.join(APP_DIR, 'server.js');
fs.writeFileSync(STUB, `'use strict';
const http = require('node:http');
const hang = process.argv[2] === 'hang';
http.createServer((req, res) => {
  if (hang) return;   // takes the connection, never answers
  if (req.url.startsWith('/api/health')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"app":"kosmos","ok":true}'); return; }
  if (req.method === 'POST' && req.url.startsWith('/api/post')) {
    req.resume();
    req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"delivery":{"state":"placed"}}'); });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Kosmos</title>Agent Workforce');
}).listen(0, '127.0.0.1', function () { process.stdout.write(this.address().port + '\\n'); });
`);

const DEAD_PROXY = 'http://127.0.0.1:9';   // discard port, nothing listens

function env(port, pid, extra = {}) {
  const e = { ...process.env, AGENT_WORKFORCE_DATA: path.join(ROOT, 'data') };
  for (const k of ['KOSMOS_AGENT_TOKEN', 'KOSMOS_AGENT_SESSION', 'TMUX_PANE', 'KOSMOS_RECLAIM_BUSY', 'http_proxy', 'HTTP_PROXY',
    'https_proxy', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'KOSMOS_LOOPBACK_PROBE_URL']) delete e[k];
  const home = fs.mkdtempSync(path.join(ROOT, 'home-'));
  if (pid) {
    fs.writeFileSync(path.join(home, 'board.pid'), String(pid) + '\n');
  }
  return { ...e, KOSMOS_PORT: String(port), KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_HOME: home,
    AGENT_WORKFORCE_DATA: path.join(home, 'data'), AGENT_WORKFORCE_WORKERS: path.join(home, 'workers'),
    AGENT_WORKFORCE_LAUNCH: path.join(home, 'launch'), AGENT_WORKFORCE_PROJECTS: path.join(home, 'projects'),
    KOSMOS_BUSY_WAIT: '3', ...extra };
}

function run(cli, args, e) {
  return new Promise((resolve, reject) => execFile(cli, args, { env: e, timeout: 60000 }, (err, so, se) => {
    if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + ') ' + se)); return; }
    resolve({ code: err ? err.code : 0, out: (so + se).replace(/\s+/g, ' ').trim() });
  }));
}

/** A stub board in its own process; fn(port, pid) runs while it is up. Returns fn result and whether the board died. */
async function withBoard(mode, fn) {
  // exit code not read (#3628): this is the stub BOARD, not the CLI under test; an early exit is caught below.
  const child = spawn(process.execPath, [STUB, mode], { stdio: ['ignore', 'pipe', 'ignore'] });
  let died = false;
  child.on('exit', () => { died = true; });
  try {
    const port = await new Promise((resolve, reject) => {
      child.stdout.once('data', (d) => resolve(Number(String(d).trim())));
      child.once('exit', (c) => reject(new Error('the stub board exited before listening: ' + c)));
    });
    const r = await fn(port, child.pid);
    await new Promise((ok) => setTimeout(ok, 300));   // allow signal propagation if killed
    return { ...r, died };
  } finally {
    if (!died) child.kill('SIGKILL');
  }
}

const START_ADVICE = /Start it with|kosmos start|kosmos restart/;

test('#4635 a proxied shell: status says running, post posts (controls: no proxy, and NO_PROXY=127.0.0.1)', async () => {
  for (const extra of [
    {},
    { http_proxy: DEAD_PROXY },
    { ALL_PROXY: DEAD_PROXY },
    { all_proxy: DEAD_PROXY },
    { http_proxy: DEAD_PROXY, NO_PROXY: '127.0.0.1' },
    { http_proxy: DEAD_PROXY, no_proxy: 'corp.example' },
  ]) {
    const s = await withBoard('ok', (p, pid) => run(CLI, ['status'], env(p, pid, extra)));
    assert.equal(s.code, 0, JSON.stringify(extra) + ': ' + s.out);
    assert.match(s.out, /Kosmos is running at/);
    assert.doesNotMatch(s.out, START_ADVICE);
  }
  const post = await withBoard('ok', (p, pid) => run(CLI, ['post', 'proj', 'hello'], env(p, pid, { http_proxy: DEAD_PROXY, TMUX_PANE: '%42' })));
  assert.equal(post.code, 0, post.out);
  assert.match(post.out, /Posted to proj/);
});

test('#4635 a proxied shell: start leaves a healthy board alive, as a person and as an agent', async () => {
  for (const extra of [{}, { KOSMOS_AGENT_SESSION: 'test-agent' }]) {
    const r = await withBoard('ok', (p, pid) => run(CLI, ['start'], env(p, pid, { http_proxy: DEAD_PROXY, ...extra })));
    assert.equal(r.died, false, 'the board was killed: ' + r.out);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /already running/);
    assert.doesNotMatch(r.out, /stale|Reclaiming/);
  }
});

test('#4635 CONTROL: without NO_PROXY/loopback exemption and without _listener_is_our_board, start kills the board', async () => {
  const src = fs.readFileSync(CLI, 'utf8');
  let unfixed = src.replace(/case ",\$\{NO_PROXY:-\}," in[\s\S]*?export NO_PROXY no_proxy/, '# NO_PROXY removed');
  unfixed = unfixed.replace(/kosmos_loopback_route\(\) \{[\s\S]*?\n\}/, 'kosmos_loopback_route() { return 0; }');
  unfixed = unfixed.replace(/if \[ "\$\{KOSMOS_RECLAIM_BUSY:-\}" != 1 \]; then\s+local _ours[\s\S]*?fi\s+fi/, '# guard removed');
  const unfixedCli = path.join(ROOT, 'kosmos-unfixed');
  fs.writeFileSync(unfixedCli, unfixed, { mode: 0o755 });

  const r = await withBoard('ok', (p, pid) => run(unfixedCli, ['start'], env(p, pid, { http_proxy: DEAD_PROXY })));
  assert.equal(r.died, true, 'the unfixed CLI did not kill the board: ' + r.out);
  assert.match(r.out, /stale Kosmos/);
});

test('#4635 the second guard alone: with the proxy bypass removed, a proxied start still leaves the board alive', async () => {
  const src = fs.readFileSync(CLI, 'utf8');
  let noProxyBypass = src.replace(/case ",\$\{NO_PROXY:-\}," in[\s\S]*?export NO_PROXY no_proxy/, '# NO_PROXY removed');
  noProxyBypass = noProxyBypass.replace(/kosmos_loopback_route\(\) \{[\s\S]*?\n\}/, 'kosmos_loopback_route() { return 0; }');
  const guardOnlyCli = path.join(ROOT, 'kosmos-guard-only');
  fs.writeFileSync(guardOnlyCli, noProxyBypass, { mode: 0o755 });

  const r = await withBoard('ok', (p, pid) => run(guardOnlyCli, ['start'], env(p, pid, { http_proxy: DEAD_PROXY })));
  assert.equal(r.died, false, 'the board was killed: ' + r.out);
  assert.match(r.out, /already running at .* but it did not answer this command/);
});

test('#4635 a truly HUNG board is still reclaimed by the watchdog start, with or without a proxy', async () => {
  for (const extra of [{}, { http_proxy: DEAD_PROXY }]) {
    const r = await withBoard('hang', (p, pid) => run(CLI, ['start'], env(p, pid, { KOSMOS_RECLAIM_BUSY: '1', ...extra })));
    assert.equal(r.died, true, JSON.stringify(extra) + ': a hung board was not recovered: ' + r.out);
    assert.match(r.out, /stale Kosmos/);
  }
});

test('#4635 a person start on a hung board still says busy and leaves it alone', async () => {
  const r = await withBoard('hang', (p, pid) => run(CLI, ['start'], env(p, pid)));
  assert.equal(r.died, false, r.out);
  assert.match(r.out, /busy/);
});

test('#4635 diagnostic N13: blocked direct loopback with a forwarding proxy routes to the board', () => withBoard('ok', async (port, pid) => {
  const hits = [];
  const proxy = http.createServer((req, res) => {
    hits.push(req.url);
    const up = http.request(req.url, { method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const proxyPort = proxy.address().port;
  const pUrl = 'http://127.0.0.1:' + proxyPort;
  try {
    const e = env(port, pid, {
      http_proxy: pUrl,
      all_proxy: pUrl,
      ALL_PROXY: pUrl,
      KOSMOS_LOOPBACK_PROBE_URL: 'http://127.0.0.1:0/',
    });
    const s = await run(CLI, ['status'], e);
    assert.equal(s.code, 0, s.out);
    assert.match(s.out, /Kosmos is running at/);
    assert.ok(hits.some((u) => u.includes(':' + port + '/')), 'status did not reach the board via proxy: ' + JSON.stringify(hits));

    const post = await run(CLI, ['post', 'proj', 'hello via proxy'], { ...e, TMUX_PANE: '%42' });
    assert.equal(post.code, 0, post.out);
    assert.match(post.out, /Posted to proj/);

    const start = await run(CLI, ['start'], e);
    assert.equal(start.code, 0, start.out);
    assert.match(start.out, /already running/);
  } finally {
    await new Promise((r) => proxy.close(r));
  }
}));
