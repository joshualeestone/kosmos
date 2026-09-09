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

/* 🛑 A FILE-SCOPE SAFETY NET FOR THE COMMITTED FIXTURE, AND IT SITS BELOW `FIXTURE` ON
   PURPOSE. The I/O-guard arm holds the fixture bytes around its own child spawn, which
   protects that arm and nothing else: a DOZEN OTHER ARMS `require()` the capture tool in
   THIS process, so if the tool's write ever sits outside the `require.main` guard, the
   first of those requires writes the operator's live board over the recording, in the
   parent, before the I/O arm runs at all.
   MEASURED: mutating the tool to write above the guard left the committed fixture as `{}`
   on disk, with eight arms then failing for the wrong reason.
   🛑 AND THE FIRST VERSION OF THIS NET SILENTLY DID NOTHING. It was placed ABOVE the
   `const FIXTURE` declaration, so the read hit the temporal dead zone, the `catch`
   swallowed the ReferenceError, and it disabled itself while looking exactly like a
   working guard. The same mutation damaged the fixture a second time and the net reported
   nothing. It now throws on a failed initial read rather than returning null, so it
   cannot fail quietly again.
   ⇒ This is a net for a BROKEN TOOL, not a licence to write here: nothing in this suite
   should modify the fixture, and if it ever fires, the tool is broken. */
const FIXTURE_BYTES_AT_LOAD = fs.readFileSync(FIXTURE);
process.on('exit', () => {
  try {
    if (!fs.readFileSync(FIXTURE).equals(FIXTURE_BYTES_AT_LOAD)) {
      fs.writeFileSync(FIXTURE, FIXTURE_BYTES_AT_LOAD);
      process.stdout.write('  RESTORED the committed fixture: something in this run rewrote it\n');
    }
  } catch { /* best effort at exit */ }
});

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

/* The distinct `context` key-sets status.js can emit, keyed by their sorted key CSV and
   counting occurrences. Scans every context-shaped object literal (one carrying `because:`
   and either `confidence:` or `...NONE_BASE`, whose keys include tokens and because) and
   EXPANDS the `...NONE_BASE` spread, which a named-function walk cannot see.
   🛑 SHARED BY TWO ARMS ON PURPOSE. The "context key-set" arm counts these (four distinct,
   the family shape eleven times); the #2553 nested-drift arm asserts the recorded fixture
   matches one of them. An inline byte-copy in each would be the drift this very tree keeps
   catching in its own guards, so the scan lives once, here. */
function contextShapes(statusSrc) {
  const NONE_BASE_KEYS = ['tokens', 'percent', 'confidence'];
  const objKeys = (body) => {
    const clean = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const keys = new Set();
    let d = 0; let tok = '';
    for (let k = 0; k < clean.length; k++) {
      const ch = clean[k];
      if ('{(['.includes(ch)) d++;
      else if ('})]'.includes(ch)) d--;
      if (d === 0 && (ch === ',' || k === clean.length - 1)) {
        const t = (tok + (k === clean.length - 1 ? ch : '')).trim();
        if (/^\.\.\.NONE_BASE\b/.test(t)) NONE_BASE_KEYS.forEach((x) => keys.add(x));
        else { const m = t.match(/^([A-Za-z_]\w*)\s*(?::|$)/); if (m) keys.add(m[1]); }
        tok = '';
      } else tok += ch;
    }
    return [...keys].sort();
  };
  const shapes = new Map();
  for (let i = 0; (i = statusSrc.indexOf('{', i)) !== -1; i++) {
    let d = 0; let j = i;
    for (; j < statusSrc.length; j++) {
      if (statusSrc[j] === '{') d++;
      else if (statusSrc[j] === '}') { d--; if (!d) break; }
    }
    if (j >= statusSrc.length) continue;
    const body = statusSrc.slice(i + 1, j);
    /* ⚠️ THE `< 400` CUTOFF IS LOAD-BEARING FOR TWO ARMS NOW (the key-set arm and the
       #2553 nested-drift arm), and the margin is not large: measuredResult's body is the
       longest context literal at ~337 chars. If a variant's body grows past 400 it drops
       out of this scan, and both arms notice rather than pass silently -- the key-set arm's
       `shapes.size === 4` reds, and the nested-drift arm's `shapes.has(ctxKeys)` reds once
       the fixture's own variant is the one that fell out. Raise the cutoff (and re-derive)
       if a legitimate context builder ever needs a longer body. */
    if (body.length >= 400 || !/\bbecause\s*:/.test(body)) continue;
    if (!/\bconfidence\s*:/.test(body) && !/\.\.\.NONE_BASE/.test(body)) continue;
    const k = objKeys(body);
    if (!k.includes('tokens') || !k.includes('because')) continue;
    shapes.set(k.join(','), (shapes.get(k.join(',')) || 0) + 1);
  }
  return shapes;
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
  /* ⚠️ THE RENAME IS WHAT THIS ARM CAN ACTUALLY SEE, and only `state` proves it. The
     committed fixture already carries sessionName 'april' and name 'April', so those two
     assertions pass whether or not goldenCard renames anything -- they read as coverage
     of the rename and are not. `state` is the one field the fixture does not already
     hold: the recording carries 'working', so deleting the rename reds exactly this line.
     ⚠️ THIS PARENTHETICAL SAID 'idle' AND THE FIXTURE SAYS 'working'. The assertion was
     always right (it is a notEqual control against needs_you); the sentence describing a
     file two directories away was not, which is this branch's named defect class showing
     up in a comment that exists to explain a control. */
  const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assert.notEqual(raw.state, 'needs_you', 'CONTROL: the fixture must NOT already hold the renamed state, or the next line proves nothing');
  assert.equal(card.state, 'needs_you', 'goldenCard did not apply the rename the live path applies');
  assert.equal(card.sessionName, 'april');
  assert.equal(card.name, 'April');
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
  /* ⚠️ THIS COMMENT DESCRIBED A MEMBERSHIP CHECK THAT NO LONGER EXISTS. It said "'error'
     belongs here", from a version where the assertion accepted a SET of sources. The line
     above is now a strict equality on 'live', which is stronger and correct inside
     fleet.install: the board is faked, so a live card is the only right answer and an
     'error' here would be a real failure rather than a tolerated one. */
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
     clean today only because the captured agent carried none of them.
     🛑 THIS ARM READS THE COMMITTED FIXTURE, SO IT CANNOT TEST THE PRODUCER. An earlier
     version of this sentence said it "notices if the capture stops scrubbing profile",
     which is false: the file on disk is already scrubbed, so no change to scrubStrings
     can red this. It notices a BAD RECORDING after someone re-captures, which is worth
     having and is a different job. The producer-side coverage is the separate
     `scrubs EVERY string under profile` arm, which drives scrubStrings directly. Same
     distinction the id arm below proves by mutation. */
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
       ⚠️ THE NESTED-EQUALITY comparison (this recording vs a live card, key path by key
       path) NO LONGER EXISTS ANYWHERE, and must not: an earlier version of this comment
       said it "lives in render-talk.js's own guard", that guard was removed on this branch
       (an arm below pins its absence) because it false-reds on composition, and this file
       once asserted it both ways -- the exact contradiction render-talk.js's header names.
       ⇒ #2553 closes the nested gap a DIFFERENT way, which is why re-adding it is not
       re-adding the bug: the COMPOSITION-AWARE DRIFT GUARD arm below checks the recording's
       context against the SET of shapes status.js can emit (not against one live card), so
       composition passes and only an un-re-captured producer change reds. So nested CONTEXT
       drift is guarded; live-vs-live nested equality is deliberately still absent. */
    /* 🛑 THE RAW FILE, NOT goldenCard's OUTPUT. `goldenCard` spreads the renamed
       sessionName, name and state back over the recording, so those three keys are
       RE-ADDED even when the file on disk has lost them: the
       ⚠️ (Written without a literal example on purpose. The first version quoted the
       spread inline and fixture-discipline's hand-built-card lint fired on the COMMENT,
       which is the lint being blunt rather than wrong; rewording is cheaper than an
       exemption, and an exemption is how a blunt guard stops guarding.)
       comparison could not see those three going missing, which are the keys a rot would
       most plausibly take. The neighbouring arms do not close it either
       (`notEqual(raw.state, 'needs_you')` passes on `undefined`, and the key floor
       tolerates a 29-key file). */
    const onDisk = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    assert.deepEqual(
      Object.keys(onDisk).sort(), Object.keys(real).sort(),
      'the recorded card has drifted from status.snapshot(); re-capture with node tools/capture-agent-card.js');
  } finally {
    board.restore();
  }
});

test('#2519: a fixture that is valid JSON but NOT an object is refused, and says so', () => {
  /* 🛑 THE FOURTH CAUSE, WHICH EXPLAINED NOTHING. The catch block enumerates a corrupt, a
     missing and an unreadable fixture; the shape floor explains a trimmed one. Valid JSON
     that parses to an array, a number, a string or null fell through a SILENT `return
     null` one line above the floor whose own comment says a cause that explains nothing is
     worse than a delete. Proved unarmed by mutation: deleting that NOTE redded nothing. */
  const { goldenCard } = resolvers()();
  for (const [label, body] of [['an array', '[]'], ['a number', '42'], ['null', 'null'], ['a string', '"card"']]) {
    const f = path.join(SANDBOX, 'shape-' + label.replace(/\W+/g, '-') + '.json');
    fs.writeFileSync(f, body + '\n');
    const written = [];
    const realWrite = process.stdout.write;
    process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
    let r;
    try { r = goldenCard(f); } finally { process.stdout.write = realWrite; }
    assert.equal(r, null, `${label} was served as a card`);
    assert.match(written.join(''), /NOTE  render-talk/, `${label} was refused SILENTLY, which is worse than a delete`);
    assert.match(written.join(''), /not a card object/, `the NOTE for ${label} does not say why`);
  }
});

test('#2519: a TRIMMED fixture is refused, not served as a hollow card', () => {
  /* "An object that is not an array" accepts `{}`: openDetail would still run and the
     reopen arm would still pass, giving the box the fallback exists for a coverage claim
     with nothing behind it. The floor lives in goldenCard() rather than only in this
     suite, because anyone invoking tools/browser-checks.sh directly never reaches here. */
  /* ⚠️ REGISTERED FOR CLEANUP BEFORE ANY ASSERTION. Removing it on the success path only
     leaks a directory on every failure, which is what left eight of them on disk before
     the SANDBOX at the top of this file got its exit handler. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-2519-'));
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
  const thin = path.join(dir, 'thin.json');
  /* ⚠️ NEUTRAL KEYS, NOT CARD-SHAPED ONES, and deliberately so. The floor counts keys,
     so any small object proves it. A `{sessionName, name}` literal here reads as a
     hand-built card to fixture-discipline's lint -- which flagged an earlier version of
     this line -- and that guard cannot tell a deliberately-invalid object from a fixture
     standing in for a real card. Do not make this look like a card to be "realistic":
     the whole point is that it is NOT one. */
  fs.writeFileSync(thin, JSON.stringify({ a: 1, b: 2 }) + '\n');
  const { goldenCard } = resolvers()();
  /* 🛑 THE FLOOR MUST ALSO SAY WHY, and capturing stdout is the only way to see it. A
     silent `return null` made a readable, valid-JSON, TRIMMED fixture the one cause that
     explained nothing downstream: harder to diagnose than a deleted file, which at least
     produces the catch block's NOTE. */
  const written = [];
  const realWrite = process.stdout.write;
  process.stdout.write = (chunk, ...rest) => { written.push(String(chunk)); return realWrite.call(process.stdout, chunk, ...rest); };
  let thinResult;
  try { thinResult = goldenCard(thin); } finally { process.stdout.write = realWrite; }
  assert.equal(thinResult, null, 'a two-field card passed the floor');
  const note = written.join('');
  assert.match(note, /NOTE  render-talk/, 'the floor rejected the fixture silently');
  assert.match(note, /below the floor of 20/, 'the NOTE does not say WHY the fixture was ignored');
  const full = path.join(__dirname, 'docs', 'browser-checks', 'fixtures', 'agent-card.json');
  assert.ok(goldenCard(full), 'CONTROL: the real fixture must still pass, or the floor is just broken');
});

