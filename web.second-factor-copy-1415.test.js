'use strict';

/**
 * #1415: the second step is ALWAYS, not "if you came from a phone".
 *
 *   node --test web.second-factor-copy-1415.test.js
 *
 * Josh, 2026-08-29 14:04, verbatim:
 *   "The phone verification will ALWAYS happen. It's NOT if you're coming from a
 *    phone... It's true two-factor."
 *
 * 🛑 WHY COPY LIKE THIS EARNS A GUARD WHEN MOST COPY DOES NOT. A wrong sentence
 * about a feature costs a person a click. A wrong sentence about what protects
 * their account teaches them a false model of their own security: somebody who
 * read "signing in from a phone asks for a second code" would conclude their
 * laptop sign-in is single-factor, and would not think the second step was
 * theirs to lose.
 *
 * ⚠️ THIS ASSERTS THE CLAIM, NOT THE WORDING. Mona Lisa may rewrite these
 * sentences and should not have to touch this file to do it. What is pinned is
 * that the second-step copy does not make the second step conditional, and that
 * the device list does not describe itself as being for phones.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');

/* 🛑 COMMENTS STRIPPED BEFORE ANY ASSERTION, and this bit me on the first run.
   The comment I wrote to explain why the copy does NOT promise an authenticator
   app contains the words "authenticator" and "TOTP", so the check for those
   words found its own explanation and failed. A detector that matches its own
   description is a class, not a slip. */
const RENDERED = PAGE.replace(/<!--[\s\S]*?-->/g, '');
const SERVER = fs.readFileSync('server.js', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The copy of one element.
 *
 * ⚠️ THE SECOND PARAGRAPH, NOT THE FIRST, when the id is on a container. My
 * first version sliced from the id to the next `</p>`, and `#plus-second` is a
 * DIV whose first paragraph is the heading "I lost my phone" -- so every
 * assertion ran against the wrong sentence and the control caught it.
 */
function copyOf(id, which) {
  const at = RENDERED.indexOf('id="' + id + '"');
  assert.ok(at > -1, id + ' moved; restate this pin');
  /* ⚠️ BACK UP TO THE ELEMENT'S OWN OPENING TAG. Slicing forward from the id
     starts INSIDE the tag, so the paragraph the id is on has no `<p` to match
     and the scan silently picks up the NEXT paragraph -- which on this screen is
     an empty message element, so every assertion would have run against "". The
     control is what caught it, which is the only reason it is a control. */
  const open = RENDERED.lastIndexOf('<', at);
  const region = RENDERED.slice(open, open + 3000);
  const paras = [...region.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
  assert.ok(paras.length, id + ' has no paragraph in it; restate this pin');
  return paras[which || 0];
}

test('the second step is not described as something a phone triggers', () => {
  const copy = copyOf('plus-second', 1);   // [0] is the heading
  assert.doesNotMatch(copy, /from a phone asks/i,
    'the copy makes the second step conditional on the device, which is false and is the '
    + 'kind of false that changes how somebody protects their account');
  assert.match(copy, /always asks/i,
    'the copy no longer says the second step always happens');
});

test('the device list is not described as being for phones', () => {
  assert.doesNotMatch(copyOf('plus-devempty'), /sign in from a phone/i,
    'the empty device list still names one kind of device, so somebody on a laptop '
    + 'reads it as not being about them');
});

test('the copy does not promise an authenticator app, because there is not one', () => {
  /* 🛑 THE RULING NAMES ONE AND THE PRODUCT DOES NOT HAVE ONE. Writing it into
     the copy would be this same defect pointing the other way: a true sentence
     about the intended design and a false one about the shipped software.
     ⚠️ THIS TEST GOES RED WHEN SOMEBODY BUILDS IT, and that is correct: the copy
     should then mention it, and this assertion should be deleted in the same
     change rather than worked around. */
  const built = /authenticator|TOTP/i.test(RENDERED) || /authenticator|TOTP/i.test(SERVER);
  assert.equal(built, false,
    'an authenticator option now exists, so the second-step copy should say so and this '
    + 'assertion should be deleted rather than kept passing');
});

test('CONTROL: this file reads the copy it thinks it reads', () => {
  /* Without this, every assertion above passes on an element that has quietly
     become empty, or on a phrase that has moved out of the element. */
  assert.match(copyOf('plus-second', 1), /second code after the email code/,
    'the second-step paragraph no longer describes the second step at all');
  assert.match(copyOf('plus-devempty'), /None yet/,
    'the empty device list no longer says the list is empty');
});
