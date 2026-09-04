'use strict';

/**
 * The About-you step: name, what-you-do, and time zone (#1345, #1994).
 *
 * #1345 (below) removed the "anything they should always know" box, leaving two
 * questions. #1994 (Josh live, 2026-09-04) then RESTORED the time-zone picker to
 * this step, so it asks THREE questions now: name, does, and time zone. The know
 * box stays gone (its data is still carried, see the second test). This test is
 * kept in the #1345 family and updated for the reversal rather than left claiming
 * "exactly two" on a three-question screen.
 *
 * **Josh, 2026-08-28 11:25 CDT, during the clean-machine test:**
 *
 * > *"I want to take off the input field for 'anything they should always know',
 * > as well as the text 'you can change later'. I want to take off the input box,
 * > that label, and that text, so that all we have left are 'what they call you'
 * > and 'what you do', just in the interest of simplifying even further."*
 *
 * 📌 THE CARD CALLS THIS "AGENT CREATION" AND IT IS NOT. His own words name these
 * fields verbatim - "what they call you" is `fr-you-name` ("What should your
 * agents call you?") and "what you do" is `fr-you-do`. Somebody reading the card
 * title could delete the wrong screen's field; there is only one place in the
 * product with these three elements and this is it.
 *
 * 🛑 AND REMOVING THE BOX DOES NOT REMOVE THE DATA. `know` still feeds the
 * you-block that goes into every agent's instructions (engine/you.js:147), and
 * the PUT is a whole-record replace: `save()` maps an absent `know` to null. So
 * dropping it from the body would ERASE whatever the person had already written.
 * The loaded value is carried straight back instead.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

test('#1345/#1994: the About-you step asks name, what-you-do, and time zone (the know box stays gone)', () => {
  assert.match(HTML, /id="fr-you-name"/, 'the name field is gone: this step asks nothing');
  assert.match(HTML, /id="fr-you-do"/, 'the "what do you do" field is gone');
  assert.match(HTML, /id="fr-you-tz"/,
    'the time-zone picker is gone from the About-you step (#1994 restored it)');
  assert.doesNotMatch(HTML, /id="fr-you-know"/,
    'the "anything they should always know" box is back on the About-you step');
  assert.doesNotMatch(HTML, /Anything they should always know\?/,
    'its label is back');
  assert.doesNotMatch(HTML, /You can change these later\./,
    'the "you can change these later" helper text is back');
});

test('#1345: removing the editor must not erase the stored value', () => {
  /* 🔑 The PUT is a whole-record replace. If the body stopped carrying `know`,
     the next save would null it - silently wiping a paragraph that is still
     composed into every agent's instructions. */
  assert.match(HTML, /know: carriedKnow/,
    'the PUT no longer carries the stored value: the next save will erase it');
  assert.match(HTML, /carriedKnow = j\.you\.know/,
    'nothing loads the stored value, so carriedKnow is always empty and the save still erases it');
});

test('#1345 CONTROL: the Model step keeps its own "you can change this later"', () => {
  /* A different string on a different field. Deleting it would be collateral
     damage from a careless search for the phrase Josh named. */
  assert.match(HTML, /\(you can change this later\)/,
    'the Model field lost its helper text: that is not the one he asked to remove');
});