test('#2519: realCard PREFERS a live card, and says so', () => {
  /* The precedence and the LABEL, which nothing asserted. A mutation returning
     `{card: goldenCard(), source: 'live'}` passed the old membership check on every box
     AND would have made a live-vs-fixture comparison compare the fixture against itself (⚠️ this said "the check's drift guard", present tense, in the same file whose arm below pins that no such guard exists): vacuously
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
  /* >= 20, matching the arm above and the shipped `< 20`. This was the THIRD spelling of
     one threshold in a file that names that hazard, and it passed only because the
     fixture carries 30 keys. */
  assert.ok(r.card && Object.keys(r.card).length >= 20, 'the fallback did not produce a real-shaped card');
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
     neutralisation redded no arm: the guards inside it were guards nothing ran.
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

test('#2519: the three RE-PINNED fields are enum-bounded, and nothing else may join them', () => {
  /* 🛑 THE SHAPE THIS FILE WAS BURNED BY FOUR TIMES, LEFT UNTESTED ON THE THREE THAT ARE
     SAFE. `state`, `stateConfidence` and `runner` are restored from the RAW producer, and
     that is only sound because status.js bounds them: state and confidence come from the
     STATE and CONFIDENCE constants, runner from a ternary that can yield nothing but
     'codex' or 'claude'. `model` and `modelName` got an arm the day they turned out NOT
     to be bounded; these three carried the same reliance with nothing holding it.
     ⚠️ MEASURED BEFORE THIS ARM: neutralise({state: '/Users/realoperator/leaked'}) put
     that string in the output verbatim. It is not a live leak, because the producer
     cannot emit it, but the whole point of this file's history is that "the producer
     cannot emit it" is a claim somebody has to keep true. */
  const cap = require('./tools/capture-agent-card.js');
  const fleet = require('./test-support/fleet.js');
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const real = board.card('mara');
    /* 🛑 READ FROM THE PRODUCER, NOT RESTATED. The first version of this arm carried the
       comment "the enum vocabularies, read from the producer rather than restated here"
       above a HAND-TYPED array, and that array was already missing STATE.AUTH_FAILED
       (status.js:257), a reachable card state. The branch's most repeated defect,
       reproduced inside the guard written to catch it, one iteration after the guard was
       added. status.js exports both enums; there was never a reason to retype them. */
    const status = require('./engine/status.js');
    const STATES = Object.values(status.STATE);
    const CONFIDENCES = Object.values(status.CONFIDENCE);
    assert.ok(STATES.length >= 8 && STATES.includes('auth_failed'),
      `CONTROL: status.STATE did not come through as an enum: ${STATES}`);
    assert.ok(CONFIDENCES.length === 3, `CONTROL: status.CONFIDENCE changed shape: ${CONFIDENCES}`);
    const out = cap.neutralise(Object.assign({}, real));
    assert.ok(STATES.includes(out.state), `state left the enum: ${out.state}`);
    assert.ok(CONFIDENCES.includes(out.stateConfidence),
      `stateConfidence left the enum: ${out.stateConfidence}`);
    /* ⚠️ `runner` IS RESTATED, AND THAT IS SAID RATHER THAN DISGUISED. status.js does not
       expose a runner enum: it is a ternary at the pane card literal that can yield only
       'codex' or 'claude'. There is nothing to read, so the two values are written here
       with the reason, instead of a comment implying they were derived. */
    assert.ok(['codex', 'claude'].includes(out.runner), `runner left the enum: ${out.runner}`);
    /* 🛑 THE RELIANCE IS ENFORCED NOW, SO THE ASSERTION CHANGES SHAPE. It used to check
       that a poisoned state came OUT unrecognisable, which proved only that the arm could
       tell. The tool REFUSES it instead: a value outside the vocabulary is not recorded at
       all, which is the behaviour `model` needed and did not have when it turned out to be
       regex-extracted from transcript text. */
    const poisoned = Object.assign({}, real);
    poisoned.state = '/Users/realoperator/leaked-state';
    assert.throws(() => cap.neutralise(poisoned), /outside the vocabulary/,
      'a state outside the enum was RECORDED rather than refused');
    /* 🛑 AND THE TOOL'S VOCABULARY MUST MATCH THE PRODUCER'S. It is written into the tool
       rather than imported, so the two can drift; this is what makes the drift red a test
       instead of silently widening what the tool will record. */
    assert.deepEqual(cap.ENUMS.state.slice().sort(), STATES.slice().sort(),
      "the tool's state vocabulary has drifted from status.STATE");
    assert.deepEqual(cap.ENUMS.stateConfidence.slice().sort(), CONFIDENCES.slice().sort(),
      "the tool's confidence vocabulary has drifted from status.CONFIDENCE");
    /* CONTROL: a null still passes, because the producer emits null for these on some
       cards and a refusal that fired on null would refuse ordinary boards. */
    const nulled = Object.assign({}, real);
    nulled.state = null;
    assert.equal(cap.neutralise(nulled).state, null, 'a producer null was refused');
  } finally {
    board.restore();
  }
});

test('#2519: no NOTE the check emits can be quoted by the release gate as a failure reason', () => {
  /* 🛑 THE PLAN CLAIMED "an arm pins that" AND NO SUCH ARM EXISTED. The nearest one only
     checks that notes go through notes.push rather than problems.push; it never compared
     the NOTE TEXT against the gate's pattern. So the claim was a document describing a
     test that was never written, which is this branch's most repeated defect wearing its
     most convincing disguise.
     🛑 AND THE PATTERN IS READ FROM THE SHELL SCRIPT, NOT RESTATED. An earlier version of
     that claim, in four copies, said the gate anchors on `^\s*(FAIL|✖)`; it also greps
     Error|Timeout|REFUS|refus, unanchored, anywhere in the line. Retyping it here would
     re-create exactly that failure. */
  const gate = fs.readFileSync(path.join(__dirname, 'tools', 'browser-checks.sh'), 'utf8');
  const m = gate.match(/grep -E '([^']+)' "\$cap"/);
  assert.ok(m, 'CONTROL: the reason-quoting grep was not found in tools/browser-checks.sh; this arm is measuring nothing');
  const gateRe = new RegExp(m[1].replace(/\\s/g, '[ \\t]'));
  assert.ok(gateRe.test('  FAIL  something'), 'CONTROL: the extracted gate pattern does not match a FAIL line');
  assert.ok(gateRe.test('an Error happened'), 'CONTROL: the extracted gate pattern does not match an unanchored Error');

  const src = fs.readFileSync(path.join(__dirname, 'docs', 'browser-checks', 'render-talk.js'), 'utf8');
  /* Every literal this file emits with a NOTE prefix, plus every string pushed into
     `notes`. Both channels reach the same log the gate reads. */
  /* 🛑 EVERY FRAGMENT OF THE CONCATENATION, NOT JUST THE ONE CARRYING THE WORD "NOTE".
     The first version of this extraction matched `'  NOTE  ...'` literals, which is the
     FIRST piece of a multi-part `write('  NOTE ...' + x + ' more text')`. Proved blind by
     mutation: putting the word Error into a LATER fragment left this arm green. So the
     unit is the whole write CALL, and every string literal inside it is tested. */
  /* ⚠️ KNOWN FRAGILITY, NAMED RATHER THAN LEFT TO BE FOUND: this match is non-greedy to
     the first `);`, so a NOTE literal containing that two-character sequence would
     truncate the extraction and silently stop testing the rest of that call. It is a
     tripwire on the static literals, and the RUNTIME capture at the end of this arm is
     what actually holds the guarantee for the dynamic path. Three instruments on this
     branch have now been wrong about the source they read; a runtime capture cannot be. */
  const noteTexts = [];
  for (const call of src.matchAll(/process\.stdout\.write\(([\s\S]*?)\);/g)) {
    if (!/NOTE/.test(call[1])) continue;
    for (const lit of call[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)) noteTexts.push(lit[1]);
  }
  for (const mm of src.matchAll(/notes\.push\(`([^`]*)`\)/g)) noteTexts.push(mm[1]);
  assert.ok(noteTexts.length >= 13, `found only ${noteTexts.length} NOTE fragments (13 exist); a floor below the true count catches nothing, which this file names elsewhere`);
  for (const t of noteTexts) {
    assert.ok(!gateRe.test(t),
      `a NOTE would be quoted by the release gate as the reason for a red: ${JSON.stringify(t)}`);
  }
  /* CONTROL: a NOTE carrying a gate word must be caught, or the loop above proves
     nothing about the texts it just read. */
  assert.ok(gateRe.test('  NOTE  render-talk: an Error occurred'),
    'CONTROL: the gate pattern does not catch a NOTE carrying a gate word');

  /* 🛑 AND NOW THE HALF THE SOURCE SCAN CANNOT SEE, DRIVEN AT RUNTIME. Everything above
     reads static literals, so it is blind to the INTERPOLATED message in goldenCard's
     catch, while this arm's title claims no NOTE can be quoted. The interpolated text is
     not ours to choose: Node embeds the PATH in a thrown fs message, so a fixture path
     carrying a gate word puts that word into the NOTE.
     ⇒ Driven through the real function with a path containing "Timeout", and the output
     captured rather than parsed. A runtime capture cannot be defeated by a regex being
     wrong about the source, which is how the last three instruments on this branch
     failed. */
  const { goldenCard } = resolvers()();
  /* 🛑 THE POISON IS BUILT FROM THE GATE'S OWN ALTERNATION, not from two words I picked.
     It used to be a hardcoded 'Timeout-REFUS' filename, so `Error` and lowercase `refus`
     were never driven: deleting either of those two replaces in render-talk.js redded
     NOTHING, and a fifth alternative added to the gate grep would have escaped the same
     way. The words come out of tools/browser-checks.sh, so the arm widens when the gate
     does. */
  const gateWords = (m[1].match(/[A-Za-z]{3,}/g) || []).filter((word) => word !== 'FAIL');
  assert.ok(gateWords.length >= 4,
    `only ${gateWords.length} gate words extracted (${gateWords}); the poison would not exercise the alternation`);
  const poisonPath = path.join(SANDBOX, gateWords.join('-') + '-missing.json');
  const written = [];
  const realWrite = process.stdout.write;
  process.stdout.write = (chunk, ...rest) => { written.push(String(chunk)); return true; };
  try { goldenCard(poisonPath); } finally { process.stdout.write = realWrite; }
  const emitted = written.join('');
  assert.ok(emitted.includes('NOTE'), 'CONTROL: the poisoned path did not produce a NOTE at all');
  assert.ok(emitted.includes(SANDBOX) || emitted.includes('missing'),
    'CONTROL: the NOTE does not carry the message, so neutralising it proves nothing');
  for (const line of emitted.split('\n')) {
    if (!line.trim()) continue;
    assert.ok(!gateRe.test(line),
      `the interpolated NOTE would be quoted by the release gate: ${JSON.stringify(line)}`);
  }
  /* CONTROL: the raw message WOULD have matched, or the neutralisation is untested. */
  assert.ok(gateRe.test(`ENOENT: no such file or directory, open '${poisonPath}'`),
    'CONTROL: the un-neutralised message does not match the gate, so this arm proves nothing');
  /* AND EVERY WORD INDIVIDUALLY, so a neutralisation that covers three of four is caught. */
  for (const word of gateWords) {
    const one = path.join(SANDBOX, word + '-only-missing.json');
    const got = [];
    const w0 = process.stdout.write;
    process.stdout.write = (chunk) => { got.push(String(chunk)); return true; };
    try { goldenCard(one); } finally { process.stdout.write = w0; }
    for (const line of got.join('').split('\n')) {
      if (!line.trim()) continue;
      assert.ok(!gateRe.test(line),
        `a NOTE carrying the gate word ${word} would be quoted as a failure reason: ${JSON.stringify(line)}`);
    }
  }
});

test('#2519: the context key-set claim is DERIVED from status.js, not restated', () => {
  /* 🛑 THIS CLAIM IS LOAD-BEARING AND HAS BEEN WRONG THREE TIMES. It is the justification
     for deleting the nested drift guard ("no two cards are guaranteed to share a nested
     shape"), and it sits OUTSIDE the PIN-LIST and CATEGORY-LIST regions the other arms
     check, so none of them could see it. Wrong version 1: "five key sets" in three copies.
     Wrong version 2: my correction said "THREE context results" and missed
     neverRecordedResult. Wrong version 3: the correction to FOUR said noCeilingResult
     "adds ceilingSource, noCeiling" when it also adds `ceiling`.
     ⚠️ AND THE INSTRUMENT I FIRST WROTE TO CHECK IT WAS ALSO WRONG: a `(\w+)\s*:` match
     misses SHORTHAND properties, so it reported measuredResult adding two keys when it
     adds three. The extraction below splits the return object at depth zero and accepts
     `name:` and bare `name` alike. */
  const statusSrc = fs.readFileSync(path.join(__dirname, 'engine', 'status.js'), 'utf8');
  const keysOf = (fn) => {
    const i = statusSrc.indexOf('function ' + fn + '(');
    assert.ok(i !== -1, `CONTROL: ${fn} is gone from status.js, so this arm is measuring nothing`);
    const r = statusSrc.indexOf('return {', i);
    let depth = 0; let j = statusSrc.indexOf('{', r); const start = j;
    for (; j < statusSrc.length; j++) {
      if (statusSrc[j] === '{') depth++;
      else if (statusSrc[j] === '}') { depth--; if (!depth) break; }
    }
    const body = statusSrc.slice(start + 1, j).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const keys = new Set();
    let d = 0; let tok = '';
    for (let k = 0; k < body.length; k++) {
      const ch = body[k];
      if ('{(['.includes(ch)) d++;
      else if ('})]'.includes(ch)) d--;
      if (d === 0 && (ch === ',' || k === body.length - 1)) {
        const m = (tok + (k === body.length - 1 ? ch : '')).trim().match(/^([A-Za-z_]\w*)\s*(?::|$)/);
        if (m) keys.add(m[1]);
        tok = '';
      } else tok += ch;
    }
    return [...keys];
  };
  const FAMILY = ['tokens', 'percent', 'confidence', 'notYet', 'because'];
  const adds = (fn) => keysOf(fn).filter((k) => !FAMILY.includes(k)).sort();
  assert.deepEqual(adds('notYetResult'), [],
    'notYetResult no longer shares the NONE_BASE family key set, so the count of key sets has changed');
  assert.deepEqual(adds('neverRecordedResult'), ['neverRecorded']);
  assert.deepEqual(adds('measuredResult'), ['ceiling', 'ceilingAssumed', 'overCeiling']);
  assert.deepEqual(adds('noCeilingResult'), ['ceiling', 'ceilingSource', 'noCeiling']);
  /* CONTROL: the extractor must see SHORTHAND properties, which is what the first version
     missed. `ceiling` is shorthand in measuredResult and a literal in noCeilingResult. */
  assert.ok(keysOf('measuredResult').includes('ceiling'),
    'CONTROL: the extractor cannot see shorthand properties, so every ADDS set above is understated');
  assert.ok(keysOf('measuredResult').includes('tokens'),
    'CONTROL: the extractor missed the first shorthand key');
  /* AND THE DOCUMENTS MUST SAY WHAT THE CODE DOES. */
  /* ⚠️ EVERY OCCURRENCE, NOT THE FIRST. This used `match`, which pins one copy per
     document, and the claim appears TWICE in this very file: the second copy was checked
     by nothing while the arm's header said "the documents must say what the code does".
     Same shape as the document-checking arm whose first document was the file it extracted
     from, one layer in. */
  let claimsChecked = 0;
  for (const [where, text] of [
    ['docs/browser-checks/render-talk.js', fs.readFileSync(path.join(__dirname, 'docs', 'browser-checks', 'render-talk.js'), 'utf8')],
    ['render-talk-goldencard-2519.test.js', fs.readFileSync(__filename, 'utf8')],
  ]) {
    const claims = [...text.matchAll(/noCeilingResult \(adds ([^)]*)\)/g)];
    assert.ok(claims.length >= 1, `${where} no longer states what noCeilingResult adds`);
    for (const claim of claims) {
      const named = [...claim[1].matchAll(/`(\w+)`/g)].map((m) => m[1]).sort();
      assert.deepEqual(named, adds('noCeilingResult'),
        `${where} states noCeilingResult adds ${named}, and it adds ${adds('noCeilingResult')}`);
      claimsChecked++;
    }
  }
  assert.ok(claimsChecked >= 3, `only ${claimsChecked} copies of the claim were checked; there were three`);

  /* 🛑 AND THE WORD "FOUR" IS THE LOAD-BEARING HALF, which nothing derived. The arm above
     derives what four NAMED builders add; a fifth key set appearing in any of the inline
     context returns would leave every assertion green while the count in the docs went
     stale. The count is derived here by scanning every context-shaped object literal in
     status.js and expanding the `...NONE_BASE` spread, which the named-function walk
     cannot see. The scan itself is the shared `contextShapes` helper (used by the #2553
     nested-drift arm too), so the two cannot byte-drift from each other. */
  const shapes = contextShapes(statusSrc);
  assert.equal(shapes.size, 4,
    `status.js now emits ${shapes.size} distinct context key sets, not four: ${[...shapes.keys()].join(' | ')}. `
    + 'That count is the stated justification for the top-level-only anti-rot comparison, so it has to be re-argued, not just re-typed.');
  /* CONTROL: the scan must have found the family shape many times over, or a regex that
     matched almost nothing would report a plausible small number. */
  /* 🛑 THE EXACT COUNT, BECAUSE THREE DOCUMENTS SAY "ELEVEN" AND CALL IT DERIVED. A
     `>= 8` floor left that number unpinned while the prose presented it as arm-backed,
     which is the exact shape this branch is a record of. If status.js legitimately grows
     a twelfth object with the family shape, this reds and the three copies get updated in
     the same commit, which is the point. */
  const family = Math.max(...shapes.values());
  assert.equal(family, 11,
    `the NONE_BASE family shape occurs ${family} times in status.js, not the ELEVEN three documents state. `
    + 'Update those three copies in this commit rather than relaxing this assertion.');
});

test('#2519: the CATEGORY list is ascending, gap-free, and the same categories in both documents', () => {
  /* 🛑 THE SENTENCE COUNTING THESE CATEGORIES HAS NOW BEEN WRONG SIX TIMES, each version
     written one iteration after the previous was corrected: "nothing identifying can
     survive", "nothing identifying is numeric", "there is no third category", "everything
     is in exactly one of three", "in five categories" printed over six items with the
     numbering skipping 4, and then "four treatments and one gap, six items", which is four
     plus one making six.
     🛑 AND THE NUMBERING ITSELF REPRODUCED THE MISTAKE. The re-pinned category was labelled
     `1b`, which reads as a sub-case of (1), in the same paragraph that says calling it a
     sub-case is what let three versions claim "exactly one of them". The two documents also
     listed the categories in two DIFFERENT orders, and one was missing a category the other
     carried.
     ⇒ Prose has failed at this six times, so it is checked: ascending, gap-free, identical
     count in both. */
  const DOCS = [
    ['docs/browser-checks/README.md', fs.readFileSync(path.join(__dirname, 'docs', 'browser-checks', 'README.md'), 'utf8'), /^(\d+)\. \*\*/gm],
    ['tools/capture-agent-card.js', fs.readFileSync(path.join(__dirname, 'tools', 'capture-agent-card.js'), 'utf8'), /^ {5}(\d+)\. /gm],
  ];
  const counts = [];
  for (const [where, text, re] of DOCS) {
    const b = text.indexOf('CATEGORY-LIST-BEGIN');
    const e = text.indexOf('CATEGORY-LIST-END');
    assert.ok(b !== -1 && e > b, `${where} has no CATEGORY-LIST sentinels, so the enumeration cannot be located`);
    const nums = [...text.slice(b, e).matchAll(re)].map((m) => Number(m[1]));
    assert.ok(nums.length >= 5, `${where}: found only ${nums.length} numbered categories: ${nums}`);
    assert.deepEqual(nums, nums.slice().sort((x, y) => x - y),
      `${where} lists its categories OUT OF ORDER: ${nums}`);
    assert.deepEqual(nums, Array.from({ length: nums.length }, (_, i) => i + 1),
      `${where}'s category numbering is not 1..${nums.length} gap-free: ${nums}`);
    counts.push([where, nums.length]);
  }
  assert.equal(counts[0][1], counts[1][1],
    `the two documents enumerate different numbers of categories: ${JSON.stringify(counts)}`);
  /* 🛑 AND THE ITEMS, NOT ONLY HOW MANY. This compared counts alone while the title said
     "the same in both documents", so two documents could have enumerated six ENTIRELY
     DIFFERENT categories and passed. Compared on the leading label word, case-folded,
     because the two documents legitimately word the rest differently. */
  const labels = (text, re) => {
    const b = text.indexOf('CATEGORY-LIST-BEGIN');
    const e = text.indexOf('CATEGORY-LIST-END');
    return [...text.slice(b, e).matchAll(re)].map((m) => m[2].replace(/[`*]/g, '').trim().split(/\s+/)[0].toUpperCase());
  };
  const readmeLabels = labels(DOCS[0][1], /^(\d+)\. \*\*(.+)$/gm);
  const toolLabels = labels(DOCS[1][1], /^ {5}(\d+)\. (.+)$/gm);
  assert.ok(readmeLabels.length >= 5, `CONTROL: only ${readmeLabels.length} README labels extracted`);
  assert.deepEqual(readmeLabels, toolLabels,
    `the two documents enumerate different categories in the same positions: ${JSON.stringify(readmeLabels)} vs ${JSON.stringify(toolLabels)}`);
  /* AND THE PROSE COUNT MUST MATCH THE ITEMS, which is the specific act every wrong
     version got backwards. */
  const readme = DOCS[0][1];
  const claim = readme.match(/(FIVE|FOUR|SIX|THREE) treatments and (ONE|TWO) gap/);
  assert.ok(claim, 'the README no longer states how many treatments and gaps there are');
  const WORDS = { THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, ONE: 1, TWO: 2 };
  assert.equal(WORDS[claim[1]] + WORDS[claim[2]], counts[0][1],
    `the README says ${claim[0]}, which is ${WORDS[claim[1]] + WORDS[claim[2]]} items, but lists ${counts[0][1]}`);
});

test('#2519: every PINNED field name appears in all four documents that enumerate them', () => {
  /* 🛑 THE MOST REPEATED DEFECT ON THIS BRANCH IS A SENTENCE, NOT A LINE OF CODE. The pin
     enumeration has gone stale TWICE, in four copies at once each time (the tool header,
     render-talk.js's header, the README and the plan), and three successive attempts to
     state the neutralisation guarantee were each wrong, the newest written one iteration
     after the previous was corrected. Prose discipline has now failed enough times to
     stop being the remedy.
     ⇒ So the list is EXTRACTED FROM THE CODE and checked against the documents. A pin
     added without updating a document reds this arm, which is the only mechanism that
     has not already failed here. */
  const src = fs.readFileSync(path.join(__dirname, 'tools', 'capture-agent-card.js'), 'utf8');
  /* Split every `card.<f> = <rhs>` by WHAT THE RHS IS: a LITERAL is a pin, a REFERENCE to
     another object is the separate enum-bounded re-pin the documents name apart.
     ⚠️ THE CLASSIFIER USED TO KEY ON THE IDENTIFIERS `live.` AND `card.`, so a re-pin
     written through any alias (`const raw = live; card.x = raw.x`) was silently filed as
     a PIN and the re-pin guard below stopped firing. A name pin defeated by a rename is
     the anti-pattern this very file condemns elsewhere. What actually distinguishes the
     two is the KIND of right-hand side, so that is what is tested.
     ⚠️ Two earlier instruments were also wrong: one matched `===` comparisons as
     assignments, and one used a lookahead the engine defeated by backtracking the
     whitespace, so it ran against " live.state" and passed. */
  /* ⚠️ PATHS, NOT NAMES. Keyed on the bare name, `because` (pinned top-level AND under
     `context`) appeared once and a pin at a second LOCATION under an already-listed name
     was invisible to this arm by construction. */
  const pinned = new Set();
  const repinned = new Set();
  for (const m of src.matchAll(/card((?:\.\w+)+)\s*(?<![=!<>])=(?![=>])\s*(\S+)/g)) {
    const p = m[1].slice(1);
    (/^(['"]|\d|true|false|typeof)/.test(m[2]) ? pinned : repinned).add(p);
  }
  /* ⚠️ THE EXACT COUNT, NOT A FLOOR WITH SLACK. This was `>= 21` while the code pins
     22, so the first deletion netted to 21 and passed, while the comment below claimed
     the floor catches a net removal. A floor one below the truth catches nothing. */
  assert.equal(pinned.size, 24, `the pin count changed: ${pinned.size} -> ${[...pinned].sort()}`);
  assert.deepEqual([...repinned].sort(), ['runner', 'state', 'stateConfidence'],
    'the set of fields re-pinned FROM another object changed; that is the enum-bounded category and it needs an arm of its own');

  /* 🛑 THE REGION, NOT THE WHOLE FILE, AND THAT WAS A REAL HOLE. The first version asked
     `text.includes(f)` of each document, which is (a) TRUE BY CONSTRUCTION for the tool
     itself, since `pinned` was extracted from that same text, so it checked three
     documents while claiming four; and (b) satisfied incidentally elsewhere for common
     words like `name`, `session`, `model`, `because`. Measured while it was green: the
     tool's own list named FOUR of the twenty-one pins. The sentinels bound the region so
     a name must appear in the ENUMERATION, not merely somewhere in the file. */
  const DOCS = [
    ['tools/capture-agent-card.js', src],
    ['docs/browser-checks/render-talk.js', fs.readFileSync(path.join(__dirname, 'docs', 'browser-checks', 'render-talk.js'), 'utf8')],
    ['docs/browser-checks/README.md', fs.readFileSync(path.join(__dirname, 'docs', 'browser-checks', 'README.md'), 'utf8')],
    /* ⚠️ FOUND BY GLOB, NOT BY A HARDCODED TIMESTAMP. The plan's filename carries the
       minute it was created, so renaming or re-dating it made this arm throw ENOENT
       instead of reporting what it exists to report: a guard that dies on an unrelated
       rename is not reporting, it is crashing. */
    ['.claude/plans/goldencard-2519-*.md', (() => {
      const dir = path.join(__dirname, '.claude', 'plans');
      let hits = fs.readdirSync(dir).filter((f) => /^goldencard-2519-.*\.md$/.test(f) && !/-pre-challenge\.md$/.test(f));
      /* ⚠️ AT LEAST ONE, not exactly one. Coupling the product suite to a single process
       artifact means a follow-up plan for the same branch makes this arm THROW rather than
       report what it exists to report. The glob replaced a hardcoded timestamp, which was
       right; the exact count was one notch too tight. */
    assert.ok(hits.length >= 1, `no plan file found for this branch in ${dir}`);
    /* ⚠️ CHOSEN BY CONTENT, NOT BY SORT ORDER. `hits.sort()[0]` couples a product test to
       a process artifact's FILENAME ordering: `-` sorts before a digit, so a follow-up
       plan named goldencard-2519-2026-09-... would become hits[0] and red the suite with
       "has no PIN-LIST-BEGIN sentinel", which is a true statement about the wrong file. */
    hits.sort();
    const withList = hits.filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('PIN-LIST-BEGIN'));
    assert.equal(withList.length, 1,
      `expected exactly one plan file carrying the PIN-LIST sentinels, found ${withList.length} of ${hits.length}: ${hits}`);
    hits = withList;
      return fs.readFileSync(path.join(dir, hits[0]), 'utf8');
    })()],
  ];
  const missing = [];
  for (const [where, text] of DOCS) {
    const region = text.split('PIN-LIST-BEGIN')[1];
    assert.ok(region !== undefined, `${where} has no PIN-LIST-BEGIN sentinel, so the enumeration cannot be located`);
    const list = region.split('PIN-LIST-END')[0];
    assert.ok(list !== undefined && list.length > 0, `${where} has no PIN-LIST-END sentinel`);
    assert.ok(list.length < 2000, `${where}'s pin region is ${list.length} chars; the sentinels are not bounding an enumeration`);
    for (const f of pinned) if (!list.includes('`' + f + '`')) missing.push(`${where} omits ${f}`);
    /* 🛑 AND THE OTHER DIRECTION, WHICH WAS NOT CHECKED. A name left in a region after
       its pin is deleted from the code stayed green: the `pinned.size` floor catches a
       NET removal, but an add-plus-remove nets out and passes with a stale enumeration,
       which is exactly the "stale in all four copies" failure this arm exists to stop. */
    for (const m of list.matchAll(/`([\w.]+)`/g)) {
      if (!pinned.has(m[1])) missing.push(`${where} lists ${m[1]}, which the code does not pin`);
    }
  }
  assert.deepEqual(missing, [], `the pin enumeration has gone stale again:\n  ${missing.join('\n  ')}`);
  /* 🛑 AND NO SECOND ENUMERATION OUTSIDE THE SENTINELS. Two more copies of the pin list
     appeared in the README and the plan, in the bare-name form, each announcing itself as
     "checked by an arm" while sitting where this arm does not look. The branch went from
     four copies to SIX in the commit that claimed to make the enumeration mechanical, and
     nothing redded. A run of backticked identifiers separated by commas is what an
     enumeration looks like; one outside the region is a second copy. */
  /* ⚠️ A RUN OF BACKTICKED NAMES IS NOT ENOUGH: the categories below the pin list are
     legitimate OTHER enumerations (the structural booleans), and a bare run detector
     flagged them. What marks a DUPLICATE is that the run names the PINS. */
  const RUN = /(?:`[\w.]+`[,)]?\s*){7,}/g;
  const pinNames = new Set([...pinned].map((f) => f.split('.').pop()));
  for (const [where, text] of DOCS) {
    const outside = [text.split('PIN-LIST-BEGIN')[0], text.split('PIN-LIST-END').slice(1).join('PIN-LIST-END')];
    for (const part of outside) {
      for (const run of part.match(RUN) || []) {
        const hits = [...run.matchAll(/`([\w.]+)`/g)].filter((m) => pinNames.has(m[1].split('.').pop())).length;
        assert.ok(hits < 5,
          `${where} carries a SECOND copy of the PIN enumeration outside the sentinels, where this arm does not look (${hits} pin names in one run): ${JSON.stringify(run.slice(0, 120))}`);
      }
    }
  }
  /* CONTROL: the detector must fire on a real duplicate, or the loop above proves nothing. */
  {
    const fake = [...pinned].slice(0, 8).map((f) => '`' + f + '`, ').join('');
    const runs = fake.match(RUN) || [];
    assert.ok(runs.length === 1
      && [...runs[0].matchAll(/`([\w.]+)`/g)].filter((m) => pinNames.has(m[1].split('.').pop())).length >= 5,
      'CONTROL: the second-enumeration detector does not catch a copy of the pin list itself');
  }

  /* CONTROL: the region check must be able to report a miss. */
  const anyRegion = DOCS[0][1].split('PIN-LIST-BEGIN')[1].split('PIN-LIST-END')[0];
  assert.ok(!anyRegion.includes('`zzzNeverPinnedName`'),
    'CONTROL: the pin region matches an invented name, so includes() proves nothing');
});

test('#2519: the non-string INVENTORY outside profile is fixed, so a new producer number reds', () => {
  /* 🛑 THE ONE GAP NOTHING COULD SEE. The string guarantee is structural (scrub the whole
     card, then re-pin) and `profile` is structural on the non-string axis too. Everywhere
     else, numbers and booleans are held back only by the INDIVIDUAL pins in `context` and
     `disruption`. That is honestly documented and it was not enforced: the
     `disruption.startedAt` epoch-ms timestamp reached the recording exactly this way, and
     the key-set refusal cannot see it, because a value the producer adds inside an
     existing subtree changes no TOP-LEVEL key.
     ⇒ So the inventory is pinned. Every number and boolean the neutralised card carries
     outside `profile` is listed here. A producer that grows a new one reds this arm, and
     whoever sees the red has to decide whether it needs a pin, which is the decision that
     was never prompted before.
     ⚠️ DRIVEN THROUGH THE REAL PRODUCER via fleet.install, not read off the committed
     fixture: an arm that reads the artifact cannot notice the producer growing a field. */
  const cap = require('./tools/capture-agent-card.js');
  const fleet = require('./test-support/fleet.js');
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const out = cap.neutralise(board.card('mara'));
    const found = [];
    (function walk(v, at) {
      if (!v || typeof v !== 'object') return;
      for (const k of Object.keys(v)) {
        const path = at ? at + '.' + k : k;
        if (path === 'profile' || path.startsWith('profile.')) continue;
        const val = v[k];
        if (typeof val === 'number' || typeof val === 'boolean') found.push(path);
        else if (val && typeof val === 'object') walk(val, path);
      }
    })(out, '');
    /* 🛑 TWO DIFFERENT THINGS, AND CALLING THEM ONE WAS A FALSE CLAIM. The eleven below
       are the STRUCTURAL BOOLEANS (category 4): the producer's own values, passed
       through. `hasAvatar` is NOT one of them. It is a PIN (category 1), forced to `true`
       even when the producer said `false`, which is the one pin that deliberately
       disagrees with the captured card. An earlier version of this array listed it as the
       twelfth structural boolean under a comment calling them all pass-throughs, which
       contradicts the canonical enumeration in the README and the tool header and would
       tell a reader the real captured value survives. They are concatenated here because
       this arm cares about which non-strings REACH THE FILE, not how they got there. */
    const STRUCTURAL = [
      'nameDerived', 'isAgentPane', 'isAgentSession', 'isFleetSession', 'isNamedOurs',
      'paneless', 'stateProjectInferred', 'activeWhileWaiting', 'stateReported',
      'stateBackgroundWait', 'neverRecorded',
    ];
    const PINNED_BOOLEAN = ['hasAvatar'];
    const ALWAYS = STRUCTURAL.concat(PINNED_BOOLEAN);
    /* ⚠️ TWO INVENTORIES, BECAUSE `context` has FOUR distinct key sets in status.js, counted rather than asserted: the NONE_BASE family (ELEVEN objects share that one key set, derived by the arm; an earlier version said six by counting only readContext and missing readCodexContext and the two inline card literals), neverRecordedResult (adds `neverRecorded`), measuredResult (adds `overCeiling`, `ceiling`, `ceilingAssumed`) and noCeilingResult (adds `ceiling`, `ceilingSource`, `noCeiling`) (an earlier version said FIVE) AND THE TWO
       CARDS HERE ARE DIFFERENT ONES. The fleet agent has no transcript, so its context is
       the no-reading shape; the committed recording was captured from an agent with a
       measured context. A single expected list would have been wrong for one of them, and
       the first version of this arm guessed one list and redded on its first run, which
       is how the difference got noticed. */
    const EXPECTED_LIVE = ALWAYS.concat(['context.neverRecorded', 'context.notYet']).sort();
    const EXPECTED_FIXTURE = ALWAYS.concat([
      'context.ceiling', 'context.ceilingAssumed', 'context.notYet', 'context.overCeiling',
      'context.percent', 'context.tokens',
    ]).sort();
    assert.ok(found.length >= 10, `CONTROL: the walk found only ${found.length} non-strings; it is not traversing the card`);
    const WHY = 'the set of numbers and booleans that reach a committed file outside `profile` has CHANGED. '
      + 'If the producer added a field, decide whether it is identifying and needs a pin '
      + '(that is how disruption.startedAt got in); if a pin was removed, that is a leak.';
    assert.deepEqual(found.sort(), EXPECTED_LIVE, 'LIVE CARD: ' + WHY);
    /* AND THE SHIPPED ARTIFACT, which is the thing an operator can actually read. */
    const committed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    const inFixture = [];
    (function walk(v, at) {
      if (!v || typeof v !== 'object') return;
      for (const k of Object.keys(v)) {
        const path = at ? at + '.' + k : k;
        if (path === 'profile' || path.startsWith('profile.')) continue;
        const val = v[k];
        if (typeof val === 'number' || typeof val === 'boolean') inFixture.push(path);
        else if (val && typeof val === 'object') walk(val, path);
      }
    })(committed, '');
    assert.deepEqual(inFixture.sort(), EXPECTED_FIXTURE,
      'COMMITTED FIXTURE: ' + WHY + ' If you just re-captured, the chosen card may have had an unmeasured context; see the re-capture constraint in docs/browser-checks/README.md');

    /* 🛑 AND THE ONE SUBTREE THIS ARM'S OWN RATIONALE IS BUILT ON, WHICH IT COULD NOT SEE.
       Both cards above carry `disruption: null`, and the walk does not descend a null, so
       nothing under `disruption` ever reached `found`. The comment cites
       `disruption.startedAt` as the field that got in exactly this way and promised a red
       for the next one, and a SECOND disruption number redded nothing.
       ⚠️ MEASURED before this block: a card with
       `disruption: {cause, startedAt, timedOut, pid: 48213, host}` came out of neutralise
       with `pid: 48213` VERBATIM, and `keySet(out) === keySet(poisoned)` stayed true, so
       the key-set refusal cannot see it either.
       ⇒ The subtree is driven explicitly, because a card that HAS a disruption is a state
       neither of the two cards above is ever in. */
    const withDisruption = Object.assign({}, board.card('mara'));
    withDisruption.disruption = { cause: 'restart', startedAt: 1757000123456, timedOut: false };
    const dOut = cap.neutralise(withDisruption);
    const dFound = [];
    (function walk(v, at) {
      if (!v || typeof v !== 'object') return;
      for (const k of Object.keys(v)) {
        const path = at ? at + '.' + k : k;
        const val = v[k];
        if (typeof val === 'number' || typeof val === 'boolean') dFound.push(path);
        else if (val && typeof val === 'object') walk(val, path);
      }
    })(dOut.disruption, 'disruption');
    assert.deepEqual(dFound.sort(), ['disruption.startedAt', 'disruption.timedOut'],
      'DISRUPTION SUBTREE: ' + WHY);
    assert.equal(dOut.disruption.startedAt, 1757000000000,
      'the producer disruption timestamp reached the recording');
  } finally {
    board.restore();
  }
});

test('#2519: NOTHING under profile survives, on the non-string axis either', () => {
  /* 🛑 THE THIRD CATEGORY THE TOOL'S OWN INVARIANT SAID COULD NOT EXIST. That sentence
     read "every non-string the producer supplies is either pinned or is a documented
     exposure", and `profile` is FREE-FORM: store.readProfile returns whatever JSON is in
     the file, so the tree writes numbers into it that no pin names.
     `profile.doctrineVersion` is a producer NUMBER (create.js:3651 from
     defaults.DOCTRINE_VERSION, again at doctrine.js:209) and `doctrineDeclined` sits
     beside it. Not identity-bearing, but unpinned and undocumented, so a re-capture on
     almost any real agent was not byte-identical, which four documents claimed until all
     four were corrected.
     ⚠️ AND THE FIX HAD TO BE STRUCTURAL, NOT TWO MORE PINS. An allowlist over a
     free-form subtree is a guarantee resting on what the tree happens to write today,
     which is the exact failure this file is a record of. */
  const cap = require('./tools/capture-agent-card.js');
  const fleet = require('./test-support/fleet.js');
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const real = board.card('mara');
    const poisoned = Object.assign({}, real);
    poisoned.profile = {
      doctrineVersion: 9,
      doctrineDeclined: 9,
      port: 16180,
      onCall: true,
      dir: '/Users/realoperator/work/secret-repo',
      nested: { pid: 48213, since: 1757000123456, note: 'private' },
    };
    const out = cap.neutralise(poisoned);
    const found = [];
    (function walk(v, at) {
      if (!v || typeof v !== 'object') return;
      for (const k of Object.keys(v)) {
        const val = v[k];
        if (typeof val === 'object' && val !== null) walk(val, at + k + '.');
        else found.push([at + k, val]);
      }
    })(out.profile, '');
    for (const [where, val] of found) {
      if (typeof val === 'number') {
        assert.equal(val, 0, `profile.${where} kept a producer number: ${val}`);
      } else if (typeof val === 'boolean') {
        assert.equal(val, false, `profile.${where} kept a producer boolean`);
      } else if (typeof val === 'string') {
        assert.ok(!val.includes('/'), `profile.${where} carries a path: ${val}`);
      }
    }
    /* TYPES SURVIVE, VALUES DO NOT. A number that became a string would be a different
       defect wearing this fix's clothes. */
    assert.equal(typeof out.profile.doctrineVersion, 'number');
    assert.equal(typeof out.profile.onCall, 'boolean');
    assert.equal(typeof out.profile.nested.pid, 'number');
    /* CONTROL: the poisoned values must actually differ from the scrubbed ones, or this
       arm would pass on a producer that happened to emit zeros. */
    assert.notEqual(poisoned.profile.nested.pid, 0, 'CONTROL: the input pid was already 0');
  } finally {
    board.restore();
  }
});

