'use strict';
/**
 * #6968: a board that is listening can still refuse a connection: one too busy to take new connections refuses
 * some outright (its accept queue is full; measured on macOS 2026-10-22, 40 connects at once: 3 refused, 36 timed
 * out, 1 reset), and one restarting refuses until it listens again. The CLI's health check had passed a moment
 * before, so the request's refusal (curl 7) used to end in "We could not reach Kosmos to ... Is it running?", and
 * agents concluded the board was down.
 *
 * kosmos_curl now tries a refused connection once more, a second later. The refusals here are real, not a curl stub:
 * the stub board answers the health check, closes its listening socket, and (refuse-once) listens again on the same
 * port 600 ms later, inside the CLI's one-second pause. A curl on PATH that logs each request and then runs the real
 * curl counts the tries, so an arm cannot pass without the refusal it is about (a first try that landed after the
 * board was back would count 1, and fail).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
// The CLI's own lsof paths (_lsof_cmd): without one it cannot tell a stopped board from a busy one.
const HAS_LSOF = ['/usr/sbin/lsof', '/usr/bin/lsof'].some((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-6968-'));
test.after(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

// The counting curl. The health check calls /usr/bin/curl by its path, so only kosmos_curl's requests reach it.
const SHIM_DIR = path.join(SCRATCH, 'bin');
fs.mkdirSync(SHIM_DIR);
fs.writeFileSync(path.join(SHIM_DIR, 'curl'), [
  '#!/bin/sh',
  'for a in "$@"; do case "$a" in http://*) printf \'%s\\n\' "$a" >> "$KOSMOS_TEST_CURL_LOG"; [ -n "$KOSMOS_TEST_CURL_REFUSE" ] && exit 7 ;; esac; done',
  'exec /usr/bin/curl "$@"',
  '',
].join('\n'), { mode: 0o755 });

function runCli(args, env, input) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const child = execFile(CLI, args, { env, timeout: 40000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '): ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '', ms: Date.now() - t0 });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}
function baseEnv(port, extra = {}) {
  // A throwaway KOSMOS_HOME and store roots, so no arm reads this machine's pidfile or board token (#4796: named in
  // the same environment that copies the parent's), and a TMPDIR of its own, so assertNoLeftovers can see every
  // file kosmos_curl made.
  const home = fs.mkdtempSync(path.join(SCRATCH, 'home-'));
  const env = { ...process.env, AGENT_WORKFORCE_DATA: path.join(home, 'data') };
  delete env.KOSMOS_AGENT_TOKEN; delete env.KOSMOS_AGENT_SESSION; delete env.TMUX_PANE;
  const tmp = path.join(home, 'tmp');
  fs.mkdirSync(tmp);
  return {
    ...env,
    PATH: SHIM_DIR + path.delimiter + (env.PATH || ''),
    KOSMOS_TEST_CURL_LOG: path.join(home, 'curl.log'),
    TMPDIR: tmp,
    KOSMOS_PORT: String(port), KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_HOME: home,
    AGENT_WORKFORCE_DATA: path.join(home, 'data'), AGENT_WORKFORCE_WORKERS: path.join(home, 'workers'),
    AGENT_WORKFORCE_LAUNCH: path.join(home, 'launch'), AGENT_WORKFORCE_PROJECTS: path.join(home, 'projects'),
    ...extra,
  };
}
/** How many times the CLI's curl asked for a URL matching `re`. */
function tries(env, re) {
  let log = '';
  try { log = fs.readFileSync(env.KOSMOS_TEST_CURL_LOG, 'utf8'); } catch { /* no request at all */ }
  return log.split('\n').filter((l) => re.test(l)).length;
}
/** The body, answer and header files kosmos_curl makes are gone once the CLI exits. */
function assertNoLeftovers(env) {
  const left = fs.readdirSync(env.TMPDIR).filter((f) => /^kosmos-(body|answer|auth)\./.test(f));
  assert.deepEqual(left, [], 'kosmos_curl left its temp files behind');
}
async function closedPort() {
  const probe = http.createServer();
  const port = await new Promise((r) => probe.listen(0, '127.0.0.1', () => r(probe.address().port)));
  await new Promise((r) => probe.close(r));
  return port;
}

