'use strict';

/**
 * kosmos#6717 (cause confirmed 2026-10-20): Claude Code folds a long paste into a chip, "[Pasted text #N]", so the
 * box no longer shows the words Kosmos pasted. The delivery read the chip as a person's text, never pressed Enter, and
 * refused every later message to that agent. Seven agents jammed at one install.
 *
 * Pins: our own paste, folded, is pressed and confirmed sent; left unsent, it is remembered by its exact chip and the
 * next delivery (and a retry) presses it; a PERSON'S paste, folded the same way (one line or several), is never
 * pressed, before a delivery, in the gap before our Enter, or as a different-numbered chip after ours was taken out.
 * Chip shapes measured on Claude Code 2.1.305: "[Pasted text #N]" (one line), "[Pasted text #N +K lines]" (several),
 * N rising through a session.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-pastechip-6717-'));
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
  ? [RULE, '\x1b[39m❯ ' + text, RULE, '  scratch · Haiku 5.5'].join('\n') + '\n'
  : [RULE, '\x1b[39m❯ \x1b[2mTry "write a test"\x1b[0m', RULE, '  scratch · Haiku 5.5'].join('\n') + '\n');
function ok(out) { return { ran: true, spawnFailed: false, status: 0, out: out || '', err: '' }; }

/* A Claude Code box that folds a long paste into a chip, as measured: whatever is pasted in one delivery shows as
   "[Pasted text #N]" once it passes `fold` characters, N rising per chip. `enterTakes`: whether an Enter submits.
   `onBeforeEnter(state)`: runs just before an Enter is pressed (a person pasting in the gap). */
