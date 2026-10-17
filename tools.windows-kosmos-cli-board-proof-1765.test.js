'use strict';
/**
 * #1765: the Windows `kosmos` sends its tokens only to a listener that proves it already holds them
 * (engine/boardproof.js). Driven through main() with NO fetch or hook stub, so the production path is measured: the
 * real board token is read from this test's own data folder, and the listener is a real local HTTP server
 * (test-support/proof-listener-1765.js). Pure node HTTP, so it runs on every platform.
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cliproof-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;   // the board token below is this test's, never the dev box's
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');
const boardauth = require('./engine/boardauth');
const { startListener, freePort } = require('./test-support/proof-listener-1765');

const BOARD = 'BOARDTOKEN_cli_1765_' + 'e'.repeat(32);
const AGENT = 'cd'.repeat(16);
fs.mkdirSync(path.dirname(boardauth.tokenPath()), { recursive: true });
fs.writeFileSync(boardauth.tokenPath(), BOARD);

async function run(url, argv, extra) {
  const out = [], err = [];
  const code = await cli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: AGENT, KOSMOS_RETRY_PAUSE_MS: '0' },
    url,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    readStdin: async () => ({ text: '', ended: true }),
    ...(extra || {}),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('#1765: the token really is read from this test\'s data folder (so the arms below are about the real token)', () => {
  assert.equal(require('./engine/kosmos-report-hook').readBoardToken(), BOARD);
});

test('#1765: a squatter gets nothing but the proof request, on a read, a write and an agent send', async () => {
  const sq = await startListener({ mode: 'squatter' });
  try {
    for (const argv of [['room', 'proj'], ['report', 'working', 'on it'], ['reply', 'hello there'], ['msg', 'bart', 'hi']]) {
      const r = await run(sq.url, argv);
      assert.equal(r.code, 1, argv.join(' ') + ' must fail, not "maybe" (nothing was sent): ' + r.err);
      assert.match(r.err, /could not show it is your Kosmos, so we did not .+ and sent it nothing/, argv.join(' '));
      assert.doesNotMatch(r.err, /may (still )?have|asking once more/, 'nothing was sent, so nothing may have happened');
    }
    assert.deepEqual(sq.carrying([BOARD, AGENT]), [], 'a token reached the squatter');
    assert.ok(sq.seen.length > 0 && sq.seen.every((x) => x.method === 'GET' && x.url.startsWith('/api/board-proof')),
      'only proof requests may reach it: ' + sq.seen.map((x) => x.method + ' ' + x.url).join(', '));
  } finally { await sq.close(); }
});

test('#1765 CONTROL: a board that holds the token gets the request, with its tokens, and is proved once', async () => {
  const board = await startListener({ mode: 'board', holds: BOARD, reply: { ok: true, recorded: true, posts: [], project: { id: 'proj' } } });
  try {
    await run(board.url, ['report', 'working', 'on it']);
    const sends = board.seen.filter((x) => !x.url.startsWith('/api/board-proof'));
    assert.equal(sends.length, 1, 'the report did not arrive: ' + board.seen.map((x) => x.url).join(', '));
    assert.equal(sends[0].headers['x-kosmos-board-token'], BOARD);
    assert.equal(sends[0].headers['x-kosmos-agent-token'], AGENT);
    assert.equal(board.proofRequests().length, 1);
  } finally { await board.close(); }
});

test('#1765: a board holding another account\'s token is refused like a squatter', async () => {
  const other = await startListener({ mode: 'board', holds: 'another-accounts-token' });
  try {
    const r = await run(other.url, ['report', 'working', 'on it']);
    assert.equal(r.code, 1);
    assert.deepEqual(other.carrying([BOARD, AGENT]), []);
  } finally { await other.close(); }
});

test('#1765: a token-only agent proves its agent token, and a squatter still gets nothing', async () => {
  const env = { KOSMOS_AGENT_TOKEN: AGENT, KOSMOS_AGENT_TOKEN_ONLY: '1' };
  const board = await startListener({ mode: 'board', holds: AGENT });
  try {
    await run(board.url, ['report', 'working', 'on it'], { env });
    const sends = board.seen.filter((x) => x.url === '/api/report');
    assert.equal(sends.length, 1);
    assert.equal(sends[0].headers['x-kosmos-board-token'], undefined);
  } finally { await board.close(); }
  const sq = await startListener({ mode: 'squatter' });
  try {
    await run(sq.url, ['report', 'working', 'on it'], { env });
    assert.deepEqual(sq.carrying([BOARD, AGENT]), []);
  } finally { await sq.close(); }
});

test('#1765: a board that is down still reads as down, not as a refused check', async () => {
  const port = await freePort();
  const r = await run('http://127.0.0.1:' + port, ['room', 'proj']);
  assert.equal(r.code, 1);
  assert.match(r.err, /We could not reach Kosmos to read that room\. Is it running/);
  assert.doesNotMatch(r.err, /could not show it is your Kosmos/);
});

test('#1765: the seam is asked with the url, the token and at most half the request\'s bound; false sends nothing', async () => {
  const asked = [];
  let fetched = 0;
  const r = await run('http://127.0.0.1:1', ['report', 'working', 'on it'], {
    hook: { agentToken: () => AGENT, readBoardToken: () => BOARD, resolveUrl: () => 'http://127.0.0.1:1' },
    fetch: async () => { fetched += 1; return { status: 200, text: async () => '{"recorded":true}' }; },
    proveBoard: async (url, token, ms) => { asked.push({ url, token, ms }); return false; },
  });
  assert.equal(r.code, 1);
  assert.equal(fetched, 0, 'a request went out after the check said no');
  assert.deepEqual(asked.map((a) => [a.url, a.token]), [['http://127.0.0.1:1', BOARD]]);
  assert.ok(asked[0].ms > 0 && asked[0].ms <= cli.REQUEST_TIMEOUT_MS / 2);
});

test('#1765: a check that passed serves the rest of the process: two sends in one command, one proof', async () => {
  let asked = 0, fetched = 0;
  // msg asks once more after a cut answer, so one command makes two requests.
  const r = await run('http://127.0.0.1:1', ['msg', 'bart', 'hi'], {
    hook: { agentToken: () => AGENT, readBoardToken: () => BOARD, resolveUrl: () => 'http://127.0.0.1:1' },
    fetch: async () => { fetched += 1; throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }); },
    proveBoard: async () => { asked += 1; return true; },
  });
  assert.equal(fetched, 2, 'the command did not make two requests: ' + r.err);
  assert.equal(asked, 1, 'the second request asked for a second proof');
});
