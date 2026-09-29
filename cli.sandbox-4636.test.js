'use strict';
/**
 * #4636 (#4580 item 10, the sandbox half): a shell whose sandbox may not connect even to 127.0.0.1 cannot reach the
 * board, and nothing in the CLI changes that. What it can do is say what is true. Before: `status` said "Kosmos is
 * not running. Start it with: kosmos start" to a running board, and `start` said another app held the port (the
 * ownership read needs ps, which such a sandbox denies). Now a refused connect while lsof shows a listener is
 * "running, but this shell cannot connect to it": status exits 5, start changes nothing, post says why.
 *   - A truly HUNG board (accepts the connection, never answers) is still recovered by the watchdog's start
 *     (KOSMOS_RECLAIM_BUSY=1): a hang is a timeout, not a refused connect.
 *   - CONTROL: the same CLI without the new guard gives the old wrong answers in the sandbox arm.
 *   - A stopped board outside the sandbox is still "not running" at once.
 * (The proxy half, #4635, is #4622's loopback NO_PROXY/no_proxy and its own tests.)
 * These drive the REAL install/kosmos under macOS sandbox-exec against stub boards in their own processes, at a
 * path that reads as a Kosmos server, with a throwaway KOSMOS_HOME, store roots and port. AGENT_WORKFORCE_LAUNCH is
 * set, so a start never goes through launchd.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4636-'));
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));
const STUB = path.join(ROOT, 'server.js');
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
// The control: the same CLI with the #4636 guard taken out (a refused connect reads as down again).
const SRC = fs.readFileSync(CLI, 'utf8');
const GUARD = 'if [ -z "$_pc" ]; then HEALTH_STATE=down; return; fi';
if (!SRC.includes(GUARD)) throw new Error('install/kosmos no longer has the #4636 guard the control takes out');
const UNFIXED = path.join(ROOT, 'kosmos-unfixed');
fs.writeFileSync(UNFIXED, SRC.replace(GUARD, 'HEALTH_STATE=down; return'), { mode: 0o755 });

const DEAD_PROXY = 'http://127.0.0.1:9';   // nothing listens on the discard port; #4622 routes loopback around it
const SANDBOX = '(version 1)(allow default)(deny network-outbound)';
const HAVE_SANDBOX = fs.existsSync('/usr/bin/sandbox-exec');

function env(port, extra = {}, homeOut, pid) {
  const e = { ...process.env };
  for (const k of ['KOSMOS_AGENT_TOKEN', 'KOSMOS_AGENT_SESSION', 'TMUX_PANE', 'KOSMOS_RECLAIM_BUSY', 'http_proxy', 'HTTP_PROXY',
    'https_proxy', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy']) delete e[k];
  const home = fs.mkdtempSync(path.join(ROOT, 'home-'));
  if (homeOut) homeOut.home = home;
  // A real board's pid is in board.pid (board-run writes it); the unreachable words say "Kosmos" only for it.
  if (pid) fs.writeFileSync(path.join(home, 'board.pid'), String(pid));
  return { ...e, KOSMOS_PORT: String(port), KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_HOME: home,
    AGENT_WORKFORCE_DATA: path.join(home, 'data'), AGENT_WORKFORCE_WORKERS: path.join(home, 'workers'),
    AGENT_WORKFORCE_LAUNCH: path.join(home, 'launch'), AGENT_WORKFORCE_PROJECTS: path.join(home, 'projects'),
    KOSMOS_BUSY_WAIT: '4', ...extra };
}
function run(cli, args, e, sandboxed) {
  const [file, argv] = sandboxed ? ['/usr/bin/sandbox-exec', ['-p', SANDBOX, cli, ...args]] : [cli, args];
  return new Promise((resolve, reject) => execFile(file, argv, { env: e, timeout: 60000 }, (err, so, se) => {
    if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + ') ' + se)); return; }
    resolve({ code: err ? err.code : 0, out: (so + se).replace(/\s+/g, ' ').trim() });
  }));
}
/** A stub board in its own process; fn(port) runs while it is up. Returns fn's result and whether the board died. */
async function withBoard(mode, fn) {
  const child = spawn(process.execPath, [STUB, mode], { stdio: ['ignore', 'pipe', 'ignore'] });
  let died = false;
  child.on('exit', () => { died = true; });
  try {
    const port = await new Promise((resolve, reject) => {
      child.stdout.once('data', (d) => resolve(Number(String(d).trim())));
      child.once('exit', (c) => reject(new Error('the stub board exited before listening: ' + c)));
    });
    const r = await fn(port, child.pid);
    await new Promise((ok) => setTimeout(ok, 300));   // a kill lands before we look
    return { ...r, died };
  } finally { if (!died) child.kill('SIGKILL'); }
}
async function freePort() {
  const srv = require('node:net').createServer();
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const { port } = srv.address();
  await new Promise((ok) => srv.close(ok));
  return port;
}
const START_ADVICE = /Start it with|kosmos start|kosmos restart/;

