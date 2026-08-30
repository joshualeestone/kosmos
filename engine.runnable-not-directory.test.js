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

test('githubdevice scans its candidate paths at exactly ONE site, so the test seam cannot diverge', () => {
  /* 🛑 THE WEAKEST ARM IN THIS FILE, AND IT EXISTS BECAUSE NO BEHAVIOURAL ARM CAN
     REACH WHAT IT GUARDS. `setGhCandidatesForTests` is a SUBSTITUTING seam: the
     arm above drives the list it sets, and production's own default list is
     driven by nothing. A reviewer split the two and weakened only production:

       return ghCandidates ? ghCandidates.some(runnable)
                           : GH_CANDIDATES.some((p) => fs.existsSync(p));

     Test path correct, production path defective, 12 pass / 0 fail. Reshaping the
     seam to one variable removed the natural `||` form but NOT the possibility;
     an identity check against the default still splits it, measured.

     ⇒ A substituting seam is sound only while exactly ONE call site consumes both
     the seam and the default. That is a property of the code's shape, so a source
     check is the only thing that can see it, and this is that check. It counts
     scan sites rather than judging whether any of them is correct, which is the
     one kind of source assertion that has survived on this branch.

     ⚠️ devicedoor needs no equivalent: its `candidates` is a real parameter that
     production callers pass, so the arm drives production's own path and there is
     no default to diverge from. Prefer that shape when there is a choice. */
  const src = fs.readFileSync(path.join(ENGINE, 'githubdevice.js'), 'utf8');
  const fn = src.slice(src.indexOf('function ghPresent()'), src.indexOf('async function http('));
  assert.ok(fn.length > 50 && fn.length < 2000, 'ghPresent was renamed or moved; re-aim this guard');
  const scans = fn.match(/\.some\s*\(/g) || [];
  assert.strictEqual(
    scans.length, 1,
    'ghPresent scans its candidate list at ' + scans.length + ' sites rather than one. The ' +
      'test seam substitutes that list, so a SECOND scan is a path no arm drives, and it can ' +
      'be weakened while every behavioural arm stays green. Keep one scan, or give ghPresent ' +
      'the candidates as a parameter the way devicedoor does.'
  );
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
    // Restore the probe TTL too: a reviewer found this arm left it at 0 for
    // whatever ran next, and it is the last arm to touch connect.
    if (connect.setProbeTtlForTests) connect.setProbeTtlForTests(undefined);
    if (before === undefined) delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
    else process.env.AGENT_WORKFORCE_CLAUDE_BIN = before;
    f.cleanup();
  }
});

test('claudeHatchAvailable answers NO for a directory, which is what the stuck screen is gated on', () => {
  /* 🛑 THIS ARM REPLACES SIX ATTEMPTS AT BOUNDING A REGION, AND THE HISTORY IS
     THE ARGUMENT FOR IT. becomeStuck used to compute this inline, so the guard
     had to bound a region of a mutable function. A region has two edges and each
     was independently wrong:

       anchor + 600 chars   TOO BIG    a decoy in the next function satisfied it
       to the catch close   TOO SMALL  a fallback after the catch was invisible
       to `writeState(`     WRONG BOTH WAYS: an earlier writeState( truncates the
                            region, AND the widening that mattered lived inside
                            writeState's own argument list written with a COLON,
                            so no assignment check could match it at any boundary

     Every fix moved one edge and exposed the other. The logic is one exported
     function now, so there is nothing to bound and this arm can simply RUN IT.

     📌 No new test seam and no export of becomeStuck: claudeBinPath() already
     honours AGENT_WORKFORCE_CLAUDE_BIN, the same override the willInstall arm
     uses. */
  const connect = require('./engine/connect.js');
  const f = fixture('claude');
  const before = process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  try {
    process.env.AGENT_WORKFORCE_CLAUDE_BIN = f.asDirectory;
    assert.strictEqual(connect.claudeHatchAvailable(), false,
      'a DIRECTORY at the claude bin path reads as a runnable hatch. The stuck screen would ' +
      'offer "open Terminal and type claude" pointing at a folder (#1595 gates the hatch on ' +
      'this value, and publicView serves it).');
    process.env.AGENT_WORKFORCE_CLAUDE_BIN = f.realBin;
    assert.strictEqual(connect.claudeHatchAvailable(), true,
      'a real executable reads as unavailable, so the arm above proves nothing');
  } finally {
    if (before === undefined) delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
    else process.env.AGENT_WORKFORCE_CLAUDE_BIN = before;
    f.cleanup();
  }
});

