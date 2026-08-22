'use strict';
/**
 * Every element the create flow reaches for by id is actually in the page.
 *
 * 🛑 WHY THIS EXISTS. On 2026-08-22 the account field's wrapper was deleted when
 * the account became a rung of the model group, and one line in the Create
 * button's handler still read that wrapper's `hidden` flag. The form rendered
 * perfectly, every field worked, the suite was green and a rendering check
 * reported no page errors -- because the throw was on the PRESS, which is the
 * one moment none of those look at. A person filling the form in would have met
 * a dead button at the end of it.
 *
 * 🔑 IT IS A REFERENCE CHECK, NOT A CLICK. Pressing Create for real is the
 * stronger test and this repo cannot safely automate it: the create path spawns
 * a session and writes a launch job, and the server has no way to tell a caller
 * it is in dry run, so a check that pressed the button could not prove it was
 * pressing a safe one. This asks the question that failure was actually about --
 * does the element this code names exist -- and it asks it of every id in the
 * flow rather than the one that broke.
 *
 * ⚠️ IT ONLY COVERS IDS WRITTEN AS LITERALS, which is the shape the whole create
 * flow uses except for the step switcher, whose ids are built from a prefix and
 * are asserted separately below.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const nodePath = require('path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

/* The families this flow owns. Anything outside them belongs to another screen
   and is that screen's to guard. */
const MINE = /^(create-|cstep-|pick-|role-|roles-|made-|genav|rolesel|rolepick)/;

function idsInMarkup() {
  const found = new Set();
  for (const m of PAGE.matchAll(/\bid="([^"]+)"/g)) found.add(m[1]);
  return found;
}

test('every id the create flow reads is an element the page renders', () => {
  const have = idsInMarkup();
  const read = new Set();
  for (const m of SCRIPT.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) {
    if (MINE.test(m[1])) read.add(m[1]);
  }
  // ⚠️ THE DENOMINATOR. "All 0 ids resolve" and "all 40 ids resolve" are the
  // same sentence to a checker that does not say how many it looked at.
  assert.ok(read.size >= 25, `only ${read.size} create-flow ids found; the extractor stopped matching`);
  const missing = [...read].filter((id) => !have.has(id));
  assert.deepEqual(missing, [],
    'the create flow reads elements that are not in the page: ' + missing.join(', '));
});

test('the step switcher\'s three panes exist under the prefix it builds', () => {
  /* The one place an id is composed rather than written out. Pinned separately
     because the check above cannot see it, and a missing pane here is the same
     failure with a different spelling. */
  assert.match(SCRIPT, /getElementById\('cstep-' \+ s\)/,
    'the step switcher changed shape; re-point this');
  const have = idsInMarkup();
  for (const pane of ['cstep-role', 'cstep-name', 'cstep-made']) {
    assert.ok(have.has(pane), `${pane} is not in the page, so switching to it throws`);
  }
});

test('CONTROL: the check can see an id that is not there', () => {
  /* A reference check that cannot fail is the failure it is guarding against,
     one level up. This drives the same comparison over a known-bad input. */
  const have = idsInMarkup();
  assert.ok(!have.has('create-account-wrapper-that-never-existed'));
});
