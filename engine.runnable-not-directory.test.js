'use strict';
/**
 * #1592: `fs.accessSync(p, X_OK)` SUCCEEDS ON A DIRECTORY, so every hand-rolled
 * "is this runnable" check accepted a folder as an executable.
 * `engine/runners.js`'s `isRunnable` is the correct form and differs by one
 * line: `statSync(p).isFile()` before the access check.
 *
 * The branch repoints four sites onto `runners.isRunnable`, TWO OF THEM
 * TRANSITIVELY, and the distinction is not pedantic:
 *   devicedoor.js, githubdevice.js       call `isRunnable` directly
 *   connect.js willInstall,              ask `resolveBin('claude').present`, which
 *   connect.js claudeHatchAvailable      computes `present` with `isRunnable`
 *
 * 📌 `engine/firstrun.js` in this same branch spends a paragraph correcting
 * exactly this conflation, and the correction landed there and in neither of the
 * other two places that state it. Fixed as a class.
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
 *      shape must be in KNOWN_WEAK_CALLS. It cannot be fooled by a comment
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
   (`githubdevice.js`, where `DIR` and `FILE` are derived from `store.ROOT`), so `FILE` becomes
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
/* 🛑 THE SHIPPED HELPER, NOT A HAND-ROLLED COPY. `test-support/tmpdir.js`'s
   `mkTemp` exists for exactly this (#1402) and registers ONE exit handler per file.
   ⚠️ This file previously did `fs.mkdtempSync` plus its own `process.on('exit')`
   remover, WHILE CITING the same measured cost the helper was built to fix (200
   leaked sandbox dirs from a cleanup that never ran). Reimplementing the thing you
   are citing is the two-copies-of-one-fact defect this branch is named for. */
const { mkTemp } = require('./test-support/tmpdir.js');
const SANDBOX = mkTemp('kosmos-runnable-1592-');
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
 * 🛑 AND THE LARGEST GAP IS A DIFFERENT SPELLING ENTIRELY, WHICH THE FOUR ABOVE
 * DO NOT HINT AT: `fs.existsSync` IS A PRESENCE CHECK THAT ALSO ACCEPTS A
 * DIRECTORY, AND THIS MATCHER CANNOT SEE IT. `WEAK_CALL` requires `X_OK`, which
 * `existsSync` never carries. Live instances exist TODAY on the creation path
 * (`engine/create.js` in `setProvider`, `installJob` and `createAgentInner`, and
 * `engine/openaiaccounts.js`), carded as #1616 and deliberately out of scope here.
 *   ⇒ EXCLUDED BY DESIGN, NOT MISSED: widening to presence-checks generally would
 *   sweep hundreds of legitimate `existsSync` calls that have nothing to do with
 *   runnability, and the set would stop being a list somebody can audit.
 *   ⚠️ The four bullets above are all `accessSync` spellings, so a reader takes
 *   the class to BE accessSync. Naming this here is the file's own rule applied to
 *   itself: disclosing one gap is worse than disclosing none.
 *
 * ⚠️ AND THE FILE SELECTION HAS ITS OWN GAPS: `.js` only (no `.mjs`/`.cjs`, none
 * exist), `*.test.js` excluded, any directory named `dist` skipped, and any
 * dot-directory.
 *
 * ⭐ Disclosing one gap is worse than disclosing none: a reader takes the single
 * caveat as the complete list.
 */
/* ⚠️ BOTH ALTERNATIVES ARE LOAD-BEARING, and a review flagged the second as
   redundant. Measured before rejecting that: `access` alone does NOT match
   `fs.accessSync(bin, X_OK)`, because after `access` comes `Sync` rather than
   the `\s*\(` this pattern requires. Dropping either branch loses a real form. */
