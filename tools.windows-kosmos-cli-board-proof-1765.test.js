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

test('#1765 CONTROL: a board that holds the token gets the request, with its tokens, proved before it (one request, one proof)', async () => {
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

test('#1765: a listener that takes the connection and resets it is not read as a board that is down', async () => {
  const http = require('node:http');
  const resetting = http.createServer((req) => { req.socket.destroy(); });
  await new Promise((r) => resetting.listen(0, '127.0.0.1', r));
  try {
    const r = await run('http://127.0.0.1:' + resetting.address().port, ['room', 'proj']);
    assert.equal(r.code, 1);
    assert.match(r.err, /could not show it is your Kosmos/);
    assert.doesNotMatch(r.err, /Is it running/);
  } finally { resetting.close(); }
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

test('kosmos#6464: each request proves for itself: two sends in one command, two proofs', async () => {
  let asked = 0, fetched = 0;
  // msg asks once more after a cut answer, so one command makes two requests.
  const r = await run('http://127.0.0.1:1', ['msg', 'bart', 'hi'], {
    hook: { agentToken: () => AGENT, readBoardToken: () => BOARD, resolveUrl: () => 'http://127.0.0.1:1' },
    fetch: async () => { fetched += 1; throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }); },
    proveBoard: async () => { asked += 1; return true; },
  });
  assert.equal(fetched, 2, 'the command did not make two requests: ' + r.err);
  assert.equal(asked, 2, 'the retry after a request that did not complete went on the first request proof');
});

test('#1765: task ran is not asked again of a listener that failed the check, and says why nothing was sent', async () => {
  const sq = await startListener({ mode: 'squatter' });
  try {
    const r = await run(sq.url, ['task', 'ran', 'proj', '3', 'checked the queue']);
    assert.equal(r.code, 1, r.err);
    assert.match(r.err, /could not show it is your Kosmos, so we did not record that run and sent it nothing/);
    assert.doesNotMatch(r.err, /asking again/, 'a failed check was retried');
    assert.equal(sq.proofRequests().length, 1);
    assert.deepEqual(sq.carrying([BOARD, AGENT]), []);
  } finally { await sq.close(); }
});

test('#1765: the command\'s own entry passes no fetch, hook or seam (any of which would skip the real check)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'tools', 'windows', 'kosmos-cli.js'), 'utf8');
  assert.match(src, /if \(require\.main === module\) \{\n  main\(process\.argv\.slice\(2\)\)\.then/);
});

/* ---- kosmos#6464: a proof covers one request, a body secret needs a token, and no redirect is followed ---- */
const http = require('node:http');
const { answerProof } = require('./test-support/proof-listener-1765');

/* A real listener that proves it holds BOARD for its first `proves` proofs and then answers like a squatter (the
   board restarted and something else took the port), and cuts its first /api/msg send after reading it (a reset, so
   msg asks once more). Every request is recorded. */
function startTurncoat({ proves }) {
  const seen = [];
  let proofs = 0, msgs = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: { ...req.headers }, body });
      if (req.url.startsWith('/api/board-proof')) {
        proofs += 1;
        if (proofs <= proves && answerProof(req, res, [BOARD])) return;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ proof: 'c'.repeat(64) }));
        return;
      }
      if (req.url === '/api/msg' && ++msgs === 1) { req.socket.destroy(); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, delivered: true }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: 'http://127.0.0.1:' + server.address().port,
    seen,
    sends: () => seen.filter((x) => x.url === '/api/msg'),
    proofs: () => seen.filter((x) => x.url.startsWith('/api/board-proof')),
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  })));
}

test('kosmos#6464: a retry after a request that did not complete proves again, and a listener that no longer proves gets nothing', async () => {
  const l = await startTurncoat({ proves: 1 });
  try {
    const r = await run(l.url, ['msg', 'bart', 'hi']);
    assert.equal(l.proofs().length, 2, 'the retry did not prove again: ' + l.seen.map((x) => x.method + ' ' + x.url).join(', '));
    assert.equal(l.sends().length, 1, 'the retry went to a listener that had stopped proving itself');
    assert.notEqual(r.code, 0, r.err);
  } finally { await l.close(); }
});

