'use strict';
/**
 * #6968: a board that is listening can still refuse a connection: one too busy to take new connections refuses
 * some outright (its accept queue is full; measured on macOS 2026-10-22, 40 connects at once: 3 refused, 36 timed
 * out, 1 reset), and one restarting refuses until it listens again. The CLI's health check had passed a moment
 * before, so the request's refusal (curl 7) used to end in "We could not reach Kosmos to ... Is it running?", and
 * agents concluded the board was down.
 *
 * kosmos_curl now tries a refused connection once more, a second later. These arms use a real refusal, not a curl
 * stub: the stub board answers the health check, closes its listening socket, and (refuse-once) listens again on the
 * same port 300 ms later, so the CLI's first connect for the request is refused by the kernel and its second lands.
 *   - refuse once, a read (`task list`): it succeeds, the request arrives once, and nothing says "could not reach".
 *   - CONTROL, refuse always: it fails with the new words (passing problem, nothing sent, no restart), never
 *     "Is it running?" and never "kosmos start".
 *   - refuse once, a write whose body is on stdin (`msg`): the retry sends the whole body (stdin is read once, so
 *     a retry that re-read it would send an empty body).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-6968-'));
test.after(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

function runCli(args, env) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout: 40000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '): ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '', ms: Date.now() - t0 });
    });
  });
}
function baseEnv(port, extra = {}) {
  const env = { ...process.env };
  delete env.KOSMOS_AGENT_TOKEN; delete env.KOSMOS_AGENT_SESSION; delete env.TMUX_PANE;
  // A throwaway KOSMOS_HOME and store roots, so no arm reads this machine's pidfile or board token, and a TMPDIR of
  // its own, so assertNoLeftovers can see every file kosmos_curl made.
  const home = fs.mkdtempSync(path.join(SCRATCH, 'home-'));
  const tmp = path.join(home, 'tmp');
  fs.mkdirSync(tmp);
  return {
    ...env,
    TMPDIR: tmp,
    KOSMOS_PORT: String(port), KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_HOME: home,
    AGENT_WORKFORCE_DATA: path.join(home, 'data'), AGENT_WORKFORCE_WORKERS: path.join(home, 'workers'),
    AGENT_WORKFORCE_LAUNCH: path.join(home, 'launch'), AGENT_WORKFORCE_PROJECTS: path.join(home, 'projects'),
    ...extra,
  };
}

/** The body, answer and header files kosmos_curl makes are gone once the CLI exits. */
function assertNoLeftovers(env) {
  const left = fs.readdirSync(env.TMPDIR).filter((f) => /^kosmos-(body|answer|auth)\./.test(f));
  assert.deepEqual(left, [], 'kosmos_curl left its temp files behind');
}

/** A board that answers its first health check, then stops listening; `back` ms later (null: never) it listens on
 *  the same port again. `seen` records each request after the health check, with its body. With `after503` it
 *  stays up through the health check, answers the first request 503 (it reached the board, nothing recorded) and
 *  only then stops listening. */
async function withRefusingBoard(back, fn, { after503 = false } = {}) {
  const seen = [];
  let closedOnce = false;
  let current = null;
  // An arm that fails fast ends before the re-listen; teardown cancels it, or a listener nobody closes keeps node up.
  let ended = false;
  let backTimer = null;
  // Stop listening at once: the next connect to this port is refused by the kernel.
  const stopListening = () => {
    if (closedOnce) return;
    closedOnce = true;
    const port = current.address().port;
    current.close();
    if (back !== null) {
      backTimer = setTimeout(() => {
        if (ended) return;
        current = http.createServer(handler); current.listen(port, '127.0.0.1');
      }, back);
    }
  };
  const handler = (req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (req.url.startsWith('/api/health')) {
        res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
        res.end('{"app":"kosmos","ok":true}');
        if (!after503) stopListening();
        return;
      }
      seen.push({ method: req.method, url: req.url, body });
      if (after503) { res.writeHead(503, { connection: 'close' }); res.end('busy'); stopListening(); return; }
      res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      if (req.url.startsWith('/api/tasks')) return res.end('{"tasks":[],"count":0,"project":"proj"}');
      if (req.url.startsWith('/api/msg')) return res.end('{"delivery":{"state":"placed","because":null,"id":"m1"}}');
      if (req.url.startsWith('/api/community/follow')) return res.end('{"ok":true,"text":"Now following Echo."}');
      if (/\/task\/\d+\/told/.test(req.url)) return res.end('{"task":{"n":1}}');
      return res.end('{}');
    });
  };
  current = http.createServer(handler);
  const port = await new Promise((r) => current.listen(0, '127.0.0.1', () => r(current.address().port)));
  try { return await fn(port, seen); } finally {
    ended = true;
    clearTimeout(backTimer);
    await new Promise((r) => { if (current.listening) current.close(r); else r(); });
  }
}

