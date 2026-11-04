'use strict';
require('./test-support/tmpscope');   // #4273: first, so every temp dir this file makes is swept at exit.

/**
 * kosmos#7967: a `kosmos community` command that exits nonzero ends with ONE line on stderr: the first thing it said,
 * the exit code and what that code means. It never says whether anything happened (that is the line's own to say). Its words on stdout stay as they were. Before this, the
 * reason went to stdout only, so a chained health check that dropped stdout stopped with nothing shown.
 * Driven against a stub board (the #4373 tests' shape), so no real board and no network.
 *
 *   node --test cli.community-exit-reason-7967.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
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
const seen = [];
function withStubBoard(replies, fn) {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const route = (req.url || '').split('?')[0];
    const reply = replies[route];
    if (reply === 'hang') { seen.push(route); return; }
    if (reply === 'slow202') { seen.push(route); setTimeout(() => { res.writeHead(202, { 'content-type': 'application/json' }); res.end('{}'); }, 300); return; }
    if (typeof reply === 'function') { let b = ''; req.on('data', (d) => { b += d; }).on('end', () => { seen.push(route); const r = reply(b); res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.body)); }); return; }
    if (reply === 'cut') { seen.push(route); req.resume(); req.on('end', () => req.socket.destroy()); return; }
    if (reply) {
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port); } catch (e) { failure = e; }
      for (const s of sockets) s.destroy();   // a hanging route's request would hold close() for its whole timeout
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
    assert.match(out.stderr, /^kosmos community comment: .*may have been taken.*\(exit 3: it may have happened; read the line before running it again\)$/m);
  }));

test('#7967 review 6: with stderr closed, a maybe (exit 3) still exits 3, not 1', () => withStubBoard(
  { '/api/community/service-comment': { status: 500, body: { error: 'we could not submit that comment' } } },
  async (port) => {
    // A failed write to a closed stderr must not end the exit function under set -e before the real exit runs.
    const out = await run('/bin/sh', ['-c', '"$1" community comment "$2" x 2>&-', 'sh', CLI, POST], envFor(port));
    assert.equal(out.code, 3, 'exit 3 tells the agent not to send it again; ' + out.stdout);
    assert.match(out.stdout, /may have been taken/, 'premise: this was the maybe path');
  }));

test('#7967: a usage refusal (exit 2) says why on stderr', () => withStubBoard({}, async (port) => {
  const out = await run(CLI, ['community', 'read', '--channel'], envFor(port));
  assert.equal(out.code, 2, out.stdout + out.stderr);
  assert.match(out.stderr, /^kosmos community read: --channel needs a channel, like general or general\/tools\. \(exit 2: refused; the line says why\)$/m);
}));

test('#7967: the reported case: a chained check that drops stdout stops, and stderr says why', () => withStubBoard(
  { '/api/community/home': { status: 500, body: { error: 'the community is not answering' } } },
  async (port) => {
    const out = await run('/bin/sh', ['-c', '"$1" community home >/dev/null && echo NEXT-CHECK-RAN', 'sh', CLI], envFor(port));
    assert.notEqual(out.code, 0);
    assert.doesNotMatch(out.stdout, /NEXT-CHECK-RAN/, 'premise: the chain stopped at the failed command');
    assert.match(out.stderr, /kosmos community home: Nothing was read/, 'the stopped chain shows why');
  }));

test('#7967: a failure and a real read leave nothing in TMPDIR', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-community-exit-7967-tmp-'));
  await withStubBoard({ '/api/community/home': { status: 500, body: { error: 'no' } } }, async (port) => {
    const fail = await run(CLI, ['community', 'home'], envFor(port, { TMPDIR: tmp }));
    assert.equal(fail.code, 1, 'premise: this run failed');
    assert.match(fail.stderr, /kosmos community home: Nothing was read: no\./, 'premise: the line was printed');
  });
  await withStubBoard({ '/api/community/home': { status: 200, body: { ok: true, text: 'Nothing is waiting.' } } }, async (port) => {
    const ok = await run(CLI, ['community', 'home'], envFor(port, { TMPDIR: tmp }));
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  });
  assert.deepEqual(fs.readdirSync(tmp), [], 'nothing left behind in TMPDIR');
});

test('#7967 review 1: an exit 1 after a post the board may have taken never says nothing happened', () => withStubBoard(
  { '/api/community/post': 'cut' },
  async (port) => {
    const out = await run(CLI, ['community', 'post', 'hello'], envFor(port));
    assert.equal(out.code, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /^kosmos community post: .*It may still have happened.*\(exit 1: read the line before running it again\)$/m);
    assert.doesNotMatch(out.stderr, /nothing was done/i, 'the suffix must not tell an agent a maybe-sent post is safe to resend');
  }));

/* Review 5: the command runs in its own shell exactly as before #7967 (no subshell, background job or trap), so every
   signal does what it did before. These check the outcomes rounds 3 to 5 found broken: a TERM or HUP waiting for the
   request, a killed command still asking the board, and a Ctrl-C leaving the request's curl running. */
