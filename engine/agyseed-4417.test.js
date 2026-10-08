'use strict';
/**
 * #4417 (from #4414, Josh 2026-09-28 15:15: one Gemini agent "didn't update its status indicator", even after
 * a restart): agy has no session-start hook, only PreInvocation (working) and Stop (idle), so an Antigravity
 * agent just (re)started and not yet spoken to sent the board nothing and read "Can't tell" until its first
 * message. The supervisor now sends one idle report the moment the pane is up, through the same bridge.
 *
 * The bridge half is RUN here against a local stand-in board (the report it sends is the product). The
 * supervisor half is RUN in supervisor.agyseed-4417.test.js (a fake tmux and a fake agy); this file also pins its
 * shape in source.
 *
 *   node --test engine/agyseed-4417.test.js
 */
/* FIRST, for its side effect: the bridge this test runs writes its throttle marker under os.tmpdir(), and the child
   inherits TMPDIR, so the marker lands in this process's own temp dir and goes with it (the #4273 leak gate). */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BRIDGE_FILE = path.join(__dirname, '..', 'bin', 'agy-report-bridge.js');
const bridge = require(BRIDGE_FILE);

function standInBoard() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ url: req.url, method: req.method, headers: req.headers, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })));
}

/* #5560: one run of the bridge, and everything about how it ended. On a loaded CI runner (GitHub-hosted; the same run
   logged EAGAIN from another test) the failing run's child ended with code null after 56 ms: a SIGNAL ended it (a
   refused start gives an `error` and a negative code instead, measured on node 26). The old helper heard neither. */
function runOnce(event, env, spawnFn = spawn) {
  return new Promise((resolve) => {
    let child;
    try { child = spawnFn(process.execPath, [BRIDGE_FILE, event], { env, stdio: ['ignore', 'pipe', 'pipe'] }); }   // </dev/null, as the supervisor runs it
    catch (err) { resolve({ code: null, signal: null, error: String(err && err.code || err), out: '', err: '' }); return; }
    let out = '';
    let errText = '';
    let spawnError = null;
    let hung = null;
    /* The error listener goes on FIRST (review 5): a spawn refused for lack of file handles (EMFILE, ENFILE) returns
       before stdio exists, so `child.stdout` is undefined and `close` may never come. That try ends on its error at
       once and is reported, rather than throwing on stdout or waiting out the 10 s. */
    child.on('error', (e) => {
      spawnError = String((e && e.code) || e);
      if (!child.stdout || !child.stderr) { if (hung) clearTimeout(hung); resolve({ code: null, signal: null, error: spawnError, out, err: errText }); }
    });
    if (child.stdout) child.stdout.on('data', (d) => { out += d; });
    if (child.stderr) child.stderr.on('data', (d) => { errText += d; });
    /* A try that has not closed in 10 s is ended and reported as a hang (`signal: 'timeout'`, never retried). */
    hung = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } resolve({ code: null, signal: 'timeout', error: spawnError, out, err: errText }); }, 10000);
    child.on('close', (code, signal) => { clearTimeout(hung); resolve({ code, signal, error: spawnError, out, err: errText }); });
  });
}
/* Only a try the RUNNER ended is tried again, up to three times with a short wait: a refused start (a spawn error)
   or a kill from outside (SIGKILL, SIGTERM). A child that exited with a code, crashed on its own (SIGABRT, SIGSEGV) or
   hung past 10 s is the bridge's failure and is never retried, so a bridge that really fails still fails here. */
const RUNNER_SIGNALS = new Set(['SIGKILL', 'SIGTERM']);
/* Node's OWN startup failing for lack of threads or processes aborts the child (SIGABRT) with a CHECK or a thread
   create error on stderr (review 3: the likeliest cause of a 56 ms death on a runner logging EAGAIN). Only that abort
   is the runner's; any other SIGABRT is the bridge's. The set is a reasoned guess: what this change surely adds is the
   signal and stderr in the message, so the next red names its cause. */
