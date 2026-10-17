'use strict';

/**
 * #1765: GET /api/board-proof lets a client check that the listener on its board port holds the client's token
 * BEFORE it sends that token. The board answers HMAC-SHA256(token, nonce) for a token it holds, and nothing it
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
  assert.ok(boardproof.proofMatches(TOK, n, r.body.proof), 'the answer must verify with the client\'s own copy');
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
  const atok = typeof minted === 'string' ? minted : minted.token;
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

test('boardHoldsToken: false when nothing listens', async () => {
  const s = http.createServer(); await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const port = s.address().port; await new Promise((ok) => s.close(ok));
  assert.equal(await boardproof.boardHoldsToken(`http://127.0.0.1:${port}`, TOK), false);
});

test('CONTROL: a POST to the proof route is not exempt from the token gate', async () => {
  const res = await fetch(`${base}${boardproof.PROOF_PATH}?n=${boardproof.newNonce()}&k=${boardproof.keyId(TOK)}`, { method: 'POST', redirect: 'manual' });
  await res.text().catch(() => {});
  assert.equal(res.status, 403);
});

test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
