'use strict';

/**
 * kosmos#6436: a delivery left its line in an agent's input box, unsent, and then refused every later message ("its
 * input box already holds text that was not sent") until a person pressed Enter in the pane; agents sat idle 30 to 60
 * minutes. Measured on Claude Code 2.1.302: at 80x24 (every agent pane here: tmux default-size) a 1,500-byte line
 * scrolls, the box shows only its last 462 characters with ❯ on the first VISIBLE row, so "the box shows all of our
 * line" could never hold and the line was never pressed.
 *
 * Pins: a scrolled box showing exactly what it showed when the line was left is pressed; one a person cut or added to
 * is not; the memory survives a board restart; the board presses its own line again on its own (30 s, 2 min, 5 min)
 * without waiting for the next message, and never on text that is not its own; dim suggestion text is an empty box.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-unsent-6436-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');

const chat = require('./chat');
const store = require('./store');
const fleet = require('../test-support/fleet');

const RULE = '\x1b[38;5;244m' + '─'.repeat(80);
const rowsOf = (text) => {
  const rows = [];
  let rest = String(text);
  while (rest) { rows.push(rest.slice(0, 76)); rest = rest.slice(76); }
  return rows;
};
/* A box drawn as Claude Code draws it. `keep` rows at most: a longer line scrolls, and ❯ is drawn on the first row that
   still shows (measured), not on the line's start. */
function box(text, keep) {
  let rows = rowsOf(text);
  if (keep && rows.length > keep) rows = rows.slice(-keep);
  const drawn = rows.map((r, i) => (i === 0 ? '\x1b[39m❯\u00a0' : '  ') + r);
  return [RULE, ...drawn, RULE, '  scratch · Haiku 5.5'].join('\n') + '\n';
}
const EMPTY = [RULE, '\x1b[39m❯\u00a0\x1b[2mTry "write a test"\x1b[0m', RULE, '  scratch · Haiku 5.5'].join('\n') + '\n';

function ok(out) { return { ran: true, spawnFailed: false, status: 0, out: out || '', err: '' }; }
function arm(boxes) {
  const calls = [];
  const queue = boxes.slice();
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message') return ok('2.1.302\t\t0\n');
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
function withAgent(fn) {
  const board = fleet.install([fleet.agent('al', { state: 'idle' })]);
  let out;
  try { out = fn(board.agents); } catch (e) { board.restore(); throw e; }
  if (out && typeof out.then === 'function') return out.finally(() => board.restore());
  board.restore();
  return out;
}
/* A room post as long as the one on the card: far more than an 80x24 box shows. */
const LONG = '[room post from mona] ' + Array.from({ length: 40 }, (_, i) => `point ${i} about the release plan for the team`).join(', ');
const KEEP = 7;   // the rows the measured 80x24 box showed
const flush = async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r)); };
const MSG = 'Kosmos here: please read the ruling on the card and carry on with the fix you described this morning.';

