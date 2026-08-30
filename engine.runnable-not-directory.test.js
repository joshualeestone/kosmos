'use strict';
/**
 * #1592: `fs.accessSync(p, X_OK)` SUCCEEDS ON A DIRECTORY, so every hand-rolled
 * "is this runnable" check accepted a folder as an executable.
 * `engine/runners.js`'s `isRunnable` is the correct form and differs by one
 * line: `statSync(p).isFile()` before the access check.
 *
 * 🛑 WHY THIS IS A SOURCE SWEEP AND NOT SIX MOCKED ARMS. The card asked for an
 * arm per site, and the reason is that fixing a SUBSET is a route change rather
 * than a behaviour change: harden the entry check, leave the post-install check
 * weak, and a directory simply takes a different path to the same wrong answer
 * (demonstrated on #1580). A per-site behavioural mock proves one site and says
 * nothing about the next one somebody adds. This asserts the CLASS: no engine
 * file may ask the weak question at all.
 *
 * 🛑 IT DOES NOT IGNORE COMMENTS. IT ACCOUNTS FOR THEM, AND THAT IS THE OPPOSITE
 * DESIGN. An earlier version of this header said it ignored them on purpose, and
 * that described four successive comment-strippers, all of which are gone: every
 * one had a hole in the direction that HIDES a call, because telling USE from
 * MENTION (#1570) by pattern is a parsing job and there is no parser here.
 *
 * ⇒ The sweep strips nothing. Every line in the repo matching the weak-call
 * shape must appear in the audited KNOWN_WEAK_LINES set, and any change to that
 * set fails.
 *
 * ⚠️ SO THE COST RUNS THE OTHER WAY, AND A READER WHO STOPS AT THIS HEADER MUST
 * NOT TAKE AWAY THE OLD ONE: writing a NEW comment that mentions
 * `accessSync(..., X_OK)` turns this test RED until the line is listed. That is
 * deliberate and loud, it is a two-line fix, and it makes somebody documenting
 * this defect notice they are documenting it. The reason this file's own prose
 * does not trip it is that the walk excludes `*.test.js`, not comment-blindness.
 *
 * 📌 That the mention problem is real is not hypothetical: while fixing #1592 I
 * twice read my own explanatory comment as an unfixed call site.
 *
 * ⭐ THE ARMS BELOW SPLIT THREE WAYS, AND THE SPLIT IS THE DESIGN. Review pass 8
 * defeated four of them by feeding the SOURCE something the source alone cannot
 * judge, so each arm now sits at the cheapest level that can answer it:
 *   SET       what matches the weak shape, compared whole, stripping nothing
 *   BEHAVIOUR a real call with a real directory, for every site that keeps a
 *             weak call: the only arm that proves a guard REACHES the call
 *             rather than merely appearing near it
 *   SOURCE    bounded to the region around a named anchor, never the whole file,
 *             because "somewhere in this file" was defeated by appending a
 *             string at EOF
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
 * 🛑 `.*`, NOT `[^)]*`, AND THIS IS THE WHOLE BUG THIS GUARD ALMOST SHIPPED
 * WITH. `[^)]*` cannot cross a nested `)`, so it is blind to any call whose
 * first argument is itself a call. Measured at the merge base: it saw
 * `fs.accessSync(bin, X_OK)` at connect.js:434 and MISSED
 * `fs.accessSync(claudeBinPath(), fs.constants.X_OK)` at connect.js:2082,
 * which is one of the sites this very branch fixes. Reverting that fix left
 * every test in this file green.
 *
 * ⭐ The control below was equally blind, because it planted only the simple
 * shape: it exercised the arm that already worked. A control aimed at the
 * working arm is not a control, which is why both now come from this constant
 * and why the control plants the nested shape too.
 *
 * ⚠️ WHAT IT STILL CANNOT SEE, LISTED IN FULL RATHER THAN PARTLY. Each accepts
 * a directory exactly as the fixed form did, and none exists in the repo today,
 * so these are coverage gaps rather than live defects:
 *   - a call split across two lines (this is line-based)
 *   - `fs.accessSync(bin, X)` where `const X = fs.constants.X_OK`
 *   - `fs.accessSync(bin, 1)`, the numeric mode
 *
 * ⚠️ AND THE FILE SELECTION HAS ITS OWN GAPS, listed here because a caveat list
 * that covers only the matcher reads as covering the sweep: `.js` only (no
 * `.mjs` or `.cjs`; none exist today), `*.test.js` excluded, and any directory
 * named `dist` at any depth skipped.
 * The async spellings `fs.access(...)` and `fs.promises.access(...)` ARE now
 * covered by the `access` alternation above.
 *
 * ⭐ Disclosing only one gap, as an earlier version did, is worse than
 * disclosing none: a reader takes the single caveat as the complete list.
 */
