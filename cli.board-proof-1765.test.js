'use strict';
/**
 * #1765: in the installed layout the CLI sends a token only to a listener that proves it already holds that token
 * (kosmos_board_proven, engine/boardproof.js). Another account can listen on this account's port while the board is
 * down; the CLI must send it nothing.
 *
 * The installed layout is built here: a KOSMOS_HOME whose runtime/bin/node is this node and whose app/engine is the
 * repo's engine. Most other CLI tests run from the checkout or build an installed layout whose stub engine has no
 * boardproof.js, so the proof is skipped; a few link the real engine and stay off it only because they carry no
 * token (.claude/plans/boardproof-1765.md lists them). The CONTROL arm below
 * runs from the checkout against the same squatter and must see the token arrive, so the main arm's "nothing
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
        const out = prove ? boardproof.answer(q, () => [TOK], req.socket.localPort, req.socket.localAddress) : { status: 200, body: { proof: 'a'.repeat(64) } };
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

function cli(port, args, extraEnv = {}, killMs = 20000) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port) };
    delete env.KOSMOS_AGENT_TOKEN;
    delete env.KOSMOS_HOME;   // the runner's own install must not decide the layout: each arm names its own
    delete env.TMUX; delete env.TMUX_PANE;   // the CLI asks tmux whether it runs in an agent's pane: never the runner's own
    for (const v of ['KOSMOS_AGENT_TOKEN_ONLY', 'KOSMOS_AGENT_SESSION', 'KOSMOS_WORLD', 'KOSMOS_PROOF_DEBUG']) delete env[v];   // an agent runner's own settings
    for (const v of ['http_proxy', 'https_proxy', 'all_proxy', 'ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY']) delete env[v];   // no #4933 route checks in these arms
    Object.assign(env, extraEnv);
    const child = spawn(CLI, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => child.kill('SIGKILL'), killMs);
    child.on('close', (code, sig) => {
      clearTimeout(t);
      const r = { code, out };
      /* #3628: a killed CLI has no exit code; it must fail the test, never read as one. */
      if (typeof r.code !== 'number') { reject(new Error('the CLI gave no exit code (' + sig + '). ' + out)); return; }
      resolve(r);
    });
  });
}

const tokenSent = (seen) => seen.some((r) => r.headers['x-kosmos-board-token'] === TOK);

test('#1765: each call asks with a fresh nonce (so an answer recorded for one call cannot serve another)', () => withStub({ prove: true }, async (port, seen) => {
  await cli(port, ['accounts'], { KOSMOS_HOME: HOME });
  await cli(port, ['accounts'], { KOSMOS_HOME: HOME });
  const nonces = seen.filter((q) => q.url.startsWith(boardproof.PROOF_PATH + '?')).map((q) => new URL(q.url, 'http://x').searchParams.get('n'));
  assert.equal(nonces.length, 2, 'expected one proof per call');
  assert.match(nonces[0], new RegExp('^[0-9a-f]{' + boardproof.NONCE_BYTES * 2 + '}$'));
  assert.notEqual(nonces[0], nonces[1], 'two calls sent the same nonce');
}));

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
  // The fixed parts of the 98 words (say_unreached), so a clause added between them does not break this arm.
  assert.match(r.out, /What answers at http:\/\/127\.0\.0\.1:\d+ could not show it is your Kosmos[^.]*, so we did not read which accounts are set up and sent it nothing/);
  assert.equal(tokenSent(seen), false, 'the token reached the squatter');
}));

test('#1765: a squatter answering the proof with a 404 page gets nothing either', () => withStub({ proofAnswer: 'notfound' }, async (port, seen) => {
  const r = await cli(port, ['accounts'], { KOSMOS_HOME: HOME });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /could not show it is your Kosmos/);
  assert.equal(tokenSent(seen), false, 'the token reached the squatter');
}));

test('#1765: a listener that never answers the proof gets nothing, and the words say nothing was sent', { timeout: 40000 }, () => withStub({ proofAnswer: 'silent' }, async (port, seen) => {
  const t0 = Date.now();
  const r = await cli(port, ['accounts'], { KOSMOS_HOME: HOME }, 35000);   // room past the 15 s wait on a busy machine
  // accounts passes -m 60, so the proof's half is capped at KOSMOS_PROOF_MAX_S (15 s): it gives up near 15 s, not 30.
  const took = Date.now() - t0;
  // The lower bound shows the 15 s cap held. Under 29 s still catches a proof that waited its whole 30 s half of
  // -m 60; the rest is room for a busy machine, inside the 35 s kill.
  assert.ok(took > 13000 && took < 29000, 'the proof did not give up at its 15 s cap (' + took + ' ms)');
  assert.notEqual(r.code, 0);
  assert.match(r.out, /did not finish answering, so we did not .* and nothing was sent/);
  assert.equal(tokenSent(seen), false, 'the token reached the stalled listener');
}));

