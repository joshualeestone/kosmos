'use strict';
/**
 * #4466: a BUSY board is not a DOWN board, and an agent cannot restart-loop it.
 *
 * On an external tester's 25-agent board the CLI's health check (a full GET of the app page, capped at 2 s) timed
 * out, so every verb said "Kosmos is not running. Start it with: kosmos start"; his agents took the
 * advice, and a new Grok agent of theirs restarted the board 140 times in an hour, turning 2-10 s waits into
 * minute-long blackouts. These arms drive the REAL install/kosmos against stub boards:
 *   - slow (health answers after 5 s): status and post WAIT, say "busy", and SUCCEED;
 *   - stopped (connection refused): "not running" and the start advice, AT ONCE;
 *   - never answers: "busy", status exits 4 (bin/board-watchdog.sh gives that a long grace), and no
 *     start/restart advice anywhere;
 *   - CONTROL: the old healthy(), verbatim, says "not running" to the same slow board, so the slow
 *     arm above can tell the fix from the bug;
 *   - a stranger on the port, and an older board with no /api/health, still read as before;
 *   - agent start/stop/restart: refused while the board answers; on a down board, 10 rapid agent
 *     restarts go ahead at most once (the cooldown); a person, and --force, are unaffected.
 * SLOW ON PURPOSE (about two minutes): the waits ARE the behaviour under test (a 20 s busy budget, curl's 15 s,
 * a 12 s hook budget). Shortening a stub delay or a budget here can make an arm pass without measuring it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const SCRATCH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4466-scratch-'));
test.after(() => fs.rmSync(SCRATCH_HOME, { recursive: true, force: true }));
const PAGE = '<title>Kosmos</title>Agent Workforce';

function runCli(args, env, timeout = 40000, input) {   // input: written to the CLI's stdin, for --stdin arms
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const child = execFile(CLI, args, { env, timeout }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '): killed by the harness timeout, over the output buffer, or never started. ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '', ms: Date.now() - t0 });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}
function bash(script, env, timeout = 40000) {
  return new Promise((resolve, reject) => {
    execFile('/bin/bash', ['-c', script], { env, timeout }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('bash gave no exit code (' + (err.signal || err.code) + ') ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/* The stub board runs as its OWN process at a path like a real board's (".../kosmos.../server.js"):
   the CLI calls a listener that does not answer "busy" only when lsof says it is a Kosmos server run
   by this user, so an in-process stub (this test's own node) would read as a stranger. */
const STUB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-stub-4466-'));
const STUB = path.join(STUB_DIR, 'server.js');
fs.writeFileSync(STUB, `'use strict';
const http = require('node:http');
const [health, delayMs, firstFile] = [process.argv[2], Number(process.argv[3]), process.argv[4]];
// When the FIRST request arrived, for an arm that measures the CLI's own budget rather than its start-up.
let firstSeen = false;
const PAGE = ${JSON.stringify(PAGE)};
let slowOnceDone = false;
const server = http.createServer((req, res) => {
  if (!firstSeen && firstFile) { firstSeen = true; require('node:fs').writeFileSync(firstFile, String(Date.now())); }
  const reply = () => {
    if (health === 'stranger') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('hello from another app'); return; }
    if (req.method === 'POST' && req.url.startsWith('/api/post')) {
      req.resume();
      req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"delivery":{"state":"placed"}}'); });
      return;
    }
    if (req.url.startsWith('/api/health')) {
      // An older board under load: its 404 for the unknown route comes back slowly, and its page never does.
      if (health === 'oldslow') { setTimeout(() => { res.writeHead(404); res.end('not found'); }, delayMs); return; }
      if (health === '404' || health === 'page500') { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"app":"kosmos","ok":true}'); return;
    }
    if (health === 'page500') { res.writeHead(503); res.end('busy'); return; }   // an older board failing under load
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE);
  };
  // A busy board is slow at EVERYTHING it serves, the page included (the event loop is shared).
  if (health === 'hang' && req.method === 'GET') return;
  // A board that answers its health check (the FIRST one slowly, for 'reporthang') and then never answers
  // the request. Only the first is slow, so the first probe misses and the retry finds the board at once:
  // a delay on every probe would race the busy budget's whole-second rounding.
  if (health === 'reporthang' && req.method === 'POST' && req.url.startsWith('/api/report')) return;
  if (health === 'reporthang' && req.method === 'GET' && !slowOnceDone) { slowOnceDone = true; setTimeout(reply, delayMs); return; }
  if (health === 'roomhang' && req.url.includes('/room')) return;
  if (health === 'msgcut' && req.method === 'POST' && req.url.startsWith('/api/msg')) { req.socket.destroy(); return; }
  if (health === 'oldslow' && req.method === 'GET' && !req.url.startsWith('/api/health')) return;
  if (health === 'slow' && req.method === 'GET') { setTimeout(reply, delayMs); return; }
  reply();
});
server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\\n'));
`);
test.after(() => fs.rmSync(STUB_DIR, { recursive: true, force: true }));