/* uv_thread_create and pthread_create are the arms that catch Node's own startup abort; `Check failed:` is V8's fatal
   line (Node's own CHECKs print "Assertion ... failed" instead). Never a bare EAGAIN (review 5). A hang is never
   retried, even with a spawn error beside it (review 7). */
/* libuv's own `uv__close` assertion (fd > STDERR_FILENO) is in this set too: seen on CI 2026-10-08 as a 70 ms SIGABRT of
   this child at load 25 on 3 cores, never reproduced locally in 1,200 runs, and process.stdin.destroy() measured NOT to
   close fd 0 (review 9). The cause is unknown and tracked on #5576; it is retried as Node's runtime aborting,
   and every try still names it in the message. 🛑 TEMPORARY: remove the uv__close arm when #5576 finds the cause. */
const STARTUP_ABORT = /uv_thread_create|pthread_create|Check failed:|function uv__close, file core\.c/;
const RUNNER_SPAWN_ERRORS = new Set(['EAGAIN', 'EMFILE', 'ENFILE', 'ENOMEM']);   // short of resources; never ENOENT/EACCES (review 4)
const endedByRunner = (r) => r.signal !== 'timeout' && (RUNNER_SPAWN_ERRORS.has(r.error) || (r.code === null && (RUNNER_SIGNALS.has(r.signal)
  || (r.signal === 'SIGABRT' && STARTUP_ABORT.test(String(r.err || ''))))));
async function runBridge(event, env, run = runOnce, wait = (ms) => new Promise((res) => setTimeout(res, ms))) {
  const tries = [];
  for (let i = 0; i < 3; i += 1) {
    const r = await run(event, env);
    tries.push(r);
    if (!endedByRunner(r)) return { ...r, tries };
    if (i < 2) await wait(200 * (i + 1));
  }
  return { ...tries[tries.length - 1], tries };
}
const howItEnded = (r) => JSON.stringify((r.tries || [r]).map((x) => ({ code: x.code, signal: x.signal, error: x.error, stderr: String(x.err || '').slice(0, 600) })));

test('#4417: the launch event reports idle from the new pane, with its launch token', async (t) => {
  const board = await standInBoard();
  const pane = '%seed-' + process.pid;
  /* An empty store root, so the child finds no board token of this Mac's to send to the stand-in (review 1). */
  const data = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'aw-agyseed-data-'));
  const env = { ...process.env, AGENT_WORKFORCE_DATA: data, KOSMOS_PORT: String(board.port), TMUX_PANE: pane, KOSMOS_AGENT_TOKEN: 'abc123' };
  try {
    /* Each try carries its own launch token, and only the LAST try's reports count: a try the runner killed after its
       report left would otherwise read as a double report, even one the stand-in records after the retry began
       (reviews 6 and 7). The count of 1 below still catches a bridge that reports twice in one run. */
    let tryNo = 0;
    const r = await runBridge(bridge.LAUNCH_EVENT, env, (e, v) => { tryNo += 1; return runOnce(e, { ...v, KOSMOS_AGENT_TOKEN: 'abc123' + tryNo }); });
    const token = 'abc123' + tryNo;   // hex only: the bridge sends no other token
    // A retry that rescued the run is printed, so how often the runner kills a child can be counted, not hidden.
    if (r.tries.length > 1) t.diagnostic('#5560: the bridge child was retried: ' + howItEnded(r));
    assert.equal(r.code, 0, 'the bridge did not exit 0: ' + howItEnded(r));
    const reports = board.seen.filter((x) => x.url === '/api/report' && x.headers['x-kosmos-agent-token'] === token);
    // CONTROL: a report under no try's token would be a bug in the stand-in or the bridge, not a retry.
    assert.equal(board.seen.filter((x) => x.url === '/api/report' && !/^abc123[0-9]+$/.test(String(x.headers['x-kosmos-agent-token']))).length, 0, 'a report arrived under a token no try sent');
    assert.equal(reports.length, 1, reports.length === 0
      ? 'a launched agy agent told the board nothing, so it reads "Can\'t tell" until its first turn: ' + howItEnded(r)
      : 'the board got ' + reports.length + ' launch reports from one run: ' + howItEnded(r));
    const body = JSON.parse(reports[0].body);
    assert.equal(body.state, 'idle');
    assert.equal(body.auto, true, 'a launch report without auto could erase a blocked the agent filed');
    assert.equal(body.from_pane, pane, 'the report is not identified as the new pane');
    assert.equal(reports[0].headers['x-kosmos-agent-token'], token, 'the launch token did not travel, so an enforcing board refuses it');
    assert.equal(reports[0].headers['x-kosmos-board-token'], undefined, 'the test sent this Mac\'s real board token');
  } finally {
    try { fs.rmSync(bridge.markerFile(env), { force: true }); } catch { /* none */ }
    board.server.close();
  }
});

