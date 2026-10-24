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

test('#7020: a press naming a request without asked is still checked', async () => {
  await withPane(TWO_SPACES, async (calls, set) => {
    const d = await drawn();
    set(ONE_SPACE);
    const r = await post({ text: String(d.allow), chose: 'Yes', request: d.request });
    assert.equal(r.status, 409, JSON.stringify(r.json));
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
