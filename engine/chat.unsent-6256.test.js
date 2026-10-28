'use strict';

/**
 * #6256 items 1 to 4: follow-ups to #6249 (a line left unsent in an idle Claude Code agent's input box).
 *   1. a room post held by text in the box is told once the box reads empty, with no wake needed;
 *   2. a message row marked unsubmitted gets a follow-up row when a later delivery sends it;
 *   3. the unsent sentence says Kosmos will send it, so nobody types it again;
 *   4. an earlier line still in the box after the short watch is remembered again, not forgotten.
 * Same harness as chat.composer-6249.test.js: every `capture-pane -e` answers the next screen in a list.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-unsent-6256-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');

const chat = require('./chat');
const messages = require('./messages');
const roomhold = require('./roomhold');
const fleet = require('../test-support/fleet');

const SCREENS = path.join(__dirname, '..', 'test-support', 'composer-6249');
const EMPTY = fs.readFileSync(path.join(SCREENS, 'empty-after-turn.ansi'), 'utf8');
const RULE = '\x1b[38;5;244m' + '─'.repeat(80);
function box(text) {
  const rows = [];
  let rest = String(text);
  rows.push('\x1b[39m❯ ' + rest.slice(0, 76));
  rest = rest.slice(76);
  while (rest) { rows.push('  ' + rest.slice(0, 76)); rest = rest.slice(76); }
  return [RULE, ...rows, RULE, '  scratch'].join('\n') + '\n';
}
function ok(out) { return { ran: true, spawnFailed: false, status: 0, out: out || '', err: '' }; }
function arm(boxes) {
  const calls = [];
  const queue = boxes.slice();
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message') return ok('2.1.300\t\t0\n');
    if (args[0] === 'capture-pane' && args.includes('-e')) return ok(queue.length > 1 ? queue.shift() : queue[0]);
    return ok();
  };
  fn.calls = calls;
  fn.enters = () => calls.filter((a) => a[0] === 'send-keys' && a[a.length - 1] === 'Enter').length;
  fn.pasted = () => calls.filter((a) => a[0] === 'paste-buffer').length;
  chat.setRunner(fn);
  chat.setDryRun(false);
  chat.setPauser(() => {});
  return fn;
}
const MSG = 'Kosmos here: please read the ruling on the card and carry on with the fix you described this morning.';
const LATER = 'a later line that is long enough to read';

// kosmos#7246 slice 2: roomloop.resetForTests, so the per-project agent-wake cap never quiets a later test's post.
test.beforeEach(() => { chat.resetForTests(); messages.resetForTests(); require('./roomloop').resetForTests(); try { fs.rmSync(messages.LOG, { force: true }); } catch { /* fresh */ } });
test.after(() => { chat.setRunner(null); try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('#6256 item 3, kosmos#6436: the unsent sentence says Kosmos presses it again on its own and before the next message', () => {
  const board = fleet.install([fleet.agent('al', { state: 'idle' })]);
  try {
    arm([EMPTY, box(MSG)]);
    const v = chat.deliver('al', MSG, board.agents);
    assert.equal(v.unsubmitted, true, 'PRECONDITION: left in the box');
    assert.match(v.because, /still sitting there, and Kosmos presses Enter on it again on its own over the next few minutes, then every ten minutes while it sits there, and before the next thing it types to this agent, while the box shows only that line/);
  } finally { board.restore(); }
});

test('#6256 item 4: an earlier line still in the box after the short watch is remembered again and sent next time', () => {
  const board = fleet.install([fleet.agent('al', { state: 'idle' })]);
  try {
    arm([EMPTY, box(MSG)]);
    assert.equal(chat.deliver('al', MSG, board.agents).unsubmitted, true, 'PRECONDITION: left there, remembered');
    // The next delivery presses Enter on it, but the box is slower than the 300 ms watch: still there, so refused.
    const slow = arm([box(MSG)]);
    const refused = chat.deliver('al', 'a second line that is long enough', board.agents);
    assert.equal(refused.inputHeld, true);
    assert.equal(slow.enters(), 1, 'PRECONDITION: Enter was pressed on the earlier line once');
    // The one after: the earlier line is still recognised as ours, sent first, then this one.
    const t = arm([box(MSG), EMPTY, EMPTY, box(LATER), EMPTY]);
    const v = chat.deliver('al', LATER, board.agents);
    assert.equal(v.state, chat.DELIVERY.PLACED, v.because);
    assert.equal(v.earlierSubmitted, true, 'the earlier line was forgotten after the slow watch');
    assert.equal(t.enters(), 2);
  } finally { board.restore(); }
});

test('#6256 item 4 CONTROL: a person who edits the line during the slow watch is not remembered as ours', () => {
  const board = fleet.install([fleet.agent('al', { state: 'idle' })]);
  try {
    arm([EMPTY, box(MSG)]);
    chat.deliver('al', MSG, board.agents);
    arm([box(MSG), box(MSG), box(MSG + ' and mine')]);
    assert.equal(chat.deliver('al', 'a second line that is long enough', board.agents).inputHeld, true);
    const t = arm([box(MSG)]);
    const v = chat.deliver('al', LATER, board.agents);
    assert.equal(t.enters(), 0, 'never an Enter on a line that is no longer only ours');
    assert.equal(v.inputHeld, true);
  } finally { board.restore(); }
});

test('#6256 item 2: a message left unsent gets a follow-up row when the next message sends it', () => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('al', { state: 'idle' })]);
  try {
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    const w1 = '[message from your colleague leo · m1] ' + MSG;
    arm([EMPTY, box(w1)]);
    const first = messages.send({ fromPane: '%7', to: 'al', text: MSG }, board.agents);
    assert.equal(first.unsubmitted, true, 'PRECONDITION: m1 was left in the box: ' + JSON.stringify(first));
    const w2 = '[message from your colleague leo · m2] ' + LATER;
    arm([box(w1), EMPTY, EMPTY, box(w2), EMPTY]);
    const second = messages.send({ fromPane: '%7', to: 'al', text: LATER }, board.agents);
    assert.equal(second.state, chat.DELIVERY.PLACED, second.because);
    const rows = messages.readLog();
    const m1 = rows.find((r) => r.kind === 'message' && r.id === 'm1');
    assert.equal(m1.unsubmitted, true, 'the row says what was true when it was written');
    const follow = rows.filter((r) => r.kind === 'unsent-submitted');
    assert.equal(follow.length, 1);
    assert.equal(follow[0].of, 'm1');
    assert.equal(follow[0].from, 'leo');
    assert.equal(follow[0].to, 'al');
  } finally { messages.setRunner(null); board.restore(); }
});

