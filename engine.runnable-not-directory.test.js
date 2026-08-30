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
 * ⚠️ IT IGNORES COMMENTS ON PURPOSE. A string search cannot tell USE from
 * MENTION (#1570), and this very file's prose mentions `accessSync`. Sweeping
 * naively, the guard flags itself and every comment that explains it. That is
 * not hypothetical: while fixing #1592 I twice read my own explanatory comment
 * as an unfixed call site.
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
 * The async spellings `fs.access(...)` and `fs.promises.access(...)` ARE now
 * covered by the `access` alternation above.
 *
 * ⭐ Disclosing only one gap, as an earlier version did, is worse than
 * disclosing none: a reader takes the single caveat as the complete list.
 */
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
 * Source with comments blanked, so prose cannot trip the sweep.
 *
 * ⚠️ BLANKED, NOT REMOVED. Deleting a comment SHIFTS EVERY LINE NUMBER BELOW
 * it, so the sweep reports a real defect at a line that does not contain it. An
 * early version did exactly that and named machine.js:191 for a call at 412.
 *
 * 🛑 LINE-BASED AND DELIBERATELY DUMB, AFTER TWO CLEVERER VERSIONS BOTH FAILED
 * IN THE DANGEROUS DIRECTION. Measured, on this repo:
 *
 *   a regex over the whole file    treated `/*` INSIDE A STRING as a comment
 *                                  opener. engine/unfurl.js:309 holds the string
 *                                  'image' + '/' + '*', and 803 LINES OF LIVE
 *                                  CODE across 10 files went invisible.
 *
 *   a character scanner            fixed that and broke on REGEX LITERALS. A
 *                                  regex ending in an escaped slash presents
 *                                  `//` and drove it into line-comment state,
 *                                  blanking 8 live lines in 6 files including
 *                                  engine/policy.js:91. A regex containing a
 *                                  quote desynced it into a string state it
 *                                  never left, after which comments stopped
 *                                  being blanked at all and the sweep went RED
 *                                  ON CORRECT PROSE in 4 files.
 *
 * ⇒ Both were over-strippers, and `test-support/code-only.js` in this repo
 * already states the rule I broke twice: **the two failure directions are NOT
 * symmetric. Under-stripping gives a false FAIL somebody investigates;
 * over-stripping gives a false PASS nobody ever looks at. When in doubt, strip
 * less.** I wrote a cleverer stripper twice without reading the one already
 * here, whose docblock is the argument against doing that.
 *
 * ✅ SO THIS ONE ONLY BLANKS WHAT IT CAN IDENTIFY FROM THE START OF A LINE:
 * a whole-line `//`, and a block comment whose `/*` opens a line. A `/*` or
 * `//` appearing mid-line is left alone, because mid-line is exactly where a
 * string or a regex literal can imitate one. The cost is a false FAIL if
 * somebody writes a mid-line comment naming the weak call; that is the
 * direction we are choosing, and it is loud.
 *
 * 📌 Not shared with test-support/code-only.js because that one FILTERS lines
 * out and this one must preserve numbering. Same rule, different output shape.
 */
function codeOnly(src) {
  let inBlock = false;
  return src.split('\n').map((line) => {
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) return '';
      inBlock = false;
      return ' '.repeat(end + 2) + line.slice(end + 2);
    }
    if (/^\s*\/\//.test(line)) return '';
    if (/^\s*\/\*/.test(line)) {
      const end = line.indexOf('*/');
      if (end === -1) { inBlock = true; return ''; }
      return ' '.repeat(end + 2) + line.slice(end + 2);
    }
    return line;
  }).join('\n');
}

/**
 * Files permitted to ask the weak call, with the number of times each may ask.
 *
 * 🛑 THE COUNT IS THE POINT, AND THE VERSION WITHOUT IT HAD A MEASURED HOLE.
 * An earlier allow-list cleared the whole FILE. Planting a brand-new, entirely
 * unguarded weak call at the end of engine/machine.js was then reported as
 * nothing at all, because the file was exempt. An exemption for one audited
 * line had silently become an exemption for every future line in that file.
 *
 * ✅ Pinning the count means a NEW weak call in a listed file changes 1 to 2 and
 * fires. It also catches the stale-entry case the list could not see before: if
 * the file is renamed, moved or deleted, or if its guarded call is removed, the
 * count no longer matches and the list says so instead of quietly exempting
 * nothing.
 *
 * ⚠️ It does NOT verify that the call at that line is still the guarded one.
 * Swapping the guarded call for an unguarded one at the same count passes.
 * Stated because this list has already been claimed to be un-foolable once, and
 * it was not.
 */
