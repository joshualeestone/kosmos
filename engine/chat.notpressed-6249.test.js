'use strict';

/**
 * #6249 (Angel, 11-16): a line Kosmos typed into an idle agent's input box that then held other text too was never
 * pressed (right: Enter would send the other text with it), and was also forgotten, so nothing ever sent it. Measured on
 * Agent1s 2026-11-14 18:04Z: box 448 characters, ours 292, read as other text over five more looks.
 *
 * Pins: such a line (not pressed before its Enter, or still there with other text after it) is remembered with its
 * number and gets the #6436 retries; it is pressed only once the box shows exactly all of it, by a retry or by the next
 * delivery; never while anything else is there, and never on a visible end of it in a scrolled box (the rows above are
 * where the other text was), which a plain unsent line does allow; the mark survives a board restart.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-notpressed-6249-'));
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
function box(text, keep) {
  let rows = [];
  let rest = String(text);
  while (rest) { rows.push(rest.slice(0, 76)); rest = rest.slice(76); }
  if (keep && rows.length > keep) rows = rows.slice(-keep);
  const drawn = rows.map((r, i) => (i === 0 ? '\x1b[39m❯ ' : '  ') + r);
  return [RULE, ...drawn, RULE, '  scratch · Haiku 5.5'].join('\n') + '\n';
}
const EMPTY = [RULE, '\x1b[39m❯ \x1b[2mTry "write a test"\x1b[0m', RULE, '  scratch · Haiku 5.5'].join('\n') + '\n';
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
const quiet = (fn) => { const real = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = real; } };
const flush = async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r)); };
const MSG = 'Kosmos here: please read the ruling on the card and carry on with the fix you described this morning.';
const OTHER = 'a line somebody else was typing';
/* Long enough to scroll an 80x24 box (7 rows kept), with no repeats so any end of it is unique. */
const LONG = '[room post from mona] ' + Array.from({ length: 40 }, (_, i) => `point ${i} about the release plan for the team`).join(', ');

