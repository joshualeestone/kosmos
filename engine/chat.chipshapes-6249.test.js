'use strict';

/**
 * #6249 (0.7.70 report, after #6780): delivered messages sat unsent in idle agents' input boxes, and the log said Enter
 * was not pressed. Measured on Claude Code 2.1.312: one paste does not always fold into ONE chip. A 3000-character
 * paste showed as "[Pasted text #2][Pasted text #3][Pasted text #4]". The delivery accepted only a single chip alone in
 * the box as ours, so any other folded shape read as a person's text and was never pressed.
 *
 * Pins: our paste folded into several chips, or chips with runs of our own line between them, is pressed and
 * confirmed sent; left unsent, it is kept by its exact folded form and pressed by the next delivery and by a retry.
 * CONTROLS: a person's text after ours, a several-lines chip among ours, words that are not ours, a changed number,
 * and an unread box before the paste are never pressed.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-chipshapes-6249-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');

const chat = require('./chat');
const fleet = require('../test-support/fleet');

const RULE = '\x1b[38;5;244m' + '─'.repeat(80);
const draw = (text) => (text
  ? [RULE, '\x1b[39m❯\u00a0' + text, RULE, '  scratch · Haiku 5.5'].join('\n') + '\n'
  : [RULE, '\x1b[39m❯\u00a0\x1b[2mTry "write a test"\x1b[0m', RULE, '  scratch · Haiku 5.5'].join('\n') + '\n');
function ok(out) { return { ran: true, spawnFailed: false, status: 0, out: out || '', err: '' }; }

/* A Claude Code box that folds a paste the way 2.1.312 was measured to: in pieces. Once the whole of `pasted` is in,
   the box shows `shape(pasted, next)`, where `next()` hands out rising chip numbers. `enterTakes`: whether an Enter
   submits. `onBeforeEnter(state)`: runs just before an Enter (someone typing in the gap). */
function pane(opts = {}) {
  const state = { shown: opts.shown || '', pasted: '', chipNo: opts.chipNo || 0, sent: [], enters: 0, buffer: '', pid: opts.pid || '4242', unreadOnce: !!opts.unreadOnce };
  const calls = [];
  const next = () => { state.chipNo += 1; return `[Pasted text #${state.chipNo}]`; };
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message' && args.includes('#{session_attached}')) return ok('0\n');
    if (args[0] === 'display-message' && args.includes('#{pane_pid}')) return ok(state.pid + '\n');
    if (args[0] === 'display-message') return ok('2.1.312\t\t0\n');
    if (args[0] === 'capture-pane' && args.includes('-e')) {
      if (state.unreadOnce) { state.unreadOnce = false; return ok('a screen with no input box on it\n'); }
      return ok(draw(state.shown));
    }
    if (args[0] === 'capture-pane') return ok('');
    if (args[0] === 'set-buffer') { state.buffer = args[args.length - 1]; return ok(); }
    if (args[0] === 'paste-buffer') {
      state.pasted += state.buffer;
      state.shown = opts.shape ? opts.shape(state.pasted, next) : state.pasted;
      return ok();
    }
    if (args[0] === 'send-keys' && args[args.length - 1] === 'Enter') {
      if (opts.onBeforeEnter) opts.onBeforeEnter(state);
      state.enters += 1;
      if (opts.enterTakes !== false && state.shown) { state.sent.push(state.pasted || state.shown); state.shown = ''; state.pasted = ''; }
      return ok();
    }
    return ok();
  };
  fn.calls = calls;
  fn.state = state;
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
const LONG = 'Kosmos here: ' + Array.from({ length: 80 }, (_, i) => `point ${i} of the release plan for the team`).join(', ');
const pastedCount = (p) => p.calls.filter((a) => a[0] === 'paste-buffer').length;
const keptLines = () => { try { return JSON.parse(fs.readFileSync(path.join(require('./store').ROOT, 'unsent-lines.json'), 'utf8')); } catch { return {}; } };
/* The shapes: the box shows its folded form only once all of our line is in (deliver pastes in 256-byte chunks). */
const THREE_CHIPS = (pasted, next) => (pasted.length >= LONG.length ? next() + next() + next() : pasted);
const CHIP_THEN_TAIL = (pasted, next) => (pasted.length >= LONG.length ? next() + ' ' + LONG.slice(-300) : pasted);
const START_CHIP_TAIL = (pasted, next) => (pasted.length >= LONG.length ? LONG.slice(0, 120) + next() + LONG.slice(1500, 1700) + next() + LONG.slice(-200) : pasted);