test('#4417: agy\'s own hook map is unchanged: the launch event is Kosmos\'s, and agy never fires it', () => {
  assert.equal(bridge.LAUNCH_EVENT, 'KosmosLaunch');
  assert.deepEqual(Object.keys(bridge.STATE_FOR_EVENT).sort(), ['PostToolUse', 'PreInvocation', 'PreToolUse', 'Stop']);
  assert.deepEqual(bridge.reportFor('KosmosLaunch', null), { state: 'idle', text: '' });
  assert.equal(bridge.reportFor('SessionStart', null), null, 'control: an event nobody wired is still ignored, not guessed at');
});

test('#4417: the supervisor seeds idle AFTER claiming the session, only for an agy it launched with the hook on, the folder trusted and a confirmed sign-in (SOURCE pin)', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'bin', 'agent-supervisor.sh'), 'utf8');
  const at = sh.indexOf('elif [ "$RUNNER" = antigravity ]; then');
  assert.ok(at > -1, 'the antigravity branch moved: re-anchor this pin');
  const end = sh.indexOf('elif [ "$RUNNER" = muse ]; then', at);
  assert.ok(end > at, 'the branch after antigravity moved: re-anchor this pin');
  const arm = sh.slice(at, end);
  /* The launch arm produces the three values and the pane id; nothing in it reports. */
  assert.match(arm, /_AGY_TRUSTED="\$\("\$NODE_BIN" "\$_eng\/agytrust\.js" "\$WORKDIR" \|\| true\)"/);
  assert.match(arm, /_AGY_PANE="\$\("\$TMUX_BIN" new-session -d -s "\$SESSION" -P -F '#\{pane_id\}' -c "\$WORKDIR"/,
    'the pane id is not taken from new-session itself (a lookup by name can resolve another agent\'s session)');
  const reset = sh.indexOf('_AGY_TRUSTED=""; _AGY_HOOKED=""; _AGY_PANE=""; _AGY_BRIDGE=""');
  assert.ok(reset > -1 && reset < sh.indexOf('\nadopt='), 'the gate values are not reset before any path runs, so an inherited value could pass the gate on the adopt path');
  assert.ok(!arm.includes('KosmosLaunch'), 'the seed is inside the launch arm again, BEFORE the session is claimed: the board drops it');
  /* The seed itself: after the claim, because the board ties a report to an agent only through @kosmos_agent. */
  const claim = sh.indexOf('"$TMUX_BIN" set-option -t "$SESSION" @kosmos_agent "$SESSION"');
  const runner = sh.indexOf('"$TMUX_BIN" set-option -t "$SESSION" @kosmos_runner "$RUNNER"');
  const seed = sh.indexOf('"$NODE_BIN" "$_AGY_BRIDGE" KosmosLaunch </dev/null >/dev/null 2>&1');
  assert.ok(claim > -1 && runner > -1 && seed > -1, 'the claim, the runner record or the seed is gone: re-anchor this pin');
  assert.ok(seed > claim && seed > runner, 'the seed is sent before the session is claimed, so the board cannot tie it to the agent');
  const gateAt = sh.lastIndexOf('if [ "$RUNNER" = antigravity ]', seed);
  assert.ok(gateAt > runner, 'the seed is not inside its own gate after the claim');
  const gate = sh.slice(gateAt, seed);
  assert.match(gate, /\[ "\$\{_AGY_HOOKED:-\}" = hooked \] && \[ "\$\{_AGY_TRUSTED:-\}" = trusted \] && \[ -n "\$\{_AGY_PANE:-\}" \]; then/,
    'the seed is sent with no hook in place, or while agy asks to trust the folder: an idle that never decays');
  assert.match(gate, /require\(process\.argv\[1\] \+ "\/agystatus"\)\.lastKnown\(\); if \(r && r\.signedIn === true\)/, 'the seed is sent for an agy never signed in on this Mac');
  assert.match(gate, /if \[ "\$_AGY_SIGNED" = signed-in \]; then/);
  // #4491 slice 9: the pane's empty KOSMOS_AGENT_TOKEN_ONLY pin is skipped (the seed is handed this launch's own value
  // after the list), so the one arm that keeps anything is still exactly the three the bridge reads.
  assert.match(gate, /case "\$_x" in\s+KOSMOS_AGENT_TOKEN_ONLY=\*\) ;;[^\n]*\n\s+KOSMOS_\*=\*\|AGENT_WORKFORCE_\*=\*\|HOME=\*\) _AGY_SEED_ENV\+=\("\$_x"\) ;;\s+esac/,
    'the seed adds more of the pane\'s env list than the bridge reads (the list also carries API keys)');
  assert.equal((gate.match(/_AGY_SEED_ENV\+=/g) || []).length, 1, 'a second arm adds to the seed env');
  assert.match(gate, /KOSMOS_AGENT_TOKEN_ONLY="\$\{_LAUNCH_TOKEN_ONLY:-\}" TMUX_PANE="\$_AGY_PANE"/, 'the seed does not carry this launch\'s own token-only switch');
  assert.ok(sh.indexOf('unset _AGY_BRIDGE') > seed, 'the bridge path is unset before the seed can use it');
});