/** A stub board in its own process. `health`: 'ok' (the new route), 'slow' (answers after delayMs),
 *  'hang' (never answers), '404' (an older board), 'stranger' (not ours anywhere). */
async function withBoard(health, fn, delayMs = 5000) {
  // exit code not read (#3628): this is the stub BOARD, not the CLI under test; an early exit is caught below.
  const firstFile = path.join(STUB_DIR, 'first-' + process.hrtime.bigint());
  const child = spawn(process.execPath, [STUB, health, String(delayMs), firstFile], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const port = await new Promise((resolve, reject) => {
      let buf = '';
      child.stdout.on('data', (d) => { buf += d; if (buf.includes('\n')) resolve(Number(buf.trim())); });
      child.on('exit', (c) => reject(new Error('the stub board exited before listening: ' + c)));
    });
    return await fn(port, firstFile);
  } finally {
    child.kill('SIGKILL');
    await new Promise((r) => (child.exitCode !== null || child.signalCode ? r() : child.on('exit', r)));
  }
}
async function closedPort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
function baseEnv(port, extra = {}) {
  // The runner's own agent markers are removed FIRST, so a test is a person unless it says otherwise.
  const env = { ...process.env };
  delete env.KOSMOS_AGENT_TOKEN; delete env.KOSMOS_AGENT_SESSION; delete env.TMUX_PANE;
  // A throwaway KOSMOS_HOME and store roots by default, so no arm reads this machine's pidfile or board
  // token (board_token asks node for store.ROOT, which follows AGENT_WORKFORCE_DATA), even run outside
  // tools/run-tests.sh's sandbox.
  return {
    ...env,
    KOSMOS_PORT: String(port), KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_HOME: SCRATCH_HOME,
    AGENT_WORKFORCE_DATA: path.join(SCRATCH_HOME, 'data'), AGENT_WORKFORCE_WORKERS: path.join(SCRATCH_HOME, 'workers'),
    AGENT_WORKFORCE_LAUNCH: path.join(SCRATCH_HOME, 'launch'), AGENT_WORKFORCE_PROJECTS: path.join(SCRATCH_HOME, 'projects'),
    ...extra,
  };
}
const START_ADVICE = /Start it with|kosmos start|kosmos restart/;

test('#4466 slow board: `kosmos status` waits, says busy on stderr, and reports RUNNING', () => withBoard('slow', async (port) => {
  const out = await runCli(['status'], baseEnv(port, { KOSMOS_BUSY_WAIT: '30' }));   // headroom on a loaded box
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Kosmos is running at/);
  assert.match(out.stderr, /Kosmos is busy, retrying/);
  assert.ok(out.ms >= 4000, `it must actually have waited for the slow answer (took ${out.ms} ms)`);
}));

