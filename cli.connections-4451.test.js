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
const { spawn } = require('node:child_process');
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
    + 'for a in "$@"; do case "$a" in @*) f="${a#@}"; printf "FILE %s MODE %s\\n" "$(basename "$f")" "$(stat -f %Lp "$f" 2>/dev/null || stat -c %a "$f")" >> "' + log + '";; esac; done\n'
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
    const t = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('close', (code, sig) => {
      clearTimeout(t);
      const r = { code, out, argv: child.spawnargs };
      /* #3628: a killed CLI has no exit code; it must fail the test, never read as one. */
      if (typeof r.code !== 'number') { reject(new Error('the CLI gave no exit code (' + sig + '): killed by the 20s limit. ' + out)); return; }
      resolve(r);
    });
    if (stdin !== null) child.stdin.end(stdin); else child.stdin.end();
  });
}
const privateDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli4451-'));

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
  // Wait until the request is at the door (the token file exists by then), then interrupt.
  for (let i = 0; i < 100 && !seen.some((q) => q.method === 'POST'); i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.ok(seen.some((q) => q.method === 'POST'), 'CONTROL: the request never reached the door, so the interrupt is not mid-request');
  const during = fs.readdirSync(tmp).filter((f) => f.startsWith('kosmos-connect.'));   // the token's file (the answer's is kosmos-connect-answer.)
  assert.equal(during.length, 1, 'CONTROL: the token file is not there mid-request, so its absence after proves nothing');
  const at = Date.now();
  child.kill('SIGTERM');
  /* A CLI deaf to the signal must FAIL this test, not hang it: after 6s it is killed and reported. */
  const code = await new Promise((r) => {
    const hard = setTimeout(() => { child.kill('SIGKILL'); r('ignored the signal'); }, 6000);
    child.on('close', (c, sig) => { clearTimeout(hard); r(c === null ? sig : c); });
  });
  const took = Date.now() - at;
  /* Promptly, not after the door answers (the stub holds it for 8 seconds): a trap that waited for the request
     would still remove the file, so the file alone could not tell prompt from late (review round 2). */
  assert.ok(took < 2000, 'an interrupted connect waited ' + took + 'ms for the door instead of stopping');
  assert.equal(code, 143, 'TERM is not reported as 128 + 15');
  assert.deepEqual(fs.readdirSync(tmp).filter((f) => f.startsWith('kosmos-connect') || f.startsWith('kosmos-auth')), [],
    'an interrupted connect left the token, its answer file, or the board token\'s header file on disk (review round 3)');
}));

test('#4451: an interrupt while the token is still arriving on stdin stops at once too, and leaves nothing behind', () => withStub({}, async (port, seen) => {
  const tmp = privateDir();
  const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMPDIR: tmp };
  delete env.KOSMOS_AGENT_TOKEN;
  /* exit code not read (#3628) as a code: a close with none resolves the signal's NAME, which can never equal the 143 asserted, so a kill still fails. */
  const child = spawn(CLI, ['connect', 'brave-search'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.write(TOKEN.slice(0, 8));   // a producer that has not finished (stdin stays open)
  // Wait until the private token file exists: the writer is running and waiting for the rest of stdin.
  for (let i = 0; i < 100 && !fs.readdirSync(tmp).some((f) => f.startsWith('kosmos-connect.')); i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.ok(fs.readdirSync(tmp).some((f) => f.startsWith('kosmos-connect.')), 'CONTROL: the private file was never made, so the writer was never reached');
  await new Promise((r) => setTimeout(r, 300));
  const at = Date.now();
  child.kill('SIGTERM');
  /* A CLI deaf to the signal must FAIL this test, not hang it: after 6s it is killed and reported. */
  const code = await new Promise((r) => {
    const hard = setTimeout(() => { child.kill('SIGKILL'); r('ignored the signal'); }, 6000);
    child.on('close', (c, sig) => { clearTimeout(hard); r(c === null ? sig : c); });
  });
  const took = Date.now() - at;
  assert.ok(took < 2000, 'an interrupt while stdin was still open waited ' + took + 'ms');
  assert.equal(code, 143);
  assert.deepEqual(fs.readdirSync(tmp).filter((f) => f.startsWith('kosmos-connect') || f.startsWith('kosmos-auth')), [], 'files were left behind');
  assert.equal(seen.filter((q) => q.method === 'POST').length, 0, 'a half-read token was sent');
}));

