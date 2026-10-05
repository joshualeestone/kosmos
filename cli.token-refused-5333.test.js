'use strict';
/**
 * #5333 (a day-one report): an agent whose token Kosmos no longer recognised was refused by `kosmos whoami`, `kosmos
 * inbox` and `kosmos reply` with the board's one sentence, and nothing said how to get back. The board keeps that
 * sentence exact (sendertoken NO_MATCH: a probe must not learn whether a token was ever real), so each CLI adds the
 * way back AFTER it, and only when the session itself sent a token.
 *
 * Driven against a stub board that answers each route exactly as server.js does when the sender cannot be matched:
 *   whoami  200 { ok: false, because }          (server.js /api/whoami)
 *   inbox   403, text "<because>\n"              (server.js /api/inbox fail(), as=text)
 *   reply   200 { kept: false, because }         (server.js /api/reply)
 * Controls: no token sent (the pane path: the hint would be a false claim), and a different refusal with a token sent.
 * Mac CLI (install/kosmos) and the Windows CLI (tools/windows/kosmos-cli.js) both.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const WIN = path.join(__dirname, 'tools', 'windows', 'kosmos-cli.js');
const TOKEN = 'cd'.repeat(32);
const NO_MATCH = require('./engine/sendertoken').NO_MATCH_SENTENCE || 'we could not match that to one of your agents';
const HINT = 'Kosmos did not recognise the agent token this session started with';

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-5333-cli-'));
  const root = path.join(home, 'root');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app', 'engine'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.writeFileSync(path.join(home, 'app', 'engine', 'store.js'), `module.exports = { ROOT: ${JSON.stringify(root)} };\n`);
  fs.writeFileSync(path.join(root, 'board.token'), 'boardtoken5333');
  return home;
}

function withStub(because, fn) {
  const server = http.createServer((req, res) => {
    const route = req.url.split('?')[0];
    if (route === '/api/whoami') { req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, because })); }
    if (route === '/api/inbox') { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(because + '\n'); }
    if (route === '/api/reply') { req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ kept: false, because })); }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

// Async execFile: a synchronous child would block the event loop the stub answers on.
function run(file, args, env) {
  return new Promise((resolve, reject) => execFile(file, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
    if (err && typeof err.code !== 'number') { reject(err); return; }
    resolve({ code: err ? err.code : 0, out: String(stdout) + String(stderr) });
  }));
}

function envFor(port, home, token) {
  const env = { ...process.env, KOSMOS_PORT: String(port), KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: '', TMUX_PANE: '' };
  delete env.KOSMOS_AGENT_TOKEN_ONLY;
  if (token === null) delete env.KOSMOS_AGENT_TOKEN; else env.KOSMOS_AGENT_TOKEN = token;
  return env;
}

const VERBS = [['whoami'], ['inbox'], ['reply', 'hello']];

for (const args of VERBS) {
  test(`#5333 Mac: kosmos ${args[0]} refused on a sent token prints the board's sentence, then the way back`, async () => {
    const home = makeHome();
    try {
      await withStub(NO_MATCH, async (port) => {
        const got = await run(CLI, args, envFor(port, home, TOKEN));
        assert.ok(got.out.includes(NO_MATCH), `the board's sentence is kept: ${got.out}`);
        assert.ok(got.out.includes(HINT), `the way back is said: ${got.out}`);
        assert.ok(got.out.indexOf(NO_MATCH) < got.out.indexOf(HINT), 'after the board\'s words, never instead');
        assert.match(got.out, /restart you from Kosmos/);
        assert.match(got.out, /`kosmos adopt` does not help here/);
        // whoami exits 0 as before (the board answers its refusal with a 200); inbox and reply exit non-zero, as before.
        if (args[0] !== 'whoami') assert.notEqual(got.code, 0, 'still a failure');
      });
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  test(`#5333 Mac CONTROLS: kosmos ${args[0]} with no token sent, or another refusal, adds nothing`, async () => {
    const home = makeHome();
    try {
      await withStub(NO_MATCH, async (port) => {
        const got = await run(CLI, args, envFor(port, home, null));
        assert.ok(got.out.includes(NO_MATCH), `the stub answered: ${got.out}`);
        assert.ok(!got.out.includes(HINT), 'no token was sent, so there is no token to have been refused');
      });
      await withStub('Kosmos is busy, try again in a moment', async (port) => {
        const got = await run(CLI, args, envFor(port, home, TOKEN));
        assert.ok(!got.out.includes(HINT), 'a different refusal is not a token refusal');
      });
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}

/* The Windows CLI, run as node on the same stub (it reads KOSMOS_PORT and the board token the same way). */
for (const args of VERBS) {
  test(`#5333 Windows: kosmos ${args[0]} refused on a sent token prints the board's sentence, then the way back`, async () => {
    const home = makeHome();
    try {
      await withStub(NO_MATCH, async (port) => {
        const got = await run(process.execPath, [WIN, ...args], envFor(port, home, TOKEN));
        assert.ok(got.out.includes(NO_MATCH), `the board's sentence is kept: ${got.out}`);
        assert.ok(got.out.includes(HINT), `the way back is said: ${got.out}`);
        assert.ok(got.out.indexOf(NO_MATCH) < got.out.indexOf(HINT), 'after the board\'s words');
        const none = await run(process.execPath, [WIN, ...args], envFor(port, home, null));
        assert.ok(!none.out.includes(HINT), 'CONTROL: no token sent, no hint');
      });
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}
