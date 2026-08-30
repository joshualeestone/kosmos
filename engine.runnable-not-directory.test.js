'use strict';
/**
 * #1592: `fs.accessSync(p, X_OK)` SUCCEEDS ON A DIRECTORY, so every hand-rolled
 * "is this runnable" check accepted a folder as an executable.
 * `engine/runners.js`'s `isRunnable` is the correct form and differs by one
 * line: `statSync(p).isFile()` before the access check.
 *
 * The branch repoints four sites to `runners.isRunnable`:
 *   connect.js willInstall, connect.js becomeStuck, devicedoor.js, githubdevice.js
 *
 * ============================================================================
 * 🛑 NINE REVIEW PASSES, 44 FINDINGS, EVERY SINGLE ONE IN THIS GUARD AND NOT
 * ONE IN THOSE FOUR SITES. READ THIS BEFORE ADDING ANYTHING HERE.
 * ============================================================================
 *
 * The guard reached 630 lines defending a 60-line change, and it was defeated
 * again on pass 9, five times. The reviewer named the root cause in one
 * sentence and it was correct:
 *
 *   the only arms that ever held were the ones that RUN THE CODE.
 *   every arm that READS SOURCE has now been defeated, most of them twice.
 *
 * The graveyard, so nobody rebuilds one of these:
 *
 *   four comment strippers   a `/*` in a string, a regex literal, a template
 *                            literal, backtick parity. Each fixed the last and
 *                            opened a new hole, all in the direction that HIDES.
 *   noProse                  kept the OPENING line of a multi-line block comment
 *                            verbatim, so a comment satisfied three arms at once
 *   isProseLine              called live code behind a closed `/* ... *\/` prose
 *   a bounded region         satisfied by live DEAD code: `if (0) <the token>`
 *   an arm registry          satisfied by a `/* TODO test('name') *\/` comment,
 *                            because the check was a substring search of THIS FILE
 *   a raw-source matcher     missed `/* belt *\/ canRunClaude = true;`, the exact
 *                            case an earlier widening had been written to catch
 *
 * ⇒ Telling USE from MENTION by pattern is a parsing job, there is no parser
 * here, and nine passes of trying produced nothing but new holes.
 *
 * ✅ SO THIS FILE NOW DOES TWO THINGS AND REFUSES A THIRD:
 *
 *   1. A SET SWEEP that strips NOTHING. Every line in the repo matching the weak
 *      shape must be in KNOWN_WEAK_LINES. It cannot be fooled by a comment
 *      because it does not try to judge one; a new prose mention, a new guarded
 *      call and a new defect all land in the same place, which is correct.
 *   2. BEHAVIOURAL ARMS that run the real code with a real directory.
 *   3. It does NOT try to read a call site and decide whether it is correct.
 *      That is the thing that failed nine times.
 *
 * ⚠️ THE COST, STATED: writing a NEW comment that mentions `accessSync(..., X_OK)`
 * turns this red until the line is listed. Deliberate, loud, a two-line fix. The
 * reason this file's own prose does not trip it is that the walk excludes
 * `*.test.js`, not comment-blindness.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ENGINE = path.join(__dirname, 'engine');
const REPO = __dirname;

/**
 * The weak call, defined ONCE because the sweep and its control MUST use the
 * same matcher.
 *
 * 🛑 `.*`, NOT `[^)]*`. `[^)]*` cannot cross a nested `)`, so it is blind to any
 * call whose first argument is itself a call. Measured at the merge base: it saw
 * `fs.accessSync(bin, X_OK)` and MISSED
 * `fs.accessSync(claudeBinPath(), fs.constants.X_OK)`, one of the sites this
 * branch fixes, and reverting that fix left every test green.
 *
 * ⚠️ WHAT IT STILL CANNOT SEE, IN FULL. Each accepts a directory exactly as the
 * fixed form did, and none exists in the repo today:
 *   - a call split across two lines (this is line-based)
 *   - `fs.accessSync(bin, X)` where `const X = fs.constants.X_OK`
 *   - `fs.accessSync(bin, 1)`, the numeric mode
 *   - bracket notation, `fs['accessSync'](bin, X_OK)`  <- added pass 9
 *
 * ⚠️ AND THE FILE SELECTION HAS ITS OWN GAPS: `.js` only (no `.mjs`/`.cjs`, none
 * exist), `*.test.js` excluded, any directory named `dist` skipped.
 *
 * ⭐ Disclosing one gap is worse than disclosing none: a reader takes the single
 * caveat as the complete list.
 */