test('#4417: agyhooks says `hooked` only for a hook in place and on; a git project or the person\'s off switch says nothing', () => {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  const hooks = require('./agyhooks');
  const run = (dir) => spawnSync(process.execPath, [path.join(__dirname, 'agyhooks.js'), dir, '/opt/node', '/b.js', '1.2.12'], { encoding: 'utf8' });
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agyseed-plain-'));
  assert.equal(run(plain).stdout.trim(), 'hooked', 'control: a plain folder gets the hook and says so');
  const f = path.join(plain, '.agents', 'hooks.json');
  const h = JSON.parse(fs.readFileSync(f, 'utf8'));
  h[hooks.HOOK_NAME].enabled = false;
  fs.writeFileSync(f, JSON.stringify(h));
  assert.equal(run(plain).stdout.trim(), '', 'the person switched the hook off and the supervisor would still seed idle');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agyseed-repo-'));
  fs.mkdirSync(path.join(repo, '.git'));
  const r = run(repo);
  assert.equal(r.status, 0, 'a hook we could not write must never stop the launch');
  assert.equal(r.stdout.trim(), '', 'a folder inside a git project has no hook, and the supervisor would still seed idle');
});

test('#4417: agytrust says `trusted` only when the folder is in agy\'s trusted list', () => {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agyseed-agyhome-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agyseed-trust-'));
  const run = (d) => spawnSync(process.execPath, [path.join(__dirname, 'agytrust.js'), d], { encoding: 'utf8', env: { ...process.env, AGENT_WORKFORCE_DATA: path.join(home, 'data-4796'), AGENT_WORKFORCE_AGY_HOME: home } });
  const ok = run(dir);
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout.trim(), 'trusted', 'control: a folder it could trust says so');
  const missing = run(path.join(dir, 'no-such-folder'));
  assert.equal(missing.status, 0, 'a folder it cannot trust must never stop the launch');
  assert.equal(missing.stdout.trim(), '', 'a folder agy will ask about says `trusted`, and the supervisor would seed idle over the prompt');
});