test('a truly HUNG board is still reclaimed by the watchdog start, with or without a proxy', async () => {
  for (const extra of [{}, { http_proxy: DEAD_PROXY }]) {
    const r = await withBoard('hang', (p) => run(CLI, ['start'], env(p, { KOSMOS_RECLAIM_BUSY: '1', ...extra })));
    assert.equal(r.died, true, JSON.stringify(extra) + ': a hung board was not recovered: ' + r.out);
    assert.match(r.out, /stale Kosmos/);
  }
});

test('a person\'s start on a hung board still says busy and leaves it alone (the #4466 rule, unchanged)', async () => {
  const r = await withBoard('hang', (p) => run(CLI, ['start'], env(p)));
  assert.equal(r.died, false, r.out);
  assert.match(r.out, /busy/);
});

test('a sandboxed shell: status exits 5 and says running but unreachable; start starts and stops nothing', { skip: !HAVE_SANDBOX && 'no sandbox-exec on this computer' }, async () => {
  const s = await withBoard('ok', (p, pid) => run(CLI, ['status'], env(p, {}, null, pid), true));
  assert.equal(s.code, 5, s.out);
  assert.match(s.out, /Kosmos is running at .*this shell cannot connect to it/);
  const plain = await withBoard('ok', (p) => run(CLI, ['status'], env(p)));   // the same board, not sandboxed
  assert.equal(plain.code, 0, plain.out);
  assert.doesNotMatch(s.out, START_ADVICE);
  for (const extra of [{}, { KOSMOS_AGENT_SESSION: 'test-agent' }]) {
    const r = await withBoard('ok', (p, pid) => run(CLI, ['start'], env(p, extra, null, pid), true));
    assert.equal(r.died, false, r.out);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /this shell cannot connect to it/);
    assert.doesNotMatch(r.out, /another app|stale/i);
  }
  const post = await withBoard('ok', (p) => run(CLI, ['post', 'proj', 'hello'], env(p, { TMUX_PANE: '%42' }), true));
  assert.notEqual(post.code, 0, post.out);
  assert.match(post.out, /this shell cannot connect to it \(.*\), so nothing can be posted/);
  assert.doesNotMatch(post.out, START_ADVICE);
});

test('a sandboxed shell: stop, restart, open and board-run change nothing and never say "not running"', { skip: !HAVE_SANDBOX && 'no sandbox-exec on this computer' }, async () => {
  const h = {};
  const stop = await withBoard('ok', (p, pid) => run(CLI, ['stop'], env(p, {}, h, pid), true));
  assert.equal(stop.died, false, stop.out);
  assert.notEqual(stop.code, 0, stop.out);
  assert.match(stop.out, /this shell cannot connect to it/);
  assert.equal(fs.existsSync(path.join(h.home, 'board.stopped')), false, 'stop wrote the deliberate-stop marker for a running board');
  const restart = await withBoard('ok', (p, pid) => run(CLI, ['restart'], env(p, {}, null, pid), true));
  assert.equal(restart.died, false, restart.out);
  assert.notEqual(restart.code, 0, restart.out);
  assert.match(restart.out, /cannot be restarted from here\. Nothing was stopped/);
  const open = await withBoard('ok', (p) => run(CLI, ['open'], env(p), true));
  assert.equal(open.code, 5, open.out);
  assert.match(open.out, /this shell cannot connect to it/);
  const boardRun = await withBoard('ok', (p) => run(CLI, ['board-run'], env(p), true));
  assert.equal(boardRun.died, false, boardRun.out);
  assert.equal(boardRun.code, 0, boardRun.out);
  for (const r of [stop, restart, open, boardRun]) assert.doesNotMatch(r.out, /not running|another app/i);
});

test('a sandboxed shell: the watchdog start (KOSMOS_RECLAIM_BUSY=1) FAILS loudly, and kills nothing', { skip: !HAVE_SANDBOX && 'no sandbox-exec on this computer' }, async () => {
  const r = await withBoard('ok', (p, pid) => run(CLI, ['start', '--force'], env(p, { KOSMOS_RECLAIM_BUSY: '1' }, null, pid), true));
  assert.equal(r.died, false, r.out);
  assert.notEqual(r.code, 0, 'an update would report success while the old board keeps serving: ' + r.out);
  assert.match(r.out, /Nothing was started or stopped/);
});

