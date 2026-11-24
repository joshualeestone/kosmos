'use strict';
/**
 * kosmos#9001 (Josh, 11-24 12:44: "I keep getting these"): Claude Code's own safety check on a shell command it cannot
 * read the way the shell will declines by itself in about two minutes ("Claude Code will automatically block this request
 * in 1:59"). Its PermissionRequest hook still fired a needs_you, so Kosmos pushed it to the phone as "asking permission"
 * and showed "Needs permission", for a prompt nobody needs to answer. Now that report is recorded as the plain line it is
 * (working), with no push, and the board's screen reader says the same; a prompt that waits for a person still pushes.
 *
 * The screens are real captures (Claude Code 2.1.331, both in bypass mode, measured 2026-11-24): the self-declining
 * safety check, and a prompt from a permission rule (`ask`), which has no timed line (the control).
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-9001-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const selfreport = require('./engine/selfreport');
const sendertoken = require('./engine/sendertoken');
const phonenotify = require('./engine/phonenotify');
const chat = require('./engine/chat');
const status = require('./engine/status');

const SCREENS = path.join(__dirname, 'test-support', 'claude-screens');
const SELF_EXPIRING = fs.readFileSync(path.join(SCREENS, 'permission-prompt-self-expiring-2.1.331.txt'), 'utf8');
const ASK_RULE = fs.readFileSync(path.join(SCREENS, 'permission-prompt-ask-rule-bypass-2.1.331.txt'), 'utf8');
const WHO = 'casey';
const HOOK_TEXT = 'asking permission to use Bash: cd /tmp/work && for f in ${(f)"$(ls)"}; do rm -rf "$f"; done';

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.close(); } catch { /* already down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

let TOKEN = '';
async function report(body) {
  const res = await fetch(base + '/api/report', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': TOKEN }, body: JSON.stringify(body) });
  return res.json();
}

/* One agent whose screen is `screen`, every push this route asks for recorded, and the agent's report state fresh. */
async function withAgent(screen, fn, { runner = 'claude', state = 'working' } = {}) {
  // A clean start: an agent-typed working report (an automatic one cannot replace a standing wait, by design).
  selfreport.record(WHO, { state: 'working', because: 'starting a test' });
  const board = fleet.install([fleet.agent(WHO, { state, runner, command: runner === 'claude' ? 'claude' : 'node', screen })]);
  chat.setRunner((args) => {
    if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: screen, err: '' };
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.331\t\t0\n', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  const pushes = [];
  const real = phonenotify.happened;
  phonenotify.happened = (ev) => { pushes.push(ev); return true; };
  try {
    TOKEN = sendertoken.mint(WHO).token;
    await fn(pushes);
  } finally {
    phonenotify.happened = real;
    chat.setRunner(null);
    board.restore();
  }
}

test('premises, on the real captures', () => {
  const P = { command: '2.1.331', title: 'x', session: 'x', name: 'x' };
  assert.ok(status.claudePermissionPrompt(SELF_EXPIRING), 'the safety check reads as a permission prompt');
  assert.equal(status.claudeSelfExpiringPrompt(SELF_EXPIRING), true);
  assert.equal(status.claudeSelfExpiringPrompt(ASK_RULE), false, 'a rule prompt in the same mode has no timed line');
  assert.match(SELF_EXPIRING, /will automatically block this request in/);
  // The board's own read of each screen: the safety check is working with the line; the rule prompt still asks.
  assert.deepEqual(status.classify(P, SELF_EXPIRING), { state: status.STATE.WORKING, confidence: 'scraped', because: status.SELF_EXPIRING_DECLINE });
  assert.equal(status.classify(P, ASK_RULE).state, status.STATE.NEEDS_YOU);
  assert.equal(status.classify(P, ASK_RULE).because, status.APPROVAL_WAITING);
});

test('the hook\'s wait for a self-declining safety check is recorded as the plain line: working, no push', async () => {
  await withAgent(SELF_EXPIRING, async (pushes) => {
    const r = await report({ state: 'needs_you', text: HOOK_TEXT, auto: true });
    assert.equal(r.recorded, true, JSON.stringify(r));
    const now = selfreport.read(WHO);
    assert.equal(now.state, 'working', 'never a needs_you');
    assert.equal(now.because, status.SELF_EXPIRING_DECLINE);
    assert.equal(selfreport.isAutoPermissionWait(now), false, 'nothing for the phone notice or "Needs permission" to key on');
    assert.deepEqual(pushes, [], 'no phone push');
  });
});

test('CONTROL: a prompt that waits for a person (a permission rule) still records needs_you and pushes', async () => {
  await withAgent(ASK_RULE, async (pushes) => {
    const r = await report({ state: 'needs_you', text: 'asking permission to use Bash: touch /tmp/work/control-file', auto: true });
    assert.equal(r.recorded, true, JSON.stringify(r));
    assert.equal(selfreport.read(WHO).state, 'needs_you');
    assert.equal(pushes.length, 1, 'pushed as before');
    assert.equal(pushes[0].kind, 'needs_you');
  }, { state: 'needs_you' });
});

test('only the hook\'s own permission wait from a Claude agent is read this way', async () => {
  // An agent's own question, even with the safety screen up, is the agent asking: kept and pushed.
  await withAgent(SELF_EXPIRING, async (pushes) => {
    await report({ state: 'needs_you', text: 'Which folder should I clear?' });
    assert.equal(selfreport.read(WHO).state, 'needs_you');
    assert.equal(pushes.length, 1);
  });
  // Another runner's agent is never judged by Claude Code's screen.
  await withAgent(SELF_EXPIRING, async (pushes) => {
    await report({ state: 'needs_you', text: HOOK_TEXT, auto: true });
    assert.equal(selfreport.read(WHO).state, 'needs_you');
    assert.equal(pushes.length, 1);
  }, { runner: 'codex' });
});

test('a screen that cannot be read keeps the report as sent (any doubt pushes, as before)', async () => {
  await withAgent(SELF_EXPIRING, async (pushes) => {
    chat.setRunner((args) => (args[0] === 'capture-pane' ? { ran: true, spawnFailed: false, status: 1, out: '', err: 'no pane' } : { ran: true, spawnFailed: false, status: 0, out: '', err: '' }));
    await report({ state: 'needs_you', text: HOOK_TEXT, auto: true });
    assert.equal(selfreport.read(WHO).state, 'needs_you');
    assert.equal(pushes.length, 1);
  });
});
