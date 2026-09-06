'use strict';
/**
 * #2255 (agent-delivery): `kosmos react <project> <postId> <emoji>` posts to
 * /api/react as THIS agent. The route + engine (the toggle, the membership gate,
 * the operator-sentinel guard) are covered in server.projects.test.js and
 * engine/reactions-2255.test.js; this proves the CLI half actually meets them:
 *
 *   - it POSTs {project, of, emoji, from_pane} to /api/react (the sender rides in
 *     from_pane, never trusted from the body, so an agent reacts only as itself),
 *   - it presents the board token on an enforcing board and NONE without one (the
 *     same load-bearing "header present" case as cli.presents-board-token-1968),
 *   - it reports add / toggle-off / a room-state refusal in words a person reads.
 *
 * Same throwaway-KOSMOS_HOME trick as cli.presents-board-token-1968 so the real
 * board_token() resolves with no installed layout.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'boardtok-2255';
const THUMB = '\u{1F44D}';

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-2255-home-'));
  const root = path.join(home, 'root');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app', 'engine'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.writeFileSync(path.join(home, 'app', 'engine', 'store.js'),
    `module.exports = { ROOT: ${JSON.stringify(root)} };\n`);
  return { home, root };
}

// A stub that records each /api/react POST (parsed body + board-token header) and
// answers with whatever the current test wants, so the CLI's message arm can be
// judged. Non-API routes serve the health page so healthy() passes. Rejects on a
// thrown assertion rather than swallowing it (the cli.presents-token lesson).
function withStub(reply, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/react')) {
      let buf = '';
      req.on('data', (c) => (buf += c));
      req.on('end', () => {
        let body = null;
        try { body = JSON.parse(buf || '{}'); } catch { body = { _unparsed: buf }; }
        seen.push({ body, token: req.headers['x-kosmos-board-token'] });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply()));
      });
      return;
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
    execFile(CLI, args, { env, timeout: 15000 }, (err, stdout, stderr) => {
      resolve({ code: err && typeof err.code === 'number' ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function react(port, seen, args, extraEnv) {
  const before = seen.length;
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42', ...extraEnv };
  const out = await runCli(['react', ...args], env);
  for (let i = 0; i < 100 && seen.length === before; i += 1) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return out;
}

test('#2255: kosmos react POSTs {project,of,emoji,from_pane} and presents the board token when the board wrote one', () =>
  withStub(() => ({ ok: true, op: 'add', emoji: THUMB, of: 'm3' }), async (port, seen) => {
    const { home, root } = makeHome();
    try {
      fs.writeFileSync(path.join(root, 'board.token'), TOKEN);
      const out = await react(port, seen, ['payroll-app', 'm3', THUMB], { KOSMOS_HOME: home });
      assert.equal(seen.length, 1, 'the react did not reach /api/react at all');
      assert.deepEqual(seen[0].body, { project: 'payroll-app', of: 'm3', emoji: THUMB, from_pane: '%42' },
        'the CLI did not send the project, post id, emoji, and its own pane');
      assert.equal(seen[0].token, TOKEN, 'react must present the board token on an enforcing board');
      assert.match(out.stdout, /Reacted .* to that post\./, 'an add must say it reacted');
      assert.equal(out.code, 0);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }));

test('#2255: kosmos react sends NO board-token header without a token (non-enforcing board)', () =>
  withStub(() => ({ ok: true, op: 'add', emoji: THUMB, of: 'm3' }), async (port, seen) => {
    const { home } = makeHome();  // no board.token written
    try {
      await react(port, seen, ['payroll-app', 'm3', THUMB], { KOSMOS_HOME: home });
      assert.equal(seen.length, 1, 'the react did not reach the route');
      assert.equal(seen[0].token, undefined, 'no token file, so no board-token header may be sent');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }));

test('#2255: kosmos react reports the toggle-off, and a room-state refusal, in plain words', () =>
  withStub(() => ({ ok: true, op: 'remove', emoji: THUMB, of: 'm3' }), async (port, seen) => {
    const { home } = makeHome();
    try {
      const off = await react(port, seen, ['payroll-app', 'm3', THUMB], { KOSMOS_HOME: home });
      assert.match(off.stdout, /Took your .* back off that post\./, 'a remove must say it was taken back');
      assert.equal(off.code, 0);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }));

test('#2255: kosmos react surfaces a refusal (ok:false) as a non-zero exit with the reason', () =>
  withStub(() => ({ ok: false, because: 'you are not on that project, so this room is not yours to react in' }), async (port, seen) => {
    const { home } = makeHome();
    try {
      const bad = await react(port, seen, ['payroll-app', 'm3', THUMB], { KOSMOS_HOME: home });
      assert.match(bad.stdout, /Not reacted: you are not on that project/, 'a refusal must carry its reason');
      assert.notEqual(bad.code, 0, 'a refusal must exit non-zero so a caller can tell it did not land');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }));

test('#2255: kosmos react with a missing argument explains itself and does not call the route', () =>
  withStub(() => ({ ok: true, op: 'add', emoji: THUMB, of: 'm3' }), async (port, seen) => {
    const { home } = makeHome();
    try {
      const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42', KOSMOS_HOME: home };
      const out = await runCli(['react', 'payroll-app', 'm3'], env);  // no emoji
      assert.match(out.stdout, /Usage: kosmos react/, 'a missing arg must print usage');
      assert.equal(out.code, 2, 'a usage error exits 2');
      assert.equal(seen.length, 0, 'an incomplete react must not reach the route');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }));
