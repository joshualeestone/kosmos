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
  await withMenu(async (calls) => {
    const back = await (await fetch(`${base}/api/agent/casey/thread`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();
    assert.equal(back.asking, true);
    assert.deepEqual(back.options, [{ n: 1, label: 'Apple' }, { n: 2, label: 'Banana' }, { n: 3, label: 'Cherry' }]);
    assert.equal(back.asked, 'Which fruit do you want?');
    // CONTROL (the positive one every refusal in this file leans on): the identity it serves is the one a press must
    // send, and a press with it goes through AS THE KEY. Status alone is not enough: this route answers 200 for
    // could_not too.
    const r = await post({ text: '1', chose: 'Apple', asked: back.asked });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.delivery.state, 'placed', JSON.stringify(r.json.delivery));
    assert.deepEqual(calls.keys(), ['1'], 'the press did not go out as the bare key');
    assert.equal(calls.pasted(), '', 'the press was pasted');
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

test('#5406 slice C: a button press for a question that is no longer on screen is refused, never typed as a prompt', async () => {
  const board = fleet.install([fleet.agent('casey', { state: 'idle' })]);
  try {
    const calls = armPane();
    const r = await post({ text: '1', chose: 'Apple', asked: 'Which fruit do you want?' });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.match(r.json.error, /no longer on its screen/);
    assert.deepEqual(calls.keys(), [], 'a key was sent');
    assert.equal(calls.pasted(), '', 'the digit was typed as a prompt');
    // CONTROL: a typed "1" (no button, so no asked) to an idle agent is an ordinary message, as before.
    const typed = await post({ text: '1' });
    assert.equal(typed.status, 200, JSON.stringify(typed.json));
    assert.match(calls.pasted(), /\] 1$/, 'the typed reply did not go as an ordinary message');
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5406 slice C: a press whose words fail the bounds is still checked by its question, never typed as a prompt', async () => {
  const bad = 'Apple\u0007';   // a control character: chose is dropped by its bounds check
  // The menu is up and the question matches, but the words could not be checked: refused, nothing sent.
  await withMenu(async (calls) => {
    const r = await post({ text: '1', chose: bad, asked: 'Which fruit do you want?' });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.match(r.json.error, /could not check that choice's words/, 'refused with a sentence that is not true here');
    assert.deepEqual(calls.keys(), []);
    assert.equal(calls.pasted(), '');
  });
  // No question on screen: refused as gone, nothing typed.
  const board = fleet.install([fleet.agent('casey', { state: 'idle' })]);
  try {
    const calls = armPane();
    const r = await post({ text: '1', chose: bad, asked: 'Which fruit do you want?' });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(calls.pasted(), '', 'a press with dropped words was typed as a prompt');
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5406 slice C: a permission prompt draws no buttons, and a press at one is refused with nothing typed', async () => {
  const PERM = '⏺ Update(a.js)\n\n Edit file\n a.js\n\n Do you want to make this edit to a.js?\n ❯ 1. Yes\n   2. Yes, allow all edits during this session (shift+tab)\n   3. No, and tell Claude what to do differently (esc)\n\n Enter to select · ↑/↓ to navigate · Esc to cancel';
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: PERM })]);
  try {
    const calls = [];
    chat.setRunner((args) => {
      calls.push(args);
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: PERM, err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false); chat.setPauser(() => {});
    const back = await (await fetch(`${base}/api/agent/casey/thread`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();
    assert.equal(back.asking, true, 'premise: the prompt reads as asking');
    assert.ok(Array.isArray(back.options) && back.options.length === 3, 'premise: the prompt reads as numbered options: ' + JSON.stringify(back.options));
    assert.equal(back.asked, null, 'a permission prompt was offered as answer buttons');
    // A crafted press with the identity the screen would give: refused, nothing typed or pasted.
    const q = chat.questionIn(PERM, 'claude');
    const r = await post({ text: '3', chose: back.options[2].label, asked: chat.questionAbove(q.text) });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.match(r.json.error, /cannot be answered with a button/);
    assert.deepEqual(calls.filter((a) => a[0] === 'set-buffer' || a[0] === 'paste-buffer' || a[0] === 'send-keys'), [], 'a press at a permission prompt was typed');
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5406 slice C: a press for an agent not run by Claude is refused, never pasted (the GET never serves it asked)', async () => {
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'gemini', command: 'claude', screen: MENU })]);
  try {
    const calls = armPane();
    const r = await post({ text: '1', chose: 'Apple', asked: 'Which fruit do you want?' });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.match(r.json.error, /cannot be answered with a button/, 'a press for another runner was given a sentence that is not true');
    assert.deepEqual(calls.keys(), []);
    assert.equal(calls.pasted(), '', 'a press for another runner was pasted');
  } finally { chat.resetForTests(); board.restore(); }
});

/* The outcome: the words check refuses this ("could not check that choice's words") before the key branch, whose own
   arm for a number not on the menu no route here reaches (the page only sends digits it drew from the menu). */
test('#5406 slice C: a press whose words were dropped and whose digit is not on the live menu is refused, nothing closed or typed', async () => {
  await withMenu(async (calls) => {
    const r = await post({ text: '7', chose: 'Apple\u0007', asked: 'Which fruit do you want?' });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.match(r.json.error, /could not check that choice's words/);
    assert.deepEqual(calls.keys(), [], 'the menu was closed or answered');
    assert.equal(calls.pasted(), '');
  });
});

test('#5406 slice C: an automatic message cannot carry a question identity (it would be pasted into the menu)', async () => {
  await withMenu(async (calls) => {
    const r = await post({ text: '1', asked: 'Which fruit do you want?', automatic: true });
    assert.equal(r.status >= 400, true, JSON.stringify(r.json));
    assert.match(String(r.json && r.json.error), /plain text/);
    assert.deepEqual(calls.keys(), []);
    assert.equal(calls.pasted(), '', 'an automatic message naming a question was pasted into the menu');
  });
});

/* A press with words but no identity is not this route's to refuse: no client sends one, and #5754's delivery floor
   refuses ANY typing into a permission prompt (words, a digit or a sentence). This pins the identity's shape only. */
test('#5406 slice C: a question identity that is not text is refused, nothing typed', async () => {
  const PERM = '⏺ Update(a.js)\n\n Do you want to make this edit to a.js?\n ❯ 1. Yes\n   2. No\n\n Esc to cancel · Tab to amend';
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: PERM })]);
  try {
    const calls = [];
    chat.setRunner((args) => {
      calls.push(args);
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: PERM, err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false); chat.setPauser(() => {});
    const bad = await post({ text: '1', chose: 'Yes', asked: { q: 'x' } });
    assert.equal(bad.status >= 400, true, JSON.stringify(bad.json));
    assert.match(String(bad.json && bad.json.error), /a question identity is text/, 'refused for some other reason');
    // Review 18: at a permission prompt a press whose words also fail their check hears the TRUE reason (not a button
    // question), not "could not check that choice's words ... or type its number" (typing its number is refused too).
    const q = chat.questionIn(PERM, 'claude');
    const both = await post({ text: '1', chose: 'Yes\u0007', asked: chat.questionAbove(q.text) });
    assert.equal(both.status, 409, JSON.stringify(both.json));
    assert.match(String(both.json && both.json.error), /cannot be answered with a button/, 'the words refusal answered first');
    assert.deepEqual(calls.filter((a) => a[0] === 'set-buffer' || a[0] === 'paste-buffer' || a[0] === 'send-keys'), [], 'a button send was typed into a permission prompt');
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5406 slice C: a menu with a label a press could never carry (over the length limit) gets no buttons', async () => {
  const LONG = MENU.replace('2. Banana', '2. ' + 'B'.repeat(10500));
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: LONG })]);
  try {
    chat.setRunner((args) => {
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: LONG, err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false);
    const back = await (await fetch(`${base}/api/agent/casey/thread`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();
    assert.ok(Array.isArray(back.options) && back.options.length === 3, 'premise: the long label is read as an option');
    assert.equal(back.asked, null, 'buttons were offered for a label a press could never carry');
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5406 slice C review 18: one key answer per agent at a time, so a press from a second window is refused while the first settles', async () => {
  await withMenu(async (calls) => {
    const roster = require('./engine/status').snapshot().agents;
    const first = chat.answerQuestionMenu('casey', 1, roster, { question: undefined, label: 'Apple' });   // holds the slot through its settle
    const second = await chat.answerQuestionMenu('casey', 2, roster, { label: 'Banana' });
    assert.equal(second.ok, false, JSON.stringify(second));
    assert.match(second.because, /being handled right now/);
    const one = await first;
    assert.equal(one.ok, true, JSON.stringify(one));
    assert.deepEqual(calls.keys(), ['1'], 'two keys reached the menu');
  });
});

test('#5406 slice C review 19: on the live single-select menu, a press drawn for a DIFFERENT question is refused by the identity check, nothing sent', async () => {
  await withMenu(async (calls) => {
    const r = await post({ text: '1', chose: 'Apple', asked: 'Which vegetable do you want?' });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.match(r.json.error, /moved between drawing that button and sending it/, 'refused, but not by the identity check');
    assert.deepEqual(calls.keys(), []);
    assert.equal(calls.pasted(), '');
  });
});

test('#5406 slice C review 19: at the delivery layer, a line to an agent whose question is being answered is refused busy, nothing typed', async () => {
  await withMenu(async (calls) => {
    const roster = require('./engine/status').snapshot().agents;
    const press = chat.answerQuestionMenu('casey', 1, roster, { label: 'Apple' });   // holds the slot through its settle
    const v = chat.deliver('casey', 'A room post for Casey.', roster);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT, JSON.stringify(v));
    assert.equal(v.busy, true);
    assert.equal(calls.pasted(), '', 'a line was pasted while the answer settled');
    assert.equal((await press).ok, true);
  });
});

test('#5406 slice C review 21: the cursor moving inside the single-select menu keeps its identity, so a press drawn before the move still goes as the key', async () => {
  const MOVED = MENU.replace('❯ 1. Apple', '  1. Apple').replace('  2. Banana', '❯ 2. Banana');
  assert.notEqual(MOVED, MENU, 'premise: the highlight moved');
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: MENU })]);
  try {
    const keys = [];
    let screen = MOVED;   // the person arrowed down after the page drew the buttons
    chat.setRunner((args) => {
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: screen, err: '' };
      if (args[0] === 'send-keys') { keys.push(args[args.length - 1]); if (/^\d$/.test(args[args.length - 1])) screen = '⏺ Apple it is.\n\n❯ \n'; }
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false); chat.setPauser(() => {});
    const asked = chat.questionAbove(chat.questionIn(MENU, 'claude').text);
    assert.equal(chat.questionAbove(chat.questionIn(MOVED, 'claude').text), asked, 'premise: the identity clamps');
    const r = await post({ text: '1', chose: 'Apple', asked });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.delivery.state, 'placed', JSON.stringify(r.json.delivery));
    assert.deepEqual(keys, ['1'], 'the press did not go as the key after the cursor moved');
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5406 slice C review 22: on the live menu, a new question whose identity CONTAINS the pressed one is refused (equality, not containment)', async () => {
  const MORE = MENU.replace('Which fruit do you want?', 'Which fruit do you want? Pick the one for the second basket.');
  const asked = chat.questionAbove(chat.questionIn(MENU, 'claude').text);
  const nowIdent = chat.questionAbove(chat.questionIn(MORE, 'claude').text);
  assert.ok(nowIdent.includes(asked) && nowIdent !== asked, 'premise: the new identity contains the pressed one');
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: MORE })]);
  try {
    const keys = [];
    chat.setRunner((args) => {
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: MORE, err: '' };
      if (args[0] === 'send-keys') keys.push(args[args.length - 1]);
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false); chat.setPauser(() => {});
    const r = await post({ text: '1', chose: 'Apple', asked });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.match(r.json.error, /moved between drawing that button and sending it/, 'refused, but not by the identity check');
    assert.deepEqual(keys, []);
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5406 slice C review 26: through the route, a typed message while a press settles says it was not typed, and nothing is pasted or escaped', async () => {
  await withMenu(async (calls) => {
    // Claude has not redrawn yet: the menu is still on screen while the key settles (armPane would clear it at once).
    chat.setRunner((args) => {
      calls.push(args);
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: MENU, err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    const roster = require('./engine/status').snapshot().agents;
    const press = chat.answerQuestionMenu('casey', 1, roster, { label: 'Apple' });   // holds the slot through its settle
    const r = await post({ text: 'Actually, can you explain the options first?' });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.match(String(r.json && r.json.error), /being handled right now, so this was not typed; send it again in a moment/);
    assert.equal(calls.pasted(), '', 'a typed message was pasted while the key settled');
    assert.deepEqual(calls.keys().filter((k) => k === 'Escape'), [], 'the menu was closed under a settling key');
    await press;   // it settles with the menu still drawn (unconfirmed); the slot is released either way
  });
});

test('#5406 slice C review 28: a press while the asking card\'s screen cannot be read is refused as unread, nothing typed', async () => {
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: MENU })]);
  try {
    const calls = [];
    chat.setRunner((args) => {
      calls.push(args);
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 1, out: '', err: 'no pane' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false); chat.setPauser(() => {});
    const r = await post({ text: '1', chose: 'Apple', asked: 'Which fruit do you want?' });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.match(r.json.error, /could not read its screen just now/);
    assert.deepEqual(calls.filter((a) => a[0] === 'set-buffer' || a[0] === 'paste-buffer' || a[0] === 'send-keys'), []);
  } finally { chat.resetForTests(); board.restore(); }
});
