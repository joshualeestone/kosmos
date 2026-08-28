'use strict';
/**
 * #1025. A release cutter must be able to tell, without messaging anyone,
 * whether a merged branch is meant to be in front of a person.
 *
 * 🛑 THE ONE THAT MATTERS IS THE THIRD STATE. A PR that says nothing is not a PR
 * that said no. Three merges on 2026-08-27 were correct, ready and deliberately
 * NOT user-visible; a silent PR looks identical to those and is not the same
 * thing. Collapsing them is how a cutter ships something unannounced, or omits
 * something that mattered, and either way nobody finds out.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { declarationIn } = require('./tools/check-ship-declaration.js');

test('#1025: a PR that says nothing is SILENT, never internal', () => {
  for (const body of [
    '',
    'Fixes the thing.\n\n### Verification\nfull npm test exit 0',
    'A long body about tests and controls that never mentions the question.',
  ]) {
    assert.equal(declarationIn(body), 'silent', `body: ${body.slice(0, 40)}`);
  }
});

test('#1025: the negative forms are read as internal, not as visible', () => {
  /* ⚠️ "not user-visible" CONTAINS "user-visible". Checking the positive first
     would report every internal change as something to announce, which is the
     louder and worse direction. */
  for (const body of [
    '⚠️ **not user-visible**: the sentence value is unchanged, only its storage.',
    'user-visible: no',
    'This is internal only.',
  ]) {
    assert.equal(declarationIn(body), 'internal', `body: ${body}`);
  }
});

test('#1025: a positive declaration is read as visible', () => {
  for (const body of [
    '⚠️ **user-visible**: the board will show fewer reds.',
    'This is user-visible and needs a line in the notes.',
  ]) {
    assert.equal(declarationIn(body), 'visible', `body: ${body}`);
  }
});

test('#1025 CONTROL: the reader can return all three, so none of the above is vacuous', () => {
  const got = new Set([
    declarationIn('user-visible'),
    declarationIn('not user-visible'),
    declarationIn('nothing about it'),
  ]);
  assert.deepEqual([...got].sort(), ['internal', 'silent', 'visible']);
});

test('#1025 CONTROL: it is not fooled by the words appearing in passing prose', () => {
  /* The phrase turns up in discussion of the CONVENTION itself. This is the
     known limit and it is stated rather than pretended away: the tool reports a
     declaration, and a body arguing about declarations reads as one. A cutter
     seeing SHOW on a docs-only PR loses nothing; a cutter seeing SILENT on a
     real one is the failure this exists to prevent. */
  assert.equal(declarationIn('We should record whether a change is user-visible.'), 'visible');
});

/**
 * 🛑 A RANGE IS NOT A BASE REF, AND THE TOOL USED TO FILTER SILENTLY.
 *
 * Baron ran this on a live cut within minutes of it landing and passed
 * `584232e5..origin/main`. Measured on this repo:
 *
 *   git log -1 --format=%cI 584232e5               -> 07:57  (the base)
 *   git log -1 --format=%cI 584232e5..origin/main  -> 08:21  (the NEWEST in it)
 *
 * ⭐ THE TOOL'S ANSWER WAS ACTUALLY CORRECT and he still had to ask, because
 * nothing on screen said what it had filtered from. **That is the defect #1025
 * exists to fix, occurring inside the fix for #1025.** The cutoff is printed now.
 */
const { resolveCutoff } = require('./tools/check-ship-declaration.js');

test('#1025: a range is reduced to its base, and says so', () => {
  const r = resolveCutoff('HEAD~1..HEAD');
  assert.ok(r.since, 'a range should still resolve a cutoff');
  assert.match(r.from, /taken as the base of the range/,
    'the output must say a range was reduced, or the count cannot be argued with');
});

test('#1025: a plain ref resolves without claiming a range', () => {
  const r = resolveCutoff('HEAD');
  assert.ok(r.since);
  assert.doesNotMatch(r.from, /range/, 'a plain ref must not be described as a range');
});

test('#1025 CONTROL: an unresolvable ref says so instead of filtering to nothing', () => {
  /* Without this, a typo'd ref could silently produce an empty cutoff and the
     tool would show every PR ever, reading as "nothing was filtered". */
  const r = resolveCutoff('zzz-pete-not-a-ref');
  assert.equal(r.since, null);
  assert.match(r.from, /could not resolve/);
});

test('#1025 CONTROL: no argument is distinguishable from a resolved one', () => {
  const r = resolveCutoff(undefined);
  assert.equal(r.since, null);
  assert.match(r.from, /no base ref given/);
});
