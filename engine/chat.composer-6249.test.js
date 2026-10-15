'use strict';

/**
 * #6249: a line typed into an idle Claude Code agent was left in its input box, unsent, and the log said placed.
 * The board now reads the box (an ANSI capture) before it pastes and after the Enter. The screens in
 * test-support/composer-6249/ are real captures (`capture-pane -e`) of Claude Code 2.1.300 at 80x24, trimmed to the
 * input box.
 *
 * Pins: the reader finds the LIVE box and ignores dim text (the placeholder, the queued hint, suggestions), prompts
 * already sent, queued lines and menus; nothing is pasted behind text already in the box; a box that empties is
 * placed; a box still holding only ours gets ONE more Enter; a box holding anything besides ours never gets one; a
 * box that cannot be read keeps today's verdict; a non-Claude runner is not read at all.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-composer-6249-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');

const chat = require('./chat');
const fleet = require('../test-support/fleet');

const SCREENS = path.join(__dirname, '..', 'test-support', 'composer-6249');
const screen = (name) => fs.readFileSync(path.join(SCREENS, name + '.ansi'), 'utf8');
const RULE = '\x1b[38;5;244m' + '─'.repeat(80);
/* A box drawn as Claude Code draws it (❯, a no-break space, the text, wrapped rows indented, a rule under it). */
function box(text) {
  const rows = [];
  let rest = String(text);
  rows.push('\x1b[39m❯ ' + rest.slice(0, 76));
  rest = rest.slice(76);
  while (rest) { rows.push('  ' + rest.slice(0, 76)); rest = rest.slice(76); }
  return [RULE, ...rows, RULE, '  scratch · Haiku 5.5'].join('\n') + '\n';
}
const EMPTY = screen('empty-after-turn');

function ok(out) { return { ran: true, spawnFailed: false, status: 0, out: out || '', err: '' }; }
const okProbe = () => ok('2.1.300\t\t0\n');
/* Every `capture-pane -e` (the input-box read) answers the next of `boxes` (the last one repeats); every other tmux
   call succeeds. */
function arm(boxes, plain) {
  const calls = [];
  const queue = boxes.slice();
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message') return okProbe();
    if (args[0] === 'capture-pane' && args.includes('-e')) return ok(queue.length > 1 ? queue.shift() : queue[0]);
    if (args[0] === 'capture-pane' && plain) return ok(plain);   // a plain screen read (the Codex gate's)
    return ok();
  };
  fn.calls = calls;
  fn.reads = () => calls.filter((a) => a[0] === 'capture-pane' && a.includes('-e')).length;
  fn.pasted = () => calls.filter((a) => a[0] === 'paste-buffer').length;
  fn.enters = () => calls.filter((a) => a[0] === 'send-keys' && a[a.length - 1] === 'Enter').length;
  chat.setRunner(fn);
  chat.setDryRun(false);
  chat.setPauser(() => {});
  return fn;
}
function withAgent(opts, fn) {
  const board = fleet.install([fleet.agent('al', { state: 'idle', ...opts })]);
  try { return fn(board.agents); } finally { board.restore(); }
}
const MSG = 'Kosmos here: please read the ruling on the card and carry on with the fix you described this morning.';
const LOOKS = Math.ceil(chat.SUBMIT_SETTLE_MS / chat.SUBMIT_LOOK_MS);