test('#1765: with nothing listening the words are not a refused proof (the CLI stops at its health check)', async () => {
  const port = await new Promise((resolve) => { const sv = http.createServer(); sv.listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => resolve(p)); }); });
  const r = await cli(port, ['accounts'], { KOSMOS_HOME: HOME });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /Kosmos is not running|could not reach Kosmos|cannot connect/, 'the old down-board words, positively');
  assert.doesNotMatch(r.out, /could not show it is your Kosmos|did not finish answering/, 'a down board is not a refused proof');
});

test('#1765: community comment counts a refused proof as NOT sent (exit 1, never the "may have been taken" exit 3)', () => withStub({ prove: false }, async (port, seen) => {
  const AGENT = 'c'.repeat(64);
  const r = await cli(port, ['community', 'comment', '1b2c3d4e-0000-4000-8000-000000000001', 'hi'],
    { KOSMOS_HOME: HOME, TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: AGENT });
  // Positive first: the refusal's own words, so this arm cannot pass by stopping before the send.
  assert.match(r.out, /could not show it is your Kosmos[^.]*, so we did not send that comment and sent it nothing/);
  assert.equal(r.code, 1, 'not sent is exit 1; exit 3 means "may have been taken"');
  assert.doesNotMatch(r.out, /may have been taken/);
  assert.equal(tokenSent(seen), false, 'the board token reached the squatter');
  assert.ok(!seen.some((q) => q.headers['x-kosmos-agent-token'] === AGENT), 'the agent token reached the squatter');
}));

/* whoami reads its board token through agent_board_token, which KOSMOS_AGENT_TOKEN_ONLY=1 blanks, so the agent token
   is the only token on the call and the one proved (community comment reads board_token directly, so it would not be). */
test('#1765: a token-only agent (no board token) proves its agent token, and a squatter still gets nothing', () => withStub({ prove: false }, async (port, seen) => {
  const AGENT = 'd'.repeat(64);
  const r = await cli(port, ['whoami'],
    { KOSMOS_HOME: HOME, TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: AGENT, KOSMOS_AGENT_TOKEN_ONLY: '1' });
  assert.match(r.out, /could not show it is your Kosmos[^.]*, so we did not tell you which account you are on and sent it nothing/);
  assert.equal(tokenSent(seen), false, 'the board token was sent although the agent is token-only');
  const proofAsk = seen.find((q) => q.url.startsWith(boardproof.PROOF_PATH + '?'));
  assert.ok(proofAsk, 'no proof was asked for');
  assert.equal(new URL(proofAsk.url, 'http://x').searchParams.get('k'), boardproof.keyId(AGENT), 'the agent token is the one proved');
  assert.ok(!seen.some((q) => q.headers['x-kosmos-agent-token'] === AGENT), 'the agent token reached the squatter');
}));

test('#1765: the agent-token header the gate reads is the one the board reads', () => {
  assert.match(fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8'), new RegExp("req\\.headers\\['" + boardproof.AGENT_HEADER + "'\\]"));
});

test('#1765: the CLI\'s answer cap and nonce size are the module\'s own numbers', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  assert.match(src, new RegExp('^KOSMOS_PROOF_MAX_BYTES=' + boardproof.PROOF_ANSWER_MAX_BYTES + '\\b', 'm'));
  assert.match(src, new RegExp('^KOSMOS_PROOF_NONCE_BYTES=' + boardproof.NONCE_BYTES + '\\b', 'm'));
});

test('#1765: kosmos open never opens a browser at a listener that failed the proof (the browser would send the board cookie)', () => withStub({ prove: false }, async (port) => {
  const opened = path.join(DATA, 'opened-1765');
  const fake = path.join(DATA, 'fake-open-1765.sh');
  fs.writeFileSync(fake, '#!/bin/sh\necho "$1" >> ' + JSON.stringify(opened) + '\n', { mode: 0o755 });
  const r = await cli(port, ['open'], { KOSMOS_HOME: HOME, KOSMOS_OPEN_BIN: fake });
  assert.match(r.out, /could not show it is your Kosmos[^.]*, so we did not open the dashboard and sent it nothing/);
  assert.equal(r.code, 1);
  assert.equal(fs.existsSync(opened), false, 'a browser was opened at the unproven listener');
}));

