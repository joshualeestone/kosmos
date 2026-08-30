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
 * ⇒ Nothing is stripped now. Every line in the repo matching the weak-call shape
 * must appear in ACKNOWLEDGED_PROSE or SELF_GUARDED, and anything else fails.
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
const RUNNERS = path.join(ENGINE, 'runners.js');

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
 * Every line in the repo that LOOKS like the weak call must be accounted for
 * here, as either acknowledged prose or an audited guarded call.
 *
 * 🛑 WHY THIS IS A LIST AND NOT A COMMENT-STRIPPER, AFTER FOUR STRIPPERS FAILED.
 * The sweep needs to tell a call from a comment. Four versions tried, each fixing
 * the last and opening a new hole, every one of them in the direction that HIDES
 * a defect:
 *
 *   1  regex over the file      a `/*` inside a STRING opened a comment.
 *                               803 lines of live code across 10 files invisible.
 *   2  character scanner        broke on REGEX LITERALS. 8 live lines blanked; a
 *                               regex containing a quote desynced it permanently.
 *   3  line-initial only        a TEMPLATE LITERAL puts `/*` at a line start.
 *                               A planted weak call stayed green.
 *   4  backtick parity          defeated by a regex CONTAINING a backtick, which
 *                               is live at engine/create.js:1449. Parity inverts
 *                               and stays inverted; 4 files are desynced today.
 *
 * ⇒ Each fix was correct about the case it named and wrong about the next one.
 * That is the signature of a heuristic applied to a parsing problem, and there is
 * no parser available here (no acorn, espree, esprima or babel in this repo).
 *
 * ✅ SO STOP PARSING. The sweep does not need to strip a whole file; it needs to
 * judge the lines that actually match, and MEASURED, THERE ARE FOUR IN THE
 * REPO'S NON-TEST `.js` FILES, which is what this sweep walks (across all `.js`
 * there are 25, 16 of them in this file's own prose). A list of four is auditable in one read, holds no state that can desync,
 * and cannot hide a call because nothing is ever blanked.
 *
 * ⚠️ THE COST, STATED: writing a NEW comment that mentions accessSync(X_OK) turns
 * this test red until the line is added below. That is deliberate and it is the
 * safe direction: it is loud, it is a two-line fix, and it makes somebody
 * documenting this defect notice they are documenting it.
 */
const ACKNOWLEDGED_PROSE = [
  { file: 'engine/connect.js', contains: 'SUCCEEDS ON A DIRECTORY, so a' },
  { file: 'engine/devicedoor.js', contains: '#1592: accessSync(X_OK) SUCCEEDS ON A DIRECTORY' },
];

/**
 * Real calls that are correct because they guard themselves, or because they ARE
 * the definition of the question.
 *
 * Each entry pins the guard token it is exempt FOR, and that token must appear on
 * a line that is NOT prose. An earlier version searched stripped text, so a
 * comment reading `// used to call st.isFile() here` satisfied the guard and the
 * call underneath it was reported as nothing.
 *
 * 🛑 PINNED TO THE CALL, NOT THE FILE, AND THE FILE-SCOPED VERSION HAD A MEASURED
 * HOLE. It exempted any matching line within N lines of the guard, so whether a
 * planted call was caught depended on WHERE IN THE FILE it was planted: inside
 * the window it passed, at the end of the file it failed. An exemption for one
 * audited call had become an exemption for a region.
 *
 * ⇒ Each entry now names the exact call text it covers. A different call, even
 * one line away, is not this exemption and is reported.
 *
 * ⚠️ Still not verified: that the guard applies to the SAME path as the call.
 * A text search cannot answer that. Disclosed rather than papered over, and it is
 * the reason these are exemptions rather than a rule.
 */