test('#2519: a disruption timestamp does not reach the recording, and the key set is checked', () => {
  /* 🛑 AN EPOCH-MS MACHINE TIMESTAMP ON THE NON-STRING AXIS. scrubStrings only touches
     strings, so `disruption.cause` was neutralised while `disruption.startedAt` came out
     verbatim (status.js:5431 emits {cause, startedAt, timedOut}). It is reachable rather
     than theoretical: a restarting card carries CONFIDENCE.STRUCTURED, so chooseCard
     PREFERS it. `disruption` is null in today's fixture, which is the only reason this
     was an exposure rather than a leak, and a comment concluding "nothing identifying is
     numeric today" is exactly what would have stopped the next person looking.
     ⚠️ THE COMPARATOR IS DRIVEN HERE. THE REFUSAL IS NOT, AND THE DIFFERENCE MATTERS.
     `keySet` is exported and exercised below; the refusal that uses it
     (`if (before !== after) { console.error(...); process.exit(1); }`) is still inside
     the tool's `require.main` block and is still a guard nothing runs. Exporting the
     comparator made the refusal TESTABLE, not TESTED, and an earlier version of this
     comment claimed the latter. The paneless refusal, by contrast, genuinely is driven.
     It is load-bearing: several pins would ADD a key on a producer that lacks one, which
     is what it exists to catch. */
  const cap = require('./tools/capture-agent-card.js');
  const fleet = require('./test-support/fleet.js');
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const real = board.card('mara');
    const poisoned = Object.assign({}, real);
    poisoned.disruption = { cause: 'restart', startedAt: 1757000123456, timedOut: false };
    const out = cap.neutralise(poisoned);
    assert.notEqual(out.disruption.startedAt, 1757000123456,
      'the producer disruption timestamp reached the recording verbatim');
    assert.equal(typeof out.disruption.startedAt, 'number', 'startedAt lost its type');
    assert.ok(!String(out.disruption.cause).includes('restart'), 'the cause was not scrubbed');
    assert.equal(out.disruption.timedOut, false, 'a non-string sibling was altered');
    /* THE KEY SET, both arms. A neutralisation that ADDS or DROPS a top-level key must be
       visible to the refusal, or the tool writes a shape the producer never made. */
    assert.equal(cap.keySet(out), cap.keySet(poisoned), 'neutralise changed the top-level key set');
    const extra = Object.assign({}, poisoned);
    extra.somethingNew = 1;
    assert.notEqual(cap.keySet(extra), cap.keySet(poisoned),
      'CONTROL: keySet cannot tell two different key sets apart, so the refusal is blind');
  } finally {
    board.restore();
  }
});