test('#1765 CONTROL: kosmos open does open the browser at a board that proves itself', () => withStub({ prove: true }, async (port) => {
  const opened = path.join(DATA, 'opened-1765-ok');
  const fake = path.join(DATA, 'fake-open-1765-ok.sh');
  fs.writeFileSync(fake, '#!/bin/sh\necho "$1" >> ' + JSON.stringify(opened) + '\n', { mode: 0o755 });
  await cli(port, ['open'], { KOSMOS_HOME: HOME, KOSMOS_OPEN_BIN: fake });
  assert.equal(fs.existsSync(opened), true, 'the control did not open, so the arm above proves nothing');
}));

test('#1765: an interrupt while connect\'s board proof stalls stops at once, sends no token, and leaves nothing behind', { timeout: 20000 }, () => withStub({ proofAnswer: 'silent' }, async (port, seen) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-1765-int-'));
  const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), KOSMOS_HOME: HOME, TMPDIR: tmp };
  for (const v of ['KOSMOS_AGENT_TOKEN', 'KOSMOS_AGENT_TOKEN_ONLY', 'KOSMOS_AGENT_SESSION', 'KOSMOS_WORLD', 'KOSMOS_PROOF_DEBUG', 'TMUX', 'TMUX_PANE', 'http_proxy', 'https_proxy', 'all_proxy', 'ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY']) delete env[v];
  /* exit code not read (#3628) as a code: a close with none resolves the signal's NAME, which can never equal the 143 asserted, so a kill still fails. */
  const child = spawn(CLI, ['connect', 'brave-search'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end('svc-key-1765');
  // CONTROL: the proof was asked for, so the interrupt lands while the proof is stalled (the request is not yet sent).
  const t0 = Date.now();
  while (!seen.some((q) => q.url.startsWith(boardproof.PROOF_PATH + '?')) && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 50));
  assert.ok(seen.some((q) => q.url.startsWith(boardproof.PROOF_PATH + '?')), 'CONTROL: the proof was never asked for');
  const at = Date.now();
  child.kill('SIGTERM');
  const code = await new Promise((r) => {
    const hard = setTimeout(() => { child.kill('SIGKILL'); r('ignored the signal'); }, 6000);
    child.on('close', (c, sig) => { clearTimeout(hard); r(c === null ? sig : c); });
  });
  const took = Date.now() - at;
  assert.ok(took < 2000, 'an interrupted connect waited ' + took + 'ms for the stalled proof');
  assert.equal(code, 143);
  assert.equal(tokenSent(seen), false, 'the board token reached the stalled listener');
  assert.ok(!seen.some((q) => q.method === 'POST'), 'the request was sent after the interrupt');
  try {
    assert.deepEqual(fs.readdirSync(tmp).filter((f) => /^kosmos-(connect|auth|proof)/.test(f)), [], 'an interrupted connect left a file behind');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}));

test('#1765: with the stop file present (KOSMOS_CURL_STOP), nothing is sent, not even the proof request', () => withStub({ prove: true }, async (port, seen) => {
  const stop = path.join(DATA, 'stop-1765');
  fs.writeFileSync(stop, '');
  try {
    const r = await cli(port, ['accounts'], { KOSMOS_HOME: HOME, KOSMOS_CURL_STOP: stop });
    assert.notEqual(r.code, 0, 'a stopped call must not report success');
    assert.match(r.out, /Stopped before anything was sent/, 'a stop is worded as a stop, not as an unreachable board');
    assert.ok(!seen.some((q) => q.url.startsWith(boardproof.PROOF_PATH)), 'the proof was asked for after the stop');
    assert.equal(tokenSent(seen), false, 'the token was sent after the stop');
  } finally { fs.rmSync(stop, { force: true }); }
  // CONTROL: the same call without the stop file does ask for the proof and send the token (the arm above can fail).
  const ok = await cli(port, ['accounts'], { KOSMOS_HOME: HOME });
  assert.equal(ok.code, 0, ok.out);
  assert.ok(tokenSent(seen), 'the control did not send, so the arm above proves nothing');
}));

test('#1765 CONTROL: from the checkout, community comment DOES send the agent token to the same squatter', () => withStub({ prove: false }, async (port, seen) => {
  const AGENT = 'c'.repeat(64);
  await cli(port, ['community', 'comment', '1b2c3d4e-0000-4000-8000-000000000001', 'hi'], { TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: AGENT });
  assert.ok(seen.some((q) => q.headers['x-kosmos-agent-token'] === AGENT), 'the control did not see the agent token arrive, so the arm above proves nothing about it');
}));

test('#1765 CONTROL: from the checkout (no runtime) the same squatter DOES receive the token, so the arm above can see it', () => withStub({ prove: false }, async (port, seen) => {
  await cli(port, ['accounts']);
  assert.equal(tokenSent(seen), true, 'the control did not see the token arrive, so the squatter arm proves nothing');
}));
