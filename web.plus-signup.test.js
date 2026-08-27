'use strict';

/**
 * Josh's ruling on where Plus sign-up happens, guarded (#1115).
 *
 * Josh, 2026-08-27 10:50: "Sign-up for the relay will happen ON THE SITE NOT IN
 * THE APP and we'll do it."
 *
 * 🛑 THE PANE SAID THE OPPOSITE, AND THAT IS WORSE THAN SAYING NOTHING. It read
 * "When it opens, this is where it happens", so a person waits HERE for a thing
 * that is going to happen on a page they have never been shown and could not
 * reach from inside Kosmos. A wrong signpost costs more than a missing one.
 *
 * 🔑 WHAT IS ASSERTED IS THE RULING, NOT THE WORDING. Copy gets rewritten; the
 * ruling is the durable thing. So the test asks whether the Plus pane points a
 * person INTO the app for sign-up, and whether it offers the way out to the
 * site. It does not pin a sentence, because pinning a sentence makes the next
 * honest rewrite fail for no reason and teaches people to edit the test.
 *
 * ⚠️ NOT GUARDED: whether the app states a price. It does not today, on purpose
 * (the site publishes it, and a number kept in two places goes wrong in the one
 * nobody is looking at). But a signed-in Plus customer may well be shown their
 * own price later, and a guard forbidding it forever would be obeyed by someone
 * who should have argued with it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/** The Plus settings pane: from its sign-up paragraph to the flow that follows. */
function plusPane() {
  const start = PAGE.indexOf('<b>Sign-up is not open yet.</b>');
  assert.notEqual(start, -1, 'the Plus sign-up paragraph has moved or been renamed');
  const end = PAGE.indexOf('id="plus-flow"', start);
  assert.notEqual(end, -1, 'the Plus flow block that bounds this pane has moved');
  /* Wrapped at 78 columns, so newlines fall inside sentences. Collapse before
     matching: the same wrap made `grep -c "this is where it happens"` return
     zero from a file that contains it. */
  return PAGE.slice(start, end).replace(/\s+/g, ' ');
}

test('CONTROL: the pane is found and is the right block', () => {
  /* An absence assertion over a slice we failed to locate passes for the wrong
     reason, and this slice is bounded by two strings either of which could be
     renamed. Prove we are reading the Plus pane before reading anything into it. */
  const pane = plusPane();
  assert.ok(pane.length > 100 && pane.length < 4000, `implausible pane slice: ${pane.length} chars`);
  assert.match(pane, /sign-?up/i, 'slice does not discuss sign-up');
});

test('CONTROL: the phrasing this forbids would be caught if it came back', () => {
  const bad = 'When it opens, this is where it happens: your email, a code to confirm it.';
  assert.match(bad.replace(/\s+/g, ' '), /this is where it happens|happens (?:here|in here|in the app)/i);
});

test('the Plus pane does not say sign-up happens in the app', () => {
  const pane = plusPane();
  assert.doesNotMatch(
    pane,
    /this is where it happens|sign-?up (?:happens|is) (?:here|in here|in the app)|happens (?:right )?here/i,
    'Josh ruled sign-up happens on the site, not in the app. This pane points the person inward.',
  );
});

/* 🛑 THE OTHER HALF OF #1115 IS DELIBERATELY NOT FIXED HERE, and the reason is
   worth more than the fix. The pane both misdescribed the flow and offered no
   route into the real one, so the obvious change was to add a link. I wrote it,
   and `web.plus-tab.test.js` failed:

     "no hostname or price appears in the Plus copy: the domain is temporary
      and the price is not ruled"

   That guard is right and it is older than this change. Hardcoding
   installkosmos.com into shipped copy bets the app on a domain someone has
   already said is provisional, and the person who pays for that bet is a user
   reading a dead link in a build they cannot update.

   ⇒ So the sentence is corrected and the route is carded, because the route
   needs one place that holds the site's address rather than a string typed into
   a paragraph. Two guards asserting opposite things about the same paragraph
   would have been the real damage: whoever hit them next would have deleted
   whichever one was cheaper to delete. */