test('#2519: the top-level `because` follows `state`, so the recording cannot contradict itself', () => {
  /* 🛑 THE SAME DEFECT AS context.confidence, ONE LEVEL UP, AND IT SURVIVED THAT FIX.
     `state` is re-pinned from the RAW card while `because` was pinned to 'it is mid-task'
     unconditionally, so a re-capture whose chosen card was idle committed `state: "idle"`
     beside `because: "it is mid-task"`, which status.js cannot emit. Reachable: chooseCard
     prefers `stateConfidence !== 'none'`, which an idle card satisfies.
     The argument that fixed `context` was never carried to the top level, and the
     mutation that removes the idle pin redded nothing until this arm existed. */
  const cap = require('./tools/capture-agent-card.js');
  const fleet = require('./test-support/fleet.js');
  /* 🛑 EVERY STATE THE ENUM ADMITS, DRIVEN FROM THE ENUM. This arm used to drive THREE of
     nine while its title claimed the general property, and a `blocked` re-capture landed
     SILENTLY GREEN: the rename control only checks `state !== 'needs_you'`, the context arm
     only checks `confidence`, and a blocked card's `stateEvidence` is null so the identity
     arm passed too. Nothing on the branch would have noticed.
     ⇒ The map is keyed by the producer's own vocabulary and an assertion below fails if a
     state is added to status.js without a pairing here, so the gap cannot silently reopen.
     Two pairings depend on `stateReported` and one on `runner`, which is why the value is
     a function of the card rather than a constant per state. */
  const SENTENCE = {
    /* ⚠️ FOUR OF THESE ARE FUNCTIONS OF THE CARD, NOT TWO. An earlier version made `idle`
       and `stopped` card-dependent and left `working` and `unknown` as constants, so this
       arm POSITIVELY CERTIFIED two contradictions and was a BARRIER to fixing them: the
       tool's correction redded this file first. That is the standard this suite states
       elsewhere, "a test that pins a defect in place is worse than no test", failing here.
       The reported-working card is the likeliest capture on a healthy box, because it is
       STRUCTURED and chooseCard prefers that. */
    working: (c) => (c.stateReported === true ? 'it says it is working' : 'it is mid-task'),
    idle: (c) => (c.stateReported === true ? 'it is at rest and nothing is needed' : 'it is sitting at its prompt'),
    needs_you: () => 'it is asking you something',
    stopped: (c) => (c.stateReported === true ? 'it said it was stopping' : 'Claude is not running for this one'),
    restarting: () => 'we are restarting this agent, so it is briefly out of view',
    rate_limited: () => 'its screen mentions a usage limit',
    auth_failed: (c) => (c.runner === 'codex' ? 'its OpenAI sign-in is not working' : 'its Claude sign-in is not working'),
    blocked: () => 'it is waiting on something that is not you',
    unknown: (c) => (c.stateReported === true
      ? 'it said it was working and has not said anything since; we could not check'
      : 'we could not tell what it is doing'),
  };
  assert.deepEqual(Object.keys(SENTENCE).sort(), cap.ENUMS.state.slice().sort(),
    'a state was added to the producer with no `because` pairing, so a capture of it would carry a sentence status.js does not emit');
  const PAIRS = cap.ENUMS.state.map((st) => [st, SENTENCE[st]]);
  const board0 = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  let template;
  try { template = board0.card('mara'); } finally { board0.restore(); }
  for (const [state, sentenceFor] of PAIRS) {
    /* Both `stateReported` arms for the two states whose sentence depends on it. */
    for (const reported of [false, true]) {
      const poisoned = Object.assign({}, template);
      poisoned.state = state;
      poisoned.stateReported = reported;
      poisoned.because = 'SECRET:/Users/realoperator/private.txt';
      const out = cap.neutralise(poisoned);
      assert.equal(out.state, state, `CONTROL: the card under test is not in state ${state}`);
      assert.ok(!String(out.because).includes('/'),
        `state ${state} kept the poisoned because verbatim`);
      assert.equal(out.because, sentenceFor(poisoned),
        `state ${state} (stateReported ${reported}) was recorded beside a because status.js does not pair with it`);
    }
  }
  /* The runner arm, which only auth_failed depends on. */
  for (const runner of ['claude', 'codex']) {
    const c = Object.assign({}, template);
    c.state = 'auth_failed';
    c.runner = runner;
    c.because = 'SECRET:/Users/realoperator/private.txt';
    assert.equal(cap.neutralise(c).because, SENTENCE.auth_failed(c),
      `an auth_failed ${runner} card was given the other provider's sentence`);
  }
  /* AND stateEvidence: a "Working" line beside a non-working state is a contradiction. */
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const idle = Object.assign({}, board.card('mara'));
    idle.state = 'idle';
    idle.stateEvidence = 'some scraped pane text';
    assert.ok(!/Working/.test(String(cap.neutralise(idle).stateEvidence)),
      'an idle card was recorded with a Working evidence line');
    const working = Object.assign({}, board.card('mara'));
    working.state = 'working';
    working.stateEvidence = 'some scraped pane text';
    assert.match(String(cap.neutralise(working).stateEvidence), /Working/,
      'CONTROL: the working evidence pin stopped firing, so the check above proves nothing');
  } finally {
    board.restore();
  }
});

