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
    /* Match on `function <name>(` rather than the exact `() {`: adding a parameter is
       a normal edit and must not silently make this test unable to find the function.
       It already did once, when goldenCard() gained its fixture-path seam. */
    const head = 'function ' + name + '(';
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
  return (req) => new Function('fs', 'path', 'require', '__dirname',
    parts + '; return { liveCard, goldenCard, realCard };')(fs, path, req || require, path.dirname(CHECK));
}

test('#2519: the recorded fixture exists and parses', () => {
  const card = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assert.equal(typeof card, 'object');
  assert.ok(!Array.isArray(card));
  assert.ok(Object.keys(card).length > 20,
    `a real card carries ~30 fields; ${Object.keys(card).length} suggests a hand-built literal, which is the class this fixture exists to avoid`);
});

test('#2519: goldenCard() returns a usable card, so a QUIET box is covered', () => {
  const { goldenCard } = resolvers()();
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
  const { realCard } = resolvers()();
  const r = realCard();
  assert.ok(r && typeof r === 'object' && 'card' in r && 'source' in r,
    'realCard must return {card, source}');
  assert.ok(['live', 'golden', 'none'].includes(r.source), `unexpected source ${r.source}`);
  assert.ok(r.card, 'neither a live card nor the fixture resolved');
});

test('#2519: the fixture carries the PLACEHOLDER identity, asserted positively', () => {
  /* ⚠️ NOT A DENYLIST. An earlier version listed five current agent names, which is the
     false-zero shape this tree warns about: a re-capture on a box running any agent not
     on that list would pass while the arm's name claims "no identifying content". Assert
     what the values MUST be instead, which cannot go stale as the roster changes. */
  const card = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assert.equal(card.session, 'april-discord');
  assert.equal(card.sessionName, 'april');
  assert.equal(card.name, 'April');
  assert.equal(card.target, 'april-discord:0.0');
  assert.equal(card.role, 'example worker');
  assert.equal(card.task, 'an example task');
  /* ⚠️ NOT `''`. The capture preserves the TYPE and neutralises only string CONTENT,
     because status.js emits `status.conflict || null` and an empty string is a value it
     can never produce. So: null, or a neutral sentence. */
  assert.ok(card.stateConflict === null || card.stateConflict === 'an example conflict',
    `stateConflict is ${JSON.stringify(card.stateConflict)}, which is neither null nor the neutral sentence`);
  assert.match(card.stateEvidence, /^✽ Working…/);
  assert.match(card.profile.idInstall, /^0{8}-0{4}-4000-8000-0{12}$/);
  assert.match(card.profile.id, /^0+$/);
});

test('#2519: the fixture matches what status.snapshot() ACTUALLY emits, on ANY box', () => {
  /* 🛑 BOX-INDEPENDENT, AND AN EARLIER VERSION OF THIS ARM WAS NOT. It compared against
     a LIVE card and self-skipped where there was none, so on the quiet box this whole
     change exists for, nothing verified the fixture: not yarn test, not 3b. I had even
     written that limitation down as if it were unavoidable ("the quiet box that needs
     it is the only one that cannot check it"). It is not true of this tree.
     `test-support/fleet.js` installs a fake pane source and calls the REAL
     `status.snapshot()`, which is how fixture-discipline.test.js checks card shapes.
     Measured: a fleet card and a live card on this box have identical key sets (30 and
     30, no difference either way), so this comparison is sound and runs everywhere. */
  const fleet = require('./test-support/fleet.js');
  const { goldenCard } = resolvers()();
  const golden = goldenCard();
  assert.ok(golden, 'the fixture did not load');
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const real = board.card('mara');
    /* ⚠️ TOP-LEVEL ONLY HERE, AND THAT IS A DELIBERATE WEAKENING OF MY FIRST VERSION.
       I wrote this as a full nested comparison and it FAILED, correctly: a fleet agent
       has no recorded usage, so its `context` carries `neverRecorded` with
       `percent: null`, while a card captured from a real agent carries real numbers and
       the ceiling fields. Both are legitimate producer output for different states, so
       demanding nested equality against a fleet card asserts something untrue.
       ⇒ The box-independent claim is that snapshot() still emits THESE THIRTY FIELDS.
       The nested comparison lives in render-talk.js's own guard, where it runs live
       against live and is apples to apples. */
    assert.deepEqual(
      Object.keys(golden).sort(), Object.keys(real).sort(),
      'the recorded card has drifted from status.snapshot(); re-capture with node tools/capture-agent-card.js');
  } finally {
    board.restore();
  }
});