/* ⚠️ BOTH ALTERNATIVES ARE LOAD-BEARING, and a review flagged the second as
   redundant. Measured before rejecting that: `access` alone does NOT match
   `fs.accessSync(bin, X_OK)`, because after `access` comes `Sync` rather than
   the `\s*\(` this pattern requires. Dropping either branch loses a real form.
     sync form      accessOnly=false  syncOnly=true
     async form     accessOnly=true   syncOnly=false */
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
 * A line that is unambiguously prose: it opens with a comment marker.
 *
 * ⚠️ IT HAD NO CONSUMER FOR ONE ITERATION and three assertions tested it anyway,
 * which is a test of nothing. It now classifies KNOWN_WEAK_LINES entries, which
 * is the one judgement it is actually safe to make: a line that OPENS with a
 * comment marker cannot be a live call, whatever follows it.
 */
function isProseLine(line) {
  return /^\s*(\/\/|\/\*|\*)/.test(line);
}

/**
 * Drop prose so the PRESENCE guards below cannot be answered by a comment.
 *
 * 🛑 ORDER MATTERS AND GETTING IT WRONG COST AN ARM. Removing whole-line prose
 * FIRST discards `/* belt *\/ canRunClaude = true;` entirely, because that line
 * opens with a comment marker while carrying live code after the closer. So:
 * remove complete block comments and a trailing line comment first, and only
 * then decide whether what remains is prose.
 *
 * ⚠️ OVER-STRIPPING IS THE SAFE DIRECTION FOR PRESENCE, AND THE DANGEROUS ONE
 * FOR ABSENCE. That distinction was missing here for one iteration and it cost
 * a real hole: the override arm asserts a line is ABSENT, and it consumed this,
 * so `const docs = 'https://x'; canRunClaude = true;` was truncated at `https:`
 * and the override vanished. connect.js is full of URLs. The `//` inside a
 * string is not a comment and nothing here can tell the difference.
 *
 * ⇒ EVERY CONSUMER OF THIS FUNCTION MUST ASSERT PRESENCE. The absence arm now
 * reads RAW source and accepts a loud false red on commented-out code, which is
 * a two-line fix for whoever writes that comment. Measured before choosing it:
 * zero lines in connect.js match the override shape in raw source today.
 */
function noProse(src) {
  return src
    .split('\n')
    .map((l) => {
      const bare = l.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/, '');
      return bare.trim() === '' || /^\s*\*/.test(l) ? '' : bare;
    })
    .join('\n');
}