test('#2519: context.confidence and context.because are values the PRODUCER can emit', () => {
  /* 🛑 THE FIXTURE CARRIED AN IMPOSSIBLE CARD in the subtree whose numbers had just been
     made coherent. scrubStrings left `example-confidence` and `example-because`, and
     status.js bounds confidence to structured|scraped|none (CONFIDENCE, status.js:239)
     while because comes from a fixed set of sentences. The pinned numbers are exactly
     measuredResult(82646, 1000000, assumed=true) (status.js:4299), whose siblings are
     STRUCTURED and "measured, against a limit we have assumed rather than watched", so
     the block is now one coherent producer output rather than six pinned numbers beside
     two invented strings.
     ⚠️ Constants, NOT a re-pin from the raw card: `because` is not enum-bounded. */
  const cap = require('./tools/capture-agent-card.js');
  const fleet = require('./test-support/fleet.js');
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const real = board.card('mara');
    const poisoned = Object.assign({}, real);
    poisoned.context = Object.assign({}, real.context);
    poisoned.context.confidence = 'SECRET:/Users/realoperator/private.txt';
    poisoned.context.because = 'SECRET:/Users/realoperator/private.txt';
    /* 🛑 BOTH CONTEXT SHAPES, BECAUSE THE PAIR FOLLOWS THE NUMBERS. Pinning the MEASURED
       pair unconditionally produced a card status.js cannot emit: `confidence: 'structured'`
       beside `tokens: null`. The fleet agent has no transcript, so the card this arm drives
       is the UNMEASURED shape, and the first version of this arm asserted the measured pair
       on it and went red the moment the tool was corrected. Both are driven now. */
    poisoned.context.tokens = null;
    poisoned.context.percent = null;
    const unmeasured = cap.neutralise(poisoned);
    assert.equal(unmeasured.context.confidence, 'none',
      'an unmeasured context was recorded as structured, which status.js cannot emit beside a null tokens');
    /* 🛑 THE UNMEASURED SHAPE SPLITS ON `neverRecorded`, and the first version of this
       assertion demanded the NO_TRANSCRIPT sentence on a card the fleet produces with
       `neverRecorded: true`, whose producer sentence is different. The arm is titled
       "values the PRODUCER can emit" and was asserting one it cannot. */
    const expectUnmeasured = unmeasured.context.neverRecorded === true
      ? 'made before Kosmos recorded this, so there is no record to read'
      : 'we cannot find a transcript for it';
    assert.equal(unmeasured.context.because, expectUnmeasured);
    /* BOTH ARMS, so neither sentence rests on which shape the fleet happens to make. */
    for (const never of [true, false]) {
      const c = Object.assign({}, poisoned);
      c.context = Object.assign({}, poisoned.context, { tokens: null, percent: null, neverRecorded: never });
      const out2 = cap.neutralise(c);
      assert.equal(out2.context.because, never
        ? 'made before Kosmos recorded this, so there is no record to read'
        : 'we cannot find a transcript for it',
        `an unmeasured context with neverRecorded ${never} got the other shape's sentence`);
    }
    /* 🛑 THE THIRD SHAPE, WHICH THE FIRST VERSION OF THIS ARM DID NOT KNOW EXISTED.
       status.js has FOUR context result shapes, not two and not three: an earlier version of this comment said THREE and missed neverRecordedResult: measuredResult, NONE_BASE, and
       `noCeilingResult` (status.js:4314), reached whenever limitFor(model) returns null
       for a model not yet in the limit tables. It sets a real NUMERIC tokens with
       `percent: null`, `ceiling: null`, `noCeiling: true` and CONFIDENCE.STRUCTURED.
       The two-shape `measured` predicate required BOTH numbers, so it filed this as
       unmeasured and wrote `confidence: 'none'` beside a non-null tokens. Every
       CONFIDENCE.NONE result in status.js pairs with `tokens: null`, so that is a pairing
       the producer can never emit, introduced by the commit that fixed the two-shape
       version of the same defect. */
    const noCeiling = Object.assign({}, poisoned);
    noCeiling.context = Object.assign({}, poisoned.context, {
      tokens: 9001, percent: null, ceiling: null, noCeiling: true,
    });
    const ncOut = cap.neutralise(noCeiling);
    assert.equal(ncOut.context.confidence, 'structured',
      'a READ context with no known ceiling was recorded as confidence none beside a non-null tokens, which status.js never emits');
    assert.match(ncOut.context.because, /^measured, but we do not know how much /,
      'the no-ceiling context was given a because that does not pair with it');
    assert.equal(typeof ncOut.context.tokens, 'number', 'the no-ceiling tokens lost its type');
    /* CONTROL: the pairing must be checkable, i.e. an unmeasured card still gets none. */
    assert.equal(unmeasured.context.confidence, 'none',
      'CONTROL: every shape now reports structured, so the assertion above proves nothing');

    const measuredIn = Object.assign({}, poisoned);
    measuredIn.context = Object.assign({}, poisoned.context, { tokens: 4321, percent: 3 });
    const out = cap.neutralise(measuredIn);
    assert.equal(out.context.confidence, 'structured', 'context.confidence is not a producer value');
    assert.equal(out.context.because, 'measured, against a limit we have assumed rather than watched');
    /* AND THE COMMITTED RECORDING MUST AGREE, or the tool was corrected and the fixture
       left behind, which is this branch's most repeated shape. */
    const committed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    assert.equal(committed.context.confidence, 'structured',
      'the COMMITTED recording is not a measured capture. If you just re-captured, the tool picked an agent whose transcript could not be read; see the re-capture constraint in docs/browser-checks/README.md');
    assert.equal(committed.context.because, out.context.because);
  } finally {
    board.restore();
  }
});