/* ⚠️ BOTH ALTERNATIVES ARE LOAD-BEARING, and a review flagged the second as
   redundant. Measured before rejecting that: `access` alone does NOT match
   `fs.accessSync(bin, X_OK)`, because after `access` comes `Sync` rather than
   the `\s*\(` this pattern requires. Dropping either branch loses a real form. */
const WEAK_CALL = /(accessSync|access)\s*\(.*X_OK/;

/** Every non-test .js file in the repo, relative to REPO. */
function walkJs(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(full, base, out);
    else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(path.relative(base, full));
  }
  return out;
}

/**
 * Every line in the repo matching the weak-call shape, as it stands today.
 *
 * 🛑 A PLAIN LIST, AND IT USED TO CARRY A `kind` SAYING prose-or-guarded.
 * THAT CLASSIFICATION WAS DEFEATED ON BOTH OF ITS BRANCHES on pass 9 and is
 * gone: `prose` was satisfied by live code behind a closed block comment, and
 * `guarded` was satisfied by a `/* TODO ... *\/` comment naming a test that did
 * not exist. **An entry here is a note for a human, not a justification.** What
 * justifies a kept weak call is a behavioural arm below, and nothing else.
 *
 * ⚠️ KNOWN FRICTION: a line number reds on any insertion above it, and several
 * live branches touch connect.js, so this fires on most rebases. Bumping the
 * number is the correct response and is safe, because the number is not what
 * proves anything.
 *
 * 📌 Audited today: connect.js:931 prose, devicedoor.js:33 prose,
 * machine.js:412 a real call guarded by st.isFile(), runners.js:206 IS the
 * definition. The two real ones have behavioural arms below.
 */
const KNOWN_WEAK_LINES = [
  'engine/connect.js:931',
  'engine/devicedoor.js:33',
  'engine/machine.js:412',
  'engine/runners.js:206',
];

test('the set of lines matching the weak call is exactly what we audited', () => {
  const files = walkJs(REPO);
  assert.ok(files.length > 100, `only ${files.length} files scanned; the sweep is broken`);
  assert.ok(
    files.some((f) => f.startsWith(`engine${path.sep}`)),
    'the sweep is not reaching engine/, which is where the class lives'
  );

  const found = [];
  for (const rel of files) {
    const key = rel.split(path.sep).join('/');
    fs.readFileSync(path.join(REPO, rel), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (WEAK_CALL.test(line)) found.push(`${key}:${i + 1}`);
      });
  }

  assert.deepStrictEqual(
    found.sort(),
    [...KNOWN_WEAK_LINES].sort(),
    'the set of accessSync(X_OK) lines changed. accessSync(X_OK) SUCCEEDS ON A ' +
      'DIRECTORY, so look at each new line and decide:\n' +
      '  a real call    -> use require("./runners").isRunnable(p)\n' +
      '  a call you are KEEPING -> list it AND write a behavioural arm that hands\n' +
      '                   the real code a real directory. Listing alone proves\n' +
      '                   nothing; that was measured and defeated on pass 9.\n' +
      '  prose, or a moved line -> update the entry\n'
  );
});

test('the sweep can actually find a weak call, so an empty result means something', () => {
  const planted = 'try { fs.accessSync(bin, fs.constants.X_OK); } catch {}';
  assert.ok(WEAK_CALL.test(planted), 'the matcher cannot see a weak call');
  /* The shape that actually existed here and that the first matcher was blind
     to. Planting only the simple form tested the arm that already worked. */
  const nested = 'fs.accessSync(claudeBinPath(), fs.constants.X_OK);';
  assert.ok(WEAK_CALL.test(nested), 'the matcher is blind to a nested-call argument');
  const joined = "fs.accessSync(path.join(dir, 'claude'), fs.constants.X_OK);";
  assert.ok(WEAK_CALL.test(joined), 'the matcher is blind to a path.join() argument');
  assert.ok(!WEAK_CALL.test('fs.accessSync(bin, fs.constants.R_OK)'), 'the matcher over-fires on R_OK');
});

