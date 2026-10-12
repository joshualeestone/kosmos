'use strict';
/**
 * kosmos#5943 through the real routes: a question the agent REPORTED is served dated from when it was first asked and
 * in its place in time (not under the person's answer), is clearable, goes when the person clears it, and while it
 * stands the person's next message carries the note that hands the agent the decision.
 *
 * Controls that can return the dangerous answer: the same agent with no question gets no question row and no note; a
 * re-report of the same question does not re-date it; a bare digit (a menu answer) never carries the note.
 *
 *   node --test server.answeredq-5943.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-answeredq-5943-'));
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
const selfreport = require('./engine/selfreport');
const chat = require('./engine/chat');
const fleet = require('./test-support/fleet');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { try { server.close(); } catch { /* closed */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const SCREEN = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
const thread = async (name) => (await (await fetch(`${base}/api/agent/${name}/thread`)).json());
const say = (name, text) => fetch(`${base}/api/agent/${name}/thread`, { method: 'POST', headers: SCREEN, body: JSON.stringify({ text }) });
const pastedChunks = (calls) => calls.filter((a) => a[0] === 'set-buffer').map((a) => a[a.length - 1]);

test('#5943 a reported question is dated from its first ask, sits above the answer, clears, and the note rides while it stands', async () => {
  const board = fleet.install([fleet.agent('asker', { state: 'idle', displayName: 'Asker' })]);
  const sends = [];
  chat.setRunner((args) => {
    sends.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  try {
    // CONTROL: no question standing, no question row and no note.
    assert.ok(!(await thread('asker')).messages.some((m) => m.kind === 'question'), 'a question row with nothing asked');
    sends.length = 0;
    assert.equal((await say('asker', 'hello')).status, 200);
    assert.ok(!pastedChunks(sends).join('').includes('[kosmos] your question'), 'a note with no question standing');

    const Q = 'Should the privacy lines change?';
    assert.equal(selfreport.record('asker', { state: 'needs_you', because: Q }).recorded, true);
    const firstAsk = selfreport.read('asker').askedAt;
    assert.ok(firstAsk, 'askedAt was not recorded');
    await new Promise((r) => setTimeout(r, 15));
    // The same question re-reported later must not re-date it.
    assert.equal(selfreport.record('asker', { state: 'needs_you', because: Q }).recorded, true);

    sends.length = 0;
    assert.equal((await say('asker', 'Yes, change them.')).status, 200);
    const typed = pastedChunks(sends).join('');
    assert.ok(typed.includes('Yes, change them.'), 'control: the message was typed, so the note check means something: ' + typed);
    assert.ok(typed.includes('[kosmos] your question to this person is still open on the board: "' + Q + '"'), 'no note: ' + typed);
    assert.ok(typed.includes('run: kosmos report clear'), typed);
    // ONCE per ask (review 1): the next ordinary message does not repeat it.
    sends.length = 0;
    assert.equal((await say('asker', 'Also, unrelated: thanks.')).status, 200);
    const again = pastedChunks(sends).join('');
    assert.ok(again.includes('Also, unrelated'), 'control: the second message was typed: ' + again);
    assert.ok(!again.includes('[kosmos] your question'), 'the note was repeated on the next message: ' + again);
    // A bare digit (what a numbered menu takes) never carries it.
    sends.length = 0;
    await say('asker', '2');
    assert.ok(!pastedChunks(sends).join('').includes('[kosmos] your question'), 'the note rode a bare digit');

    const served = (await thread('asker')).messages;
    const qi = served.findIndex((m) => m.kind === 'question');
    assert.ok(qi >= 0, 'no question row while needs_you was reported');
    const q = served[qi];
    assert.equal(q.at, firstAsk, 'dated from the FIRST ask, not the re-report');
    assert.equal(q.clearable, true);
    const answerAt = served.findIndex((m) => m.text === 'Yes, change them.');
    assert.ok(answerAt > qi, 'the answer is drawn below the question (it was ' + qi + ' vs ' + answerAt + ')');

    // The person clears it (the route the bubble's button calls): the row goes on the next read; no message is deleted.
    const before = served.filter((m) => m.kind !== 'question').length;
    const res = await fetch(`${base}/api/agent/asker/clear-selfreport`, { method: 'POST', headers: SCREEN, body: JSON.stringify({ reason: 'the person marked the question answered' }) });
    assert.equal((await res.json()).cleared, true);
    const after = (await thread('asker')).messages;
    assert.ok(!after.some((m) => m.kind === 'question'), 'the question stayed after the person cleared it');
    assert.equal(after.length, before, 'clearing deleted conversation');
  } finally {
    chat.setRunner(null);
    fleet.restore();
    void board;
  }
});

test('#5943 review 1: a question ON THE SCREEN wins over a standing report: undated, last, not clearable, and no note', async () => {
  const board = fleet.install([fleet.agent('menuer', { state: 'idle', displayName: 'Menuer' })]);
  const sends = [];
  chat.setRunner((args) => {
    sends.push(args);
    if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: 'Do you want to proceed?\n❯ 1. Yes\n  2. No\n', err: '' };
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  try {
    assert.equal(selfreport.record('menuer', { state: 'needs_you', because: 'An older reported question?' }).recorded, true);
    const served = (await thread('menuer')).messages;
    const q = served.find((m) => m.kind === 'question');
    assert.ok(q, 'no question row');
    assert.match(q.text, /Do you want to proceed\?/, 'control: the screen question is the one served');
    assert.equal(q.at, null, 'a screen question was dated from the report');
    assert.equal(q.clearable, undefined, 'a screen question was offered "Answered, clear this"');
    assert.equal(served[served.length - 1], q, 'the screen question is not last');
    sends.length = 0;
    await say('menuer', 'Something else first');
    assert.ok(!pastedChunks(sends).join('').includes('[kosmos] your question'), 'the note rode while a question stands on the screen');
  } finally {
    chat.setRunner(null);
    fleet.restore();
    void board;
  }
});
