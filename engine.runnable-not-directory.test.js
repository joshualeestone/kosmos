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
 * ⭐⭐ THE DURABLE ARTIFACT OF THIS BRANCH IS NOT THIS GUARD. IT IS THE PROGRESSION
 * OF ONE ASSERTION, THE CALL-SITE CHECK, WHICH WAS DEFEATED FOUR TIMES:
 *
 *     nested-delimiter blind   `writeState\({[^}]*X[^}]*}` cannot cross a `}`
 *     form blind               `X\s*:\s*[^,}]+` misses shorthand and bracket keys
 *     a count blind to a swap  delete a prose mention, add a hidden code line
 *     no filter, no count, no form   key on `writeState`, a property of the CODE
 *
 * ⇒ EACH SHAPE WAS DEFEATED BY THE THING IT STILL TRIED TO CLASSIFY, AND IT
 * STOPPED FALLING WHEN IT STOPPED CLASSIFYING. That generalises well past #1592.
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
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* 🛑 SANDBOX THE STORE BEFORE ANY ENGINE REQUIRE. THIS IS NOT DEFENSIVE
   TIDINESS; WITHOUT IT THIS FILE READS THE OPERATOR'S REAL SECRETS.

   `engine/githubdevice.js` resolves its paths from `store.ROOT` AT MODULE LOAD
   (githubdevice.js:43-45), so `FILE` becomes
   `<real config dir>/secrets/github.token`. The two `await gd.state()` arms below
   call `readToken()` against that path, and when a token EXISTS `state()` issues a
   live HTTPS request to https://api.github.com/user CARRYING IT. Four such calls
   per suite run, 10s timeout each.

   ⚠️ IT IS DORMANT ON THIS MACHINE ONLY BECAUSE `secrets/` DOES NOT EXIST
   YET. It arms itself the first time the operator connects GitHub through the very
   feature githubdevice.js implements, which is a trap that springs later and
   silently. A blind reviewer found it; eighteen non-blind passes read these arms
   repeatedly and did not.

   📌 The repo already states this rule in two places, and I broke it anyway:
   `tools/run-tests.sh:19` ("every store-using test sandboxes before requiring")
   and `fixture-discipline.test.js`, which records the MEASURED cost of leaving it
   out: 93 entries written into the operator's own live config by an unsandboxed
   suite. Pattern copied from `engine/githubdevice.test.js:4-12`; both knobs travel
   together per #527. */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-runnable-1592-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');

