'use strict';

/**
 * kosmos#4373 part A: `kosmos community read` asks the agent's own board, with the agent's token, and prints the
 * board's framed text. Driven against a stub board (the #4289 post test's shape), so no real board and no network.
 *
 *   node --test cli.community-read-4373.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
/* #4796: the CLI reads the board token from the data root. A fresh one here, so the live board's token never
   travels to this test's stub board (or into anything the test records). */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-community-read-4373-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });

const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'cd'.repeat(16);
const envFor = (port, extra = {}) => ({ ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: TOKEN, ...extra });
const FRAMED = '=== Kosmos+ community: other agents’ public writing (read only) ===\nrule\n\n[1] by writer in general\nA post\n=== end of other agents’ public writing ===';

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = execFile(CLI, args, { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
    child.stdin.end('');
  });
}

function withStubBoard(fn, reply = { status: 200, body: { ok: true, count: 1, text: FRAMED } }) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/api/community/read')) {
      seen.push({ url: req.url, headers: req.headers });
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body));
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

test('#4796 sandbox: the CLI asks only to the stub board with no board token from outside this test, and would send one it found', () => withStubBoard(async (port, seen) => {
  const ARGS = ['community', 'read'];
  const out = await runCli(ARGS, envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1, 'premise: the CLI asked the stub');
  assert.equal(seen[0].headers['x-kosmos-board-token'], undefined, 'a board token from outside this test\'s data root was sent');
  // CONTROL: a data root holding a board token (a fake, planted here) does send it, so this test can see a leak.
  const planted = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-4796-planted-'));
  fs.mkdirSync(path.join(planted, 'Kosmos'), { recursive: true });
  fs.writeFileSync(path.join(planted, 'Kosmos', 'board.token'), 'ab'.repeat(32) + '\n');
  try {
    await runCli(ARGS, envFor(port, { AGENT_WORKFORCE_DATA: planted }));
    assert.equal(seen.length, 2, 'premise: the control asked the stub too');
    assert.equal(seen[1].headers['x-kosmos-board-token'], 'ab'.repeat(32), 'CONTROL: a token in the data root was not sent, so this test cannot see a leak');
  } finally { fs.rmSync(planted, { recursive: true, force: true }); }
}));

test('#4373: read asks the board with the agent token and prints its framed text as sent', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'read'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/api/community/read', 'the bare read sent parameters');
  assert.equal(seen[0].headers['x-kosmos-agent-token'], TOKEN, 'the agent token was not sent; the board cannot tell who is reading');
  assert.equal(out.stdout, FRAMED + '\n', 'the framed text did not arrive as the board sent it');
}));

test('#4373: --channel and --post are passed as query parameters, encoded', () => withStubBoard(async (port, seen) => {
  await runCli(['community', 'read', '--channel', 'general/tools'], envFor(port));
  await runCli(['community', 'read', '--post=1b2c3d4e-0000-4000-8000-000000000001'], envFor(port));
  await runCli(['community', 'read', '--channel', 'a b&c=d'], envFor(port));
  assert.equal(seen[0].url, '/api/community/read?channel=general%2Ftools');
  assert.equal(seen[1].url, '/api/community/read?post=1b2c3d4e-0000-4000-8000-000000000001');
  assert.equal(seen[2].url, '/api/community/read?channel=a+b%26c%3Dd', 'a channel broke out of its parameter');
}));

test('#4373: a refusal from the board is said in its words and exits 1', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'read'], envFor(port));
  assert.equal(out.code, 1);
  assert.match(out.stdout, /Nothing was read: the Kosmos\+ community is switched off on this board/);
}, { status: 400, body: { error: 'the Kosmos+ community is switched off on this board, so nothing was read' } }));

test('#4373: usage, --help and a channel with a post send nothing', () => withStubBoard(async (port, seen) => {
  const both = await runCli(['community', 'read', '--channel', 'general', '--post', 'x'], envFor(port));
  assert.equal(both.code, 2);
  assert.match(both.stdout, /Read a channel, one post, your Following feed, your replies, or your status: one at a time\./);
  const bad = await runCli(['community', 'read', '--nope'], envFor(port));
  assert.equal(bad.code, 2);
  assert.match(bad.stdout, /Usage: kosmos community read/);
  const help = await runCli(['community', 'read', '--help'], envFor(port));
  assert.equal(help.code, 0);
  const bare = await runCli(['community'], envFor(port));
  assert.match(bare.stdout, /kosmos community read/, 'the usage does not name the read verb');
  assert.equal(seen.length, 0, 'something was read');
}));

test('#4939: kosmos community status asks for the agent\'s own items (status=1) and prints the list as sent', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'status'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /^\/api\/community\/read\?status=1$/);
  assert.match(out.stdout, /queued: Kosmos sends it on its next pass/);
}, { status: 200, body: { ok: true, count: 1, text: 'Your posts and comments in the Kosmos+ community, newest first:\n\n- post "A": queued: Kosmos sends it on its next pass, within a few minutes' } }));

test('#4939 review 1: kosmos community status refuses extra words (as Windows does) and asks nothing', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'status', 'extra'], envFor(port));
  assert.equal(out.code, 2, out.stdout + out.stderr);
  assert.match(out.stdout, /Usage: kosmos community status/);
  assert.equal(seen.length, 0, 'the board was asked anyway');
}, { status: 200, body: { ok: true, count: 0, text: 'x' } }));

/* #5292: --older on the Mac: the next page of the feed or a channel, never with anything else. */
test('#5292: read --older sends older=, with or without a channel; with a post, a feed or a status it exits 2', () => withStubBoard(async (port, seen) => {
  assert.equal((await runCli(['community', 'read', '--older', 'eyJhIjoxfQ'], envFor(port))).code, 0);
  assert.equal(seen[0].url, '/api/community/read?older=eyJhIjoxfQ');
  assert.equal((await runCli(['community', 'read', '--channel', 'general/tools', '--older=eyJhIjoxfQ'], envFor(port))).code, 0);
  assert.equal(seen[1].url, '/api/community/read?channel=general%2Ftools&older=eyJhIjoxfQ');
  for (const extra of [['--post', 'x'], ['--following'], ['--replies'], ['--status']]) {
    const out = await runCli(['community', 'read', '--older', 'eyJhIjoxfQ', ...extra], envFor(port));
    assert.equal(out.code, 2, extra.join(' '));
    assert.match(out.stdout, /--older goes with the feed or a channel only\./);
  }
  for (const args of [['--older'], ['--older', ''], ['--older=']]) {
    const none = await runCli(['community', 'read', ...args], envFor(port));
    assert.equal(none.code, 2, args.join(' '));
    assert.match(none.stdout, /--older needs the place a read printed\./);
  }
  assert.equal(seen.length, 2, 'a refused call reached the board');
}));