test('#2519: the WHOLE context block is pinned, so the recording cannot contradict itself', () => {
  /* 🛑 `ceiling` WAS THE LAST PRODUCER VALUE IN context AND NOTHING ASSERTED IT. tokens
     and percent were pinned and covered; ceiling and the three booleans derived from it
     passed through as captured. That is not a leak (a ceiling is not identifying) but it
     is an INCONSISTENCY: `model` is pinned to a constant, so a re-capture on a box
     running a different model would commit a card whose model says one thing and whose
     ceiling was computed for another, and nothing reading the fixture could tell which
     half was the recording.
     ⚠️ ASSERTED ON A POISONED CARD, not on the committed fixture. The fixture already
     holds these values, so reading it would prove nothing about the tool that wrote it
     -- the exact trap the id arm below documents. */
  const cap = require('./tools/capture-agent-card.js');
  const fleet = require('./test-support/fleet.js');
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const real = board.card('mara');
    const poisoned = Object.assign({}, real);
    poisoned.context = Object.assign({}, real.context);
    poisoned.context.ceiling = 200000;
    poisoned.context.ceilingAssumed = false;
    poisoned.context.overCeiling = true;
    poisoned.context.notYet = true;
    const out = cap.neutralise(poisoned);
    assert.equal(out.context.ceiling, 1000000, 'the captured ceiling reached the recording');
    assert.equal(out.context.ceilingAssumed, true, 'ceilingAssumed was not pinned');
    assert.equal(out.context.overCeiling, false, 'overCeiling was not pinned');
    assert.equal(out.context.notYet, false, 'notYet was not pinned');
    /* CONTROL: a producer null must still survive, or "pinned" has quietly become
       "invented", which is the defect the arm below exists for. */
    const nulled = Object.assign({}, real);
    nulled.context = Object.assign({}, real.context);
    nulled.context.ceiling = null;
    assert.equal(cap.neutralise(nulled).context.ceiling, null,
      'a null ceiling was invented into a number');
  } finally {
    board.restore();
  }
});

test('#2519: the capture writes NULL where the producer wrote null, on the PINNED fields too', () => {
  /* 🛑 THE ARM ABOVE COVERS ONLY THE CONDITIONAL PINS (role, task, stateEvidence,
     stateProject, stateConflict), so it could not see that `session`, `sessionName`,
     `name`, `target`, `model` and `modelName` were assigned UNCONDITIONALLY. Those six
     wrote a string wherever the producer wrote null, contradicting the type-preservation
     sentence that appears in four places on this branch.
     ⚠️ AND `model` IS NOT HYPOTHETICAL. status.js's readModel() returns `{model: null}`
     on three paths -- no transcript file, an empty tail read, and no non-synthetic match
     in the last 64KB -- and status.js:6239 binds `model: null` outright for an untied
     pane. A tied agent whose transcript cannot be read is an ordinary card, and before
     this arm the recording could not represent it. */
  const cap = require('./tools/capture-agent-card.js');
  const fleet = require('./test-support/fleet.js');
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const real = board.card('mara');
    /* ⚠️ BUILT BY MUTATING A REAL CARD, NOT BY WRITING ONE. An override literal listing
       session/sessionName/name/target reads as a hand-built card to fixture-discipline's
       lint, which flagged the first version of this arm and was right to: a literal here
       would pin MY idea of the shape rather than the producer's. */
    const UNCONDITIONAL = ['session', 'sessionName', 'name', 'target', 'model', 'modelName'];
    const nulled = Object.assign({}, real);
    for (const f of UNCONDITIONAL) nulled[f] = null;
    const out = cap.neutralise(nulled);
    for (const f of UNCONDITIONAL) {
      assert.equal(out[f], null, `${f} was invented where the producer emitted null`);
    }
    /* ⚠️ hasAvatar IS ONE OF FOUR DELIBERATE OVERRIDES (with ceilingAssumed, overCeiling
       notYet and disruption.timedOut) AND THE ARM SAYS SO. The count in this sentence has
       been wrong twice: "THE deliberate exception", singular, named one of four; the
       correction to four missed the fifth, added in the same commit that wrote it. A producer `false`
       becomes `true`, so this pin can DISAGREE with the captured card rather than merely
       stabilise it. That is intended: status.js emits `Boolean(safeAvatar(key))`, which
       depends on whether an avatar file happens to exist for that agent on that box, so
       recording it faithfully would make the fixture differ between machines and would
       leave the avatar path in openDetail unexercised. `true` is a value the producer
       emits, so the recording stays possible; it is a volatility pin like tokens and
       ceiling, not a type violation. The first version of this assertion demanded
       `false` survive and FAILED, which is how the distinction got written down. */
    const noAvatar = Object.assign({}, real);
    noAvatar.hasAvatar = false;
    assert.equal(cap.neutralise(noAvatar).hasAvatar, true,
      'hasAvatar is no longer pinned, so a re-capture differs by whether an avatar file exists');
    assert.equal(typeof cap.neutralise(noAvatar).hasAvatar, 'boolean', 'hasAvatar lost its type');
    /* CONTROL: the pins must still fire on a string, or "preserves null" is just a
       neutralisation that stopped working. */
    const poisoned = Object.assign({}, real);
    poisoned.name = 'Real Person';
    poisoned.model = '/Users/realoperator/secret';
    poisoned.modelName = '/Users/realoperator/secret';
    const pinned = cap.neutralise(poisoned);
    assert.equal(pinned.name, 'April', 'the name pin stopped firing on a string');
    assert.equal(pinned.model, 'claude-opus-5', 'the model pin stopped firing on a string');
    assert.equal(pinned.modelName, 'Claude Opus 5', 'the modelName pin stopped firing on a string');
  } finally {
    board.restore();
  }
});