test.beforeEach(() => { chat.resetForTests(); });
test.after(() => { chat.setRunner(null); chat.setUnsentRetryScheduler(null); chat.setRosterSource(null); try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('#6249: a line not pressed (other text in the box) carries its number, and the next delivery presses it once the box shows only it', () => withAgent((roster) => {
  const t1 = arm([EMPTY, box(OTHER + ' ' + MSG)]);
  const v1 = quiet(() => chat.deliver('al', MSG, roster));
  assert.equal(v1.confirm, 'not-pressed', 'PRECONDITION: the not-pressed branch');
  assert.equal(t1.enters(), 0, 'never an Enter over the other text');
  assert.ok(Number.isInteger(v1.unsentSeq), 'a number, so the message row can be told when it goes');
  assert.match(v1.because, /sends it later only if the other text goes and the box shows just this line/);
  // The other text is still there: refused as before, nothing pressed.
  const t2 = arm([box(OTHER + ' ' + MSG)]);
  assert.equal(chat.deliver('al', 'a later line', roster).inputHeld, true);
  assert.equal(t2.enters(), 0);
  // The other text went (its owner deleted it): ours alone is pressed first, then the new line goes.
  const t3 = arm([box(MSG), EMPTY, EMPTY, box('a later line'), EMPTY]);
  const v3 = chat.deliver('al', 'a later line', roster);
  assert.equal(v3.state, chat.DELIVERY.PLACED, v3.because);
  assert.equal(v3.earlierSubmitted, true);
  assert.equal(t3.enters(), 2);
}));

test('#6249: a not-pressed line is kept on disk marked mixed; a plain unsent line is kept unmarked', () => withAgent((roster) => {
  const file = path.join(store.ROOT, 'unsent-lines.json');
  quiet(() => { arm([EMPTY, box(OTHER + ' ' + MSG)]); chat.deliver('al', MSG, roster); });
  const mixed = Object.values(JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0].wire.endsWith(MSG), true);
  assert.equal(mixed[0].mixed, true, 'marked: it met other text');
  chat.resetForTests();
  arm([EMPTY, box(MSG)]);
  assert.equal(chat.deliver('al', MSG, roster).confirm, 'unsent', 'PRECONDITION: a plain unsent line');
  const plain = Object.values(JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.equal(plain.length, 1);
  assert.equal(plain[0].mixed, undefined, 'a plain line carries no mark');
}));

test('#6249: other text that never showed our words (a fold) is not kept, and the sentence promises nothing', () => withAgent((roster) => {
  const t = arm([EMPTY, box('[Pasted text #1 +3 lines]')]);
  const v = quiet(() => chat.deliver('al', MSG, roster));
  assert.equal(v.confirm, 'not-pressed', 'PRECONDITION');
  assert.equal(t.enters(), 0);
  assert.equal(v.unsentSeq, undefined, 'nothing kept, so no number');
  assert.doesNotMatch(v.because, /sends it later/);
  const later = arm([box(MSG)]);
  assert.equal(chat.deliver('al', 'next', roster).inputHeld, true, 'not ours to press: never kept');
  assert.equal(later.enters(), 0);
}));

test('#6249: after the Enter, ours still there with other text is remembered too (it was forgotten)', () => withAgent((roster) => {
  arm([EMPTY, box(MSG), box(OTHER + ' ' + MSG)]);
  const v = chat.deliver('al', MSG, roster);
  assert.equal(v.confirm, 'other', 'PRECONDITION: the after-Enter other branch');
  assert.ok(Number.isInteger(v.unsentSeq));
  const t = arm([box(MSG), EMPTY, EMPTY, box('next'), EMPTY]);
  assert.equal(chat.deliver('al', 'next', roster).earlierSubmitted, true);
  assert.equal(t.enters(), 2);
}));

test('#6249: the retries press it only when the box shows exactly all of it', () => withAgent(async (roster) => {
  const scheduled = [];
  chat.setUnsentRetryScheduler((ms, fn) => scheduled.push({ ms, fn }));
  chat.setRosterSource(() => roster);
  quiet(() => { arm([EMPTY, box(OTHER + ' ' + MSG)]); chat.deliver('al', MSG, roster); });
  assert.deepEqual(scheduled.map((s) => s.ms), [30000, 120000, 300000], 'the #6436 retries');
  const still = arm([box(OTHER + ' ' + MSG)]);
  scheduled[0].fn();
  await flush();
  assert.equal(still.enters(), 0, 'other text still there: nothing pressed');
  const alone = arm([box(MSG), box(MSG), EMPTY]);
  scheduled[1].fn();
  await flush();
  assert.equal(alone.enters(), 1, 'only ours left: pressed');
  assert.equal(alone.pasted(), 0, 'nothing typed again');
  const after = arm([box(MSG)]);
  scheduled[2].fn();
  await flush();
  assert.equal(after.enters(), 0, 'sent once, not again');
}));

test('#6249: a box that empties (someone sent or cleared both) forgets the line; nothing is pressed', () => withAgent(async (roster) => {
  const scheduled = [];
  chat.setUnsentRetryScheduler((ms, fn) => scheduled.push({ ms, fn }));
  chat.setRosterSource(() => roster);
  quiet(() => { arm([EMPTY, box(OTHER + ' ' + MSG)]); chat.deliver('al', MSG, roster); });
  const t = arm([EMPTY]);
  scheduled[0].fn();
  await flush();
  assert.equal(t.enters(), 0);
  const later = arm([box(MSG)]);
  assert.equal(chat.deliver('al', 'next', roster).inputHeld, true, 'forgotten: the same words later are not ours to press');
  assert.equal(later.enters(), 0);
}));

test('#6249: a scrolled box showing only an end of a line that met other text is never pressed (CONTROL: a plain unsent line is)', () => withAgent((roster) => {
  const scrolled = box(LONG, 7);
  // CONTROL: a plain unsent long line, the same scrolled box later: the next delivery presses it (#6436).
  arm([EMPTY, scrolled]);
  assert.equal(chat.deliver('al', LONG, roster).confirm, 'unsent', 'PRECONDITION');
  const c = arm([scrolled, EMPTY, EMPTY, box('next'), EMPTY]);
  assert.equal(chat.deliver('al', 'next', roster).earlierSubmitted, true, 'CONTROL: a plain line is pressed on its end');
  assert.equal(c.enters(), 2);
  // The case: the same line, not pressed because other text was there. The box later shows the same end.
  chat.resetForTests();
  quiet(() => { arm([EMPTY, box(OTHER + ' ' + LONG)]); chat.deliver('al', LONG, roster); });
  const t = arm([scrolled]);
  assert.equal(chat.deliver('al', 'next', roster).inputHeld, true);
  assert.equal(t.enters(), 0, 'the rows above the visible end are where the other text was');
}));

test('#6249: the mark survives a board restart', () => withAgent((roster) => {
  quiet(() => { arm([EMPTY, box(OTHER + ' ' + LONG)]); chat.deliver('al', LONG, roster); });
  chat.restartUnsentForTests();
  const t = arm([box(LONG, 7)]);
  assert.equal(chat.deliver('al', 'next', roster).inputHeld, true);
  assert.equal(t.enters(), 0, 'still only whole after the restart');
  const whole = arm([box(LONG), EMPTY, EMPTY, box('next'), EMPTY]);
  assert.equal(chat.deliver('al', 'next', roster).earlierSubmitted, true, 'CONTROL: whole, it is pressed');
  assert.equal(whole.enters(), 2);
}));
