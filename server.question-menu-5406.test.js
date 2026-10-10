'use strict';
/**
 * kosmos#5406 part 2: the direct-message route answers Claude Code's question menu by key. While that menu is the live
 * screen, a reply that is one of its numbers (typed, or a button with its words) is sent as the bare digit, nothing
 * pasted; any other reply closes the menu with Escape first and then goes as a message. Measured on Claude Code 2.1.29x:
 * the message path's paste is ignored by the menu and its Enter takes the HIGHLIGHTED option.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-qmenu-5406-'));
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
const fleet = require('./test-support/fleet');

const MENU = fs.readFileSync(path.join(__dirname, 'test-support', 'claude-screens', 'question-menu-2.1.29x.txt'), 'utf8');
const IDLE = '⏺ Banana\n\n────────\n❯ \n────────\n  bypass permissions on (shift+tab to cycle)';

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.close(); } catch { /* already down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const post = async (body) => {
  const res = await fetch(`${base}/api/agent/casey/thread`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
/* A pane that shows the menu until a digit or Escape reaches it, then an idle prompt (what Claude Code does). */
function armPane() {
  let screen = MENU;
  const calls = [];
  chat.setRunner((args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: screen, err: '' };
    if (args[0] === 'send-keys' && /^(\d|Escape)$/.test(args[args.length - 1])) screen = IDLE;
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  chat.setPauser(() => {});
  calls.keys = () => calls.filter((a) => a[0] === 'send-keys').map((a) => a[a.length - 1]);
  calls.pasted = () => calls.filter((a) => a[0] === 'set-buffer').map((a) => a[a.length - 1]).join('');
  return calls;
}
async function withMenu(fn) {
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: MENU })]);
  try { return await fn(armPane()); } finally { chat.resetForTests(); board.restore(); }
}

test('#5406: a typed number answers the menu with the bare key, nothing pasted, and the bubble shows the choice', async () => {
  await withMenu(async (calls) => {
    const r = await post({ text: '2' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(calls.keys(), ['2'], 'not exactly the bare key');
    assert.equal(calls.pasted(), '', 'text was pasted into the menu');
    assert.equal(r.json.delivery.state, 'placed');
  });
});

test('#5406: a button press with its words is checked and sent as the key; a stale one is refused', async () => {
  await withMenu(async (calls) => {
    const r = await post({ text: '3', chose: 'Cherry', asked: 'Which fruit do you want?' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(calls.keys(), ['3']);
  });
  await withMenu(async (calls) => {
    const r = await post({ text: '3', chose: 'Mango', asked: 'Which fruit do you want?' });
    assert.equal(r.status, 409, 'a button whose words the screen contradicts was sent');
    assert.deepEqual(calls.keys(), []);
  });
});

test('#5406: any other reply closes the menu with Escape first, then goes as a message', async () => {
  await withMenu(async (calls) => {
    const r = await post({ text: 'none of those, I want a mango' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const keys = calls.keys();
    assert.equal(keys[0], 'Escape', 'the menu was not closed first: ' + JSON.stringify(keys));
    assert.match(calls.pasted(), /I want a mango/, 'the message did not go after the menu closed');
  });
  // A number that is not an answer ("4. Type something.") is a message too, so it closes the menu first.
  await withMenu(async (calls) => {
    await post({ text: '4' });
    assert.equal(calls.keys()[0], 'Escape', '"4" was sent as a key to "Type something."');
  });
});

test('#5406 review 1: the record keeps the choice\'s words and the digit; an answer the menu kept is unconfirmed', async () => {
  await withMenu(async () => {
    const r = await post({ text: '2' });
    assert.equal(r.status, 200);
    const back = await (await fetch(`${base}/api/agent/casey/thread`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();
    const row = back.messages[back.messages.length - 1];
    assert.deepEqual([row.text, row.wire], ['Banana', '2'], JSON.stringify(row));
  });
  // A pane that stays on the menu after the key: not "placed".
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: MENU })]);
  try {
    chat.setRunner((args) => (args[0] === 'display-message'
      ? { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' }
      : { ran: true, spawnFailed: false, status: 0, out: args[0] === 'capture-pane' ? MENU : '', err: '' }));
    chat.setDryRun(false); chat.setPauser(() => {});
    const r = await post({ text: '1' });
    assert.equal(r.json.delivery.state, 'unconfirmed', JSON.stringify(r.json));
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5406 review 1: Escape that does not close the menu sends nothing; a permission prompt is untouched', async () => {
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: MENU })]);
  try {
    const calls = [];
    chat.setRunner((args) => { calls.push(args); return args[0] === 'display-message'
      ? { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' }
      : { ran: true, spawnFailed: false, status: 0, out: args[0] === 'capture-pane' ? MENU : '', err: '' }; });
    chat.setDryRun(false); chat.setPauser(() => {});
    const r = await post({ text: 'something else' });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(calls.filter((a) => a[0] === 'set-buffer').length, 0, 'the message was pasted into a menu that stayed');
  } finally { chat.resetForTests(); board.restore(); }
  const PERM = 'Bash command\n\n  rm photo.jpg\n\nDo you want to proceed?\n❯ 1. Yes\n  2. No\n\nEsc to cancel';
  const b2 = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: PERM })]);
  try {
    const calls = [];
    chat.setRunner((args) => { calls.push(args); return args[0] === 'display-message'
      ? { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' }
      : { ran: true, spawnFailed: false, status: 0, out: args[0] === 'capture-pane' ? PERM : '', err: '' }; });
    chat.setDryRun(false); chat.setPauser(() => {});
    await post({ text: 'yes go ahead' });
    assert.equal(calls.filter((a) => a[0] === 'send-keys' && a[a.length - 1] === 'Escape').length, 0, 'Escape was sent to a permission prompt');
  } finally { chat.resetForTests(); b2.restore(); }
});