/** A board that answers its first health check, then stops listening; `back` ms later (null: never) it listens on
 *  the same port again. `seen` records each request after the health check, with its body. With `after503` it
 *  stays up through the health check, answers the first request 503 (it reached the board, nothing recorded) and
 *  only then stops listening. With `cutFirstPost` it cuts the first request's reply, then stops listening. */
async function withRefusingBoard(back, fn, { after503 = false, cutFirstPost = false } = {}) {
  const seen = [];
  let closedOnce = false;
  let current = null;
  // An arm that fails fast ends before the re-listen; teardown cancels it, or a listener nobody closes keeps node up.
  let ended = false;
  let backTimer = null;
  let relistenError = null;
  // Stop listening at once: the next connect to this port is refused by the kernel.
  const stopListening = () => {
    if (closedOnce) return;
    closedOnce = true;
    const port = current.address().port;
    current.close();
    if (back !== null) {
      backTimer = setTimeout(() => {
        if (ended) return;
        current = http.createServer(handler);
        current.on('error', (e) => { relistenError = e; });   // the port taken meanwhile: the arm fails on it, the process does not crash
        current.listen(port, '127.0.0.1');
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
        if (!after503 && !cutFirstPost) stopListening();
        return;
      }
      seen.push({ method: req.method, url: req.url, body });
      if (cutFirstPost && !closedOnce) { req.socket.destroy(); stopListening(); return; }   // the send's reply is cut, then the board restarts
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
  try { const r = await fn(port, seen); if (relistenError) throw relistenError; return r; } finally {
    ended = true;
    clearTimeout(backTimer);
    await new Promise((r) => { if (current.listening) current.close(r); else r(); });
  }
}

test('#6968: a board that refuses the request once and then accepts: `task list` succeeds, asked once more', () => withRefusingBoard(600, async (port, seen) => {
  const env = baseEnv(port);
  const out = await runCli(['task', 'list', 'proj'], env);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.doesNotMatch(out.stdout + out.stderr, /could not reach|did not take the connection|Is it running|kosmos start/);
  assert.equal(tries(env, /\/api\/tasks/), 2, 'refused, then asked once more');
  assert.equal(seen.filter((s) => s.url.startsWith('/api/tasks')).length, 1, 'the refused try sent nothing; the retry sent it once');
  assertNoLeftovers(env);
}));

test('#6968 CONTROL: a board that stopped listening and never came back: "could not see anything listening", never "is it running?" or "start it"', { skip: !HAS_LSOF && 'needs lsof, which the CLI asks whether anything listens' }, () => withRefusingBoard(null, async (port, seen) => {
  const env = baseEnv(port);
  const out = await runCli(['task', 'list', 'proj'], env);
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /Kosmos did not take the connection and we could not see anything listening at http:\/\/127\.0\.0\.1:\d+, so we did not list tasks and nothing was sent\. If Kosmos is restarting, try again in a moment; kosmos status says whether it is running\./);
  assert.doesNotMatch(out.stdout, /Is it running|kosmos start|passing connection problem/);
  assert.equal(seen.length, 0);
  assert.equal(tries(env, /\/api\/tasks/), 2, 'the words come after a second try, not after one');
  assertNoLeftovers(env);
}));

test('#6968 CONTROL: a board still listening that refuses every try (too busy): the passing-problem words', async () => {
  // The counting curl answers 7 for the request without connecting, and this board never stops listening, so lsof
  // sees its listener the whole time (a refusal from a full accept queue cannot be made on demand).
  const seen = [];
  const board = http.createServer((req, res) => {
    if (!req.url.startsWith('/api/health')) seen.push(req.url);
    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
    res.end('{"app":"kosmos","ok":true}');
  });
  const port = await new Promise((r) => board.listen(0, '127.0.0.1', () => r(board.address().port)));
  try {
    const env = baseEnv(port, { KOSMOS_TEST_CURL_REFUSE: '1' });
    const out = await runCli(['task', 'list', 'proj'], env);
    assert.equal(out.code, 1, out.stdout + out.stderr);
    assert.match(out.stdout, /Kosmos did not take the connection, so we did not list tasks and nothing was sent\. This is usually a passing connection problem \(Kosmos busy for a moment, or restarting\): try again in a moment\. It does not need a restart/);
    assert.doesNotMatch(out.stdout, /Is it running|kosmos start|could not see anything listening/);
    assert.deepEqual(seen, []);
    assert.equal(tries(env, /\/api\/tasks/), 2);
    assertNoLeftovers(env);
  } finally { await new Promise((r) => board.close(r)); }
});

test('#6968: a refused write whose body is on stdin (`msg`) sends the whole body on the retry', () => withRefusingBoard(600, async (port, seen) => {
  const env = baseEnv(port, { TMUX_PANE: '%42' });
  const out = await runCli(['msg', 'mara', 'the', 'whole', 'body'], env);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(tries(env, /\/api\/msg/), 2);
  const sends = seen.filter((s) => s.method === 'POST' && s.url.startsWith('/api/msg'));
  assert.equal(sends.length, 1, JSON.stringify(seen));
  assert.match(sends[0].body, /the whole body/, 'the retry carried the body read from stdin: ' + sends[0].body);
  assertNoLeftovers(env);
}));

test('#6968: a refused call that reads its status code (-w) sees only the second try\'s (`community follow`)', () => withRefusingBoard(600, async (port, seen) => {
  // curl prints -w even on a refusal ("000"); were the first try's printed too, the answer would not parse.
  const env = baseEnv(port);
  const out = await runCli(['community', 'follow', 'Echo'], env);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Now following Echo\./);
  assert.equal(tries(env, /\/api\/community\/follow/), 2);
  assert.equal(seen.filter((s) => s.url.startsWith('/api/community/follow')).length, 1);
  assertNoLeftovers(env);
}));

test('#6968: `task told` keeps kosmos_curl\'s retry (only `ran` asks again on its own): refused once, then recorded', () => withRefusingBoard(600, async (port, seen) => {
  const env = baseEnv(port, { TMUX_PANE: '%42' });
  const out = await runCli(['task', 'told', 'proj', '1', 'it is done'], env);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Recorded what the person was told about task 1/);
  assert.equal(tries(env, /\/task\/1\/told/), 2);
  assert.equal(seen.filter((s) => /\/task\/1\/told/.test(s.url)).length, 1);
  assertNoLeftovers(env);
}));

