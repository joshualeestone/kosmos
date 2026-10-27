'use strict';
/**
 * #4451: `kosmos connections` and `kosmos connect <service>`, the agent's side of the Connections tab.
 *
 * 🛑 THE READ MUST NEVER TOUCH THE METERED SWEEP. `kosmos connections` asks `/api/connections/held`
 * (the disk only); the stub below COUNTS any request to `/api/connections`, the page's live check that
 * bills the person for Brave, Exa, Tavily and Serper. That count must stay zero.
 * 🛑 THE TOKEN RIDES STDIN, NEVER ARGV, and the private file that carries it to the board is gone
 * afterwards. Both are asserted, not assumed.
 *
 * Harness as cli.presents-token.test.js: an in-process stub answering the CLI's own health check with a
 * page containing "Kosmos", and ASYNC child processes (a synchronous one blocks the stub's event loop).
 */
require('./test-support/tmpscope');   // #4273: first, so every temp dir this file makes is contained and removed
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');
const { eventually, scaleBudget } = require('./test-support/eventually');
const execFileP = promisify(execFile);
/* #4796: the CLI reads the board token from the data root. A fresh one here, so the live board's token never
   travels to this test's stub board (or into anything the test records). */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-connections-4451-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });

const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'bsa_0123456789abcdef0123456789abcdef';

function withStub(answers, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      seen.push({ method: req.method, url: req.url, body });
      const a = answers[req.method + ' ' + req.url];
      if (a && a.holdMs) await new Promise((r) => setTimeout(r, a.holdMs));
      if (a) { res.writeHead(a.status || 200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(a.json)); }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>Kosmos</title>Agent Workforce');
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

/* A `curl` in front of the real one that records the arguments it was given and, for every `@file` among
   them, that file's mode and whether it holds the token. That is where the token could leak (a process's
   arguments are readable by every process on the machine); the test's own spawn arguments cannot show it. */
function curlShim(dir) {
  const log = path.join(dir, 'curl.log');
  const real = ['/usr/bin/curl', '/opt/homebrew/bin/curl'].find((c) => fs.existsSync(c));
  fs.writeFileSync(path.join(dir, 'curl'), '#!/bin/bash\n'
    + 'printf "ARGS %s\\n" "$*" >> "' + log + '"\n'
    + 'for a in "$@"; do case "$a" in @*) f="${a#@}"; printf "FILE %s MODE %s\\n" "$(basename "$f")" "$(stat -c %a "$f" 2>/dev/null || stat -f %Lp "$f" 2>/dev/null)" >> "' + log + '";; esac; done\n'
    + 'exec ' + real + ' "$@"\n', { mode: 0o755 });
  return log;
}

/** Run the CLI with `stdin` piped in (or null for none), in a private TMPDIR. */
function cli(port, args, stdin, tmpdir, shimDir) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMPDIR: tmpdir };
    if (shimDir) env.PATH = shimDir + ':' + env.PATH;
    delete env.KOSMOS_AGENT_TOKEN;
    const child = spawn(CLI, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const killMs = scaleBudget(20000);   // #5727 Group C: scale the CLI kill budget by host load (floor 1 so CI is byte-identical)
    const t = setTimeout(() => child.kill('SIGKILL'), killMs);
    child.on('close', (code, sig) => {
      clearTimeout(t);
      const r = { code, out, argv: child.spawnargs };
      /* #3628: a killed CLI has no exit code; it must fail the test, never read as one. */
      if (typeof r.code !== 'number') { reject(new Error('the CLI gave no exit code (' + sig + '): killed by the ' + killMs + 'ms limit. ' + out)); return; }
      resolve(r);
    });
    if (stdin !== null) child.stdin.end(stdin); else child.stdin.end();
  });
}
const privateDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli4451-'));

/* #6432: the interrupt tests wait for a stage of the CLI before they signal it. The wait was 5 s, and a connect
   runs the board health check (which can retry on a slow answer) before it makes its private file; reasoned, not
   reproduced: under load the stage came later than 5 s and the CONTROL failed. Generous deadline (scaled), no
   fixed delay, ends early if the CLI exits. Returns { ok, exited, why }: whether the stage was reached, whether the
   CLI had exited, and, when not reached, why (the probe threw, the CLI exited first with its output, or the
   deadline passed). */
