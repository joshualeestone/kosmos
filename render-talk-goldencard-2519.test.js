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
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

/* 🛑 SANDBOX FIRST, BEFORE ANY REQUIRE, and an earlier version of this file did NOT.
   `engine/status` resolves its roots ONCE at require time, and `test-support/fleet`
   fakes only the pane SOURCE: `workersDir()` still falls back to ~/work/workers and
   store.js still falls back to the real Application Support directory. So the arms below
   were reading this operator's live worker-instruction and profile stores, and one arm
   that calls realCard() with no stub ran the REAL `status.snapshot()` against every live
   pane on the machine: measured at ~349ms against under 10ms for every stubbed arm.
   tools/run-tests.sh states the invariant this broke: "every store-using test sandboxes
   before requiring... Such a test is a bug, and its red still shows."
   ⚠️ It was raised as a WARNING on the previous review pass and I did not act on it. It
   came back as a BLOCKER, which is the argument for acting on warnings. */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-2519-'));
/* Removed at the end, as fixture-discipline.test.js does. Eight of these were left on
   disk by earlier runs of this suite before the cleanup was added. */
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');

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

test('#2519: this suite is SANDBOXED, so it cannot read the operator live state', () => {
  /* 🛑 AN ENVIRONMENTAL GUARD REDS NOTHING BY DEFAULT, which is why it needs an arm.
     Deleting the four process.env lines at the top of this file would silently point
     engine/status and engine/store back at ~/work/workers and the real Application
     Support directory, and every arm below would still pass while reading this
     operator's live agents. This is what notices. */
  for (const v of ['AGENT_WORKFORCE_DATA', 'AGENT_WORKFORCE_WORKERS', 'AGENT_WORKFORCE_CLAUDE_CONFIG', 'AGENT_WORKFORCE_LAUNCH']) {
    const val = process.env[v];
    assert.ok(val, `${v} is unset: this suite would read the operator's live state`);
    assert.ok(val.startsWith(SANDBOX), `${v} points outside the sandbox: ${val}`);
  }
  /* ⚠️ NO "is it outside ~/work" arm here. mkdtempSync roots at os.tmpdir(), so such an
     assertion can never return the dangerous answer, and it would read as a second guard
     while being decoration. The startsWith(SANDBOX) checks above are the real ones. */
});