test('#2519: the capture tool does its I/O ONLY when run directly', () => {
  /* 🛑 A GUARD NOTHING RAN, WHICH IS THIS BRANCH'S OWN NAMED DEFECT. This suite
     `require()`s the capture tool to drive its pure half. Without the
     `require.main === module` guard, every `yarn test` run would call the real
     status.snapshot() -- the AGENT_WORKFORCE_* sandbox controls the data and workers
     roots, NOT tmux, so it would read the operator's live board -- and overwrite the
     committed, release-gating fixture. Silently: a re-capture looks exactly like a
     legitimate re-capture.
     ⚠️ ASSERTED TWO WAYS, because the source match alone would pass on a guard that had
     been moved below the write. The mtime arm is the one that measures the behaviour. */
  const src = fs.readFileSync(path.join(__dirname, 'tools', 'capture-agent-card.js'), 'utf8');
  assert.match(src, /if \(require\.main === module\)/, 'the I/O guard is gone from the capture tool');
  /* 🛑 BOTH HALVES OF "ONLY WHEN RUN DIRECTLY", AND THEY ARE CHECKED DIFFERENTLY ON
     PURPOSE. The runtime half below proves the tool does NOT write when required. This
     half proves the write is reachable when it IS run directly, and it is a SOURCE check
     rather than an execution, because executing it is the destructive path: the tool
     reads this box's live board and writes real identity over the committed,
     release-gating fixture. That accident has happened once on this branch. A test that
     runs in every `yarn test` must not carry a window where the artifact holds live data
     and only a restore puts it back.
     ⇒ So: the write must live INSIDE the guard block and nowhere before it. A guard
     moved below the write, which is the failure the runtime half also targets, fails here
     too, and this half needs no process to prove it. */
  const guardAt = src.indexOf('if (require.main === module) {');
  const writeAt = src.indexOf('fs.writeFileSync(OUT');
  assert.ok(writeAt !== -1, 'CONTROL: the fixture write was not found at all, so its position proves nothing');
  assert.ok(guardAt !== -1 && writeAt > guardAt,
    'the fixture write is not inside the require.main guard, so requiring the tool would overwrite the recording');
  assert.equal(src.slice(0, guardAt).indexOf('fs.writeFileSync(OUT'), -1,
    'there is a second fixture write ABOVE the guard, which no require-time check would catch');
  /* 🛑 THE BYTES ARE HELD BEFORE THE REQUIRE, AND THAT IS NOT BELT-AND-BRACES. In the
     exact failure this arm exists to catch -- a guard MOVED BELOW the write, which the
     source match above passes -- the `require` on the next line executes the I/O against
     the operator's real tmux board and overwrites the committed, release-gating fixture
     with live identity. An mtime assertion reports that afterwards, on a file already
     destroyed. Holding the bytes turns the detection into a detection AND a repair, so
     the arm can no longer be the thing that does the damage. */
  const beforeBytes = fs.readFileSync(FIXTURE);
  const before = fs.statSync(FIXTURE).mtimeMs;
  /* 🛑 IN A CHILD PROCESS, AND THE REASON IS NOT TIDINESS. Requiring the tool HERE runs
     its I/O half in this process if the guard is broken, and that half calls
     `process.exit(1)` when the box has no pane card of ours: the suite would die mid-arm,
     before the restore below, reporting a plausible tally with the fixture already
     overwritten. Two failure modes, one of which destroys the evidence of the other.
     ⇒ The child absorbs both. Its exit code is data, not our fate, and the bytes are held
     here so a broken guard is detected AND repaired rather than merely reported on a file
     that is already gone. */
  const child = require('node:child_process').spawnSync(
    process.execPath, ['-e', 'require(process.argv[1])', path.join(__dirname, 'tools', 'capture-agent-card.js')],
    { cwd: __dirname, encoding: 'utf8', timeout: 30000 },
  );
  const afterBytes = fs.readFileSync(FIXTURE);
  if (!afterBytes.equals(beforeBytes)) fs.writeFileSync(FIXTURE, beforeBytes);
  assert.ok(afterBytes.equals(beforeBytes),
    `requiring the capture tool rewrote the committed fixture (restored here, but the I/O guard is broken); child said: ${(child.stdout || '') + (child.stderr || '')}`);
  assert.equal(fs.statSync(FIXTURE).mtimeMs, before,
    'requiring the capture tool touched the committed fixture');
  /* CONTROL: the child must actually have run, or "the fixture is unchanged" is what you
     get from a spawn that never started. */
  assert.equal(child.status, 0, `the child did not run cleanly: ${child.error || child.stderr}`);
});

test('#2519: an id is scrubbed to a CONSTANT, so not even its length survives', () => {
  /* 🛑 THE FIXTURE ARM ABOVE CANNOT SEE THIS AND I PROVED IT BY MUTATION. It asserts
     `/^0+$/` against the COMMITTED FILE, which is already scrubbed, so making
     scrubStrings pass `id` through raw left the whole suite green -- an arm that reads
     the artifact cannot test the producer that wrote it.
     ⚠️ AND THE ORIGINAL DEFECT WAS NOT THE RAW VALUE. `id` was scrubbed as
     `'0'.repeat(val.length)`: the value was gone but its LENGTH was re-emitted, and for
     today's twelve-character profile ids that output is indistinguishable from a
     constant, which is why reading it never raised the question. So this arm feeds an id
     of a DIFFERENT length: a length-preserving scrub gives back that length and fails
     here, and only a constant passes. */
  const cap = require('./tools/capture-agent-card.js');
  const long = 'operator-private-identifier-9f3c2a';
  const profile = { id: long, idInstall: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };
  cap.scrubStrings(profile);
  assert.ok(!profile.id.includes('operator'), `a raw id survived: ${profile.id}`);
  assert.match(profile.id, /^0+$/, `id is not the zero placeholder: ${profile.id}`);
  assert.notEqual(profile.id.length, long.length,
    'the id placeholder is as long as the real id, so the scrub re-emits the value length');
  assert.match(profile.idInstall, /^0{8}-0{4}-4000-8000-0{12}$/);
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

test('#2519: model and modelName are PINNED, because the producer does not bound them', () => {
  /* 🛑 status.js's readModel() regex-extracts from the last 64KB of the agent's TRANSCRIPT
     and modelDisplayName() returns an unrecognised id RAW, so any `"model":"..."` text in
     a transcript becomes this value. Re-pinning them from the raw producer was the THIRD
     instance of the same hole on this branch. Measured before the fix: a model of
     '/Users/realoperator/secret' reached the output verbatim. */
  const cap = require('./tools/capture-agent-card.js');
  const fleet = require('./test-support/fleet.js');
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const real = board.card('mara');
    const out = cap.neutralise(Object.assign({}, real, {
      model: '/Users/realoperator/secret', modelName: '/Users/realoperator/secret',
    }));
    assert.ok(!String(out.model).includes('/'), `model reached the fixture verbatim: ${out.model}`);
    assert.ok(!String(out.modelName).includes('/'), `modelName reached the fixture verbatim: ${out.modelName}`);
  } finally {
    board.restore();
  }
});

test('#2519: a STRING field the producer adds later is scrubbed, not passed through', () => {
  /* ⚠️ THE NAME SAID "a field", AND THE ARM COVERS THE STRING AXIS ONLY. A later-added
     number reaches the output verbatim outside `profile`, which is category (2) in the
     tool's header: documented, deliberate, and not what this arm measures. A test name
     broader than its assertion reads as coverage of the gap it leaves. */
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
    /* 🛑 THE OTHER TWO FILTERS WERE MUTATION-SURVIVABLE and one of them is the security
       one. With a single pane card in the list, `find(evidence) || paneOurs[0]` returns
       the same card either way, so replacing the whole expression with `paneOurs[0]` left
       every arm green; and `isNamedOurs === true` was never exercised with a card that is
       NOT ours, which is the filter that stops this tool recording a stranger's pane.
       Both need a list that can discriminate. */
    const noEvidence = Object.assign({}, real, { paneless: false, session: 'pane-none', stateConfidence: 'none' });
    const withEvidence = Object.assign({}, real, { paneless: false, session: 'pane-structured', stateConfidence: 'structured' });
    assert.equal(cap.chooseCard([noEvidence, withEvidence]).chosen.session, 'pane-structured',
      'the first pane card won over the one with real evidence');
    assert.equal(cap.chooseCard([noEvidence]).chosen.session, 'pane-none',
      'a board with only evidence-free cards should still yield one, not nothing');
    const stranger = Object.assign({}, real, { paneless: false, session: 'not-ours', isNamedOurs: false });
    assert.equal(cap.chooseCard([stranger]).chosen, null,
      'the tool selected a pane card that is NOT ours, which would record a stranger');
    assert.equal(cap.chooseCard([stranger, pane]).chosen.session, 'pane-one');
  } finally {
    board.restore();
  }
});

/* The gap this arm records is tracked as kosmos#2553; the escape hatch below exists so
   that fix is not locked out by this pin. */
