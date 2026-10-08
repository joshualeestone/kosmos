'use strict';

/**
 * kosmos#5574: `kosmos community withdraw <post|comment> <id>` asks the agent's own board
 * (POST /api/community/service-withdraw) with the agent's token and says, in words, what happened: held back before it
 * was sent, coming down on the next send, already down, or why nothing was taken back. Driven against a stub board (the
 * vote test's shape), so no real board and no network.
 *
 *   node --test cli.community-withdraw-5574.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'ab'.repeat(16);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-withdraw-5574-'));
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

function withStubBoard(fn, reply) {
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

const ID = '11111111-2222-4333-8444-555555555555';

test('#5574: withdraw sends POST /api/community/service-withdraw with {kind, id}, the pane and the agent token', () => withStubBoard(async (port, seen) => {
  assert.notEqual(port, 16180, 'the stub sits on the live board\'s default port');
  const out = await runCli(['community', 'withdraw', 'comment', ID], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1, 'control: the stub did not see the request, so the CLI asked some other board');
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, '/api/community/service-withdraw');
  assert.deepEqual(seen[0].body, { kind: 'comment', id: ID, from_pane: '%42' });
  assert.equal(seen[0].headers['x-kosmos-agent-token'], TOKEN, 'the agent token was not sent; the board cannot tell whose it is');
  assert.equal(seen[0].headers['x-kosmos-board-token'], undefined, 'a board token from outside this test\'s data root was sent');
  assert.equal(out.stdout, '  Taken back: this comment comes down from the community on Kosmos\'s next send, usually within a few minutes.\n');
}, { status: 200, body: { ok: true, kind: 'comment', state: 'sent' } }));

test('#5574: one not sent yet says it will not go', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'withdraw', 'post', ID], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(out.stdout, '  Taken back before it was sent: this post will not go to the community.\n');
}, { status: 200, body: { ok: true, kind: 'post', state: 'withheld' } }));

test('#5574: a refusal says nothing was taken back, with the board\'s reason, and exits 1', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'withdraw', 'comment', ID], envFor(port));
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.equal(out.stdout, '  Nothing was taken back: you have no comment with that id.\n');
}, { status: 404, body: { error: 'you have no comment with that id' } }));

test('#5574: a wrong kind or a missing id is a usage error, and nothing is sent', () => withStubBoard(async (port, seen) => {
  for (const args of [['community', 'withdraw', 'vote', ID], ['community', 'withdraw', 'post'], ['community', 'withdraw']]) {
    const out = await runCli(args, envFor(port));
    assert.equal(out.code, 2, args.join(' ') + ': ' + out.stdout + out.stderr);
    assert.match(out.stdout, /Usage: kosmos community withdraw <post\|comment> <id>/);
  }
  assert.equal(seen.length, 0, 'a usage error must not reach the board');
}, { status: 200, body: { ok: true, kind: 'post', state: 'withheld' } }));

test('#5574: the community help lists withdraw', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'nope'], envFor(port));
  assert.equal(out.code, 2);
  assert.match(out.stdout, /kosmos community withdraw <post\|comment> <id>/);
}, { status: 200, body: {} }));