/**
 * Every line in the repo that matches the weak-call shape, as it stands today,
 * each declaring WHICH KIND it is.
 *
 * 🛑 A SET, NOT A CLASSIFIER, AND THE MEASUREMENT THAT FORCED THIS IS BLUNT.
 * Eight review passes over this branch produced 39 findings. EVERY ONE was in
 * this guard; NOT ONE was in the four production call sites it protects. The
 * guard reached 471 lines to defend a 60-line change, and each layer added to
 * make it cleverer became the next pass's defect: four comment-strippers, a
 * file-scoped exemption that depended on where you planted a call, a window,
 * and three regexes defeatable by a trailing comment.
 *
 * ⇒ The machinery was trying to DECIDE whether each match is prose, a guarded
 * call, or a defect. That is a parsing job, there is no parser here, and every
 * heuristic for it failed in the direction that hides a defect. So it does not
 * decide. It pins the exact set, and any change to the set goes red.
 *
 * 🛑 BUT PINNING ALONE MADE LISTING THE WHOLE JUSTIFICATION, WHICH IS WORSE
 * THAN THE CLASSIFIER IT REPLACED. Measured in review pass 8: add a genuinely
 * unguarded `fs.accessSync(dir, X_OK)` in a new file, add its line here -- the
 * exact remediation the failure message advises -- and every arm went green. An
 * entry was a claim about a line with nothing behind it.
 *
 * ✅ SO AN ENTRY MUST NOW DECLARE ITS KIND, AND EACH KIND IS CHECKED BY
 * SOMETHING THAT IS NOT THIS LIST:
 *   prose    the RAW line must open with a comment marker. A live call cannot
 *            be smuggled in under this word.
 *   guarded  the file must appear in BEHAVIOURAL_ARMS below, i.e. somebody
 *            wrote a test that hands the real code a real directory. Listing
 *            is no longer sufficient; the arm is.
 *
 * ⚠️ THE COST, STATED: touching any of these four lines, or adding a fifth,
 * fails until this list is updated -- and if the new line is a real call, until
 * a behavioural arm exists for it. That is more than two lines of work, and it
 * is deliberately more: the two-line version is what pass 8 defeated.
 *
 * 📌 The PRESENCE guards below are not replaced by this and must stay: this set
 * cannot see a repoint to `fs.existsSync`, which is the same defect in a
 * different literal (#1616), nor an override, nor a hoist out of the try.
 * Measured: all three of those pass this sweep and are caught only by those arms.
 *
 * ⚠️ KNOWN FRICTION, AND IT IS THE FAILURE MODE TO WATCH: a line number reds on
 * any insertion above it, four live branches touch connect.js, so this will fire
 * on most rebases. Each red trains a "just bump the number" reflex, and that
 * reflex is exactly what the `kind` check exists to survive -- bumping a number
 * is still safe, because a bumped `prose` entry is re-checked against the raw
 * line it now points at.
 */
const KNOWN_WEAK_LINES = [
  { at: 'engine/connect.js:931', kind: 'prose' },
  { at: 'engine/devicedoor.js:33', kind: 'prose' },
  { at: 'engine/machine.js:412', kind: 'guarded' },
  { at: 'engine/runners.js:206', kind: 'guarded' },
];

/**
 * A file keeping a weak call may only do so if a test in THIS file hands the
 * real code a real directory and watches it answer no.
 *
 * 🛑 THIS EXISTS BECAUSE A TOKEN SEARCH PROVED THE WRONG THING. The previous arm
 * asserted `isFile(` appeared within 20 lines above the call. Measured in review
 * pass 8: delete ONLY the `continue;` from machine.js's
 * `if (!st.isFile()) { ...; continue; }` and a directory falls through to the
 * accessSync below and sets `present[key] = true` -- the exact #1592 defect --
 * with the token still there and all arms green.
 *
 * ⇒ A guard being PRESENT and a guard REACHING the call are different claims,
 * and only the second is the one anybody cares about. No source pattern
 * available here can tell them apart. Running the code can.
 *
 * ⚠️ The names are asserted to exist as tests below, so a file cannot be
 * registered as covered by inventing an arm name. What that check cannot catch
 * is an arm that exists and asserts nothing; that is a human review job and it
 * is visible in the diff.
 */