test.beforeEach(() => { chat.resetForTests(); });
test.after(() => { chat.setRunner(null); try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('#6249 reader: the live box on the real screens, dim text not counted as typed', () => {
  assert.deepEqual(chat.composerText(screen('empty-placeholder')), { ok: true, text: '' }, 'the dim placeholder is not typed text');
  assert.deepEqual(chat.composerText(screen('empty-after-turn')), { ok: true, text: '' });
  assert.deepEqual(chat.composerText(screen('typed-short')), { ok: true, text: 'hello there unsent words' });
  assert.deepEqual(chat.composerText(screen('ghost-at')), { ok: true, text: 'look at @READ' });
  assert.deepEqual(chat.composerText(screen('ghost-slash')), { ok: true, text: '/comp' }, 'the slash menu under the box (its own indented ❯) is not the box');
  assert.deepEqual(chat.composerText(screen('busy-queued')), { ok: true, text: '' },
    'a busy turn: the prompt already sent and the line queued behind it draw ❯ with a plain space, and the queued hint is dim');
  const long = chat.composerText(screen('typed-long'));
  assert.equal(long.ok, true);
  assert.match(long.text, /^jumps over the lazy dog .*the quick brown fox jumps over the lazy dog$/, 'a long box shows only its last rows');
  assert.equal(chat.composerText(screen('after-turn')).ok, false, 'a question menu on screen: no live box to read');
  assert.deepEqual(chat.composerText(''), { ok: false });
});

test('#6249 reader (Liu Kang m5853): ghost text reads as typed in a plain capture, and not in the ANSI read', () => {
  const ghost = screen('empty-placeholder');
  const plain = ghost.replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(plain, /❯ Try "how do I log an error\?"/, 'CONTROL: without the colours, the placeholder looks like text in the box');
  assert.equal(chat.composerText(ghost).text, '', 'with them, it is dim and not counted');
  // A suggestion drawn dim AFTER typed text (the inline autocomplete form): only the typed part counts.
  const inline = '\x1b[39m❯ please check\x1b[2m the logs\x1b[0m\n' + RULE + '\n';
  assert.equal(chat.composerText(inline).text, 'please check');
  // A colour's own numbers are not SGR 2: 38;5;2 is green, not dim.
  assert.equal(chat.composerText('\x1b[39m❯ \x1b[38;5;2mgreen words\x1b[39m\n' + RULE + '\n').text, 'green words');
});

test('#6249 holds: ours by its tail, wrapping ignored; anything else is other', () => {
  const wire = '[message from your colleague liukang · m1] ' + MSG;
  assert.equal(chat.composerHolds('', wire), 'empty');
  assert.equal(chat.composerHolds(wire, wire), 'ours');
  assert.equal(chat.composerHolds('carry on with the fix you de scribed this morning.', wire), 'ours', 'a row break inside a word');
  assert.equal(chat.composerHolds('hello ' + wire, wire), 'other', 'the person typed before ours');
  assert.equal(chat.composerHolds(wire + ' and one more', wire), 'other', 'something after ours');
  assert.equal(chat.composerHolds('look at @READ', wire), 'other');
});

test('#6249: nothing is pasted behind text already in the box', () => withAgent({}, (roster) => {
  const t = arm([box('a reminder from earlier that nobody sent')]);
  const v = chat.deliver('al', MSG, roster);
  assert.equal(v.state, chat.DELIVERY.COULD_NOT);
  assert.equal(v.inputHeld, true);
  assert.match(v.because, /already holds text that was not sent/);
  assert.equal(t.pasted(), 0, 'nothing typed');
  assert.equal(t.enters(), 0, 'and no Enter');
}));

test('#6249: a box that empties after the Enter is placed, with one Enter', () => withAgent({}, (roster) => {
  const t = arm([EMPTY, box(MSG), EMPTY]);
  const v = chat.deliver('al', MSG, roster);
  assert.equal(v.state, chat.DELIVERY.PLACED, v.because);
  assert.equal(t.pasted() > 0, true, 'CONTROL: it was typed');
  assert.equal(t.enters(), 1);
  assert.equal(v.unsubmitted, undefined);
}));

test('#6249: still only ours after the settle gets ONE more Enter; still there after it is said unsubmitted', () => withAgent({}, (roster) => {
  const t = arm([EMPTY, box(MSG)]);   // the box keeps our message whatever is pressed
  const v = chat.deliver('al', MSG, roster);
  assert.equal(t.enters(), 2, 'one Enter, and one retry, never a third');
  assert.equal(v.state, chat.DELIVERY.UNCONFIRMED);
  assert.equal(v.unsubmitted, true);
  assert.match(v.because, /went into its input box and was not sent/);
  assert.equal(t.reads(), 1 + 2 * LOOKS, 'read before the paste, then through each settle');
}));

test('#6249: a retry that empties the box is placed', () => withAgent({}, (roster) => {
  const stuck = Array(LOOKS).fill(box(MSG));
  const t = arm([EMPTY, ...stuck, EMPTY]);
  const v = chat.deliver('al', MSG, roster);
  assert.equal(v.state, chat.DELIVERY.PLACED, v.because);
  assert.equal(v.enterRetried, true);
  assert.equal(t.enters(), 2);
}));

test('#6249 (Liu Kang m5853): a box holding anything besides ours never gets the retry Enter', () => withAgent({}, (roster) => {
  const t = arm([EMPTY, box('the person was typing this ' + MSG)]);
  const v = chat.deliver('al', MSG, roster);
  assert.equal(t.enters(), 1, 'only the first Enter: never one over text that is not ours');
  assert.equal(v.state, chat.DELIVERY.UNCONFIRMED);
  assert.equal(v.unsubmitted, true);
  assert.match(v.because, /held other text too, so Enter was not pressed again/);
}));

test('#6249: ghost text after the Enter is an empty box, not our text still there', () => withAgent({}, (roster) => {
  const t = arm([EMPTY, screen('empty-placeholder')]);
  const v = chat.deliver('al', MSG, roster);
  assert.equal(v.state, chat.DELIVERY.PLACED);
  assert.equal(t.enters(), 1);
}));

test('#6249: a box that cannot be read keeps today\'s verdict', () => withAgent({}, (roster) => {
  const t = arm([screen('after-turn')]);   // a menu where the box would be, before and after
  const v = chat.deliver('al', MSG, roster);
  assert.equal(v.state, chat.DELIVERY.PLACED);
  assert.equal(t.enters(), 1);
}));

test('#6249: the async path confirms the same way', async () => {
  const board = fleet.install([fleet.agent('al', { state: 'idle' })]);
  try {
    const t = arm([EMPTY, box(MSG)]);
    const v = await chat.deliverAsync('al', MSG, board.agents);
    assert.equal(v.state, chat.DELIVERY.UNCONFIRMED);
    assert.equal(v.unsubmitted, true);
    assert.equal(t.enters(), 2);
  } finally { board.restore(); }
});

test('#6249: a Codex pane is not read this way (its box is its own)', () => withAgent({ runner: 'codex', command: 'node', screen: '› Ask Codex to do anything' }, (roster) => {
  const t = arm([box('anything')], '› Ask Codex to do anything\n  gpt-5.6-sol default');
  const v = chat.deliver('al', MSG, roster);
  assert.equal(t.reads(), 0);
  assert.equal(v.state, chat.DELIVERY.PLACED, v.because);
}));