const SELF_GUARDED = new Map([
  ['engine/machine.js', {
    call: 'fs.accessSync(bin, fs.constants.X_OK);',
    guard: /if\s*\(\s*!\s*st\.isFile\s*\(/, within: 6,
    why: 'stats the same path and gates on st.isFile() two lines above' }],
  ['engine/runners.js', {
    call: 'fs.accessSync(p, fs.constants.X_OK);',
    guard: /if\s*\(\s*!\s*st\.isFile\s*\(/, within: 20,
    why: 'IS the definition of the question; isRunnable stats and checks isFile itself' }],
]);
/** A line that is unambiguously prose: it opens with a comment marker. */
function isProseLine(line) {
  return /^\s*(\/\/|\/\*|\*)/.test(line);
}

/**
 * Drop whole-line prose, preserving line count so a reported number is real.
 *
 * ⚠️ Deliberately weaker than a comment stripper: it does not try to find the
 * END of a block, so a mid-line comment survives. That is the safe direction for
 * these consumers, which assert the PRESENCE of a call: leftover prose can only
 * make a positive assertion pass too easily, and every one of them is paired
 * with a mutation arm that proves it fires.
 */
function noProse(src) {
  return src
    .split('\n')
    .map((l) => {
      /* 🛑 ORDER MATTERS AND GETTING IT WRONG COST AN ARM. Removing whole-line
         prose FIRST discards `/* belt *\/ canRunClaude = true;` entirely,
         because that line opens with a comment marker while carrying live code
         after the closer. So: remove COMPLETE block comments and a trailing
         line comment first, and only then decide whether what remains is prose.

         ⚠️ Over-stripping here is the safe direction for these consumers, which
         all assert a specific call is PRESENT: removing too much can only make
         the pinned token harder to find, which fails loud. That is the opposite
         of the sweep, where over-stripping hides a call, which is why the sweep
         strips nothing at all. */
      const bare = l.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/, '');
      return bare.trim() === '' || /^\s*\*/.test(l) ? '' : bare;
    })
    .join('\n');
}

test('every line in the repo that looks like the weak call is accounted for', () => {
  /* Repo-wide. The name claims a CLASS property, and a guard narrower than the
     claim it makes is the failure it was written to prevent, arriving by a
     different door. Raw source: nothing is stripped, so nothing can be hidden. */
  const files = walkJs(REPO);
  assert.ok(files.length > 100, `only ${files.length} files scanned; the sweep is broken`);
  assert.ok(
    files.some((f) => f.startsWith(`engine${path.sep}`)),
    'the sweep is not reaching engine/, which is where the class lives'
  );

  const unaccounted = [];
  const proseSeen = new Set();
  const guardedSeen = new Set();

  for (const rel of files) {
    const key = rel.split(path.sep).join('/');
    const lines = fs.readFileSync(path.join(REPO, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!WEAK_CALL.test(line)) return;

      const prose = ACKNOWLEDGED_PROSE.find(
        (e) => e.file === key && line.includes(e.contains)
      );
      if (prose) {
        assert.ok(isProseLine(line), `${key}:${i + 1} is listed as prose but does not open with a comment marker`);
        proseSeen.add(`${prose.file}|${prose.contains}`);
        return;
      }

      const spec = SELF_GUARDED.get(key);
      if (spec && line.trim() === spec.call) {
        /* The guard must be on a line that is NOT prose. An earlier version
           searched stripped text, so `// used to call st.isFile() here`
           satisfied the guard while the call underneath was wholly unguarded. */
        const above = lines
          .slice(Math.max(0, i - spec.within), i)
          .filter((l) => !isProseLine(l));
        if (spec.guard.test(above.join('\n'))) { guardedSeen.add(key); return; }
        unaccounted.push(`${key}:${i + 1}: EXEMPT FILE LOST ITS GUARD (${spec.why}): ${line.trim()}`);
        return;
      }

      unaccounted.push(`${key}:${i + 1}: ${line.trim()}`);
    });
  }

  /* Assert the findings FIRST. An earlier version checked the exemption tallies
     first, so losing a guard printed "the exemption is stale, remove the entry",
     which is the opposite of the right action. */
  assert.deepStrictEqual(
    unaccounted,
    [],
    'these look like accessSync(X_OK), which SUCCEEDS ON A DIRECTORY.\n' +
      '  a real call    -> use require("./runners").isRunnable(p)\n' +
      '  a whole-line comment about the defect -> add it to ACKNOWLEDGED_PROSE\n' +
      '  neither (a string, a template literal, a mid-line comment) -> it has no\n' +
      '    bucket by design. Move it to its own line or reword it; the lists\n' +
      '    deliberately only accept a real call or a whole-line comment.\n  ' +
      unaccounted.join('\n  ')
  );

  // Stale entries: every listed exemption must still describe something real.
  for (const e of ACKNOWLEDGED_PROSE) {
    assert.ok(
      proseSeen.has(`${e.file}|${e.contains}`),
      `ACKNOWLEDGED_PROSE lists ${e.file} ("${e.contains}") and no such line matched. ` +
        'The comment was reworded, moved or deleted. Remove the entry.'
    );
  }
  for (const [key, spec] of SELF_GUARDED) {
    assert.ok(
      guardedSeen.has(key),
      `SELF_GUARDED lists ${key} (${spec.why}) and it no longer asks the weak call. ` +
        'The exemption is stale. Remove the entry.'
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
  // isProseLine needs BOTH arms: an always-true version would empty every guard
  // window, and an always-false one would let prose satisfy a pinned token.
  assert.strictEqual(isProseLine('  fs.accessSync(bin, fs.constants.X_OK);'), false,
    'isProseLine calls real code prose, which would blank live lines');
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
  const src = noProse(fs.readFileSync(path.join(__dirname, 'engine', 'connect.js'), 'utf8'));
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
     Still invisible: `if (x) canRunClaude = true;` and compound assignment.
     Neither exists today. */
  const src = noProse(fs.readFileSync(path.join(__dirname, 'engine', 'connect.js'), 'utf8'));
  const overridden = src.match(/(^|[;{])\s*canRunClaude\s*=\s*true\s*;/gm) || [];
  assert.deepStrictEqual(
    overridden,
    [],
    'canRunClaude is assigned a literal, which would override the isRunnable check:\n  ' +
      overridden.join('\n  ')
  );

  // Control: the matcher must be able to SEE such an assignment, or the [] above
  // is worthless. Same shape, planted.
  const planted = noProse('  canRunClaude = require("./runners").isRunnable(p);\n  canRunClaude = true;\n');
  assert.strictEqual(
    (planted.match(/(^|[;{])\s*canRunClaude\s*=\s*true\s*;/gm) || []).length,
    1,
    'the override matcher cannot see a planted override, so its empty result means nothing'
  );
});


test('the two lambda sites delegate to runners.isRunnable rather than re-implementing it', () => {
  /* The sweep catches a revert to accessSync(X_OK). It does NOT catch a revert
     to some other weak spelling of the same question, and the repo already
     contains one such spelling: engine/create.js gates on fs.existsSync, which
     accepts a directory exactly as accessSync(X_OK) does. Carded separately.

     So for the two sites whose fix is a one-line lambda, assert the delegation
     positively. devicedoor and githubdevice were byte-identical twins before
     this branch and are the easiest pair to silently diverge again. */
  for (const f of ['devicedoor.js', 'githubdevice.js']) {
    const src = noProse(fs.readFileSync(path.join(__dirname, 'engine', f), 'utf8'));
    const m = src.match(/const\s+runnable\s*=\s*\(([^)]*)\)\s*=>\s*([^;\n]+)/);
    assert.ok(m, `${f}: no \`const runnable = ...\` lambda found; the site was renamed or removed`);
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

     ⚠️ Absence-based guards cannot cover this. Only a POSITIVE assertion that the
     right call is present can, which is why this is a separate arm rather than
     another thing the sweep looks for. */
  const src = noProse(fs.readFileSync(path.join(__dirname, 'engine', 'connect.js'), 'utf8'));
  const sites = [
    { what: "willInstall's presence check", re: /if\s*\(\s*!\s*require\(['"]\.\/runners['"]\)\.isRunnable\s*\(/ },
    { what: 'becomeStuck canRunClaude',     re: /canRunClaude\s*=\s*require\(['"]\.\/runners['"]\)\.isRunnable\s*\(/ },
  ];
  for (const site of sites) {
    assert.match(
      src,
      site.re,
      `${site.what} no longer delegates to runners.isRunnable. If it was repointed to ` +
        'existsSync or another presence-only check, a DIRECTORY passes again and no other ' +
        'guard in this file will notice.'
    );
  }
});
