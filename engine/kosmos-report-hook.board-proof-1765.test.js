'use strict';
/**
 * #1765: the Windows report hook sends its tokens only to a listener that proves it already holds them
 * (engine/boardproof.js). These run against real local HTTP listeners (test-support/proof-listener-1765.js), with no
 * fetch stub, so the hook's own production path is what is measured: a listener that holds no token gets the proof
 * request and nothing else; a board that holds the token gets the report.
 */
require('../test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-hookproof-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;   // never the dev box's real board.token
const test = require('node:test');
const assert = require('node:assert/strict');
const hook = require('./kosmos-report-hook');
const { startListener, freePort } = require('../test-support/proof-listener-1765');

const BOARD = 'BOARDTOKEN_1765_' + 'f'.repeat(32);
const AGENT = 'ab'.repeat(16);
const evt = (name, extra) => JSON.stringify({ hook_event_name: name, ...(extra || {}) });

function io(url, input, extra) {
  const said = [];
  return {
    said,
    io: {
      input,
      env: { KOSMOS_AGENT_TOKEN: AGENT },
      uid: -1,
      url,
      boardToken: BOARD,
      platform: 'win32',
      ppid: 4242,
      throttleDir: fs.mkdtempSync(path.join(SANDBOX, 'thr-')),
      now: () => 1000,
      stdout: (s) => said.push(s),
      ...(extra || {}),
    },
  };
}

test('#1765: a squatter on the board port gets the proof request and never a token, on every send path', async () => {
  const sq = await startListener({ mode: 'squatter' });
  try {
    // The loud report, a file-edit (keep copy + heartbeat report) and a failed tool call.
    const start = io(sq.url, evt('SessionStart', { source: 'startup' }));
    assert.equal(await hook.main(start.io), 0, 'the hook must never fail the agent');
    const edit = io(sq.url, evt('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'C:\\w\\a.md' }, cwd: 'C:\\w', session_id: 's' }));
    assert.equal(await hook.main(edit.io), 0);
    const fail = io(sq.url, evt('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'x' }, error: 'boom' }));
    assert.equal(await hook.main(fail.io), 0);

    assert.deepEqual(sq.carrying([BOARD, AGENT]), [], 'a token reached the squatter');
    assert.ok(sq.seen.length >= 3 && sq.seen.every((r) => r.url.startsWith('/api/board-proof')), 'only proof requests may reach it: ' + sq.seen.map((r) => r.method + ' ' + r.url).join(', '));
    assert.equal(start.said.length, 1, 'SessionStart says out loud that reporting is off');
    assert.match(start.said[0], /could not show it is your Kosmos, so nothing was sent/);
    assert.doesNotMatch(start.said[0], /could not be reached/, 'a squatter is not a board that is down');
  } finally { await sq.close(); }
});

test('#1765 CONTROL: a board that holds the token gets the report and the keep, with their tokens', async () => {
  const board = await startListener({ mode: 'board', holds: BOARD });
  try {
    const edit = io(board.url, evt('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'C:\\w\\a.md' }, cwd: 'C:\\w', session_id: 's' }));
    assert.equal(await hook.main(edit.io), 0);
    const sends = board.seen.filter((r) => !r.url.startsWith('/api/board-proof'));
    assert.deepEqual(sends.map((r) => r.url).sort(), ['/api/report', '/api/undo/keep']);
    assert.ok(sends.every((r) => r.headers['x-kosmos-board-token'] === BOARD && r.headers['x-kosmos-agent-token'] === AGENT));
    assert.equal(board.proofRequests().length, 1, 'proved once for the process, not once per send');
  } finally { await board.close(); }
});

test('#1765: a board that holds a DIFFERENT token is refused like a squatter (the proof is keyed on our token)', async () => {
  const other = await startListener({ mode: 'board', holds: 'some-other-account-token' });
  try {
    const run = io(other.url, evt('SessionStart', { source: 'startup' }));
    await hook.main(run.io);
    assert.deepEqual(other.carrying([BOARD, AGENT]), []);
    assert.match(run.said[0], /could not show it is your Kosmos/);
  } finally { await other.close(); }
});

test('#1765: a token-only agent proves its agent token, and the board token is never read or sent', async () => {
  const board = await startListener({ mode: 'board', holds: AGENT });
  try {
    const run = io(board.url, evt('Stop'), { env: { KOSMOS_AGENT_TOKEN: AGENT, KOSMOS_AGENT_TOKEN_ONLY: '1' } });
    await hook.main(run.io);
    const sends = board.seen.filter((r) => r.url === '/api/report');
    assert.equal(sends.length, 1, 'the agent token was proven, so the report goes');
    assert.equal(sends[0].headers['x-kosmos-board-token'], undefined);
  } finally { await board.close(); }
  const sq = await startListener({ mode: 'squatter' });
  try {
    await hook.main(io(sq.url, evt('Stop'), { env: { KOSMOS_AGENT_TOKEN: AGENT, KOSMOS_AGENT_TOKEN_ONLY: '1' } }).io);
    assert.deepEqual(sq.carrying([BOARD, AGENT]), []);
  } finally { await sq.close(); }
});

test('#1765: a board that is down is told apart from a squatter, and the hook still exits 0', async () => {
  const port = await freePort();
  const run = io('http://127.0.0.1:' + port, evt('SessionStart', { source: 'startup' }));
  assert.equal(await hook.main(run.io), 0);
  assert.match(run.said[0], /the board could not be reached \(ECONNREFUSED\)/);
  assert.doesNotMatch(run.said[0], /could not show it is your Kosmos/);
});

test('#1765: each check asks with a fresh random nonce', async () => {
  const sq = await startListener({ mode: 'squatter' });
  try {
    await hook.main(io(sq.url, evt('Stop')).io);
    await hook.main(io(sq.url, evt('Stop')).io);
    const nonces = sq.proofRequests().map((r) => new URL(r.url, 'http://x').searchParams.get('n'));
    assert.equal(nonces.length, 2);
    assert.match(nonces[0], /^[0-9a-f]{32}$/);
    assert.notEqual(nonces[0], nonces[1]);
  } finally { await sq.close(); }
});

test('#1765: the seam decides, and a refusal sends nothing even through an injected fetch', async () => {
  let fetched = 0;
  const asked = [];
  const run = io('http://127.0.0.1:1', evt('Stop'), {
    fetchImpl: async () => { fetched += 1; return { ok: true, status: 200, text: async () => '{"recorded":true}' }; },
    proveBoard: async (url, token, timeoutMs) => { asked.push({ url, token, timeoutMs }); return false; },
  });
  assert.equal(await hook.main(run.io), 0);
  assert.equal(fetched, 0, 'a send went out after the check said no');
  assert.deepEqual(asked.map((a) => [a.url, a.token]), [['http://127.0.0.1:1', BOARD]], 'the board token is the one proved');
  assert.ok(asked[0].timeoutMs > 0 && asked[0].timeoutMs <= hook.SHORT_TIMEOUT_MS / 2, 'the check gets at most half the send\'s bound');
});

test('#1765: with no token at all nothing is proved (there is nothing to protect)', async () => {
  let asked = 0, fetched = 0;
  const run = io('http://127.0.0.1:1', evt('Stop'), {
    boardToken: null, env: {},
    fetchImpl: async () => { fetched += 1; return { ok: true, status: 200, text: async () => '{"recorded":true}' }; },
    proveBoard: async () => { asked += 1; return false; },
  });
  await hook.main(run.io);
  assert.equal(asked, 0);
  assert.equal(fetched, 1);
});
