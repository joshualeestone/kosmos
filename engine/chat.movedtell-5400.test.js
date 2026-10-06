'use strict';
/* #5400: the failover's "your part was moved" notice rides on whatever Kosmos next types into an owed agent
 * (chat.setMovedTell). Its own file, with chat.test.js's sandbox and scripted tmux, so every "typed" below is measured
 * on the argv handed to tmux, never on a real pane. Cards come from test-support/fleet.
 *
 *   node --test engine/chat.movedtell-5400.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-movedtell-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('./chat');
const ft = require('./failovertell');
const fleet = require('../test-support/fleet');

test.beforeEach(() => { chat.resetForTests(); });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

function withFleet(specs, fn) {
  const board = fleet.install(specs);
  try { return fn(board); } finally { board.restore(); }
}
function okProbe() { return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' }; }
function ok() { return { ran: true, spawnFailed: false, status: 0, out: '', err: '' }; }
function refused() { return { ran: true, spawnFailed: false, status: 1, out: '', err: 'no' }; }
function arm(answers) {
  const calls = [];
  const fn = (args) => { calls.push(args); if (args[0] === 'display-message') return okProbe(); return answers.length ? answers.shift() : ok(); };
  fn.pastedText = () => calls.filter((a) => a[0] === 'set-buffer').map((a) => a[a.length - 1]).join('');
  chat.setRunner(fn);
  chat.setDryRun(false);
  return fn;
}

const ITEM = { projectId: 'p1', n: 3, partId: 1, who: 'zed', done: false, phrase: 'task 3 in "Launch" (now zed\'s)' };
/* A hook over an in-memory owed list, as server.js wires it over the project records. */
function hook(owedNow) {
  const told = [];
  const state = { owed: owedNow.slice() };
  chat.setMovedTell({
    owed: () => state.owed.slice(),
    note: (items) => ft.noteFor(items),
    told: (session, items) => { told.push([session, items.map((i) => i.phrase)]); state.owed = state.owed.filter((i) => !items.includes(i)); },
  });
  return told;
}

test('an owed agent\'s next line carries the note IN FRONT of the message, and the part is marked told once it lands', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const told = hook([ITEM]);
    const tmux = arm([ok(), ok()]);
    const v = chat.deliver('casey', 'Your limit has reset; carry on.', board.agents);
    assert.equal(v.state, chat.DELIVERY.PLACED);
    const typed = tmux.pastedText();
    assert.ok(typed.indexOf(ITEM.phrase) !== -1 && typed.indexOf(ITEM.phrase) < typed.indexOf('Your limit has reset'), JSON.stringify(typed));
    assert.ok(!/reply with one word/.test(typed), 'the note on a person\'s line asks for nothing');
    assert.equal(told.length, 1);
    assert.equal(told[0][0], 'casey');
  });
});

test('CONTROL: an agent owed nothing gets exactly its message', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const told = hook([]);
    const tmux = arm([ok(), ok()]);
    chat.deliver('casey', 'Hello.', board.agents);
    assert.equal(tmux.pastedText(), 'Hello.');
    assert.equal(told.length, 0);
  });
});

test('a line that already names the part (the idle sweep\'s own, agyquota\'s carry-on) does not get it twice', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const told = hook([ITEM]);
    const tmux = arm([ok(), ok()]);
    const line = ft.lineFor([ITEM]);
    chat.deliver('casey', line, board.agents);
    assert.equal(tmux.pastedText(), line);
    assert.equal(told.length, 0, 'the hook marked a part the caller marks itself');
  });
});

test('a line that did not land marks nothing told', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const told = hook([ITEM]);
    arm([refused(), refused(), refused(), refused()]);
    const v = chat.deliver('casey', 'Hello.', board.agents);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT, 'fixture: the paste was not refused: ' + JSON.stringify(v));
    assert.equal(told.length, 0);
  });
});

test('a message the note would push over the limit goes as it was; the note waits for the next line', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const told = hook([ITEM]);
    const tmux = arm([ok(), ok()]);
    const long = 'x'.repeat(chat.MAX_TEXT - 5);
    const v = chat.deliver('casey', long, board.agents);
    assert.equal(v.state, chat.DELIVERY.PLACED);
    assert.equal(tmux.pastedText(), long);
    assert.equal(told.length, 0);
  });
});

test('two lines queued for one agent: only the first carries the note', async () => {
  const board = fleet.install([fleet.agent('casey', { state: 'idle' })]);
  try {
    const told = hook([ITEM]);
    const tmux = arm([]);
    const [a, b] = await Promise.all([chat.deliverAsync('casey', 'First.', board.agents), chat.deliverAsync('casey', 'Second.', board.agents)]);
    assert.equal(a.state, chat.DELIVERY.PLACED); assert.equal(b.state, chat.DELIVERY.PLACED);
    const typed = tmux.pastedText();
    assert.equal(typed.split(ITEM.phrase).length - 1, 1, 'the note went out twice: ' + JSON.stringify(typed));
    assert.equal(told.length, 1);
  } finally { board.restore(); }
});

test('CONTROL: with no hook installed (resetForTests), nothing is added', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const tmux = arm([ok(), ok()]);
    chat.deliver('casey', 'Hello.', board.agents);
    assert.equal(tmux.pastedText(), 'Hello.');
  });
});
