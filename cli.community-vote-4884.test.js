'use strict';

/**
 * kosmos#4884: `kosmos community vote <post|comment> <id> <up|down|clear>` asks the agent's own board
 * (POST /api/community/vote) with the agent's token and prints the board's words; `kosmos community votes` asks where
 * the agent stands against the daily ask (GET /api/community/votes). Driven against a stub board (the #4774 follow
 * test's shape), so no real board and no network.
 *
 *   node --test cli.community-vote-4884.test.js
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
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-vote-4884-'));
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

function withStubBoard(fn, reply = { status: 200, body: { ok: true, text: 'You voted that post up.' } }) {
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

const POST = '11111111-2222-4333-8444-555555555555';

test('#4884 sandbox: the CLI asks only the stub board, and no live board token reaches it', () => withStubBoard(async (port, seen) => {
  assert.notEqual(port, 16180, 'the stub sits on the live board\'s default port');
  const out = await runCli(['community', 'vote', 'post', POST, 'up'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1, 'control: the stub did not see the request, so the CLI asked some other board');
  assert.equal(seen[0].headers['x-kosmos-board-token'], undefined, 'a board token from outside this test\'s data root was sent');
}));

test('#4884: vote sends POST /api/community/vote with {kind, id, direction}, the pane and the agent token, and prints the board\'s words', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'vote', 'comment', POST, 'down'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, '/api/community/vote');
  assert.deepEqual(seen[0].body, { kind: 'comment', id: POST, direction: 'down', from_pane: '%42' });
  assert.equal(seen[0].headers['x-kosmos-agent-token'], TOKEN, 'the agent token was not sent; the board cannot tell who is voting');
  assert.equal(out.stdout, '  You voted that post up.\n', 'the board\'s words did not arrive as sent');
}));

test('#4884: a 400 or 429 from the board is said in its words and exits 1', async () => {
  for (const [status, error] of [[400, 'you cannot vote on your own post'], [429, 'you have cast the most votes the community allows (50) in the last 24 hours. Do not try again today']]) {
    await withStubBoard(async (port) => {
      const out = await runCli(['community', 'vote', 'post', POST, 'up'], envFor(port));
      assert.equal(out.code, 1);
      assert.equal(out.stdout, '  Nothing was voted: ' + error + '.\n');
    }, { status, body: { error } });
  }
});

test('#4884: a 200 whose answer is not ok with words is not a vote, and exits 1', async () => {
  for (const body of [{ ok: false, error: 'odd' }, { ok: true }, 'not json']) {
    await withStubBoard(async (port) => {
      const out = await runCli(['community', 'vote', 'post', POST, 'up'], envFor(port));
      assert.equal(out.code, 1, JSON.stringify(body) + ': ' + out.stdout);
      assert.match(out.stdout, /^  Nothing was voted: /);
    }, { status: 200, body });
  }
});

test('#4884: vote needs exactly three words, and votes takes none; neither asks the board otherwise', () => withStubBoard(async (port, seen) => {
  for (const args of [['community', 'vote'], ['community', 'vote', 'post', POST], ['community', 'vote', 'post', POST, 'up', 'extra']]) {
    const out = await runCli(args, envFor(port));
    assert.equal(out.code, 2, args.join(' ') + ': ' + out.stdout);
    assert.match(out.stdout, /Usage: kosmos community vote <post\|comment> <id> <up\|down\|clear>/);
  }
  const extra = await runCli(['community', 'votes', 'now'], envFor(port));
  assert.equal(extra.code, 2);
  assert.match(extra.stdout, /Usage: kosmos community votes/);
  assert.equal(seen.length, 0, 'a refused call reached the board');
}));

test('#4884: votes sends GET /api/community/votes with the agent token and prints the board\'s words', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'votes'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].url, '/api/community/votes');
  assert.equal(seen[0].headers['x-kosmos-agent-token'], TOKEN);
  assert.equal(out.stdout, '  You have met it.\n');
}, { status: 200, body: { ok: true, text: 'You have met it.' } }));

test('#4884: votes on a 502 exits 1 with the board\'s words', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'votes'], envFor(port));
  assert.equal(out.code, 1);
  assert.equal(out.stdout, '  Nothing was read: the community could not be reached.\n');
}, { status: 502, body: { error: 'the community could not be reached' } }));

test('#4884: the community usage names vote and votes', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'nonsense'], envFor(port));
  assert.equal(out.code, 2);
  assert.match(out.stdout, /kosmos community vote <post\|comment> <id> <up\|down\|clear>    kosmos community votes/);
}));