async function reachStage(child, reached, timeoutMs = 30000) {
  // Drains the CLI's output into the message, so an undrained pipe cannot fill and block the CLI.
  let out = '';
  const onData = (d) => { out += d; };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  // The CLI's own exit, not 'close': a background child holding stdout would delay 'close'.
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  let ok = false;
  // A throwing probe also ends eventually(); keep its error, so it is not read as a timeout (which eventually()
  // signals only by this message prefix, test-support/eventually.js).
  let probeError = null;
  await eventually(async () => (ok = !!(await reached())) || exited(), (v) => v, { timeoutMs, stepMs: 50 })
    .catch((e) => { if (!/^eventually: condition not met within /.test(String(e && e.message))) probeError = e; });
  const closed = exited();
  child.stdout.off('data', onData);
  child.stderr.off('data', onData);
  const why = ok ? ''
    : probeError ? ' (the stage probe threw: ' + String((probeError && probeError.message) || probeError) + ')'
    : closed ? ' (the CLI exited first: ' + JSON.stringify(out) + ')'
    : ' (not within ' + scaleBudget(timeoutMs) + 'ms)';
  return { ok, exited: closed, why };
}

/* Whether the CLI's token writer runs: a child (pgrep -P) whose whole command (ps -ww: the inline script before the
   path has line breaks) names a kosmos-connect. file found in this run's TMPDIR. The real name, not the prefix: a
   running mktemp names only its XXXXXX template. The traps are set before the writer starts, but the CLI records
   its pid one line after (_npid=$!), and bash runs a trap only between commands: a signal in that line stops the
   CLI and leaves the writer (an older cmd_connect race, see the plan). Async, and only once the file exists: this
   process also serves the health check that comes before it. */
async function writerRunning(cliPid, tmp) {
  let wants;
  try { wants = fs.readdirSync(tmp).filter((f) => f.startsWith('kosmos-connect.')).map((f) => path.join(tmp, f)); } catch { return false; }
  if (!wants.length) return false;
  let kids;
  try { kids = (await execFileP('pgrep', ['-P', String(cliPid)])).stdout.split(/\s+/).filter(Boolean); } catch { return false; }
  for (const pid of kids) {
    try {
      const cmd = (await execFileP('ps', ['-ww', '-o', 'command=', '-p', pid])).stdout;
      if (wants.some((w) => cmd.includes(w))) return true;
    } catch { /* gone: try the next */ }
  }
  return false;
}

/* #6432: a failed CONTROL assert throws before the signal and would leave the CLI running. The interrupt tests
   end in this: if the CLI is still up, SIGKILL its descendants (writer, request subshell, curl; killing the CLI
   alone runs no trap) and then the CLI; then remove the private dir. It cannot reach the children once the CLI has
   exited (they are reparented, so pgrep -P no longer finds them); only a failure path leaves such children. */
function killTree(pid) {   // children before their parent; pgrep exits 1 when there are none
  let kids = [];
  try { kids = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).split(/\s+/).filter(Boolean); } catch { /* none */ }
  for (const kid of kids) { killTree(kid); try { process.kill(Number(kid), 'SIGKILL'); } catch { /* already gone */ } }
}
function stopAndClean(child, dir) {
  if (child.exitCode === null && child.signalCode === null) {
    killTree(child.pid);
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

/* Waits for the CLI to exit after the signal. A CLI deaf to it FAILS, not hangs: after 6 s (scaled, a liveness
   ceiling) it and its descendants are killed. An already-exited CLI resolves at once (a late listener never fires).
   Resolves the exit code, or the signal name (#3628: a name never equals the 143 asserted). */
function exitAfterSignal(child) {
  return new Promise((r) => {
    if (child.exitCode !== null || child.signalCode !== null) { r(child.exitCode === null ? child.signalCode : child.exitCode); return; }
    const hard = setTimeout(() => { killTree(child.pid); child.kill('SIGKILL'); r('ignored the signal'); }, scaleBudget(6000));
    child.once('exit', (c, sig) => { clearTimeout(hard); r(c === null ? sig : c); });
  });
}

const HELD = { services: [
  { name: 'GitHub', route: '/api/github', how: 'sign-in', held: null },
  { name: 'Brave Search', route: '/api/svc/brave-search', how: 'token', held: true, connect: 'brave-search' },
  { name: 'Exa', route: '/api/svc/exa', how: 'token', held: false, connect: 'exa' },
] };

test('#4451: kosmos connections reads the cheap route, never the metered sweep, and says each state in words', () => withStub({ 'GET /api/connections/held': { json: HELD } }, async (port, seen) => {
  const r = await cli(port, ['connections'], null, privateDir());
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Brave Search: connected \(a token is stored; .*; replace it with: kosmos connect brave-search\)/);
  assert.match(r.out, /Exa: not connected \(store the token the person gives you with: kosmos connect exa\)/);
  assert.match(r.out, /GitHub: not known without a live check; the person connects it in Settings > Connections/);
  assert.ok(seen.some((q) => q.url === '/api/connections/held'), 'CONTROL: the cheap route was not asked, so the next line proves nothing');
  assert.equal(seen.filter((q) => q.url === '/api/connections').length, 0, 'kosmos connections called the metered sweep');
}));

test('#4451: kosmos connect takes the token on stdin, sends it through the door, and leaves no private file behind', () => withStub({
  'POST /api/svc/brave-search/token': { json: { service: 'Brave Search', connected: true, held: true, who: null } },
}, async (port, seen) => {
  const tmp = privateDir();
  const shim = privateDir();
  const log = curlShim(shim);
  const r = await cli(port, ['connect', 'brave-search'], TOKEN + '\n', tmp, shim);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Connected Brave Search\. Its row in Settings > Connections shows it\./);
  const post = seen.find((q) => q.method === 'POST' && q.url === '/api/svc/brave-search/token');
  assert.ok(post, 'the token did not reach the door');
  assert.deepEqual(JSON.parse(post.body), { token: TOKEN }, 'the door did not get exactly the token from stdin');
  const curlLog = fs.readFileSync(log, 'utf8');
  assert.match(curlLog, /ARGS .*\/api\/svc\/brave-search\/token/, 'CONTROL: the shim did not see the connect request, so it cannot vouch for anything');
  assert.ok(!curlLog.includes(TOKEN), 'the token was on curl\'s command line');
  const dataFile = curlLog.split('\n').find((l) => /^FILE kosmos-connect\./.test(l));
  assert.ok(dataFile, 'the token did not travel as a file');
  assert.match(dataFile, /MODE 600$/, 'the token file is readable by others: ' + dataFile);
  assert.deepEqual(fs.readdirSync(tmp).filter((f) => f.startsWith('kosmos-connect')), [], 'the private token file was left behind');
  assert.equal(seen.filter((q) => q.url === '/api/connections').length, 0, 'connect called the metered sweep');
}));