test('#6256 item 2 CONTROL: a line some other sender left (no message row) writes no follow-up row', () => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('al', { state: 'idle' })]);
  try {
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    arm([EMPTY, box(MSG)]);
    assert.equal(chat.deliver('al', MSG, board.agents).unsubmitted, true, 'PRECONDITION: a nudge-like line left there');
    const w1 = '[message from your colleague leo · m1] ' + LATER;
    arm([box(MSG), EMPTY, EMPTY, box(w1), EMPTY]);
    assert.equal(messages.send({ fromPane: '%7', to: 'al', text: LATER }, board.agents).state, chat.DELIVERY.PLACED);
    assert.equal(messages.readLog().filter((r) => r.kind === 'unsent-submitted').length, 0);
  } finally { messages.setRunner(null); board.restore(); }
});

test('#6256 item 1: posts held by text in the box are told once it reads empty, only their projects, with no wake', async () => {
  const board = fleet.install([fleet.agent('al', { state: 'idle' })]);
  try {
    const roster = board.agents;
    roomhold.hold('al', 'p1', 'm9');
    roomhold.noteInput('al', 'p1', 'm9');
    roomhold.hold('al', 'p2', 'm8');   // a plain post the ordinary hold kept for the next wake
    const told = [];
    const deliver = async (name, text) => { told.push({ name, text }); return { state: chat.DELIVERY.PLACED }; };
    const base = {
      isAgy: () => false, readReport: () => null, now: Date.now(), decayMs: 5 * 60 * 1000, deliver,
      shownOf: (p) => p, DELIVERY: chat.DELIVERY, env: {}, stale: () => new Set(),
    };
    // Text still in the box: nothing told, the post stays held.
    await roomhold.flushReleased(roster, { ...base, boxEmpty: () => false });
    assert.equal(told.length, 0);
    assert.deepEqual(roomhold.heldIn('al', 'p1'), ['m9']);
    // The box empties: p1 is told, p2 (nothing the box held) waits for the wake, and the note goes.
    const out = await roomhold.flushReleased(roster, { ...base, boxEmpty: () => true });
    assert.equal(told.length, 1, JSON.stringify(out));
    assert.match(told[0].text, /p1/);
    assert.equal(out[0].why, 'input', 'the log line names the cause');
    assert.deepEqual(roomhold.heldIn('al', 'p1'), []);
    assert.deepEqual(roomhold.heldIn('al', 'p2'), ['m8'], 'a plain post was told with it');
    // CONTROL: with no input note left, the empty box tells p2 nothing.
    await roomhold.flushReleased(roster, { ...base, boxEmpty: () => true });
    assert.equal(told.length, 1);
  } finally { roomhold.forget('al'); board.restore(); }
});

