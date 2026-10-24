'use strict';
/**
 * kosmos#7020: a press on a permission card names the request it was drawn for (`request`, chat.permissionRequestId,
 * served on the thread's question row), and the server types it only while the prompt on screen has that same
 * fingerprint. Every permission prompt asks "Do you want to proceed?" above "Yes" and "No", and the press's `asked` is
 * compared after cleanMessage, which folds runs of spaces: so `rm -rf "/tmp/old  build"` and `rm -rf "/tmp/old build"`
 * (two folders) carry the same `asked`, and before this an Allow drawn for one approved the other. The control below
 * shows that press still goes through without `request`.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-permreq-7020-'));
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

const BASH = fs.readFileSync(path.join(__dirname, 'test-support', 'claude-screens', 'permission-prompt-bash-2.1.296.txt'), 'utf8');
// The real 2.1.296 Bash prompt with another command in its box.
const withCommand = (cmd) => {
  const out = BASH.replace(' /usr/bin/uuidgen\n╌', ' ' + cmd + '\n╌');
  assert.notEqual(out, BASH, 'premise: the command line was found in the capture');
  return out;
};
const TWO_SPACES = withCommand('rm -rf "/tmp/old  build"');
const ONE_SPACE = withCommand('rm -rf "/tmp/old build"');
const IDLE = '⏺ Done.\n\n────────\n❯ \n────────\n  ⏸ manual mode on';

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.close(); } catch { /* already down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const post = async (body) => {
  const res = await fetch(`${base}/api/agent/casey/thread`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const getThread = async () => (await fetch(`${base}/api/agent/casey/thread`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();
// What the board page and the phone draw a card's buttons from: the question row's permission, and the thread's `asked`.
const drawn = async () => {
  const back = await getThread();
  const row = (back.messages || []).filter((m) => m && m.kind === 'question' && !m.reported && m.permission).pop();
  assert.ok(row, 'premise: the thread serves a permission card: ' + JSON.stringify(back.messages));
  assert.match(String(row.permission.request), /^[0-9a-f]{64}$/, 'premise: the card carries its request');
  assert.ok(back.asked, 'premise: the thread names the question');
  return { asked: back.asked, request: row.permission.request, allow: row.permission.allow };
};

/* A pane showing `screen` (changeable with set) until a digit or Escape reaches it, then an idle prompt. */
async function withPane(screen, fn) {
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
  const set = (s) => { now = s; };
  try { return await fn(calls, set); } finally { chat.resetForTests(); board.restore(); }
}

test('#7020 premise: the two prompts carry the same asked and different requests', () => {
  const read = (t) => {
    const q = chat.questionIn(t, 'claude');
    return { asked: chat.cleanMessage(chat.questionAbove(q.text)), id: chat.permissionRequestId(chat.permissionCard(t)) };
  };
  const a = read(TWO_SPACES);
  const b = read(ONE_SPACE);
  assert.equal(a.asked, b.asked, 'the asked check would already tell these apart, so this test would not show the new one');
  assert.notEqual(a.id, b.id, 'the two requests read as one');
});

test('#7020 CONTROL: without request, an Allow drawn for one folder is typed at the prompt for the other', async () => {
  await withPane(TWO_SPACES, async (calls, set) => {
    const d = await drawn();
    set(ONE_SPACE);
    const r = await post({ text: String(d.allow), chose: 'Yes', asked: d.asked });
    assert.equal(r.status, 200, 'the old checks already refuse this, so the case below does not show the new check: ' + JSON.stringify(r.json));
    assert.deepEqual(calls.keys(), [String(d.allow)]);
  });
});

test('#7020: with request, that press is refused and nothing is typed', async () => {
  await withPane(TWO_SPACES, async (calls, set) => {
    const d = await drawn();
    set(ONE_SPACE);
    const r = await post({ text: String(d.allow), chose: 'Yes', asked: d.asked, request: d.request });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.match(JSON.stringify(r.json), /its screen moved between drawing that button and sending it/);
    assert.deepEqual(calls.keys(), [], 'a key was typed for a request nobody saw');
  });
});

