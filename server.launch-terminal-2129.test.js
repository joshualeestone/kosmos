/**
 * THE #2129 LAUNCH-TERMINAL ROUTE + engine/terminal.js.
 * POST /api/agent/:name/launch-terminal.
 *
 * The route opens a Terminal.app window attached to a live agent's tmux
 * session. Two properties matter and a source regex sees neither:
 *   1. it only opens a window for a LIVE, ours agent -- a not-running or
 *      not-confirmably-ours agent is refused and NO osascript runs; and
 *   2. the command handed to Terminal is SHELL-QUOTED, so a session name can
 *      never break out of `tmux attach -t <session>` into the shell. The
 *      SAFE_SESSION guard is belt-and-braces on top (paneRoster only calls a
 *      `<NAME_RE>-discord` session ours), and this pins that it actually fires.
 *
 * The osascript call is intercepted by terminal.setRunner so no test opens a
 * real window; the HTTP arms drive the whole route with a fake tmux + fake
 * panes so the live-session resolution (paneRoster) runs for real.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-launch-term-2129-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
for (const d of [HOME, BIN, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'),
  nodePath.join(SANDBOX, 'launch'), nodePath.join(SANDBOX, 'projects')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
delete process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CLAUDE_BIN, TMUX_BIN]) {
  fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
}
process.env.AGENT_WORKFORCE_CLAUDE_BIN = CLAUDE_BIN;

const FAKE_TMUX = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');
const PANES = nodePath.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_TMUX_BIN = FAKE_TMUX;
process.env.AGENT_WORKFORCE_FAKE_PANES = PANES;

const fleet = require('./test-support/fleet');
const create = require('./engine/create');
const status = require('./engine/status');
const terminal = require('./engine/terminal');
const store = require('./engine/store');

/* Capture the osascript the route would run, and never open a window. */
let lastRun = null;
terminal.setRunner((file, args) => { lastRun = { file, args }; return { ok: true }; });

function born(name) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, CLAUDE_BIN, TMUX_BIN, null, null, 'claude'), 'utf8');
  store.writeProfile(name, { provider: 'anthropic' });
  fs.writeFileSync(PANES, fleet.line({ session: name + '-discord', title: 'working' }) + '\n');
  return name;
}

const { start, server } = require('./server');
let base = '';

test.before(async () => {
  await start(0);
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => {
  try { server.close(); } catch { /* going away anyway */ }
  terminal.setRunner(null);
});

async function launch(name) {
  const res = await fetch(base + '/api/agent/' + encodeURIComponent(name) + '/launch-terminal', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  return { status: res.status, body: await res.json() };
}

test('a live agent: opens Terminal attached to its session, command is shell-quoted', async () => {
  lastRun = null;
  const name = 'lt-live';
  born(name);
  const r = await launch(name);

  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(r.body.session, name + '-discord', 'the route did not report the agent\'s real session: ' + JSON.stringify(r.body));

  /* The osascript actually ran, as an `osascript -e <applescript>`. */
  assert.ok(lastRun, 'no osascript call was made for a live agent');
  assert.equal(lastRun.file, 'osascript');
  assert.equal(lastRun.args[0], '-e');
  const script = lastRun.args[1];
  /* It tells Terminal to attach to THIS session, via the agent's tmux binary,
     and every value that reaches the shell is single-quoted -- so a session
     name could not break out of the command. */
  assert.match(script, /do script/);
  assert.ok(script.includes(`attach -t '${name}-discord'`),
    'the attach command is not present or not single-quoted: ' + script);
  assert.ok(script.includes(`exec '${TMUX_BIN}'`),
    'the tmux binary is not present or not single-quoted: ' + script);
});

test('a stopped agent: refuses, and NO terminal is opened', async () => {
  lastRun = null;
  /* An agent with a job but NO live pane. Clear the pane file so paneRoster
     finds nothing under its name. */
  const name = 'lt-stopped';
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(create.plistPath(name), create.plistFor(name, CLAUDE_BIN, TMUX_BIN, null, null, 'claude'), 'utf8');
  store.writeProfile(name, { provider: 'anthropic' });
  fs.writeFileSync(PANES, '');

  const r = await launch(name);
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.ok, false, JSON.stringify(r.body));
  assert.match(String(r.body.because || ''), /not running/, JSON.stringify(r.body));
  assert.equal(lastRun, null, 'a terminal was opened for a stopped agent -- nothing should have run');
});

/* --- module-level arms: force states paneRoster cannot honestly produce, to
   prove the two guards that protect the shell command. paneRoster is stubbed
   synchronously and restored in the same test body (openTerminal is sync). --- */

test('SAFE_SESSION guard: a hostile session name is refused, no osascript runs', () => {
  lastRun = null;
  const orig = status.paneRoster;
  status.paneRoster = () => ([{
    sessionName: 'evil',
    /* A name that, unquoted, would run `rm -rf ~` after the attach. It can
       never be `isNamedOurs` in reality (that requires <NAME_RE>-discord), so
       this arm forces the belt-and-braces guard to be the thing that refuses. */
    session: "evil'; rm -rf ~; '",
    isNamedOurs: true,
  }]);
  try {
    const out = terminal.openTerminal('evil');
    assert.equal(out.ok, false, 'a hostile session name was accepted: ' + JSON.stringify(out));
    assert.match(out.because, /will not hand to a terminal/, JSON.stringify(out));
    assert.equal(lastRun, null, 'osascript ran for a hostile session -- the guard did not stop it');
  } finally {
    status.paneRoster = orig;
  }
});

test('fail closed: if we cannot ask tmux, we refuse rather than guess', () => {
  lastRun = null;
  const orig = status.paneRoster;
  status.paneRoster = () => { throw new Error('tmux is not answering'); };
  try {
    const out = terminal.openTerminal('whoever');
    assert.equal(out.ok, false, JSON.stringify(out));
    assert.match(out.because, /could not check/, JSON.stringify(out));
    assert.equal(lastRun, null, 'osascript ran despite not being able to confirm the agent is live');
  } finally {
    status.paneRoster = orig;
  }
});

test('a name we cannot read never reaches the engine', () => {
  /* decodeSegment returns null for a name that is not readable; the route
     answers 400 before openTerminal. Driven at the module boundary here: an
     empty name is cleaned to '' and finds no card. */
  lastRun = null;
  const orig = status.paneRoster;
  status.paneRoster = () => ([]);
  try {
    const out = terminal.openTerminal('');
    assert.equal(out.ok, false);
    assert.equal(lastRun, null);
  } finally {
    status.paneRoster = orig;
  }
});
