/**
 * The gate must be able to QUOTE a check's failure.
 *
 * 🛑 WHY THIS FILE EXISTS. `run_one` in tools/browser-checks.sh extracts the
 * reason it prints beside a red by grepping the check's captured output. A
 * failure LINE that does not match that grep reports as
 * "(no FAIL or error line in its output; read the full log)" -- the gate reds
 * without naming what went wrong, at the worst moment to be silent.
 *
 * ⇒ 🔑 THIS TESTS THE LINE THAT IS PRINTED, NOT THE STRING THAT IS PUSHED.
 * The two differ, and the difference is the whole defect class: a correct
 * pushed string still prints unquotably when the emit site decorates it, since
 * `'  - ' + p` yields `  - FAIL  ...` and the ANCHORED `^\s*(FAIL|✖)` branch
 * cannot match that. Every assertion below is keyed on the printed line.
 *
 * 🛑 WHAT IT DOES NOT COVER, NAMED RATHER THAN IMPLIED. This scan recognises the
 * emit SHAPES listed at each matcher below; a check that builds its failure
 * output some other way is not seen here and is not claimed to be. Two shapes are
 * known-uncovered and named rather than left to be found:
 *   - the EMPTY-PREFIX emit: `console.log('\n' + ...)`, and the per-check result
 *     printer whose template begins with the interpolation. The literal prefix
 *     decodes to empty, so a static read cannot say what it prints. render-first-run
 *     was a live UNQUOTABLE instance (its only failure output was `PROBLEMS (n):`
 *     plus bare `  <problem>` lines); it was fixed in this PR by printing each
 *     problem as `  FAIL  <problem>`, which IS a SHAPE-1 site this scan now counts.
 *     The other empty-prefix emits (render-agent-*, render-*-nav, render-found-count,
 *     render-member-modal, render-long-title, render-project-rows, render-grid-card-width,
 *     click-first-run) are quotable because they ALSO print a per-failure
 *     `FAIL  <label>` line via a helper -- their empty-prefix summary is a
 *     redundant count.
 *     (Note: the browser-launch catch and the top-level crash catch are NO LONGER
 *     here -- kosmos#1864 made them quotable and added the catch/launch scan lower
 *     in this file that covers them.)
 *   - the RUNTIME-STACK crash catch, in two spellings: the bare-object form
 *     `})().catch((e) => { console.error(e); ... })`, and the stack-string form
 *     `.catch((err) => { ... process.stderr.write(String(err && err.stack || err)) ... })`
 *     (render-thread.js:1253). Both print the error's own stack rather than a
 *     literal string: usually quotable (an Error's stack begins with a name
 *     ending in "Error"), but a thrown non-Error or a message without
 *     "Error"/"Timeout" is not, and a static read cannot know the runtime value.
 *     The #1864 catch/launch scan below deliberately covers only the
 *     STRING-literal crash/launch emits, not these.
 *     (Scope note, and it is a SCOPING note not a closure -- the distinction is
 *     load-bearing. This scan reads only files under docs/browser-checks/. The
 *     same crash-catch shape exists across ~27 files under tools/ (measured by
 *     Splinter 2026-09-02), e.g. headed-doctrine-check.js's `console.error('HEADED
 *     HARNESS FAILED', ...)`. Those are NOT covered and are not a #1864 defect
 *     (this card is docs/browser-checks/). REACHABILITY in the release gate is
 *     UNESTABLISHED: what is verified is only that these are not invoked by
 *     run_one / browser-checks.sh; a glob invoker or a CI path could still reach
 *     some, and that gap was not closed. So do NOT read this as "cannot run in the
 *     gate" -- if a tools/ script IS gate-reachable, its unquotable emit is the
 *     same defect and wants its OWN card, not a widening of #1864.)
 *
 * ⚠️ THE SHAPE LIST IS AN ENUMERATION, so treat it as examples rather than as the
 * set: an enumeration misses what is not in it. This guard found ELEVEN unquotable
 * finding-emit sites on its FIRST run against main, and a fresh reading then found
 * render-first-run on top of that -- so a human read still beats it on shapes it
 * does not model.
 * ⇒ **Do not read a green run as "every check is quotable"; read it as "every
 * shape this scan recognises is."**
 *
 * 📌 History of the count's prior values, and how this file was itself wrong
 * three times, lives in the PR that lifted it (branch reasongrep-guard-1836),
 * not here, so editing this file does not mean editing a record.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const RUNNER = path.join(ROOT, 'tools', 'browser-checks.sh');
const DIR = path.join(ROOT, 'docs', 'browser-checks');

/* The pattern is read from the runner, not copied: a copy would go stale and
   this file would then certify a contract nobody holds. */
