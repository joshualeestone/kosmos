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
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const PAGE = '<title>Kosmos</title>Agent Workforce';

function runCli(args, env, timeout = 40000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '): killed by the harness timeout, over the output buffer, or never started. ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '', ms: Date.now() - t0 });
    });
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

/** A stub board. `health`: 'ok' (the new route), 'slow' (answers after delayMs), 'hang' (never
 *  answers), '404' (an older board), 'stranger' (not ours anywhere). */
async function withBoard(health, fn, delayMs = 5000) {
  const held = [];
  const server = http.createServer((req, res) => {
    const reply = () => {
      if (health === 'stranger') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('hello from another app'); return; }
      if (req.method === 'POST' && req.url.startsWith('/api/post')) {
        req.resume();
        req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"delivery":{"state":"placed"}}'); });
        return;
      }
      if (req.url.startsWith('/api/health')) {
        if (health === '404') { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"app":"kosmos","ok":true}'); return;
      }
      res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE);
    };
    // A busy board is slow at EVERYTHING it serves, the page included (the event loop is shared).
    if (health === 'hang' && req.method === 'GET') { held.push(res); return; }
    if (health === 'slow' && req.method === 'GET') { setTimeout(reply, delayMs); return; }
    reply();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { return await fn(server.address().port); } finally {
    for (const r of held) { try { r.destroy(); } catch { /* gone */ } }
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
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
  return { ...env, KOSMOS_PORT: String(port), KOSMOS_NO_LEGACY_MIGRATION: '1', ...extra };
}
const START_ADVICE = /Start it with|kosmos start|kosmos restart/;

test('#4466 slow board: `kosmos status` waits, says busy on stderr, and reports RUNNING', () => withBoard('slow', async (port) => {
  const out = await runCli(['status'], baseEnv(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Kosmos is running at/);
  assert.match(out.stderr, /Kosmos is busy, retrying/);
  assert.ok(out.ms >= 4000, `it must actually have waited for the slow answer (took ${out.ms} ms)`);
}));

test('#4466 slow board: `kosmos post` waits and the post SUCCEEDS', () => withBoard('slow', async (port) => {
  const out = await runCli(['post', 'proj', 'a message worth posting'], baseEnv(port, { TMUX_PANE: '%42' }));
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
  assert.ok(status.ms < 3000, `a refused connection must not wait (took ${status.ms} ms)`);
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
