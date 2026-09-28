'use strict';
/**
 * #4417: the launch-time idle, RUN (not read). The real bin/agent-supervisor.sh launches an Antigravity agent
 * against a fake tmux that records every call and answers `new-session -P` with a pane id, a fake agy that only
 * answers --version, a sandbox store and agy home, and a stand-in board that records each report WITH the tmux calls
 * made before it arrived. Same harness shape as supervisor.muse-launch-3939.test.js.
 *
 * What only a run can show, and the source pin in engine/agyseed-4417.test.js cannot: that the seed fires when the
 * hook is on, the folder trusted and a sign-in confirmed; that it arrives after the session is claimed; that it
 * carries the pane id new-session printed; and that it does not fire on the adopt path, even with every gate value
 * set in the inherited environment.
 *
 *   node --test supervisor.agyseed-4417.test.js
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const nodePath = require('node:path');
const { spawn } = require('node:child_process');

const SUP = nodePath.join(__dirname, 'bin', 'agent-supervisor.sh');
const ROOT = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-sup-agyseed-4417-'));

const FAKE_TMUX = nodePath.join(ROOT, 'fake-tmux.sh');
fs.writeFileSync(FAKE_TMUX, [
  '#!/bin/bash',
  'printf "%s\\n" "$*" >> "$REC"',
  'case "$1" in',
  '  has-session)',
  '    if [ -n "${ADOPT:-}" ] && [ ! -f "$REC.adopted" ]; then : > "$REC.adopted"; exit 0; fi',
  '    exit 1 ;;',
  '  show-options) [ -n "${ADOPT:-}" ] && printf "%s\\n" "$SESSION_NAME"; exit 0 ;;',
  '  list-panes) exit 0 ;;',
  '  new-session) case " $* " in *" -P "*) printf "%%91\\n" ;; esac; exit 0 ;;',
  '  *) exit 0 ;;',
  'esac',
].join('\n') + '\n', { mode: 0o755 });
const FAKE_AGY = nodePath.join(ROOT, 'agy');
fs.writeFileSync(FAKE_AGY, '#!/bin/sh\n[ "$1" = "--version" ] && { echo 1.2.12; exit 0; }\nexit 0\n', { mode: 0o755 });

function standInBoard(rec) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const calls = fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8') : '';
      seen.push({ url: req.url, body, token: req.headers['x-kosmos-agent-token'] || null, callsBefore: calls });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })));
}

/* One supervisor run. `signedIn` writes (or not) the board's last Antigravity check; `extraEnv` is inherited. */
async function run(name, { signedIn, adopt = false, extraEnv = {}, gitWork = false }) {
  const dir = fs.mkdtempSync(nodePath.join(ROOT, name + '-'));
  const work = nodePath.join(dir, 'work'); fs.mkdirSync(work);
  if (gitWork) fs.mkdirSync(nodePath.join(work, '.git'));   // a folder inside a git project: agyhooks writes no hook
  const data = nodePath.join(dir, 'data');
  fs.mkdirSync(nodePath.join(data, 'Kosmos', 'agy-account'), { recursive: true });
  if (signedIn !== undefined) fs.writeFileSync(nodePath.join(data, 'Kosmos', 'agy-account', 'last.json'), JSON.stringify({ signedIn, at: '2026-09-28T00:00:00Z' }));
  const rec = nodePath.join(dir, 'tmux-calls.txt');
  const board = await standInBoard(rec);
  const session = 'zz-test-4417-' + name;
  const env = {
    /* TMPDIR, so the bridge's throttle marker lands in this process's tmpscope dir, not the real /tmp (review 8). */
    PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: dir, AGENT_WORKFORCE_HOME: dir, AGENT_WORKFORCE_DATA: data,
    AGENT_WORKFORCE_AGY_HOME: nodePath.join(dir, 'agyhome'), KOSMOS_PORT: String(board.port),
    REC: rec, SESSION_NAME: session, ...(adopt ? { ADOPT: '1' } : {}), ...extraEnv,
  };
  const r = await new Promise((resolve) => {
    const child = spawn('/bin/bash', [SUP, session, work, FAKE_AGY, FAKE_TMUX, '', '', 'antigravity'], { env });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    const kill = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.on('close', (code) => { clearTimeout(kill); resolve({ code, err }); });
  });
  board.server.close();
  const reports = board.seen.filter((x) => x.url === '/api/report');
  return { r, reports, calls: fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8') : '', session };
}

test('#4417: a launched, hooked, trusted, signed-in agy agent sends one idle, as the new pane, AFTER its session is claimed', async () => {
  const out = await run('seed', { signedIn: true });
  assert.match(out.calls, /^new-session -d -s \S+ -P -F #\{pane_id\}/m, 'the agy arm did not launch: ' + out.r.err);
  assert.equal(out.reports.length, 1, 'expected exactly one launch-time report, got ' + out.reports.length + ': ' + out.r.err);
  const body = JSON.parse(out.reports[0].body);
  assert.equal(body.state, 'idle');
  assert.equal(body.auto, true);
  assert.equal(body.from_pane, '%91', 'the report is not sent as the pane new-session printed');
  assert.match(out.reports[0].callsBefore, new RegExp('^set-option -t ' + out.session + ' @kosmos_agent ' + out.session + '$', 'm'),
    'the report arrived before the session was claimed, so a real board could not tie it to the agent');
  assert.match(out.reports[0].callsBefore, /^set-option -t \S+ @kosmos_runner antigravity$/m, 'the report arrived before the runner was recorded');
});

test('#4417: no confirmed sign-in, or a sign-in check that said signed out, sends nothing', async () => {
  for (const signedIn of [undefined, false]) {
    const out = await run('nosign', { signedIn });
    assert.match(out.calls, /^new-session /m, 'control: the agy arm launched: ' + out.r.err);
    assert.equal(out.reports.length, 0, 'an idle was sent for an agy with no confirmed sign-in (' + signedIn + ')');
  }
});

test('#4417: a folder agy was not made to trust sends nothing (its settings are a dangling link, so agytrust refuses)', async () => {
  const dir = fs.mkdtempSync(nodePath.join(ROOT, 'badagy-'));
  fs.symlinkSync(nodePath.join(dir, 'gone.json'), nodePath.join(dir, 'settings.json'));
  const out = await run('untrusted', { signedIn: true, extraEnv: { AGENT_WORKFORCE_AGY_HOME: dir } });
  assert.match(out.calls, /^new-session /m, 'control: the agy arm launched: ' + out.r.err);
  assert.equal(out.reports.length, 0, 'an idle was sent while agy would ask to trust the folder');
});

test('#4417: a folder where no hook could be written (inside a git project) sends nothing', async () => {
  const out = await run('nohook', { signedIn: true, gitWork: true });
  assert.match(out.calls, /^new-session /m, 'control: the agy arm launched: ' + out.r.err);
  assert.equal(out.reports.length, 0, 'an idle was sent with no hook in place to ever correct it');
});

test('#4417: the adopt path sends nothing, even with every gate value set in the inherited environment', async () => {
  const out = await run('adopt', {
    signedIn: true, adopt: true,
    extraEnv: { _AGY_HOOKED: 'hooked', _AGY_TRUSTED: 'trusted', _AGY_PANE: '%7', _AGY_BRIDGE: nodePath.join(__dirname, 'bin', 'agy-report-bridge.js') },
  });
  assert.doesNotMatch(out.calls, /^new-session /m, 'control: the adopt path launched a new pane, so this case shows nothing');
  assert.match(out.calls, /^set-option -t \S+ @kosmos_agent /m, 'control: the adopt path still claims the session');
  assert.equal(out.reports.length, 0, 'the adopt path sent a launch-time idle for an agent this run did not launch');
});