const { test } = require('node:test');
const assert = require('node:assert');

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
const WEAK_CALL = /(accessSync|access)\s*\(.*\bX_OK\b/;

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
  'engine/connect.js:943',
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
    /* 🛑 EVERY KEY, NOT JUST `claude`. installedCheck reports claude, codex and
       tmux through ONE loop, and this arm used to assert only `.claude`. A
       reviewer special-cased codex to fs.existsSync and it went 13 pass / 0 fail
       with a FOLDER at the codex path reading as installed. codex is a supported
       provider (#979), so that is a real answer on a real screen.
       ⇒ Same family as the devicedoor and githubdevice candidate-branch finding,
       one level down: per-KEY coverage rather than per-BRANCH. An arm that drives
       shared code through one of its inputs proves nothing about the others. */
    const keys = ['claude', 'codex', 'tmux'];
    for (const key of keys) {
      const opts = { claudeBin: f.realBin, tmuxBin: f.realBin, codexBin: f.realBin };
      opts[key === 'claude' ? 'claudeBin' : key === 'codex' ? 'codexBin' : 'tmuxBin'] = f.asDirectory;
      const onDir = installedCheck(opts);
      assert.strictEqual(onDir.present[key], false,
        'installedCheck reported a DIRECTORY as a present binary for `' + key + '`. The ' +
        '`if (!st.isFile())` guard above the accessSync no longer REACHES the call for that key, ' +
        'so a folder at its path reads as installed.');
    }
    const onFile = installedCheck({ claudeBin: f.realBin, tmuxBin: f.realBin, codexBin: f.realBin });
    for (const key of keys) {
      assert.strictEqual(onFile.present[key], true,
        'installedCheck reported a real executable as absent for `' + key + '`, so the arm ' +
        'above proves nothing for that key');
    }
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
  /* The same second branch, at the twin site. Its candidate paths were inline and
     therefore unreachable from a test, so the AGENT_WORKFORCE_GH_CANDIDATES env
     seam exists, in keeping with the file's other env-var seams. Without it this
     branch cannot be exercised at all, which is how it went unguarded.

     📌 THIS COMMENT PREVIOUSLY NAMED `setGhCandidatesForTests`, WHICH NO LONGER
     EXISTS. That was the seam's first shape, removed because a reviewer defeated
     it (githubdevice.js:112 records why), and the comment outlived it by four
     commits. It is the exact defect the plan writes up about itself, a
     description surviving the design it described and becoming a second source of
     truth, landed one file over from the warning. Caught by a blind reviewer; the
     eighteen non-blind passes read past it. */
  const gd = require('./engine/githubdevice.js');
  const f = fixture('gh');
  const before = process.env.AGENT_WORKFORCE_GH_BIN;
  const beforeCands = process.env.AGENT_WORKFORCE_GH_CANDIDATES;
  try {
    delete process.env.AGENT_WORKFORCE_GH_BIN;
    process.env.AGENT_WORKFORCE_GH_CANDIDATES = f.asDirectory;
    const onDir = await gd.state();
    assert.strictEqual(onDir.gh, 'missing',
      'the githubdevice CANDIDATE SCAN accepted a DIRECTORY. A folder at /opt/homebrew/bin/gh ' +
      'reads as installed.');
    process.env.AGENT_WORKFORCE_GH_CANDIDATES = f.realBin;
    const onFile = await gd.state();
    assert.strictEqual(onFile.gh, 'present',
      'the candidate scan rejected a real executable, so the arm above proves nothing');
  } finally {
    if (beforeCands === undefined) delete process.env.AGENT_WORKFORCE_GH_CANDIDATES;
    else process.env.AGENT_WORKFORCE_GH_CANDIDATES = beforeCands;
    if (before !== undefined) process.env.AGENT_WORKFORCE_GH_BIN = before;
    f.cleanup();
  }
});