function pane(opts = {}) {
  const state = { shown: opts.shown || '', pasted: '', chipNo: opts.chipNo || 0, sent: [], enters: 0, buffer: '' };
  const fold = opts.fold || 300;
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message' && args.includes('#{session_attached}')) return ok('0\n');
    if (args[0] === 'display-message') return ok('2.1.305\t\t0\n');
    if (args[0] === 'capture-pane' && args.includes('-e')) return ok(draw(state.shown));
    if (args[0] === 'capture-pane') return ok('');
    if (args[0] === 'set-buffer') { state.buffer = args[args.length - 1]; return ok(); }
    if (args[0] === 'paste-buffer') {
      state.pasted += state.buffer;
      if (state.pasted.length > fold) {
        if (!/^\[Pasted text #\d+\]$/.test(state.shown)) { state.chipNo += 1; }
        state.shown = `[Pasted text #${state.chipNo}]`;
      } else state.shown = state.pasted;
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
const LONG = 'Kosmos here: ' + Array.from({ length: 40 }, (_, i) => `point ${i} of the release plan for the team`).join(', ');
const pastedCount = (p) => p.calls.filter((a) => a[0] === 'paste-buffer').length;

test.beforeEach(() => { chat.resetForTests(); });
test.after(() => { chat.setRunner(null); try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('kosmos#6717: a long message that lands as our own paste chip is pressed and confirmed sent', () => withAgent((roster) => {
  assert.ok(LONG.length > 1000, 'PRECONDITION: long enough to fold');
  const p = pane();
  const v = chat.deliver('al', LONG, roster);
  assert.equal(v.state, chat.DELIVERY.PLACED, v.because);
  assert.notEqual(v.unsubmitted, true, 'not left in the box');
  assert.equal(p.state.enters, 1, 'Enter pressed on our chip');
  assert.equal(p.state.sent.length, 1);
  assert.equal(p.state.sent[0].replace(/\s+/g, ''), LONG.replace(/\s+/g, ''), 'what went is what we pasted');
  // The agent is not jammed: the next message goes in too.
  const v2 = chat.deliver('al', 'and one more short line', roster);
  assert.equal(v2.state, chat.DELIVERY.PLACED, v2.because);
}));

test('kosmos#6717: our chip left unsent is remembered by its exact chip, and the next delivery presses it first', () => withAgent((roster) => {
  const p = pane({ enterTakes: false });
  const v = chat.deliver('al', LONG, roster);
  assert.equal(v.unsubmitted, true, 'PRECONDITION: Enter did not take, so it is left as our chip');
  assert.equal(p.state.shown, '[Pasted text #1]');
  const kept = JSON.parse(fs.readFileSync(path.join(require('./store').ROOT, 'unsent-lines.json'), 'utf8'));
  const entry = Object.values(kept)[0];
  assert.equal(entry.chip, '[Pastedtext#1]', 'the exact chip is kept, number included');
  // A restart does not lose it.
  chat.restartUnsentForTests();
  const p2 = pane({ shown: '[Pasted text #1]', chipNo: 1 });
  const v2 = chat.deliver('al', 'the next short message', roster);
  assert.equal(v2.state, chat.DELIVERY.PLACED, v2.because);
  assert.equal(v2.earlierSubmitted, true, 'our chip was pressed before the new line');
  assert.equal(p2.state.enters, 2);
}));

test('kosmos#6717: a retry presses our remembered chip with nothing new behind it', () => withAgent(async (roster) => {
  const scheduled = [];
  chat.setUnsentRetryScheduler((ms, fn) => scheduled.push({ ms, fn }));
  chat.setRosterSource(() => roster);
  pane({ enterTakes: false });
  assert.equal(chat.deliver('al', LONG, roster).unsubmitted, true, 'PRECONDITION');
  assert.ok(scheduled.length > 0, 'retries were set');
  const p = pane({ shown: '[Pasted text #1]', chipNo: 1 });
  scheduled[0].fn();
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
  assert.equal(p.state.enters, 1, 'the retry pressed our chip');
  assert.equal(p.state.shown, '');
}));

test('kosmos#6717 CONTROL: a PERSON\'S paste chip already in the box is never pressed, one line or several', () => withAgent((roster) => {
  for (const shown of ['[Pasted text #4]', '[Pasted text #4 +12 lines]']) {
    chat.resetForTests();
    const p = pane({ shown, chipNo: 4 });
    const v = chat.deliver('al', 'a message for the agent', roster);
    assert.equal(v.inputHeld, true, shown + ': refused, typed behind nothing');
    assert.equal(p.state.enters, 0, shown + ': never pressed');
    assert.equal(pastedCount(p), 0, shown + ': nothing pasted behind it');
    assert.equal(p.state.shown, shown);
  }
}));

test('kosmos#6717 CONTROL: a person pasting several lines in the gap before our Enter is never sent with ours', () => withAgent((roster) => {
  const p = pane({ onBeforeEnter: () => {} });
  // The person's paste lands between our paste and our Enter: the box now shows a multi-line chip.
  const real = p;
  let pasted = false;
  chat.setRunner((args) => {
    if (args[0] === 'capture-pane' && args.includes('-e') && real.state.shown && !pasted && real.calls.filter((a) => a[0] === 'paste-buffer').length > 0) {
      pasted = true; real.state.chipNo += 1; real.state.shown = `[Pasted text #${real.state.chipNo} +9 lines]`;
    }
    return real(args);
  });
  const v = chat.deliver('al', LONG, roster);
  assert.equal(real.state.enters, 0, 'no Enter: the box held someone else\'s paste');
  assert.notEqual(v.state, chat.DELIVERY.PLACED);
  assert.equal(v.unsubmitted, true, 'said as left unsent, not sent');
}));

test('kosmos#6717 CONTROL: our chip taken out and a person\'s chip in its place (a new number) is never pressed', () => withAgent(async (roster) => {
  chat.setRosterSource(() => roster);
  pane({ enterTakes: false });
  assert.equal(chat.deliver('al', LONG, roster).unsubmitted, true, 'PRECONDITION: ours remembered as #1');
  const p = pane({ shown: '[Pasted text #2]', chipNo: 2 });
  const v = chat.deliver('al', 'the next message', roster);
  assert.equal(v.inputHeld, true, 'refused: #2 is not the chip we left');
  assert.equal(p.state.enters, 0);
  const r = await chat.recoverStuckInput(roster[0], new Date(Date.now() - 11 * 60000).toISOString());
  assert.equal(r.outcome, 'left', 'the stuck-input sweep leaves a chip that is not ours: ' + JSON.stringify(r));
  assert.equal(p.state.enters, 0);
}));

test('kosmos#6717: which chips count as ours', () => {
  const h = chat.composerHolds;
  assert.equal(h('[Pasted text #3]', 'x'.repeat(2000), true), 'ours', 'right after our paste, a one-line chip is ours');
  assert.equal(h('[Pasted text #3 +12 lines]', 'x'.repeat(2000), true), 'other', 'never several lines: ours is one line');
  assert.equal(h('[Pasted text #3]', 'x'.repeat(2000), '[Pastedtext#3]'), 'ours', 'the chip we left, same number');
  assert.equal(h('[Pasted text #4]', 'x'.repeat(2000), '[Pastedtext#3]'), 'other', 'another number is another paste');
  assert.equal(h('[Pasted text #3]', 'x'.repeat(2000)), 'other', 'with nothing tying it to our paste: not ours');
  assert.equal(h('see [Pasted text #3]', 'x'.repeat(2000), true), 'other', 'a chip with words around it is not ours alone');
});