test('claudeHatchAvailable resolves the bin INSIDE its try, so a throw still writes the stuck screen', () => {
  /* Mona Lisa's finding, and I DELETED THE GUARD FOR IT while collapsing the
     region, then caught that with my own perturbation. Third time today that
     simplifying a guard silently dropped coverage.

     `claudeBinPath()` calls the runner resolver, which can throw, and
     becomeStuck's docblock promises any error answers FALSE. Hoisting the
     resolution into a bare `const` above the try lets the throw escape
     becomeStuck entirely, so writeState never runs and the person is left on NO
     SCREEN AT ALL. Two blind reviewers hit this on her branch.

     ⚠️ IT IS A SOURCE CHECK AND I WOULD RATHER IT WERE NOT. Forcing the resolver
     to throw needs a seam that does not exist, so the behavioural consequence
     stays untested; that is a known gap, not a covered one. What makes this one
     tolerable where the old region check was not: the surface is a SEVEN-LINE
     FUNCTION with its own braces, not a region of a mutable function, so there is
     no boundary to get wrong in either direction. */
  const src = fs.readFileSync(path.join(ENGINE, 'connect.js'), 'utf8');
  const at = src.indexOf('function claudeHatchAvailable()');
  assert.ok(at > 0, 'claudeHatchAvailable was renamed or removed; re-aim this guard');
  const body = src.slice(at, src.indexOf('\n}', at) + 2);
  assert.ok(body.length < 400, 'claudeHatchAvailable has grown; it is meant to be one expression in a try');

  const tryAt = body.indexOf('try {');
  const resolveAt = body.search(/claudeBinPath\s*\(|resolveBin\s*\(/);
  assert.ok(tryAt > -1, 'claudeHatchAvailable is no longer wrapped in a try/catch');
  assert.ok(resolveAt > -1, 'claudeHatchAvailable no longer resolves a bin path at all');
  assert.ok(
    resolveAt > tryAt,
    'the bin resolution has moved OUTSIDE claudeHatchAvailable\'s try. A throw from the runner ' +
      'resolver now escapes becomeStuck, so writeState never runs and the person is left on no ' +
      'screen at all, which breaks the docblock promise that any error answers false.'
  );
});

test('becomeStuck writes canRunClaude from claudeHatchAvailable() and nothing else', () => {
  /* The behavioural arm above proves the FUNCTION is right. This proves the call
     site still uses it, which is the other half and is one expression rather than
     a region: no boundary, no count, no distance judgement.

     🛑 IT MATCHES THE WHOLE PROPERTY VALUE UP TO THE COMMA OR BRACE, WHICH IS
     WHAT MUTATION F NEEDED. That defeat widened at the point of use with a COLON,
     `canRunClaude: canRunClaude || fs.existsSync(...)`, which is not an
     assignment and which every assignment-shaped check missed at every boundary.
     Anything appended here changes this string.

     ⚠️ Mona Lisa's finding is now guarded by the function's own try rather than
     by a shape assertion here: claudeBinPath() can throw, and becomeStuck's
     docblock promises any error answers false. Its behavioural consequence is
     untested (forcing the resolver to throw needs a seam that does not exist),
     and that is a known gap rather than a covered one. */
  const src = fs.readFileSync(path.join(ENGINE, 'connect.js'), 'utf8');
  /* Only the writeState call. publicView legitimately carries its own
     `canRunClaude: s.canRunClaude || false` serving default (#1595), which reads
     a value already computed rather than computing one, so it is not a second
     writer. Matching every `canRunClaude:` in the file would red on that. */
  const writes = (src.match(/writeState\(\{[^}]*canRunClaude[^}]*\}/g) || []);
  assert.strictEqual(writes.length, 1,
    'expected exactly one writeState call carrying canRunClaude, found ' + writes.length +
      ':\n  ' + writes.join('\n  ') + '\nA second writer is a path no arm drives.');
  const hits = writes[0].match(/canRunClaude\s*:\s*[^,}]+/g) || [];
  assert.strictEqual(hits.length, 1, 'the writeState call carries canRunClaude ' + hits.length + ' times');
  assert.strictEqual(hits[0].trim(), 'canRunClaude: claudeHatchAvailable()',
    'becomeStuck no longer writes canRunClaude straight from claudeHatchAvailable(); it writes ' +
      '`' + hits[0].trim() + '`. Anything added here can widen the answer AFTER the check: a ' +
      '`|| fs.existsSync(p)` turns a DIRECTORY back into true, and it is not an assignment so ' +
      'no assignment guard can see it.');
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