test('#2519: the check has NO live-vs-fixture drift guard, deliberately', () => {
  /* 🛑 THIS ARM PINS A REMOVAL, and the reason matters more than the code. An earlier
     version of this branch compared the live card's nested key paths against the
     recording inside render-talk.js and pushed a PROBLEM on any difference. It fired on
     ordinary board composition, not drift.
     MEASURED on an 18-agent board: TWO distinct `profile` shapes among our pane cards,
     17 carrying id/idInstall/instructionsWrite/updatedAt and ONE empty, because
     store.readProfile() returns {} for an agent with no profile file. `profile` is a
     free-form operator record and `context` has FOUR distinct key sets in status.js, counted rather than asserted: the NONE_BASE family (ELEVEN objects share that one key set, derived by the arm; an earlier version said six by counting only readContext and missing readCodexContext and the two inline card literals), neverRecordedResult (adds `neverRecorded`), measuredResult (adds `overCeiling`, `ceiling`, `ceilingAssumed`) and noCeilingResult (adds `ceiling`, `ceilingSource`, `noCeiling`) (an earlier version said FIVE) depending on
     that agent's transcript and ceiling, so no two cards are guaranteed to share a
     nested shape.
     ⚠️ And WHICH card was compared was arbitrary: liveCard() takes the first pane card
     tmux lists while the capture prefers one with real evidence, so whether a release
     cut went red depended on pane ordering, and "re-capture it" would only have moved
     which card failed.
     ⇒ The anti-rot check is the TOP-LEVEL comparison in this file instead, where a
     false red costs a test run rather than a release. If you are about to re-add a
     nested guard to the check, measure the profile shapes on a real board first. */
  /* 🛑 THE HATCH GATES THIS ASSERTION TOO, and leaving it off was a barrier. The phrase
     banned here is the wording this file's own re-capture instruction uses ("the recorded
     card has drifted from status.snapshot(); re-capture with ..."), so a
     composition-aware guard written with the natural message would have redded the very
     fix this branch says is still owed -- while the failure text sent the reader to an
     escape hatch that did not apply to it. */
  assert.ok(!/has drifted from status\.snapshot/.test(SRC) || /COMPOSITION-AWARE DRIFT GUARD/.test(SRC),
    'a live-vs-fixture drift guard is back in the check without declaring itself composition-aware');
  /* ⚠️ Matched on the FAILURE TEXT and the recursion shape, not on one identifier: a
     re-added guard written with different variable names would slip past a name pin, and
     this tree calls that out as an anti-pattern. */
  /* Matched on what a real guard DOES -- push a problem whose text says drift -- rather
     than on an identifier a rewrite would change, or on prose. An earlier version matched
     the words "drifted|re-capture" anywhere after the reopen arm and caught this file's
     OWN explanation of the removal. */
  /* ⚠️ THIS PIN MUST NOT BECOME A BARRIER. The branch states nested drift is a real gap
     that wants a COMPOSITION-AWARE comparison, and a blunt pin would red the very fix it
     asks for: a test you must delete to close a known defect is a lock, not a guard.
     So the escape hatch is explicit: a guard that declares it handles composition passes.
     If you are adding one, put the marker on it and this arm gets out of your way. */
  const src = SRC;
  /* ⚠️ THE MESSAGE USED TO CLAIM MORE THAN THE REGEX MATCHES. It said it detects "a
     live-vs-fixture drift comparison back in the check", while the pattern only catches a
     `problems.push` whose text contains drift or re-capture: a guard worded "the recorded
     card no longer matches the live one" walked straight past it. The vocabulary is
     widened here to the phrasings a re-added guard would plausibly use, and the message
     is narrowed to say what is actually matched, because a pin that overstates its reach
     is how the next one gets past it. This cannot be made complete; it is a tripwire on
     the likely wordings, not a proof. */
  const DRIFT_WORDS = /problems\.push\([^)]*(drift|re-capture|no longer matches|does not match|differs from)/i;
  const pushesDrift = DRIFT_WORDS.test(src);
  const declaresCompositionAware = /COMPOSITION-AWARE DRIFT GUARD/.test(src);
  assert.ok(!pushesDrift || declaresCompositionAware,
    'the check pushes a problem worded like a live-vs-fixture comparison (drift / re-capture / no longer matches / does not match / differs from) without declaring itself composition-aware');
  /* CONTROL: the tripwire must be able to fire, or "no drift guard" is being certified by
     a pattern that matches nothing. */
  assert.ok(DRIFT_WORDS.test("problems.push(`[x] reopen: the recorded card no longer matches the live one`)"),
    'CONTROL: the drift vocabulary does not match a plausible re-added guard');
});

/* #2553: nested CONTEXT drift, closed WITHOUT the false-red that got the last nested guard
   removed. The sibling arm above pins that the live-vs-live nested-equality guard stays
   absent; this arm is the composition-aware replacement it points to. */
test('#2553: the recorded fixture context matches a legitimate status.js variant (COMPOSITION-AWARE DRIFT GUARD)', () => {
  /* 🛑 THE GAP render-talk.js NAMES: a rename INSIDE `context` leaves the top-level key set
     identical, so the box-independent arm above (which compares top-level keys only) stays
     green, and the recording drives a `context` shape the producer no longer emits -- on
     exactly the quiet boxes the fallback exists for.
     🛑 WHY THIS IS NOT THE GUARD THAT WAS REMOVED. That one compared the recording against
     ONE LIVE card and fired on board COMPOSITION (measured on an 18-agent board: two profile
     shapes, four context key-sets). This looks at NO board. It derives the SET of context
     key-sets status.js can emit and asserts the recording matches one of them, so any
     legitimate variant passes and only a producer change that was not re-captured reds. That
     is what COMPOSITION-AWARE means here, and it is why re-adding a guard is not re-adding
     the bug.
     🛑 AND WHY IT LIVES IN THIS TEST, NOT IN render-talk.js. The arm above states the
     reason for the top-level anti-rot comparison: "where a false red costs a test run rather
     than a release." A cut-time nested check in render-talk.js would put a false red back on
     the release path, which the card calls the documented worst case. Placed here, a false
     red (a real producer schema change that wants a re-capture) reds `yarn test`, never a cut.
     ⚠️ CONTEXT ONLY, NOT profile, AND THAT IS DELIBERATE. Measured in web/index.html: every
     card-context read is GUARDED (pctOf uses `ctx && Number.isFinite(ctx.percent)`;
     memPrint/memUnknown/assumedCeilingNote use `ctx && ctx.KEY`/`typeof ctx.because ===
     'string'`; overCeiling/neverRecorded/noCeiling/notYet use `ctx && ctx.KEY === true`).
     There are ZERO unguarded context reads, so a missing key never BREAKS the page -- what a
     stale recording costs is COVERAGE (the reopen render silently takes the empty-context
     branch). profile is free-form (the tree writes dir/displayName/role/reportsTo per
     operator), scrubbed wholesale by the capture, and every page profile read is guarded
     (`a.profile && a.profile.role`), so a missing profile key is COMPOSITION, never drift --
     the exact guarded-vs-unguarded crux the card raises, resolved for profile by exclusion
     rather than a guard that would false-red on every board.
     ⚠️ WEAKEST PREMISE, NAMED: a PAGE-ONLY rename (the page reads `ctx.pct` while status.js
     still emits `percent` and the fixture still carries `percent`) is NOT caught here -- the
     fixture matches the producer, so this is green. It is acceptable because a page-only
     context rename breaks LIVE cards on a populated box too (every board row reads context),
     so it is a board-level failure caught elsewhere, not the quiet-box-specific gap. The gap
     THIS closes is recording-vs-producer divergence. */
  const statusSrc = fs.readFileSync(path.join(__dirname, 'engine', 'status.js'), 'utf8');
  const shapes = contextShapes(statusSrc);
  const variants = [...shapes.keys()];
  /* CONTROL: the derivation must have found the variants, or the membership test below is
     certifying the fixture against an empty set.
     ⚠️ `>= 4`, NOT `=== 4`, on purpose: the EXACT count is the sibling key-set arm's
     assertion (it reds and gets re-argued if status.js grows a fifth variant). This arm only
     needs the set to be non-empty and to contain the fixture's own shape, so a legitimate
     fifth variant should not red HERE too -- the fixture would still match one of the five.
     The floor is the count the sibling pins, so a broken scan (fewer than four) still reds. */
  assert.ok(variants.length >= 4,
    `CONTROL: only ${variants.length} context variants derived from status.js; the scan matched nothing, so this arm certifies nothing`);
  /* CONTROL: `contextShapes` hardcodes the NONE_BASE family keys (a rename confined to the
     `const NONE_BASE = {...}` literal in status.js would otherwise be invisible to the
     `...NONE_BASE` expansion). Pin the hardcode against the producer's own literal so that
     rename reds here instead of silently carrying a stale family key into every variant. */
  const nb = statusSrc.match(/const NONE_BASE = \{([^}]*)\}/);
  assert.ok(nb, 'CONTROL: could not find the NONE_BASE literal in status.js; the family-key pin is measuring nothing');
  const nbKeys = [...nb[1].matchAll(/([A-Za-z_]\w*)\s*:/g)].map((m) => m[1]).sort();
  assert.deepEqual(nbKeys, ['confidence', 'percent', 'tokens'],
    `status.js NONE_BASE keys are now [${nbKeys}]; update contextShapes' NONE_BASE_KEYS hardcode to match in the same commit`);

  const card = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assert.ok(card.context && typeof card.context === 'object' && !Array.isArray(card.context),
    'the recorded fixture has no nested `context` object, so the reopen render drives an empty context');
  const ctxKeys = Object.keys(card.context).sort().join(',');
  assert.ok(shapes.has(ctxKeys),
    `the recorded fixture's context shape [${ctxKeys}] matches NO status.js variant {${variants.join(' | ')}}; `
    + 'a context key was renamed or added in status.js and the recording was not re-captured. '
    + 'Re-capture with node tools/capture-agent-card.js');

  /* CONTROL: a fixture whose percent is renamed must match NO variant, or the membership
     assertion above cannot detect the very rename this arm exists to catch. percent is a
     NONE_BASE key, present in every variant, so removing it drops the fixture out of all of
     them. */
  const renamed = Object.keys(card.context).map((k) => (k === 'percent' ? 'pct' : k)).sort().join(',');
  assert.notEqual(renamed, ctxKeys, 'CONTROL: the fixture carries no percent key, so this perturbation changed nothing');
  assert.ok(!shapes.has(renamed),
    `CONTROL: a fabricated context with percent renamed to pct matched a variant [${renamed}], so this arm cannot detect a rename`);

  /* The fixture is the measuredResult variant TODAY. Pinned so a re-capture that lands a
     DIFFERENT (still legitimate) variant is a visible, reviewed change rather than a silent
     one -- and so this arm does not quietly become a membership test that any of the four
     shapes satisfies. If a deliberate re-capture changed the state, update this one line in
     the same commit. */
  const MEASURED = ['because', 'ceiling', 'ceilingAssumed', 'confidence', 'notYet', 'overCeiling', 'percent', 'tokens'].join(',');
  assert.equal(ctxKeys, MEASURED,
    `the committed fixture is no longer the measuredResult context shape (it is [${ctxKeys}]); `
    + 'if the re-capture was deliberate, update this pin in the same commit');
  /* CONTROL: measuredResult must actually be one of the derived variants, or the pin above
     is asserting a shape the producer cannot emit. */
  assert.ok(shapes.has(MEASURED),
    'CONTROL: the pinned measuredResult shape is not among the derived status.js variants, so the pin is stale');
});

test('#2519: liveCard PREFERS a pane card over a paneless one', () => {
  /* status.js emits both and both carry isNamedOurs. Their shapes legitimately differ, so
     taking whichever came first would drive the arm with a PANELESS card, whose null session/target the recording never produces (⚠️ this said "made the drift guard report board COMPOSITION as drift", which render-talk.js explicitly marks stale: the guard is gone and the reason is shape).
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

/* ⚠️ THREE SOURCE GREPS, AND THAT IS ALL THIS ARM IS. It would stay green if `notes` were
   never printed, or if the `if (cardSource === 'golden')` branch selected the wrong case.
   The BEHAVIOUR is held by the source/label arms and by the runtime NOTE capture above;
   this is a cheap tripwire on the shape, and saying so is the point, because an arm named
   like this one reads as more coverage than it holds. */
test('#2519: a fallback run emits a NOTE, and notes can never read as failures', () => {
  /* The release gate greps `'^\s*(FAIL|✖)|Error|Timeout|REFUS|refus'` (browser-checks.sh), which is
     WIDER than the anchor alone; an earlier version of this sentence said just the anchor. A note that reached that anchor would
     turn a covered quiet-box run back into a red, which is the bug inverted. */
  assert.match(SRC, /notes\.push\(/, 'no note is emitted when the fallback drives the arm');
  assert.match(SRC, /NOTE {2}\$\{n\}/, 'notes must print with a NOTE prefix, not a FAIL one');
  assert.ok(!/problems\.push\([^)]*RECORDED card fixture/.test(SRC),
    'the fallback must not be pushed as a problem');
});
