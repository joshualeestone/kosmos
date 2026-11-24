'use strict';
/**
 * kosmos#8952, through the REAL routes: since the "↑ N more lines" scroll line is skipped, a box whose top scrolled away
 * reads as a permission prompt (status.permscroll-8952.test.js). It still gets nothing to press: no Allow or Deny on the
 * phone's notice, no `asked` identity on the thread (so no buttons, board or phone), and a pressed digit sends no key.
 * CONTROL: the whole box with the same line is pressable. Harness from server.phonenotice-permission-7017.test.js.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-permscroll-8952-'));
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
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const chat = require('./engine/chat');
const selfreport = require('./engine/selfreport');
const fleet = require('./test-support/fleet');

const SCREENS = path.join(__dirname, 'test-support', 'claude-screens');
const BASH = fs.readFileSync(path.join(SCREENS, 'permission-prompt-bash-2.1.296.txt'), 'utf8');
const IDLE = '⏺ Done.\n\n────────\n❯ \n────────\n  ⏸ manual mode on';

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* already down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const notice = async (id) => {
  const res = await fetch(base + '/api/phone/notice?id=' + encodeURIComponent(id));
  return { status: res.status, json: await res.json().catch(() => null) };
};
const post = async (body) => {
  const res = await fetch(`${base}/api/agent/casey/thread`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const getThread = async () => (await fetch(`${base}/api/agent/casey/thread`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();

/* The permission hook's needs_you (auto), or an agent's own (auto=false), as recorded; its id is what phonenotify sends. */
function reportId(auto = true, because = 'Claude needs your permission to use Bash') {
  // A working report first: an automatic wait never overwrites an agent's own needs_you (selfreport), as in life.
  selfreport.record('casey', { state: 'working', because: 'on it' });
  const kept = selfreport.record('casey', { state: 'needs_you', because, ...(auto ? { auto: true } : {}) });
  assert.ok(kept && kept.at, 'premise: the report was recorded: ' + JSON.stringify(kept));
  return 'report:' + kept.at + ':casey';
}

/* A pane that shows `screen` until a digit or Escape reaches it, then an idle prompt (what Claude Code does). */
async function withPrompt(screen, fn, state = 'needs_you') {
  const board = fleet.install([fleet.agent('casey', { state, runner: 'claude', command: 'claude', screen })]);
  let now = screen;
  const calls = [];
  chat.setRunner((args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.296\t\t0\n', err: '' };
    if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: now, err: '' };
    if (args[0] === 'send-keys' && /^(\d|Escape)$/.test(args[args.length - 1])) now = IDLE;
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  chat.setPauser(() => {});
  calls.keys = () => calls.filter((a) => a[0] === 'send-keys').map((a) => a[a.length - 1]);
  try { return await fn(calls); } finally { chat.resetForTests(); board.restore(); }
}

// The real screen with the scroll line just under its "4. No"; cut = its full-width top rule gone (scrolled away).
function withScroll(screen) {
  const lines = screen.split('\n');
  const no = lines.findIndex((l) => /^\s*4\.\s+No\b/.test(l));
  assert.ok(no > 0, 'premise: the capture has its "4. No" option');
  return [...lines.slice(0, no + 1), '  ↑ 37 more lines', ...lines.slice(no + 1)].join('\n');
}
const CUT = withScroll(BASH).split('\n').filter((l) => !/^─{8,}/.test(l)).join('\n');

test('#8952: a cut-off box with the scroll line offers nothing to press, on the notice or the thread, and a digit sends no key', async () => {
  assert.equal(chat.permissionAnswerable(CUT), false, 'premise: the cut box is not answerable');
  await withPrompt(CUT, async (calls) => {
    const r = await notice(reportId());
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal('permission' in r.json, false, 'permission offered: ' + JSON.stringify(r.json.permission));
    const thread = await getThread();
    assert.equal(thread.asked, null, 'an identity to press with was served for a box whose top scrolled away');
    // With the screen's REAL identity, so the refusal is the #6054 gate (a box whose top scrolled away), not a mismatch.
    const asked = chat.questionAbove(chat.questionIn(CUT, 'claude').text);
    assert.ok(asked, 'premise: the cut box has an identity to press with');
    const p = await post({ text: '1', chose: 'Yes', asked });
    assert.equal(p.status, 409, 'a Yes was accepted: ' + JSON.stringify(p.json));
    assert.match(String(p.json && (p.json.error || p.json.because || JSON.stringify(p.json))), /could not tell which request/,
      'refused for another reason: ' + JSON.stringify(p.json));
    assert.deepEqual(calls.keys(), [], 'a key reached the pane');
  });
});

test('#8952 CONTROL: the whole box is pressable, so the test above can fail', async () => {
  /* slice (d) review 5: the whole box WITHOUT the scroll line. A box carrying Claude Code's own "more lines" hint is one it
     says it did not draw whole, so it is not answerable even with a top above it (chat.permissionAnswerable). */
  const whole = BASH;
  assert.equal(chat.permissionAnswerable(whole), true, 'premise');
  await withPrompt(whole, async () => {
    const r = await notice(reportId());
    assert.ok(r.json && r.json.permission, 'no permission on the whole box: ' + JSON.stringify(r.json));
    assert.equal(typeof (await getThread()).asked, 'string');
  });
});