const WEAK_CALL = /(accessSync|access)\s*\(.*\bX_OK\b/;
/* The same shape, global, for collection. Kept as a separate binding because a
   /g regex carries lastIndex state and WEAK_CALL is also used with .test(). */
/* 🛑 DERIVED FROM WEAK_CALL, NOT RETYPED. It was written independently as a LAZY
   `.*?` while WEAK_CALL is GREEDY `.*`, so the sweep collected with one regex and
   the control asserted against the other: a control aimed at a matcher the sweep
   does not run, which is this file's own concern one level up. Deriving makes
   divergence impossible. */
const WEAK_CALL_ALL = new RegExp(WEAK_CALL.source, 'g');

/** Every non-test .js file in the repo, relative to REPO. */
function walkJs(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    /* Dot-directories skipped wholesale, matching the sibling walker in
       fixture-discipline.test.js. A stray .js under any dot-directory in somebody's
       worktree would otherwise red THIS sweep with a #1592 message that has nothing
       to do with the file. */
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
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
 * 📌 PINNED BY TEXT, NOT BY LINE NUMBER, AND THAT IS A CONSISTENCY FIX. This
 * pinned `file:line`, so ANY insertion above one of them turned it red. That is
 * strictly MORE exposed than the file-wide `writeState(` count this same file
 * rejected for exactly that reason: a count moves only when somebody adds a
 * writeState, a line number moves when anybody adds anything. Rejecting the
 * lesser friction while keeping the greater one was incoherent.
 * Keying on the trimmed line text is insertion-immune and keeps the identity the
 * deepStrictEqual needs; the failure message prints the LIVE line numbers, which
 * is what a reader actually wants. Two audit notes carrying stale numbers
 * (connect.js:931 and runners.js:206) are gone with it.
 */
/* 🛑 KEYED ON THE MATCHED CALL, NOT ON THE WHOLE LINE, AND THE REASON IS A COST
   THIS FILE ALREADY ACCEPTED ELSEWHERE AND FAILED TO APPLY HERE.
   Two of these four entries are PROSE. Pinning the whole trimmed line made
   rewording an ordinary comment sentence turn a test named for #1592 red, in
   `connect.js`, which this file elsewhere calls the most-edited file in the repo,
   on a branch whose author never opened this test. That is exactly the friction
   argument used above to scope the `writeState(` count to `becomeStuck` rather
   than the whole file; the argument was right there and was not applied here.

   Keying on `line.match(WEAK_CALL)[0]` keeps set equality and identity intact and
   makes only the CALL significant, so the prose around it is editable. Detection
   is unchanged: a new weak call produces a key not in this list, and a duplicate
   of an existing one produces a second entry the array comparison still catches.
   Verified by mutation in both directions rather than argued.

   📌 The values below are GENERATED, never transcribed. A table in this branch has
   been hand-written wrong four times. */
const KNOWN_WEAK_CALLS = [
  { file: 'engine/connect.js', call: 'accessSync(path, X_OK' },
  { file: 'engine/devicedoor.js', call: 'accessSync(X_OK' },
  { file: 'engine/machine.js', call: 'accessSync(bin, fs.constants.X_OK' },
  { file: 'engine/runners.js', call: 'accessSync(p, fs.constants.X_OK' },
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
        /* matchAll, not match: a line carrying TWO weak calls recorded only the
           first, and if that one was already pinned the second was invisible to a
           sweep whose entire value is completeness. */
        for (const m of line.matchAll(WEAK_CALL_ALL)) found.push({ file: key, call: m[0], line: i + 1 });
      });
  }

  const sortKey = (e) => e.file + '\u0000' + e.call;
  const seen = found.map((e) => ({ file: e.file, call: e.call })).sort((a, b) => sortKey(a) < sortKey(b) ? -1 : 1);
  const want = [...KNOWN_WEAK_CALLS].sort((a, b) => sortKey(a) < sortKey(b) ? -1 : 1);

  assert.deepStrictEqual(
    seen,
    want,
    'the set of accessSync(X_OK) lines changed. accessSync(X_OK) SUCCEEDS ON A DIRECTORY, so ' +
      'look at each new line and decide:\n' +
      '  a real call    -> use require("./runners").isRunnable(p)\n' +
      '  a call you are KEEPING -> pin it AND write a behavioural arm. Pinning alone proves ' +
      'nothing; that was measured and defeated.\n' +
      '  prose -> pin it too, and note the KEY is the matched call\n' +
      '           (line.match(WEAK_CALL_ALL)[0]), NOT the trimmed line\n' +
      'Live locations right now:\n  ' +
      found.map((e) => e.file + ':' + e.line).join('\n  ') + '\n'
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
  /* 🛑 THE SHIPPED HELPER HERE TOO. I left this on raw mkdtempSync earlier because
     it returns an explicit `cleanup` and leaked nothing, which was true and was the
     wrong test. A reviewer found the real window: the `rawSaysYes` assertion below
     runs AFTER the directory exists and BEFORE the caller receives the cleanup
     handle, so a failure there strands it with nothing registered to remove it.
     ⚠️ And this file's own header forbids exactly this pattern twelve lines above,
     citing the measured cost. I applied that rule to SANDBOX and not to fixture. */
  const dir = mkTemp('runnable-1592-');
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
     it (`githubdevice.js` records why, in the block above `ghPresent`), and the comment outlived it by four
     commits. It is the exact defect the plan writes up about itself, a
     description surviving the design it described and becoming a second source of
     truth, landed one file over from the warning. Caught by a blind reviewer; the
     branch named for having one definition of a fact. */
  /* 🛑 `githubdevice`, NOT `github`. These arms drive `githubdevice.state()`, which
     reaches `ghPresent` -- the byte-identical twin that is half the reason this card
     exists. `github.js`'s `state()` is `makeDoor`'s and never touches it.
     ⚠️ THIS BINDING WAS SWITCHED TO `github.js` TO SATISFY A NIT ABOUT WHERE
     `ghCandidateList` IS DEFINED, WHICH SILENTLY REPOINTED THESE TWO ARMS OFF THE
     TWIN AND LEFT `ghPresent` DRIVEN BY NO TEST IN THE REPO. Measured: weakening
     the lambda to `existsSync` then passed 14/14, fully green, and `existsSync` is
     explicitly outside WEAK_CALL so the sweep cannot see it either.
     📌 The "require it where it is defined" justification applies ONLY to the
     `ghCandidateList` arm below; neither of these calls it. */
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

test('an EMPTY candidates override means no candidates, not the real machine paths', () => {
  /* 🛑 THE ARM FOR A LEAK, AND ITS FIRST VERSION SHIPPED THE FIX UNGUARDED
     WHERE IT MATTERED. `ghCandidateList` branched on TRUTHINESS, so
     AGENT_WORKFORCE_GH_CANDIDATES="" meant "unset" and silently scanned
     /opt/homebrew/bin/gh and the other REAL paths. A sandboxed test asking for "no
     candidates" would reach the operator's own installation.

     My first arm drove `state()` through the env and could therefore only tell the
     fixed and broken shapes apart ON A MACHINE THAT HAS gh at a default path. It
     skipped honestly elsewhere, which is better than a vacuous pass and still
     meant the fix had NO ENFORCEMENT ON CI, the environment that actually gates
     merges. A guard that is present only where it is not needed is not a guard.

     ✅ `ghCandidateList` now takes the override as a parameter defaulting to the
     env, so this drives the real function with both values. The arm PINS that env
     var below, because the default parameter reads it and an ambient value would
     otherwise decide the control's answer. Production still calls `ghCandidateList()` and reads the env, so
     this exercises production's OWN branch rather than a substitute. That is
     devicedoor's property, and deliberately not the substituting seam this file
     removed earlier. */
  /* Required from `github.js`, WHERE IT IS DEFINED, not through githubdevice's
     re-export. Two exported names for one function is new public surface on a
     branch named for having one definition of a fact. */
  const gd = require('./engine/github.js');
  /* 🛑 PIN THE ENV BEFORE THE CONTROL. `ghCandidateList(undefined)` triggers the
     DEFAULT PARAMETER, which reads process.env.AGENT_WORKFORCE_GH_CANDIDATES. So
     the docblock above claiming this "needs nothing from the machine" was FALSE:
     with that variable set in the ambient environment the control asserts a
     different list and the empty-string assertion above it stops meaning anything.
     ⚠️ Machine luck in a CONTROL is the exact defect this arm exists to fix, one
     level up. The three sibling arms in this file already pin
     AGENT_WORKFORCE_GH_BIN for the same reason; this one did not. */
  const beforeCand = process.env.AGENT_WORKFORCE_GH_CANDIDATES;
  delete process.env.AGENT_WORKFORCE_GH_CANDIDATES;
  try {
  assert.deepStrictEqual(
    gd.ghCandidateList(''), [],
    'an EMPTY candidates override was treated as UNSET and fell back to the real default paths. ' +
    'The override is being tested for truthiness rather than for being undefined, so a test ' +
    'asking for "no candidates" reaches the operator\'s own gh installation.'
  );
  // Control: undefined MUST still give the real defaults, or "[]" above would be
  // the answer to everything and would prove nothing.
  assert.deepStrictEqual(
    gd.ghCandidateList(undefined),
    ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'],
    'an UNSET override no longer yields the default candidate paths, so the empty-string ' +
    'assertion above proves nothing'
  );
  } finally {
    if (beforeCand === undefined) delete process.env.AGENT_WORKFORCE_GH_CANDIDATES;
    else process.env.AGENT_WORKFORCE_GH_CANDIDATES = beforeCand;
  }
  // And a real override still splits, so the parameter is genuinely consulted.
  assert.deepStrictEqual(gd.ghCandidateList('/a:/b'), ['/a', '/b'],
    'the override is not being consulted at all');
});

test('githubdevice reports a DIRECTORY at the gh override as missing', async () => {
  /* The byte-identical twin of the devicedoor lambda, which is why fixing one
     file would not have found the other. `state()` is ASYNC: reading `.gh` off
     the promise gives undefined in BOTH arms, which looks like a result and is
     an instrument fault. Awaited here for that reason. */
  /* 🛑 `githubdevice`, NOT `github`. These arms drive `githubdevice.state()`, which
     reaches `ghPresent` -- the byte-identical twin that is half the reason this card
     exists. `github.js`'s `state()` is `makeDoor`'s and never touches it.
     ⚠️ THIS BINDING WAS SWITCHED TO `github.js` TO SATISFY A NIT ABOUT WHERE
     `ghCandidateList` IS DEFINED, WHICH SILENTLY REPOINTED THESE TWO ARMS OFF THE
     TWIN AND LEFT `ghPresent` DRIVEN BY NO TEST IN THE REPO. Measured: weakening
     the lambda to `existsSync` then passed 14/14, fully green, and `existsSync` is
     explicitly outside WEAK_CALL so the sweep cannot see it either.
     📌 The "require it where it is defined" justification applies ONLY to the
     `ghCandidateList` arm below; neither of these calls it. */
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

     ⚠️ ITS OWN DEPENDENCY, STATED, AND IT NAMED THE WRONG FUNCTION UNTIL NOW.
     This arm works because **claudeHatchAvailable** does its own late
     `require('./runners')`, so replacing the module object replaces what it
     reaches. It previously said `claudeBinPath`, which would have sent a
     maintainer to preserve the wrong thing: tidying claudeHatchAvailable's
     require into a top-level destructured import silently unhooks this arm, and
     the comment was pointing somewhere else entirely. */
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
     docblock promises any error answers false.
     🛑 THIS USED TO SAY THE BEHAVIOURAL CONSEQUENCE IS "untested ... a known gap
     rather than a covered one". THAT IS STALE, AND AN ARM SIXTY LINES ABOVE
     CONTRADICTS IT: `claudeHatchAvailable answers false when the resolver THROWS`
     drives exactly that, by swapping `runners.resolveBin` on the cached module
     object. The seam the sentence called nonexistent is the one that arm uses.
     Verified by mutation: hoisting the resolution out of the try reddens only that
     arm. THE GAP IS COVERED. */
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

     ⚠️ THE COST, STATED: it reds on reformatting either line, a one-line fix, and
     it is the price of being independent of the syntax somebody chooses.

     📌 THIS USED TO SAY "same friction as KNOWN_WEAK_CALLS above". IT NO LONGER IS:
     that list was re-keyed onto the matched CALL rather than the whole line, so
     rewording prose around it is free. The cost survives HERE because this pin is
     deliberately exact-text; it did not survive there. Corrected by the same change
     that removed it, rather than left to be found later. */
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
     the pinned line and the serving contract in `publicView`, which this file
     deliberately does not pin.

     ⚠️ THIS CITED `connect.js:931`, a blank line in a docblock. It is the only
     LIVE line-number pointer this file still carried, and it went stale on the
     rebase. The two numbers surviving above are quoting audit notes that were
     DELETED, so they are mentions rather than pointers and are correct as written;
     a sweep that does not separate those two reads three stale citations where
     there is one. Named by mechanism now, for the reason this file already gives
     when it rejects line numbers as keys: a line number moves when anybody adds
     anything.

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

     🛑 SUPERSEDED, AND KEPT ONLY AS HISTORY. THE SHIPPED CHECK IS SCOPED TO
     becomeStuck, NOT FILE-WIDE: it slices the function body and asserts exactly one
     `writeState(` call. The block roughly thirty lines below records the trade
     properly, including that a later blind reviewer priced the file-wide version and
     it lost, because four independent tripwires on connect.js drop to two and
     connect.js is the most-edited file in this repo.
     ⚠️ The paragraph that stood here argued the file-wide count was "STRICTLY
     STRONGER" and "replaces" the scoped one. It describes a design this branch does
     NOT ship, and the numbers it cited belong to that discarded shape. A reader
     trusting it would go looking for a file-wide assertion that is not there, which
     is the stale-record defect this file spends most of its comments warning about.

     ⚠️ Friction: a legitimate new writeState reds and needs this number bumped.
     Deliberate act, one-line fix, safe direction. A writeState( written in prose
     also inflates it, which IS a real cost here. It is no longer shared with
     KNOWN_WEAK_CALLS, which was re-keyed onto the matched call and is now immune to
     prose edits; this count is not.

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
  /* Matches `async function` too. It was `\nfunction ` only, which is correct
     today because `function submitCode(` follows becomeStuck, but inserting an
     ASYNC function there would silently widen the region to the next plain one.
     The failure direction was loud rather than silent, and matching both costs
     nothing. */
  const plainFn = src.indexOf('\nfunction ', fnAt + 1);
  const asyncFn = src.indexOf('\nasync function ', fnAt + 1);
  const nextFn = Math.min(plainFn === -1 ? Infinity : plainFn, asyncFn === -1 ? Infinity : asyncFn);
  assert.ok(Number.isFinite(nextFn) && nextFn > fnAt,
    'no top-level function follows becomeStuck; this bound is unanchored');
  /* 🛑 BOUNDED AT becomeStuck's OWN CLOSING BRACE, NOT AT THE NEXT DECLARATION.
     `nextFn` is the index of `\nfunction `, so slicing to it INCLUDES the docblock
     that belongs to the following function. Measured: 227 bytes of `submitCode`'s
     docblock sat inside the region. The count is unaffected today, so this was
     LATENT: a `writeState(` written in that neighbouring comment would have redded
     a test named for #1592 over a change belonging to another card.
     ⚠️ That is precisely the coupling the comment above says scoping removed, so
     the claim was true of the file axis and false of the boundary. Top-level
     functions close at column 0, so the last `\n}` in the slice is this one's. */
  const looseBody = src.slice(fnAt, nextFn);
  const closeAt = looseBody.lastIndexOf('\n}');
  assert.ok(closeAt > 0, 'becomeStuck has no column-0 closing brace; this bound is unanchored');
  const body = looseBody.slice(0, closeAt + 2);
  /* A bound that sliced to nothing would make a PLANTED writeState redden for the
     wrong reason, so assert the region is real rather than relying on the restore
     arm to notice. */
  assert.ok(body.includes('function becomeStuck(') && body.length > 200,
    `the becomeStuck region collapsed to ${body.length} bytes; the bound is wrong`);

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
  /* 🛑 `[:=]`, NOT `=` ALONE, AND MY OWN REFACTOR ORPHANED THIS ARM. It was
     written when becomeStuck ASSIGNED the flag; this branch then moved the write
     to an object PROPERTY (`canRunClaude: claudeHatchAvailable()`), and the arm
     went on passing while no longer defending the shape the code uses. Measured:
     it matched `canRunClaude = true;` and missed `canRunClaude: true,`.
     Adding the colon is free. Measured zero live hits in connect.js, because both
     real property lines start with an IDENTIFIER rather than a literal. It catches
     the literal half of the documented "second writer, comment-prefixed" residual;
     it does NOT catch the `fs.existsSync(...)` variant, so this narrows that gap
     rather than closing it. */
  const FORCED = /canRunClaude\s*[:=]\s*(?!false\b)(true\b|[1-9]\d*|['"`])/g;

  for (const [label, text] of [['raw', raw], ['prose-stripped', stripped]]) {
    const hits = (text.match(FORCED) || []);
    assert.deepStrictEqual(hits, [],
      `canRunClaude is assigned a truthy literal (${label} reading), which overrides the ` +
        'isRunnable check and leaves it dead:\n  ' + hits.join('\n  '));
  }

  // Controls: every shape that has defeated this arm before must be seen now.
  const mustCatch = [
    ['plain', '  canRunClaude = true;'],
    ['as a PROPERTY, the form the code now uses', '  canRunClaude: true,'],
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

/* ═══════════════════════════════════════════════════════════════════════════
   THE "NEVER REJECTS" CONTRACT, PINNED AT THE DOOR SITES TOO.

   🛑 THREE production changes on this branch are justified by devicedoor's
   `state()` "Never rejects" promise: the isRunnable hoists in devicedoor.js and
   githubdevice.js, and moving ghCandidateList into github.js so the getter calls
   a LOCAL function rather than a lazy require of githubdevice.

   ⚠️ ALL THREE CARRIED A "Measured, both arms" COMMENT AND ONLY ONE HAD AN ARM.
   The connect.js site got a real regression test; these two got prose. Measured:
   re-adding `require('./githubdevice')` inside github.js's getter passed the
   WHOLE SUITE, EXIT_CODE=0, fail 0. Nothing went red.

   ⇒ That is this branch's own "fixed one site, left its siblings" class, and
   also its own "the claim outlives the guard": my sentence about the property
   was stronger than any guard on it, and the sentence is what a maintainer
   trusts. These arms replace the sentence.
   ══════════════════════════════════════════════════════════════════════════ */
test('the gh door never rejects when runners fails to LOAD', async () => {
  const Module = require('module');
  const orig = Module._load;
  const door = require('./engine/github.js');
  /* 🛑 PIN THE gh ENV, OR THIS ARM EXECS THE OPERATOR'S REAL gh. With neither
     variable set, `ghBin()` falls through to the candidate scan, finds the real
     /opt/homebrew/bin/gh (measured), and `status()` runs
     `gh auth status --hostname github.com` against the operator's own keyring,
     with an 8s timeout, once per `state()` call.
     ⚠️ These arms shipped without it, which FALSIFIED the comment in
     githubdevice.js claiming no test reaches the real gh through the door. The
     getter and candidate-scan path is still exercised: the override is a real
     string, so ghCandidateList parses it and the scan runs and finds nothing. */
  const beforeBin = process.env.AGENT_WORKFORCE_GH_BIN;
  const beforeCands = process.env.AGENT_WORKFORCE_GH_CANDIDATES;
  delete process.env.AGENT_WORKFORCE_GH_BIN;
  process.env.AGENT_WORKFORCE_GH_CANDIDATES = path.join(SANDBOX, 'no-gh-here');
  /* CONTROL FIRST: with everything loadable it resolves, so a resolve below
     cannot be the answer to everything. */
  await assert.doesNotReject(() => door.state(), 'control: the door rejected with no fault injected');
  Module._load = function (req, ...rest) {
    if (req === './runners') throw new Error('simulated runners load failure');
    return orig.call(this, req, ...rest);
  };
  try {
    await assert.doesNotReject(() => door.state(),
      'a runners LOAD failure rejected door.state(), against devicedoor\'s "Never rejects". '
      + 'The isRunnable require was probably moved back inside the runnable lambda.');
  } finally {
    Module._load = orig;
    if (beforeBin === undefined) delete process.env.AGENT_WORKFORCE_GH_BIN;
    else process.env.AGENT_WORKFORCE_GH_BIN = beforeBin;
    if (beforeCands === undefined) delete process.env.AGENT_WORKFORCE_GH_CANDIDATES;
    else process.env.AGENT_WORKFORCE_GH_CANDIDATES = beforeCands;
  }
});

test('github.js does not reach BACK into githubdevice at call time', async () => {
  const Module = require('module');
  const orig = Module._load;
  const door = require('./engine/github.js');
  /* 🛑 PIN THE gh ENV, OR THIS ARM EXECS THE OPERATOR'S REAL gh. With neither
     variable set, `ghBin()` falls through to the candidate scan, finds the real
     /opt/homebrew/bin/gh (measured), and `status()` runs
     `gh auth status --hostname github.com` against the operator's own keyring,
     with an 8s timeout, once per `state()` call.
     ⚠️ These arms shipped without it, which FALSIFIED the comment in
     githubdevice.js claiming no test reaches the real gh through the door. The
     getter and candidate-scan path is still exercised: the override is a real
     string, so ghCandidateList parses it and the scan runs and finds nothing. */
  const beforeBin = process.env.AGENT_WORKFORCE_GH_BIN;
  const beforeCands = process.env.AGENT_WORKFORCE_GH_CANDIDATES;
  delete process.env.AGENT_WORKFORCE_GH_BIN;
  process.env.AGENT_WORKFORCE_GH_CANDIDATES = path.join(SANDBOX, 'no-gh-here');
  await assert.doesNotReject(() => door.state(), 'control: the door rejected with no fault injected');
  Module._load = function (req, ...rest) {
    if (req === './githubdevice') return {};   // the shape a cycle or failed load gives
    return orig.call(this, req, ...rest);
  };
  try {
    await assert.doesNotReject(() => door.state(),
      'github.state() rejected when githubdevice\'s exports were empty, so the candidates '
      + 'getter is reaching back into githubdevice. That recreates the cycle and the reject '
      + 'path; ghCandidateList must be called as a LOCAL function in github.js.');
  } finally {
    Module._load = orig;
    if (beforeBin === undefined) delete process.env.AGENT_WORKFORCE_GH_BIN;
    else process.env.AGENT_WORKFORCE_GH_BIN = beforeBin;
    if (beforeCands === undefined) delete process.env.AGENT_WORKFORCE_GH_CANDIDATES;
    else process.env.AGENT_WORKFORCE_GH_CANDIDATES = beforeCands;
  }
});

/* 🛑 A THIRD ARM WAS WRITTEN HERE FOR githubdevice.state() AND REMOVED, BECAUSE IT
   COULD NOT FAIL. Recording the measurement rather than the arm.

   `githubdevice.state()` wraps `ghPresent()` in its OWN try/catch (githubdevice.js,
   `async function state()`), so a throw from the runnable lambda is absorbed and
   `state()` resolves whatever happens underneath. Measured: with `./runners` made
   to throw at load, it resolved with `gh: "present"`; and mutating the hoist back
   into the lambda left the suite at 17 pass 0 fail.

   ⇒ THE HOIST IN githubdevice.js IS DEFENCE IN DEPTH, NOT THE THING THAT UPHOLDS
   THE CONTRACT THERE. The contract is upheld by that catch. The two arms above are
   different: they redden (2 fail and 1 fail respectively) because `github.js`'s
   door reaches devicedoor's `status()`, which calls `ghBin()` synchronously inside
   the promise executor with no catch of its own.

   ⚠️ This matters because the comment on that hoist said "Measured, both arms" and
   the claim was true of the OTHER two sites. Writing the arm is what showed the
   third was already guaranteed elsewhere. A green arm here would have implied a
   guard that does not exist. */

test('the REAL gh door honours the candidates override, which is the branch headline fix', () => {
  /* 🛑 THIS PINS THE CHANGE THE BRANCH IS FOR, AND NOTHING DID UNTIL NOW.
     Every other `ghBin()` assertion in this file drives a SYNTHETIC door built by
     `makeDoor({ candidates: [...] })` with a hand-passed array, so none of them
     touches `github.js`'s real door or its `get candidates()` getter. The two arms
     that do call the real `door.state()` assert only `doesNotReject`, which
     resolves either way.
     ⚠️ MEASURED: reverting the getter to the bare `GH_CANDIDATES` literal passed
     the WHOLE SUITE at EXIT_CODE=0, fail 0. The scope fix that three reviewers
     flagged was completely unpinned, and a comment in githubdevice.js claimed it
     was "proven end to end through door.ghBin(), four arms". That measurement was
     ad hoc in a shell; it was never an arm. */
  const door = require('./engine/github.js');
  const f = fixture('gh');
  const beforeBin = process.env.AGENT_WORKFORCE_GH_BIN;
  const beforeCands = process.env.AGENT_WORKFORCE_GH_CANDIDATES;
  delete process.env.AGENT_WORKFORCE_GH_BIN;   // or ghBin short-circuits before the scan
  try {
    process.env.AGENT_WORKFORCE_GH_CANDIDATES = f.realBin;
    assert.strictEqual(door.ghBin(), f.realBin,
      'the real door ignored AGENT_WORKFORCE_GH_CANDIDATES, so `candidates` is not going '
      + 'through the getter and the override reaches ghPresent only');

    process.env.AGENT_WORKFORCE_GH_CANDIDATES = f.asDirectory;
    assert.strictEqual(door.ghBin(), null,
      'a DIRECTORY was accepted as gh by the real door: either the getter is bypassed or '
      + 'the scan is not asking runners.isRunnable');
  } finally {
    if (beforeBin === undefined) delete process.env.AGENT_WORKFORCE_GH_BIN;
    else process.env.AGENT_WORKFORCE_GH_BIN = beforeBin;
    if (beforeCands === undefined) delete process.env.AGENT_WORKFORCE_GH_CANDIDATES;
    else process.env.AGENT_WORKFORCE_GH_CANDIDATES = beforeCands;
    f.cleanup();
  }
});
