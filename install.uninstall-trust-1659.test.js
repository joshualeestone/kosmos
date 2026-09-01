'use strict';

/**
 * The uninstall's trust-mark transcript says only what is true of THIS machine.
 *
 * 🛑 WHY THIS FILE EXISTS: the two sentences it guards were once gated by ONE
 * flag, and that flag was mine. They assert OPPOSITE things. "For a folder you
 * still use, the mark applies" claims a LIVE mark; the next sentence claims a
 * REMOVED one. On a machine whose only marked config belongs to a disconnected
 * account, the first was false and the header above it was false of every file it
 * listed. Reachable rather than theoretical: the block's own comment records 19
 * of 22 configs on the fleet machine carrying `false`.
 *
 * ⚠️ THE FIX WAS UNGUARDED. Collapsing the two flags back into one restores the
 * exact bug with nothing red, which is the same class this branch found by
 * accident on the OpenAI success sentence: two ends pinned, the middle covered by
 * nothing.
 *
 * 📌 This is a SOURCE-level pin and says so. The sibling uninstall tests boot a
 * sandboxed install and are stronger; this one asserts the structure that carries
 * the promise, which is what a collapse would destroy. Named honestly rather than
 * implying behavioural coverage it does not have.
 *
 *   node --test install.uninstall-trust-1659.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');

/* The body of the first `if [ "$FLAG" = yes ]; then ... fi` after `from`. Read
   from the source rather than restated here, so a reworded sentence cannot pass
   by matching a copy this test carries. */
function guardedBy(flag) {
  const at = SETUP.indexOf('if [ "$' + flag + '" = yes ]; then');
  assert.ok(at > -1, 'no `if [ "$' + flag + '" = yes ]` block in setup.sh, so the transcript is not gated on it');
  const end = SETUP.indexOf('\n    fi', at);
  assert.ok(end > at, 'the ' + flag + ' block does not close the way this extraction expects');
  return SETUP.slice(at, end);
}

test('#1659: the live-mark sentence is gated by the LIVE flag, not by the removed one', () => {
  const live = guardedBy('_trust_live');
  assert.match(live, /the mark applies/,
    'the live-mark sentence is not inside the _trust_live block, so it can print when no live mark exists');
  assert.ok(!/reads it, so you will be asked again/.test(live),
    'the disconnected sentence is inside the LIVE block, which is the one-flag bug this test exists to stop');
});

test('#1659: the disconnected sentence is gated by the REMOVED flag, not by the live one', () => {
  const removed = guardedBy('_trust_removed');
  assert.match(removed, /reads it, so you will be asked again/,
    'the disconnected sentence is not inside the _trust_removed block');
  assert.ok(!/the mark applies/.test(removed),
    'the live-mark sentence is inside the REMOVED block, so a machine with only a disconnected mark is told a live mark applies');
});

test('#1659: both flags exist, are initialised, and are set on their own kind of path', () => {
  assert.match(SETUP, /_trust_live=no/, '_trust_live is never initialised');
  assert.match(SETUP, /_trust_removed=no/, '_trust_removed is never initialised');
  /* The case arm that separates them. A collapse would drop one of these. */
  assert.match(SETUP, /"\$HOME"\/\.removed-claude-\*\)\s*_trust_removed=yes/,
    'a disconnected account no longer sets the removed flag');
  assert.match(SETUP, /\*\)\s*_trust_live=yes/,
    'a normal marked config no longer sets the live flag, so the live sentence can never print');
});

test('#1659 CONTROL: the extractor can tell the two blocks apart', () => {
  const live = guardedBy('_trust_live');
  const removed = guardedBy('_trust_removed');
  assert.notEqual(live, removed,
    'both flags extracted the same block, so every assertion above is passing on one piece of text');
});