test('#6256 item 1: a note whose post was taken another way (a later arrival) wakes nobody', async () => {
  const board = fleet.install([fleet.agent('al', { state: 'idle' })]);
  try {
    roomhold.hold('al', 'p1', 'm9');
    roomhold.noteInput('al', 'p1', 'm9');
    roomhold.take('al', 'p1');   // told by a later arrival in the room
    roomhold.hold('al', 'p1', 'm7');   // a newer plain post in the same project
    const told = [];
    await roomhold.flushReleased(board.agents, {
      isAgy: () => false, readReport: () => null, now: Date.now(), decayMs: 5 * 60 * 1000,
      deliver: async (name, text) => { told.push(text); return { state: chat.DELIVERY.PLACED }; },
      shownOf: (p) => p, DELIVERY: chat.DELIVERY, env: {}, stale: () => new Set(), boxEmpty: () => true,
    });
    assert.equal(told.length, 0, 'woke the member for a post that asks nothing of it');
  } finally { roomhold.forget('al'); board.restore(); }
});

test('#6256 item 1: a usage limit or sign-out on the member keeps the input-held posts waiting (no churn)', async () => {
  const board = fleet.install([fleet.agent('al', { state: 'idle' })]);
  const real = chat.accountHeldVerdict;
  try {
    roomhold.hold('al', 'p1', 'm9');
    roomhold.noteInput('al', 'p1', 'm9');
    const told = [];
    const deps = {
      isAgy: () => false, readReport: () => null, now: Date.now(), decayMs: 5 * 60 * 1000,
      deliver: async (name, text) => { told.push(text); return { state: chat.DELIVERY.PLACED }; },
      shownOf: (p) => p, DELIVERY: chat.DELIVERY, env: {}, stale: () => new Set(), boxEmpty: () => true,
    };
    chat.accountHeldVerdict = () => ({ held: true, heldBy: 'limit' });
    await roomhold.flushReleased(board.agents, deps);
    assert.equal(told.length, 0, 'tried while a usage limit held the member');
    assert.deepEqual(roomhold.heldIn('al', 'p1'), ['m9']);
    chat.accountHeldVerdict = real;
    await roomhold.flushReleased(board.agents, deps);
    assert.equal(told.length, 1, 'CONTROL: told once nothing holds the member');
  } finally { chat.accountHeldVerdict = real; roomhold.forget('al'); board.restore(); }
});

test('#6256 item 1: a room post held by text in the box notes it at the hold site, and the real box read decides', async () => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('al', { state: 'idle' })]);
  try {
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    arm([box('the person is still writing something here')]);
    // kosmos#7246 slice 2: the post @-names al, so it reaches al's box (unaddressed, al would be quiet, not held).
    const sent = messages.sendPost({ fromPane: '%7', project: 'lease', text: '@al an update for the room' }, board.agents, ['leo', 'al']);
    assert.deepEqual(roomhold.heldIn('al', 'lease').map(roomhold.plainId), [sent.id], 'PRECONDITION: held, not typed');
    const al = board.agents.find((c) => c.sessionName === 'al');
    // The hold site noted it: the sweep tells this project once the box reads empty (a real read of the box).
    const told = [];
    const deps = {
      isAgy: () => false, readReport: () => null, now: Date.now(), decayMs: 5 * 60 * 1000,
      deliver: async (name, text) => { told.push(text); return { state: chat.DELIVERY.PLACED }; },
      shownOf: (p) => p, DELIVERY: chat.DELIVERY, env: {}, stale: () => new Set(), boxEmpty: chat.inputBoxEmpty,
    };
    arm([box('the person is still writing something here')]);
    await roomhold.flushReleased(board.agents, deps);
    assert.equal(told.length, 0, 'told while the box still held text');
    arm([EMPTY]);
    await roomhold.flushReleased(board.agents, deps);
    assert.equal(told.length, 1, 'the hold site did not note it, or the empty box was not read as empty');
    assert.match(told[0], /lease/);
    arm([box('the person is still writing something here')]);
    assert.equal(chat.inputBoxEmpty(al), false, 'text in the box');
    arm([EMPTY]);
    assert.equal(chat.inputBoxEmpty(al), true, 'an empty box');
    const unread = arm([EMPTY]);
    chat.setRunner((args) => (args[0] === 'capture-pane' ? { ran: true, status: 1, out: '', err: 'no pane' } : unread(args)));
    assert.equal(chat.inputBoxEmpty(al), false, 'a box that cannot be read');
    arm([EMPTY]);
    assert.equal(chat.inputBoxEmpty({ ...al, runner: 'codex' }), false, 'another runner\'s box is not read');
  } finally { messages.setRunner(null); roomhold.forget('al'); board.restore(); }
});