test.beforeEach(() => { chat.resetForTests(); });
test.after(() => { chat.setRunner(null); try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('#6249: our long message folded into three chips is pressed and confirmed sent', () => withAgent((roster) => {
  assert.ok(LONG.length > 3000, 'PRECONDITION: long enough to fold more than once');
  for (const [name, shape] of [['three chips', THREE_CHIPS], ['a chip and our end', CHIP_THEN_TAIL], ['our start, chips and runs of ours', START_CHIP_TAIL]]) {
    chat.resetForTests();
    const p = pane({ shape });
    const v = chat.deliver('al', LONG, roster);
    assert.equal(v.state, chat.DELIVERY.PLACED, name + ': ' + v.because);
    assert.notEqual(v.unsubmitted, true, name + ': not left in the box');
    assert.equal(p.state.enters, 1, name + ': Enter pressed once, on our folded paste');
    assert.equal(p.state.sent.length, 1, name);
    // The agent is not jammed: the next message goes in too.
    const v2 = chat.deliver('al', 'and one more short line', roster);
    assert.equal(v2.state, chat.DELIVERY.PLACED, name + ' next: ' + v2.because);
  }
}));

test('#6249: left unsent as three chips, it is kept by its exact folded form and the next delivery presses it first', () => withAgent((roster) => {
  pane({ shape: THREE_CHIPS, enterTakes: false });
  const v = chat.deliver('al', LONG, roster);
  assert.equal(v.unsubmitted, true, 'PRECONDITION: Enter did not take');
  const entry = Object.values(keptLines())[0];
  assert.equal(entry && entry.chip, '[Pastedtext#1][Pastedtext#2][Pastedtext#3]', 'the whole folded form is kept, numbers included');
  chat.restartUnsentForTests();
  const p2 = pane({ shown: '[Pasted text #1][Pasted text #2][Pasted text #3]', chipNo: 3 });
  const v2 = chat.deliver('al', 'the next short message', roster);
  assert.equal(v2.state, chat.DELIVERY.PLACED, v2.because);
  assert.equal(v2.earlierSubmitted, true, 'our folded paste was pressed before the new line');
  assert.equal(p2.state.enters, 2);
}));

test('#6249: a retry presses our remembered folded paste with nothing new behind it', () => withAgent(async (roster) => {
  const scheduled = [];
  chat.setUnsentRetryScheduler((ms, fn) => scheduled.push({ ms, fn }));
  chat.setRosterSource(() => roster);
  pane({ shape: CHIP_THEN_TAIL, enterTakes: false });
  assert.equal(chat.deliver('al', LONG, roster).unsubmitted, true, 'PRECONDITION');
  assert.ok(scheduled.length > 0, 'retries were set');
  const kept = Object.values(keptLines())[0];
  assert.ok(kept && kept.chip && kept.chip.startsWith('[Pastedtext#1]'), 'PRECONDITION: kept as its folded form: ' + JSON.stringify(kept));
  const p = pane({ shown: '[Pasted text #1] ' + LONG.slice(-300), chipNo: 1 });
  scheduled[0].fn();
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
  assert.equal(p.state.enters, 1, 'the retry pressed our folded paste');
  assert.equal(p.state.shown, '');
}));

test('#6249 CONTROL: a person typing after our folded paste, in the gap before our Enter, is never sent with it', () => withAgent((roster) => {
  const p = pane({ shape: THREE_CHIPS });
  const real = p;
  let typed = false;
  chat.setRunner((args) => {
    if (args[0] === 'capture-pane' && args.includes('-e') && !typed && pastedCount(real) > 0 && /^\[Pasted text #3\]$/.test(real.state.shown.slice(-16))) {
      typed = true; real.state.shown += ' wait, hold that';
    }
    return real(args);
  });
  const v = chat.deliver('al', LONG, roster);
  assert.equal(typed, true, 'PRECONDITION: the person typed in the gap');
  assert.equal(real.state.enters, 0, 'no Enter: the box held someone else\'s words after ours');
  assert.equal(v.unsubmitted, true, 'said as left unsent, not sent');
}));

test('#6249 CONTROL: unread box before the paste ties no folded shape to us', () => withAgent((roster) => {
  const p = pane({ shape: THREE_CHIPS, unreadOnce: true });
  const v = chat.deliver('al', LONG, roster);
  assert.ok(p.state.shown.startsWith('[Pasted text'), 'PRECONDITION: the paste folded');
  assert.equal(p.state.enters, 0, 'no Enter on chips nothing ties to our paste');
  assert.equal(v.unsubmitted, true);
}));

test('#6249 CONTROL: our kept folded form with one number changed is never pressed', () => withAgent((roster) => {
  pane({ shape: THREE_CHIPS, enterTakes: false });
  assert.equal(chat.deliver('al', LONG, roster).unsubmitted, true, 'PRECONDITION: kept as #1 #2 #3');
  const p = pane({ shown: '[Pasted text #1][Pasted text #2][Pasted text #4]', chipNo: 4 });
  const v = chat.deliver('al', 'the next message', roster);
  assert.equal(v.inputHeld, true, 'refused: not the form we left');
  assert.equal(p.state.enters, 0);
}));

test('#6249: which folded boxes count as ours', () => {
  const h = chat.composerHolds;
  const w = LONG;
  assert.equal(h('[Pasted text #2][Pasted text #3][Pasted text #4]', w, true), 'ours', 'several chips, right after our paste');
  assert.equal(h('[Pasted text #2] ' + w.slice(-300), w, true), 'ours', 'a chip and then our end');
  assert.equal(h(w.slice(0, 120) + '[Pasted text #2]', w, true), 'ours', 'our start and then a chip');
  assert.equal(h(w.slice(0, 120) + '[Pasted text #2]' + w.slice(1500, 1700) + '[Pasted text #3]' + w.slice(-200), w, true), 'ours', 'runs of ours in order between chips');
  // CONTROLS
  assert.equal(h('[Pasted text #2][Pasted text #3 +4 lines]', w, true), 'other', 'a several-lines chip is never ours');
  assert.equal(h('[Pasted text #2] ' + w.slice(-300) + ' and more', w, true), 'other', 'text after our end is someone else\'s');
  assert.equal(h('hello [Pasted text #2]', w, true), 'other', 'text before the chip that is not our start');
  assert.equal(h('[Pasted text #2]' + w.slice(1500, 1700) + '[Pasted text #3]' + w.slice(200, 400) + '[Pasted text #4]', w, true), 'other', 'runs of ours out of order');
  assert.equal(h('[Pasted text #2][Pasted text #3]', w), 'other', 'nothing ties the chips to our paste');
  assert.equal(h('[Pasted text #2][Pasted text #3]', w, '[Pastedtext#2][Pastedtext#3]'), 'ours', 'the exact form we left');
  assert.equal(h('[Pasted text #2][Pasted text #3]', w, '[Pastedtext#2]'), 'other', 'more than the form we left');
  // A person's own chip beside words of ours that hide nothing is not ours (each chip of ours hides part of the line).
  assert.equal(h(w + ' [Pasted text #5]', w, true), 'other', 'all of our line, then a chip');
  assert.equal(h('[Pasted text #5]' + w, w, true), 'other', 'a chip, then all of our line');
  assert.equal(h(w.slice(0, 100) + '[Pasted text #5]' + w.slice(100), w, true), 'other', 'a chip inside our line, hiding nothing');
  assert.equal(h('[Pasted text #2][Pasted text #3]' + w.slice(-300), w.slice(0, 900) + w.slice(-300), true), 'other', 'two chips with room for one');
});

test('#6249: a short message that only MENTIONS a chip in its words is compared word for word and pressed', () => withAgent((roster) => {
  const msg = 'Claude Code showed [Pasted text #2][Pasted text #3] for one paste';
  const p = pane();   // no folding: the box shows our words
  const v = chat.deliver('al', msg, roster);
  assert.equal(v.state, chat.DELIVERY.PLACED, v.because);
  assert.notEqual(v.unsubmitted, true);
  assert.equal(p.state.enters, 1, 'pressed: those chips are our own words');
  const h = chat.composerHolds;
  assert.equal(h(msg, msg), 'ours', 'the whole line, chip-like words and all');
  // CONTROLS
  assert.equal(h('[Pasted text #2][Pasted text #3] for one paste', 'a line with no chips in its words at all'), 'other', 'the same text is not ours when our line does not say it');
  assert.equal(h(msg + '[Pasted text #9]', msg), 'other', 'a real chip after our words (not words of ours) is someone else\'s');
  assert.equal(h('[Pasted text #2]', msg, null), 'other', 'a box that is one chip and nothing else is still a chip box, as before');
}));

/* Reads of the box after our paste and before our Enter: `frames` are what each successive read shows (the last one
   repeats). Only reads after the paste and before the first Enter are rewritten. */
function drawing(p, frames) {
  let n = 0;
  chat.setRunner((args) => {
    if (args[0] === 'capture-pane' && args.includes('-e') && pastedCount(p) > 0 && p.state.enters === 0) {
      p.state.shown = frames[Math.min(n, frames.length - 1)];
      n += 1;
    }
    return p(args);
  });
  return () => n;
}

test('#6249: a fold still drawing (one chip, then all three) is pinned only once it settles, as the whole form', () => withAgent((roster) => {
  const p = pane({ shape: THREE_CHIPS, enterTakes: false });
  const reads = drawing(p, ['[Pasted text #1]', '[Pasted text #1][Pasted text #2][Pasted text #3]']);
  const v = chat.deliver('al', LONG, roster);
  assert.ok(reads() >= 3, 'PRECONDITION: it read again while the fold drew: ' + reads());
  assert.equal(p.state.enters, 1, 'pressed once the form stopped changing');
  assert.equal(v.unsubmitted, true, 'PRECONDITION: Enter did not take');
  const entry = Object.values(keptLines())[0];
  assert.equal(entry && entry.chip, '[Pastedtext#1][Pastedtext#2][Pastedtext#3]', 'the settled whole form is what was pinned and kept');
}));

test('#6249: a folded box still changing after its looks is pinned as its latest form, as one read was before', () => withAgent((roster) => {
  const p = pane({ shape: THREE_CHIPS, enterTakes: false });
  const frames = Array.from({ length: 20 }, (_, i) => Array.from({ length: i + 1 }, (_, j) => `[Pasted text #${j + 1}]`).join(''));
  const reads = drawing(p, frames);
  const v = chat.deliver('al', LONG, roster);
  assert.equal(p.state.enters, 1, 'pressed: still ours, only still drawing');
  assert.equal(v.unsubmitted, true, 'PRECONDITION: Enter did not take');
  const entry = Object.values(keptLines())[0];
  const pinned = entry && entry.chip;
  assert.ok(pinned && pinned.startsWith('[Pastedtext#1][Pastedtext#2]'), 'the latest form read before the Enter is kept: ' + pinned);
  assert.ok(reads() >= 3, 'PRECONDITION: it looked more than once');
}));

test('#6249 CONTROL: a person pasting in the gap beside our whole line (which stayed text) is never sent with it', () => withAgent((roster) => {
  const mid = LONG.slice(0, 900);   // long enough for the tie, and here it stays text
  const p = pane();
  drawing(p, [mid + ' [Pasted text #5]']);
  const v = chat.deliver('al', mid, roster);
  assert.equal(p.state.enters, 0, 'no Enter: that chip hides none of our line');
  assert.equal(v.unsubmitted, true);
}));

test('#6249: after ours went, a person typing their own chip with words is not read as ours still there', () => withAgent((roster) => {
  const p = pane({ shape: THREE_CHIPS, enterTakes: false });
  chat.setRunner((args) => {
    const out = p(args);
    // Our Enter takes our folded paste out; the person then types words with a chip of their own.
    if (args[0] === 'send-keys' && args[args.length - 1] === 'Enter') { p.state.chipNo += 1; p.state.shown = `see [Pasted text #${p.state.chipNo}]`; }
    return out;
  });
  const v = chat.deliver('al', LONG, roster);
  assert.equal(p.state.enters, 1);
  assert.equal(v.state, chat.DELIVERY.PLACED, 'said as sent: ours is gone, what is there is theirs: ' + v.because);
  assert.notEqual(v.unsubmitted, true);
}));

test('#6249 CONTROL: after our Enter, our pinned chips still there with a person\'s words is never said as sent', () => withAgent((roster) => {
  const p = pane({ shape: THREE_CHIPS, enterTakes: false });
  chat.setRunner((args) => {
    const out = p(args);
    if (args[0] === 'send-keys' && args[args.length - 1] === 'Enter') p.state.shown = '[Pasted text #1][Pasted text #2][Pasted text #3] wait';
    return out;
  });
  const v = chat.deliver('al', LONG, roster);
  assert.equal(p.state.enters, 1, 'only our own Enter');
  assert.notEqual(v.state, chat.DELIVERY.PLACED, 'not said as sent: our chips are still in the box');
}));

test('#6249: with nothing pinned (the read before our Enter failed), a box of several chips after it is never said as sent', () => withAgent((roster) => {
  const p = pane({ shape: THREE_CHIPS, enterTakes: false });
  let blind = 0;
  chat.setRunner((args) => {
    // The read just before our Enter shows no box (a dialog drawn over it), so nothing is pinned and Enter goes blind.
    if (args[0] === 'capture-pane' && args.includes('-e') && pastedCount(p) > 0 && p.state.enters === 0) { blind += 1; return ok('a screen with no input box on it\n'); }
    return p(args);
  });
  const v = chat.deliver('al', LONG, roster);
  assert.ok(blind >= 1, 'PRECONDITION: the read before the Enter failed');
  assert.equal(p.state.enters, 1, 'PRECONDITION: the Enter went blind');
  assert.ok(p.state.shown.startsWith('[Pasted text'), 'PRECONDITION: our fold is still in the box');
  assert.notEqual(v.state, chat.DELIVERY.PLACED, 'not said as sent: chips hide their words, so ours may be there');
}));

test('#6249: a fold first read mid-draw (a chip, then words not yet at our end) gets its second look and is pressed', () => withAgent((roster) => {
  const p = pane({ shape: THREE_CHIPS });
  const mid = '[Pasted text #1] ' + LONG.slice(1000, 1100);
  drawing(p, [mid, '[Pasted text #1][Pasted text #2][Pasted text #3]']);
  assert.equal(chat.composerHolds(mid, LONG, true), 'other', 'PRECONDITION: the first read alone does not look like ours');
  const v = chat.deliver('al', LONG, roster);
  assert.equal(p.state.enters, 1, 'pressed once it had drawn');
  assert.equal(v.state, chat.DELIVERY.PLACED, v.because);
}));
