'use strict';
/* #2055: the update-abort board notice. `paintUpdateAbort` renders #uabort-slot
   from /api/status's `updateAbort` marker ONLY when count >= 1; null / absent /
   count 0 / a garbage count all clear it, and it is called only from tick()'s
   success path so a failed read never paints a false "healthy" (that screen is
   #2023's). The browser check (docs/browser-checks/render-update-abort-2055.js)
   drives the REAL tick end-to-end with the card's dangerous-answer control; this
   pins the painter directly and fast. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const page = require('./test-support/page');
const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));

// A fresh slot per call, driving the REAL paintUpdateAbort source (not a copy).
function paint(ab) {
  const slot = { dataset: {}, innerHTML: '' };
  const doc = { getElementById: (id) => (id === 'uabort-slot' ? slot : null) };
  // eslint-disable-next-line no-new-func
  new Function('document', 'ab', page.lift(SCRIPT, 'paintUpdateAbort') + '\npaintUpdateAbort(ab);')(doc, ab);
  return slot;
}

test('a present marker (count >= 1) renders the notice: title, N, agents-kept-working, and the quit-and-reopen action', () => {
  const s = paint({ count: 3, reason: 'board-would-not-pause', port: 16180, ts: '' });
  assert.match(s.innerHTML, /new version of Kosmos is ready/i, 'the notice did not render its title for a stuck machine');
  assert.match(s.innerHTML, /tried to install it 3 times/i, 'the count N is the sentence that makes someone act, and it is missing');
  assert.match(s.innerHTML, /agents keep working/i, 'the reassurance that agents keep working is missing');
  // The action is quit-and-reopen (measured: "Update now" re-enters setup.sh's
  // pause block and aborts identically -- a dead button), never a type instruction.
  assert.match(s.innerHTML, /quit and reopen Kosmos/i, 'the actionable, user-doable step is missing');
  assert.ok(!/update now|paste|install line|kosmos stop|in a terminal/i.test(s.innerHTML), 'the notice offered a dead button or a type instruction');
});

test('count 1 reads "install it once", not "1 times"', () => {
  const s = paint({ count: 1 });
  assert.match(s.innerHTML, /install it once/i);
  assert.ok(!/1 times/.test(s.innerHTML), 'count 1 rendered the plural form');
});

test('null / absent / count 0 / a garbage count all clear the slot (no false notice, never NaN)', () => {
  assert.equal(paint(null).innerHTML, '', 'an explicit null painted a notice');
  assert.equal(paint(undefined).innerHTML, '', 'an absent field painted a notice');
  assert.equal(paint({ count: 0 }).innerHTML, '', 'count 0 (healthy) painted a notice');
  const g = paint({ count: 'lots' });
  assert.equal(g.innerHTML, '', 'a non-numeric count painted a notice');
  assert.ok(!/NaN/.test(g.innerHTML), 'a garbage count leaked NaN into the copy');
});

test('a recovered machine (count -> null on the SAME slot) clears the notice it was showing', () => {
  const slot = { dataset: {}, innerHTML: '' };
  const doc = { getElementById: () => slot };
  const run = (ab) => new Function('document', 'ab', page.lift(SCRIPT, 'paintUpdateAbort') + '\npaintUpdateAbort(ab);')(doc, ab);
  run({ count: 2 });
  assert.match(slot.innerHTML, /2 times/, 'the notice did not show first');
  run(null);
  assert.equal(slot.innerHTML, '', 'a later null left a stale abort notice standing over a recovered machine');
});
