'use strict';

/**
 * MERGED AND INERT: does a PRODUCTION path actually call this?
 *
 *   node --test reachability-1502.test.js
 *
 * 🛑 THE CLASS, AND IT PRODUCED TWO INSTANCES IN ONE DAY FROM ONE AUTHOR.
 *
 *   #1497   merged POST /api/connect/start { accountDir }. web/index.html
 *           referenced it ZERO times. The route was reachable by curl and by
 *           nobody with a mouse.
 *   #1120   merged engine/liveness.js. NOTHING called seen(), so the liveness
 *           directory had never been created on a machine that had run Kosmos
 *           for a week, and every paneless agent was invisible.
 *
 * ⭐ A GREEN SUITE PROVES THE CODE WORKS. NOTHING IN IT PROVES ANYTHING CALLS
 * THE CODE. Both of those shipped with passing tests, because a unit test
 * supplies its own caller: `status.paneless-roster.test.js:50` literally writes
 * the heartbeat itself before asserting the roster reads it. That is correct
 * for a unit test and it is exactly why the suite could not see the gap.
 *
 * 🛑 WHY THIS IS A CURATED LIST AND NOT A SWEEP, WHICH I MEASURED BEFORE
 * BUILDING. A blanket "every engine export must have a production caller" reads
 * 315 of 643 exports as unwired; narrowed to functions and excluding `set*`
 * test seams it is still 150 of 462. Nearly all of those are constants and
 * helpers exported for testing, which is a legitimate and pervasive pattern
 * here. A guard with 150 false findings is theatre, and it would be dismissed
 * within a week.
 *
 * ⇒ So: entries earn their place by having ACTUALLY BITTEN. The list starts at
 * the two above. Add one when the class costs you something, and write the
 * cost in the `why`.
 *
 * ⚠️ WHAT THIS CANNOT DO. It proves a production file CONTAINS the call. It
 * does not prove the call is reached at runtime, nor that its arguments are
 * right. It is the cheapest check that would have caught both instances, and
 * it is not a substitute for exercising the path.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const CONTRACTS = [
  {
    thing: 'liveness.seen()',
    /* The roster and the name arm of resolveAgentSender both gate on
       liveness.alive(key) === true, which cannot be true with no record. */
    reachedBy: 'server.js',
    pattern: /liveness\.seen\s*\(/,
    why: '#1502: with no production caller, no paneless agent can appear on any board, so a '
       + 'Windows agent reports perfectly and stays invisible. Inert from the day #1120 merged.',
  },
  {
    thing: 'POST /api/connect/start { accountDir }',
    reachedBy: 'web/index.html',
    pattern: /accountDir/,
    why: '#1492: the only route back into an expired account. #1497 merged it and the page '
       + 'referenced it zero times, so the duplicate-account defect stayed live for a person '
       + 'with a mouse.',
  },
];

for (const c of CONTRACTS) {
  test('a production path calls ' + c.thing + ' (' + c.reachedBy + ')', () => {
    const src = fs.readFileSync(c.reachedBy, 'utf8');
    assert.match(src, c.pattern,
      'MERGED AND INERT: ' + c.thing + ' is not called from ' + c.reachedBy + '.\n'
      + c.why + '\n'
      + 'A passing unit test does not close this: a unit test supplies its own caller.');
  });
}

test('CONTROL: this file can fail', () => {
  /* 🛑 EVERY ENTRY ABOVE IS CURRENTLY SATISFIED, so all of them pass and none
     of them demonstrates that the matcher works. A control that cannot return
     the dangerous answer is not a control. */
  const src = fs.readFileSync('server.js', 'utf8');
  assert.doesNotMatch(src, /zqQxJvB7NotAThing/,
    'the negative control string exists, which means this file was written into the thing it searches');
  assert.match(src, /liveness/, 'the reader is broken: server.js does not mention liveness at all');
});
