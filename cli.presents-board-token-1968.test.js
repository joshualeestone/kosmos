'use strict';
/**
 * #1968 (sender side): `kosmos report` and `kosmos reply` present the board token
 * as `x-kosmos-board-token` when the board wrote one, and send NO such header when
 * there is none. Without this the server-side tightening breaks every same-account
 * report/reply on an enforcing board.
 *
 * 🛑 WHY THIS FILE EXISTS, the same reason cli.presents-token.test.js does: a
 * guard that never sends passes every "no header" assertion, so the header-present
 * case is the load-bearing one. server.report-reply-loopback-1968.test.js proves
 * the RECEIVER refuses a credential-less report/reply; this proves the SENDER
 * supplies the credential, so the two halves actually meet.
 *
 * The CLI reads the token by shelling `$NODE -e '...require($KOSMOS_HOME/app/engine/
 * store).ROOT'` and reading `$ROOT/board.token`. This stands up a throwaway
 * KOSMOS_HOME with those two things so the real `board_token()` resolves, no
 * installed layout required.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'abc123boardtoken';

// A throwaway KOSMOS_HOME the CLI's board_token() can resolve against.
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1968-home-'));
  const root = path.join(home, 'root');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app', 'engine'), { recursive: true });
  // $NODE = $KOSMOS_HOME/runtime/bin/node — point it at the real node.
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  // $KOSMOS_HOME/app/engine/store must export { ROOT }.
  fs.writeFileSync(path.join(home, 'app', 'engine', 'store.js'),
    `module.exports = { ROOT: ${JSON.stringify(root)} };\n`);
  return { home, root };
}

// Stand up a stub that records the board-token header per route, run `fn`, then
// close (rejecting on a thrown assertion rather than swallowing it — the
// cli.presents-token.test.js lesson).
function withStub(fn) {
  const seen = { report: [], reply: [] };
  const server = http.createServer((req, res) => {
    const which = req.url.startsWith('/api/report') ? 'report' : req.url.startsWith('/api/reply') ? 'reply' : null;
    if (req.method === 'POST' && which) {
      seen[which].push(req.headers['x-kosmos-board-token']);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(which === 'report' ? '{"recorded":true}' : '{"kept":true}');
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

function runCli(args, env) {
  return new Promise((resolve) => {
    execFile(CLI, args, { env, timeout: 15000 }, () => resolve());
  });
}

async function drive(port, seen, which, extraEnv) {
  const before = seen[which].length;
  const env = { ...process.env, KOSMOS_PORT: String(port), ...extraEnv };
  const args = which === 'report' ? ['report', 'started'] : ['reply', 'on it'];
  await runCli(args, env);
  for (let i = 0; i < 100 && seen[which].length === before; i += 1) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(seen[which].length, before + 1, `${which} did not reach the route at all, so the header cannot be judged`);
  return seen[which][before];
}

test('#1968: report/reply present the board token when the board wrote one', () => withStub(async (port, seen) => {
  const { home, root } = makeHome();
  try {
    fs.writeFileSync(path.join(root, 'board.token'), TOKEN);
    const extra = { KOSMOS_HOME: home };
    assert.equal(await drive(port, seen, 'report', extra), TOKEN, 'report must present the board token when one exists');
    assert.equal(await drive(port, seen, 'reply', extra), TOKEN, 'reply must present the board token when one exists');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}));

test('#1968: report/reply send NO board-token header when there is no token (non-enforcing board)', () => withStub(async (port, seen) => {
  const { home } = makeHome();  // no board.token written
  try {
    const extra = { KOSMOS_HOME: home };
    assert.equal(await drive(port, seen, 'report', extra), undefined, 'no token file, so no board-token header may be sent');
    assert.equal(await drive(port, seen, 'reply', extra), undefined, 'no token file, so no board-token header may be sent');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}));
