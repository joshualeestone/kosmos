'use strict';
/**
 * kosmos#2702 / #3035 (Casey + Rocky fresh-install QA, 0.6.63): a project id must be
 * looked up EXACTLY, never STRIPPED. The old `sed "s/[^A-Za-z0-9._-]//g"` made a garbled
 * id like `qakosmos663!!!` resolve to a DIFFERENT real project (`qakosmos663`) -- a privacy
 * leak in `kosmos room` (it opened a room the user did not mean to), and a typo reading as
 * "no tasks" in `kosmos task`. The fix rejects any id carrying a disallowed character with
 * exit 1 and the same sentence the board's 404 uses, in room / room reopen / task -- matching
 * cmd_post's exact-lookup behavior.
 *
 * RED-CAPABLE by construction: the stub board returns a real room / task list for ANY id it
 * is asked about, so if the CLI still STRIPPED, `qakosmos663!!!` would reach the board as
 * `qakosmos663` and exit 0. The fix rejects it CLIENT-SIDE before any request, so it exits 1
 * and the board is never hit. The valid-id control proves the reject does not over-reject.
 *
 *   node --test cli.room-idreject-2702.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const HEALTH = '<title>Kosmos</title>Agent Workforce';
const BAD = 'qakosmos663!!!';
const GOOD = 'qakosmos663';

function runCli(args, env) {
  return new Promise((resolve) => {
    execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ code: err && typeof err.code === 'number' ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/* A stub board that (a) serves the health page so healthy() passes, and (b) answers the room
   read, room reopen, and task list routes with a SUCCESS for ANY id -- so only a client-side
   reject can make a bad id fail. `hits` records every project route path that was requested,
   proving whether the bad id ever reached the board. */
function withBoard(fn) {
  const hits = [];
  const server = http.createServer((req, res) => {
    if (/^\/api\/project\/.*\/room\/reopen/.test(req.url) && req.method === 'POST') {
      hits.push(req.url); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, reopened: true })); return;
    }
    if (/^\/api\/project\/.*\/room/.test(req.url) && req.method === 'GET') {
      hits.push(req.url); res.writeHead(200, { 'content-type': 'application/json' }); res.end('the real room contents'); return;
    }
    if (/^\/api\/tasks\?project=/.test(req.url) && req.method === 'GET') {
      hits.push(req.url); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ tasks: [] })); return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(HEALTH);
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, hits); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

const envFor = (port) => ({ ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' });

test('#2702: `kosmos room <bad-id>` is REJECTED, not stripped to a real project', () =>
  withBoard(async (port, hits) => {
    const out = await runCli(['room', BAD], envFor(port));
    assert.notEqual(out.code, 0, 'a garbled id must exit non-zero, not open a real room');
    assert.match(out.stdout + out.stderr, /there is no project by that name/, 'it must say there is no such project');
    assert.doesNotMatch(out.stdout, /the real room contents/, 'PRIVACY: it must NOT return a real room for a garbled id');
    assert.equal(hits.length, 0, 'the bad id must be rejected client-side and never reach the board');
  }));

test('#2702: `kosmos room reopen <bad-id>` is REJECTED', () =>
  withBoard(async (port, hits) => {
    const out = await runCli(['room', 'reopen', BAD], envFor(port));
    assert.notEqual(out.code, 0, 'reopen of a garbled id must exit non-zero');
    assert.match(out.stdout + out.stderr, /there is no project by that name/, 'reopen must reject the bad id');
    assert.equal(hits.length, 0, 'reopen must not reach the board with a stripped id');
  }));

test('#3035: `kosmos task list <bad-id>` is REJECTED (not read as an empty project)', () =>
  withBoard(async (port, hits) => {
    const out = await runCli(['task', 'list', BAD], envFor(port));
    assert.notEqual(out.code, 0, 'task list of a garbled id must exit non-zero');
    assert.match(out.stdout + out.stderr, /there is no project by that name/, 'task must reject the bad id, not report "no tasks"');
    assert.equal(hits.length, 0, 'task must not reach the board with a stripped id');
  }));

test('CONTROL: a VALID id passes the reject and reaches the board (no over-rejection)', () =>
  withBoard(async (port, hits) => {
    const out = await runCli(['room', GOOD], envFor(port));
    assert.equal(out.code, 0, 'a valid id must NOT be rejected');
    assert.match(out.stdout, /the real room contents/, 'a valid id must read its real room');
    assert.equal(hits.length, 1, 'a valid id reaches the board exactly once');
    assert.match(hits[0], /\/api\/project\/qakosmos663\/room/, 'and it is looked up EXACTLY, unstripped');
  }));
