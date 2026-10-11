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
  new Function('document', 'ab', page.liftAll(SCRIPT, [...page.PLATFORM_COPY_FNS, 'paintUpdateAbort']) + '\npaintUpdateAbort(ab);')(doc, ab);
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
  const run = (ab) => new Function('document', 'ab', page.liftAll(SCRIPT, [...page.PLATFORM_COPY_FNS, 'paintUpdateAbort']) + '\npaintUpdateAbort(ab);')(doc, ab);
  run({ count: 2 });
  assert.match(slot.innerHTML, /2 times/, 'the notice did not show first');
  run(null);
  assert.equal(slot.innerHTML, '', 'a later null left a stale abort notice standing over a recovered machine');
});

// #4675: the stops after the pause are not "Kosmos was busy". Each gets its own sentence, chosen by reason.
const BUSY = /Kosmos was busy each time\. Quit and reopen Kosmos: reopening usually clears whatever was holding the update, so the next one can finish\. Your agents keep working, they do not live in this window\./;

test('#4675 control: board-would-not-pause, port-still-held, an unknown reason and no reason all keep the #2055 sentence, word for word', () => {
  const base = paint({ count: 2, reason: 'board-would-not-pause' }).innerHTML;
  assert.match(base, BUSY, 'the #2055 sentence changed');
  for (const reason of ['port-still-held', 'something-new', '', undefined, 7, 'constructor', '__proto__', 'hasOwnProperty']) {
    assert.equal(paint({ count: 2, reason }).innerHTML, base, 'reason ' + JSON.stringify(reason) + ' did not keep the #2055 words');
  }
});

test('#4675: a failed port check says the update could not check, never that Kosmos was busy', () => {
  const h = paint({ count: 4, reason: 'port-check-failed' }).innerHTML;
  assert.match(h, /tried to install it 4 times and could not, because this computer could not check whether Kosmos had stopped/);
  assert.match(h, /the update changed nothing/);
  assert.match(h, /quit and reopen Kosmos/i, 'no step a person can take');
  assert.match(h, /please tell us/i, 'nothing says what to do if it persists');
  assert.match(h, /agents keep working/i);
  assert.ok(!/was busy/i.test(h), 'it still blamed a busy Kosmos');
  assert.ok(!/update now|paste|install line|kosmos stop|in a terminal/i.test(h), 'the notice offered a dead button or a type instruction');
});

test('#4675: an unreachable holder of the port says something else was using the connection, and ends in a restart', () => {
  const h = paint({ count: 1, reason: 'port-unreachable' }).innerHTML;
  assert.match(h, /tried to install it once and could not, because something was still using the connection Kosmos runs on/);
  assert.match(h, /it changed nothing/);
  assert.match(h, /quit and reopen Kosmos/i);
  assert.match(h, /restart this computer/i);
  assert.match(h, /agents keep working/i);
  assert.ok(!/was busy/i.test(h), 'it still blamed a busy Kosmos');
  assert.ok(!/update now|paste|install line|kosmos stop|in a terminal/i.test(h), 'the notice offered a dead button or a type instruction');
});

test('#4675: a streak whose reason changes at the same count repaints (the key is count and reason)', () => {
  const slot = { dataset: {}, innerHTML: '' };
  const doc = { getElementById: () => slot };
  const run = (ab) => new Function('document', 'ab', page.liftAll(SCRIPT, [...page.PLATFORM_COPY_FNS, 'paintUpdateAbort']) + '\npaintUpdateAbort(ab);')(doc, ab);
  run({ count: 1, reason: 'board-would-not-pause' });
  assert.match(slot.innerHTML, /was busy/);
  run({ count: 1, reason: 'port-check-failed' });
  assert.match(slot.innerHTML, /could not check/, 'the same count with a new reason kept the old words');
  const before = slot.innerHTML; slot.innerHTML = 'UNTOUCHED';
  run({ count: 1, reason: 'port-check-failed' });
  assert.equal(slot.innerHTML, 'UNTOUCHED', 'an unchanged notice was repainted (a screen reader would hear it again)');
  assert.ok(before.length > 0);
});

test('#4675: the board marks its own installer run, and setup.sh records the port stops only for that run', () => {
  const upd = fs.readFileSync(nodePath.join(__dirname, 'engine', 'update.js'), 'utf8');
  assert.match(upd, /KOSMOS_SOURCE_CHANNEL: updateChannel\(\), KOSMOS_UPDATE_BY_BOARD: '1' \}/, 'the installer the board spawns no longer carries KOSMOS_UPDATE_BY_BOARD');
  const setup = fs.readFileSync(nodePath.join(__dirname, 'install', 'setup.sh'), 'utf8');
  for (const reason of ['port-check-failed', 'port-unreachable', 'port-still-held']) {
    assert.ok(setup.includes('if [ "$_kosmos_by_board" = 1 ]; then _kosmos_note_pause_abort ' + reason + '; fi'), 'setup.sh does not record ' + reason + ' for the board\'s run only');
  }
  // every reason setup.sh can write is one the page has decided about: its own words, or named as keeping #2055's
  const written = [...setup.matchAll(/_kosmos_note_pause_abort ([a-z-]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(written, ['board-would-not-pause', 'port-check-failed', 'port-still-held', 'port-unreachable']);
});