test('#4466 one probe keeps to ONE budget: an older board whose 404 is slow does not give the page a second one', () => withBoard('oldslow', async (port) => {
  // Health 404s after 5 s, the page never answers, the probe's budget is 6 s. The page gets what is left
  // (about 1 s), so the probe ends near 6 s and says busy; with a fresh 6 s for the page it took ~11 s.
  const t0 = Date.now();
  const out = await bash(`source "${CLI}"; _health_probe 6; echo "state=$HEALTH_STATE"`, baseEnv(port));
  const ms = Date.now() - t0;
  assert.match(out.stdout, /state=busy/, out.stdout + out.stderr);
  assert.ok(ms >= 5000, `the slow 404 must actually have been waited for (took ${ms} ms)`);
  assert.ok(ms < 8500, `one probe must not take its budget twice (took ${ms} ms, budget 6 s)`);
}, 5000));

test('#4466 an --auto report (the hook) gives up on a busy board inside the hook\'s 15 s timeout, saying busy', () => withBoard('hang', async (port) => {
  const env = baseEnv(port, { TMUX_PANE: '%42' });
  delete env.KOSMOS_BUSY_WAIT;   // the hook sets none: the default is what is under test
  const out = await runCli(['report', 'started', '--auto'], env);
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /too busy to answer \(no reply in 6 s\)/);
  assert.ok(out.ms < 12000, `SessionStart's foreground check must end well inside 15 s (took ${out.ms} ms)`);
  // CONTROL: the same report WITHOUT --auto keeps the full default wait, so the arm above measures the
  // --auto budget and not a board that fails fast.
  const person = await runCli(['report', 'working', 'on it'], env);
  assert.equal(person.code, 1, person.stdout + person.stderr);
  assert.match(person.stdout, /no reply in 20 s/);
  assert.ok(person.ms >= 15000, `a report that is not --auto waits the full budget (took ${person.ms} ms)`);
}));

test('#4466 an --auto report stays inside the hook timeout END TO END: a slow health answer, then a POST that never answers', () => withBoard('reporthang', async (port, firstFile) => {
  // The first health probe (2 s) misses a 2.5 s answer and the retry gets one at once; then /api/report
  // never answers. The POST gets what is left of 12 s, so the command ends near 12 s; with its own 15 s
  // it took ~17 (red).
  const env = baseEnv(port, { TMUX_PANE: '%42' });
  delete env.KOSMOS_BUSY_WAIT;
  const out = await runCli(['report', 'started', '--auto'], env);
  const ended = Date.now();
  assert.equal(out.code, 1, out.stdout + out.stderr);
  // Measured from the board's FIRST request, which is where the CLI's 12 s budget starts: the process's own
  // start-up (bash, the tmux pick) comes before it and varies with the machine, and the 3 s AUTO_REPORT_TOTAL_S
  // leaves under the hook's 15 s is for it. Under 14 s: 12 plus a second of whole-second SECONDS rounding and
  // a second of slack; the old 15 s POST took ~17 from here (red). At least 10 s: a POST cut short is ~4.5.
  const budgetMs = ended - Number(fs.readFileSync(firstFile, 'utf8'));
  assert.ok(budgetMs < 14000, `the --auto report's budget, from the first request, must end near 12 s (took ${budgetMs} ms; ${out.ms} ms with start-up)`);
  assert.ok(budgetMs >= 10000, `the POST must have been given what was left of the budget, not cut short (took ${budgetMs} ms)`);
  assert.match(out.stdout, /did not answer in time, so we could not record that\. It may still have happened: check before doing it again\. It does not need a restart\./);
  assert.doesNotMatch(out.stdout, /Is it running|kosmos start/);
  assert.match(out.stderr, /busy, retrying/, 'the first probe must have missed, or the arm never measured a slow health answer');
}, 2500));