test('#4451: kosmos connect says a refusal in the service\'s words, and refuses an empty token or a bad name before sending', () => withStub({
  'POST /api/svc/exa/token': { status: 400, json: { service: 'Exa', connected: false, refused: 'Exa did not accept that token' } },
}, async (port, seen) => {
  const refused = await cli(port, ['connect', 'exa'], TOKEN, privateDir());
  assert.equal(refused.code, 1);
  assert.match(refused.out, /^Not connected: Exa did not accept that token$/m);

  const before = seen.filter((q) => q.method === 'POST').length;
  const empty = await cli(port, ['connect', 'exa'], '   \n', privateDir());
  assert.equal(empty.code, 2);
  assert.match(empty.out, /the token on stdin was empty/);
  const badName = await cli(port, ['connect', 'Brave Search'], TOKEN, privateDir());
  assert.equal(badName.code, 2);
  assert.equal(seen.filter((q) => q.method === 'POST').length, before, 'an empty token or a bad name was sent anyway');
}));

test('#4451: an interrupt while the door checks the token leaves no token file behind', () => withStub({
  'POST /api/svc/brave-search/token': { holdMs: 8000, json: { service: 'Brave Search', connected: true } },
}, async (port, seen) => {
  const tmp = privateDir();
  const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMPDIR: tmp };
  delete env.KOSMOS_AGENT_TOKEN;
  /* exit code not read (#3628) as a code: a close with none resolves the signal's NAME, which can never equal the 143 asserted, so a kill still fails. */
  const child = spawn(CLI, ['connect', 'brave-search'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(TOKEN);
  try {
    // Wait until the request is at the door (the token file exists by then), then interrupt. #5727:
    // this SETUP wait ends before the at= mark below; non-throwing, the CONTROL assert is the check.
    const atDoor = await reachStage(child, () => seen.some((q) => q.method === 'POST'));
    assert.ok(seen.some((q) => q.method === 'POST'), 'CONTROL: the request never reached the door, so the interrupt is not mid-request' + atDoor.why);
    const during = fs.readdirSync(tmp).filter((f) => f.startsWith('kosmos-connect.'));   // the token's file (the answer's is kosmos-connect-answer.)
    assert.equal(during.length, 1, 'CONTROL: the token file is not there mid-request, so its absence after proves nothing');
    const at = Date.now();
    child.kill('SIGTERM');
    const code = await exitAfterSignal(child);   // ends at once if the CLI has already exited
    const took = Date.now() - at;
    /* Promptly, not after the door answers (the stub holds it for 8 seconds): a trap that waited for the request
       would still remove the file, so the file alone could not tell prompt from late. */
    /* Fixed, not scaled: test-support/eventually.js scales only liveness ceilings, never a performance bound. */
    const quick = 2000;
    assert.ok(took < quick, 'an interrupted connect waited ' + took + 'ms (bound ' + quick + 'ms) for the door instead of stopping');
    assert.equal(code, 143, 'TERM is not reported as 128 + 15');
    assert.deepEqual(fs.readdirSync(tmp).filter((f) => f.startsWith('kosmos-connect') || f.startsWith('kosmos-auth')), [],
      'an interrupted connect left the token, its answer file, or the board token\'s header file on disk');
  } finally { stopAndClean(child, tmp); }
}));

test('#4451: an interrupt while the token is still arriving on stdin stops at once too, and leaves nothing behind', () => withStub({}, async (port, seen) => {
  const tmp = privateDir();
  const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMPDIR: tmp };
  delete env.KOSMOS_AGENT_TOKEN;
  /* exit code not read (#3628) as a code: a close with none resolves the signal's NAME, which can never equal the 143 asserted, so a kill still fails. */
  const child = spawn(CLI, ['connect', 'brave-search'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.write(TOKEN.slice(0, 8));   // a producer that has not finished (stdin stays open)
  try {
    // Wait until the token writer is running (so the private file exists and the traps are set) and waiting for
    // the rest of stdin. #5727: this SETUP wait ends before the at= mark below; non-throwing, the CONTROL asserts
    // are the check. #6432: it waits on the writer itself, not on the file plus a fixed delay.
    const writing = await reachStage(child, () => writerRunning(child.pid, tmp));
    assert.ok(fs.readdirSync(tmp).some((f) => f.startsWith('kosmos-connect.')), 'CONTROL: the private file was never made, so the writer was never reached' + writing.why);
    const fileWithoutWriter = !writing.ok && !writing.exited && fs.readdirSync(tmp).some((f) => f.startsWith('kosmos-connect.'));
    assert.ok(writing.ok, 'CONTROL: the token writer was not seen running, so the interrupt may not land while stdin is still open'
      + (fileWithoutWriter ? ' (the file exists but no child of the CLI names it: has cmd_connect changed how it starts the writer?)' : '') + writing.why);
    const at = Date.now();
    child.kill('SIGTERM');
    const code = await exitAfterSignal(child);   // ends at once if the CLI has already exited
    const took = Date.now() - at;
    /* Fixed, not scaled: test-support/eventually.js scales only liveness ceilings, never a performance bound. */
    const quick = 2000;
    assert.ok(took < quick, 'an interrupt while stdin was still open waited ' + took + 'ms (bound ' + quick + 'ms)');
    assert.equal(code, 143);
    assert.deepEqual(fs.readdirSync(tmp).filter((f) => f.startsWith('kosmos-connect') || f.startsWith('kosmos-auth')), [], 'files were left behind');
    assert.equal(seen.filter((q) => q.method === 'POST').length, 0, 'a half-read token was sent');
  } finally { stopAndClean(child, tmp); }
}));

/* The stdin test above waits for the token writer through writerRunning, which looks for a child of the CLI whose
   arguments name the kosmos-connect. file. That holds only while cmd_connect in install/kosmos starts the writer as
   a background node of its own (a direct child) with "$tmp" in its arguments. Pinned here on the launch call itself,
   so a change to how the writer starts fails this test by name rather than turning the stdin test into a timeout.
   writerRunning also reads a running writer as the interrupt traps being set, so the traps are pinned above it.
   That does not cover the one line between the launch and _npid=$!: a signal there stops the CLI, not the writer. */
test('#6432: cmd_connect starts the token writer as a background node naming "$tmp", which the stdin test waits on', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const start = src.indexOf('\ncmd_connect() {\n');
  assert.ok(start >= 0, 'CONTROL: cmd_connect was not found in install/kosmos, so nothing below is checked');
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, 'CONTROL: the end of cmd_connect was not found');
  const body = src.slice(start, end);
  // The call, at the start of a line (never a comment): node, an inline script, "$tmp", stdin handed over, and a bare &.
  const launchRe = /^[ \t]*"\$_node" -e '[^']*' "\$tmp" <&0 &[ \t]*$/gm;
  const launches = body.match(launchRe) || [];
  assert.equal(launches.length, 1, 'cmd_connect no longer starts the token writer as a background node with "$tmp" in its '
    + 'arguments, and the stdin test waits for exactly that child (writerRunning): update both together');
  // The stdin test reads a running writer as "the traps are set", so each interrupt trap must come before the launch
  // (true, though a trap that fires before _npid=$! has run has no writer pid to stop: the race in the plan).
  const launchAt = body.search(new RegExp(launchRe.source, 'm'));
  for (const sig of ['INT', 'TERM', 'HUP']) {
    const at = body.search(new RegExp("^[ \\t]*trap '_connect_stop [0-9]+' " + sig + "[ \\t]*$", 'm'));
    assert.ok(at >= 0, 'CONTROL: the ' + sig + ' trap in cmd_connect was not found, so its order is not checked');
    assert.ok(at < launchAt, 'cmd_connect sets its ' + sig + ' trap after it starts the token writer, and the stdin test '
      + 'relies on a running writer meaning the traps are set: set the traps first');
  }
});