const BEHAVIOURAL_ARMS = {
  'engine/machine.js': 'installedCheck answers NOT PRESENT for a directory named like the binary',
  'engine/runners.js': 'isRunnable rejects a directory and accepts a real executable',
};

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
    KNOWN_WEAK_LINES.map((e) => e.at).sort(),
    'the set of accessSync(X_OK) lines changed. accessSync(X_OK) SUCCEEDS ON A ' +
      'DIRECTORY, so look at each new line and decide:\n' +
      '  a real call    -> use require("./runners").isRunnable(p)\n' +
      '  a call you are keeping -> add { kind: "guarded" } AND a behavioural arm\n' +
      '  prose, or a moved line -> add or update the entry\n' +
      'Audited today: connect.js:931 prose, devicedoor.js:33 prose, ' +
      'machine.js:412 guarded by st.isFile() two lines above, ' +
      'runners.js:206 IS the definition.\n'
  );
});

test('every audited entry is what it claims to be, so listing is not the whole justification', () => {
  /* 🛑 THE HOLE THIS CLOSES, MEASURED IN REVIEW PASS 8: adding a genuinely
     unguarded call in a new file and listing its line -- the exact remediation
     the sweep's failure message advises -- made every arm pass. The list was
     self-certifying.

     Neither branch below can be satisfied by editing the list:
       prose   is checked against the RAW line, which cannot be a live call
       guarded is checked against BEHAVIOURAL_ARMS, which is checked against the
               test names actually declared in this file */
  const own = fs.readFileSync(__filename, 'utf8');

  for (const entry of KNOWN_WEAK_LINES) {
    const [rel, lineNo] = entry.at.split(':');
    const src = fs.readFileSync(path.join(REPO, rel.split('/').join(path.sep)), 'utf8').split('\n');
    const raw = src[Number(lineNo) - 1];
    assert.ok(raw !== undefined, `${entry.at}: line does not exist; the entry is stale`);
    assert.ok(WEAK_CALL.test(raw), `${entry.at}: no longer matches the weak call; the entry is stale`);

    if (entry.kind === 'prose') {
      assert.strictEqual(
        isProseLine(raw),
        true,
        `${entry.at} is listed as prose but the raw line is not a comment:\n  ${raw.trim()}\n` +
          'A live call cannot be excused by listing it. Repoint it to ' +
          'require("./runners").isRunnable(p), or mark it guarded and write a behavioural arm.'
      );
    } else if (entry.kind === 'guarded') {
      assert.strictEqual(
        isProseLine(raw),
        false,
        `${entry.at} is listed as guarded but the raw line is a comment; mark it prose`
      );
      assert.ok(
        Object.prototype.hasOwnProperty.call(BEHAVIOURAL_ARMS, rel),
        `${rel} keeps a weak accessSync(X_OK) call and has NO behavioural arm. ` +
          'Listing the line is not enough: a token near a call does not prove the guard ' +
          'reaches it (deleting one `continue;` was measured to defeat exactly that). ' +
          'Write a test that hands the real code a real directory, then register it in ' +
          'BEHAVIOURAL_ARMS.'
      );
    } else {
      assert.fail(`${entry.at}: kind must be "prose" or "guarded", got ${JSON.stringify(entry.kind)}`);
    }
  }

  const guardedFiles = KNOWN_WEAK_LINES.filter((e) => e.kind === 'guarded').map((e) => e.at.split(':')[0]);
  assert.deepStrictEqual(
    [...new Set(guardedFiles)].sort(),
    Object.keys(BEHAVIOURAL_ARMS).sort(),
    'BEHAVIOURAL_ARMS and the guarded entries have drifted apart. Every file keeping a ' +
      'weak call needs an arm, and an arm for a file that no longer keeps one is dead weight.'
  );

  for (const [file, armName] of Object.entries(BEHAVIOURAL_ARMS)) {
    assert.ok(
      own.includes(`test('${armName}'`),
      `BEHAVIOURAL_ARMS names "${armName}" for ${file}, and no test by that name exists in ` +
        'this file. A registry entry is not an arm.'
    );
  }
});

