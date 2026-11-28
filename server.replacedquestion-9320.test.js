'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9320: a status card holds one state, so an agent's own report of anything but needs_you replaces an open
 * question it asked the person, and the question leaves the board. The report still lands; the answer now says which
 * question went, so the agent can ask it again if it still stands.
 *
 * Controls that can return the dangerous answer: a blocked report with no question standing gets no such note; `clear`
 * over a question (the agent saying it is answered) gets none; an automatic permission prompt being replaced gets none.
 *
 *   node --test server.replacedquestion-9320.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-9320-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, boardAuthState } = require('./server');
const fleet = require('./test-support/fleet');
const selfreport = require('./engine/selfreport');
const sendertoken = require('./engine/sendertoken');
const WHO = 'nova';

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
});
test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

let TOKEN = '';
async function report(body) {
  const res = await fetch(base + '/api/report', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': TOKEN }, body: JSON.stringify(body) });
  return res.json();
}
const REPLACED = /^This also took your open question to the person off the board/;

test('kosmos#9320: a blocked report over an open question lands, and its answer names the question that went', async () => {
  const board = fleet.install([fleet.agent(WHO, { state: 'idle' })]);
  try {
    TOKEN = sendertoken.mint(WHO).token;
    // CONTROL: no question standing, so a blocked report gets no such note.
    const plain = await report({ state: 'blocked', on: 'the build', owner: 'deploy' });
    assert.equal(plain.recorded, true, JSON.stringify(plain));
    assert.doesNotMatch(String(plain.note || ''), REPLACED, 'a blocked report with no question standing was told it replaced one');

    const asked = await report({ state: 'needs_you', text: 'Can I delete the old release branch?' });
    assert.equal(asked.recorded, true, JSON.stringify(asked));
    const blocked = await report({ state: 'blocked', on: 'the release', owner: 'deploy' });
    assert.equal(blocked.recorded, true, 'the report still lands: ' + JSON.stringify(blocked));
    assert.match(String(blocked.note), REPLACED, 'nothing said the question left the board');
    assert.match(String(blocked.note), /Can I delete the old release branch\?/, 'the note does not name the question');
    assert.match(String(blocked.note), /ask it again with kosmos report needs_you/);
    assert.equal(selfreport.read(WHO).state, 'blocked', 'recorded as sent');
  } finally { board.restore(); }
});

test('kosmos#9320: a working or idle report the agent typed says so too; clear does not', async () => {
  const board = fleet.install([fleet.agent('vega', { state: 'idle' })]);
  try {
    TOKEN = sendertoken.mint('vega').token;
    await report({ state: 'needs_you', text: 'Which logo, A or B?' });
    const working = await report({ state: 'working', text: 'on the copy' });
    assert.match(String(working.note), REPLACED, 'an agent-typed working over the question said nothing');

    await report({ state: 'needs_you', text: 'Which logo, A or B?' });
    const idle = await report({ state: 'idle' });
    assert.match(String(idle.note), REPLACED, 'an agent-typed idle over the question said nothing');

    await report({ state: 'needs_you', text: 'Which logo, A or B?' });
    const cleared = await report({ state: 'working', clear: true });
    assert.equal(cleared.recorded, true, JSON.stringify(cleared));
    assert.doesNotMatch(String(cleared.note || ''), REPLACED, 'clear (the question answered) was told it lost the question');
  } finally { board.restore(); }
});

test('kosmos#9320: record() says what it replaced only over a deliberate question', () => {
  const name = 'nova-engine';
  assert.equal(selfreport.record(name, { state: 'needs_you', because: 'Ship it today?' }).recorded, true);
  const r = selfreport.record(name, { state: 'blocked', because: 'waiting on CI', on: 'CI', owner: 'ci' });
  assert.equal(r.recorded, true);
  assert.equal(r.replacedQuestion, 'Ship it today?');
  // CONTROL: over a blocked (not a question), nothing is said to have been replaced.
  const again = selfreport.record(name, { state: 'working', because: 'back at it' });
  assert.equal(again.replacedQuestion, undefined);
  // An automatic permission prompt is not a question anybody asked: replacing it says nothing.
  assert.equal(selfreport.record(name, { state: 'needs_you', because: 'asking permission to use Bash: ls', auto: true }).recorded, true);
  const overPrompt = selfreport.record(name, { state: 'working', because: 'resumed' });
  assert.equal(overPrompt.recorded, true);
  assert.equal(overPrompt.replacedQuestion, undefined, 'an automatic permission prompt was reported as a replaced question');
});

test('kosmos#9320: the note is one plain line the macOS CLI can lift, whatever the question holds', () => {
  const note = selfreport.replacedQuestionNote('Can I "delete" C:\\old\nbranch?');
  assert.doesNotMatch(note, /["\\\n]/, 'no double quote, backslash or newline: install/kosmos lifts the note with sed');
  assert.match(note, /'Can I 'delete' C:'old branch\?'/);
  const long = selfreport.replacedQuestionNote('x'.repeat(400));
  assert.ok(long.length < 260, 'a long question is cut short: ' + long.length);
  assert.match(selfreport.replacedQuestionNote(''), /off the board\. If it still stands/, 'an empty question still says it went');
  // Review 1: neither a split emoji nor a control character may reach the reply as an escape (a backslash in its JSON).
  for (const q of ['a'.repeat(116) + '\u{1F600}' + 'b'.repeat(40), 'one\u0001two\u001bthree\u007f']) {
    const n = selfreport.replacedQuestionNote(q);
    assert.doesNotMatch(JSON.stringify(n), /\\/, 'the reply would carry an escape the macOS CLI prints: ' + JSON.stringify(n));
  }
});