test('a sandboxed shell, a listener that is NOT node: never called Kosmos, and start does not say it is running', { skip: !HAVE_SANDBOX && 'no sandbox-exec on this computer' }, async () => {
  const py = spawn('/usr/bin/python3', ['-c', 'import socket,sys\ns=socket.socket();s.bind(("127.0.0.1",0));s.listen(5)\nprint(s.getsockname()[1],flush=True)\nimport time\ntime.sleep(120)'], { stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const port = await new Promise((resolve, reject) => {
      py.stdout.once('data', (d) => resolve(Number(String(d).trim())));
      py.once('error', reject);
      py.once('exit', (c) => reject(new Error('the python listener exited before listening: ' + c)));
    });
    const s = await run(CLI, ['status'], env(port), true);
    assert.equal(s.code, 5, s.out);
    assert.match(s.out, /Something \(.+\) is listening on port/);
    assert.doesNotMatch(s.out, /Kosmos is running/);
    const r = await run(CLI, ['start'], env(port), true);
    assert.notEqual(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /already running/);
  } finally { py.kill('SIGKILL'); }
});

test('a sandboxed shell, a node listener that is NOT this install\'s recorded board: "something (node)", never "Kosmos"', { skip: !HAVE_SANDBOX && 'no sandbox-exec on this computer' }, async () => {
  const s = await withBoard('ok', (p) => run(CLI, ['status'], env(p), true));   // no board.pid written
  assert.equal(s.code, 5, s.out);
  assert.match(s.out, /Something \(node\) is listening on port/);
  assert.doesNotMatch(s.out, /Kosmos is running/);
  const r = await withBoard('ok', (p) => run(CLI, ['start'], env(p), true));
  assert.equal(r.died, false, r.out);
  assert.notEqual(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /already running/);
});

test('a sandboxed shell, the board STOPPED: start launches it and says it started but this shell cannot reach it', { skip: !HAVE_SANDBOX && 'no sandbox-exec on this computer' }, async () => {
  // A throwaway install: its runtime is this node, its app a stub that listens on the PORT it is given, its tmux a no-op.
  const h = {};
  const e = env(await freePort(), {}, h);
  fs.mkdirSync(path.join(h.home, 'runtime', 'bin'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(h.home, 'runtime', 'bin', 'node'));
  fs.mkdirSync(path.join(h.home, 'app'), { recursive: true });
  fs.writeFileSync(path.join(h.home, 'app', 'server.js'),
    "require('node:http').createServer((q, r) => r.end('ok')).listen(Number(process.env.PORT), '127.0.0.1');\n");
  fs.mkdirSync(path.join(h.home, 'tmux', 'bin'), { recursive: true });
  fs.symlinkSync('/usr/bin/true', path.join(h.home, 'tmux', 'bin', 'tmux'));
  let pid = null;
  try {
    const t0 = Date.now();
    const r = await run(CLI, ['start'], e, true);
    pid = Number(fs.readFileSync(path.join(h.home, 'board.pid'), 'utf8')) || null;
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Kosmos started at .*\(process \d+\), but this shell cannot connect to it/);
    assert.doesNotMatch(r.out, /did not come up/);
    assert.ok(Date.now() - t0 < 12000, 'it waited out the whole start loop: ' + (Date.now() - t0) + ' ms');
  } finally { if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } }
});

test('CONTROL: without the guard, the sandboxed status says "not running" and start blames another app (the #4636 bug)', { skip: !HAVE_SANDBOX && 'no sandbox-exec on this computer' }, async () => {
  const s = await withBoard('ok', (p) => run(UNFIXED, ['status'], env(p), true));
  assert.equal(s.code, 1, s.out);
  assert.match(s.out, /Kosmos is not running\. Start it with: kosmos start/);
  const r = await withBoard('ok', (p) => run(UNFIXED, ['start'], env(p), true));
  assert.match(r.out, /Another app on this computer is already using port/);
});

test('CONTROL: outside the sandbox, a stopped board is still "not running" at once, with the start advice', async () => {
  const t0 = Date.now();
  const s = await run(CLI, ['status'], env(1));   // port 1: nothing listens
  assert.ok(Date.now() - t0 < 5000, 'a stopped board took ' + (Date.now() - t0) + ' ms to read as not running');
  assert.equal(s.code, 1, s.out);
  assert.match(s.out, /Kosmos is not running\. Start it with: kosmos start/);
});