test('#7020: the same press against the prompt it was drawn for is typed', async () => {
  await withPane(TWO_SPACES, async (calls) => {
    const d = await drawn();
    const r = await post({ text: String(d.allow), chose: 'Yes', asked: d.asked, request: d.request });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.delivery.state, 'placed', JSON.stringify(r.json.delivery));
    assert.deepEqual(calls.keys(), [String(d.allow)]);
  });
});


test('#7020: a press naming its request but no asked is refused by the request check', async () => {
  await withPane(TWO_SPACES, async (calls, set) => {
    const d = await drawn();
    set(ONE_SPACE);
    const r = await post({ text: String(d.allow), chose: 'Yes', request: d.request });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    // The request check's own sentence: without it, a later check refuses this as "not one of the numbers".
    assert.match(JSON.stringify(r.json), /its screen moved between drawing that button and sending it/);
    assert.deepEqual(calls.keys(), []);
  });
});

/* The pane redraws between the route's read and the last look right before the key (answerQuestionMenu's own
   capture). The identity it re-checks is the same for both prompts, so only the request tells them apart there. */
function armSequence(screens) {
  const calls = [];
  const queue = screens.slice();
  chat.setRunner((args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.296\t\t0\n', err: '' };
    if (args[0] === 'capture-pane') { const s = queue.length > 1 ? queue.shift() : queue[0]; return { ran: true, spawnFailed: false, status: 0, out: s, err: '' }; }
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  chat.setPauser(() => {});
  calls.keys = () => calls.filter((a) => a[0] === 'send-keys').map((a) => a[a.length - 1]);
  return calls;
}
const idOf = (screen) => chat.questionAbove(chat.questionIn(screen, 'claude').text);
const reqOf = (screen) => chat.permissionRequestId(chat.permissionCard(screen));

test('#7020: the last look before the key refuses another request under the same identity', async () => {
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: TWO_SPACES })]);
  const expect = { question: 'Do you want to proceed?', label: 'Yes', identity: idOf(TWO_SPACES) };
  try {
    // CONTROL: without the request, the last look passes the other folder's prompt (its identity is the same).
    let calls = armSequence([ONE_SPACE, IDLE]);
    let r = await chat.answerQuestionMenu('casey', 1, board.agents, expect);
    assert.deepEqual([r.ok, calls.keys()], [true, ['1']], 'the identity alone already refuses this, so the case below does not show the new check');
    chat.resetForTests();
    calls = armSequence([ONE_SPACE, IDLE]);
    r = await chat.answerQuestionMenu('casey', 1, board.agents, { ...expect, request: reqOf(TWO_SPACES) });
    assert.deepEqual([r.ok, calls.keys()], [false, []], 'Yes went to a request the person never saw');
    chat.resetForTests();
    // The request the person saw, still on screen: answered.
    calls = armSequence([TWO_SPACES, IDLE]);
    r = await chat.answerQuestionMenu('casey', 1, board.agents, { ...expect, request: reqOf(TWO_SPACES) });
    assert.deepEqual([r.ok, r.answered, calls.keys()], [true, true, ['1']], JSON.stringify(r));
    chat.resetForTests();
    // After the key, the other request under the same identity is the next prompt: answered, not "still asking".
    calls = armSequence([TWO_SPACES, ONE_SPACE]);
    r = await chat.answerQuestionMenu('casey', 1, board.agents, { ...expect, request: reqOf(TWO_SPACES) });
    assert.deepEqual([r.ok, r.answered], [true, true], JSON.stringify(r));
    chat.resetForTests();
    // CONTROL: the same request still showing after the key is unconfirmed.
    calls = armSequence([TWO_SPACES, TWO_SPACES]);
    r = await chat.answerQuestionMenu('casey', 1, board.agents, { ...expect, request: reqOf(TWO_SPACES) });
    assert.deepEqual([r.ok, r.answered], [true, false], JSON.stringify(r));
  } finally { chat.resetForTests(); board.restore(); }
});