function runnerReasonPattern() {
  const src = fs.readFileSync(RUNNER, 'utf8');
  const all = [...src.matchAll(/grep -E '([^']+)'\s+"\$cap"/g)];
  assert.equal(all.length, 1,
    `expected exactly one reason grep in ${RUNNER}, found ${all.length}. If the runner grew `
    + 'another, this test must be told which one is the reason extractor rather than silently '
    + 'reading the first.');
  return new RegExp(all[0][1]);
}

test('the runner\'s reason pattern is readable, and can say both yes and no', () => {
  const re = runnerReasonPattern();
  assert.ok(re.test('  FAIL  something broke'), 'the pattern cannot match a FAIL line');
  assert.ok(!re.test('  a bare sentence with no marker'), 'the pattern matches anything');
});

/* 🔑 THE REAL grep, NOT A TRANSLATION. Everything else here converts the
   runner's POSIX ERE into a JS RegExp, and the whole test's authority rests on
   that conversion being faithful. It is today, but a future pattern using
   `[[:space:]]` or `\<` would be MISTRANSLATED SILENTLY rather than rejected.
   This arm hands the extracted pattern to a real `grep -E`, so a mistranslation
   cannot pass unnoticed.
   ⚠️ SCOPED HONESTLY: it is the same grep the runner uses only because both
   resolve to the same binary here. Measured on this machine, both
   `spawnSync('grep')` and the runner's bash reach `/usr/bin/grep` (BSD, GNU
   compatible), and they agree on BOTH arms of the pattern -- a quotable line
   and an unquotable one. What this proves is agreement for whichever `grep` is
   first on PATH at test time, NOT for one guaranteed to be the runner's.
   📌 The interactive shell on this box aliases `grep` to ugrep. Neither this
   test nor the runner sees that: `spawnSync` and a bash script both bypass a
   zsh function. Worth knowing before someone reads a ugrep quirk into a red
   here. */
function quotableByRealGrep(pattern, line) {
  const r = require('node:child_process').spawnSync(
    'grep', ['-E', pattern], { input: line + '\n', encoding: 'utf8' },
  );
  assert.ok(!r.error && typeof r.status === 'number',
    'could not run the real grep, so this arm cannot vouch for the translation used elsewhere');
  /* grep exits 2 when it REFUSES the pattern. Treating that as "not quotable"
     would blame the JS translation for an instrument that never ran. */
  assert.notEqual(r.status, 2,
    `the real grep refused the pattern, so nothing below was measured: ${r.stderr}`);
  return r.status === 0;
}

test('the JS translation of the runner\'s pattern agrees with the real grep', () => {
  /* Through the same extractor, so this cannot drift from it or bypass its
     "exactly one reason grep" assertion. */
  const re = runnerReasonPattern();
  const pattern = re.source;
  for (const line of [
    '  FAIL  something broke',
    '  - FAIL  marker behind a decoration',
    '  ✗ a wrong glyph',
    '  JS ERROR: no marker',
    '  a bare sentence',
    'Timeout of 5000ms exceeded',
  ]) {
    assert.equal(re.test(line), quotableByRealGrep(pattern, line),
      `the JS RegExp and the real grep disagree about: ${line}`);
  }
});