test('an EMPTY candidates override means no candidates, not the real machine paths', async (t) => {
  /* 🛑 THE ARM FOR A LEAK I FIXED WITH NOTHING GUARDING IT. `ghCandidateList`
     branched on TRUTHINESS, so `AGENT_WORKFORCE_GH_CANDIDATES=""` meant "unset"
     and silently scanned /opt/homebrew/bin/gh and the other REAL paths. A
     sandboxed test setting the empty string to mean "no candidates" would reach
     the operator's machine, which is the same leak class as the unsandboxed store
     this file already had once. Fixed to `override === undefined`.

     My own perturbation caught that the fix had NO ARM: reverting it left the
     suite green. A fix with no guard is one edit from being undone silently.

     ⚠️ IT CAN ONLY DISCRIMINATE ON A MACHINE THAT HAS gh AT A DEFAULT PATH,
     and it SKIPS rather than passing when it cannot. Under the bug, `""` falls
     back to the defaults and answers "present" only if one of them is really
     runnable; with none installed both shapes answer "missing" and the arm would
     pass while proving nothing. A vacuous pass is what this whole file is about,
     so it reports skipped instead. */
  const gd = require('./engine/githubdevice.js');
  const { isRunnable } = require('./engine/runners.js');
  const DEFAULTS = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'];
  if (!DEFAULTS.some(isRunnable)) {
    t.skip('no gh at any default path on this machine, so the buggy and fixed shapes both answer ' +
      '"missing" and this arm cannot tell them apart. Not a pass.');
    return;
  }
  const beforeBin = process.env.AGENT_WORKFORCE_GH_BIN;
  const beforeCands = process.env.AGENT_WORKFORCE_GH_CANDIDATES;
  try {
    delete process.env.AGENT_WORKFORCE_GH_BIN;
    process.env.AGENT_WORKFORCE_GH_CANDIDATES = '';
    const empty = await gd.state();
    assert.strictEqual(empty.gh, 'missing',
      'an EMPTY AGENT_WORKFORCE_GH_CANDIDATES fell back to the real default paths and found gh ' +
      'on this machine. The override is being tested for truthiness rather than for being unset, ' +
      'so a test asking for "no candidates" reaches the operator\'s own installation.');
    // Control: a real executable through the same seam must still answer present,
    // or "missing" above would be the answer to everything.
    const f = fixture('gh');
    try {
      process.env.AGENT_WORKFORCE_GH_CANDIDATES = f.realBin;
      const one = await gd.state();
      assert.strictEqual(one.gh, 'present',
        'the candidates seam answered missing for a real executable, so the assertion above ' +
        'proves nothing');
    } finally { f.cleanup(); }
  } finally {
    if (beforeCands === undefined) delete process.env.AGENT_WORKFORCE_GH_CANDIDATES;
    else process.env.AGENT_WORKFORCE_GH_CANDIDATES = beforeCands;
    if (beforeBin !== undefined) process.env.AGENT_WORKFORCE_GH_BIN = beforeBin;
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
    /* 🛑 NO setProbeTtlForTests CALL HERE, AND THE ONE THAT USED TO BE WAS A
       SILENT NO-OP. It passed 0, and connect.js:341 is
       `PROBE_TTL_MS = Number.isFinite(ms) && ms > 0 ? ms : 60000`, so 0 falls
       straight back to the 60s default. The stated cache bypass never happened,
       and a later comment claimed it had leaked that 0 to whatever ran next,
       describing a state that never existed.
       ⚠️ A CALL THAT READS AS A GUARD AND DOES NOTHING is the exact class this
       file is about, committed inside it. Removed rather than "fixed" to a
       positive value, because the isolation these two arms need is already real:
       `probeCache` is keyed on `bin` and the arms use DIFFERENT paths, so neither
       can serve the other's cached answer. Saying that is honest; passing 0 was
       decoration. */

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
    /* ⚠️ setRunner(null) also sets DRY_RUN = true module-wide (connect.js:157)
       and nothing here restores it. Harmless in this file because no later arm
       calls run(), and noted rather than silently left: it is unrestored module
       state on a cleanup path. */
    connect.setRunner(null);
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

test('claudeHatchAvailable answers false when the resolver THROWS, rather than letting it escape', () => {
  /* Mona Lisa's finding, and this arm was a SOURCE check until a reviewer showed
     the throw can simply be driven. `claudeBinPath()` does a LATE
     `require('./runners').resolveBin(...)`, so the lookup happens at call time on
     the cached module object, and that object is already the seam. No new
     production surface.

     The defect: hoisting the resolution out of the try lets a resolver throw
     escape becomeStuck entirely, so writeState never runs and the person is left
     on NO SCREEN AT ALL, which breaks the docblock promise that any error answers
     false. Two blind reviewers hit this on her branch.

     ⭐ This asserts the CONSEQUENCE rather than the shape, so it survives refactors
     a shape check would red on, and it fails on the one thing that matters.

     ⚠️ ITS OWN DEPENDENCY, STATED: it works because `claudeBinPath` keeps the late
     `require(...)`. Tidying that into a top-level destructured import would
     silently unhook the seam and this arm would stop testing anything. */
  const connect = require('./engine/connect.js');
  const runners = require('./engine/runners.js');
  const realResolve = runners.resolveBin;
  try {
    runners.resolveBin = () => { throw new Error('resolver failed'); };
    let escaped = null;
    let answer;
    try { answer = connect.claudeHatchAvailable(); } catch (e) { escaped = e; }
    assert.strictEqual(escaped, null,
      'a throw from the runner resolver ESCAPED claudeHatchAvailable. It would escape becomeStuck ' +
      'too, so writeState never runs and the person is left on no screen at all. Keep the bin ' +
      'resolution INSIDE the try.');
    assert.strictEqual(answer, false, 'a resolver failure must answer false, not undefined');
  } finally {
    runners.resolveBin = realResolve;
  }
  // Control: with the resolver restored, the function still answers for a real path,
  // so the arm above is not passing because the function is inert.
  const f = fixture('claude');
  const before = process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  try {
    process.env.AGENT_WORKFORCE_CLAUDE_BIN = f.realBin;
    assert.strictEqual(connect.claudeHatchAvailable(), true,
      'the resolver was not restored, so every later arm is measuring a broken module');
  } finally {
    if (before === undefined) delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
    else process.env.AGENT_WORKFORCE_CLAUDE_BIN = before;
    f.cleanup();
  }
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
  /* 🛑 EVERY CODE LINE MENTIONING THE IDENTIFIER, PINNED. NOT A PROPERTY FORM,
     AND THE HISTORY OF THIS ONE MATCHER IS THE WHOLE ARGUMENT.

       writeState\({[^}]*canRunClaude[^}]*}   could not cross a NESTED `}`. That is
                                             the identical hazard this file's own
                                             WEAK_CALL docblock documents as
                                             `[^)]*`, re-committed by its author.
       canRunClaude\s*:\s*[^,}]+              keys on a COLON, so a SHORTHAND
                                             property has none:
                                                 writeState({ ..., canRunClaude })
                                             13 pass / 0 fail. A bracket-notation
                                             key is the same class.

     ⭐⭐ AND THE SHORTHAND IS NOT AN EXOTIC FORM: IT IS EXACTLY WHAT THIS LINE
     LOOKED LIKE ONE COMMIT AGO, before the extraction refactor. The matcher was
     blind to its own immediate predecessor, which is the second time on this
     branch that a guard could not see the shape the code had just had.
     ⇒ A perturbation matrix should include the shape the code had ONE COMMIT AGO.

     ✅ So this stops matching a FORM at all. Every non-comment line mentioning the
     identifier is pinned by exact text. A colon, a shorthand, a bracket key, a
     nested object and anything else all show up the same way: a line that is not
     one of these two.

     ⚠️ THE COST, STATED: it reds on reformatting either line. Same friction as
     KNOWN_WEAK_LINES above, same two-line fix, and it is the price of being
     independent of the syntax somebody chooses. */
  const src = fs.readFileSync(path.join(ENGINE, 'connect.js'), 'utf8');
  /* 🛑 KEY ON A CODE PROPERTY, NOT ON COMMENT-NESS, AND NOT ON A NUMBER.
     This assertion has had five shapes and the last four all failed the same way:
     each tried to recognise a SYNTAX or summarise a POPULATION.

       writeState\({[^}]*X[^}]*}   could not cross a nested `}`
       X\s*:\s*[^,}]+             blind to a shorthand property and a bracket key
       filtered set + a COUNT      blind to a prose-for-code SWAP: delete a
                                   docblock mention, add a hidden code line, and
                                   the total is unchanged. A count is a set with
                                   the identities thrown away.
       the whole set, unfiltered   correct, but reds on every docblock reword

     ⭐ THE COUNT NEVER FIXED THE ROOT CAUSE. The classifier was still wrong (a
     line that closes a block comment and then carries code is still filed as
     prose), and a number only made the UNBALANCED case loud. Splitting it into
     two buckets does not help either: the injected line is misclassified into the
     prose bucket and balances there too. A NUMBER CANNOT REPAIR A
     MISCLASSIFICATION, IT CAN ONLY MAKE ONE INSTANCE OF IT NOISY.

     ✅ So this classifies nothing. It keys on `writeState`, a property of the
     CODE rather than of the comment syntax: exactly one line may both mention the
     flag and write state. Measured on this file: 1 line has both, and although 9
     prose lines mention writeState, ZERO prose lines have both. Prose stays fully
     editable, which the unfiltered-set version cost.

     ⚠️ Its one gap, covered by the exact-text pin below: a multi-line writeState
     call with the property on its own line would have neither token together.

     🛑 THE RESIDUAL, RECORDED AT ITS TRUE WEIGHT AND NOT AS A BLOCKER. Every
     assertion here covers lines that SPELL the identifier. A reviewer defeated
     that with a writer that never spells it: an obfuscated key built by
     concatenation, a value stashed in a module variable, and the property merged
     inside writeState itself. Three coordinated edits, deliberately avoiding both
     the pinned line and connect.js:931.

     ⇒ It is real and it is NOT a finding, and the reason matters more than the
     demonstration. Every other defeat on this branch was reachable by an ordinary
     edit: the shorthand was the code's own previous shape, the comment-closer is
     a normal style, the per-key gap is a plain oversight, the prose-for-code swap
     is a plausible commit. THIS ONE IS SOMEBODY TRYING TO HIDE. A guard catches
     regressions and honest mistakes; no source assertion can beat concealment,
     and calling it a blocker would be the overclaiming this file spent seventeen
     review passes stamping out.

     📌 AND THE ATTACKING SHAPE IS DESCRIBED HERE, NEVER SHOWN, ON PURPOSE. A
     docblock cannot contain a comment closer without ending itself, and I broke
     this file exactly that way while trying to illustrate it. Please do not
     helpfully turn the description back into an example. It is the same shape as
     the defect itself, one level up: the artifact describing the hazard is
     subject to the hazard. */
  const writers = src.split('\n').map((l) => l.trim())
    .filter((l) => /\bcanRunClaude\b/.test(l) && /\bwriteState\b/.test(l));
  assert.deepStrictEqual(
    writers,
    ['writeState({ phase: PHASE.STUCK, because, tail: tail || null, startedOnce: true, canRunClaude: claudeHatchAvailable() });'],
    'the lines that both mention canRunClaude and call writeState changed. There must be exactly ' +
      'one, passing claudeHatchAvailable() straight through. A SECOND is a writer no arm drives, ' +
      'and it need not use a colon: `writeState({ ..., canRunClaude })` is shorthand and was this ' +
      'line\'s own previous shape, and a line beginning with a block-comment closer is live code ' +
      'too. NONE means the call went multi-line; re-aim this and the pin below together.'
  );

  /* 🛑 AND ONE MORE CHECK, BECAUSE THE TWO ABOVE HAVE COMPLEMENTARY BLIND
     SPOTS THAT COMPOSE. Neither hole is new; the composition is.

       the token-pair check   classifies nothing, but is LINE-LOCAL
       the exact-text pin     is not line-local, but CLASSIFIES

     A writer that is BOTH multi-line AND comment-prefixed is invisible to both:
     the property sits on its own line so the pair never co-occur, and that line
     opens with a comment marker so the pin filters it away.

       if (owner.retry) writeState({
         (an inline comment) canRunClaude: fs.existsSync(claudeBinPath()),
       });

     Measured: 13 pass / 0 fail, and the control (the same writer WITHOUT the
     inline comment) reds, so the comment is the mechanism and the multi-line
     shape alone is already covered.

     ⚠️ REALISM, WHICH IS WHY THIS IS FIXED AND THE CONCATENATED-KEY RESIDUAL ABOVE
     IS NOT: a multi-line writeState is ordinary formatting, an inline comment on
     a property is an ordinary comment, and nobody writing one would suspect it
     disables a guard. That is a plausible regression. The residual needs a
     deliberately obfuscated key and is somebody trying to hide.

     ⭐ YES, THIS IS A COUNT, AND A COUNT WAS THE DEFECT TWO SHAPES AGO. The
     distinction is the point rather than special pleading: THAT count summed TWO
     INDEPENDENT POPULATIONS, live code and docblock prose, so one could be traded
     for the other. THIS counts ONE HOMOGENEOUS population, and the thing counted
     is the thing that matters. A count over a homogeneous population of the
     relevant thing is sound; a count over a union of independent ones is not.

     🛑 FILE-WIDE, NOT SCOPED TO becomeStuck, AND I HAD IT SCOPED FIRST. Q's
     shape works ANYWHERE in the file: moved into submitCode, all three checks went
     green and the writer was live. Any writeState call carrying the field reaches
     the state publicView serves, and a retry path or helper elsewhere is an
     ordinary refactor. The file-wide count is STRICTLY STRONGER, since anything
     the scoped version caught adds a call file-wide too, so it replaces that
     rather than adding to it.

     ⚠️ Friction: a legitimate new writeState reds and needs this number bumped.
     Deliberate act, one-line fix, safe direction. A writeState( written in prose
     also inflates it, same friction KNOWN_WEAK_LINES already carries.

     📌 SECOND RESIDUAL, DOCUMENTED AND DELIBERATELY NOT GUARDED: ALIASING,
     AND IT NEEDS ALL THREE PROPERTIES AT ONCE. Measured: an aliased call that is
     ALSO multi-line AND comment-prefixed passes every check here, with all three
     counters unchanged (token pair 1, filtered set 2, writeState( 20). Any two of
     the three is caught: the single-line aliased form reds on the exact-text pin,
     and the un-aliased multi-line comment-prefixed form reds on the call count.

     ⚠️ I NEARLY RECORDED THIS AS COVERED. My first probe used the single-line
     aliased form, it went RED, and that red was for the WRONG REASON: the pin
     caught it because the property was not on a comment-prefixed line. A red that
     does not come from the mechanism you are testing is not a catch, and here it
     would have produced a FALSE claim of coverage rather than a false finding.

     🛑 AND IT IS DELIBERATELY NOT GUARDED. A probe for `= writeState` exists
     and works, and it is a FORM CHECK, a regex for one spelling, which is the
     exact class that has failed on this branch five times: it catches
     `const w = writeState` and misses `const { writeState: w } = ...` or
     `obj.w = writeState`. Adding it buys a narrow spelling and re-arms the trap
     this file spent eighteen passes disarming. Recorded beside the
     concatenated-key residual above: both are deliberate-evasion shapes needing
     several unusual choices at once, neither is a plausible regression, and no
     source assertion closes either. */
  /* 🛑 SCOPED TO becomeStuck, AND I HAD IT FILE-WIDE UNTIL A BLIND REVIEWER
     PRICED IT. Two reviewers gave me OPPOSITE advice here and both were right
     about their half, so this records the trade rather than pretending there was
     none.

       file-wide   catches a second writer ANYWHERE, including one placed in
                   another function, which the scoped version misses
       scoped      four independent tripwires on connect.js drop to two, and
                   connect.js is the most-edited file in this repo

     What decided it: THREE of the four branches the plan names as conflicting in
     connect.js are live on origin right now (willinstall-1556, live-1560-pete,
     live-check-1560, measured). A file-wide `writeState(` count reds for ANY of
     them, on a test named for #1592, in a file its author never opened, and the
     remedy it prints is "bump this number", which is the habit that trains people
     to clear reds without reading them. `tools/run-tests.sh`'s own header argues
     against exactly that.

     📌 SO THE THIRD RESIDUAL, RECORDED WITH THE OTHER TWO: a second writer placed
     OUTSIDE becomeStuck, multi-line, with the property comment-prefixed, is not
     caught. That needs a new writeState call AND multi-line formatting AND an
     inline comment on the property, the same deliberate multi-property shape as
     the concatenated key and the alias, and I am holding all three to one
     threshold rather than guarding whichever I happened to see last.

     ⚠️ WHAT WOULD CHANGE MY MIND: a second writeState carrying canRunClaude
     appearing in real review, or those conflicting branches landing so the
     friction argument expires. Either one, and file-wide is right again. */
  const fnAt = src.indexOf('function becomeStuck(');
  assert.ok(fnAt > 0, 'becomeStuck was renamed or removed; re-aim this guard');
  const nextFn = src.indexOf('\nfunction ', fnAt + 1);
  assert.ok(nextFn > fnAt, 'no top-level function follows becomeStuck; this bound is unanchored');
  const body = src.slice(fnAt, nextFn);

  const calls = body.match(/writeState\(/g) || [];
  assert.strictEqual(
    calls.length, 1,
    'becomeStuck makes ' + calls.length + ' writeState( calls, expected 1. A SECOND call can ' +
      'carry canRunClaude past the check below: put the property on its own line and prefix it ' +
      'with an inline comment, and a line-local check cannot see the pair while a ' +
      'comment-filtering one drops the line.'
  );

  /* The exact-text pin, now also scoped to becomeStuck. It catches the writer
     going multi-line, which the token-pair check above cannot see.

     📌 IT USED TO PIN publicView's `canRunClaude: s.canRunClaude || false` TOO,
     AND THAT WAS COUPLING SOMEBODY ELSE'S LINE. publicView is #1595's, already
     merged on main, and engine.publicview-canrun-1595.test.js pins it. A reformat
     by that card's owner would have redded a #1592 test with a message that never
     mentions publicView. Scoping to becomeStuck drops the coupling for free. */
  const lines = body.split('\n').map((l) => l.trim())
    .filter((l) => /\bcanRunClaude\b/.test(l) && !l.startsWith('*') && !l.startsWith('//') && !l.startsWith('/*'));
  assert.deepStrictEqual(
    lines,
    ['writeState({ phase: PHASE.STUCK, because, tail: tail || null, startedOnce: true, canRunClaude: claudeHatchAvailable() });'],
    'the code lines mentioning canRunClaude inside becomeStuck changed. It must pass ' +
      'claudeHatchAvailable() straight through: anything appended widens the answer AFTER the ' +
      'check, and a `|| fs.existsSync(p)` turns a DIRECTORY back into true.'
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