test('#6968: the edit hook\'s keep-copy and tool-failed are one try each (they promise a short wait)', async () => {
  // A port nothing holds: refused at once. With -m 3 and the default pause a second try would still fit, so
  // without _KOSMOS_CURL_ONCE each would be asked twice.
  const port = await closedPort();
  const kc = baseEnv(port);
  const a = await runCli(['keep-copy', path.join(SCRATCH, 'some-file.txt')], kc);
  assert.equal(a.code, 0, a.stdout + a.stderr);
  assert.equal(tries(kc, /\/api\/undo\/keep/), 1);
  const tf = baseEnv(port);
  const b = await runCli(['tool-failed', 'Edit', 'abc123'], tf, 'the tool failed');
  assert.equal(b.code, 0, b.stdout + b.stderr);
  assert.equal(tries(tf, /\/api\/toolfail/), 1);
});

test('#6968: `task ran` answered 503 and then refused: not recorded, never "nothing was sent", and its own loop does the asking', () => withRefusingBoard(null, async (port, seen) => {
  const env = baseEnv(port, { TMUX_PANE: '%42', KOSMOS_RETRY_PAUSE_MS: '50' });
  const out = await runCli(['task', 'ran', 'proj', '1', 'found nothing'], env);
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.equal(seen.filter((s) => /\/task\/1\/ran/.test(s.url)).length, 1, 'the 503 reached the board; the retries were refused');
  // ran's loop asks three times; were kosmos_curl to ask again inside each refused one, it would be five.
  assert.equal(tries(env, /\/task\/1\/ran/), 3);
  assert.match(out.stdout, /Kosmos was busy and then did not take the connection, so that run was not recorded\. Try again in a moment; it does not need a restart\./);
  assert.doesNotMatch(out.stdout, /nothing was sent|Is it running|kosmos start/);
}, { after503: true }));

