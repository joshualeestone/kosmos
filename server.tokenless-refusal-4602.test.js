'use strict';
/**
 * #4602 (#4580 item 13): a request with NO credential is told a token is missing and how one is sent, not only
 * "this board belongs to the account that started it" (read by an agent as "another machine's board"). A token
 * that was sent and does not match still gets the account sentence, word for word.
 *
 * Harness: server.agent-token-gate-4491.test.js's (a fully sandboxed board, enforcement flipped on in memory).
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tokenless-4602-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const { start, server, boardAuthState } = require('./server');

const BOARD = 'BOARDTOKEN_test_4602_0123456789abcdef';
const ACCOUNT = 'this board belongs to the account that started it; open it with `kosmos open`';
const MISSING = /^no board token or agent token came with this request, so it was refused \(/;
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
});
test.after(() => { try { server.close(); } catch { /* ignore */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

async function call(method, p, headers, body) {
  const res = await fetch(base + p, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text().catch(() => '');
  let error = null; try { error = JSON.parse(text).error; } catch { /* not json */ }
  return { code: res.status, error };
}

test('#4602 no credential at all: told a token is missing and how one is sent, and the account clause stays', async () => {
  for (const [m, p] of [['GET', '/api/projects'], ['POST', '/api/msg'], ['GET', '/api/status']]) {
    const r = await call(m, p, {}, m === 'POST' ? {} : undefined);
    assert.equal(r.code, 403, m + ' ' + p);
    assert.match(r.error, MISSING, m + ' ' + p + ': ' + r.error);
    assert.ok(r.error.includes(ACCOUNT), 'the account clause is kept word for word: ' + r.error);
    assert.match(r.error, /use `kosmos \.\.\.` rather than calling the board directly/);
  }
});

test('#4602 a token that was sent and does not match: the account sentence exactly, never "no token"', async () => {
  const wrongBoard = await call('GET', '/api/projects', { 'x-kosmos-board-token': 'not-this-board' });
  assert.deepEqual(wrongBoard, { code: 403, error: ACCOUNT });
  const wrongAgent = await call('POST', '/api/msg', { 'x-kosmos-agent-token': 'ab'.repeat(32) }, {});
  assert.deepEqual(wrongAgent, { code: 403, error: ACCOUNT }, 'an agent token that resolves to nobody was still SENT');
  const queryToken = await call('GET', '/api/projects?token=wrong');
  assert.deepEqual(queryToken, { code: 403, error: ACCOUNT }, 'a token in the query counts as sent');
});

test('#4602 the operator path of POST /api/team keeps its agent-token hint in both forms', async () => {
  const none = await call('POST', '/api/team', {}, { members: [] });
  assert.equal(none.code, 403, JSON.stringify(none));
  assert.match(none.error, MISSING);
  assert.ok(none.error.includes(ACCOUNT + ', or present an agent token'), none.error);
  const wrong = await call('POST', '/api/team', { 'x-kosmos-board-token': 'nope' }, { members: [] });
  assert.deepEqual(wrong, { code: 403, error: ACCOUNT + ', or present an agent token' });
});

test('#4602 a browser (Sec-Fetch headers) keeps the person-facing sentence exactly, token or not', async () => {
  const page = await call('GET', '/api/projects', { 'sec-fetch-site': 'same-origin' });
  assert.deepEqual(page, { code: 403, error: ACCOUNT }, 'the page shows this to a person, for whom `kosmos open` is the advice');
  /* This file's own fetch is Node's, which sends sec-fetch-mode: cors by itself; the no-credential arm above passing
     is the proof that Mode alone is not read as a browser (the Windows CLI is a Node fetch). */
});

test('#4602 CONTROL: the right board token passes the gate', async () => {
  const r = await call('GET', '/api/projects', { 'x-kosmos-board-token': BOARD });
  assert.notEqual(r.code, 403, 'the gate refused a valid board token, so the refusals above prove nothing');
});