test('the sweep can actually find a weak call, so an empty result means something', () => {
  // The control the assertion above is worthless without: plant the exact shape
  // and confirm the matcher sees it. Without this, a broken regex reads as clean.
  const planted = 'try { fs.accessSync(bin, fs.constants.X_OK); } catch {}';
  assert.ok(WEAK_CALL.test(planted), 'the matcher cannot see a weak call');
  /* The shape that actually existed in this repo and that the first version of
     this matcher was blind to. Planting only the simple form above tested the
     arm that already worked. */
  const nested = 'fs.accessSync(claudeBinPath(), fs.constants.X_OK);';
  assert.ok(WEAK_CALL.test(nested), 'the matcher is blind to a nested-call argument');
  const joined = "fs.accessSync(path.join(dir, 'claude'), fs.constants.X_OK);";
  assert.ok(WEAK_CALL.test(joined), 'the matcher is blind to a path.join() argument');
  // And it must still NOT fire on a different mode.
  assert.ok(!WEAK_CALL.test('fs.accessSync(bin, fs.constants.R_OK)'), 'the matcher over-fires on R_OK');
  // isProseLine classifies KNOWN_WEAK_LINES entries above, so both directions matter.
  assert.strictEqual(isProseLine('  fs.accessSync(bin, fs.constants.X_OK);'), false,
    'isProseLine calls real code prose, which would let a live call be listed as prose');
  assert.strictEqual(isProseLine('   * a comment about accessSync'), true,
    'isProseLine does not recognise a continuation comment line');
  const commented = '// fs.accessSync(bin, fs.constants.X_OK) succeeds on a directory';
  assert.strictEqual(
    isProseLine(commented),
    true,
    'a comment mentioning the call must be recognisable as prose (#1570)'
  );
});

