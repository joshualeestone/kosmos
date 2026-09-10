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
const { execFile, execFileSync } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'abc123boardtoken';

// A throwaway KOSMOS_HOME the CLI's board_token() can resolve against.
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1968-home-'));
  const root = path.join(home, 'root');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app', 'engine'), { recursive: true });
  // $NODE = $KOSMOS_HOME/runtime/bin/node -- point it at the real node.
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  // $KOSMOS_HOME/app/engine/store must export { ROOT }.
  fs.writeFileSync(path.join(home, 'app', 'engine', 'store.js'),
    `module.exports = { ROOT: ${JSON.stringify(root)} };\n`);
  return { home, root };
}

// #2644: the SOURCE-checkout layout the report hook actually resolves on a box whose
// installed bundle is stale. It has NEITHER of makeHome()'s two installed things:
// no `$KOSMOS_HOME/runtime/bin/node` (so board_token()'s `command -v node` fallback must
// fire) and the store module at `engine/store`, not `app/engine/store` (so the
// store-module fallback must fire). Both fallbacks are exercised at once, which is exactly
// the real shape that was silently broken since 2026-09-03. Driving it needs a `node` on
// PATH for the fallback to find (see the test's PATH injection).
function makeSourceHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-2644-src-'));
  const root = path.join(home, 'root');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(home, 'engine'), { recursive: true });
  fs.writeFileSync(path.join(home, 'engine', 'store.js'),
    `module.exports = { ROOT: ${JSON.stringify(root)} };\n`);
  // deliberately NO runtime/ and NO app/ -- that absence is the thing under test.
  return { home, root };
}

// Stand up a stub that records the board-token header per route, run `fn`, then
// close (rejecting on a thrown assertion rather than swallowing it -- the
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

// #2644: the source-checkout layout must resolve the token via BOTH fallbacks (no
// runtime/bin/node -> `command -v node`; engine/store not app/engine/store -> the
// store-module fallback). Prepend the test runner's own node dir to PATH so
// `command -v node` is guaranteed to find one regardless of the ambient PATH.
const NODE_DIR = path.dirname(process.execPath);
const withNodeOnPath = (home) => ({
  KOSMOS_HOME: home,
  PATH: `${NODE_DIR}${path.delimiter}${process.env.PATH || ''}`,
});

test('#2644: report/reply present the board token from a SOURCE-checkout layout (both fallbacks fire)', () => withStub(async (port, seen) => {
  const { home, root } = makeSourceHome();
  try {
    fs.writeFileSync(path.join(root, 'board.token'), TOKEN);
    const extra = withNodeOnPath(home);
    assert.equal(await drive(port, seen, 'report', extra), TOKEN, 'source-layout board_token must present the token via the node + store-module fallbacks');
    assert.equal(await drive(port, seen, 'reply', extra), TOKEN, 'source-layout board_token must present the token via the node + store-module fallbacks');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}));

test('#2644: source-checkout layout with no token sends NO header (control: it is the token file that drives it, not the layout)', () => withStub(async (port, seen) => {
  const { home } = makeSourceHome();  // no board.token written
  try {
    const extra = withNodeOnPath(home);
    assert.equal(await drive(port, seen, 'report', extra), undefined, 'source layout, no token file -> no board-token header');
    assert.equal(await drive(port, seen, 'reply', extra), undefined, 'source layout, no token file -> no board-token header');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}));

// #2644 (integration arm): the two tests above stub the store module, so they prove the
// fallback BRANCHES are selected but not that a system node can require the REAL
// engine/store.js. That real-module-under-fallback-node path is the fix's load-bearing
// runtime claim, and a future engine/store.js that a plain system node cannot load (a heavy
// or version-gated top-level dep) would silently re-freeze self-report on real boxes -- the
// exact #2509 symptom this change ends. So this arm symlinks the REAL engine/ (deps and all)
// and controls ROOT via AGENT_WORKFORCE_HOME, asking the real store what ROOT it computes
// rather than hardcoding its platform formula.
function makeRealStoreSourceHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-2644-real-'));
  // engine/ -> the repo's REAL engine dir, so require($KOSMOS_HOME/engine/store) loads the
  // actual module with its actual siblings. No runtime/ and no app/ so both fallbacks fire.
  fs.symlinkSync(path.join(__dirname, 'engine'), path.join(home, 'engine'));
  const awHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-2644-awhome-'));
  const realRoot = execFileSync(
    process.execPath,
    ['-e', 'process.stdout.write(require(process.argv[1]).ROOT)', path.join(__dirname, 'engine', 'store')],
    { env: { ...process.env, AGENT_WORKFORCE_HOME: awHome }, encoding: 'utf8' },
  );
  fs.mkdirSync(realRoot, { recursive: true });
  return { home, awHome, realRoot };
}

test('#2644: source layout resolves the token through the REAL engine/store.js under a system node (integration)', () => withStub(async (port, seen) => {
  const { home, awHome, realRoot } = makeRealStoreSourceHome();
  try {
    fs.writeFileSync(path.join(realRoot, 'board.token'), TOKEN);
    // AGENT_WORKFORCE_HOME must match what makeRealStoreSourceHome() asked the store, so the
    // CLI's node computes the SAME ROOT and finds board.token there.
    const extra = { ...withNodeOnPath(home), AGENT_WORKFORCE_HOME: awHome };
    assert.equal(await drive(port, seen, 'report', extra), TOKEN,
      'a system node must require the REAL engine/store.js and yield ROOT so the token is presented');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(awHome, { recursive: true, force: true });
  }
}));
