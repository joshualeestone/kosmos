'use strict';
/**
 * #6946: `kosmos claim <project> <postId> [--release]` posts to /api/react with `claim` set, as THIS agent, and says in
 * words whether the post is now yours, already yours, given back, or held by somebody else (exit 1, naming them). The
 * claim rule itself is pinned in engine/roomclaim-6946.test.js; this is the CLI half meeting it. Harness copied from
 * cli.react-2255.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { eventually } = require('./test-support/eventually');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
/* #4796: the CLI reads the board token from the data root. A fresh one here, so the live board's token never
   travels to this test's stub board (or into anything the test records). */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-claim-6946-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });

const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'boardtok-6946';
const THUMB = '\u{1F44D}';

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-6946-home-'));
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
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout: 15000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '): killed by the harness timeout, over the output buffer, or never started. ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function claim(port, seen, args, extraEnv) {
  const before = seen.length;
  const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42', ...extraEnv };
  const out = await runCli(['claim', ...args], env);
  // #5727: load-aware poll, was a count-based for-tick loop (positive wait); .catch keeps the old no-throw behaviour so the caller's assertion stays the failure check.
  await eventually(() => seen.length !== before, (v) => v, { timeoutMs: 5000, stepMs: 50 }).catch(() => {});
  return out;
}


test('#6946: kosmos claim sends claim, never an emoji, with its own pane and the board token', () =>
  withStub(() => ({ ok: true, op: 'add', emoji: '\u{1F64B}', of: 'm3' }), async (port, seen) => {
    const { home, root } = makeHome();
    try {
      fs.writeFileSync(path.join(root, 'board.token'), TOKEN);
      const out = await claim(port, seen, ['payroll-app', 'm3'], { KOSMOS_HOME: home });
      assert.equal(seen.length, 1, 'the claim did not reach /api/react');
      assert.deepEqual(seen[0].body, { project: 'payroll-app', of: 'm3', claim: 'claim', from_pane: '%42' });
      assert.equal(seen[0].token, TOKEN);
      assert.match(out.stdout, /Claimed: that post is yours, and the room shows it\./);
      assert.equal(out.code, 0);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }));

test('#6946: --release sends release, in either position', () =>
  withStub(() => ({ ok: true, op: 'remove', emoji: '\u{1F64B}', of: 'm3' }), async (port, seen) => {
    for (const args of [['p', 'm3', '--release'], ['--release', 'p', 'm3']]) {
      const out = await claim(port, seen, args);
      assert.equal(seen[seen.length - 1].body.claim, 'release', 'args ' + args.join(' '));
      assert.match(out.stdout, /Gave that post back/);
      assert.equal(out.code, 0);
    }
  }));

test('#6946: a claim already yours says so and exits 0', () =>
  withStub(() => ({ ok: true, op: 'already', emoji: '\u{1F64B}', of: 'm3' }), async (port, seen) => {
    const out = await claim(port, seen, ['p', 'm3']);
    assert.match(out.stdout, /That post is already yours\./);
    assert.equal(out.code, 0);
  }));

test('#6946: a post somebody else holds is refused with their name and exit 1; control: an add exits 0', async () => {
  const because = 'ann already claimed that post at 2026-10-22T23:00:00.000Z, so do not post that you are taking it: read the room, and ask ann if you can help';
  await withStub(() => ({ ok: false, claimedBy: 'ann', claimedAt: '2026-10-22T23:00:00.000Z', because }), async (port, seen) => {
    const out = await claim(port, seen, ['p', 'm3']);
    assert.equal(out.code, 1, 'a refused claim must not exit 0');
    assert.ok((out.stdout + out.stderr).includes('Not claimed: ' + because), out.stdout + out.stderr);
  });
});

test('#6946: no post id prints the usage, exits 2, and sends nothing', () =>
  withStub(() => ({ ok: true, op: 'add' }), async (port, seen) => {
    const out = await claim(port, seen, ['p']);
    assert.equal(out.code, 2);
    assert.match(out.stdout + out.stderr, /Usage: kosmos claim <project-id> <post-id> \[--release\]/);
    assert.equal(seen.length, 0);
  }));