test('kosmos#6464 CONTROL: a board that keeps proving itself gets the retry, proved again', async () => {
  const l = await startTurncoat({ proves: 99 });
  try {
    const r = await run(l.url, ['msg', 'bart', 'hi']);
    assert.equal(l.proofs().length, 2);
    assert.equal(l.sends().length, 2, 'the retry did not reach a board that proved itself: ' + r.err);
  } finally { await l.close(); }
});

/* `kosmos connect` carries a service key in the BODY. With no board token there is nothing in the headers to prove
   the listener with, so it refuses rather than send the key unproven. */
async function connect(url) {
  return run(url, ['connect', 'brave-search'], { readStdin: async () => ({ text: 'svc-key-6464-win', ended: true }) });
}
function withoutBoardToken(fn) {
  const p = boardauth.tokenPath();
  const aside = p + '.aside-6464';
  fs.renameSync(p, aside);
  return Promise.resolve().then(fn).finally(() => fs.renameSync(aside, p));
}

test('kosmos#6464: with no board token, connect refuses to send a service key, and the listener gets nothing', async () => {
  const sq = await startListener({ mode: 'squatter' });
  try {
    await withoutBoardToken(async () => {
      assert.equal(require('./engine/kosmos-report-hook').readBoardToken(), null, 'the board token is still readable, so this arm measures nothing');
      const r = await connect(sq.url);
      assert.equal(r.code, 1, r.err);
      assert.match(r.err, /could not read its Kosmos board token[\s\S]*nothing was sent/);
    });
    assert.deepEqual(sq.carrying(['svc-key-6464-win']), [], 'the service key reached an unproven listener');
    assert.deepEqual(sq.seen.filter((x) => x.method === 'POST'), [], 'a request went out');
  } finally { await sq.close(); }
});

test('kosmos#6464 CONTROL: with the board token, a board that proves itself receives the key', async () => {
  const board = await startListener({ mode: 'board', holds: BOARD, reply: { connected: true, service: 'Brave Search' } });
  try {
    const r = await connect(board.url);
    assert.equal(r.code, 0, r.err);
    const posts = board.seen.filter((x) => x.method === 'POST');
    assert.equal(posts.length, 1);
    assert.match(posts[0].body, /svc-key-6464-win/);
    assert.equal(board.proofRequests().length, 1);
  } finally { await board.close(); }
});

test('kosmos#6464: a proven board that redirects a send elsewhere: the tokens and body never reach the other address', async () => {
  const elsewhere = await startListener({ mode: 'squatter' });
  const redirected = [];
  const server = http.createServer((req, res) => {
    if (answerProof(req, res, [BOARD])) return;
    redirected.push(req.method + ' ' + req.url);
    res.writeHead(307, { location: elsewhere.url + req.url });   // 307 keeps the method and body if followed
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const r = await run('http://127.0.0.1:' + server.address().port, ['report', 'working', 'on it']);
    assert.notEqual(r.code, 0, r.err);
    assert.deepEqual(redirected, ['POST /api/report'], 'the report never reached the board (so this arm measures nothing), or was asked again');
    assert.equal(r.code, 1, r.err);
    assert.match(r.err, /tried to send this request somewhere else, which Kosmos never does, so we did not follow it. We could not record that; check before doing it again./);
    // A read changes nothing, so it is not told to check before doing it again.
    const rd = await run('http://127.0.0.1:' + server.address().port, ['room', 'proj']);
    assert.equal(rd.code, 1, rd.err);
    assert.match(rd.err, /so we did not follow it\. We could not [^;]+\.$/m);
    assert.doesNotMatch(rd.err, /check before doing it again/);
    redirected.length = 1;   // the room read's GET is not part of the msg count below
    // msg asks once more after a cut answer; a refused redirect is not one, so it is sent once.
    const m = await run('http://127.0.0.1:' + server.address().port, ['msg', 'bart', 'hi']);
    assert.equal(m.code, 1, m.err);
    assert.deepEqual(redirected, ['POST /api/report', 'POST /api/msg'], 'msg was asked again after a refused redirect');
    assert.deepEqual(elsewhere.seen.map((x) => x.method + ' ' + x.url), [], 'the request followed the redirect');
  } finally { server.closeAllConnections(); server.close(); await elsewhere.close(); }
});
