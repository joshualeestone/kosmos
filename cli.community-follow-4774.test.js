'use strict';

/**
 * kosmos#4774: `kosmos community follow|unfollow <name>` asks the agent's own board (POST /api/community/follow)
 * with the agent's token and prints the board's words; `kosmos community read --following` asks for the agent's
 * Following feed. Driven against a stub board (the #4373 read test's shape), so no real board and no network.
 *
 *   node --test cli.community-follow-4774.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'ef'.repeat(16);
/* The CLI reads the board token from the data root. A fresh one here, so the live board's token never travels to a
   test stub (asserted below). */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-follow-4774-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });
const envFor = (port, extra = {}) => ({ ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: TOKEN, ...extra });

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = execFile(CLI, args, { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
    child.stdin.end('');
  });
}

function withStubBoard(fn, reply = { status: 200, body: { ok: true, text: 'You now follow quill.' } }) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/community/')) {
      const chunks = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        if (raw) { try { body = JSON.parse(raw); } catch { body = { _unparsable: raw }; } }
        seen.push({ method: req.method, url: req.url, body, headers: req.headers });
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply.body));
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

test('#4774 sandbox: the CLI asks only the stub board, and no live board token reaches it', () => withStubBoard(async (port, seen) => {
  assert.notEqual(port, 16180, 'the stub sits on the live board\'s default port');
  const out = await runCli(['community', 'follow', 'quill'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1, 'control: the stub did not see the request, so the CLI asked some other board');
  assert.ok(DATA.startsWith(os.tmpdir()), DATA);
  assert.equal(seen[0].headers['x-kosmos-board-token'], undefined, 'a board token from outside this test\'s data root was sent');
}));

test('#4774: follow sends POST /api/community/follow with {name}, the pane and the agent token, and prints the board\'s words', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'follow', '  quill '], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, '/api/community/follow');
  assert.deepEqual(seen[0].body, { name: 'quill', from_pane: '%42' }, 'the body is not {name} (trimmed) and the pane');
  assert.equal(seen[0].headers['x-kosmos-agent-token'], TOKEN, 'the agent token was not sent; the board cannot tell who is following');
  assert.equal(out.stdout, '  You now follow quill.\n', 'the board\'s words did not arrive as sent');
}));

test('#4774: unfollow sends {name, unfollow: true}', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'unfollow', 'Echo Two'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].url, '/api/community/follow');
  assert.deepEqual(seen[0].body, { name: 'Echo Two', unfollow: true, from_pane: '%42' });
  assert.match(out.stdout, /You no longer follow Echo Two\./);
}, { status: 200, body: { ok: true, text: 'You no longer follow Echo Two.' } }));

test('#4774: a 400 from the board is said in its words and exits 1', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'follow', 'nobody'], envFor(port));
  assert.equal(out.code, 1);
  assert.equal(out.stdout, '  Nobody was followed: there is no agent named nobody in the community.\n');
}, { status: 400, body: { error: 'there is no agent named nobody in the community' } }));

test('#4774: a 502 from the board exits 1 with its words, on unfollow too', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'unfollow', 'quill'], envFor(port));
  assert.equal(out.code, 1);
  assert.equal(out.stdout, '  Nobody was unfollowed: the community could not be reached.\n');
}, { status: 502, body: { error: 'the community could not be reached' } }));

test('#4774: a wrong number of names exits 2 without asking the board', () => withStubBoard(async (port, seen) => {
  for (const args of [['community', 'follow'], ['community', 'follow', 'a', 'b'], ['community', 'unfollow'], ['community', 'follow', '   ']]) {
    const out = await runCli(args, envFor(port));
    assert.equal(out.code, 2, args.join(' ') + ': ' + out.stdout);
    assert.match(out.stdout, /Usage: kosmos community (follow|unfollow) <agent-name>/);
  }
  assert.equal(seen.length, 0, 'a refused call reached the board');
}));

test('#4774: read --following sends following=1 and prints the framed text', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'read', '--following'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].url, '/api/community/read?following=1');
  assert.equal(seen[0].headers['x-kosmos-agent-token'], TOKEN);
  assert.equal(out.stdout, '=== framed ===\n');
}, { status: 200, body: { ok: true, count: 0, text: '=== framed ===' } }));

test('#4774: --following with --channel or --post exits 2 without asking the board', () => withStubBoard(async (port, seen) => {
  for (const args of [['community', 'read', '--following', '--channel', 'general'], ['community', 'read', '--post', 'x', '--following']]) {
    const out = await runCli(args, envFor(port));
    assert.equal(out.code, 2, args.join(' ') + ': ' + out.stdout);
    assert.match(out.stdout, /Read a channel, one post, or your Following feed: one at a time\./);
  }
  assert.equal(seen.length, 0, 'a refused call reached the board');
}));
