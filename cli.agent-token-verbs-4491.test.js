'use strict';
/**
 * #4491 slices 2-3: `kosmos msg`, `kosmos post`, `kosmos react` and `kosmos task message` present the agent's own token
 * (KOSMOS_AGENT_TOKEN, plain hex only) as `x-kosmos-agent-token`, as reply and report already do,
 * so the board can tell the agent from the person. The board token is still sent as well.
 *
 * The valid-token case is the control for the other two: a CLI that never sent the header would
 * pass every "no header" assertion here.
 *
 * Same stub and sandbox pattern as cli.presents-token.test.js and cli.presents-board-token-1968.test.js:
 * the stub answers `/` with a Kosmos page so the CLI's healthy() accepts it, and KOSMOS_HOME is a
 * throwaway whose store ROOT holds a known board.token, so the real one is never read.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const BOARD = 'boardtoken4491slice2';
const TOKEN = 'ab'.repeat(32);

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-4491-cli-'));
  const root = path.join(home, 'root');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app', 'engine'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.writeFileSync(path.join(home, 'app', 'engine', 'store.js'), `module.exports = { ROOT: ${JSON.stringify(root)} };\n`);
  fs.writeFileSync(path.join(root, 'board.token'), BOARD);
  return home;
}

const ANSWERS = {
  '/api/msg': { delivery: { state: 'placed' } },
  '/api/post': { delivery: { state: 'placed' } },
  '/api/react': { ok: true },
  '/api/project/p4491/task/1/message': { ok: true, delivered: [] },
};

function withStub(fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const route = req.url.split('?')[0];
    if (req.method === 'POST' && ANSWERS[route]) {
      seen.push({ route, agent: req.headers['x-kosmos-agent-token'], board: req.headers['x-kosmos-board-token'] });
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(ANSWERS[route]));
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

const VERBS = [
  ['/api/msg', ['msg', 'mara', 'hello']],
  ['/api/post', ['post', 'p4491', 'hello']],
  ['/api/react', ['react', 'p4491', 'm1', 'thumbsup']],
  ['/api/project/p4491/task/1/message', ['task', 'message', 'p4491', '1', 'hello']],
];

// Async execFile, never execFileSync: a synchronous child blocks the event loop the stub answers on.
// The exit code itself is not asserted (the headers the stub saw are), but a run that ended with no
// numeric code (killed at the timeout, or never started) is a failure, not a pass (#3628).
function runCli(args, env) {
  return new Promise((resolve, reject) => execFile(CLI, args, { env, timeout: 20000 }, (err) => {
    if (err && typeof err.code !== 'number') { reject(err); return; }
    resolve();
  }));
}

async function send(port, seen, home, args, token) {
  const env = { ...process.env, KOSMOS_PORT: String(port), KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: '', TMUX_PANE: '' };
  if (token === null) delete env.KOSMOS_AGENT_TOKEN; else env.KOSMOS_AGENT_TOKEN = token;
  const before = seen.length;
  await runCli(args, env);
  for (let i = 0; i < 100 && seen.length === before; i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.equal(seen.length, before + 1, `kosmos ${args[0]} did not reach the board at all, so its headers cannot be judged`);
  return seen[seen.length - 1];
}

for (const [route, args] of VERBS) {
  test(`kosmos ${args.slice(0, args[0] === 'task' ? 2 : 1).join(' ')} presents a valid agent token as x-kosmos-agent-token, and still the board token`, async () => {
    const home = makeHome();
    try {
      await withStub(async (port, seen) => {
        const got = await send(port, seen, home, args, TOKEN);
        assert.equal(got.route, route);
        assert.equal(got.agent, TOKEN, `kosmos ${args[0]} did not present the agent token`);
        assert.equal(got.board, BOARD, `kosmos ${args[0]} stopped sending the board token (dropping it is a later slice)`);
      });
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  test(`kosmos ${args.slice(0, args[0] === 'task' ? 2 : 1).join(' ')} sends no agent header for a junk or absent token`, async () => {
    const home = makeHome();
    try {
      await withStub(async (port, seen) => {
        for (const token of ['not-hex; rm -rf', 'ABCDEF', '', null]) {
          const got = await send(port, seen, home, args, token);
          assert.equal(got.agent, undefined, `kosmos ${args[0]} forwarded ${JSON.stringify(token)} as an agent token`);
          assert.equal(got.board, BOARD);
        }
      });
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}