test('the shapes checks actually print are quotable, and the pre-fix shapes are not', () => {
  const re = runnerReasonPattern();
  for (const line of [
    'FAIL  THREW, so everything after it was never asked: boom',
    '  FAIL  [chromium] THREW, so everything after it was never asked: boom',
    '  FAIL  JS ERROR: null is not an object',
    '  FAIL  firstrun-7-create [light]: never settled on the ending',
  ]) assert.ok(re.test(line), `the gate could not quote: ${line}`);

  /* 🔑 THE NEGATIVE ARM, and it is what gives the positives meaning. Each of
     these is a shape this repo actually printed before it was fixed. If the
     pattern ever starts matching them, everything matches and the arm above
     proves nothing. */
  for (const line of [
    '  JS ERROR: null is not an object',            // no marker at all
    '  - FAIL  a working agent draws nothing',      // marker behind a decoration
    '  ✗ a working agent draws nothing',            // U+2717, the runner wants U+2716
    '  ok  the fixture renders three rows',
  ]) assert.ok(!re.test(line), `this should NOT be quotable, so the arms above prove nothing: ${line}`);
});

/**
 * 🛑 THE EMIT-SITE SCAN. For every check, find how it PRINTS a finding and ask
 * whether the resulting line is quotable.
 *
 * ⚠️ WHAT THIS DOES NOT COVER, stated rather than implied: it recognises FOUR
 * emit shapes, each marked at its matcher below -- a `console.error`/
 * `console.log` whose first argument concatenates a literal onto a variable, a
 * `process.stdout.write` template, the `.map(t => `PREFIX ${t}`)` summary form,
 * and a `console.log` whose first argument is a TEMPLATE carrying a failure
 * marker. A check that builds its output some other way is NOT checked here and
 * is not claimed to be.
 *
 * 🛑 ONE SHAPE IS KNOWN-UNCOVERED AND NAMED RATHER THAN LEFT TO BE FOUND: the
 * per-check result printer used in roughly fourteen files, whose template
 * begins with the interpolation itself. Its literal prefix is EMPTY, so no
 * static read can say what it prints. Those lines are in fact quotable, but
 * nothing in this scan is what establishes that.
 *
 * 🛑 AND THE COUNT BELOW DOES NOT CONTAIN THAT GAP. It cannot: it asserts the
 * MATCHER found the sites it knows about, so an emit shape the matcher does not
 * recognise leaves the count unchanged and the scan silently clean. **The shape
 * list is an enumeration, and an enumeration misses what is not in it.**
 */
/* Plural and past forms are included deliberately: omitting `failures` once
   left this scan blind to a WIRED check whose findings were unquotable. A name
   list is still an enumeration and will miss the next word somebody uses; the
   site count below is what bounds that, not this regex. */
/* 🔑 A PREFIX CARRYING ONE OF THESE IS ALREADY THE START OF A FAILURE LINE, so
   it is tested AS IT STANDS rather than discarded for carrying words. That arm
   is not vacuous: `FAIL  THREW, ...` is quotable and passes, while the same
   line with its marker replaced (`  - THREW, ...`) is NOT and reds. A
   perturbation confirmed both directions. */
const FAILURE_MARKER = /FAIL|THREW|ERROR|✖|✘/;

const FINDING_NAMES = /\b(problems?|failures?|fail(ed|s)?|bad|errs?|errors?|err)\b/i;

/* 🔑 SOURCE TEXT IS NOT THE PRINTED PREFIX, and this file's whole thesis is
   that the difference matters. A source `'\n  - '` is six characters, so a
   classifier reading it raw sees a word character (`n`), discards the site, and
   stays green over a line that actually prints `  - finding` and is unquotable.
   ⇒ Decode the escapes, then keep only what follows the LAST newline: that is
   the line the runner greps. */
/* 🛑 ONE LEFT-TO-RIGHT PASS, NOT A CHAIN OF REPLACES. The chain this replaced
   ran `\n` BEFORE `\\`, so a source literal for a PRINTED backslash-n --
   three characters, `\`, `\`, `n` -- had its SECOND backslash consumed as the
   start of a newline escape. Measured: it decoded to a real newline, and
   `printedPrefix` then truncated there and returned a prefix the program never
   prints. Every classification downstream was then made about the wrong string.
   ⚠️ The direction of the error varies with the input, so do not remember this
   as "it went green": sometimes it drops a real site, sometimes it invents one.
   The defect is that the decision is made on a string that is not the output.
   📌 Latent when found: zero such sequences exist under docs/browser-checks
   today. Fixed anyway, because the whole file's thesis is that source text is
   not printed text, and this was that same bug one layer underneath. */