test('#5560: only a bridge child the runner ended is tried again; one that exited with a code never is', async () => {
  const fake = (results) => { let i = 0; const calls = []; return { calls, run: async () => { calls.push(i); return results[Math.min(i++, results.length - 1)]; } }; };
  const killed = { code: null, signal: 'SIGKILL', error: null, out: '', err: '' };
  const refused = { code: -11, signal: null, error: 'EAGAIN', out: '', err: '' };
  const ok = { code: 0, signal: null, error: null, out: '', err: '' };
  const failed = { code: 1, signal: null, error: null, out: '', err: 'boom' };
  let f = fake([killed, refused, ok]);
  assert.equal((await runBridge('x', {}, f.run, async () => {})).code, 0); assert.equal(f.calls.length, 3, 'a killed then refused child was not retried');
  f = fake([{ code: -2, signal: null, error: 'ENOENT', out: '', err: '' }, ok]);
  assert.equal((await runBridge('x', {}, f.run, async () => {})).error, 'ENOENT', 'a missing bridge or node was retried as if the runner were short');
  assert.equal(f.calls.length, 1);
  f = fake([failed, ok]);
  assert.equal((await runBridge('x', {}, f.run, async () => {})).code, 1, 'a bridge that ran and exited 1 was retried into a pass');
  assert.equal(f.calls.length, 1);
  // Node's own startup abort for lack of threads is the runner's, so it IS retried (review 3).
  f = fake([{ code: null, signal: 'SIGABRT', error: null, out: '', err: 'node[1]: ... uv_thread_create ... Resource temporarily unavailable' }, ok]);
  assert.equal((await runBridge('x', {}, f.run, async () => {})).code, 0, 'a startup abort for lack of threads was not retried');
  for (const own of [{ code: null, signal: 'SIGABRT' }, { code: null, signal: 'SIGSEGV' }, { code: null, signal: 'timeout' }]) {
    f = fake([Object.assign({ error: null, out: '', err: '' }, own), ok]);
    assert.equal((await runBridge('x', {}, f.run, async () => {})).code, null, own.signal + ' was retried into a pass, hiding a bridge crash or hang');
    assert.equal(f.calls.length, 1);
  }
  f = fake([killed, killed, killed, ok]);
  assert.equal((await runBridge('x', {}, f.run, async () => {})).code, null, 'more than three tries');
  assert.equal(f.calls.length, 3);
  // A hang is the bridge's even with a spawn error beside it (review 7).
  f = fake([{ code: null, signal: 'timeout', error: 'EAGAIN', out: '', err: '' }, ok]);
  assert.equal((await runBridge('x', {}, f.run, async () => {})).signal, 'timeout', 'a hang with a spawn error beside it was retried into a pass');
  assert.equal(f.calls.length, 1);
  // libuv's uv__close assertion (the CI abort of 2026-10-08) is Node's runtime aborting, so it IS retried.
  f = fake([{ code: null, signal: 'SIGABRT', error: null, out: '', err: 'Assertion failed: (fd > STDERR_FILENO), function uv__close, file core.c, line 646.\n' }, ok]);
  assert.equal((await runBridge('x', {}, f.run, async () => {})).code, 0, 'the libuv uv__close abort was not retried');
  // A SIGABRT whose stderr merely mentions EAGAIN is the bridge's, not Node's startup (review 5).
  f = fake([{ code: null, signal: 'SIGABRT', error: null, out: '', err: 'bridge: write failed EAGAIN' }, ok]);
  assert.equal((await runBridge('x', {}, f.run, async () => {})).code, null, 'a bridge abort mentioning EAGAIN was retried into a pass');
  assert.equal(f.calls.length, 1);
});

test('#5560 review 5: a spawn refused before stdio exists (EMFILE) ends at once with its error, not a throw or a 10 s wait', async () => {
  const { EventEmitter } = require('node:events');
  const noStdio = () => {
    const child = new EventEmitter();
    child.stdout = undefined; child.stderr = undefined; child.kill = () => {};
    process.nextTick(() => child.emit('error', Object.assign(new Error('spawn EMFILE'), { code: 'EMFILE' })));
    return child;
  };
  const started = Date.now();
  const r = await runOnce('x', {}, noStdio);
  assert.ok(Date.now() - started < 5000, 'the try waited out the hang timer instead of ending on its error');
  assert.equal(r.error, 'EMFILE');
  assert.equal(r.code, null);
  assert.notEqual(r.signal, 'timeout');
});
