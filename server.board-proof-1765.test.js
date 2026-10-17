'use strict';

/**
 * #1765: GET /api/board-proof lets a client check that the listener on its board port holds the client's token
 * BEFORE it sends that token. The board answers HMAC-SHA256(token, address, port, nonce) for a token it holds, and nothing it
 * does not. A listener that holds no token (another account on the port) cannot answer, so boardHoldsToken is
 * false there and true here.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-boardproof-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, boardAuthState } = require('./server');
const boardproof = require('./engine/boardproof');
const sendertoken = require('./engine/sendertoken');

const TOK = 'BOARDTOKEN_test_0123456789abcdef';
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  boardAuthState.on = true;
  boardAuthState.token = TOK;
});

async function get(p) {
  const res = await fetch(base + p, { redirect: 'manual' });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { code: res.status, body };
}

test('the proof route needs no token, and answers the HMAC for the board token', async () => {
  const n = boardproof.newNonce();
  const r = await get(`${boardproof.PROOF_PATH}?n=${n}&k=${boardproof.keyId(TOK)}`);
  assert.equal(r.code, 200);
  assert.ok(boardproof.proofMatches(TOK, n, r.body.proof, server.address().port, '127.0.0.1'), 'the answer must verify with the client\'s own copy');
  assert.equal(boardproof.proofMatches(TOK, n, r.body.proof, server.address().port + 1, '127.0.0.1'), false, 'the proof must be bound to the port');
  assert.equal(boardproof.proofMatches(TOK, n, r.body.proof, server.address().port, '::1'), false, 'and to the address');
});

test('a key id for a token the board does not hold gets 404 and no proof', async () => {
  const r = await get(`${boardproof.PROOF_PATH}?n=${boardproof.newNonce()}&k=${boardproof.keyId('some-other-token')}`);
  assert.equal(r.code, 404);
  assert.equal(r.body.proof, undefined);
});

test('a malformed request gets 400', async () => {
  assert.equal((await get(`${boardproof.PROOF_PATH}?n=zz&k=${boardproof.keyId(TOK)}`)).code, 400);
  assert.equal((await get(boardproof.PROOF_PATH)).code, 400);
});

test('an agent token held by this board is provable too (token-only agents never hold the board token)', async () => {
  const minted = sendertoken.mint('proof-agent');
  const atok = minted.token;
  assert.ok(atok, 'mint returned a token');
  assert.equal(await boardproof.boardHoldsToken(base, atok), true);
});

test('boardHoldsToken: true for the real board holding the token', async () => {
  assert.equal(await boardproof.boardHoldsToken(base, TOK), true);
});

test('boardHoldsToken: false for the real board and a token it does not hold', async () => {
  assert.equal(await boardproof.boardHoldsToken(base, 'not-this-boards-token'), false);
});

test('boardHoldsToken: false for a squatter that answers every request with 200 and a plausible proof', async () => {
  const squat = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ proof: 'a'.repeat(64) })); });
  await new Promise((ok) => squat.listen(0, '127.0.0.1', ok));
  try {
    assert.equal(await boardproof.boardHoldsToken(`http://127.0.0.1:${squat.address().port}`, TOK), false);
  } finally { squat.close(); }
});

test('boardHoldsToken through fetch (the node senders\' path): true for the real board, false for a squatter', async () => {
  assert.equal(await boardproof.boardHoldsToken(base, TOK, { fetchImpl: fetch }), true);
  assert.equal(await boardproof.mayCarryTokensTo(base, { 'x-kosmos-board-token': TOK }, { fetchImpl: fetch }), true);
  assert.equal(await boardproof.mayCarryTokensTo(base, {}, { fetchImpl: fetch }), true, 'no token: nothing to protect');
  assert.equal(boardproof.tokenIn({ 'X-Kosmos-Board-Token': TOK }), TOK, 'a mixed-case name is still a token');
  assert.equal(boardproof.tokenIn(new Headers({ 'x-kosmos-agent-token': 'a1' })), 'a1', 'a Headers instance is read too');
  const squat = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ proof: 'a'.repeat(64) })); });
  await new Promise((ok) => squat.listen(0, '127.0.0.1', ok));
  try {
    assert.equal(await boardproof.mayCarryTokensTo(`http://127.0.0.1:${squat.address().port}`, { 'x-kosmos-board-token': TOK }, { fetchImpl: fetch }), false);
  } finally { squat.close(); }
});

test('a relay on another port that passes the proof request to the real board is refused (the proof binds the port)', async () => {
  const relay = http.createServer((q, r) => {
    http.get(base + q.url, (up) => { let b = ''; up.on('data', (d) => { b += d; }); up.on('end', () => { r.writeHead(up.statusCode, { 'content-type': 'application/json' }); r.end(b); }); })
      .on('error', () => { r.writeHead(502); r.end(); });
  });
  await new Promise((ok) => relay.listen(0, '127.0.0.1', ok));
  try {
    // CONTROL: the relay really passes the board's answer through (a 200 with a proof), so the refusal below is the binding.
    const n = boardproof.newNonce();
    const viaRelay = await (await fetch(`http://127.0.0.1:${relay.address().port}${boardproof.PROOF_PATH}?n=${n}&k=${boardproof.keyId(TOK)}`)).json();
    assert.match(String(viaRelay.proof), new RegExp('^[0-9a-f]{' + boardproof.PROOF_HEX + '}$'), 'the relay did not pass a proof through');
    assert.equal(await boardproof.boardHoldsToken(`http://127.0.0.1:${relay.address().port}`, TOK), false);
    assert.equal(await boardproof.boardHoldsToken(`http://127.0.0.1:${relay.address().port}`, TOK, { fetchImpl: fetch }), false);
  } finally { relay.close(); }
});

test('answer() binds the address the connection reached: 127.0.0.1 and its IPv4-mapped form prove, ::1 does not', () => {
  const n = boardproof.newNonce(), q = { n, k: boardproof.keyId(TOK) };
  const at = (addr) => boardproof.answer(q, () => [TOK], 4242, addr).body.proof;
  assert.ok(boardproof.proofMatches(TOK, n, at('127.0.0.1'), 4242, '127.0.0.1'));
  assert.ok(boardproof.proofMatches(TOK, n, at('::ffff:127.0.0.1'), 4242, '127.0.0.1'), 'a board listening on every address, reached at 127.0.0.1');
  assert.equal(boardproof.proofMatches(TOK, n, at('::1'), 4242, '127.0.0.1'), false, 'the same board reached at ::1 cannot prove a 127.0.0.1 dial');
});

test('the node gate reads the board cookie as the board does, first, and never throws on it', () => {
  assert.equal(boardproof.tokenIn({ cookie: 'a=b; kosmos_board= ' + TOK + ' ' }), TOK, 'trimmed, as boardauth.cookieToken does');
  assert.equal(boardproof.tokenIn({ cookie: 'kosmos_board=' + TOK, 'x-kosmos-board-token': 'other' }), TOK, 'the cookie first, as presentedToken does');
  assert.equal(boardproof.tokenIn({ cookie: 'kosmos_board=%zz' }), '%zz', 'no percent-decoding, so a bad escape cannot throw');
  // A board cookie the board would not read (empty first, or another case) is unreadable, so refused, not tokenless.
  assert.equal(boardproof.tokenIn({ cookie: 'kosmos_board=; kosmos_board=' + TOK }), null);
  assert.equal(boardproof.tokenIn({ cookie: 'Kosmos_Board=' + TOK }), null);
  assert.equal(boardproof.tokenIn({ cookie: 'x=1; Kosmos_Board =' + TOK }), null, 'a space before the =');
  assert.equal(boardproof.tokenIn({ cookie: 'x=1; Kosmos_Board\t=' + TOK }), null, 'a tab before the =');
  assert.equal(boardproof.tokenIn({ cookie: 'a=1, kosmos_board=' + TOK }), null, 'joined with a comma');
});

test('the node gate refuses headers it cannot read, and reads every shape fetch accepts', async () => {
  assert.equal(boardproof.tokenIn([['X-Kosmos-Board-Token', TOK]]), TOK, 'an array of pairs');
  assert.equal(boardproof.tokenIn(new Map([['X-KOSMOS-AGENT-TOKEN', 'a1']])), 'a1', 'a Map of pairs, any case');
  assert.equal(boardproof.tokenIn(42), null, 'a shape Headers cannot take is unreadable');
  assert.equal(await boardproof.mayCarryTokensTo(base, 42), false, 'unreadable headers are refused, not read as tokenless');
  // At the real board, where 127.0.0.1 is proved (true above). loopbackHttp refuses localhost before any request;
  // that assertion can also pass when localhost resolves to ::1 and nothing listens there, so the next one is the
  // real check: a counting fetch is never called for localhost, and is called (and proves) for 127.0.0.1.
  assert.equal(await boardproof.mayCarryTokensTo(base.replace('127.0.0.1', 'localhost'), { 'x-kosmos-board-token': TOK }), false, 'localhost is not accepted');
  let asked = 0;
  const spy = async (...a) => { asked += 1; return fetch(...a); };
  assert.equal(await boardproof.boardHoldsToken(base.replace('127.0.0.1', 'localhost'), TOK, { fetchImpl: spy }), false);
  assert.equal(asked, 0, 'refused before any request');
  // CONTROL: the same spy at 127.0.0.1 is asked, and proves, so a 0 above is the address rule.
  assert.equal(await boardproof.boardHoldsToken(base, TOK, { fetchImpl: spy }), true);
  assert.equal(asked, 1);
});

// A test-level timeout, so a deadline that breaks back into a per-socket timeout fails here by name, not as a hang.
test('one deadline bounds the whole exchange, on both node paths, against a listener that trickles bytes', { timeout: 10000 }, async () => {
  const held = [];
  const drip = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); held.push(r); const iv = setInterval(() => r.write(' '), 50); r.on('close', () => clearInterval(iv)); });
  await new Promise((ok) => drip.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${drip.address().port}`;
  try {
    for (const opts of [{ timeoutMs: 300 }, { timeoutMs: 300, fetchImpl: fetch }]) {
      const t0 = Date.now();
      assert.equal(await boardproof.boardHoldsToken(url, TOK, opts), false);
      assert.ok(Date.now() - t0 < 2000, 'a trickle reset the deadline (' + (Date.now() - t0) + ' ms)');
    }
  } finally { for (const r of held) r.destroy(); drip.close(); }
});

test('an answer over PROOF_ANSWER_MAX_BYTES is refused on both node paths, even when it holds a valid proof', async () => {
  let pad = 0;
  const big = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x');
    const out = boardproof.answer(Object.fromEntries(u.searchParams), () => [TOK], q.socket.localPort, q.socket.localAddress);
    // A real proof behind whitespace JSON allows: over the cap it is refused only by the size rule.
    r.writeHead(200, { 'content-type': 'application/json' });
    r.end(' '.repeat(pad) + JSON.stringify(out.body));
  });
  await new Promise((ok) => big.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${big.address().port}`;
  try {
    pad = 100;   // CONTROL: the same proof under the cap is accepted, so the refusals below are the cap
    assert.equal(await boardproof.boardHoldsToken(url, TOK), true);
    assert.equal(await boardproof.boardHoldsToken(url, TOK, { fetchImpl: fetch }), true);
    pad = boardproof.PROOF_ANSWER_MAX_BYTES;
    assert.equal(await boardproof.boardHoldsToken(url, TOK), false);
    assert.equal(await boardproof.boardHoldsToken(url, TOK, { fetchImpl: fetch }), false);
  } finally { big.close(); }
});

test('the CLI helper: --key exits 1 on an empty token, --verify exits 4 for a base other than 127.0.0.1', () => {
  const { spawnSync } = require('node:child_process');
  const run = (args, input) => spawnSync(process.execPath, [path.join(__dirname, 'engine', 'boardproof.js'), ...args], { input, encoding: 'utf8' });
  const k = run(['--key'], '   ');
  if (typeof k.status !== 'number') throw new Error('--key gave no exit status');
  assert.equal(k.status, 1);
  const v = run(['--verify', 'http://localhost:1'], TOK + '\n' + 'a'.repeat(32) + '\n{}');
  if (typeof v.status !== 'number') throw new Error('--verify gave no exit status');
  assert.equal(v.status, 4);
  // CONTROL: the same input at 127.0.0.1 is read as an answer (not proven: 3), so 4 above is the address rule.
  const c = run(['--verify', 'http://127.0.0.1:1'], TOK + '\n' + 'a'.repeat(32) + '\n{}');
  if (typeof c.status !== 'number') throw new Error('--verify gave no exit status');
  assert.equal(c.status, 3);
});

test('onRefuse hears why a check failed, on both node paths', async () => {
  const squat = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ proof: 'a'.repeat(boardproof.PROOF_HEX) })); });
  await new Promise((ok) => squat.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${squat.address().port}`;
  try {
    for (const extra of [{}, { fetchImpl: fetch }]) {
      const heard = [];
      assert.equal(await boardproof.boardHoldsToken(url, TOK, { ...extra, onRefuse: (w) => heard.push(w) }), false);
      assert.deepEqual(heard, ['answer is not a proof']);
    }
    const heard = [];
    assert.equal(await boardproof.boardHoldsToken(base, TOK, { onRefuse: (w) => heard.push(w) }), true);
    assert.deepEqual(heard, [], 'a proven board is not refused');
  } finally { squat.close(); }
});

test('boardHoldsToken: false when nothing listens', async () => {
  const s = http.createServer(); await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const port = s.address().port; await new Promise((ok) => s.close(ok));
  assert.equal(await boardproof.boardHoldsToken(`http://127.0.0.1:${port}`, TOK), false);
});

test('CONTROL: a POST to the proof route is not exempt from the token gate', async () => {
  const res = await fetch(`${base}${boardproof.PROOF_PATH}?n=${boardproof.newNonce()}&k=${boardproof.keyId(TOK)}`, { method: 'POST', redirect: 'manual' });
  const body = await res.json().catch(() => ({}));
  assert.equal(res.status, 403);
  assert.match(String(body.error || ''), /board token/, 'refused by the token gate, not by another 403');
});

test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
