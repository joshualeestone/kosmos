'use strict';
/**
 * kosmos#7153, the CLI half: `kosmos notice --from "<source>" --stdin <project-id>` lets a job on this Mac (the builder
 * alarm, an email digest) write a line into a room in Kosmos's own voice. It sends the text and source to the board's
 * notice route with the board token in a header, needs no agent token and no pane, and says plainly when it is refused.
 *
 * Same stub-server posture as cli.room-reopen-2710.test.js: a fake board serves the health page (so healthy() passes)
 * and records the notice request, and the real `install/kosmos` script is driven with spawn (the text goes on stdin).
 *
 *   node --test cli.notice-7153.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

/* The CLI reads the board token from the data root: a fresh one here, holding a known token, so the live board's never
   travels to the stub and the test can see where the token goes. */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-notice-7153-'));
const TOKEN = 'BOARDTOKEN_cli_7153_0123456789abcdef';
// The CLI reads board.token from store.ROOT under this data root; ask store where that is rather than assume it.
process.env.AGENT_WORKFORCE_DATA = DATA;
const ROOT = require('./engine/store').ROOT;
fs.mkdirSync(ROOT, { recursive: true });
fs.writeFileSync(path.join(ROOT, 'board.token'), TOKEN, { mode: 0o600 });
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });

const CLI = path.join(__dirname, 'install', 'kosmos');
const HEALTH = '<title>Kosmos</title>Agent Workforce';

function runCli(args, env, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLI, args, { env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('the CLI did not finish in 20 s')); }, 20000);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    if (input === undefined) child.stdin.end(); else child.stdin.end(input);
  });
}

/* A stub board: the notice route answers `answer` and records each request; every other GET is the health page. */
function withBoard(answer, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && /^\/api\/project\/[^/]+\/notice$/.test(req.url)) {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        seen.push({ url: req.url, token: req.headers['x-kosmos-board-token'] || null, agent: req.headers['x-kosmos-agent-token'] || null, body });
        res.writeHead(answer.code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(answer.body));
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(HEALTH);
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

/* As a launchd job runs it: no tmux pane and no agent token. */
function jobEnv(port) {
  const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port) };
  delete env.TMUX_PANE;
  delete env.TMUX;
  delete env.KOSMOS_AGENT_TOKEN;
  return env;
}

test('a job writes a notice: the text and source go to the room\'s notice route, with the board token in a header', () =>
  withBoard({ code: 200, body: { ok: true, project: 'fleetjosh' } }, async (port, seen) => {
    const out = await runCli(['notice', '--from', 'builder alarm', '--stdin', 'fleetjosh'], jobEnv(port), 'Splinter is unreachable.\nCheck "the fleet".\n');
    assert.equal(out.code, 0, 'the notice failed: ' + out.stdout + out.stderr);
    assert.match(out.stdout, /Written to fleetjosh as a Kosmos notice from builder alarm\./);
    assert.equal(seen.length, 1, 'not exactly one request reached the board');
    assert.equal(seen[0].url, '/api/project/fleetjosh/notice');
    assert.equal(seen[0].token, TOKEN, 'the board token did not travel in its header');
    assert.equal(seen[0].agent, null, 'the job sent an agent token it does not have');
    assert.deepEqual(JSON.parse(seen[0].body), { text: 'Splinter is unreachable.\nCheck "the fleet".', source: 'builder alarm' },
      'the board did not receive the text and source as written');
  }));

test('a refusal is said, with the board\'s reason, and exits non-zero; a missing project says so', async () => {
  await withBoard({ code: 400, body: { error: 'a notice needs words, at most 4000 characters' } }, async (port) => {
    const out = await runCli(['notice', '--from', 'builder alarm', '--stdin', 'fleetjosh'], jobEnv(port), 'hello');
    assert.notEqual(out.code, 0, 'a refused notice exited 0');
    assert.match(out.stdout, /The notice was not written: a notice needs words, at most 4000 characters\./);
    // A job's notice may be its only copy: the refusal keeps it, and says where.
    const saved = /saved at (\S+)/.exec(out.stdout);
    assert.ok(saved, 'the refused notice was not kept: ' + out.stdout);
    assert.equal(fs.readFileSync(saved[1], 'utf8'), 'hello', 'the kept copy is not the notice as piped');
    fs.rmSync(saved[1], { force: true });
  });
  await withBoard({ code: 404, body: { error: 'there is no project by that name, so there is no room to post into' } }, async (port) => {
    const out = await runCli(['notice', '--from', 'builder alarm', '--stdin', 'nosuchroom'], jobEnv(port), 'hello');
    assert.notEqual(out.code, 0);
    assert.match(out.stdout, /There is no project called "nosuchroom"/);
    const saved = /saved at (\S+)/.exec(out.stdout);
    if (saved) fs.rmSync(saved[1], { force: true });
  });
  // A board older than the notice route answers 404 without the project words: it is told to update, not that the room is missing.
  await withBoard({ code: 404, body: { error: 'not found' } }, async (port) => {
    const out = await runCli(['notice', '--from', 'builder alarm', '--stdin', 'fleetjosh'], jobEnv(port), 'hello');
    assert.notEqual(out.code, 0);
    assert.match(out.stdout, /This board does not know kosmos notice yet/);
    const saved = /saved at (\S+)/.exec(out.stdout);
    if (saved) fs.rmSync(saved[1], { force: true });
  });
});

test('usage: no source, no --stdin, a source with a colon, or no words is refused before anything is sent', () =>
  withBoard({ code: 200, body: { ok: true } }, async (port, seen) => {
    for (const [args, input, said] of [
      [['notice', '--stdin', 'fleetjosh'], 'hello', /Usage: kosmos notice/],
      [['notice', '--from', 'builder alarm', 'fleetjosh'], 'hello', /Usage: kosmos notice/],
      [['notice', '--from', 'builder: alarm', '--stdin', 'fleetjosh'], 'hello', /a few plain words/],
      [['notice', '--from', 'builder\talarm', '--stdin', 'fleetjosh'], 'hello', /a few plain words/],
      [['notice', '--from', 'builder alarm', '--stdin', 'fleetjosh'], '', /empty|nothing was piped|Nothing was written/i],
    ]) {
      const out = await runCli(args, jobEnv(port), input);
      assert.notEqual(out.code, 0, args.join(' ') + ' exited 0');
      assert.match(out.stdout + out.stderr, said, args.join(' '));
    }
    assert.equal(seen.length, 0, 'a refused usage still reached the board');
  }));
