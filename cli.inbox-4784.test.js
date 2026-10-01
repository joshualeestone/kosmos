'use strict';

/**
 * kosmos#4784: `kosmos inbox` asks the agent's own board for its recent messages with the person, with the agent's
 * token, and prints the board's text. Driven against a stub board (the community-read test's shape).
 *
 *   node --test cli.inbox-4784.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'ab'.repeat(16);
const envFor = (port) => ({ ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%7', KOSMOS_AGENT_TOKEN: TOKEN });
const TEXT = '2026-09-30 21:00:20Z the person: Please check the invoice\n2026-09-30 21:00:30Z you: On it.\n';

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = execFile(CLI, args, { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
    child.stdin.end('');
  });
}

function withStubBoard(fn, reply = { status: 200, text: TEXT }) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/api/inbox')) {
      seen.push({ url: req.url, headers: req.headers });
      res.writeHead(reply.status, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(reply.text);
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

test('#4784: inbox asks with the agent token and the pane, and prints the board\'s text as sent', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['inbox', '--limit', '5'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/api/inbox?as=text&limit=5&from_pane=%257');
  assert.equal(seen[0].headers['x-kosmos-agent-token'], TOKEN, 'the agent token was not sent');
  assert.equal(out.stdout, TEXT);
}));

test('#4784: a limit that is not a whole number is refused before any request', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['inbox', '--limit', 'ten'], envFor(port));
  assert.equal(out.code, 2, out.stdout + out.stderr);
  assert.equal(seen.length, 0, 'a request was sent with a bad limit');
}));

test('#4784: a refusal from the board exits non-zero with the board\'s words', () => withStubBoard(async (port) => {
  const out = await runCli(['inbox'], envFor(port));
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /own agent token/);
}, { status: 403, text: 'this board only shows an agent its messages with its own agent token; run `kosmos inbox` as that agent\n' }));

test('#4784 review 1: --help prints the usage and reads nothing', () => withStubBoard(async (port, seen) => {
  for (const flag of ['--help', '-h']) {
    const out = await runCli(['inbox', flag], envFor(port));
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /kosmos inbox \[--limit N\]/);
  }
  assert.equal(seen.length, 0, '--help read the person\'s messages');
}));

test('#4784 review 1: --limit 0 is refused before any request', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['inbox', '--limit=0'], envFor(port));
  assert.equal(out.code, 2, out.stdout + out.stderr);
  assert.equal(seen.length, 0);
}));

test('#4784 review 2: --limit 51 and a --limit with no value are refused before any request', () => withStubBoard(async (port, seen) => {
  for (const args of [['inbox', '--limit', '51'], ['inbox', '--limit']]) {
    const out = await runCli(args, envFor(port));
    assert.equal(out.code, 2, args.join(' ') + ': ' + out.stdout + out.stderr);
  }
  assert.equal(seen.length, 0);
}));