test('#6968: msg\'s second ask after a cut reply is one plain try: a board that restarts meanwhile gets the message once', () => withRefusingBoard(2500, async (port, seen) => {
  // The first send's reply is cut (it may have landed), then the board restarts and is back 2.5 s later. msg asks once
  // more after 1 s, which is refused; kosmos_curl would ask again 3 s after that, into the restarted board.
  const env = baseEnv(port, { TMUX_PANE: '%42', KOSMOS_REFUSED_RETRY_MS: '3000' });
  const out = await runCli(['msg', 'mara', 'only', 'once'], env);
  assert.notEqual(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /It may still have happened: check before doing it again/);
  assert.equal(tries(env, /\/api\/msg/), 2, 'the send and msg\'s own second ask, and no third');
  assert.equal(seen.filter((s) => s.method === 'POST' && s.url.startsWith('/api/msg')).length, 1, JSON.stringify(seen));
}, { cutFirstPost: true }));

test('#6968: an interrupt during the pause leaves none of kosmos_curl\'s files behind (the body is the agent\'s words)', () => withRefusingBoard(null, async (port) => {
  const env = baseEnv(port, { TMUX_PANE: '%42', KOSMOS_REFUSED_RETRY_MS: '5000' });
  // Its own process group, so the interrupt reaches the whole command, as Ctrl-C at a terminal does.
  const child = spawn(CLI, ['msg', 'mara', 'private', 'words'], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let said = '';
  child.stdout.on('data', (d) => { said += d; });
  child.stderr.on('data', (d) => { said += d; });
  const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
  const t0 = Date.now();
  while (tries(env, /\/api\/msg/) < 1 && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 50));
  assert.equal(tries(env, /\/api\/msg/), 1, 'the first try was made and refused');
  await new Promise((r) => setTimeout(r, 300));   // into the five-second pause
  process.kill(-child.pid, 'SIGINT');
  const end = await exited;
  // The command ends as an interrupted command does (the trap re-raises the signal): it never carries on to say
  // "stopped before anything was sent", which a send the board may hold must not hear.
  assert.equal(end.signal, 'SIGINT', JSON.stringify(end) + ' ' + said);
  assert.doesNotMatch(said, /Stopped before anything was sent|nothing was sent/);
  // The subshell's trap removes the files a moment after the main shell has died.
  const t1 = Date.now();
  while (fs.readdirSync(env.TMPDIR).some((f) => /^kosmos-(body|answer)\./.test(f)) && Date.now() - t1 < 3000) await new Promise((r) => setTimeout(r, 50));
  assertNoLeftovers(env);
}));

test('#6968: every call of kosmos_curl that can buffer runs in a subshell, so its trap replaces no caller\'s', () => {
  const src = fs.readFileSync(CLI, 'utf8').split('\n');
  const calls = src.map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => /(^|[\s|(])(_KOSMOS_CURL_ONCE=\S+ )?kosmos_curl "/.test(l) && !/^\s*#/.test(l));
  assert.ok(calls.length > 40, 'the scan found the calls (' + calls.length + ')');
  const bad = calls.filter(({ l }) => !(
    /\$\((_KOSMOS_CURL_ONCE=\S+ )?kosmos_curl "/.test(l)   // $(...)
    || /(^|[^|])\|\s*(_KOSMOS_CURL_ONCE=\S+ )?kosmos_curl "/.test(l)   // a pipe, not a ||
    || /_KOSMOS_CURL_ONCE=1 kosmos_curl "/.test(l)   // one plain try, no trap
    || /[^&]&\s*$/.test(l)));   // a background job (connect), not a trailing &&
  assert.deepEqual(bad.map(({ n, l }) => n + ': ' + l.trim().slice(0, 100)), []);
});
