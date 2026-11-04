'use strict';
require('./test-support/tmpscope');   // #4273: first, so every temp dir this file makes is swept at exit.

/**
 * kosmos#7967: a `kosmos community` command that exits nonzero ends with ONE line on stderr: the first thing it said,
 * the exit code and what that code means for running it again. Its words on stdout stay as they were. Before this, the
 * reason went to stdout only, so a chained health check that dropped stdout stopped with nothing shown.
 * Driven against a stub board (the #4373 tests' shape), so no real board and no network.
 *
 *   node --test cli.community-exit-reason-7967.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-community-exit-7967-'));
const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'cd'.repeat(16);
const POST = '1b2c3d4e-0000-4000-8000-000000000001';

function envFor(port, extra = {}) {
  return { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: TOKEN, ...extra };
}

function run(file, args, env) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
    child.stdin.end('');
  });
}

/* A board that answers the community routes with `replies[route]` and the health check with its page. */
function withStubBoard(replies, fn) {
  const server = http.createServer((req, res) => {
    const route = (req.url || '').split('?')[0];
    const reply = replies[route];
    if (reply) {
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
      try { await fn(server.address().port); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

const lines = (s) => s.split('\n').filter((l) => l !== '');

test('#7967: a failed home read says why on stderr, in one line, and keeps its stdout and exit code', () => withStubBoard(
  { '/api/community/home': { status: 500, body: { error: 'the community is not answering' } } },
  async (port) => {
    const out = await run(CLI, ['community', 'home'], envFor(port));
    assert.equal(out.code, 1, out.stdout + out.stderr);
    assert.match(out.stdout, /Nothing was read: the community is not answering\./, 'stdout keeps the words a person reads');
    assert.equal(lines(out.stderr).length, 1, 'exactly one line on stderr: ' + JSON.stringify(out.stderr));
    assert.match(out.stderr, /^kosmos community home: Nothing was read: the community is not answering\. \(exit 1: /);
  }));

test('#7967: a home read that works prints nothing on stderr', () => withStubBoard(
  { '/api/community/home': { status: 200, body: { ok: true, text: 'Nothing is waiting for you.' } } },
  async (port) => {
    const out = await run(CLI, ['community', 'home'], envFor(port));
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /Nothing is waiting for you\./);
    assert.equal(out.stderr, '');
  }));

test('#7967: a maybe (exit 3) says on stderr to check before sending again', () => withStubBoard(
  { '/api/community/service-comment': { status: 500, body: { error: 'we could not submit that comment' } } },
  async (port) => {
    const out = await run(CLI, ['community', 'comment', POST, 'x'], envFor(port));
    assert.equal(out.code, 3, out.stdout + out.stderr);
    assert.equal(lines(out.stderr).length, 1, JSON.stringify(out.stderr));
    assert.match(out.stderr, /^kosmos community comment: .*may have been taken.*\(exit 3: it may have happened: check with kosmos community status before running it again\)$/m);
  }));

test('#7967: a usage refusal (exit 2) says on stderr that running it again as written will not help', () => withStubBoard({}, async (port) => {
  const out = await run(CLI, ['community', 'read', '--channel'], envFor(port));
  assert.equal(out.code, 2, out.stdout + out.stderr);
  assert.match(out.stderr, /^kosmos community read: --channel needs a channel, like general or general\/tools\. \(exit 2: nothing was done; running it again as written gives the same answer\)$/m);
}));

test('#7967: the reported case: a chained check that drops stdout stops, and stderr says why', () => withStubBoard(
  { '/api/community/home': { status: 500, body: { error: 'the community is not answering' } } },
  async (port) => {
    const out = await run('/bin/sh', ['-c', '"$1" community home >/dev/null && echo NEXT-CHECK-RAN', 'sh', CLI], envFor(port));
    assert.notEqual(out.code, 0);
    assert.doesNotMatch(out.stdout, /NEXT-CHECK-RAN/, 'premise: the chain stopped at the failed command');
    assert.match(out.stderr, /kosmos community home: Nothing was read/, 'the stopped chain shows why');
  }));

test('#7967: the line the CLI kept to repeat is removed afterwards, on failure and on success', () => withStubBoard(
  { '/api/community/home': { status: 500, body: { error: 'no' } } },
  async (port) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-community-exit-7967-tmp-'));
    const fail = await run(CLI, ['community', 'home'], envFor(port, { TMPDIR: tmp }));
    assert.equal(fail.code, 1, 'premise: this run failed');
    assert.match(fail.stderr, /kosmos community home: Nothing was read: no\./, 'premise: the kept line was used, so it was made in TMPDIR');
    const ok = await run(CLI, ['community', 'read', '--help'], envFor(port, { TMPDIR: tmp }));
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    assert.deepEqual(fs.readdirSync(tmp), [], 'nothing left behind in TMPDIR');
  }));
