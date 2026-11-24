'use strict';
/**
 * kosmos#8952 slice (c), through the REAL routes: a permission prompt whose box top scrolled away is never approved
 * (server.permscroll-8952.test.js), but its own No can be pressed. The thread serves `denyOnly` on the live question row
 * (the No option and the visible part's identity); a press marked denyOnly with that No sends its key; a denyOnly press
 * of any other option, or for another identity, sends nothing. CONTROL: the whole box gets the full card, not denyOnly.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-permdeny-8952-'));
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

const SCREENS = path.join(__dirname, 'test-support', 'claude-screens');
const BASH = fs.readFileSync(path.join(SCREENS, 'permission-prompt-bash-2.1.296.txt'), 'utf8');
const IDLE = '⏺ Done.\n\n────────\n❯ \n────────\n  ⏸ manual mode on';

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* already down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const post = async (body) => {
  const res = await fetch(`${base}/api/agent/casey/thread`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const getThread = async () => (await fetch(`${base}/api/agent/casey/thread`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();


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
  try { return await fn(calls, board.agents); } finally { chat.resetForTests(); board.restore(); }
}

// The real screen with the scroll line just under its "4. No"; cut = its full-width top rule gone (scrolled away).
function withScroll(screen) {
  const lines = screen.split('\n');
  const no = lines.findIndex((l) => /^\s*4\.\s+No\b/.test(l));
  assert.ok(no > 0, 'premise: the capture has its "4. No" option');
  return [...lines.slice(0, no + 1), '  ↑ 37 more lines', ...lines.slice(no + 1)].join('\n');
}
const CUT = withScroll(BASH).split('\n').filter((l) => !/^─{8,}/.test(l)).join('\n');


const questionRow = (thread) => (thread.messages || []).filter((m) => m && m.kind === 'question' && !m.reported).pop();

test('#8952 (c): a cut-off box serves its No on the question row, and a denyOnly press of it sends that key', async () => {
  assert.equal(chat.permissionAnswerable(CUT), false, 'premise: the cut box is not answerable');
  await withPrompt(CUT, async (calls) => {
    const thread = await getThread();
    assert.equal(thread.asked, null, 'premise: no identity for the whole buttons');
    const row = questionRow(thread);
    assert.ok(row, 'no live question row: ' + JSON.stringify(thread.messages));
    assert.equal('permission' in row, false, 'a full card was served for a cut box');
    assert.ok(row.denyOnly, 'no denyOnly on the row: ' + JSON.stringify(row));
    assert.equal(row.denyOnly.n, 4);
    assert.equal(row.denyOnly.label, 'No');
    assert.equal(row.denyOnly.asked, chat.questionAbove(chat.questionIn(CUT, 'claude').text));
    const p = await post({ text: '4', chose: 'No', asked: row.denyOnly.asked, denyOnly: true });
    assert.equal(p.status, 200, JSON.stringify(p.json));
    assert.deepEqual(calls.keys(), ['4']);
  });
});

test('#8952 (c): a denyOnly press of Yes, or of a lasting option, on a cut box sends nothing', async () => {
  const asked = chat.questionAbove(chat.questionIn(CUT, 'claude').text);
  for (const [text, chose] of [['1', 'Yes'], ['2', 'Yes, and don’t ask again for: /usr/bin/uuidgen *']]) {
    await withPrompt(CUT, async (calls) => {
      const p = await post({ text, chose, asked, denyOnly: true, ...(text === '2' ? { lasting: true } : {}) });
      assert.equal(p.status, 409, text + ' was accepted: ' + JSON.stringify(p.json));
      // Refused by the deny-only gate itself (answerQuestionMenuHeld), not by an earlier route check.
      assert.match(String(p.json && (p.json.error || JSON.stringify(p.json))), /only No can be sent/, 'refused for another reason: ' + JSON.stringify(p.json));
      assert.deepEqual(calls.keys(), [], 'a key reached the pane for ' + text);
    });
  }
});

test('#8952 (c): a denyOnly No for another identity sends nothing; CONTROL: the same press without denyOnly is refused too', async () => {
  const asked = chat.questionAbove(chat.questionIn(CUT, 'claude').text);
  await withPrompt(CUT, async (calls) => {
    const other = await post({ text: '4', chose: 'No', asked: asked.replace('uuidgen', 'rm -rf build'), denyOnly: true });
    assert.equal(other.status, 409, JSON.stringify(other.json));
    const plain = await post({ text: '4', chose: 'No', asked });
    assert.equal(plain.status, 409, 'a No without denyOnly went at a cut box: ' + JSON.stringify(plain.json));
    assert.deepEqual(calls.keys(), []);
  });
});

test('#8952 (c) CONTROL: the whole box gets the full card and no denyOnly', async () => {
  const whole = withScroll(BASH);
  await withPrompt(whole, async () => {
    const row = questionRow(await getThread());
    assert.ok(row && row.permission, 'no full card on the whole box: ' + JSON.stringify(row));
    assert.equal('denyOnly' in row, false);
  });
});

/* The route's own `asked` check refuses another identity first (above), so the engine's last-look checks are tested on
   their own here, through chat.answerQuestionMenu. */
test('#8952 (c) engine: a denyOnly No for another identity, or naming a request, sends nothing; CONTROL: the right one does', async () => {
  const asked = chat.questionAbove(chat.questionIn(CUT, 'claude').text);
  await withPrompt(CUT, async (calls, roster) => {
    const other = await chat.answerQuestionMenu('casey', 4, roster, { label: 'No', identity: asked.replace('uuidgen', 'rm -rf build'), denyOnly: true });
    assert.equal(other.ok, false, JSON.stringify(other));
    const req = await chat.answerQuestionMenu('casey', 4, roster, { label: 'No', identity: asked, denyOnly: true, request: 'a'.repeat(64) });
    assert.equal(req.ok, false, JSON.stringify(req));
    assert.match(req.because, /only No can be sent/);
    assert.deepEqual(calls.keys(), []);
    const right = await chat.answerQuestionMenu('casey', 4, roster, { label: 'No', identity: asked, denyOnly: true });
    assert.equal(right.ok, true, JSON.stringify(right));
    assert.deepEqual(calls.keys(), ['4']);
  });
});

/* A deny-only press that meets an ordinary question menu (the screen moved on) is refused, never sent as that menu's
   answer, even where the menu has an option called No. CONTROL: the same press without denyOnly answers it. */
const MENU_NO = fs.readFileSync(path.join(SCREENS, 'question-menu-2.1.29x.txt'), 'utf8').replace('2. Banana\n     Banana', '2. No\n     No');
test('#8952 (c): a denyOnly press at an ordinary question menu sends nothing; CONTROL: a plain press answers it', async () => {
  const asked = chat.questionAbove(chat.questionIn(MENU_NO, 'claude').text);
  assert.equal(asked, 'Which fruit do you want?', 'premise: the menu reads');
  await withPrompt(MENU_NO, async (calls) => {
    const p = await post({ text: '2', chose: 'No', asked, denyOnly: true });
    assert.equal(p.status, 409, JSON.stringify(p.json));
    assert.match(String(p.json && (p.json.error || JSON.stringify(p.json))), /asking something else now/);
    assert.deepEqual(calls.keys(), []);
    const plain = await post({ text: '2', chose: 'No', asked });
    assert.equal(plain.status, 200, JSON.stringify(plain.json));
    assert.deepEqual(calls.keys(), ['2']);
  });
});