test.beforeEach(() => { chat.resetForTests(); });
test.after(() => { chat.setRunner(null); try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('kosmos#6436: a long line left unsent in a scrolled box is pressed by the next delivery, then that one goes', () => withAgent((roster) => {
  assert.ok(LONG.length > KEEP * 76 * 2, 'PRECONDITION: the line is far longer than the box shows');
  const scrolled = box(LONG, KEEP);
  assert.notEqual(chat.composerText(scrolled).text.replace(/\s+/g, ''), LONG.replace(/\s+/g, ''), 'PRECONDITION: the box shows only its end');
  const t1 = arm([EMPTY, scrolled]);
  assert.equal(chat.deliver('al', LONG, roster).unsubmitted, true, 'PRECONDITION: left in the box');
  assert.equal(t1.enters(), 1);
  const NEXT = 'a short line that comes after the long one';
  const t2 = arm([scrolled, EMPTY, EMPTY, box(NEXT), EMPTY]);
  const v = chat.deliver('al', NEXT, roster);
  assert.equal(v.state, chat.DELIVERY.PLACED, v.because);
  assert.equal(v.earlierSubmitted, true, 'the long line went first');
  assert.equal(t2.enters(), 2);
}));

test('kosmos#6436 CONTROL: text added to a scrolled box, or a short end that is not what the box showed, is never pressed', () => withAgent((roster) => {
  const scrolled = box(LONG, KEEP);
  arm([EMPTY, scrolled]);
  chat.deliver('al', LONG, roster);
  const shown = chat.composerText(scrolled).text;
  for (const changed of [shown + ' and more', 'hello ' + shown, shown.slice(-120)]) {
    const t = arm([box(changed)]);
    const v = chat.deliver('al', 'a later line', roster);
    assert.equal(v.inputHeld, true, JSON.stringify(changed.slice(0, 30)));
    assert.equal(t.enters(), 0, 'not the board\'s line alone, or too little of it to say');
  }
}));

test('kosmos#6436: a pane resized since (a person attached) shows a longer or shorter end of the line, and it is still pressed', () => withAgent((roster) => {
  arm([EMPTY, box(LONG, KEEP)]);
  chat.deliver('al', LONG, roster);
  for (const keep of [12, 4]) {
    const wider = box(LONG, keep);
    const t = arm([wider, EMPTY, EMPTY, box('next'), EMPTY]);
    const v = chat.deliver('al', 'next', roster);
    assert.equal(v.earlierSubmitted, true, 'rows kept: ' + keep);
    assert.equal(t.enters(), 2);
    // Leave it again for the next arm.
    chat.resetForTests();
    arm([EMPTY, box(LONG, KEEP)]);
    chat.deliver('al', LONG, roster);
  }
}));

test('kosmos#6436: the remembered line survives a board restart (kept on disk, private), and is pressed after it', () => withAgent((roster) => {
  arm([EMPTY, box(MSG)]);
  assert.equal(chat.deliver('al', MSG, roster).unsubmitted, true, 'PRECONDITION');
  const file = path.join(store.ROOT, 'unsent-lines.json');
  assert.ok(fs.existsSync(file), 'the line is on disk');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'only this user can read it');
  chat.restartUnsentForTests();
  const t = arm([box(MSG), EMPTY, EMPTY, box('after the restart'), EMPTY]);
  const v = chat.deliver('al', 'after the restart', roster);
  assert.equal(v.earlierSubmitted, true, 'the restarted board still knew its own line');
  assert.equal(t.enters(), 2);
  // CONTROL: once sent, it is gone from disk too, so a restart does not bring it back.
  chat.restartUnsentForTests();
  const t2 = arm([box(MSG)]);
  assert.equal(chat.deliver('al', 'another', roster).inputHeld, true);
  assert.equal(t2.enters(), 0);
}));

test('kosmos#6436: the board presses its own line again on its own (30 s, 2 min, 5 min), with no later message', () => withAgent(async (roster) => {
  const scheduled = [];
  arm([EMPTY, box(MSG)]);
  chat.setUnsentRetryScheduler((ms, fn) => scheduled.push({ ms, fn }));
  assert.equal(chat.deliver('al', MSG, roster).unsubmitted, true, 'PRECONDITION');
  assert.deepEqual(scheduled.map((s) => s.ms), [30000, 120000, 300000]);
  // The first retry: the box still shows only our line, so Enter, and it empties.
  const t = arm([box(MSG), EMPTY]);
  scheduled[0].fn();
  await flush();
  assert.equal(t.enters(), 1, 'pressed with no new message to carry it');
  assert.equal(t.pasted(), 0, 'nothing new typed');
  // The later ones find it gone and do nothing.
  const t2 = arm([box(MSG)]);
  scheduled[1].fn();
  scheduled[2].fn();
  await flush();
  assert.equal(t2.enters(), 0, 'a sent line is not pressed again');
}));

test('kosmos#6436: a retry that leaves it still there keeps it for the next; a retry during a delivery, or after a newer line, presses nothing', () => withAgent(async (roster) => {
  const scheduled = [];
  arm([EMPTY, box(MSG)]);
  chat.setUnsentRetryScheduler((ms, fn) => scheduled.push({ ms, fn }));
  chat.deliver('al', MSG, roster);
  const t = arm([box(MSG)]);   // pressed, and it does not empty
  scheduled[0].fn();
  await flush();
  assert.equal(t.enters(), 1);
  const t2 = arm([box(MSG), EMPTY]);
  scheduled[1].fn();
  await flush();
  assert.equal(t2.enters(), 1, 'still remembered after a retry that did not take, so the next one presses it');
  // A newer line left unsent (the box was cleared by hand, then the next line also stuck): the older line's retries
  // leave it to its own, whatever the clock reads (ids, not times).
  scheduled.length = 0;
  const OTHER = 'a newer line the board also left in the box, long enough to be read as its own';
  arm([EMPTY, box(MSG)]);
  chat.deliver('al', MSG, roster);
  const olderRetries = scheduled.slice();
  const realNow = Date.now;
  const frozen = realNow();
  Date.now = () => frozen;   // both lines in the same millisecond
  try {
    arm([EMPTY, box(OTHER)]);
    assert.equal(chat.deliver('al', OTHER, roster).unsubmitted, true, 'PRECONDITION: the newer line stuck too');
  } finally { Date.now = realNow; }
  const t3 = arm([box(OTHER), EMPTY]);
  olderRetries[1].fn();
  await flush();
  assert.equal(t3.enters(), 0, 'an older line\'s retry does not press a newer line');
  // CONTROL: the newer line's own retry does press it.
  scheduled[scheduled.length - 3].fn();
  await flush();
  assert.equal(t3.enters(), 1);
}));

test('kosmos#6436: a retry that fires while a delivery is typing to that pane presses nothing (that delivery presses it first)', () => withAgent(async (roster) => {
  const scheduled = [];
  arm([EMPTY, box(MSG)]);
  chat.setUnsentRetryScheduler((ms, fn) => scheduled.push({ ms, fn }));
  chat.deliver('al', MSG, roster);
  // An async delivery held in its paste-to-Enter gap: the box shows the board's earlier line, which it presses first.
  let open = () => {};
  const t = arm([box(MSG), EMPTY, EMPTY, box('next'), EMPTY]);
  chat.setPauser(() => new Promise((resolve) => { open = resolve; }));
  const pending = chat.deliverAsync('al', 'next', roster);
  await flush();
  const before = t.enters();
  scheduled[0].fn();
  await flush();
  assert.equal(t.enters(), before, 'the retry stood down while the delivery held the pane');
  chat.setPauser(() => {});
  open();
  await pending;
}));

test('kosmos#6436 CONTROL: a retry never presses text that is not the board\'s, nor a pane that is no longer an agent\'s', () => withAgent(async (roster) => {
  const scheduled = [];
  arm([EMPTY, box(MSG)]);
  chat.setUnsentRetryScheduler((ms, fn) => scheduled.push({ ms, fn }));
  chat.deliver('al', MSG, roster);
  const t = arm([box('the person started typing ' + MSG)]);
  scheduled[0].fn();
  await flush();
  assert.equal(t.enters(), 0, 'someone else\'s text in the box');
  // A pane that fell to a shell: never an Enter into it. (The arm above forgot that line, as the box showed it gone:
  // leave a fresh one.)
  scheduled.length = 0;
  arm([EMPTY, box(MSG)]);
  chat.deliver('al', MSG, roster);
  assert.equal(scheduled.length, 3, 'PRECONDITION: a fresh line with its retries');
  const calls = [];
  chat.setRunner((args) => {
    calls.push(args);
    if (args[0] === 'display-message') return ok('zsh\t\t0\n');
    if (args[0] === 'capture-pane' && args.includes('-e')) return ok(box(MSG));
    return ok();
  });
  scheduled[0].fn();
  await flush();
  assert.equal(calls.filter((a) => a[0] === 'send-keys').length, 0, 'not into a shell');
}));

test('kosmos#6436: a retry forgets the line only when two reads a look apart agree it is gone (one read mid-redraw does not)', () => withAgent(async (roster) => {
  const scheduled = [];
  arm([EMPTY, box(MSG)]);
  chat.setUnsentRetryScheduler((ms, fn) => scheduled.push({ ms, fn }));
  chat.deliver('al', MSG, roster);
  const t = arm([EMPTY, box(MSG)]);   // an empty read, then the line is there after all
  scheduled[0].fn();
  await flush();
  assert.equal(t.enters(), 0, 'nothing pressed on a read that disagreed');
  const t2 = arm([box(MSG), EMPTY]);
  scheduled[1].fn();
  await flush();
  assert.equal(t2.enters(), 1, 'still remembered: the next retry presses it');
  // CONTROL: two empty reads do forget it.
  chat.resetForTests();
  scheduled.length = 0;
  chat.setUnsentRetryScheduler((ms, fn) => scheduled.push({ ms, fn }));
  arm([EMPTY, box(MSG)]);
  chat.deliver('al', MSG, roster);
  arm([EMPTY]);
  scheduled[0].fn();
  await flush();
  const t3 = arm([box(MSG)]);
  assert.equal(chat.deliver('al', 'a later line', roster).inputHeld, true, 'forgotten: those words now read as not the board\'s');
  assert.equal(t3.enters(), 0);
}));

test('kosmos#6436 (the stated limit, pinned): a delivery presses a cut end of ours that still fills four rows; the words sent are all the board\'s', () => withAgent((roster) => {
  const SOLID = 'R' + 'abcdefghij'.repeat(60);
  arm([EMPTY, box(SOLID, KEEP)]);
  chat.deliver('al', SOLID, roster);
  const cut = SOLID.slice(-300);
  assert.ok(rowsOf(cut).length >= 4, 'PRECONDITION: four rows or more');
  const t = arm([box(cut), EMPTY, EMPTY, box('next'), EMPTY]);
  assert.equal(chat.deliver('al', 'next', roster).earlierSubmitted, true);
  assert.equal(t.enters(), 2);
}));

test('kosmos#6436 (the ghost case): a dim suggestion after the Enter is an empty box: nothing remembered, nothing retried', () => withAgent((roster) => {
  const scheduled = [];
  const ghost = [RULE, '\x1b[39m❯\u00a0\x1b[2m' + MSG + '\x1b[0m', RULE, '  scratch · Haiku 5.5'].join('\n') + '\n';
  assert.equal(chat.composerText(ghost).text, '', 'PRECONDITION: dim text is not typed text');
  arm([EMPTY, ghost]);
  chat.setUnsentRetryScheduler((ms, fn) => scheduled.push({ ms, fn }));
  const v = chat.deliver('al', MSG, roster);
  assert.equal(v.state, chat.DELIVERY.PLACED, v.because);
  assert.equal(scheduled.length, 0, 'a box that only looks full is not a stranded line');
}));

test('kosmos#6436: an unattended retry takes only the exact match: a resized box is left to the next delivery (CONTROL: which presses it)', () => withAgent(async (roster) => {
  const scheduled = [];
  arm([EMPTY, box(LONG, KEEP)]);
  chat.setUnsentRetryScheduler((ms, fn) => scheduled.push({ ms, fn }));
  chat.deliver('al', LONG, roster);
  const resized = box(LONG, 12);
  const t = arm([resized]);
  scheduled[0].fn();
  await flush();
  assert.equal(t.enters(), 0, 'no unattended Enter on an end the box did not show when the board left it');
  const t2 = arm([resized, EMPTY, EMPTY, box('next'), EMPTY]);
  assert.equal(chat.deliver('al', 'next', roster).earlierSubmitted, true, 'CONTROL: a delivery takes the resized end');
  assert.equal(t2.enters(), 2);
}));

test('kosmos#6436: a long end of ours in a box that has not scrolled (a person cut its start) is not pressed', () => withAgent((roster) => {
  // A line with no spaces, so its end keeps its length when whitespace is squashed.
  const SOLID = 'R' + 'abcdefghij'.repeat(60);
  arm([EMPTY, box(SOLID, KEEP)]);
  chat.deliver('al', SOLID, roster);
  const cut = SOLID.slice(-220);
  assert.ok(rowsOf(cut).length < 4, 'PRECONDITION: a box this short shows all it holds');
  assert.ok(cut.length >= 200, 'PRECONDITION: long enough for the scrolled-end rule, so only the rows decide');
  const t = arm([box(cut)]);
  assert.equal(chat.deliver('al', 'a later line', roster).inputHeld, true);
  assert.equal(t.enters(), 0);
}));

test('kosmos#6436: a line left more than a day ago is not loaded after a restart (its words may come back as the person\'s own)', () => withAgent((roster) => {
  arm([EMPTY, box(MSG)]);
  chat.deliver('al', MSG, roster);
  const file = path.join(store.ROOT, 'unsent-lines.json');
  const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of Object.keys(kept)) kept[k].at = Date.now() - 25 * 60 * 60 * 1000;
  fs.writeFileSync(file, JSON.stringify(kept));
  chat.restartUnsentForTests();
  const t = arm([box(MSG)]);
  assert.equal(chat.deliver('al', 'a later line', roster).inputHeld, true);
  assert.equal(t.enters(), 0, 'a day-old memory is not trusted');
}));
