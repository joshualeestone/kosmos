'use strict';
/**
 * #1765: in the installed layout the CLI sends a token only to a listener that proves it already holds that token
 * (kosmos_board_proven, engine/boardproof.js). Another account can listen on this account's port while the board is
 * down; the CLI must send it nothing.
 *
 * The installed layout is built here: a KOSMOS_HOME whose runtime/bin/node is this node and whose app/engine is the
 * repo's engine. Every other CLI test runs from the checkout (no runtime), where the proof is skipped; the CONTROL
 * arm below runs that way against the same squatter and must see the token arrive, so the main arm's "nothing
 * arrived" is a real negative. Harness as cli.accounts-5359.test.js.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const boardproof = require('./engine/boardproof');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-boardproof-1765-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = DATA;
const ROOT = require('./engine/store').ROOT;
fs.mkdirSync(ROOT, { recursive: true });
const TOK = 'board-tok-1765';
fs.writeFileSync(path.join(ROOT, 'board.token'), TOK + '\n', { mode: 0o600 });

const CLI = path.join(__dirname, 'install', 'kosmos');

// The installed layout: runtime/bin/node and app/engine, as setup.sh lays them out.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-home-1765-'));
process.on('exit', () => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best effort */ } });
fs.mkdirSync(path.join(HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(HOME, 'runtime', 'bin', 'node'));
fs.mkdirSync(path.join(HOME, 'app'), { recursive: true });
fs.symlinkSync(path.join(__dirname, 'engine'), path.join(HOME, 'app', 'engine'));

/* A board stand-in. `prove` decides whether it can answer the proof (it holds TOK) or is a squatter that answers
   every request, the proof route included, with something plausible. `proofAnswer` 'notfound' answers the proof
   with a 404 page instead, and 'silent' never answers it. */
function withStub({ prove, proofAnswer }, fn) {
  const held = [];
  const seen = [];
  const server = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      const u = new URL(req.url, 'http://x');
      if (u.pathname === boardproof.PROOF_PATH) {
        if (proofAnswer === 'silent') { held.push(res); return; }
        if (proofAnswer === 'notfound') { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<h1>Not Found</h1>'); }
        const q = Object.fromEntries(u.searchParams);
        const out = prove ? boardproof.answer(q, () => [TOK], req.socket.localPort) : { status: 200, body: { proof: 'a'.repeat(64) } };
        res.writeHead(out.status, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(out.body));
      }
      if (req.method === 'GET' && u.pathname === '/api/accounts') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ accounts: [] }));
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>Kosmos</title>Agent Workforce');
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      for (const r of held) { try { r.destroy(); } catch { /* gone */ } }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

function cli(port, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port) };
    delete env.KOSMOS_AGENT_TOKEN;
    delete env.KOSMOS_HOME;   // the runner's own install must not decide the layout: each arm names its own
    Object.assign(env, extraEnv);
    const child = spawn(CLI, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('close', (code, sig) => {
      clearTimeout(t);
      if (typeof code !== 'number') { reject(new Error('the CLI gave no exit code (' + sig + '). ' + out)); return; }
      resolve({ code, out });
    });
  });
}

const tokenSent = (seen) => seen.some((r) => r.headers['x-kosmos-board-token'] === TOK);

test('#1765: installed CLI sends the token to a listener that proves it holds it', () => withStub({ prove: true }, async (port, seen) => {
  const r = await cli(port, ['accounts'], { KOSMOS_HOME: HOME });
  assert.equal(r.code, 0, r.out);
  assert.ok(seen.some((q) => q.url.startsWith(boardproof.PROOF_PATH + '?')), 'the CLI never asked for a proof');
  assert.ok(!seen.find((q) => q.url.startsWith(boardproof.PROOF_PATH))?.headers['x-kosmos-board-token'], 'the proof request itself carried the token');
  assert.ok(tokenSent(seen), 'the token did not reach the proven board');
}));

test('#1765: installed CLI sends NOTHING with the token to a squatter, and says so', () => withStub({ prove: false }, async (port, seen) => {
  const r = await cli(port, ['accounts'], { KOSMOS_HOME: HOME });
  assert.notEqual(r.code, 0, 'a refused send must not exit 0');
  assert.match(r.out, /What answers at http:\/\/127\.0\.0\.1:\d+ could not show it is your Kosmos, so we did not .* and sent it nothing/);
  assert.equal(tokenSent(seen), false, 'the token reached the squatter');
}));

test('#1765: a squatter answering the proof with a 404 page gets nothing either', () => withStub({ proofAnswer: 'notfound' }, async (port, seen) => {
  const r = await cli(port, ['accounts'], { KOSMOS_HOME: HOME });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /could not show it is your Kosmos/);
  assert.equal(tokenSent(seen), false, 'the token reached the squatter');
}));

test('#1765: a listener that never answers the proof gets nothing, and the words say nothing was sent', () => withStub({ proofAnswer: 'silent' }, async (port, seen) => {
  const r = await cli(port, ['accounts'], { KOSMOS_HOME: HOME });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /did not answer in time, so we did not .* and nothing was sent/);
  assert.equal(tokenSent(seen), false, 'the token reached the stalled listener');
}));

test('#1765: with nothing listening the old words are unchanged (the CLI stops at its health check, before any proof)', async () => {
  const port = await new Promise((resolve) => { const sv = http.createServer(); sv.listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => resolve(p)); }); });
  const r = await cli(port, ['accounts'], { KOSMOS_HOME: HOME });
  assert.notEqual(r.code, 0);
  assert.doesNotMatch(r.out, /could not show it is your Kosmos|did not answer in time/, 'a down board is not a refused proof');
});

test('#1765: community comment counts a refused proof as NOT sent (exit 1, never the "may have been taken" exit 3)', () => withStub({ prove: false }, async (port, seen) => {
  const AGENT = 'c'.repeat(64);
  const r = await cli(port, ['community', 'comment', '1b2c3d4e-0000-4000-8000-000000000001', 'hi'],
    { KOSMOS_HOME: HOME, TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: AGENT });
  // Positive first: the refusal's own words, so this arm cannot pass by stopping before the send.
  assert.match(r.out, /could not show it is your Kosmos, so we did not send that comment/);
  assert.equal(r.code, 1, 'not sent is exit 1; exit 3 means "may have been taken"');
  assert.doesNotMatch(r.out, /may have been taken/);
  assert.equal(tokenSent(seen), false, 'the board token reached the squatter');
  assert.ok(!seen.some((q) => q.headers['x-kosmos-agent-token'] === AGENT), 'the agent token reached the squatter');
}));

test('#1765 CONTROL: from the checkout (no runtime) the same squatter DOES receive the token, so the arm above can see it', () => withStub({ prove: false }, async (port, seen) => {
  await cli(port, ['accounts']);
  assert.equal(tokenSent(seen), true, 'the control did not see the token arrive, so the squatter arm proves nothing');
}));