test('#2519: a TRIMMED fixture is refused, not served as a hollow card', () => {
  /* "An object that is not an array" accepts `{}`: openDetail would still run and the
     reopen arm would still pass, giving the box the fallback exists for a coverage claim
     with nothing behind it. The floor lives in goldenCard() rather than only in this
     suite, because anyone invoking tools/browser-checks.sh directly never reaches here. */
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-2519-'));
  const thin = path.join(dir, 'thin.json');
  /* ⚠️ NEUTRAL KEYS, NOT CARD-SHAPED ONES, and deliberately so. The floor counts keys,
     so any small object proves it. A `{sessionName, name}` literal here reads as a
     hand-built card to fixture-discipline's lint -- which flagged an earlier version of
     this line -- and that guard cannot tell a deliberately-invalid object from a fixture
     standing in for a real card. Do not make this look like a card to be "realistic":
     the whole point is that it is NOT one. */
  fs.writeFileSync(thin, JSON.stringify({ a: 1, b: 2 }) + '\n');
  const { goldenCard } = resolvers()();
  assert.equal(goldenCard(thin), null, 'a two-field card passed the floor');
  const full = path.join(__dirname, 'docs', 'browser-checks', 'fixtures', 'agent-card.json');
  assert.ok(goldenCard(full), 'CONTROL: the real fixture must still pass, or the floor is just broken');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('#2519: realCard PREFERS a live card, and says so', () => {
  /* The precedence and the LABEL, which nothing asserted. A mutation returning
     `{card: goldenCard(), source: 'live'}` passed the old membership check on every box
     AND made the check's drift guard compare the fixture against itself: vacuously
     green for ever, which is precisely the rot the guard exists to prevent. */
  /* ⚠️ THE LIVE CARD COMES FROM fleet, NOT FROM A LITERAL. My first version hand-built
     `{isNamedOurs: true, marker: 'FROM-LIVE'}` and fixture-discipline.test.js's "no test
     builds an agent card by hand" arm caught it. That guard cannot tell a marker object
     from a card fixture, and it should not have to: the tree has a real producer for
     this, so use it. */
  const fleet = require('./test-support/fleet.js');
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const realOne = board.card('mara');
    const stub = (id) => (String(id).includes('status')
      ? { snapshot: () => ({ agents: [realOne] }) }
      : require(id));
    const { realCard } = resolvers()(stub);
    const r = realCard();
    assert.equal(r.source, 'live');
    assert.equal(r.card.session, realOne.session,
      'a live card was available and the FIXTURE was used instead');
    assert.notEqual(r.card.session, 'april-discord',
      'the fixture is what came back, so live-over-golden precedence is not real');
  } finally {
    board.restore();
  }
});

test('#2519: with an EMPTY board it falls back and labels the fallback', () => {
  const stub = (id) => (String(id).includes('status')
    ? { snapshot: () => ({ agents: [] }) }
    : require(id));
  const { realCard } = resolvers()(stub);
  const r = realCard();
  assert.equal(r.source, 'golden');
  assert.ok(r.card && Object.keys(r.card).length > 20, 'the fallback did not produce a real-shaped card');
});

test('#2519: a THROWING producer is an error, NOT an empty board', () => {
  /* 🛑 THE REGRESSION THIS BRANCH FIRST INTRODUCED. liveCard() swallowed every error, so
     on a POPULATED box where status.js failed to load or snapshot() threw, the fallback
     quietly took over, printed "no live agent on this box" (a claim nothing measured)
     and the cut PASSED. Before this branch that case correctly failed 3b. */
  const stub = (id) => {
    if (String(id).includes('status')) throw new Error('status.js is broken');
    return require(id);
  };
  const { realCard } = resolvers()(stub);
  const r = realCard();
  assert.equal(r.source, 'error', 'a broken producer was reported as an empty board');
  assert.equal(r.card, null);
  assert.match(r.error, /status\.js is broken/);
});

/* The drift comparison itself, lifted out of the check so it can be DRIVEN rather than
   grepped for. An earlier version of the arm below only regex-matched the source for two
   literal strings, so it could not fail if the comparison logic were replaced with
   something wrong -- and that is exactly what happened: two blockers shipped past it. */
function shapeFn() {
  const at = SRC.indexOf('const shape = (v, prefix) => {');
  assert.notEqual(at, -1, 'could not find the drift comparison; the test is stale, not the code');
  const end = SRC.indexOf('};', SRC.indexOf('return out;', at));
  assert.notEqual(end, -1, 'could not find the end of the drift comparison');
  return new Function(SRC.slice(at, end + 2) + '; return shape;')();
}

test('#2519: the drift guard does NOT fire on ordinary value variation', () => {
  /* 🛑 THE BLOCKER THIS ARM EXISTS FOR. status.js emits
     `stateConflict: status.conflict || null`, so it is a sentence or null depending on
     whether that agent has a conflict. Measured on this box: 10 of 18 cards string, 8
     null. The first version of the guard compared TYPES, so it would have failed a
     populated box roughly half the time on a difference that means nothing -- and the
     first version of the fixture made it worse by recording `stateConflict: ''`, a value
     the producer can never emit. */
  const shape = shapeFn();
  const golden = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const nullConflict = JSON.parse(JSON.stringify(golden));
  nullConflict.stateConflict = null;
  assert.deepEqual(shape(golden, ''), shape(nullConflict, ''),
    'a live card with no conflict reads as drift, so the guard fails populated boxes for nothing');
});

test('#2519: the drift guard DOES fire when a field disappears', () => {
  /* The discriminating half. Without it the arm above is satisfied by a guard that
     compares nothing at all. context.percent is the field this file's header names as
     the original trap, and it lives below the top level. */
  const shape = shapeFn();
  const golden = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const dropped = JSON.parse(JSON.stringify(golden));
  delete dropped.context.percent;
  assert.notDeepEqual(shape(golden, ''), shape(dropped, ''),
    'a NESTED field vanished and the guard did not notice');
  const added = JSON.parse(JSON.stringify(golden));
  added.somethingNew = 1;
  assert.notDeepEqual(shape(golden, ''), shape(added, ''), 'a new top-level field did not register');
});

test('#2519: the fixture records values the PRODUCER can actually emit', () => {
  /* `stateConflict: ''` was invented: status.js emits `status.conflict || null`, never
     an empty string. A fixture carrying a value the producer cannot produce is the
     invented-fixture class arriving inside the recording. */
  const golden = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assert.notEqual(golden.stateConflict, '', 'stateConflict is an empty string, which status.js never emits');
  assert.ok(golden.stateConflict === null || (typeof golden.stateConflict === 'string' && golden.stateConflict.length > 0));
  assert.equal(golden.paneless, false,
    'the fixture must be a PANE card: a paneless one has a different shape and would make the guard report board composition as drift');
});

test('#2519: liveCard PREFERS a pane card over a paneless one', () => {
  /* status.js emits both and both carry isNamedOurs. Their shapes legitimately differ, so
     taking whichever came first made the drift guard report board COMPOSITION as drift.
     ⚠️ The paneless variant here is a REAL fleet card with its flag flipped, not a
     literal: fixture-discipline's lint is right that hand-built cards are the defect, and
     this arm needs a real shape to be worth anything. */
  const fleet = require('./test-support/fleet.js');
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const real = board.card('mara');
    const paneless = Object.assign({}, real, { paneless: true, session: 'paneless-one' });
    const pane = Object.assign({}, real, { paneless: false, session: 'pane-one' });
    const stub = (id) => (String(id).includes('status')
      ? { snapshot: () => ({ agents: [paneless, pane] }) }
      : require(id));
    const { liveCard } = resolvers()(stub);
    const got = liveCard();
    assert.ok(got, 'no card came back at all');
    assert.equal(got.session, 'pane-one',
      'liveCard took the PANELESS card, whose shape differs from the recorded fixture');
  } finally {
    board.restore();
  }
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
