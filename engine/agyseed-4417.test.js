'use strict';
/**
 * #4417 (from #4414, Josh 2026-09-28 15:15: one Gemini agent "didn't update its status indicator", even after
 * a restart): agy has no session-start hook, only PreInvocation (working) and Stop (idle), so an Antigravity
 * agent just (re)started and not yet spoken to sent the board nothing and read "Can't tell" until its first
 * message. The supervisor now sends one idle report the moment the pane is up, through the same bridge.
 *
 * The bridge half is RUN here against a local stand-in board (the report it sends is the product). The
 * supervisor half needs tmux and agy, so its order is pinned in source, as engine/agyhooks.test.js pins the
 * hook write; it was run end to end in a sandbox on #4417 (a real supervisor, a fake agy, tmux on a private
 * socket): main sent nothing, this branch sent one idle report from the new pane with its launch token.
 *
 *   node --test engine/agyseed-4417.test.js
 */
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
    const started = Date.now();
    const child = spawn(process.execPath, [BRIDGE_FILE, event], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out, ms: Date.now() - started }));
  });
}

test('#4417: the launch event reports idle from the new pane, with its launch token, and waits for no payload', async () => {
  const board = await standInBoard();
  const pane = '%seed-' + process.pid;
  const env = { ...process.env, KOSMOS_PORT: String(board.port), TMUX_PANE: pane, KOSMOS_AGENT_TOKEN: 'abc123' };
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
    assert.ok(r.ms < 1900, 'the launch report waited for a payload the supervisor never sends (' + r.ms + ' ms)');
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

test('#4417: the supervisor seeds idle right after it starts the agy pane, as that pane, and never fails the launch (SOURCE pin)', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'bin', 'agent-supervisor.sh'), 'utf8');
  const at = sh.indexOf('elif [ "$RUNNER" = antigravity ]; then');
  assert.ok(at > -1, 'the antigravity branch moved: re-anchor this pin');
  const end = sh.indexOf('elif [ "$RUNNER" = muse ]; then', at);
  assert.ok(end > at, 'the branch after antigravity moved: re-anchor this pin');
  const branch = sh.slice(at, end);
  const launch = branch.indexOf('new-session');
  const seed = branch.indexOf('"$NODE_BIN" "$_AGY_BRIDGE" KosmosLaunch </dev/null >/dev/null 2>&1 || true');
  assert.ok(seed > -1, 'the supervisor no longer tells the board an agy agent is up');
  assert.ok(launch > -1 && seed > launch, 'the seed must follow the launch: before it there is no pane to report as');
  assert.match(branch.slice(launch, seed), /_AGY_PANE="\$\("\$TMUX_BIN" display-message -p -t "\$SESSION" '#\{pane_id\}'/, 'the report is not sent as the new pane');
  assert.match(branch.slice(launch, seed), /for _x in \$\{PANE_ENV\[@\]\+"\$\{PANE_ENV\[@\]\}"\}; do \[ "\$_x" = "-e" \] \|\| _AGY_SEED_ENV\+=\("\$_x"\); done/,
    'the seed does not carry the pane\'s env (token, port, world), so an enforcing board refuses it');
  assert.ok(branch.indexOf('unset _AGY_BRIDGE') > seed, 'the bridge path is unset before the seed can use it');
});

test('#4417: the instrument is reading the real files', () => {
  assert.ok(fs.statSync(BRIDGE_FILE).size > 5000);
  assert.ok(fs.statSync(path.join(__dirname, '..', 'bin', 'agent-supervisor.sh')).size > 20000);
});