test('#2519: the recorded fixture exists and parses', () => {
  const card = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assert.equal(typeof card, 'object');
  assert.ok(!Array.isArray(card));
  assert.ok(Object.keys(card).length >= 20,
    `a real card carries ~30 fields; ${Object.keys(card).length} suggests a hand-built literal, which is the class this fixture exists to avoid`);
  /* ⚠️ `>= 20`, matching goldenCard()'s `< 20` refusal exactly. They were `> 20` and
     `< 20`, so a producer that settled on exactly 20 fields would have passed the
     shipped floor and redded the suite: two spellings of one threshold. */
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
  /* 🛑 INSIDE fleet.install, SO THE PANE SOURCE IS FAKED TOO. The AGENT_WORKFORCE_*
     sandbox at the top of this file controls the DATA and WORKERS roots; it does NOT
     control tmux. Measured: with only the env sandbox, this arm still returned
     source='live' with 30 keys, because status.snapshot() was scanning the operator's
     real panes. That makes the result depend on who happens to be running on the box.
     fleet.install fakes the pane source, so "live" here is a card this test created. */
  const fleet = require('./test-support/fleet.js');
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  let r;
  try {
    const { realCard } = resolvers()();
    r = realCard();
  } finally {
    board.restore();
  }
  assert.ok(r && typeof r === 'object' && 'card' in r && 'source' in r,
    'realCard must return {card, source}');
  assert.equal(r.source, 'live', 'a faked live board was present and realCard did not use it');
  /* 'error' belongs here: on a box where status.js legitimately throws, omitting it made
     the unit suite red with "unexpected source" instead of the check reporting the
     condition it was built to report. */
  assert.ok(['live', 'golden', 'none', 'error'].includes(r.source), `unexpected source ${r.source}`);
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
  /* ⚠️ null OR the placeholder, never "must be a string". The producer emits null for
     several of these (measured: role null on 4 of 18 cards, stateEvidence null on 13 of
     18), and an earlier version of this arm asserted the string form positively -- which
     meant the SUITE REQUIRED the invented values and would have redded if the capture
     tool were corrected. A test that pins a defect in place is worse than no test. */
  assert.ok(card.role === null || card.role === 'example worker', `role is ${JSON.stringify(card.role)}`);
  assert.ok(card.task === null || card.task === 'an example task', `task is ${JSON.stringify(card.task)}`);
  assert.ok(card.stateProject === null || card.stateProject === 'example-project');
  /* ⚠️ NOT `''`. The capture preserves the TYPE and neutralises only string CONTENT,
     because status.js emits `status.conflict || null` and an empty string is a value it
     can never produce. So: null, or a neutral sentence. */
  assert.ok(card.stateConflict === null || card.stateConflict === 'an example conflict',
    `stateConflict is ${JSON.stringify(card.stateConflict)}, which is neither null nor the neutral sentence`);
  assert.ok(card.stateEvidence === null || /^✽ Working…/.test(card.stateEvidence),
    `stateEvidence is ${JSON.stringify(card.stateEvidence)}`);
  assert.match(card.profile.idInstall, /^0{8}-0{4}-4000-8000-0{12}$/);
  assert.match(card.profile.id, /^0+$/);
  /* 🛑 NOTHING IDENTIFYING ANYWHERE UNDER profile, asserted structurally rather than by
     listing the keys this box happens to emit. The tree also writes `dir` (an absolute
     path), `displayName`, `role` and `reportsTo` into profiles; the committed fixture is
     clean today only because the captured agent carried none of them. The capture now
     scrubs every string under profile, and this is what notices if that stops. */
  const strings = [];
  (function walk(v, at) {
    if (!v || typeof v !== 'object') return;
    for (const k of Object.keys(v)) {
      const val = v[k];
      if (typeof val === 'string') strings.push([at + k, val]);
      else walk(val, at + k + '.');
    }
  })(card.profile, '');
  for (const [where, val] of strings) {
    assert.ok(!val.includes('/'), `profile.${where} carries a path: ${val}`);
    assert.ok(/^(example-|0+$|2026-|00000000-)/.test(val), `profile.${where} is not neutralised: ${val}`);
  }
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

test('#2519: the capture PRESERVES types and never invents a value', () => {
  /* 🛑 THE TOOL ITSELF, DRIVEN. Nothing exercised it before, so mutating the
     neutralisation reded no arm: the guards inside it were guards nothing ran.
     status.js emits null for several of these fields (measured on an 18-agent board:
     role string x14 / null x4, stateEvidence null x13 / string x5), and an
     unconditional string assignment invents a value the producer cannot emit. */
  const cap = require('./tools/capture-agent-card.js');
  const fleet = require('./test-support/fleet.js');
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const real = board.card('mara');
    const withNulls = Object.assign({}, real, { role: null, task: null, stateEvidence: null, stateProject: null, stateConflict: null });
    const out = cap.neutralise(withNulls);
    for (const f of ['role', 'task', 'stateEvidence', 'stateProject', 'stateConflict']) {
      assert.equal(out[f], null, `${f} was invented where the producer emitted null`);
    }
    const withStrings = Object.assign({}, real, { role: 'secret role', stateEvidence: 'secret evidence' });
    const out2 = cap.neutralise(withStrings);
    assert.equal(out2.role, 'example worker', 'a real role survived neutralisation');
    assert.notEqual(out2.stateEvidence, 'secret evidence', 'real evidence survived neutralisation');
  } finally {
    board.restore();
  }
});

test('#2519: the capture scrubs EVERY string under profile, including unlisted ones', () => {
  /* profile is free-form: the tree also writes `dir` (an absolute path), `displayName`
     and `reportsTo`. A neutralisation that lists what it knows about is clean only for
     the agent that happened to be captured, and this file is committed. */
  const cap = require('./tools/capture-agent-card.js');
  const profile = { dir: '/Users/someone/work/secret-repo', displayName: 'Real Person', nested: { note: 'private' }, count: 7 };
  cap.scrubStrings(profile);
  assert.ok(!profile.dir.includes('/'), `an absolute path survived: ${profile.dir}`);
  assert.notEqual(profile.displayName, 'Real Person');
  assert.notEqual(profile.nested.note, 'private', 'a nested string survived');
  assert.equal(profile.count, 7, 'a non-string was altered');
});

test('#2519: nothing under CONTEXT survives neutralisation either', () => {
  /* 🛑 THE SAME GUARANTEE, ON THE SUBTREE THAT ESCAPED IT. The whole-card scrub was
     immediately undone for `context` by a line that cloned the RAW producer object back
     in. Measured before the fix: a context.because of
     "SECRET:/Users/realoperator/private.txt" reached the output verbatim. `profile` had
     an arm; `context` did not, which is why it went unnoticed. */
  const cap = require('./tools/capture-agent-card.js');
  const fleet = require('./test-support/fleet.js');
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const real = board.card('mara');
    const poisoned = Object.assign({}, real, {
      context: Object.assign({}, real.context, { because: 'SECRET:/Users/realoperator/private.txt' }),
    });
    const out = cap.neutralise(poisoned);
    assert.ok(!String(out.context.because).includes('/'),
      `context.because reached the fixture verbatim: ${out.context.because}`);
    /* ⚠️ THE PIN IS CONDITIONAL AND SO IS THIS. A fleet agent has no recorded usage, so
       its context.tokens/percent are NULL, and preserving null is the correct
       type-preserving behaviour: an earlier version of this arm demanded numbers
       unconditionally and failed for the right reason. Assert the contract, not one
       board's values. */
    for (const f of ['tokens', 'percent']) {
      const before = poisoned.context[f];
      const after = out.context[f];
      if (typeof before === 'number') assert.equal(typeof after, 'number', `${f} lost its type`);
      else assert.equal(after, before, `${f} was invented where the producer emitted ${JSON.stringify(before)}`);
    }
    const pinned = cap.neutralise(Object.assign({}, real, {
      context: Object.assign({}, real.context, { tokens: 999, percent: 77 }),
    }));
    assert.equal(pinned.context.tokens, 82646, 'a numeric tokens was not pinned');
    assert.equal(pinned.context.percent, 8, 'a numeric percent was not pinned');
  } finally {
    board.restore();
  }
});