const ESCAPES = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '`': '`' };

function decodeEscapes(sourceText) {
  return sourceText.replace(/\\([ntr\\'`])/g, (whole, c) => (
    Object.prototype.hasOwnProperty.call(ESCAPES, c) ? ESCAPES[c] : whole
  ));
}

function printedPrefix(sourceText) {
  const decoded = decodeEscapes(sourceText);
  const i = decoded.lastIndexOf('\n');
  return i === -1 ? decoded : decoded.slice(i + 1);
}

function emitPrefixes(src) {
  const out = [];
  /* 🔑 KEYED ON THE LINE MENTIONING A FINDINGS COLLECTION, not on every
     concatenated console call. Without this the scan flags an ordinary data
     dump (`console.log('  ' + JSON.stringify(row))`) as an unquotable failure
     and manufactures work. A sweep produces candidates; this is the
     classification step. */
  for (const line of src.split('\n')) {
    /* 🛑 TWO BUGS LIVED HERE AND NEITHER FIX ALONE WORKS. Measured, all four
       arms, on the source text `\nFAIL  THREW`:
         original (no /i, source)        false
         case-insensitive ONLY           false   <- /i alone is NOT enough
         decode ONLY (no /i)             false   <- decode alone is NOT enough
         both together                   TRUE
       ⭐ A CONJUNCTIVE DEFECT. Either fix shipped by itself looks like a fix,
       leaves the site unguarded, and makes the perturbation still read green --
       so the next person concludes the fix failed for some third reason and
       goes looking in the wrong place. Do not remove either half.
       🛑 ON THE DECODED LINE, NOT THE SOURCE. This pre-filter carried the same
       source-text bug the classifier below was fixed for, one layer up and
       unnoticed: in the source, `\nFAIL` is the four characters `\`,`n`,`F`...,
       so the `n` GLUES ONTO `FAIL` and `\bfail\b` cannot match. Both of this
       branch's `\nFAIL  THREW` reporters were dropped here, before any shape
       matcher ran. Measured: /\bfail\b/i is false on the source and true on
       the decoded line. */
    if (!FINDING_NAMES.test(decodeEscapes(line))) continue;
    /* SHAPE 1: console.error('  - ' + p) and the arrow form. ONE pattern, not
       two: the arrow form is an INSTANCE of this pattern, not a wider one, so
       adding a second matcher for it double-counts every arrow site and
       inflates the count assertion below. */
    /* Both quote styles. The load-bearing measurement is that this directory
       has **ZERO double-quoted** concat emit sites today, so adding the matcher
       is count-neutral; it is here because a double quote is a likelier next
       spelling than a novel emit shape.
       ⚠️ NO SINGLE-QUOTED TOTAL IS QUOTED HERE, DELIBERATELY. This comment used
       to carry one ("81"), and it reproduced as neither 80 (a raw grep), 41
       (the same matcher behind the FINDING_NAMES pre-filter the scan actually
       applies) nor 86 (a reviewer's grep). Three queries, three answers, none
       of them wrong -- the NUMBER was meaningless without the QUERY beside it.
       ⇒ In a file whose thesis is that hand-carried counts rot, quote the
       query or quote nothing. The zero above survives because it is zero under
       every one of those readings. */
    for (const m of line.matchAll(/console\.(?:error|log)\(\s*'((?:[^'\\]|\\.)*)'\s*\+/g)) out.push(printedPrefix(m[1]));
    for (const m of line.matchAll(/console\.(?:error|log)\(\s*"((?:[^"\\]|\\.)*)"\s*\+/g)) out.push(printedPrefix(m[1]));
    /* SHAPE 2: process.stdout.write(`  ✘ ${line}\n`). Omitting this axis is
       what left the scan blind to a wired check. */
    for (const m of line.matchAll(/process\.stdout\.write\(\s*`([^`$]*)\$\{/g)) out.push(printedPrefix(m[1]));
    /* SHAPE 3: problems.map((t) => `  FAIL  ${t}`) */
    for (const m of line.matchAll(/\.map\(\s*\(?\s*[A-Za-z_$][\w$]*\s*\)?\s*=>\s*`([^`$]*)\$\{/g)) out.push(printedPrefix(m[1]));
    /* SHAPE 4: console.log(`\nFAIL  THREW, ...: ${e.message}`). A TEMPLATE
       first argument, which SHAPE 1 cannot see because it requires a quoted
       string followed by `+`. The three THREW reporters this branch adds are
       all this shape, and a perturbation confirmed they were unguarded: their
       `FAIL` could be removed and this file stayed green. */
    for (const m of line.matchAll(/console\.(?:error|log)\(\s*`([^`$]*)\$\{/g)) {
      /* 🛑 MARKER-CARRYING ONLY, unlike SHAPE 1. A template emit whose literal
         prefix is a bare decoration is as often a section header as a finding:
         `console.log(\`\n== ${engine} / ${scheme} ==  ... page errors ...\`)` in
         render-fields.js is admitted by a decoration rule and is NOT a failure
         line, so the scan reported it and manufactured work. The concat form is
         this repo's per-finding idiom; the template form is not. */
      const pfx = printedPrefix(m[1]);
      if (FAILURE_MARKER.test(pfx)) out.push(pfx);
    }
  }
  return out;
}

test('every emit site in every check prints a line the gate can quote', () => {
  const re = runnerReasonPattern();
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
  /* No file-count floor here. There was one, at `>= 40` against an actual 63,
     and by this file's own rule a floor with 23 of slack is decoration. The
     exact site count below is the real backstop: a broken directory read
     yields zero sites, which is not 29. */

  const bad = [];
  let sites = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const prefix of emitPrefixes(src)) {
      /* 🛑 NOT AN ENUMERATION OF GLYPHS. A per-finding decoration is defined
         structurally, as "no word characters except the literal FAIL", so it
         admits any marker anyone invents. An enumeration guarding against an
         enumeration reproduces the failure it names.
         ⚠️ AND THAT EXEMPTION IS ITSELF A FILTER THAT HIDES THINGS, MEASURED
         RATHER THAN SUSPECTED. A prefix carrying WORDS is dropped here, so
         a worded prefix with no marker in it is NOT guarded, which is what
         drops ordinary logging. Prefixes carrying a marker ARE now tested, and
         that arm immediately found render-fields' instrument self-check
         printing an unquotable line. Do not restate that these sites "have
         been fixed": that claim was in this file and was false for
         render-fields, whose line began with a sentence and never matched.
         Perturbation, count-neutral, both arms: a WORD-FREE escaped prefix
         (`'\n  - '`) IS caught; the same shape carrying words is NOT.
         ⇒ The escape decoding above is doing real work, and this exemption
         bounds it. Do not read a green run as covering a worded failure line. */
      const decorationOnly = /^[^\w]*(FAIL)?[^\w]*$/u.test(prefix);
      /* A worded prefix is ordinary logging AND IS SKIPPED, unless it carries a
         failure marker, in which case it is a finding line already and can be
         tested directly. That second arm is what closes the blind spot a
         perturbation found: the branch's three THREW reporters print via a
         template whose prefix carries words, so the worded-prefix skip alone
         discarded them and their `FAIL` was unguarded. */
      if (!decorationOnly && !FAILURE_MARKER.test(prefix)) continue;
      /* ⚠️ AN EMPTY OR WHITESPACE-ONLY PREFIX IS NOT A FINDING MARKER. Without
         this, an ordinary `console.log('  ' + JSON.stringify(row))` sitting on
         a line that happens to mention `problems` REDS this test: the
         manufacture-work direction, which the structural rule above would
         otherwise reopen. */
      if (!/[^\s]/.test(prefix)) continue;
      sites += 1;
      /* A decoration needs a finding appended to become a line; a
         marker-carrying prefix already IS the start of one. */
      const printed = decorationOnly ? prefix + 'a sample finding' : prefix;
      if (!re.test(printed)) bad.push(`${f}: prints "${prefix}" + finding`);
    }
  }

  /* 🔑 AN EXACT COUNT OF THE SITES EXAMINED, not a floor and not a file count.
     A floor whose slack exceeds the thing it guards is decoration: at `>= 17`
     this one was satisfied even with the stdout axis or the map axis dropped
     entirely. And if the matcher drifts to zero the scan examines nothing,
     finds nothing and passes, so the count is what makes a clean result below
     mean anything. Update this number deliberately when you add or remove an
     emit site. */
  /* 🛑 ONE CONSTANT, USED BY BOTH THE ASSERTION AND ITS MESSAGE. Hardcoding the
     number in the text made the message print "29 matched, expected 29" the
     moment somebody changed the expected value -- found by deliberately firing
     it rather than by reading it, which is the only way a failure message ever
     gets tested. A message is untested prose until you have seen it fire. */
  /* 🛑 27 IS AN EXACT COUNT ON MAIN, AND IT IS AN INTENTIONAL TRIPWIRE, NOT
     BRITTLENESS. This file argues above that a floor whose slack exceeds the
     thing it guards is decoration, so the count is an equality on purpose: it
     goes RED the first time anyone adds a legitimate emit site, and that red is
     the feature -- it forces the new site to be reviewed for quotability and the
     number bumped deliberately, rather than a new unquotable emit slipping in
     under a floor. When you add or remove an emit site, confirm the site is
     quotable and update this number on purpose.
     📌 Calibrated to current main. This guard found ELEVEN checks printing
     unquotable failures on its FIRST run against main -- the class was 13 wide
     and #1860 had fixed only 2. All 11 were fixed in the same PR that lifted this
     file. A blind review then found render-first-run, whose only failure output
     was an empty-prefix `console.log('\n' + ...)` this scan could not see; it was
     rewritten to print each problem as `  FAIL  <problem>`, which is a SHAPE-1
     site -- so it is now BOTH quotable and counted, taking the total to 28. `bad`
     is empty and all 28 sites are quotable. The archaeology of the count's prior
     values lives in that PR, not here. */
  /* 32 after kosmos#2023 added render-board-signin-403-2023.js, whose `check()`
     helper prints `${pass ? 'PASS' : 'FAIL'}  ${name}` -- one SHAPE-1 finding-emit
     site, confirmed quotable. Was 31 after kosmos#1531 added render-adopt-1531.js,
     whose `check()` helper prints
     `${pass ? 'PASS' : 'FAIL'}  ${name}` -- a SHAPE-1 finding-emit site, confirmed
     quotable (the matcher counts it, so a red names the failing assertion). Was
     30 after kosmos#1921 added render-account-badge-1921.js, whose per-problem
     `console.error('  FAIL  ' + p)` loop is one SHAPE-1 finding-emit site, confirmed
     quotable (the matcher counts it). Was 29 after kosmos#1918 added
     render-reauth-reach-1918.js, whose loop is the same shape. */
  // MERGE (#2020 + main's #2023): both render-optout-403-2020.js and
  // render-board-signin-403-2023.js are now present; each check() helper prints
  // `${pass ? 'PASS' : 'FAIL'}  ${name}` (a quotable finding-emit), so the count is
  // one above main's for the #2020 check.
  const EXPECTED_SITES = 33;
  assert.equal(sites, EXPECTED_SITES,
    `${sites} finding-emit sites matched, expected ${EXPECTED_SITES}. The LIKELY cause is an emit site `
    + 'added or removed without updating this number: check the diff first, and if that is '
    + 'it, update it deliberately. The DANGEROUS cause, and the reason this is an equality '
    + 'rather than a floor, is a matcher that has drifted and now examines fewer sites -- a '
    + 'clean result below would then be a zero from a query that never looked.');

  assert.deepEqual(bad, [],
    'these checks print failures the gate cannot quote, so a red reports '
    + '"(no FAIL or error line in its output)":\n  ' + bad.join('\n  '));
});

