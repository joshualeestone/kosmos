'use strict';
/**
 * kosmos#6054: an agent stopped on Claude Code's permission prompt is answered from its page. The thread serves the
 * prompt's own options as pressable (`asked` set), a press goes to the pane as the option's bare digit, checked against
 * the screen right before, and words typed while it is up are not typed and never close it (Escape there means No).
 * Measured on Claude Code 2.1.296 (2026-10-13): a bare 1 approved a Write, a bare 3 rejected one, no Enter needed.
 * The screens are the real 2.1.296 captures in test-support/claude-screens.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-perm-6054-'));
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
const status = require('./engine/status');
const fleet = require('./test-support/fleet');

const SCREENS = path.join(__dirname, 'test-support', 'claude-screens');
const BASH = fs.readFileSync(path.join(SCREENS, 'permission-prompt-bash-2.1.296.txt'), 'utf8');
const EDIT = fs.readFileSync(path.join(SCREENS, 'permission-prompt-edit-2.1.296.txt'), 'utf8');
const IDLE = '⏺ Done.\n\n────────\n❯ \n────────\n  ⏸ manual mode on';

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.close(); } catch { /* already down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const post = async (body) => {
  const res = await fetch(`${base}/api/agent/casey/thread`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const getThread = async () => (await fetch(`${base}/api/agent/casey/thread`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();

/* A pane that shows `screen` until a digit or Escape reaches it, then an idle prompt (what Claude Code does). */
async function withPrompt(screen, fn) {
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen })]);
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
  calls.pasted = () => calls.filter((a) => a[0] === 'set-buffer').map((a) => a[a.length - 1]).join('');
  try { return await fn(calls); } finally { chat.resetForTests(); board.restore(); }
}

test('#6054 status: the real permission prompts read as answerable menus, with Claude\'s own options', () => {
  const b = status.claudeAnswerableMenu(BASH);
  assert.ok(b && b.permission, 'the Bash prompt is not answerable');
  assert.deepEqual(b.options.map((o) => o.n), [1, 2, 3, 4]);
  assert.equal(b.options[0].label, 'Yes');
  assert.equal(b.options[3].label, 'No');
  const e = status.claudeAnswerableMenu(EDIT);
  assert.equal(e.question, 'Do you want to create edit-probe.txt?');
  assert.deepEqual(e.options.map((o) => o.label), ['Yes', 'Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab)', 'No']);
  // CONTROL: the question menu's own reader still refuses it (it is not that menu), so the answer comes from the new reader.
  assert.equal(status.claudeQuestionMenu(BASH), null);
});

test('#6054 status: refused when it cannot be sure (each a control against the real screen)', () => {
  const noFooter = EDIT.replace(/Esc to cancel · Tab to amend/, '');
  assert.equal(status.claudePermissionPrompt(noFooter), null, 'read without its footer');
  const twoMarked = EDIT.replace('   3. No', ' ❯ 3. No');
  assert.equal(status.claudePermissionPrompt(twoMarked), null, 'read with two highlighted options');
  const gap = EDIT.replace('   3. No', '   4. No');
  assert.equal(status.claudePermissionPrompt(gap), null, 'read with a gap in its numbering');
  const otherWording = EDIT.replace('Do you want to create edit-probe.txt?', 'Pick a theme');
  assert.equal(status.claudePermissionPrompt(otherWording), null, 'a picker in other wording was read as a permission prompt');
  assert.ok(status.claudePermissionPrompt(EDIT), 'CONTROL: the unchanged screen reads');
});

test('#6054: the thread serves the prompt\'s options as pressable, and a press of Yes goes out as the bare 1', async () => {
  await withPrompt(EDIT, async (calls) => {
    const back = await getThread();
    assert.equal(back.asking, true, 'premise: the agent reads as asking');
    assert.deepEqual(back.options.map((o) => o.n), [1, 2, 3], JSON.stringify(back.options));
    assert.ok(back.asked, 'no asked: the page would draw no buttons for the prompt');
    const r = await post({ text: '1', chose: 'Yes', asked: back.asked });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.delivery.state, 'placed', JSON.stringify(r.json.delivery));
    assert.deepEqual(calls.keys(), ['1'], 'the press did not go out as the bare key');
    assert.equal(calls.pasted(), '', 'the press was pasted');
  });
});

test('#6054: a press of No goes out as No\'s own number (4 on the Bash prompt, not a fixed key)', async () => {
  await withPrompt(BASH, async (calls) => {
    const back = await getThread();
    const no = back.options.find((o) => o.label === 'No');
    assert.equal(no.n, 4, 'premise');
    const r = await post({ text: String(no.n), chose: 'No', asked: back.asked });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(calls.keys(), ['4']);
  });
});

test('#6054: a press whose words the screen no longer shows is refused, and nothing is sent', async () => {
  await withPrompt(EDIT, async (calls) => {
    const back = await getThread();
    const r = await post({ text: '3', chose: 'Yes', asked: back.asked });
    assert.equal(r.status, 409, 'a press whose words the screen contradicts was sent');
    assert.deepEqual(calls.keys(), []);
  });
});

test('#6054: words typed while the prompt is up are not typed, never close it, and are told to use the buttons', async () => {
  await withPrompt(EDIT, async (calls) => {
    const r = await post({ text: 'yes go ahead' });
    assert.equal(calls.keys().filter((k) => k === 'Escape').length, 0, 'Escape (No) was sent to a permission prompt');
    assert.equal(calls.pasted(), '', 'the words were pasted into the prompt');
    const said = JSON.stringify(r.json);
    assert.match(said, /buttons under its question on its page in Kosmos/, 'the refusal does not point at the buttons: ' + said);
    assert.doesNotMatch(said, /in its window/, 'the refusal still points at a window: ' + said);
  });
});

test('#6054: the page ending is said only where buttons are drawn; a prompt whose options cannot be read keeps the window ending', async () => {
  // Two highlighted options: still a permission request by its wording, but its options do not read, so no buttons.
  const unreadable = EDIT.replace('   3. No', ' ❯ 3. No');
  assert.equal(status.claudePermissionPromptKind(unreadable), 'wording', 'premise: still a permission prompt by its wording');
  await withPrompt(unreadable, async (calls) => {
    const back = await getThread();
    assert.ok(!back.asked, 'premise: no buttons are drawn for it');
    const r = await post({ text: 'yes go ahead' });
    const said = JSON.stringify(r.json);
    assert.match(said, /answer it in its window first/, 'a refusal promised buttons the page does not draw: ' + said);
    assert.equal(calls.pasted(), '', 'the words were pasted into the prompt');
  });
});
