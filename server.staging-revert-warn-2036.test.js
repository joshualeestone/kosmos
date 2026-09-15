'use strict';

/**
 * kosmos#2036 -- the boot-time silent-revert diagnostic (observability slice).
 *
 * A box INSTALLED from the staging channel but RESOLVING prod has silently lost its
 * staging subscription at login (kosmos#2969): the board's launchd job carries no update
 * channel, so updateChannel() falls back to prod and the box quietly stops being ahead of
 * prod, with no error. `stagingRevertWarning(recorded, resolved)` is the pure predicate the
 * boot diagnostic fires on; the warn itself lives inside the listen callback, which a
 * require-only test never reaches, so the predicate is the testable seam.
 *
 * The signature is EXACTLY one of the four combinations: installed-from-staging yet
 * polling-prod. The other three are negative controls, and each is a real, correct state:
 *  - (staging, staging): a healthy staging subscriber. No warn.
 *  - (prod, prod): a plain prod box. No warn.
 *  - (prod, staging): installed from prod but deliberately pointed at staging (an explicit
 *    override, e.g. a tester who set the channel). NOT the #2969 silence, so no warn -- the
 *    predicate must not fire here, or it would cry wolf on an intentional staging aim.
 *
 * `recorded` is the RAW install stamp (recordedSourceChannel), never sourceChannelNow()'s
 * #2934-rederived badge, which would report 'prod' for a legitimately-promoted staging build
 * and mask a genuine revert. That distinction is documented at the predicate; this test pins
 * only the four-way truth table.
 *
 *   node --test server.staging-revert-warn-2036.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { stagingRevertWarning } = require('./server');

test('the silent-revert signature (installed staging, resolving prod) warns', () => {
  assert.equal(stagingRevertWarning('staging', 'prod'), true);
});

test('a healthy staging subscriber (installed staging, resolving staging) does not warn', () => {
  assert.equal(stagingRevertWarning('staging', 'staging'), false);
});

test('a plain prod box (installed prod, resolving prod) does not warn', () => {
  assert.equal(stagingRevertWarning('prod', 'prod'), false);
});

test('a prod box deliberately aimed at staging (installed prod, resolving staging) does not warn', () => {
  // The #2969 failure is a LOST staging subscription, not a gained one. An override toward
  // staging is intentional, not the silent revert, so the diagnostic must stay quiet.
  assert.equal(stagingRevertWarning('prod', 'staging'), false);
});

test('only the staging->prod combination is the revert (exhaustive truth table)', () => {
  const channels = ['staging', 'prod'];
  const fired = [];
  for (const recorded of channels) {
    for (const resolved of channels) {
      if (stagingRevertWarning(recorded, resolved)) fired.push(`${recorded}->${resolved}`);
    }
  }
  assert.deepEqual(fired, ['staging->prod']);
});
