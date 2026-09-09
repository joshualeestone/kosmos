'use strict';
/**
 * #2519: render-talk's reopen arm could not run on a box with no live agents, and
 * it FAILED 3b rather than skipping, so any cut on a quiet box (mortals) went red on
 * an environment fact rather than a product one.
 *
 * The fix is option 1 from the card: a card RECORDED from the real producer, used as
 * a fallback, so the arm keeps its coverage instead of being skipped.
 *
 * 🛑 WHAT THIS FILE IS DEFENDING, and it is not the fallback itself. render-talk's
 * own header explains at length why the card must not be a hand-built literal: a
 * literal invented in that file "is exactly the fixture that made six rounds of
 * review pass against a world that does not exist". A recorded fixture escapes that
 * only while it still matches what `status.snapshot()` emits. So the thing worth
 * guarding is the RECORDING staying faithful, and the thing worth proving is that
 * the check can tell a live run from a fallback run.
 *
 * ⚠️ This is the static, fast half. It does not launch a browser; the arm it guards
 * runs inside the real check. A browser run on this fleet needs the shared browser
 * and a quiet box, and neither is available to a unit test.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CHECK = path.join(__dirname, 'docs', 'browser-checks', 'render-talk.js');
const FIXTURE = path.join(__dirname, 'docs', 'browser-checks', 'fixtures', 'agent-card.json');
const SRC = fs.readFileSync(CHECK, 'utf8');

/* Load the three resolvers out of the check without running it: the file's top level
   launches a browser, and requiring it would do that here. Extracting them keeps this
   test honest about WHICH code it exercises -- it is the shipped source, read from
   disk, not a copy. */
function resolvers() {
  /* Sliced by index rather than matched by regex, deliberately: an escaped regex in a
     test that reads source is one more thing that can be wrong about the file it
     claims to read, and my first version of this helper WAS wrong that way. The
     boundaries are the function keyword and the first line-start `}`. */
  const parts = ['liveCard', 'goldenCard', 'realCard'].map((name) => {
    const head = 'function ' + name + '() {';
    const at = SRC.indexOf(head);
    assert.notEqual(at, -1, `could not find ${head} in the check; the test is stale, not the code`);
    const end = SRC.indexOf('\n}\n', at);
    assert.notEqual(end, -1, `could not find the end of ${name}(); the test is stale, not the code`);
    return SRC.slice(at, end + 3);
  }).join('\n');
  /* 🛑 `require` MUST BE PASSED IN. A `new Function` body executes in GLOBAL scope,
     where `require` does not exist inside a module -- so liveCard()'s require threw,
     its own try/catch swallowed it, and it returned null on EVERY box. The result was
     a test that exercised only the fallback while claiming to cover both, and a
     mutation to the live branch survived. (It looked fine when I first probed it under
     `node -e`, where `require` IS global; the test file is a module, where it is not.) */
  return new Function('fs', 'path', 'require', '__dirname',
    parts + '; return { liveCard, goldenCard, realCard };')(fs, path, require, path.dirname(CHECK));
}

test('#2519: the recorded fixture exists and parses', () => {
  const card = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assert.equal(typeof card, 'object');
  assert.ok(!Array.isArray(card));
  assert.ok(Object.keys(card).length > 20,
    `a real card carries ~30 fields; ${Object.keys(card).length} suggests a hand-built literal, which is the class this fixture exists to avoid`);
});

test('#2519: goldenCard() returns a usable card, so a QUIET box is covered', () => {
  const { goldenCard } = resolvers();
  const card = goldenCard();
  assert.ok(card, 'no card from the fixture: a box with no agents would fail 3b, which is the bug');
  assert.equal(card.sessionName, 'april', 'the fallback must be renamed exactly as the live path renames');
  assert.equal(card.name, 'April');
  assert.equal(card.state, 'needs_you');
});

test('#2519: realCard() REPORTS ITS SOURCE, so a quiet run cannot look like a live one', () => {
  /* The reason this returns {card, source} rather than a bare card. A silent fallback
     would print identical output on a populated and a quiet box while driving
     different inputs, and render-talk has corrected that class three times. */
  const { realCard } = resolvers();
  const r = realCard();
  assert.ok(r && typeof r === 'object' && 'card' in r && 'source' in r,
    'realCard must return {card, source}');
  assert.ok(['live', 'golden', 'none'].includes(r.source), `unexpected source ${r.source}`);
  assert.ok(r.card, 'neither a live card nor the fixture resolved');
});

test('#2519: the fixture carries NO identifying content from the box it was captured on', () => {
  /* It is a capture, so it starts out full of a real agent's name, session, evidence
     line and profile ids. Those are neutralised at capture time; this arm is what
     notices if a future re-capture forgets. */
  const raw = fs.readFileSync(FIXTURE, 'utf8');
  for (const bad of ['angel', 'Angel', 'monalisa', 'pigeonpete', 'claudebot', 'icecreamkitty']) {
    assert.ok(!raw.includes(bad), `the fixture leaks a real agent identity: ${bad}`);
  }
  const card = JSON.parse(raw);
  assert.match(card.profile.idInstall, /^0{8}-0{4}-4000-8000-0{12}$/,
    'profile.idInstall should be the neutral placeholder, not a real install id');
});

test('#2519: the fixture matches what status.snapshot() ACTUALLY emits, where that is checkable', () => {
  /* The check's own drift guard runs in the browser check. This is the same comparison
     made statically, so a stale capture is caught by `yarn test` rather than only by a
     cut on a populated box.
     ⚠️ On a box with no agents there is nothing to compare against, and the arm says so
     rather than passing silently: an absence must not read as agreement. */
  const { liveCard, goldenCard } = resolvers();
  const live = liveCard();
  const golden = goldenCard();
  assert.ok(golden, 'the fixture did not load');
  if (!live) {
    assert.ok(true, 'SKIPPED: no live agent on this box, so the capture cannot be compared here');
    return;
  }
  assert.deepEqual(
    Object.keys(golden).sort(), Object.keys(live).sort(),
    'the recorded card has drifted from status.snapshot(); re-capture it');
});

test('#2519: the check GUARDS the fixture against drift on any box that has a live card', () => {
  /* The fixture rots the moment status.snapshot() gains or drops a field, and the
     quiet box that needs it is exactly the one that cannot notice. So the guard runs
     where a live card exists. Without this the fallback would decay silently, which
     is worse than the failure it replaced. */
  assert.match(SRC, /has drifted from status\.snapshot\(\)/,
    'no drift guard: the recorded fixture would rot unnoticed');
  assert.match(SRC, /cardSource === 'live'/,
    'the drift guard must run on the LIVE path, which is the only place it can');
});

test('#2519: a fallback run emits a NOTE, and notes can never read as failures', () => {
  /* The release gate anchors on `^\s*(FAIL|✖)`. A note that reached that anchor would
     turn a covered quiet-box run back into a red, which is the bug inverted. */
  assert.match(SRC, /notes\.push\(/, 'no note is emitted when the fallback drives the arm');
  assert.match(SRC, /NOTE {2}\$\{n\}/, 'notes must print with a NOTE prefix, not a FAIL one');
  assert.ok(!/problems\.push\([^)]*RECORDED card fixture/.test(SRC),
    'the fallback must not be pushed as a problem');
});
