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
  // Answers its health check, then cuts each data read (a board too busy to finish the request).
  if (health === 'datacut' && ['/api/connections/held', '/api/community/read', '/api/roles'].some((r) => req.url.startsWith(r))) { req.socket.destroy(); return; }
  // #4580: a send the board keeps but whose reply is cut. 'cutonce' cuts the FIRST send and answers the retry
  // with the board's duplicate receipt; 'cutalways' cuts every send. Sends are counted in firstFile + '.sends'.
  // #4580 'posthang': a board still fanning a post out; it takes the post and never answers in the budget.
  if (health === 'posthang' && req.method === 'POST' && req.url.startsWith('/api/post')) { require('node:fs').appendFileSync(firstFile + '.sends', '.'); req.resume(); return; }
  if ((health === 'cutonce' || health === 'cutalways') && req.method === 'POST' && (req.url.startsWith('/api/msg') || req.url.startsWith('/api/post'))) {
    const fsm = require('node:fs'); fsm.appendFileSync(firstFile + '.sends', '.');
    fsm.appendFileSync(firstFile + '.tokens', String(req.headers['x-kosmos-agent-token'] || '-') + '\\n');
    const n = fsm.readFileSync(firstFile + '.sends', 'utf8').length;
    req.resume();
    if (health === 'cutalways' || n === 1) { req.socket.destroy(); return; }
    req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"delivery":{"state":"placed","because":null,"id":"m1","duplicate":true}}'); });
    return;
  }
  // Cuts EVERY request at once (curl 52: a busy reading that comes back fast), counting them.
  if (health === 'fastcut') { require('node:fs').appendFileSync(firstFile + '.n', '.'); req.socket.destroy(); return; }
  // Answers its health check, then gives an EMPTY 200 for the roles list (an answer, not a lost connection).
  if (health === 'emptyroles' && req.url.startsWith('/api/roles')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(''); return; }
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
  // An AGENT is never told to start or restart a busy board: that advice is the blackout.
  const status = await runCli(['status'], { ...env, KOSMOS_AGENT_SESSION: 'grok-agent' });
  assert.equal(status.code, 4, 'busy is its own exit: not 1 ("not running", the start advice) and not 0 (which would hide a wedged board from the watchdog)');
  assert.match(status.stdout, /running at .* but is busy/);
  assert.doesNotMatch(status.stdout + status.stderr, START_ADVICE);
  // A PERSON gets the way out if busy turns out to be stuck, and still never "not running" or "Start it with".
  const person = await runCli(['status'], env);
  assert.equal(person.code, 4, person.stdout + person.stderr);
  assert.match(person.stdout, /running at .* but is busy/);
  assert.match(person.stdout, /stays like this for several minutes .*'kosmos restart' frees it/);
  assert.doesNotMatch(person.stdout + person.stderr, /Start it with|not running/);
  const post = await runCli(['post', 'proj', 'hello'], { ...env, TMUX_PANE: '%42' });
  assert.notEqual(post.code, 0);
  assert.match(post.stdout, /running but too busy to answer/);
  assert.doesNotMatch(post.stdout + post.stderr, START_ADVICE);
}));

