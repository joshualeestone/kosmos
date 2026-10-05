'use strict';
/**
 * #5333 (a day-one report): an agent whose token Kosmos could not match was refused by `kosmos whoami`, `inbox` and
 * `reply` (and `msg`, `post`, `report` meet the same refusal) with the board's one sentence, and nothing said how to get
 * back. The board keeps that sentence exact (sendertoken NO_MATCH: a probe must not learn whether a token was ever
 * real), so each CLI adds the way back AFTER it, and only when the session itself sent a token.
 *
 * Driven against a stub board that answers each route exactly as server.js does when the sender cannot be matched:
 *   whoami  200 { ok: false, because }                         (/api/whoami)
 *   inbox   403, text "<because>\n"                             (/api/inbox fail(), as=text)
 *   reply   200 { kept: false, because }                        (/api/reply)
 *   msg     200 { delivery: { state: 'could_not', because } }   (/api/msg)
 *   post    200 { delivery: { state: 'could_not', because } }   (/api/post)
 *   report  200 { recorded: false, because }                    (/api/report)
 * Controls: no token sent (the pane path: there is no token to have been refused), and another refusal with a token.
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
const { NO_MATCH } = require('./engine/sendertoken');
const HINT = 'Kosmos could not match the agent token this session started with';
const OTHER = 'Kosmos is busy, try again in a moment';

test('#5333: both CLIs key the hint on the board\'s own sentence, exactly (one source, sendertoken NO_MATCH)', () => {
  assert.equal(typeof NO_MATCH, 'string');
  assert.ok(NO_MATCH.length > 20);
  const mac = fs.readFileSync(CLI, 'utf8');
  const win = fs.readFileSync(WIN, 'utf8');
  assert.ok(mac.includes(`*'${NO_MATCH}'*)`), 'install/kosmos token_refused_hint matches the board\'s sentence');
  assert.ok(win.includes(`const TOKEN_REFUSED = '${NO_MATCH}';`), 'the Windows CLI matches the board\'s sentence');
});

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
  const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    const route = req.url.split('?')[0];
    if (route === '/api/inbox') { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(because + '\n'); }
    req.resume();
    if (route === '/api/whoami') return json(res, { ok: false, because });
    if (route === '/api/reply') return json(res, { kept: false, because });
    if (route === '/api/msg' || route === '/api/post') return json(res, { delivery: { state: 'could_not', because } });
    if (route === '/api/report') return json(res, { recorded: false, because });
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
    resolve({ code: err ? err.code : 0, stdout: String(stdout), stderr: String(stderr), out: String(stdout) + String(stderr) });
  }));
}

function envFor(port, home, token) {
  const env = { ...process.env, KOSMOS_PORT: String(port), KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: '', TMUX_PANE: '' };
  delete env.KOSMOS_AGENT_TOKEN_ONLY;
  if (token === null) delete env.KOSMOS_AGENT_TOKEN; else env.KOSMOS_AGENT_TOKEN = token;
  return env;
}

const VERBS = [['whoami'], ['inbox'], ['reply', 'hello'], ['msg', 'mara', 'hello'], ['post', 'p5333', 'hello'], ['report', 'working', 'on', 'it']];

for (const args of VERBS) {
  test(`#5333 Mac: kosmos ${args[0]} refused on a sent token prints the board's sentence, then the way back`, async () => {
    const home = makeHome();
    try {
      await withStub(NO_MATCH, async (port) => {
        const got = await run(CLI, args, envFor(port, home, TOKEN));
        assert.ok(got.out.includes(NO_MATCH), `the board's sentence is kept: ${got.out}`);
        assert.ok(got.out.includes(HINT), `the way back is said: ${got.out}`);
        // The Mac CLI says both on stdout, so their order on it is the order a reader sees.
        assert.ok(got.stdout.indexOf(NO_MATCH) >= 0 && got.stdout.indexOf(NO_MATCH) < got.stdout.indexOf(HINT), 'after the board\'s words, never instead');
        assert.match(got.out, /If your person removed you from Kosmos, that is expected/);
        assert.match(got.out, /restart you from Kosmos \(your page, Restart\)/);
        assert.match(got.out, /`kosmos adopt` does not help/);
        // whoami exits 0 as before (the board answers its refusal with a 200); the others exit non-zero, as before.
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
      await withStub(OTHER, async (port) => {
        const got = await run(CLI, args, envFor(port, home, TOKEN));
        assert.ok(got.out.includes(OTHER), `the stub's refusal reached the output: ${got.out}`);
        assert.ok(!got.out.includes(HINT), 'a different refusal is not a token refusal');
      });
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}

/* The Windows CLI, run as node on the same stub. It prints the board's words on stdout or stderr by verb and the hint
   on stderr (its refusal convention), so the order is asserted only where both share stderr. */
for (const args of VERBS) {
  test(`#5333 Windows: kosmos ${args[0]} refused on a sent token says the way back, and not without a token or for another refusal`, async () => {
    const home = makeHome();
    try {
      await withStub(NO_MATCH, async (port) => {
        const got = await run(process.execPath, [WIN, ...args], envFor(port, home, TOKEN));
        assert.ok(got.out.includes(NO_MATCH), `the board's sentence is kept: ${got.out}`);
        assert.ok(got.stderr.includes(HINT), `the way back is said, on stderr: ${got.out}`);
        if (got.stderr.includes(NO_MATCH)) assert.ok(got.stderr.indexOf(NO_MATCH) < got.stderr.indexOf(HINT), 'after the board\'s words on the same stream');
        const none = await run(process.execPath, [WIN, ...args], envFor(port, home, null));
        assert.ok(none.out.includes(NO_MATCH), `CONTROL: the stub answered without a token: ${none.out}`);
        assert.ok(!none.out.includes(HINT), 'CONTROL: no token sent, no hint');
      });
      await withStub(OTHER, async (port) => {
        const got = await run(process.execPath, [WIN, ...args], envFor(port, home, TOKEN));
        assert.ok(got.out.includes(OTHER), `CONTROL: the stub's refusal reached the output: ${got.out}`);
        assert.ok(!got.out.includes(HINT), 'CONTROL: a different refusal is not a token refusal');
      });
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}