/* ==========================================================================
   THE BEHAVIOURAL ARMS. These run the real code with a real directory, and
   they are the only arms that have ever survived a review pass.

   Each one is proven in BOTH directions: the fixed code answers no to a
   directory, and the SAME arm was measured going red against the site reverted
   to the weak question. A one-armed test cannot tell a working guard from a
   guard that always passes.
   ========================================================================== */

/** A temp dir holding a DIRECTORY named like a binary, and a real executable. */
function fixture(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runnable-1592-'));
  const asDirectory = path.join(dir, name);
  fs.mkdirSync(asDirectory);
  const realBin = path.join(dir, 'real-' + name);
  fs.writeFileSync(realBin, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(realBin, 0o755);
  // The defect itself, asserted so every arm below argues with something real.
  let rawSaysYes = false;
  try { fs.accessSync(asDirectory, fs.constants.X_OK); rawSaysYes = true; } catch { rawSaysYes = false; }
  assert.strictEqual(rawSaysYes, true, 'a directory no longer passes X_OK; this card is moot');
  return { dir, asDirectory, realBin, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('isRunnable rejects a directory and accepts a real executable', () => {
  const { isRunnable } = require('./engine/runners.js');
  const f = fixture('thing');
  try {
    assert.strictEqual(isRunnable(f.asDirectory), false, 'isRunnable accepted a DIRECTORY');
    assert.strictEqual(isRunnable(f.realBin), true, 'isRunnable rejected a real executable');
    const notExec = path.join(f.dir, 'plain');
    fs.writeFileSync(notExec, 'x');
    fs.chmodSync(notExec, 0o644);
    assert.strictEqual(isRunnable(notExec), false, 'isRunnable accepted a non-executable file');
  } finally { f.cleanup(); }
});

test('machine.js installedCheck answers NOT PRESENT for a directory named like the binary', () => {
  /* 🛑 THIS REPLACED A TOKEN SEARCH, AND THE MEASUREMENT THAT DEMANDED IT:
     machine.js KEEPS its accessSync and is correct only because
     `if (!st.isFile()) { ...; continue; }` sits above it. The old arm asserted
     the string `isFile(` appeared within 20 lines. Delete ONLY the `continue;`
     and a directory falls through to `present = true`, the original defect, with
     the token intact and every arm green.
     ⇒ A guard being PRESENT and a guard REACHING the call are different claims,
     and no source pattern here can tell them apart. Running the code can. */
  const { installedCheck } = require('./engine/machine.js');
  const f = fixture('claude');
  try {
    const onDir = installedCheck({ claudeBin: f.asDirectory, tmuxBin: f.realBin, codexBin: f.realBin });
    assert.strictEqual(onDir.present.claude, false,
      'installedCheck reported a DIRECTORY as a present binary. The `if (!st.isFile())` guard ' +
      'above the accessSync no longer REACHES the call; check that it still ends the iteration.');
    const onFile = installedCheck({ claudeBin: f.realBin, tmuxBin: f.realBin, codexBin: f.realBin });
    assert.strictEqual(onFile.present.claude, true,
      'installedCheck reported a real executable as absent, so the arm above proves nothing');
  } finally { f.cleanup(); }
});

test('devicedoor resolves a DIRECTORY at the bin override to nothing', () => {
  /* Replaces a source assertion that the lambda "delegates to isRunnable".
     Pass 9 defeated that at expression scope: the body match was unanchored, so
     `(p) => existsSync(p) || isRunnable(p)` satisfied it while accepting a
     directory. This runs it instead.
     Proven red against the reverted lambda: the directory came back as the
     resolved path rather than null. */
  const { makeDoor } = require('./engine/devicedoor.js');
  const f = fixture('gh');
  const before = process.env.ICK_1592_BIN;
  try {
    const door = makeDoor({ binEnv: 'ICK_1592_BIN', candidates: ['/nonexistent/never'] });
    process.env.ICK_1592_BIN = f.asDirectory;
    assert.strictEqual(door.ghBin(), null,
      'devicedoor accepted a DIRECTORY as the tool binary. Its `runnable` lambda is asking a ' +
      'weaker question than runners.isRunnable, so a folder named like the tool reads as installed.');
    process.env.ICK_1592_BIN = f.realBin;
    assert.strictEqual(door.ghBin(), f.realBin,
      'devicedoor rejected a real executable, so the arm above proves nothing');
  } finally {
    if (before === undefined) delete process.env.ICK_1592_BIN; else process.env.ICK_1592_BIN = before;
    f.cleanup();
  }
});

test('devicedoor rejects a DIRECTORY found by the CANDIDATE SCAN, not just the env override', () => {
  /* 🛑 THE ARM ABOVE RAN REAL CODE DOWN THE WRONG BRANCH. `ghBin()` has two:
     the env override, and the candidate scan a real Mac actually uses. The
     override arm pinned `candidates: ['/nonexistent/never']`, so the scan never
     executed. A reviewer reverted ONLY the two candidate scans and every arm
     stayed green while a FOLDER at /opt/homebrew/bin/gh read as installed.
     ⇒ A behavioural arm is only behavioural for the branch it reaches. */
  const { makeDoor } = require('./engine/devicedoor.js');
  const f = fixture('gh');
  const before = process.env.ICK_1592_SCAN;
  try {
    delete process.env.ICK_1592_SCAN;
    const onDir = makeDoor({ binEnv: 'ICK_1592_SCAN', candidates: [f.asDirectory] });
    assert.strictEqual(onDir.ghBin(), null,
      'the devicedoor CANDIDATE SCAN accepted a DIRECTORY. A folder at one of the standard ' +
      'tool paths reads as installed. The env-override branch can be correct while this one ' +
      'is not; they are separate call sites.');
    const onFile = makeDoor({ binEnv: 'ICK_1592_SCAN', candidates: [f.realBin] });
    assert.strictEqual(onFile.ghBin(), f.realBin,
      'the candidate scan rejected a real executable, so the arm above proves nothing');
  } finally {
    if (before !== undefined) process.env.ICK_1592_SCAN = before;
    f.cleanup();
  }
});

test('githubdevice rejects a DIRECTORY found by the CANDIDATE SCAN, not just the env override', async () => {
  /* The same second branch, at the twin site. Its candidate paths were inline
     and therefore unreachable from a test, so `setGhCandidatesForTests` was
     added for this arm alone, in keeping with the file's existing setClientId
     and setFetcher seams. Without it this branch cannot be exercised at all,
     which is how it went unguarded. */
  const gd = require('./engine/githubdevice.js');
  const f = fixture('gh');
  const before = process.env.AGENT_WORKFORCE_GH_BIN;
  try {
    delete process.env.AGENT_WORKFORCE_GH_BIN;
    gd.setGhCandidatesForTests([f.asDirectory]);
    const onDir = await gd.state();
    assert.strictEqual(onDir.gh, 'missing',
      'the githubdevice CANDIDATE SCAN accepted a DIRECTORY. A folder at /opt/homebrew/bin/gh ' +
      'reads as installed.');
    gd.setGhCandidatesForTests([f.realBin]);
    const onFile = await gd.state();
    assert.strictEqual(onFile.gh, 'present',
      'the candidate scan rejected a real executable, so the arm above proves nothing');
  } finally {
    gd.setGhCandidatesForTests(null);
    if (before !== undefined) process.env.AGENT_WORKFORCE_GH_BIN = before;
    f.cleanup();
  }
});

test('githubdevice reports a DIRECTORY at the gh override as missing', async () => {
  /* The byte-identical twin of the devicedoor lambda, which is why fixing one
     file would not have found the other. `state()` is ASYNC: reading `.gh` off
     the promise gives undefined in BOTH arms, which looks like a result and is
     an instrument fault. Awaited here for that reason.
     Proven red against the reverted lambda: the directory read "present". */
  const gd = require('./engine/githubdevice.js');
  const f = fixture('gh');
  const before = process.env.AGENT_WORKFORCE_GH_BIN;
  try {
    process.env.AGENT_WORKFORCE_GH_BIN = f.asDirectory;
    const onDir = await gd.state();
    assert.strictEqual(onDir.gh, 'missing',
      'githubdevice reported a DIRECTORY as a present gh. Its `runnable` lambda is asking a ' +
      'weaker question than runners.isRunnable.');
    process.env.AGENT_WORKFORCE_GH_BIN = f.realBin;
    const onFile = await gd.state();
    assert.strictEqual(onFile.gh, 'present',
      'githubdevice reported a real executable as missing, so the arm above proves nothing');
  } finally {
    if (before === undefined) delete process.env.AGENT_WORKFORCE_GH_BIN;
    else process.env.AGENT_WORKFORCE_GH_BIN = before;
    f.cleanup();
  }
});

test('willInstall rejects a DIRECTORY without ever reaching the version probe', async () => {
  /* 🛑 THE ARM A REVIEW PASS SAID COULD NOT EXIST, AND THE CORRECTION IS THE
     POINT. Pass 9 recorded that reverting this site "does NOT change the
     function's answer for a directory", because the `--version` probe below
     catches it anyway, and concluded the harm was only a guard failure.

     MEASURED HERE, BOTH ARMS: it changes two things.
       fixed     willInstall(directory) = true,  version probes spawned = 0
       reverted  willInstall(directory) = FALSE, version probes spawned = 1

     The answer flips whenever the probe answers ok, which is exactly what an
     injected runner and a dry run both do. This file's own docblock names that
     outcome: "we say willInstall FALSE and it was true -> AN UNANNOUNCED 281MB
     DOWNLOAD". So the reverted site CAN produce the harmful answer.

     ⭐ The arm keys on the PROBE COUNT rather than the answer, because the count
     is deterministic while the answer depends on what the runner says. */
  const connect = require('./engine/connect.js');
  const f = fixture('claude');
  const before = process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  try {
    process.env.AGENT_WORKFORCE_CLAUDE_BIN = f.asDirectory;
    let probes = 0;
    connect.setRunner(() => { probes += 1; return { ok: true, stdout: '1.0.0' }; });
    if (connect.setProbeTtlForTests) connect.setProbeTtlForTests(0);

    const answer = await connect.willInstall();
    assert.strictEqual(probes, 0,
      'willInstall spawned a --version probe for a DIRECTORY, which means the cheap gate above ' +
      'it is no longer asking runners.isRunnable. A directory got past the presence check.');
    assert.strictEqual(answer, true, 'willInstall said no install is needed for a DIRECTORY');

    // The true arm: a real executable MUST reach the probe, or "probes === 0"
    // above would also pass on a willInstall that never probes anything.
    process.env.AGENT_WORKFORCE_CLAUDE_BIN = f.realBin;
    probes = 0;
    await connect.willInstall();
    assert.strictEqual(probes, 1,
      'a real executable did not reach the version probe, so the probe count proves nothing');
  } finally {
    connect.setRunner(null);
    if (before === undefined) delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
    else process.env.AGENT_WORKFORCE_CLAUDE_BIN = before;
    f.cleanup();
  }
});

/**
 * Mona Lisa's finding, carried from her parallel #1592 branch. TWO BLIND
 * REVIEWERS HIT THIS ON HER VERSION.
 *
 * `canRunClaude` exists so the stuck screen can say whether the binary is
 * runnable, and its docblock promises "any error answers FALSE". That holds
 * only while the BIN RESOLUTION is inside the try: `claudeBinPath()` can throw,
 * and hoisting it above the try lets the throw escape `becomeStuck`, so
 * `writeState` never runs and the person is left on no screen at all.
 *
 * ⚠️ INVISIBLE TO A BEHAVIOURAL TEST that does not force a throw from the
 * resolver, and it is a tempting refactor. So this asserts the SHAPE, and it is
 * the one source-reading arm kept in this file. It is kept because it guards a
 * DIFFERENT defect (an escaping throw) that no behavioural arm here reaches,
 * and because what it asserts is a structural relationship rather than a
 * judgement about whether a call is correct.
 */
test('canRunClaude resolves the bin INSIDE its try, so a throw still writes the stuck screen', () => {
  const src = fs.readFileSync(path.join(ENGINE, 'connect.js'), 'utf8');
  const anchor = src.indexOf('let canRunClaude = false;');
  assert.ok(anchor > 0, 'canRunClaude was renamed or removed; re-aim this guard');
  assert.strictEqual(src.indexOf('let canRunClaude = false;', anchor + 1), -1,
    'the anchor appears more than once, so the region below is ambiguous');

  const region = src.slice(anchor, anchor + 600);
  const tryAt = region.indexOf('try {');
  const catchAt = region.indexOf('} catch');
  assert.ok(tryAt > -1 && catchAt > tryAt, 'canRunClaude is no longer wrapped in a try/catch');

  const guarded = region.slice(tryAt, catchAt);
  assert.ok(
    /claudeBinPath\s*\(|resolveBin\s*\(/.test(guarded),
    'the bin resolution has moved OUTSIDE canRunClaude\'s try. A throw from it now escapes ' +
      'becomeStuck and the stuck screen is never written, breaking the docblock promise that ' +
      'any error answers false. Keep the resolution inside the try.'
  );
});

test('becomeStuck assigns canRunClaude EXACTLY ONCE, and that one assignment delegates', () => {
  /* 🛑 THE ONE SITE WITH NO BEHAVIOURAL ARM, AND WHY. `becomeStuck` is not
     exported and early-returns unless the module-internal `driver` matches the
     caller, so it cannot be called from a test. Reaching it needs a full
     `start()` flow driven to failure, which no test in this repo does today.
     Carded separately. Until then this site is defended by SOURCE, which this
     file otherwise refuses to do, so it is written to survive the three shapes
     that have actually defeated a source arm here.

     ⭐ IT COUNTS ASSIGNMENTS RATHER THAN LOOKING FOR A TOKEN, which is what makes
     it different from the two arms that fell on pass 9. Both defeats worked by
     ADDING the token somewhere the region could see:

       comment decoy   canRunClaude = fs.existsSync(...); /* canRunClaude =
                       require('./runners').isRunnable(     <- unclosed opener
       dead code       canRunClaude = fs.existsSync(...);
                       if (0) canRunClaude = require('./runners').isRunnable(...)

     Both leave TWO assignments where the correct code has one, so requiring
     exactly one and checking THAT ONE closes both without judging whether any
     given line is a comment. A straight revert with no decoy leaves one
     assignment that does not delegate, which fails the second half.

     ⚠️ NAMED WEAKNESS, because this is the weakest arm in the file: a decoy that
     REPLACES the real assignment rather than adding to it still leaves one
     assignment, and if that one delegates while something later undoes it, the
     override arm below is what catches it. Two arms, neither sufficient alone. */
  const src = fs.readFileSync(path.join(ENGINE, 'connect.js'), 'utf8');
  const anchor = src.indexOf('let canRunClaude = false;');
  assert.ok(anchor > 0, 'canRunClaude was renamed or removed; re-aim this guard');
  /* 🛑 BOUNDED BY STRUCTURE, NOT BY A CHARACTER COUNT. A reviewer measured the
     char-count version: anchor + 600 ran 14 source lines past the end of
     becomeStuck and into the next function, so a decoy placed in a DIFFERENT
     function satisfied it. A constant chosen by eye means whatever the comment
     density happens to make it mean, and it drifts every time somebody edits a
     comment nearby. The catch arm is the real end of this construct. */
  const catchAt = src.indexOf('} catch', anchor);
  assert.ok(catchAt > anchor && catchAt - anchor < 800,
    'canRunClaude is no longer followed by a catch arm within a plausible distance; re-aim this guard');
  const region = src.slice(anchor + 'let canRunClaude = false;'.length, src.indexOf('}', catchAt + 7) + 1);

  const assignments = region.match(/canRunClaude\s*=\s*[^;\n]+/g) || [];
  assert.strictEqual(
    assignments.length, 2,
    'becomeStuck no longer has exactly the two expected assignments to canRunClaude ' +
      '(the isRunnable one and the catch-arm `= false`). Found ' + assignments.length + ':\n  ' +
      assignments.join('\n  ') +
      '\nAn EXTRA one is how both pass-9 defeats worked: the real line was repointed to a ' +
      'weaker check and the isRunnable token was re-added nearby, in a comment or in dead code.'
  );
  /* 🛑 ANCHORED AT BOTH ENDS, AND A PREFIX MATCH IS WHY. This arm shipped for one
     hour matching only the START of the assignment, and a reviewer defeated it in
     one line: `= require('./runners').isRunnable(x) || fs.existsSync(x)` matched
     the prefix perfectly and answers TRUE for a directory, because isRunnable says
     no and existsSync says yes. The delegation must be the WHOLE answer, not the
     first half of it. */
  /* 📌 TWO CHECKS RATHER THAN ONE CLEVER REGEX, AND I TRIED THE CLEVER ONE FIRST.
     `\(([^)]*)\)$` cannot cross the nested `)` in `claudeBinPath()`, so it went
     RED ON CORRECT CODE. That is the exact `[^)]*` hazard this file's own
     WEAK_CALL docblock warns about, committed here by the person who wrote that
     warning. And a greedy `\(.*\)$` lets the disjunction straight back in,
     because `isRunnable(x) || existsSync(x)` also ends in `)`. So: match the
     delegation, then separately refuse anything that could widen it. */
  assert.match(
    assignments[0],
    /^canRunClaude\s*=\s*require\(['"]\.\/runners['"]\)\.isRunnable\s*\(/,
    'becomeStuck\'s canRunClaude is not EXACTLY a delegation to runners.isRunnable; it is ' +
      '`' + assignments[0].trim() + '`. Anything ADDED to the delegation can undo it: a ' +
      '`|| fs.existsSync(p)` answers true for a DIRECTORY because isRunnable says no and ' +
      'existsSync says yes. If it was repointed or widened, a directory reads as runnable ' +
      'and the stuck screen offers a hatch that cannot work. publicView serves this field ' +
      'to the page (#1595).'
  );

  /* 🛑 EVERY ASSIGNMENT, NOT JUST THE FIRST, AND A REVIEWER TOOK THE SLOT I LEFT.
     The count above expects two: the delegation and the catch arm's `= false`.
     But the catch arm is REDUNDANT (the variable is initialised false one line
     up), so it can be deleted and its slot reused:

       canRunClaude = require('./runners').isRunnable(claudeBinPath());
       if (!canRunClaude) canRunClaude = fs.existsSync(claudeBinPath());
       } catch { }

     Count still 2. First assignment still delegates. No truthy literal. No
     accessSync for the sweep. Measured: 10 pass / 0 fail with a DIRECTORY
     reading TRUE. It also defeats the `||` refusal below, because the weakener
     is a SEPARATE statement rather than an operator on the first one.
     ⇒ Checking only `assignments[0]` means every other slot is unexamined.
     Every assignment after the first must be exactly `= false`, which admits the
     real catch arm and refuses anything that can raise the answer. */
  for (const extra of assignments.slice(1)) {
    assert.match(
      extra.trim(), /^canRunClaude\s*=\s*false$/,
      'becomeStuck assigns canRunClaude something other than the catch arm\'s `= false`: `' +
        extra.trim() + '`. Any later assignment can undo the delegation, and one that only ' +
        'RAISES the answer (a presence-check fallback) turns a DIRECTORY back into true ' +
        'while the first assignment still looks correct.'
    );
  }

  const widened = assignments[0].match(/\|\||&&|\?|\bor\b/);
  assert.strictEqual(
    widened, null,
    'becomeStuck\'s canRunClaude delegates to runners.isRunnable and then WIDENS the answer ' +
      'with `' + (widened && widened[0]) + '`: `' + assignments[0].trim() + '`. A ' +
      '`|| fs.existsSync(p)` answers true for a DIRECTORY, because isRunnable says no and ' +
      'existsSync says yes, so the delegation is decorative. The delegation must be the ' +
      'whole answer. publicView serves this field to the page (#1595).'
  );
});

test('nothing unconditionally forces canRunClaude true, which would dead-code the check', () => {
  /* `canRunClaude = require('./runners').isRunnable(...)` followed by a leftover
     `canRunClaude = true;` passes the sweep and the shape guard while the check
     is dead. So this asserts ABSENCE.

     🛑 IT READS BOTH RAW AND PROSE-STRIPPED SOURCE, AND BOTH ARE NECESSARY.
     Pass 8 had it read stripped source, and `const d = 'https://x'; canRunClaude
     = true;` vanished because the `//` inside the URL truncated the line. Pass 9
     had it read RAW, which reintroduced the `/* belt *\/ canRunClaude = true;`
     miss that an earlier widening existed to catch, because under raw the
     preceding character is `/` rather than `;` or `{`. Running the matcher over
     both and failing if EITHER matches is strictly stronger than either alone
     and costs nothing.

     🛑 AND IT MATCHES MORE THAN THE WORD `true`, THOUGH NOT "ANY TRUTHY
     LITERAL", WHICH IS WHAT THIS SAID AND WAS FALSE. Measured by a reviewer:
     `= 0.5`, `= !0`, `= []`, `= {}` and `= Boolean(1)` all slip past it, and no
     regex can decide truthiness in general. What it DOES cover is the shapes
     that have actually appeared: the literal true, a positive integer, and a
     string. Pass 9 measured
     `canRunClaude = 1;` passing, and publicView serves `canRunClaude || false`,
     so a 1 reaches the page truthy and the check is just as dead. The
     justification was always directional; it is now written that way.
     `= false` can never make a directory pass, so it is deliberately not matched.

     ⚠️ THE PRICE, ACCEPTED: a commented-out `canRunClaude = true;` now turns this
     red via the raw pass. Loud, and a two-line fix. Measured: zero lines match
     today in either reading. */
  const raw = fs.readFileSync(path.join(ENGINE, 'connect.js'), 'utf8');
  const stripped = raw
    .split('\n')
    .map((l) => l.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/, ''))
    .join('\n');
  const FORCED = /canRunClaude\s*=\s*(?!false\b)(true\b|[1-9]\d*|['"`])/g;

  for (const [label, text] of [['raw', raw], ['prose-stripped', stripped]]) {
    const hits = (text.match(FORCED) || []);
    assert.deepStrictEqual(hits, [],
      `canRunClaude is assigned a truthy literal (${label} reading), which overrides the ` +
        'isRunnable check and leaves it dead:\n  ' + hits.join('\n  '));
  }

  // Controls: every shape that has defeated this arm before must be seen now.
  const mustCatch = [
    ['plain', '  canRunClaude = true;'],
    ['after a semicolon', "  const d = 1; canRunClaude = true;"],
    ['behind a block comment', '  /* belt */ canRunClaude = true;'],
    ['a URL string on the line', "  const d = 'https://x'; canRunClaude = true;"],
    ['truthy 1', '  canRunClaude = 1;'],
    ['truthy string', '  canRunClaude = "yes";'],
  ];
  for (const [name, line] of mustCatch) {
    assert.ok((line.match(FORCED) || []).length === 1,
      `the override matcher cannot see an override ${name}, so its empty result means nothing`);
  }
  // And the negative arm: assigning FALSE is legitimate and must NOT fire.
  assert.strictEqual(('  } catch { canRunClaude = false; }'.match(FORCED) || []).length, 0,
    'the override matcher fires on `= false`, which is legitimate and cannot make a directory pass');
});
