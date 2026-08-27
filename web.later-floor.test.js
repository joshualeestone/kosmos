'use strict';

/**
 * "Later" is a promise about time, not about version numbers (#1094).
 *
 * 🛑 PER-VERSION SUPPRESSION IS A RATE LIMIT IN THE WRONG UNIT. It assumes a
 * release is rare. At one a week, "Later" bought a week and the rule looked
 * correct for months. At three an hour it buys twenty minutes, and on
 * 2026-08-27 we cut 0.5.78 and 0.5.79 inside one: the person pressed Later and
 * we came back, correctly, three times.
 *
 * ⭐ THE UNIT IS THE BUG, NOT THE RELEASE RATE. The suppression was keyed to an
 * event whose frequency we control and the reader does not.
 *
 * ⚠️ AND THE FLOOR MUST STAY A FLOOR. Permanent or per-day is the tempting
 * version and it is worse: someone who defers an update they later need has no
 * route back but Check for Update, and a stale app is what #1042 exists to
 * shout about. Both directions are asserted below, because a test that only
 * proves we go quiet would pass a build that never asks again.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page.js');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.slice(PAGE.lastIndexOf('<script>'));

const HOUR = 60 * 60 * 1000;

/** Run the three Later helpers against a given stored value and clock. */
function suppresses({ stored, now, offer }) {
  const localStorage = { getItem: () => stored };
  const body = page.liftConst(SCRIPT, 'UPDATE_LATER_FLOOR_MS')
    + page.liftAll(SCRIPT, ['parseLaterNote', 'updateLaterVersion', 'updateLaterUntil', 'updateLaterSuppresses'])
    + '\nreturn updateLaterSuppresses(OFFER);';
  return new Function('localStorage', 'Date', 'OFFER', body)(
    localStorage,
    { now: () => now },
    offer,
  );
}

test('CONTROL: the floor is a real duration, and the helpers were actually lifted', () => {
  /* Without this, a lift that silently produced an empty body would make every
     assertion below pass by returning undefined, which is falsy, which reads as
     "not suppressed" — the safe-looking answer. */
  const floor = new Function(page.liftConst(SCRIPT, 'UPDATE_LATER_FLOOR_MS') + '\nreturn UPDATE_LATER_FLOOR_MS;')();
  assert.ok(floor >= HOUR && floor <= 6 * HOUR, `implausible floor: ${floor}ms`);
  assert.equal(suppresses({ stored: JSON.stringify({ v: '1.0', at: 0 }), now: 0, offer: '1.0' }), true);
});

test('the same version is still quiet, floor or no floor', () => {
  const stored = JSON.stringify({ v: '0.5.79', at: 0 });
  assert.equal(suppresses({ stored, now: 99 * HOUR, offer: '0.5.79' }), true,
    'pressing Later on a version must keep it quiet for that version');
});

test('a NEW release inside the floor stays quiet: the burst costs one prompt, not three', () => {
  const stored = JSON.stringify({ v: '0.5.78', at: 0 });
  assert.equal(suppresses({ stored, now: 20 * 60 * 1000, offer: '0.5.79' }), true,
    'twenty minutes and one release later, we asked again');
});

test('a NEW release AFTER the floor asks again: this is a floor, not a mute', () => {
  const stored = JSON.stringify({ v: '0.5.78', at: 0 });
  assert.equal(suppresses({ stored, now: 3 * HOUR, offer: '0.5.79' }), false,
    'Later became permanent, which strands anyone who defers an update they later need');
});

test('nothing stored means ask: a fresh machine is not suppressed', () => {
  assert.equal(suppresses({ stored: null, now: 5 * HOUR, offer: '0.5.79' }), false);
});

test('a build that stored the OLD bare string is still honoured for its version', () => {
  /* Format changes must not re-ask a person who already pressed Later. The old
     shape had no floor, so it suppresses its own version and nothing else. */
  assert.equal(suppresses({ stored: '0.5.78', now: 5 * HOUR, offer: '0.5.78' }), true,
    'a pre-existing Later was forgotten because we changed the format under them');
  assert.equal(suppresses({ stored: '0.5.78', now: 1000, offer: '0.5.79' }), false,
    'the old shape gained a floor it never had');
});

test('a corrupt stored value asks rather than going silent forever', () => {
  /* The failure that would be invisible: unparseable JSON swallowed into a
     "suppress" answer means the toast never returns and nobody can tell. */
  assert.equal(suppresses({ stored: '{not json', now: 0, offer: '0.5.79' }), false);
});