const SELF_GUARDED = new Map([
  ['engine/machine.js', { count: 1, why: 'stats the same path and checks st.isFile() two lines above, and says why' }],
]);

test('no file in the repo asks the weak runnable question: accessSync(X_OK) without isFile', () => {
  /* Repo-wide, not engine/ only. The name of this test claims a CLASS property
     ("no file asks the weak question"), and a guard narrower than the claim it
     makes is the failure it was written to prevent, arriving by a different
     door. Measured when this was widened: 137 non-test .js files, 0 weak sites,
     1 correctly cleared by machine.js's own isFile(). */
  const files = walkJs(REPO);
  // A floor: if the scan stops finding files this passes while asserting nothing.
  assert.ok(files.length > 100, `only ${files.length} files scanned; the sweep is broken`);
  assert.ok(
    files.some((f) => f.startsWith(`engine${path.sep}`)),
    'the sweep is not reaching engine/, which is where the class lives'
  );

  const weak = [];
  const allowedSeen = new Map();
  for (const rel of files) {
    const full = path.join(REPO, rel);
    const f = rel;
    const lines = codeOnly(fs.readFileSync(full, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (!WEAK_CALL.test(line)) return;
      // runners.js is the definition of the question, so it is allowed to ask it.
      if (full === RUNNERS) return;
      const rel = f.split(path.sep).join('/');
      if (SELF_GUARDED.has(rel)) { allowedSeen.set(rel, (allowedSeen.get(rel) || 0) + 1); return; }
      weak.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  for (const [rel, spec] of SELF_GUARDED) {
    const seen = allowedSeen.get(rel) || 0;
    assert.strictEqual(
      seen,
      spec.count,
      `SELF_GUARDED says ${rel} asks the weak call ${spec.count} time(s) and it asks ${seen}. ` +
        (seen > spec.count
          ? 'A NEW weak call was added to an exempt file; audit it and update the count deliberately.'
          : 'The exemption is stale: the file moved, was renamed, or no longer asks it. Remove the entry.')
    );
  }

  assert.deepStrictEqual(
    weak,
    [],
    'these ask accessSync(X_OK) directly, which SUCCEEDS ON A DIRECTORY. ' +
      'Use require("./runners").isRunnable(p):\n  ' + weak.join('\n  ')
  );
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
  const commented = '// fs.accessSync(bin, fs.constants.X_OK) succeeds on a directory';
  assert.strictEqual(
    codeOnly(commented).trim(),
    '',
    'a comment mentioning the call must not be read as the call (#1570)'
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
  const src = codeOnly(fs.readFileSync(path.join(__dirname, 'engine', 'connect.js'), 'utf8'));
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
     undoes it. */
  const src = codeOnly(fs.readFileSync(path.join(__dirname, 'engine', 'connect.js'), 'utf8'));
  const overridden = src.match(/^\s*canRunClaude\s*=\s*(true|false)\s*;/gm) || [];
  assert.deepStrictEqual(
    overridden,
    [],
    'canRunClaude is assigned a literal, which would override the isRunnable check:\n  ' +
      overridden.join('\n  ')
  );

  // Control: the matcher must be able to SEE such an assignment, or the [] above
  // is worthless. Same shape, planted.
  const planted = codeOnly('  canRunClaude = require("./runners").isRunnable(p);\n  canRunClaude = true;\n');
  assert.strictEqual(
    (planted.match(/^\s*canRunClaude\s*=\s*(true|false)\s*;/gm) || []).length,
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
    const src = codeOnly(fs.readFileSync(path.join(__dirname, 'engine', f), 'utf8'));
    const m = src.match(/const\s+runnable\s*=\s*\(([^)]*)\)\s*=>\s*([^;\n]+)/);
    assert.ok(m, `${f}: no \`const runnable = ...\` lambda found; the site was renamed or removed`);
    assert.match(
      m[2],
      /require\(['"]\.\/runners['"]\)\.isRunnable\s*\(/,
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
  const src = codeOnly(fs.readFileSync(path.join(__dirname, 'engine', 'connect.js'), 'utf8'));
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