test('#6968: a board that refuses the request once and then accepts: `task list` succeeds, asked once more', () => withRefusingBoard(300, async (port, seen) => {
  const out = await runCli(['task', 'list', 'proj'], baseEnv(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.doesNotMatch(out.stdout + out.stderr, /could not reach|did not take the connection|Is it running|kosmos start/);
  assert.equal(seen.filter((s) => s.url.startsWith('/api/tasks')).length, 1, 'the refused try sent nothing; the retry sent it once');
  assert.ok(out.ms >= 900, `it waited about a second before trying again (took ${out.ms} ms)`);
}));

test('#6968 CONTROL: a board that never takes the connection again: the passing-problem words, never "is it running?"', () => withRefusingBoard(null, async (port, seen) => {
  const env = baseEnv(port);
  const out = await runCli(['task', 'list', 'proj'], env);
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /Kosmos did not take the connection, so we did not list tasks and nothing was sent\. This is usually a passing connection problem \(Kosmos busy for a moment, or restarting\): try again in a moment\. It does not need a restart/);
  assert.doesNotMatch(out.stdout, /Is it running|kosmos start/);
  assert.equal(seen.length, 0);
  // The words are said after a second try, not after one: the pause is in the time it took.
  assert.ok(out.ms >= 900, `it asked again a second later before saying so (took ${out.ms} ms)`);
  assertNoLeftovers(env);
}));

test('#6968: a refused write whose body is on stdin (`msg`) sends the whole body on the retry', () => withRefusingBoard(300, async (port, seen) => {
  const env = baseEnv(port, { TMUX_PANE: '%42' });
  const out = await runCli(['msg', 'mara', 'the', 'whole', 'body'], env);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  const sends = seen.filter((s) => s.method === 'POST' && s.url.startsWith('/api/msg'));
  assert.equal(sends.length, 1, JSON.stringify(seen));
  assert.match(sends[0].body, /the whole body/, 'the retry carried the body read from stdin: ' + sends[0].body);
  assertNoLeftovers(env);
}));

test('#6968: a refused call that reads its status code (-w) sees only the second try\'s (`community follow`)', () => withRefusingBoard(300, async (port, seen) => {
  // curl prints -w even on a refusal ("000"); were the first try's printed too, the answer would not parse.
  const env = baseEnv(port);
  const out = await runCli(['community', 'follow', 'Echo'], env);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Now following Echo\./);
  assert.equal(seen.filter((s) => s.url.startsWith('/api/community/follow')).length, 1);
  assertNoLeftovers(env);
}));

test('#6968: the edit hook\'s keep-copy is not asked again (it promises a short wait), on a port nothing holds', async () => {
  const probe = http.createServer();
  const port = await new Promise((r) => probe.listen(0, '127.0.0.1', () => r(probe.address().port)));
  await new Promise((r) => probe.close(r));
  // A five-second pause, so "no pause" and "paused" are far apart even on a loaded machine.
  const env = baseEnv(port, { KOSMOS_REFUSED_RETRY_MS: '5000' });
  const out = await runCli(['keep-copy', path.join(SCRATCH, 'some-file.txt')], env);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.ok(out.ms < 4000, `keep-copy did not pause for a second try (took ${out.ms} ms)`);
  assertNoLeftovers(env);
});

test('#6968: `task told` keeps kosmos_curl\'s retry (only `ran` asks again on its own): refused once, then recorded', () => withRefusingBoard(300, async (port, seen) => {
  const env = baseEnv(port, { TMUX_PANE: '%42' });
  const out = await runCli(['task', 'told', 'proj', '1', 'it is done'], env);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Recorded what the person was told about task 1/);
  assert.equal(seen.filter((s) => /\/task\/1\/told/.test(s.url)).length, 1);
}));

test('#6968: `task ran` answered 503 and then refused: not recorded, and never "nothing was sent"', () => withRefusingBoard(null, async (port, seen) => {
  const env = baseEnv(port, { TMUX_PANE: '%42', KOSMOS_RETRY_PAUSE_MS: '50' });
  const out = await runCli(['task', 'ran', 'proj', '1', 'found nothing'], env);
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.equal(seen.filter((s) => /\/task\/1\/ran/.test(s.url)).length, 1, 'the 503 reached the board; the retries were refused');
  assert.match(out.stdout, /Kosmos was busy and then did not take the connection, so that run was not recorded\. Try again in a moment; it does not need a restart\./);
  assert.doesNotMatch(out.stdout, /nothing was sent|Is it running|kosmos start/);
}, { after503: true }));