test('#4466 `kosmos msg` whose reply is CUT (not timed out) says busy and "may still have happened", not "is it running?"', () => withBoard('msgcut', async (port) => {
  // The health check passes; the send's connection is then dropped (curl 52/56). The timeout case keeps its
  // own exit 3 "maybe delivered" sentence; this is every other failure of the send.
  const out = await runCli(['msg', 'mara', 'plain', 'words'], baseEnv(port, { TMUX_PANE: '%42' }));
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /did not answer in time, so we could not send that\. It may still have happened: check before doing it again\. It does not need a restart\./);
  assert.doesNotMatch(out.stdout, /Is it running|kosmos start/);
}));

test('#4466 a READ that times out after the health check says busy, not "is it running?", and suggests waiting', () => withBoard('roomhang', async (port) => {
  const out = await runCli(['room', 'proj'], baseEnv(port, { TMUX_PANE: '%42' }));
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /did not answer in time, so we could not read that room\. Wait a minute and try again; it does not need a restart\./);
  assert.doesNotMatch(out.stdout, /Is it running|may still have happened/);
}));

test('#4466 a listener our own lsof cannot see is ANOTHER account\'s: stranger, not busy (CONTROL: no lsof at all stays busy)', () => withBoard('hang', async (port) => {
  // lsof RAN and named no listener, though something took the connection: on this Mac non-root lsof
  // does not see other users' listeners, so this is the shape of another account holding our port.
  const blind = await bash(`source "${CLI}"; port_listener_owner() { return 1; }; _health_probe 2; echo "state=$HEALTH_STATE"`, baseEnv(port));
  assert.match(blind.stdout, /state=stranger/, blind.stdout + blind.stderr);
  const nolsof = await bash(`source "${CLI}"; port_listener_owner() { return 1; }; _lsof_present() { return 1; }; _health_probe 2; echo "state=$HEALTH_STATE"`, baseEnv(port));
  assert.match(nolsof.stdout, /state=busy/, nolsof.stdout + nolsof.stderr);
}));

test('#4466 `kosmos msg --stdin` whose reply is CUT keeps the copy but does not say "was not sent" (it may have arrived)', () => withBoard('msgcut', async (port) => {
  // The kept copy goes to $TMPDIR: point it inside SCRATCH_HOME so the #4273 leak guard sees nothing left behind.
  const tmp = fs.mkdtempSync(path.join(SCRATCH_HOME, 'tmp-'));
  const out = await runCli(['msg', '--stdin', 'mara'], baseEnv(port, { TMUX_PANE: '%42', TMPDIR: tmp }), 40000, 'a piped message');
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /It may still have happened/);
  const kept = out.stdout.match(/The piped message may not have been sent; a copy is saved at (\S+)\. Check before sending it again\./);
  assert.ok(kept, out.stdout);
  assert.ok(kept[1].startsWith(tmp + path.sep), 'the copy is under the sandboxed TMPDIR: ' + kept[1]);
  assert.equal(fs.readFileSync(kept[1], 'utf8'), 'a piped message');
  assert.doesNotMatch(out.stdout, /was not sent/);
}));

test('#4466 slow board: `kosmos post` waits and the post SUCCEEDS', () => withBoard('slow', async (port) => {
  const out = await runCli(['post', 'proj', 'a message worth posting'], baseEnv(port, { TMUX_PANE: '%42', KOSMOS_BUSY_WAIT: '30' }));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.doesNotMatch(out.stdout, /not running/);
  assert.match(out.stderr, /busy, retrying/);
}));

test('#4466 CONTROL: the OLD healthy() (a 2 s full-page GET) calls the same slow board NOT running', () => withBoard('slow', async (port) => {
  // Verbatim from origin/main before this change (install/kosmos healthy()).
  const old = `URL="http://127.0.0.1:${port}"
healthy() {
  local _body
  _body="$(/usr/bin/curl -fsS -m 2 "$URL/" 2>/dev/null)" || return 1
  case "$_body" in
    *"Agent Workforce"*|*Kosmos*) return 0 ;;
    *) return 1 ;;
  esac
}
if healthy; then echo running; else echo "not running"; fi`;
  const out = await bash(old, baseEnv(port));
  assert.equal(out.stdout.trim(), 'not running', 'the control must be able to show the bug, or the slow arms prove nothing');
}));