test('isRunnable rejects a directory and accepts a real executable', () => {
  const { isRunnable } = require('./engine/runners.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runnable-1592-'));
  try {
    // The defect itself, asserted so the rest is not arguing with a phantom.
    let rawSaysYes = false;
    try { fs.accessSync(dir, fs.constants.X_OK); rawSaysYes = true; } catch { rawSaysYes = false; }
    assert.strictEqual(rawSaysYes, true, 'a directory no longer passes X_OK; this card is moot');

    assert.strictEqual(isRunnable(dir), false, 'isRunnable accepted a DIRECTORY');

    const bin = path.join(dir, 'thing');
    fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(bin, 0o755);
    assert.strictEqual(isRunnable(bin), true, 'isRunnable rejected a real executable');

    const notExec = path.join(dir, 'plain');
    fs.writeFileSync(notExec, 'x');
    fs.chmodSync(notExec, 0o644);
    assert.strictEqual(isRunnable(notExec), false, 'isRunnable accepted a non-executable file');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('installedCheck answers NOT PRESENT for a directory named like the binary', () => {
  /* 🛑 THE ARM THAT REPLACES A TOKEN SEARCH, AND THE MEASUREMENT THAT DEMANDED
     IT. machine.js keeps its `fs.accessSync(bin, X_OK)` and is correct only
     because `if (!st.isFile()) { ...; continue; }` sits two lines above it. The
     previous guard asserted the string `isFile(` appeared within 20 lines. Delete
     ONLY the `continue;` and a directory sets present=false, falls through, passes
     X_OK, and is overwritten to present=true -- the original defect, with the
     token intact and every arm green.

     ⇒ This calls the real function with a real directory. It cannot be satisfied
     by a token, a comment, or a listing, and it fails on any edit that breaks the
     guard's REACH rather than its presence.

     📌 It also pins the true arm: a real executable at the same path must come
     back present, or "always false" would pass. */
  const { installedCheck } = require('./engine/machine.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runnable-1592-machine-'));
  try {
    const asDirectory = path.join(dir, 'claude');
    fs.mkdirSync(asDirectory);
    const realBin = path.join(dir, 'realbin');
    fs.writeFileSync(realBin, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(realBin, 0o755);

    // The defect itself, so this arm is not arguing with a phantom.
    let rawSaysYes = false;
    try { fs.accessSync(asDirectory, fs.constants.X_OK); rawSaysYes = true; } catch { rawSaysYes = false; }
    assert.strictEqual(rawSaysYes, true, 'a directory no longer passes X_OK; this card is moot');

    const onDir = installedCheck({ claudeBin: asDirectory, tmuxBin: realBin, codexBin: realBin });
    assert.strictEqual(
      onDir.present.claude,
      false,
      'installedCheck reported a DIRECTORY as a present binary. The `if (!st.isFile())` ' +
        'guard above the accessSync in engine/machine.js no longer reaches the call -- ' +
        'check that it still ends the iteration rather than merely setting a value.'
    );

    const onFile = installedCheck({ claudeBin: realBin, tmuxBin: realBin, codexBin: realBin });
    assert.strictEqual(
      onFile.present.claude,
      true,
      'installedCheck reported a real executable as absent, so the arm above proves nothing'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Mona Lisa's finding, carried over from her parallel #1592 branch before she
 * stood down. TWO BLIND REVIEWERS HIT THIS ON HER VERSION, which is why it is
 * pinned here rather than trusted to the next reader.
 *
 * `canRunClaude` exists so the stuck screen can say whether the binary is
 * runnable, and its docblock promises "any error answers FALSE". That promise
 * holds only while the BIN RESOLUTION is inside the try: `claudeBinPath()` can
 * throw, and hoisting it into a bare `const` above the try lets the throw
 * escape `becomeStuck` entirely, so `writeState` never runs and the person is
 * left on no screen at all.
 *
 * ⚠️ THE FAILURE IS INVISIBLE TO A BEHAVIOURAL TEST that does not force a
 * throw from the resolver, and it is a tempting refactor: reading the value out
 * first reads cleaner. So this asserts the SHAPE.
 */

test('canRunClaude resolves the bin INSIDE its try, so a throw still writes the stuck screen', () => {
  const src = noProse(fs.readFileSync(path.join(ENGINE, 'connect.js'), 'utf8'));
  const anchor = src.indexOf('let canRunClaude = false;');
  assert.ok(anchor > 0, 'canRunClaude was renamed or removed; re-aim this guard');

  const region = src.slice(anchor, anchor + 600);
  const tryAt = region.indexOf('try {');
  const catchAt = region.indexOf('} catch');
  assert.ok(tryAt > -1 && catchAt > tryAt, 'canRunClaude is no longer wrapped in a try/catch');

  const guarded = region.slice(tryAt, catchAt);
  assert.ok(
    /claudeBinPath\s*\(|resolveBin\s*\(/.test(guarded),
    'the bin resolution has moved OUTSIDE canRunClaude\'s try. A throw from it now ' +
      'escapes becomeStuck and the stuck screen is never written, which breaks the ' +
      'docblock promise that any error answers false. Keep the resolution inside the try.'
  );
});


test('a repointed site cannot be silently overridden by a later unconditional assignment', () => {
  /* 🛑 THE HOLE A SOURCE SWEEP CANNOT SEE, AND I NEARLY SHIPPED IT.
     `canRunClaude = require('./runners').isRunnable(claudeBinPath());` followed
     by a leftover `canRunClaude = true;` passes the sweep (no weak call remains)
     AND passes the shape guard (the try/catch is intact), while the check is
     dead and the value is always true. That is what happens when you replace one
     line of a two-line pair and not the other, which is exactly the edit this
     branch makes four times.

     ⭐ So this asserts the ABSENCE of the override rather than the presence of
     the fix. Presence proves the call is written; only absence proves nothing
     undoes it.

     🛑 AND BECAUSE IT ASSERTS ABSENCE IT READS RAW SOURCE, WHICH IS THE OPPOSITE
     OF EVERY OTHER ARM IN THIS FILE. Measured in review pass 8: it used to
     consume `noProse`, and `const docs = 'https://x'; canRunClaude = true;` went
     green, because the `//` inside the string truncated the line at `https:`.
     connect.js is full of URLs. Over-stripping is safe for a PRESENCE assertion
     and is precisely the dangerous direction for an ABSENCE one.

     ⚠️ THE PRICE, ACCEPTED DELIBERATELY: a commented-out `canRunClaude = true;`
     now turns this red. That is loud, it is a two-line fix, and it is the right
     trade against a live override reading as clean. Measured before choosing it:
     zero raw lines in connect.js match this shape today.

     ⚠️ GAP, DISCLOSED BECAUSE THE OTHER LISTS IN THIS FILE ARE: it matches at a
     STATEMENT boundary (line start, `;` or `{`), which was widened from a
     line-start anchor after that anchor was measured to miss
     `/* belt *\/ canRunClaude = true;` and a same-line double assignment. Still
     invisible: `if (x) canRunClaude = true;` and a compound assignment.
     🛑 AND IT MATCHES `= true` ONLY, NARROWED ON EVIDENCE AFTER A FALSE RED.
     Widening to a statement boundary while still matching `(true|false)` fired
     on the legitimate `} catch { canRunClaude = false; }` at connect.js:2106.
     The narrowing is by DIRECTION rather than by syntax: assigning FALSE can
     never make a directory pass, so it is not the override this guard exists
     for. Only `= true` defeats the check.
     📌 Dropping the anchor entirely would also match `let canRunClaude = false;`.
     Neither of the invisible forms exists today. */
  const src = fs.readFileSync(path.join(ENGINE, 'connect.js'), 'utf8');
  const overridden = src.match(/(^|[;{])\s*canRunClaude\s*=\s*true\s*;/gm) || [];
  assert.deepStrictEqual(
    overridden,
    [],
    'canRunClaude is assigned a literal, which would override the isRunnable check:\n  ' +
      overridden.join('\n  ')
  );

  // Control: the matcher must be able to SEE such an assignment, or the [] above
  // is worthless. Same shape, planted, including the string-URL form that
  // defeated the noProse version of this arm.
  const planted = '  canRunClaude = require("./runners").isRunnable(p);\n  canRunClaude = true;\n';
  assert.strictEqual(
    (planted.match(/(^|[;{])\s*canRunClaude\s*=\s*true\s*;/gm) || []).length,
    1,
    'the override matcher cannot see a planted override, so its empty result means nothing'
  );
  const withUrl = "  const docs = 'https://x'; canRunClaude = true;\n";
  assert.strictEqual(
    (withUrl.match(/(^|[;{])\s*canRunClaude\s*=\s*true\s*;/gm) || []).length,
    1,
    'the override matcher is defeated by a `//` inside a string on the same line, which ' +
      'is the exact defect reading raw source was meant to fix'
  );
});


test('the two lambda sites delegate to runners.isRunnable rather than re-implementing it', () => {
  /* The sweep catches a revert to accessSync(X_OK). It does NOT catch a revert
     to some other weak spelling of the same question, and the repo already
     contains one such spelling: engine/create.js gates on fs.existsSync, which
     accepts a directory exactly as accessSync(X_OK) does. Carded separately.

     So for the two sites whose fix is a one-line lambda, assert the delegation
     positively. devicedoor and githubdevice were byte-identical twins before
     this branch and are the easiest pair to silently diverge again.

     ⚠️ EXACTLY ONE LAMBDA PER FILE, ASSERTED. `String.match` without /g returns
     the FIRST match, so a decoy `const runnable = (p) => isRunnable(p)` appended
     anywhere after a reverted real site would be the one tested. That is the same
     "somewhere in this file" hole review pass 8 opened on the connect.js arm by
     appending a string at EOF; it is closed here by counting rather than by
     region, because these sites have no stable enclosing anchor. */
  for (const f of ['devicedoor.js', 'githubdevice.js']) {
    const src = noProse(fs.readFileSync(path.join(ENGINE, f), 'utf8'));
    const all = src.match(/const\s+runnable\s*=\s*\(([^)]*)\)\s*=>\s*([^;\n]+)/g) || [];
    assert.strictEqual(
      all.length,
      1,
      `${f}: expected exactly one \`const runnable = ...\` lambda, found ${all.length}. ` +
        'Zero means the site was renamed or removed; more than one means the arm below ' +
        'would test whichever came first and a reverted site could hide behind a decoy.'
    );
    const m = src.match(/const\s+runnable\s*=\s*\(([^)]*)\)\s*=>\s*([^;\n]+)/);
    assert.match(
      m[2],
      /(require\(['"]\.\/runners['"]\)\.isRunnable|(?<![.\w])isRunnable)\s*\(/,
      `${f}: the runnable lambda no longer delegates to runners.isRunnable, it is \`${m[2].trim()}\``
    );
  }
});


test('the two connect.js sites delegate to runners.isRunnable, positively asserted', () => {
  /* 🛑 MEASURED HOLE THIS CLOSES. The sweep catches a revert to
     accessSync(X_OK). It does NOT catch a revert to a DIFFERENT weak spelling,
     and this repo contains one: engine/create.js gates on fs.existsSync, which
     accepts a directory exactly the same way (#1616).

     Verified against all three connect.js-facing guards before this arm existed:
       canRunClaude = fs.existsSync(claudeBinPath())   sweep pass, shape pass, override pass
       willInstall: if (!fs.existsSync(bin)) return true   pass, pass, pass
     So both sites could be silently un-fixed. The lambda sites already had a
     positive assertion; these two, the harder pair, did not.

     🛑 AND IT SEARCHED THE WHOLE FILE, WHICH MADE IT DEFEATABLE. Measured in
     review pass 8: revert BOTH sites to existsSync, append one string at EOF
     containing the token, and this went 8 pass / 0 fail while a directory passed
     again at both sites. "The token exists somewhere in connect.js" is not the
     claim; "this call site delegates" is.

     ✅ So each site is now anchored and bounded, the same shape the try/catch
     guard above already used. A match outside its own region does not count.

     ⚠️ Absence-based guards cannot cover this. Only a POSITIVE assertion that the
     right call is present can, which is why this is a separate arm rather than
     another thing the sweep looks for. */
  const src = noProse(fs.readFileSync(path.join(ENGINE, 'connect.js'), 'utf8'));
  const sites = [
    {
      what: "willInstall's presence check",
      anchor: 'async function willInstall(',
      span: 1200,
      re: /if\s*\(\s*!\s*require\(['"]\.\/runners['"]\)\.isRunnable\s*\(/,
    },
    {
      what: 'becomeStuck canRunClaude',
      anchor: 'let canRunClaude = false;',
      span: 600,
      re: /canRunClaude\s*=\s*require\(['"]\.\/runners['"]\)\.isRunnable\s*\(/,
    },
  ];
  for (const site of sites) {
    const at = src.indexOf(site.anchor);
    assert.ok(
      at > 0,
      `${site.what}: the anchor \`${site.anchor}\` is gone, so this guard is aimed at nothing. ` +
        'Re-aim it at whatever the site is called now.'
    );
    assert.strictEqual(
      src.indexOf(site.anchor, at + 1),
      -1,
      `${site.what}: the anchor \`${site.anchor}\` appears more than once, so the region below ` +
        'is ambiguous and a decoy could satisfy it'
    );
    const region = src.slice(at, at + site.span);
    assert.match(
      region,
      site.re,
      `${site.what} no longer delegates to runners.isRunnable WITHIN ITS OWN CALL SITE. If it ` +
        'was repointed to existsSync or another presence-only check, a DIRECTORY passes again ' +
        'and no other guard in this file will notice. (Searching the whole file for the token ' +
        'was measured to be satisfiable by appending a string at EOF, which is why this is ' +
        'bounded to the region after the anchor.)'
    );
  }
});
