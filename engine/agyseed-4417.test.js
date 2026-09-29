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

function runBridge(event, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BRIDGE_FILE, event], { env, stdio: ['ignore', 'pipe', 'pipe'] });   // </dev/null, as the supervisor runs it
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

test('#4417: the launch event reports idle from the new pane, with its launch token', async () => {
  const board = await standInBoard();
  const pane = '%seed-' + process.pid;
  /* An empty store root, so the child finds no board token of this Mac's to send to the stand-in (review 1). */
  const data = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'aw-agyseed-data-'));
  const env = { ...process.env, AGENT_WORKFORCE_DATA: data, KOSMOS_PORT: String(board.port), TMUX_PANE: pane, KOSMOS_AGENT_TOKEN: 'abc123' };
  try {
    const r = await runBridge(bridge.LAUNCH_EVENT, env);
    assert.equal(r.code, 0);
    const reports = board.seen.filter((x) => x.url === '/api/report');
    assert.equal(reports.length, 1, 'a launched agy agent told the board nothing, so it reads "Can\'t tell" until its first turn');
    const body = JSON.parse(reports[0].body);
    assert.equal(body.state, 'idle');
    assert.equal(body.auto, true, 'a launch report without auto could erase a blocked the agent filed');
    assert.equal(body.from_pane, pane, 'the report is not identified as the new pane');
    assert.equal(reports[0].headers['x-kosmos-agent-token'], 'abc123', 'the launch token did not travel, so an enforcing board refuses it');
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
  assert.match(gate, /case "\$_x" in KOSMOS_\*=\*\|AGENT_WORKFORCE_\*=\*\|HOME=\*\) _AGY_SEED_ENV\+=\("\$_x"\) ;; esac/,
    'the seed adds more of the pane\'s env list than the bridge reads (the list also carries API keys)');
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
  const run = (d) => spawnSync(process.execPath, [path.join(__dirname, 'agytrust.js'), d], { encoding: 'utf8', env: { ...process.env, AGENT_WORKFORCE_AGY_HOME: home } });
  const ok = run(dir);
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout.trim(), 'trusted', 'control: a folder it could trust says so');
  const missing = run(path.join(dir, 'no-such-folder'));
  assert.equal(missing.status, 0, 'a folder it cannot trust must never stop the launch');
  assert.equal(missing.stdout.trim(), '', 'a folder agy will ask about says `trusted`, and the supervisor would seed idle over the prompt');
});