const READ_REPLIES = { '/api/community/read': 'slow202' };   // a read asks again every ~0.3 s while the board says 202
const readAsks = () => seen.filter((r) => r === '/api/community/read').length;
async function startPollingRead(port) {
  seen.length = 0;
  // exit code not read (#3628): the exit event's code and signal are asserted together as a stop by a signal, never used as a number
  const child = spawn(CLI, ['community', 'read'], { env: envFor(port, { KOSMOS_READ_ASKS: '50' }), detached: true, stdio: ['ignore', 'ignore', 'ignore'] });
  const done = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal, at: Date.now() })));
  for (let i = 0; i < 200 && readAsks() < 2; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(readAsks() >= 2, 'premise: the read was asking again');
  return { child, done };
}
const groupGone = (pid) => { try { process.kill(-pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } };

for (const [sig, group] of [['TERM', false], ['HUP', false], ['KILL', false], ['INT', true]]) {
  test('#7967 review 5: a SIG' + sig + (group ? ' to the process group (Ctrl-C)' : ' to the command') + ' stops it at once and the board is asked nothing more', () => withStubBoard(READ_REPLIES, async (port) => {
    const { child, done } = await startPollingRead(port);
    const sent = Date.now();
    process.kill(group ? -child.pid : child.pid, 'SIG' + sig);   // only the process (or group) this test started
    const end = await done;
    assert.ok(end.signal === 'SIG' + sig || end.code > 128, 'it stopped the way SIG' + sig + ' asks: ' + JSON.stringify(end));
    assert.ok(end.at - sent < 10000, 'it stopped within 10 s, not after the 30 to 60 s request (' + (end.at - sent) + ' ms)');
    const atStop = readAsks();
    await new Promise((r) => setTimeout(r, 2000));   // several more asks' worth of time
    assert.ok(readAsks() <= atStop + 1, 'the board was asked ' + (readAsks() - atStop) + ' more time(s) after it stopped (one already in flight is allowed)');
    if (group) assert.ok(groupGone(child.pid), 'after a Ctrl-C nothing of the command is left running (its request\'s curl included)');
  }));
}

/* Round 5's case: a Ctrl-C while a request hangs. A curl that ignored the interrupt (bash 3.2 cannot un-ignore SIGINT
   in a background job) would sit in the group for its whole 60 s; a polling read cannot show that (each ask ends in
   0.3 s by itself). */
test('#7967 review 5: a Ctrl-C while a request hangs leaves nothing of the command running', () => withStubBoard(
  { '/api/community/home': 'hang' },
  async (port) => {
    seen.length = 0;
    // exit code not read (#3628): the exit event's code and signal are asserted together as a stop by a signal, never used as a number
    const child = spawn(CLI, ['community', 'home'], { env: envFor(port), detached: true, stdio: ['ignore', 'ignore', 'ignore'] });
    const done = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
    for (let i = 0; i < 200 && !seen.includes('/api/community/home'); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(seen.includes('/api/community/home'), 'premise: the request is hanging on the board');
    assert.equal(groupGone(child.pid), false, 'premise: the command is running');
    process.kill(-child.pid, 'SIGINT');   // the CLI's own process group, as a terminal's Ctrl-C
    await done;
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(groupGone(child.pid), 'something of the command (its curl?) is still running after the Ctrl-C');
  }));

test('#7967 review 5: --help says nothing on stderr (its bare re-dispatch exits 2 by design)', () => withStubBoard({}, async (port) => {
  for (const args of [['community', '--help'], ['community', 'read', '--help'], ['community', 'home', '--help']]) {
    const out = await run(CLI, args, envFor(port));
    assert.equal(out.code, 0, args.join(' ') + ': ' + out.stdout + out.stderr);
    assert.equal(out.stderr, '', args.join(' ') + ' wrote to stderr: ' + JSON.stringify(out.stderr));
  }
}));

test('#7967 review 4: a post body piped on stdin still reaches the board', () => {
  const bodies = [];
  return withStubBoard(
    { '/api/community/post': (b) => { bodies.push(b); return { status: 200, body: { ok: true, status: 'published', id: 'p1' } }; } },
    async (port) => {
      const out = await new Promise((resolve, reject) => {
        const c = execFile(CLI, ['community', 'post'], { env: envFor(port), timeout: 30000 }, (err, stdout, stderr) => {
          if (err && typeof err.code !== 'number') { reject(err); return; }
          resolve({ code: err ? err.code : 0, stdout, stderr });
        });
        c.stdin.end('a body from stdin 7967');
      });
      assert.equal(bodies.length, 1, 'premise: the post was sent once: ' + out.stdout + out.stderr);
      assert.match(bodies[0], /a body from stdin 7967/, 'the piped words reached the board');
      assert.equal(out.code, 0, out.stdout + out.stderr);
    });
});

/* Review 5: the wrapper keeps the command in this shell. Read from the source, because the reason it matters (no
   signal behaves differently) is what the signal tests above check one by one. */
test('#7967 review 5: the wrapper runs the command in this shell: no subshell, background job or trap', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const open = src.indexOf('\ncmd_community_with_reason() {\n');
  assert.ok(open >= 0, 'premise: the wrapper was found');
  const body = src.slice(open + 1, src.indexOf('\n}\n', src.indexOf('builtin exit', open)) + 2);
  assert.match(body, /\n {2}cmd_community "\$@"\n\}/, 'premise: the wrapper ends by calling cmd_community directly');
  const code = body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(code, /\btrap\b/, 'a trap here holds a TERM until the request ends');
  assert.doesNotMatch(code, /\(\s*[^)]*cmd_community "\$@"/, 'a subshell keeps running after the command is killed');
  assert.doesNotMatch(code, /cmd_community "\$@"[^\n]*&\s*$/m, 'a background job cannot take a Ctrl-C on bash 3.2');
});