test('#2519: a field the producer ADDS LATER is scrubbed, not passed through', () => {
  /* 🛑 THE GUARANTEE HAS TO BE STRUCTURAL, NOT A LIST. The top level used to be an
     allowlist, so `runner`, `model`, a non-null `disruption` and any field status.js
     added later would reach a COMMITTED file verbatim. The capture's own key-set refusal
     cannot see that: a new identifying field changes no key count. */
  const cap = require('./tools/capture-agent-card.js');
  const fleet = require('./test-support/fleet.js');
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const real = board.card('mara');
    const withNew = Object.assign({}, real, { someNewProducerField: '/Users/someone/private/path' });
    const out = cap.neutralise(withNew);
    assert.ok(!out.someNewProducerField.includes('/'),
      `an unknown field reached the fixture verbatim: ${out.someNewProducerField}`);
  } finally {
    board.restore();
  }
});

test('#2519: the capture refuses a PANELESS card', () => {
  /* Its shape differs from a pane card's, so recording one would make the fixture a
     different shape from the card the reopen arm opens. */
  const cap = require('./tools/capture-agent-card.js');
  const fleet = require('./test-support/fleet.js');
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const real = board.card('mara');
    const paneless = Object.assign({}, real, { paneless: true, session: 'paneless-one' });
    const pane = Object.assign({}, real, { paneless: false, session: 'pane-one', stateConfidence: 'scraped' });
    assert.equal(cap.chooseCard([paneless, pane]).chosen.session, 'pane-one');
    assert.equal(cap.chooseCard([paneless]).chosen, null, 'a paneless-only board should yield nothing to record');
  } finally {
    board.restore();
  }
});

test('#2519: the check has NO live-vs-fixture drift guard, deliberately', () => {
  /* 🛑 THIS ARM PINS A REMOVAL, and the reason matters more than the code. An earlier
     version of this branch compared the live card's nested key paths against the
     recording inside render-talk.js and pushed a PROBLEM on any difference. It fired on
     ordinary board composition, not drift.
     MEASURED on an 18-agent board: TWO distinct `profile` shapes among our pane cards,
     17 carrying id/idInstall/instructionsWrite/updatedAt and ONE empty, because
     store.readProfile() returns {} for an agent with no profile file. `profile` is a
     free-form operator record and `context` has five key sets in status.js depending on
     that agent's transcript and ceiling, so no two cards are guaranteed to share a
     nested shape.
     ⚠️ And WHICH card was compared was arbitrary: liveCard() takes the first pane card
     tmux lists while the capture prefers one with real evidence, so whether a release
     cut went red depended on pane ordering, and "re-capture it" would only have moved
     which card failed.
     ⇒ The anti-rot check is the TOP-LEVEL comparison in this file instead, where a
     false red costs a test run rather than a release. If you are about to re-add a
     nested guard to the check, measure the profile shapes on a real board first. */
  assert.ok(!/has drifted from status\.snapshot/.test(SRC),
    'a live-vs-fixture drift guard is back in the check; read this arm before re-adding one');
  /* ⚠️ Matched on the FAILURE TEXT and the recursion shape, not on one identifier: a
     re-added guard written with different variable names would slip past a name pin, and
     this tree calls that out as an anti-pattern. */
  /* Matched on what a real guard DOES -- push a problem whose text says drift -- rather
     than on an identifier a rewrite would change, or on prose. An earlier version matched
     the words "drifted|re-capture" anywhere after the reopen arm and caught this file's
     OWN explanation of the removal. */
  const pushesDrift = /problems\.push\([^)]*drift/i.test(SRC) || /problems\.push\([^)]*re-capture/i.test(SRC);
  assert.ok(!pushesDrift, 'a live-vs-fixture drift comparison is back in the check');
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

test('#2519: a fallback run emits a NOTE, and notes can never read as failures', () => {
  /* The release gate anchors on `^\s*(FAIL|✖)`. A note that reached that anchor would
     turn a covered quiet-box run back into a red, which is the bug inverted. */
  assert.match(SRC, /notes\.push\(/, 'no note is emitted when the fallback drives the arm');
  assert.match(SRC, /NOTE {2}\$\{n\}/, 'notes must print with a NOTE prefix, not a FAIL one');
  assert.ok(!/problems\.push\([^)]*RECORDED card fixture/.test(SRC),
    'the fallback must not be pushed as a problem');
});
