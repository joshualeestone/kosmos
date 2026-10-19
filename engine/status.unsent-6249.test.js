'use strict';
/* #6249: status.unsentInputOf, the card's unsentInput. The plain capture decides whether to look; only a pane showing
   something in its box is captured again with colours; the same text has to sit there UNSENT_SHOW_MS before the card
   says so. Screens are the real captures in test-support/composer-6249/. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const status = require('./status');

const SCREENS = path.join(__dirname, '..', 'test-support', 'composer-6249');
const screen = (name) => fs.readFileSync(path.join(SCREENS, name + '.ansi'), 'utf8');
const plain = (ansi) => ansi.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const PANE = { name: 'al', target: 'al:0.0', command: '2.1.300', runner: '' };
const T0 = Date.parse('2026-10-15T10:00:00Z');

function armAnsi(ansi) {
  let reads = 0;
  status.setAnsiCapture(() => { reads += 1; return ansi; });
  return () => reads;
}
test.beforeEach(() => status.resetUnsentForTests());
test.after(() => status.setAnsiCapture(null));

test('#6249: an empty box, the dim placeholder or the queued hint costs no second capture and says nothing', () => {
  for (const name of ['empty-after-turn', 'empty-placeholder', 'busy-queued']) {
    const reads = armAnsi(screen(name));
    assert.equal(status.unsentInputOf(PANE, plain(screen(name)), T0), null, name);
    assert.equal(reads(), 0, name + ': no colour read for a quiet pane');
  }
});

test('#6249: text that stays in the box shows on the card after a few minutes, timed from when it was first seen', () => {
  const s = screen('typed-short');
  const reads = armAnsi(s);
  assert.equal(status.unsentInputOf(PANE, plain(s), T0), null, 'just seen: maybe someone typing');
  assert.equal(status.unsentInputOf(PANE, plain(s), T0 + status.UNSENT_SHOW_MS - 1), null);
  assert.deepEqual(status.unsentInputOf(PANE, plain(s), T0 + status.UNSENT_SHOW_MS), { since: new Date(T0).toISOString() });
  assert.equal(reads(), 1, 'round 1: one colour read while the box shows the same thing, not one per pass');
  // The box is emptied: the record goes.
  armAnsi(screen('empty-after-turn'));
  assert.equal(status.unsentInputOf(PANE, plain(screen('empty-after-turn')), T0 + status.UNSENT_SHOW_MS + 1), null);
  armAnsi(s);
  assert.equal(status.unsentInputOf(PANE, plain(s), T0 + status.UNSENT_SHOW_MS + 2), null, 'seen again: the clock starts over');
});

test('#6249: text that changes (a person typing) restarts the clock', () => {
  armAnsi(screen('typed-short'));
  status.unsentInputOf(PANE, plain(screen('typed-short')), T0);
  armAnsi(screen('ghost-at'));
  assert.equal(status.unsentInputOf(PANE, plain(screen('ghost-at')), T0 + status.UNSENT_SHOW_MS), null);
});

test('#6249: what the plain read takes for text but the colours say is dim is not unsent text', () => {
  // A suggestion drawn dim after the prompt: plain says text, the colour read says empty.
  const dim = '\x1b[39m❯ \x1b[2mrun the tests again\x1b[0m\n\x1b[38;5;244m' + '─'.repeat(80) + '\n';
  const reads = armAnsi(dim);
  assert.equal(status.unsentInputOf(PANE, plain(dim), T0), null);
  assert.equal(status.unsentInputOf(PANE, plain(dim), T0 + status.UNSENT_SHOW_MS), null);
  assert.equal(reads(), 1, 'CONTROL: the plain read did ask the colours, once, and the answer is kept while it shows the same');
});

test('#6249: a Codex, Gemini, Grok or Antigravity pane is not read this way', () => {
  const reads = armAnsi(screen('typed-short'));
  for (const p of [{ ...PANE, runner: 'codex' }, { ...PANE, runner: 'gemini' }, { ...PANE, command: 'node', runner: 'grok' }]) {
    assert.equal(status.unsentInputOf(p, plain(screen('typed-short')), T0 + status.UNSENT_SHOW_MS * 2), null, p.runner);
  }
  assert.equal(reads(), 0);
});

test('#6249 round 1: an agent gone from the board loses its record, so it starts over if it comes back', () => {
  const s = screen('typed-short');
  armAnsi(s);
  status.unsentInputOf(PANE, plain(s), T0);
  status.unsentSweep(['someone-else']);
  assert.equal(status.unsentInputOf(PANE, plain(s), T0 + status.UNSENT_SHOW_MS), null, 'timed from when it was seen again');
  assert.deepEqual(status.unsentInputOf(PANE, plain(s), T0 + 2 * status.UNSENT_SHOW_MS), { since: new Date(T0 + status.UNSENT_SHOW_MS).toISOString() });
  status.unsentSweep(['al']);
  assert.ok(status.unsentInputOf(PANE, plain(s), T0 + 2 * status.UNSENT_SHOW_MS + 1), 'CONTROL: a sweep that names it keeps it');
});

test('#6249 round 1: a box that changes is read with colours again', () => {
  let now = screen('typed-short');
  let reads = 0;
  status.setAnsiCapture(() => { reads += 1; return now; });
  status.unsentInputOf(PANE, plain(now), T0);
  status.unsentInputOf(PANE, plain(now), T0 + 1);
  assert.equal(reads, 1, 'the same box: read once');
  now = screen('ghost-at');
  status.unsentInputOf(PANE, plain(now), T0 + 2);
  assert.equal(reads, 2, 'a different box: read again');
});