/* 🛑 #1864: THE CATCH / LAUNCH EMIT SCAN. The finding-emit scan above is gated on
 * FINDING_NAMES (a line mentioning a findings collection), which is exactly why it
 * cannot see these: a crash catch and a browser-launch catch print a failure LINE
 * that names no finding. Two shapes, both of which the header above listed as
 * known-uncovered until this scan (kosmos#1864):
 *   A. the top-level crash catch: `})().catch((e) => { console.error('<prefix>', ...) ... })`
 *      -- an explicit STRING first argument on the `.catch(` line. The bare
 *      `console.error(e)` object form is a DIFFERENT sub-shape (it prints the error's
 *      own stack, quotable only if that stack carries "Error"); it stays known-uncovered
 *      in the header because asserting it needs the runtime error, not a static read.
 *   B. the browser-launch catch: `console.error('<name>: could not start a browser' ...)`,
 *      which sits on its own line inside a multi-line `try/catch`, so shape A's same-line
 *      `.catch(` key cannot reach it -- it is keyed on the sentence instead.
 * Both print the LINE the runner greps; each printed prefix must be quotable. */
function catchLaunchPrefixes(src) {
  const out = [];
  for (const line of src.split('\n')) {
    // Shape A: a string-literal console emit on a promise `.catch((e|err) => ...)` line.
    // The dot in `\.catch\(` keys on the promise form only; a `try { } catch (err) {`
    // statement (no dot) is shape B's territory.
    if (/\.catch\(\s*(?:async\s*)?\(?\s*(?:e|err|error)\b/.test(line)) {
      for (const m of line.matchAll(/console\.(?:error|log)\(\s*'((?:[^'\\]|\\.)*)'/g)) out.push(printedPrefix(m[1]));
      for (const m of line.matchAll(/console\.(?:error|log)\(\s*"((?:[^"\\]|\\.)*)"/g)) out.push(printedPrefix(m[1]));
    }
    // Shape B: the browser-launch catch, keyed on its sentence (multi-line block).
    for (const m of line.matchAll(/console\.(?:error|log)\(\s*'((?:[^'\\]|\\.)*could not start a browser(?:[^'\\]|\\.)*)'/g)) out.push(printedPrefix(m[1]));
    for (const m of line.matchAll(/console\.(?:error|log)\(\s*"((?:[^"\\]|\\.)*could not start a browser(?:[^"\\]|\\.)*)"/g)) out.push(printedPrefix(m[1]));
  }
  return out;
}

test('every catch/launch emit prints a line the gate can quote (#1864)', () => {
  const re = runnerReasonPattern();
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
  const bad = [];
  let sites = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const prefix of catchLaunchPrefixes(src)) {
      /* These prefixes are already the START of a failure line (a crash/launch
         emit, not a decoration awaiting a finding), so test them as they stand.
         An empty/whitespace-only prefix is not a marker and is skipped. */
      if (!/[^\s]/.test(prefix)) continue;
      sites += 1;
      if (!re.test(prefix)) bad.push(`${f}: catch/launch prints "${prefix}"`);
    }
  }
  /* 🛑 EXACT COUNT, an intentional tripwire like the finding-emit count above: it
     goes RED when a catch/launch emit site is added, forcing the new site to be
     reviewed for quotability and this number bumped on purpose -- rather than a new
     unquotable crash/launch emit slipping in unseen. Calibrated to current main
     after kosmos#1864 made these shapes quotable. */
  /* 15 after kosmos#1921 added render-account-badge-1921.js, whose launch-failure
     `console.error('FAIL  render-account-badge-1921: could not start a browser' ...)` is
     one catch/launch emit site, confirmed quotable (the matcher counts it). Was 14 after
     kosmos#1918 added render-reauth-reach-1918.js, whose emit is the same shape. */
  // 16 after kosmos#2020 added render-optout-403-2020.js, whose top-level
  // `.catch((e) => { console.error('FAIL  render-optout-403-2020 threw: ' + ...) })`
  // is one catch emit, confirmed quotable (the FAIL prefix matches the reason grep).
  const EXPECTED_CATCH_SITES = 16;
  assert.equal(sites, EXPECTED_CATCH_SITES,
    `${sites} catch/launch emit sites matched, expected ${EXPECTED_CATCH_SITES}. Update this `
    + 'number deliberately when you add or remove a catch/launch emit, after confirming the '
    + 'new site is quotable; a matcher that drifted to zero would examine nothing and pass.');
  assert.deepEqual(bad, [],
    'these checks print catch/launch failures the gate cannot quote, so a red reports '
    + '"(no FAIL or error line in its output)":\n  ' + bad.join('\n  '));
});