test('#4466 the verbs that arrived after it (connections, connect, community read) say busy, not start, too', () => withBoard('hang', async (port) => {
  // They came in from main with their own "Start it with: kosmos start" line; each goes through say_not_up now.
  const env = baseEnv(port, { KOSMOS_BUSY_WAIT: '3', TMUX_PANE: '%42' });
  for (const [args, input] of [[['connections']], [['connect', 'brave-search'], 'tok'], [['community', 'read']]]) {
    const out = await runCli(args, env, 40000, input === undefined ? '' : input);
    assert.notEqual(out.code, 0, args.join(' ') + ': ' + out.stdout + out.stderr);
    assert.match(out.stdout, /running but too busy to answer/, args.join(' ') + ': ' + out.stdout + out.stderr);
    assert.doesNotMatch(out.stdout + out.stderr, START_ADVICE, args.join(' '));
  }
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

test('#4466 a failed reclaim of an untracked holder sends a person to the process, not to `kosmos stop` (which leaves it alone)', async () => {
  const port = await closedPort();
  const person = await bash(`source "${CLI}"; echo "[$(_stop_advice 4242)]"; echo "[$(_stop_advice)]"`, baseEnv(port));
  const [withPid, plain] = person.stdout.trim().split('\n');
  assert.match(withPid, /Quit process 4242 .*kill -9 4242.*reboot/);
  assert.doesNotMatch(withPid, /kosmos (stop|restart)/);
  assert.match(plain, /Stop it with 'kosmos stop'/, 'CONTROL: a tracked board still gets the stop advice');
  const agent = await bash(`source "${CLI}"; _stop_advice 4242`, baseEnv(port, { KOSMOS_AGENT_SESSION: 'grok-agent' }));
  assert.match(agent.stdout, /Tell the person who runs this computer/);
  assert.doesNotMatch(agent.stdout, /kill/);
});

test('#4466 a proxy in the environment does not hide the board: loopback requests skip it (a sandbox that is proxy-only)', () => withBoard('ok', async (port) => {
  // A proxy that answers EVERYTHING with an empty 200, the way a sandbox's proxy answered GET / for a real agent.
  const hits = [];
  const proxy = require('node:http').createServer((req, res) => { hits.push(req.url); res.writeHead(200); res.end(''); });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const p = 'http://127.0.0.1:' + proxy.address().port;
  try {
    const env = baseEnv(port, { http_proxy: p, HTTP_PROXY: p, https_proxy: p, HTTPS_PROXY: p, all_proxy: p, ALL_PROXY: p });
    delete env.no_proxy; delete env.NO_PROXY;
    const out = await runCli(['status'], env);
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /Kosmos is running at/);
    assert.doesNotMatch(out.stdout, /another app|not running/);
    assert.deepEqual(hits, [], 'no loopback request may go through the proxy: ' + JSON.stringify(hits));
    // A caller's own NO_PROXY is kept, not replaced (loopback is added to it).
    const kept = await bash(`source "${CLI}"; printf '%s|%s' "$NO_PROXY" "$no_proxy"`, { ...env, NO_PROXY: 'corp.example', no_proxy: 'corp.example' });
    assert.match(kept.stdout, /^127\.0\.0\.1,localhost,corp\.example\|127\.0\.0\.1,localhost,corp\.example$/, kept.stdout);
  } finally { await new Promise((r) => proxy.close(r)); }
}));

test('#4466 start and status: a listener that IS the recorded board is running, never "another app" and never reclaimed', async () => {
  const port = await closedPort();
  // healthy() could not read it (a proxy in the way); board.pid names 4242 and 4242 holds the port.
  const stubs = (listener) => `source "${CLI}"; healthy() { HEALTH_STATE=stranger; return 1; }; port_taken_by_stranger() { HEALTH_STATE=stranger; return 0; }; running_pid() { echo 4242; }; port_listener_owner() { echo "${listener} $(/usr/bin/id -u) 1"; }; port_has_listener() { return 0; }; kill() { echo "KILLED $*"; }`;
  const st = await bash(stubs(4242) + '; cmd_status', baseEnv(port));
  assert.equal(st.code, 4, st.stdout + st.stderr);
  assert.match(st.stdout, /running at .*\(process 4242\) but did not answer this command/);
  assert.doesNotMatch(st.stdout, /another app|not running/);
  const start = await bash(stubs(4242) + '; cmd_start; echo "rc=$?"', baseEnv(port));
  assert.match(start.stdout, /already running at .*\(process 4242\)/, start.stdout + start.stderr);
  assert.doesNotMatch(start.stdout, /KILLED|Reclaiming|another app/);
  assert.match(start.stdout, /rc=0/, 'start returns 0: ' + start.stdout);
  // The watchdog's and the installer's KOSMOS_RECLAIM_BUSY start still reclaim it (the one way to free a board
  // of ours that holds the port and never answers).
  const reclaim = await bash(stubs(4242) + '; KOSMOS_RECLAIM_BUSY=1 cmd_start', baseEnv(port));
  assert.match(reclaim.stdout, /Reclaiming it/, reclaim.stdout + reclaim.stderr);
  assert.match(reclaim.stdout, /KILLED 4242/);
  // An agent's start is not spent on it: the guard reads the recorded board as up and never claims.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4466-home-'));
  try {
    const ag = await bash(stubs(4242) + '; ( agent_board_guard start ); echo "rc=$?"', baseEnv(port, { KOSMOS_HOME: home, KOSMOS_AGENT_SESSION: 'grok-agent' }));
    assert.match(ag.stdout, /already running/, ag.stdout + ag.stderr);
    assert.equal(fs.existsSync(path.join(home, 'board.agent-claim')), false, 'the agent start claim is not spent on a running board');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
  // CONTROL: a listener that is NOT the recorded board still gets the stranger sentence from status.
  const other = await bash(stubs(9999) + '; cmd_status', baseEnv(port));
  assert.match(other.stdout, /another app is using port/, other.stdout + other.stderr);
});

test('#4580 a msg or post whose reply is CUT is asked once more, and the board\'s receipt says it arrived (not "failed")', () => withBoard('cutonce', async (port, firstFile) => {
  const env = baseEnv(port, { KOSMOS_BUSY_WAIT: '3', TMUX_PANE: '%42' });
  const msg = await runCli(['msg', 'mara', 'the lease is signed'], env);
  assert.equal(msg.code, 0, msg.stdout + msg.stderr);
  assert.match(msg.stdout, /Placed with mara \(it had arrived the first time; it was not sent twice\)/);
  assert.match(msg.stderr, /asking once more/);
  assert.equal(fs.readFileSync(firstFile + '.sends', 'utf8').length, 2, 'exactly one retry');
}));

test('#4580 a post whose reply is CUT is asked once more too; a board that keeps cutting gets ONE retry, not a loop', async () => {
  await withBoard('cutonce', async (port, firstFile) => {
    const out = await runCli(['post', 'proj', 'draft is in the folder'], baseEnv(port, { KOSMOS_BUSY_WAIT: '3', TMUX_PANE: '%42' }));
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /Posted to proj\. .*it was not posted twice/);
    assert.equal(fs.readFileSync(firstFile + '.sends', 'utf8').length, 2);
  });
  // CONTROL: every send cut. One retry, then the honest "may still have happened" (never a loop, never "not running").
  for (const args of [['msg', 'mara', 'on my way'], ['post', 'proj', 'on my way']]) {
    await withBoard('cutalways', async (port, firstFile) => {
      const out = await runCli(args, baseEnv(port, { KOSMOS_BUSY_WAIT: '3', TMUX_PANE: '%42' }));
      assert.notEqual(out.code, 0, args[0]);
      assert.match(out.stdout, /It may still have happened: check before doing it again/, args[0] + ': ' + out.stdout);
      assert.doesNotMatch(out.stdout, /not running|Is it running/);
      assert.equal(fs.readFileSync(firstFile + '.sends', 'utf8').length, 2, args[0] + ': one retry, then stop');
    });
  }
});

test('#4580 the retry carries the agent\'s own token, as the first send did (#4491: the board tells agent from person by it)', () => withBoard('cutonce', async (port, firstFile) => {
  const tok = 'ab'.repeat(16);
  const out = await runCli(['msg', 'mara', 'signed'], baseEnv(port, { KOSMOS_BUSY_WAIT: '3', TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: tok }));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  const sent = fs.readFileSync(firstFile + '.tokens', 'utf8').trim().split('\n');
  assert.deepEqual(sent, [tok, tok], 'the retry went out without the agent token: ' + JSON.stringify(sent));
}));

test('#4580 a post that TIMES OUT is not asked again (the board is still delivering it; the board folds a re-post anyway)', () => withBoard('posthang', async (port, firstFile) => {
  const out = await runCli(['post', 'proj', 'long fan-out'], baseEnv(port, { KOSMOS_BUSY_WAIT: '3', TMUX_PANE: '%42', KOSMOS_POST_TIMEOUT_S: '2' }));
  assert.equal(out.code, 3, out.stdout + out.stderr);
  assert.match(out.stdout, /still delivering that post .*Do not re-post/);
  assert.doesNotMatch(out.stderr, /asking once more/);
  assert.equal(fs.readFileSync(firstFile + '.sends', 'utf8').length, 1, 'a timed-out post was sent again');
}));

test('#4466 a start whose board comes back BUSY reports it running (slow), not "did not come up"', async () => {
  const port = await closedPort();
  const stub = (state, pid) => `source "${CLI}"; sleep() { :; }; healthy() { HEALTH_STATE=${state}; return 1; }; if _await_board_up ${pid}; then echo UP; else echo NOTUP; fi`;
  const sup = await bash(stub('busy', ''), baseEnv(port));                       // launchd-supervised: no pid
  assert.match(sup.stdout, /running at .*busy right now, so it is slow to answer/, sup.stdout + sup.stderr);
  assert.match(sup.stdout, /^UP$/m);
  const live = await bash(stub('busy', '$$'), baseEnv(port));                    // nohup: its pid is alive
  assert.match(live.stdout, /^UP$/m, live.stdout + live.stderr);
  const dead = await bash(stub('busy', '999999'), baseEnv(port));                // the launched process exited
  assert.match(dead.stdout, /^NOTUP$/m, 'a busy port held by something other than the process just launched is not "up": ' + dead.stdout);
  // CONTROL: a board that stays down is still a failed start.
  const down = await bash(stub('down', ''), baseEnv(port));
  assert.match(down.stdout, /^NOTUP$/m, down.stdout + down.stderr);
  assert.doesNotMatch(down.stdout, /running at/);
});

test('#4466 board-run strips the agent markers from the board it execs, like the nohup launch', async () => {
  // Run for real on a closed port: a stub "node" records the environment the board would have been given.
  const port = await closedPort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4466-home-'));
  try {
    fs.mkdirSync(path.join(home, 'tmux', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(home, 'tmux', 'bin', 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const node = path.join(home, 'fake-node');
    fs.writeFileSync(node, '#!/bin/sh\nenv > "$KOSMOS_HOME/board-env.txt"\n', { mode: 0o755 });
    const app = path.join(home, 'server.js'); fs.writeFileSync(app, '');
    const env = baseEnv(port, { KOSMOS_HOME: home, KOSMOS_AGENT_SESSION: 'grok-agent', KOSMOS_AGENT_TOKEN: 't', TMUX_PANE: '%42', KOSMOS_RECLAIM_BUSY: '1', KEEP_ME: 'yes' });
    const out = await bash(`source "${CLI}"; NODE="${node}"; APP="${app}"; cmd_board_run`, env);
    const got = fs.existsSync(path.join(home, 'board-env.txt')) ? fs.readFileSync(path.join(home, 'board-env.txt'), 'utf8') : '';
    assert.ok(got, 'board-run must launch the stub board, or the arm measures nothing: ' + out.stdout + out.stderr);
    assert.match(got, /^KEEP_ME=yes$/m, 'CONTROL: an unrelated variable is passed through');
    for (const v of ['KOSMOS_AGENT_SESSION', 'KOSMOS_AGENT_TOKEN', 'TMUX_PANE', 'KOSMOS_RECLAIM_BUSY']) assert.doesNotMatch(got, new RegExp('^' + v + '=', 'm'), v + ' reached the board');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('#4466 a busy reading that comes back FAST is not retried in a tight loop (the board is already overloaded)', () => withBoard('fastcut', async (port, firstFile) => {
  const out = await runCli(['status'], baseEnv(port, { KOSMOS_BUSY_WAIT: '3' }));
  assert.equal(out.code, 4, out.stdout + out.stderr);
  const n = fs.existsSync(firstFile + '.n') ? fs.readFileSync(firstFile + '.n', 'utf8').length : 0;
  assert.ok(n >= 1, 'the stub must have been asked at least once (else the arm measures nothing)');
  // Probes wait out their budget (2 s, then what is left): a handful of requests in 3 s, not hundreds.
  assert.ok(n <= 8, `a 3 s busy window sent ${n} requests to a board that cut each one at once`);
}));

test('#4466 an agent may not start a board the person stopped ON PURPOSE (board.stopped); a person still can', async () => {
  const port = await closedPort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4466-home-'));
  try {
    fs.writeFileSync(path.join(home, 'board.stopped'), '');
    const agent = await bash(`source "${CLI}"; ( agent_board_guard start ) && echo went`, baseEnv(port, { KOSMOS_HOME: home, KOSMOS_AGENT_SESSION: 'grok-agent' }));
    assert.doesNotMatch(agent.stdout, /went/, agent.stdout + agent.stderr);
    assert.match(agent.stdout, /stopped on purpose by the person who runs this computer/);
    assert.ok(fs.existsSync(path.join(home, 'board.stopped')), 'the person\'s stop marker is kept');
    const restart = await bash(`source "${CLI}"; ( agent_board_guard restart ) && echo went`, baseEnv(port, { KOSMOS_HOME: home, KOSMOS_AGENT_SESSION: 'grok-agent' }));
    assert.doesNotMatch(restart.stdout, /went/);
    // CONTROL: a person is never held by it.
    const person = await bash(`source "${CLI}"; ( agent_board_guard start ) && echo went`, baseEnv(port, { KOSMOS_HOME: home }));
    assert.match(person.stdout, /went/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('#4466 an EMPTY answer to agent roles is not "is it running?" (the board did answer)', () => withBoard('emptyroles', async (port) => {
  const out = await runCli(['agent', 'roles'], baseEnv(port, { KOSMOS_BUSY_WAIT: '3', TMUX_PANE: '%42' }), 40000, '');
  assert.notEqual(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /gave an empty answer when asked for the roles/, out.stdout + out.stderr);
  assert.doesNotMatch(out.stdout + out.stderr, /Is it running|Start it with/);
}));

test('#4466 `kosmos status` on a stranger answers from the reading it has, not a second probe that could read busy', async () => {
  const port = await closedPort();
  // healthy() reads stranger; any LATER probe would read busy (the transient between two readings).
  const stub = `source "${CLI}"; healthy() { HEALTH_STATE=stranger; return 1; }; _health_probe() { HEALTH_STATE=busy; }; cmd_status`;
  const out = await bash(stub, baseEnv(port));
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /another app is using port/);
  assert.doesNotMatch(out.stdout + out.stderr, /Start it with/);   // the stranger sentence names 'kosmos start' only to say it will refuse
});

test('#4466 the verbs that arrived after it say busy, not "is it running", when the request itself is cut AFTER the health check', () => withBoard('datacut', async (port) => {
  const env = baseEnv(port, { KOSMOS_BUSY_WAIT: '3', TMUX_PANE: '%42' });
  for (const args of [['connections'], ['community', 'read'], ['agent', 'role-draft']]) {
    const out = await runCli(args, env, 40000, '');
    assert.notEqual(out.code, 0, args.join(' ') + ': ' + out.stdout + out.stderr);
    assert.match(out.stdout, /running but did not answer in time/, args.join(' ') + ': ' + out.stdout + out.stderr);
    assert.doesNotMatch(out.stdout + out.stderr, /Is it running|Start it with/, args.join(' '));
  }
}));

test('#4466 part 6: 8 simultaneous agent restarts over a STALE claim (every outage after the first): exactly one goes ahead', async () => {
  // The claim file outlives each start, so a later outage finds an old claim, not none: the replace
  // path is the common one and must be as atomic as the first create.
  const port = await closedPort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4466-home-'));
  try {
    const old = String(Math.floor(Date.now() / 1000) - 3600) + '\n';
    for (let round = 0; round < 3; round++) {   // three waves: a lucky interleaving once is not a pass
      fs.writeFileSync(path.join(home, 'board.agent-claim'), old);
      fs.writeFileSync(path.join(home, 'board.started-at'), old);
      const out = await bash(`source "${CLI}"
for i in 1 2 3 4 5 6 7 8; do ( ( agent_board_guard restart ) >/dev/null 2>&1 && echo went ) & done
wait`, baseEnv(port, { KOSMOS_HOME: home, KOSMOS_AGENT_SESSION: 'grok-agent' }));
      const went = (out.stdout.match(/^went$/gm) || []).length;
      assert.equal(went, 1, `wave ${round}: exactly one of 8 agent restarts over a stale claim may go ahead (got ${went}): ` + out.stdout + out.stderr);
      assert.equal(fs.existsSync(path.join(home, 'board.agent-claim.lock')), false, 'the lock is released');
      assert.deepEqual(fs.readdirSync(home).filter((f) => f.includes('.new.')), [], 'no temp stamp left behind');
    }
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('#4466 part 6: a claim lock left by a killed agent is cleared once it is old, and does not wedge restarts', async () => {
  const port = await closedPort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4466-home-'));
  try {
    const old = String(Math.floor(Date.now() / 1000) - 3600) + '\n';
    fs.writeFileSync(path.join(home, 'board.agent-claim'), old);
    fs.writeFileSync(path.join(home, 'board.started-at'), old);
    const lock = path.join(home, 'board.agent-claim.lock');
    fs.mkdirSync(lock);
    const env = baseEnv(port, { KOSMOS_HOME: home, KOSMOS_AGENT_SESSION: 'grok-agent' });
    // CONTROL: a FRESH lock (another agent mid-swap) refuses and is left alone.
    const fresh = await bash(`source "${CLI}"; ( agent_board_guard restart ) && echo went`, env);
    assert.doesNotMatch(fresh.stdout, /went/);
    assert.ok(fs.existsSync(lock), 'a fresh lock is not taken from its owner');
    const past = new Date(Date.now() - 5 * 60 * 1000);
    fs.utimesSync(lock, past, past);
    const first = await bash(`source "${CLI}"; ( agent_board_guard restart ) && echo went`, env);
    assert.doesNotMatch(first.stdout, /went/, 'the attempt that clears an old lock still refuses');
    assert.equal(fs.existsSync(lock), false, 'an old lock is cleared');
    const second = await bash(`source "${CLI}"; ( agent_board_guard restart ) && echo went`, env);
    assert.match(second.stdout, /went/, 'the next attempt takes the stale claim');
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
  assert.ok(starts.length >= 1, 'setup.sh must start the board somewhere');   // a vacuous "every" over zero lines
  for (const l of starts) assert.match(l, /KOSMOS_RECLAIM_BUSY=1 "\$KOSMOS_HOME\/bin\/kosmos" start --force/, 'every installer start: ' + l);
  // Its stop and restart calls act on its own board too, so an agent-run install is never refused by the guard.
  const others = setup.split('\n').filter((l) => /"\$KOSMOS_HOME\/bin\/kosmos" (stop|restart)\b/.test(l) && !/^\s*#/.test(l));
  assert.ok(others.length >= 1);
  for (const l of others) assert.match(l, /kosmos" (stop|restart) --force/, 'every installer stop/restart: ' + l);
});
