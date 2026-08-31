'use strict';

/**
 * A managed block dropped by the byte cap must SAY SO (kosmos#1673).
 *
 * 🛑 THE DEFECT. Creation appends five managed blocks, each size-capped. Only
 * two of them said anything when the cap dropped them:
 *
 *     you          silent
 *     reports      silent
 *     messages     warned
 *     defaults     silent   <- carries "Answering the person who messaged you"
 *     connections  warned
 *
 * ⇒ The block teaching an agent how to answer its operator was one of the
 * SILENT three, so the exact failure #1673 is named for could happen with the
 * person told nothing. Dropping the block is the right failure and is
 * unchanged here; dropping it in silence is not.
 *
 * ⚠️ THE CAP IS REACHABLE, AND I MEASURED IT RATHER THAN READING IT:
 *
 *     MAX_BYTES              262144
 *     defaults block costs    11807
 *     => instructions over    250337 bytes lose it
 *
 * That is the top 4.5% of the permitted range: a size the refusal at
 * create.js:2113 ACCEPTS. The appends are also cumulative, so `defaults`,
 * being appended after the others, is the likeliest of the five to be dropped.
 *
 * ⚠️ SANDBOX BEFORE REQUIRING, for every reason the long note at the top of
 * create.test.js gives: this code makes directories, writes instruction files
 * and writes launchd jobs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'create-blockdrop-1673-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.on('exit', () => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const create = require('./create');
const instructions = require('./instructions');
const defaults = require('./defaults');

/* The same trick create.test.js uses: real binaries that exist everywhere, so
   the suite does not depend on what happens to be installed. */
const BINS = { claudeBin: '/bin/echo', tmuxBin: '/bin/echo' };

/** Instructions big enough that appending the defaults would cross the cap. */
function hugeInstructions() {
  const cost = Buffer.byteLength(defaults.appendTo('x'), 'utf8') - 1;
  /* Deliberately inside the ACCEPTED range: over (MAX - cost) so the block
     cannot fit, and under MAX so create.js:2113 does not refuse outright. If
     it refused, this test would prove nothing about the drop. */
  const target = instructions.MAX_BYTES - Math.floor(cost / 2);
  assert.ok(target < instructions.MAX_BYTES, 'fixture must be accepted');
  assert.ok(target > instructions.MAX_BYTES - cost, 'fixture must be too big for the block');
  return '# Their own words\n\n' + 'x'.repeat(target - 24) + '\n';
}

test('#1673: a block dropped by the byte cap is reported, not swallowed', () => {
  const mine = hugeInstructions();
  const r = create.createAgent({ ...BINS, name: 'mk-huge-1673', role: 'pm', instructions: mine });

  /* PRECONDITION. If the fixture were refused for size, every assertion below
     would be about a creation that never happened. */
  assert.notEqual(r.outcome, create.OUTCOME.REFUSED,
    'precondition: the agent must still be CREATED. Dropping a block must never refuse the agent');

  const labels = (r.steps || []).map((s) => s.label).join('\n');

  assert.match(labels, /operating instructions/,
    'the defaults block was dropped and nothing said so: this is the block that teaches it to answer you');

  /* And the warning must be a FAILURE, not a cheerful note. */
  const dropped = (r.steps || []).filter((s) => /operating instructions/.test(s.label));
  assert.equal(dropped.length, 1, 'exactly one report for the one block that was dropped');
  assert.equal(dropped[0].ok, false, 'a dropped block is not an ok step');

  /* ⚠️ SCOPE, STATED RATHER THAN IMPLIED. This exercises the `defaults` drop
     only. An agent with no manager and no `you` record never reaches the
     `reports` or `you` appends at all, so their warnings CANNOT fire here and
     asserting them would be asserting a branch that did not run. An earlier
     draft of this test did exactly that and failed for that reason, which is
     how I learned it. Those two warnings are added in the same shape and are
     covered by inspection, not by this file. */
});

test('#1673 CONTROL: an agent whose blocks all fit reports no drop', () => {
  /* The negative arm, and it is what stops a fix that just always warns. A fix
     that pushed these steps unconditionally would satisfy the test above and be
     worse than the bug, because every creation would claim its agent is broken. */
  const r = create.createAgent({ ...BINS, name: 'mk-small-1673', role: 'pm', instructions: '# Small\n\nDo the thing carefully.\n' });
  assert.notEqual(r.outcome, create.OUTCOME.REFUSED, 'precondition: this one must be created too');

  const labels = (r.steps || []).map((s) => s.label).join('\n');
  assert.doesNotMatch(labels, /operating instructions/, 'nothing was dropped, so nothing may be reported as dropped');
  assert.doesNotMatch(labels, /reports-to section/, 'nothing was dropped, so nothing may be reported as dropped');
  assert.doesNotMatch(labels, /section about you/, 'nothing was dropped, so nothing may be reported as dropped');
});

test('#1701 GUARD: the phrases the controls key on still exist in the product', () => {
  /* 🛑 WHY THIS TEST EXISTS, AND IT IS ABOUT THE TESTS ABOVE RATHER THAN THE
     PRODUCT. Two of the assertions above are `doesNotMatch` with NO paired
     `match` on the same phrase:

         'operating instructions'   match @82 AND doesNotMatch   <- protected
         'reports-to section'       doesNotMatch ONLY            <- was exposed
         'section about you'        doesNotMatch ONLY            <- was exposed

     An absence assertion whose phrase no longer exists PASSES VACUOUSLY. So
     rewording either warning would have silently voided its control and
     nothing would have gone red. Found by Splinter reporting the same shape
     against a colleague's live PR; this is the same defect in my own merged
     work, and the phrases were one edit away from meaningless.

     ⚠️ THE SECOND WEAKNESS, WHICH THIS DOES NOT FIX AND I AM NOT PRETENDING IT
     DOES: those two controls run in a scenario that never reaches the `reports`
     or `you` appends at all (no manager, no `you` record), so they assert the
     absence of warnings that COULD NOT HAVE FIRED. True by construction rather
     than because the fix works. Closing that needs a fixture with a manager and
     a `you` record, which is a bigger change than this one.

     ⇒ So this guard makes the controls FAIL LOUDLY on a rewording. It does not
     make them strong. Both statements are true and the second one matters. */
  const src = fs.readFileSync(nodePath.join(__dirname, 'create.js'), 'utf8');

  for (const phrase of ['operating instructions', 'reports-to section', 'section about you']) {
    assert.ok(src.includes(phrase),
      `the control above keys on "${phrase}" and the product no longer says it, so that control now passes for free`);
  }

  /* CONTROL: this assertion must be capable of failing. A phrase the product
     has never contained must not be found, or `includes` is matching anything. */
  assert.equal(src.includes('zzz-not-a-warning-phrase'), false,
    'the instrument matches a string that cannot exist, so its positives mean nothing');
});
