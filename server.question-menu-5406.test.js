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
  // A number that is not an answer ("0", or "4. Type something.") is a message too, so it closes the menu first.
  await withMenu(async (calls) => {
    await post({ text: '0' });
    assert.equal(calls.keys()[0], 'Escape', '"0" was sent as a key');
  });
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
  const PERM = 'Bash command\n\n  rm photo.jpg\n\nDo you want to proceed?\n❯ 1. Yes\n  2. No\n\nEnter to select · ↑/↓ to navigate · Esc to cancel';
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

test('#5406 review 2: a Codex card whose screen ends like this menu is not answered by these keys', async () => {
  /* The board does not read this screen as asking on a Codex card (measured: "unknown"), so the route's capture never
     happens; the route's own Claude-only check is a second layer this test cannot reach on its own. */
  const board = fleet.install([fleet.agent('casey', { state: 'unknown', runner: 'codex', command: 'node', screen: MENU })]);
  try {
    const calls = [];
    chat.setRunner((args) => { calls.push(args); return args[0] === 'display-message'
      ? { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' }
      : { ran: true, spawnFailed: false, status: 0, out: args[0] === 'capture-pane' ? MENU : '', err: '' }; });
    chat.setDryRun(false); chat.setPauser(() => {});
    await post({ text: '2' });
    assert.equal(calls.filter((a) => a[0] === 'send-keys' && /^(2|Escape)$/.test(a[a.length - 1])).length, 0, 'a Claude menu key went to a Codex card');
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5406 review 3: a question that changed between the read and the key is refused; a failed message says the question was closed', async () => {
  const OTHER = MENU.replace('Which fruit do you want?', 'Which colour do you want?');
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: MENU })]);
  try {
    const screens = [MENU, OTHER];
    const calls = [];
    chat.setRunner((args) => { calls.push(args); if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: screens.length > 1 ? screens.shift() : screens[0], err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' }; });
    chat.setDryRun(false); chat.setPauser(() => {});
    const r = await post({ text: '2' });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(calls.filter((a) => a[0] === 'send-keys').length, 0, 'a key went to a question the person did not see');
  } finally { chat.resetForTests(); board.restore(); }
  const b2 = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: MENU })]);
  try {
    let screen = MENU;
    chat.setRunner((args) => { if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: screen, err: '' };
      if (args[0] === 'send-keys' && args[args.length - 1] === 'Escape') { screen = IDLE; return { ran: true, spawnFailed: false, status: 0, out: '', err: '' }; }
      if (args[0] === 'set-buffer' || args[0] === 'paste-buffer' || args[0] === 'load-buffer') return { ran: true, spawnFailed: false, status: 1, out: '', err: 'no such pane' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' }; });
    chat.setDryRun(false); chat.setPauser(() => {});
    const r = await post({ text: 'something else' });
    assert.notEqual(r.json.delivery.state, 'placed', JSON.stringify(r.json));
    assert.match(r.json.delivery.because, /Its question was closed before this was sent/);
  } finally { chat.resetForTests(); b2.restore(); }
});

test('#5406 slice C: the thread GET serves the menu\'s options and its identity (asked), the twin of what a press is checked against', async () => {
  await withMenu(async () => {
    const back = await (await fetch(`${base}/api/agent/casey/thread`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();
    assert.equal(back.asking, true);
    assert.deepEqual(back.options, [{ n: 1, label: 'Apple' }, { n: 2, label: 'Banana' }, { n: 3, label: 'Cherry' }]);
    assert.equal(back.asked, 'Which fruit do you want?');
    // CONTROL: the identity it serves is the one a press must send; a press with it goes through.
    const r = await post({ text: '1', chose: 'Apple', asked: back.asked });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  });
});

test('#5406 slice C: the setup guide\'s thread serves no asked (everything there is masked, #3769), so it draws no buttons', async () => {
  const instructions = require('./engine/instructions');
  const setupAssistant = require('./engine/setup-assistant');
  await withMenu(async () => {
    const dir = path.dirname(instructions.fileFor('casey'));
    fs.mkdirSync(dir, { recursive: true });
    const marker = path.join(dir, setupAssistant.GUIDE_MARKER);
    fs.writeFileSync(marker, 'casey\n');
    try {
      const back = await (await fetch(`${base}/api/agent/casey/thread`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();
      assert.equal(back.asking, true, 'premise: the guide is asking');
      assert.equal(back.asked, null, 'unmasked screen text left the guide\'s thread');
    } finally { fs.rmSync(marker, { force: true }); }
    // CONTROL: without the marker the same thread serves it.
    const plain = await (await fetch(`${base}/api/agent/casey/thread`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();
    assert.equal(plain.asked, 'Which fruit do you want?');
  });
});

test('#5406 slice C: the folder-trust dialog (as observed, 2.1.29x) draws no buttons: no options and no asked are served', async () => {
  const TRUST = [' Accessing workspace:', '', ' /Users/someone/work/proj', '',
    ' Quick safety check: Is this a project you created or one you trust?', '',
    ' Claude Code\'ll be able to read, edit, and execute files here.', '', ' Security guide', '',
    ' ❯ No, exit', '   Yes, I trust this folder', '', ' Enter to confirm · Esc to cancel'].join('\n');
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: TRUST })]);
  try {
    chat.setRunner((args) => {
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: TRUST, err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false);
    const back = await (await fetch(`${base}/api/agent/casey/thread`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();
    assert.ok(back.answerNote, 'premise: the route read this as the trust dialog');
    assert.equal(back.options, null, 'the trust dialog was offered as answer buttons');
    assert.equal(back.asked, null);
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5406 slice C: buttons are for Claude agents only (the key-answer path is Claude\'s), so another runner gets no asked', async () => {
  const LIST = MENU;   // the same screen; only the runner differs
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'gemini', command: 'claude', screen: LIST })]);
  try {
    chat.setRunner((args) => {
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: LIST, err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false);
    const back = await (await fetch(`${base}/api/agent/casey/thread`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();
    assert.ok(Array.isArray(back.options) && back.options.length === 3, 'premise: a numbered list read as options: ' + JSON.stringify(back.options));
    assert.equal(back.asked, null, 'a non-Claude agent was offered answer buttons');
  } finally { chat.resetForTests(); board.restore(); }
});