/* Through the route: every read up to the last one shows the prompt drawn for, and the last look before the key (the
   one answerQuestionMenu takes) shows the other folder's. Which read that is, is measured on an honest press first. */
async function pressWithLastLook(lastLook, request) {
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: TWO_SPACES })]);
  let reads = 0; let swapAt = Infinity; let keyedAfter = -1;
  const calls = [];
  chat.setRunner((args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.296\t\t0\n', err: '' };
    if (args[0] === 'capture-pane') { reads += 1; return { ran: true, spawnFailed: false, status: 0, out: keyedAfter >= 0 ? IDLE : (reads >= swapAt ? lastLook : TWO_SPACES), err: '' }; }
    if (args[0] === 'send-keys' && /^\d$/.test(args[args.length - 1])) keyedAfter = reads;
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  chat.setPauser(() => {});
  try {
    const d = await drawn();
    const body = { text: String(d.allow), chose: 'Yes', asked: d.asked, ...(request ? { request: d.request } : {}) };
    reads = 0;   // count the press's reads only (the second run has no thread read before it)
    const measure = await post(body);
    assert.equal(measure.status, 200, 'premise: the honest press is typed: ' + JSON.stringify(measure.json));
    const lastBeforeKey = keyedAfter;
    assert.ok(lastBeforeKey > 0, 'premise: the key followed a read');
    // Again, with the screen changing on exactly that read.
    calls.length = 0; reads = 0; keyedAfter = -1; swapAt = lastBeforeKey;
    const r = await post(body);
    return { r, keys: calls.filter((a) => a[0] === 'send-keys').map((a) => a[a.length - 1]) };
  } finally { chat.resetForTests(); board.restore(); }
}

test('#7020: through the route, a redraw just before the key is refused when the press named its request', async () => {
  const control = await pressWithLastLook(ONE_SPACE, false);
  assert.deepEqual([control.r.status, control.keys], [200, ['1']], 'CONTROL: without request the redraw is not caught, so the case below would not show the check: ' + JSON.stringify(control.r.json));
  const named = await pressWithLastLook(ONE_SPACE, true);
  assert.equal(named.r.status, 409, JSON.stringify(named.r.json));
  assert.deepEqual(named.keys, [], 'Yes went to a request the person never saw');
});

test('#7020: an automatic message carrying a request is refused (a menu answer is always the person\'s own act)', async () => {
  await withPane(TWO_SPACES, async (calls) => {
    const d = await drawn();
    const r = await post({ text: 'hello', automatic: true, request: d.request });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.match(JSON.stringify(r.json), /an automatic message is plain text/);
    assert.deepEqual(calls.keys(), []);
  });
});

test('#7020: a press naming a request while no permission prompt is on screen is refused', async () => {
  await withPane(TWO_SPACES, async (calls, set) => {
    const d = await drawn();
    set(IDLE);
    const r = await post({ text: String(d.allow), request: d.request });
    assert.ok(r.status === 409 || r.status === 400, 'typed at a screen with no prompt: ' + JSON.stringify(r));
    assert.deepEqual(calls.keys(), []);
    assert.equal(calls.filter((a) => a[0] === 'set-buffer').length, 0, 'the digit was pasted as a message');
  });
});

test('#7020: a request that is not one Kosmos made is refused 400, and nothing is typed', async () => {
  await withPane(TWO_SPACES, async (calls) => {
    const d = await drawn();
    for (const bad of ['', 'abc', d.request.toUpperCase(), d.request + '0', 7, true, {}]) {
      const r = await post({ text: String(d.allow), chose: 'Yes', asked: d.asked, request: bad });
      assert.equal(r.status, 400, JSON.stringify(bad) + ': ' + JSON.stringify(r.json));
    }
    assert.deepEqual(calls.keys(), []);
  });
});
