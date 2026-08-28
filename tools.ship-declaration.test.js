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

/**
 * 🛑 THE CUTOFF WAS PRINTED CORRECTLY AND THE FILTER IGNORED IT.
 *
 * Baron Draxum ran this on a live cut: his queue for the next release was three
 * PRs and it reported fourteen, reaching back three releases. The two sides come
 * from different tools in different formats and were compared as STRINGS:
 *
 *   git log --format=%cI  ->  2026-08-28T08:29:11-05:00   LOCAL, with an offset
 *   gh --json mergedAt    ->  2026-08-28T11:58:33Z        UTC, with a Z
 *
 * `"…T11:58:33Z" >= "…T08:29:11-05:00"` is TRUE lexicographically and FALSE by
 * 90 minutes as instants.
 *
 * ⭐ And his framing is the part to keep: printing the cutoff did not fix the
 * bug, it made the bug FINDABLE. The printed cutoff and the listed rows disagreed
 * in public, so it cost one query instead of a guess.
 */
const { isAfter } = require('./tools/check-ship-declaration.js');
const SINCE_LOCAL = '2026-08-28T08:29:11-05:00';   // = 13:29:11Z

test('#1025: a PR merged BEFORE the cutoff is excluded across timezone formats', () => {
  assert.equal(isAfter('2026-08-28T11:58:33Z', SINCE_LOCAL), false,
    'a PR from an earlier release is counted in this one: the comparison is lexicographic again');
});

test('#1025: a PR merged after the cutoff is included', () => {
  assert.equal(isAfter('2026-08-28T14:17:25Z', SINCE_LOCAL), true);
});

test('#1025: a PR merged exactly at the cutoff is included', () => {
  /* The base commit itself is in the release being cut. */
  assert.equal(isAfter('2026-08-28T13:29:11Z', SINCE_LOCAL), true);
});

test('#1025 CONTROL: the same-format case still behaves, which is why this survived', () => {
  /* Both sides UTC: the string comparison was CORRECT here, and that is exactly
     why nobody caught it until the cutoff became a git timestamp with an offset. */
  assert.equal(isAfter('2026-08-28T11:58:33Z', '2026-08-28T13:29:11Z'), false);
  assert.equal(isAfter('2026-08-28T14:17:25Z', '2026-08-28T13:29:11Z'), true);
});

test('#1025 CONTROL: an unparseable or missing date is EXCLUDED, never assumed in', () => {
  /* Both directions lose information; only this one avoids asserting a PR
     shipped in a release when we cannot tell. */
  assert.equal(isAfter(null, SINCE_LOCAL), false);
  assert.equal(isAfter('not a date', SINCE_LOCAL), false);
  assert.equal(isAfter('2026-08-28T14:17:25Z', 'not a date'), false);
});

test('#1025: the FILTER uses the instant comparison, not just the predicate', () => {
  /* 🛑 WITHOUT THIS, REVERTING THE FILTER TO THE STRING COMPARISON LEFT EVERY
     TEST GREEN. `isAfter` was well tested and nothing checked that the filter
     called it. Found by perturbation, 2026-08-28. */
  const { filterMerged } = require('./tools/check-ship-declaration.js');
  const rows = [
    { number: 1271, mergedAt: '2026-08-28T11:58:33Z' },   // before, and STRING-compares as after
    { number: 1302, mergedAt: '2026-08-28T14:17:25Z' },   // genuinely after
    { number: 999,  mergedAt: null },                      // unknown
  ];
  const kept = filterMerged(rows, SINCE_LOCAL).map((r) => r.number);
  assert.deepEqual(kept, [1302], `the filter kept ${JSON.stringify(kept)}: it is comparing strings again`);
});

test('#1025 CONTROL: with no cutoff the filter keeps everything', () => {
  /* Proves the filter can return the other answer, so the assertion above is
     about the comparison rather than about a filter that drops everything. */
  const { filterMerged } = require('./tools/check-ship-declaration.js');
  const rows = [{ number: 1, mergedAt: '2026-01-01T00:00:00Z' }, { number: 2, mergedAt: null }];
  assert.equal(filterMerged(rows, null).length, 2);
});

test('#1025: the printed cutoff carries UTC, so a reader can compare it to the rows', () => {
  /* 🛑 THE PRINT IS THE PART THAT EARNED ITS KEEP. Baron's words: printing the
     cutoff did not fix the bug, it made the bug FINDABLE -- the printed cutoff
     and the listed rows disagreed in public, so it cost one query instead of a
     guess.

     But the rows are UTC and a git cutoff is local, so two timestamps a reader
     cannot compare by eye is how the mismatch stayed invisible even after the
     cutoff was printed at all. A perturbation removing the UTC changed no test
     until this one existed. */
  const { resolveCutoff } = require('./tools/check-ship-declaration.js');
  const r = resolveCutoff('HEAD');
  assert.match(r.from, /= \d{4}-\d{2}-\d{2}T[\d:.]+Z/,
    'the printed cutoff has no UTC form: a reader cannot compare it to the merged times below it');
});