test('#4466 stopped board: "not running" with the start advice, AT ONCE (no busy wait)', async () => {
  const port = await closedPort();
  const status = await runCli(['status'], baseEnv(port));
  assert.equal(status.code, 1);
  assert.match(status.stdout, /Kosmos is not running\. Start it with: kosmos start/);
  assert.doesNotMatch(status.stderr, /busy/);
  // Loose on purpose (a loaded box is slow to spawn bash): a refused connection misread as busy would
  // wait the whole 20 s busy window, so anything well under that is the signal.
  assert.ok(status.ms < 10000, `a refused connection must not wait out the busy window (took ${status.ms} ms)`);
  const post = await runCli(['post', 'proj', 'hello'], baseEnv(port, { TMUX_PANE: '%42' }));
  assert.notEqual(post.code, 0);
  assert.match(post.stdout, /Kosmos is not running, so nothing can be posted\. Start it with: kosmos start/);
});

test('#4466 a board that never answers: busy, and NO start or restart advice anywhere', () => withBoard('hang', async (port) => {
  const env = baseEnv(port, { KOSMOS_BUSY_WAIT: '3' });
  const status = await runCli(['status'], env);
  assert.equal(status.code, 4, 'busy is its own exit: not 1 ("not running", the start advice) and not 0 (which would hide a wedged board from the watchdog)');
  assert.match(status.stdout, /running at .* but is busy/);
  assert.doesNotMatch(status.stdout + status.stderr, START_ADVICE);
  const post = await runCli(['post', 'proj', 'hello'], { ...env, TMUX_PANE: '%42' });
  assert.notEqual(post.code, 0);
  assert.match(post.stdout, /running but too busy to answer/);
  assert.doesNotMatch(post.stdout + post.stderr, START_ADVICE);
}));

test('#4466 a stranger on the port is still not taken for Kosmos', () => withBoard('stranger', async (port) => {
  const out = await runCli(['status'], baseEnv(port));
  assert.equal(out.code, 1);
  assert.match(out.stdout, /another app is using port/);
}));

test('#4466 an OLDER board with no /api/health still reads as running (the page fallback)', () => withBoard('404', async (port) => {
  const out = await runCli(['status'], baseEnv(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Kosmos is running at/);
}));

test('#4466 part 6: an AGENT may not stop or restart a board that answers; start says it is running', () => withBoard('ok', async (port) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4466-home-'));
  try {
    const env = baseEnv(port, { KOSMOS_HOME: home, KOSMOS_AGENT_SESSION: 'grok-agent' });
    for (const verb of ['restart', 'stop']) {
      const out = await runCli([verb], env);
      assert.equal(out.code, 1, `${verb}: ${out.stdout}${out.stderr}`);
      assert.match(out.stdout, new RegExp(`an agent may not ${verb} it`));
      assert.doesNotMatch(out.stdout, /--force/, 'the refusal must not teach an agent the override');
    }
    const start = await runCli(['start'], env);
    assert.equal(start.code, 0);
    assert.match(start.stdout, /already running/);
    assert.equal(fs.existsSync(path.join(home, 'board.stopped')), false, 'a refused stop must not leave the stop marker');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}));

test('#4466 part 6: 8 agents restarting a DOWN board AT THE SAME MOMENT: exactly one goes ahead (the claim)', async () => {
  // The start-time check alone lets all of them through: each reads the same (absent) start time before
  // any writes one. Each restart would then kill the board the previous one started.
  const port = await closedPort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4466-home-'));
  try {
    const out = await bash(`source "${CLI}"
for i in 1 2 3 4 5 6 7 8; do ( ( agent_board_guard restart ) >/dev/null 2>&1 && echo went ) & done
wait`, baseEnv(port, { KOSMOS_HOME: home, KOSMOS_AGENT_SESSION: 'grok-agent' }));
    const went = (out.stdout.match(/^went$/gm) || []).length;
    assert.equal(went, 1, `exactly one of 8 simultaneous agent restarts may go ahead (got ${went}): ` + out.stdout + out.stderr);
    // CONTROL: a person is never held by an agent's claim.
    const person = await bash(`source "${CLI}"; ( agent_board_guard restart ) && echo person-ok`, baseEnv(port, { KOSMOS_HOME: home }));
    assert.match(person.stdout, /person-ok/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('#4466 part 6: 10 rapid agent restarts of a DOWN board go ahead at most ONCE; a person is unaffected', async () => {
  const port = await closedPort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4466-home-'));
  try {
    // Sourced (the #3079 guard stops before the dispatch), so the guard runs for real and a "go ahead"
    // is recorded as the start it would have become, without launching anything on this machine.
    const loop = (who) => `source "${CLI}"
went=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  if ( agent_board_guard restart ) >/dev/null 2>&1; then went=$((went+1)); _mark_board_started; fi
done
echo "${who} went=$went"`;
    const agent = await bash(loop('agent'), baseEnv(port, { KOSMOS_HOME: home, KOSMOS_AGENT_SESSION: 'grok-agent' }));
    assert.match(agent.stdout, /agent went=1\b/, agent.stdout + agent.stderr);
    const person = await bash(loop('person'), baseEnv(port, { KOSMOS_HOME: home }));
    assert.match(person.stdout, /person went=10\b/, 'a person in their own Terminal must never be refused');
    const forced = await bash(`source "${CLI}"; ( agent_board_guard restart --force ) && echo forced-ok`, baseEnv(port, { KOSMOS_HOME: home, KOSMOS_AGENT_SESSION: 'x' }));
    assert.match(forced.stdout, /forced-ok/);
    const refusal = await bash(`source "${CLI}"; agent_board_guard restart`, baseEnv(port, { KOSMOS_HOME: home, KOSMOS_AGENT_SESSION: 'x' }));
    assert.equal(refusal.code, 1);
    assert.match(refusal.stdout, /was started \d+ s ago, so an agent may not start it again yet/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('#4466 part 6: the agent token alone also marks an agent (a pane launched without the new variable)', async () => {
  const port = await closedPort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4466-home-'));
  try {
    fs.writeFileSync(path.join(home, 'board.started-at'), String(Math.floor(Date.now() / 1000)));
    const out = await bash(`source "${CLI}"; agent_board_guard restart`, baseEnv(port, { KOSMOS_HOME: home, KOSMOS_AGENT_TOKEN: 'abc123' }));
    assert.equal(out.code, 1, out.stdout + out.stderr);
    assert.match(out.stdout, /an agent may not start it again yet/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('#4466 part 6: a pane whose session carries the @kosmos_agent claim is an agent even with no variables', async () => {
  const port = await closedPort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4466-home-'));
  try {
    fs.writeFileSync(path.join(home, 'board.started-at'), String(Math.floor(Date.now() / 1000)));
    // A fake tmux that answers the claim query: the claimed session's name, or nothing (the control).
    const fake = (claim) => {
      const f = path.join(home, `tmux-${claim || 'none'}`);
      fs.writeFileSync(f, `#!/bin/bash\ncase "$*" in *@kosmos_agent*) printf '%s' '${claim}' ;; esac\n`, { mode: 0o755 });
      return f;
    };
    const claimed = await bash(`source "${CLI}"; agent_board_guard restart`, baseEnv(port, { KOSMOS_HOME: home, TMUX_PANE: '%9', AGENT_WORKFORCE_TMUX_BIN: fake('grok-agent') }));
    assert.equal(claimed.code, 1, claimed.stdout + claimed.stderr);
    assert.match(claimed.stdout, /an agent may not start it again yet/);
    const unclaimed = await bash(`source "${CLI}"; agent_board_guard restart && echo went`, baseEnv(port, { KOSMOS_HOME: home, TMUX_PANE: '%9', AGENT_WORKFORCE_TMUX_BIN: fake('') }));
    assert.match(unclaimed.stdout, /went/, 'CONTROL: an unclaimed pane (a person in tmux) goes ahead');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('#4466 a SILENT listener that is not Kosmos (takes the connection, never answers) is a stranger, not busy', async () => {
  // In this test's own process, so lsof names a node that is not a Kosmos server.
  const sockets = [];
  const silent = net.createServer((sock) => { sockets.push(sock); });
  await new Promise((r) => silent.listen(0, '127.0.0.1', r));
  try {
    const out = await runCli(['status'], baseEnv(silent.address().port));
    assert.equal(out.code, 1, out.stdout + out.stderr);
    assert.match(out.stdout, /another app is using port/);
    assert.doesNotMatch(out.stdout + out.stderr, /busy/, 'a stranger that never answers must not be called our busy board');
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise((r) => silent.close(r));
  }
});

test('#4466 part 6: an agent stop on a board that does not answer writes NO stop marker (the watchdog stays on)', async () => {
  const port = await closedPort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4466-home-'));
  try {
    const agent = await runCli(['stop'], baseEnv(port, { KOSMOS_HOME: home, KOSMOS_AGENT_SESSION: 'grok-agent' }));
    assert.equal(agent.code, 0, agent.stdout + agent.stderr);
    assert.match(agent.stdout, /nothing for an agent to stop/);
    assert.equal(fs.existsSync(path.join(home, 'board.stopped')), false, 'an agent stop must not switch off recovery');
    // CONTROL: the same stop from a person still records the intent (#2955), so the arm above is the guard.
    const person = await runCli(['stop'], baseEnv(port, { KOSMOS_HOME: home }));
    assert.equal(fs.existsSync(path.join(home, 'board.stopped')), true, 'CONTROL: a person stop writes the marker: ' + person.stdout);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('#4466 a person stopping a BUSY board this command did not start leaves it alone and writes no marker', () => withBoard('hang', async (port) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4466-home-'));
  try {
    const out = await runCli(['stop'], baseEnv(port, { KOSMOS_HOME: home }));
    assert.equal(out.code, 1, out.stdout + out.stderr);
    assert.match(out.stdout + out.stderr, /running at .* but is busy, and it was not started by this command/);
    assert.doesNotMatch(out.stdout, /Kosmos is not running/);
    assert.equal(fs.existsSync(path.join(home, 'board.stopped')), false, 'a busy board is running: no stop marker');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}));

test('#4466 a person RESTART of a busy board nothing tracks RECLAIMS it (the way out with auto-restart off); an agent\'s is refused', () => withBoard('hang', async (port) => {
  // Our own silent board, no pidfile, and no watchdog to reclaim it (AGENT_WORKFORCE_LAUNCH: unsupervised).
  // A person's `kosmos restart` is the recovery: the start after the stop takes the #3079 reclaim.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4466-home-'));
  try {
    const env = baseEnv(port, { KOSMOS_HOME: home, AGENT_WORKFORCE_LAUNCH: home, KOSMOS_BUSY_WAIT: '2' });
    // CONTROL: an agent's restart of the same board is refused, and nothing is reclaimed.
    const agent = await runCli(['restart'], { ...env, KOSMOS_AGENT_SESSION: 'grok-agent' });
    assert.equal(agent.code, 1, agent.stdout + agent.stderr);
    assert.match(agent.stdout, /an agent may not restart it/);
    assert.doesNotMatch(agent.stdout, /Reclaiming it/);
    const person = await runCli(['restart'], env);
    assert.match(person.stdout, /not answering, and this command did not start it\. Restarting it, because you asked\./, person.stdout + person.stderr);
    assert.match(person.stdout, /held by your own stale Kosmos .* Reclaiming it/, 'the start after the stop must reclaim: ' + person.stdout + person.stderr);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}));

test('#4466 the watchdog reclaim: only KOSMOS_RECLAIM_BUSY=1 lets `kosmos start` free a port our own silent board holds', () => withBoard('hang', async (port) => {
  // The stub is a same-user "kosmos...server.js" that never answers: to the CLI, our own busy board.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4466-home-'));
  try {
    // AGENT_WORKFORCE_LAUNCH makes the board read as unsupervised, so nothing touches this Mac's launchd.
    const env = baseEnv(port, { KOSMOS_HOME: home, AGENT_WORKFORCE_LAUNCH: home, KOSMOS_BUSY_WAIT: '2' });
    const plain = await runCli(['start'], env);
    assert.equal(plain.code, 0, plain.stdout + plain.stderr);
    assert.match(plain.stdout, /already running .*busy/, 'CONTROL: without the flag a busy board is left alone');
    const reclaim = await runCli(['start', '--force'], { ...env, KOSMOS_RECLAIM_BUSY: '1' });
    assert.match(reclaim.stdout, /held by your own stale Kosmos .* Reclaiming it/, 'with the flag the #3079 reclaim runs: ' + reclaim.stdout + reclaim.stderr);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}));

test('#4466 part 6: `kosmos open` from an agent on a down board goes through the same restart cooldown', async () => {
  const port = await closedPort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4466-home-'));
  try {
    fs.writeFileSync(path.join(home, 'board.started-at'), String(Math.floor(Date.now() / 1000)));
    const out = await runCli(['open'], baseEnv(port, { KOSMOS_HOME: home, KOSMOS_AGENT_SESSION: 'grok-agent' }));
    assert.equal(out.code, 1, out.stdout + out.stderr);
    assert.match(out.stdout, /an agent may not start it again yet/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('#4466 part 6: an agent RESTART that recovers a down board clears the stop marker (the watchdog is not left off)', async () => {
  const port = await closedPort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4466-home-'));
  try {
    // No runtime in this KOSMOS_HOME, and AGENT_WORKFORCE_LAUNCH makes it unsupervised, so the start that
    // follows the stop fails harmlessly; what is measured is the marker cmd_stop writes and cmd_start clears.
    const out = await runCli(['restart'], baseEnv(port, { KOSMOS_HOME: home, AGENT_WORKFORCE_LAUNCH: home, KOSMOS_AGENT_SESSION: 'grok-agent' }));
    // cmd_stop ran (it says so and, on a down board, writes the marker), then cmd_start ran (it stops at this
    // sandbox's missing runtime, AFTER clearing the marker first thing).
    assert.match(out.stdout, /Kosmos is not running\./, 'cmd_stop must have run: ' + out.stdout + out.stderr);
    assert.match(out.stderr, /the runtime is missing/, 'cmd_start must have run after it: ' + out.stdout + out.stderr);
    assert.equal(fs.existsSync(path.join(home, 'board.stopped')), false, 'a restart must not leave the deliberate-stop marker behind');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('#4466 an OLDER board of ours answering its page with a 5xx under load is busy, not a stranger', () => withBoard('page500', async (port) => {
  const out = await runCli(['status'], baseEnv(port, { KOSMOS_BUSY_WAIT: '3' }));
  assert.equal(out.code, 4, out.stdout + out.stderr);
  assert.match(out.stdout, /running at .* but is busy/);
  assert.doesNotMatch(out.stdout, /another app/);
}));

test('#4466 the installer starts the board with KOSMOS_RECLAIM_BUSY=1 (right after its own stop, a silent Kosmos on the port is stale)', () => {
  const setup = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');
  const starts = setup.split('\n').filter((l) => /"\$KOSMOS_HOME\/bin\/kosmos" start\b/.test(l) && !/^\s*#/.test(l));
  assert.equal(starts.length, 1, 'expected exactly one board start in setup.sh: ' + JSON.stringify(starts));
  assert.match(starts[0], /KOSMOS_RECLAIM_BUSY=1 "\$KOSMOS_HOME\/bin\/kosmos" start --force/);
});
