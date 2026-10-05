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

/* 🔑 AN EXACT COUNT OF THE SITES EXAMINED, PER CHECK, ONE LINE PER CHECK (#5071).
   Each line is `'<check>.js': [<finding-emit sites>, <catch/launch sites>]`, and the
   two scans below must match it file by file. It is an equality, not a floor, on
   purpose: a floor whose slack exceeds the thing it guards is decoration, and a
   matcher that drifted to zero would examine nothing, find nothing and pass. Every
   line then goes red, which is what makes a clean `bad` list mean anything. Adding
   a site is red until its line says so, which forces the new site to be checked for
   quotability (the `bad` list) and the line written on purpose.
   🛑 WHY ONE LINE PER CHECK, NOT ONE TOTAL. This used to be two integers
   (EXPECTED_SITES, EXPECTED_CATCH_SITES) that every check-adding PR bumped, so any
   two such PRs conflicted on the same line and the second needed a fresh full
   validation after its rebase (#5071, same class as #3929). Two PRs now add two
   different lines, which git merges. KEEP IT SORTED (a test below enforces it): an
   appended line lands where every other PR appends too. Two new checks that sort
   next to each other can still touch adjacent lines; that conflict is "keep both".
   ONE LINE CAN COUNT IN BOTH SCANS: they tally different properties of a line, not a
   partition, so a single-line top-level `.catch((e) => console.error('FAIL  x threw: ' + e))`
   is [1, 1] on its own. That is not double counting.
   The history of the old totals is in git, not here. */
const SITE_COUNTS = {
  'contrast.js': [0, 1],
  'emoji-picker-2254.js': [1, 0],
  'mobile-shots.js': [3, 0],
  'named-controls.js': [0, 1],
  'regress-a-night.js': [0, 1],
  'render-account-badge-1921.js': [1, 1],
  'render-account-dup-reauth-2584.js': [1, 1],
  'render-account-name-2095.js': [1, 1],
  'render-account-problem-3723.js': [2, 1],
  'render-accounts-openai.js': [1, 1],
  'render-acct-stop-focus-4271.js': [1, 1],
  'render-addmem-flash-2429.js': [1, 0],
  'render-adopt-1531.js': [1, 0],
  'render-alltasks.js': [1, 0],
  'render-assistant-bubble-3034.js': [2, 0],
  'render-assistant-hosted-3660.js': [2, 0],
  'render-autohello-2686.js': [0, 1],
  'render-autohello-switch-2716.js': [0, 1],
  'render-board-signin-403-2023.js': [1, 0],
  'render-boot-no-flash.js': [1, 1],
  'render-brief-note-agents.js': [1, 0],
  'render-bubblepop-2407.js': [1, 0],
  'render-build-marker-2066.js': [1, 1],
  'render-busy-line.js': [1, 1],
  'render-chatbox-phone-4108.js': [1, 0],
  'render-chatgpt-green-4064.js': [1, 0],
  'render-chatgpt-signin-no-name-2913.js': [1, 1],
  'render-claude-connect-choice-2433.js': [1, 1],
  'render-claude-login-green-3997.js': [1, 0],
  'render-codex-account-picker-2811.js': [1, 2],
  'render-codex-hooks-4607.js': [1, 0],
  'render-community-industry-4375.js': [1, 1],
  'render-community-switch-4288.js': [1, 1],
  'render-composer-caret-4585.js': [2, 1],
  'render-composer-reset.js': [1, 0],
  'render-composer-stroke.js': [2, 2],
  'render-conn-ask-4451.js': [1, 0],
  'render-conn-top-3708.js': [1, 1],
  'render-connect-skip.js': [1, 0],
  'render-connlost-reconnect-3410.js': [2, 1],
  'render-create-form.js': [1, 0],
  'render-create-made.js': [1, 0],
  'render-create-openai-model-2140.js': [1, 1],
  'render-create-prefs-3081.js': [1, 1],
  'render-createnav-2190.js': [1, 1],
  'render-detail-header-1841.js': [1, 0],
  'render-detail-openai-model-2140.js': [1, 1],
  'render-device-signed-out-401-718.js': [1, 0],
  'render-dialog-gutter-4506.js': [3, 2],
  'render-disconnect-stop-2570.js': [2, 1],
  'render-dm-emoji-3744.js': [2, 1],
  'render-dm-owes-4340.js': [1, 1],
  'render-dm-reactions-3650.js': [1, 1],
  'render-dm-sideways-3969.js': [1, 0],
  'render-emoji-mute-2357.js': [1, 1],
  'render-fed-external-3311.js': [2, 0],
  'render-fed-plus-gate.js': [2, 2],
  'render-fields.js': [2, 0],
  'render-file-preview-4930.js': [1, 0],
  'render-first-run.js': [1, 0],
  'render-firstrun-agy-4081.js': [3, 2],
  'render-firstrun-choice-4356.js': [2, 0],
  'render-firstrun-grok-3386.js': [1, 0],
  'render-firstrun-import-1652.js': [1, 0],
  'render-firstrun-keyed-connect-3658.js': [1, 1],
  'render-firstrun-model-continue-2134.js': [1, 1],
  'render-firstrun-openai-connectbox-2241.js': [1, 1],
  'render-firstrun-openai-sub-2621.js': [2, 1],
  'render-firstrun-s6-2037.js': [1, 1],
  'render-firstrun-scan-on-grant-1652.js': [2, 1],
  'render-firstrun-wizard-flow.js': [2, 1],
  'render-found-undo.js': [1, 0],
  'render-frame-phone-718.js': [1, 0],
  'render-frnav-2647.js': [2, 2],
  'render-gated-next.js': [1, 1],
  'render-gemini-logo-3422.js': [1, 1],
  'render-github-door.js': [1, 1],
  'render-grid-card-width.js': [0, 1],
  'render-grok-subscription-3391.js': [1, 1],
  'render-gutter-return-4506.js': [2, 0],
  'render-handoff-restart-3492.js': [1, 1],
  'render-head-row.js': [1, 0],
  'render-home-discovery-removed-3048.js': [2, 2],
  'render-home-phone-718.js': [1, 0],
  'render-import-add-inplace-2419.js': [1, 0],
  'render-import-name-4962.js': [1, 0],
  'render-inline-field-errors-2606.js': [1, 0],
  'render-keyed-install-3713.js': [3, 2],
  'render-layer-gutter-4494.js': [3, 2],
  'render-made-before.js': [1, 0],
  'render-mobilenav-4823.js': [3, 1],
  'render-model-restart-interstitial.js': [1, 1],
  'render-model-spinners-2365.js': [1, 1],
  'render-msg-counter-3403.js': [1, 0],
  'render-muse-signin-3939.js': [2, 2],
  'render-needsyou-dealarm-2808.js': [2, 2],
  'render-newagent-paths-4556.js': [3, 2],
  'render-no-conflict-3729.js': [2, 1],
  'render-open-terminal-0644.js': [1, 1],
  'render-openai-devicecode-3436.js': [1, 1],
  'render-openai-install-refusal.js': [2, 2],
  'render-openai-only-2096.js': [1, 1],
  'render-optout-403-2020.js': [1, 1],
  'render-orgchart-phone-718.js': [1, 0],
  'render-owncode-4649.js': [1, 1],
  'render-permission-slider-2620.js': [2, 2],
  'render-personal-instr-4446.js': [1, 0],
  'render-phone-offline-718.js': [2, 0],
  'render-picker-provider-2097.js': [1, 1],
  'render-picture-fit-4885.js': [1, 0],
  'render-pj-clear-2575.js': [0, 1],
  'render-pjadd-back-2850.js': [1, 0],
  'render-pjcreate-nav-3134.js': [0, 1],
  'render-pjmode-style-3495.js': [1, 0],
  'render-pjmsg-prewrap-2294.js': [1, 1],
  'render-pjsettings.js': [0, 1],
  'render-plus-bar-3837.js': [2, 0],
  'render-plus-blue-1615.js': [2, 2],
  'render-plus-gutter-4542.js': [2, 1],
  'render-plus-panel-3829.js': [1, 0],
  'render-plus-stars-3778.js': [2, 1],
  'render-profile-field-widths-2697.js': [2, 2],
  'render-project-done-4583.js': [1, 0],
  'render-project-members-3387.js': [1, 0],
  'render-project-needsyou-2699.js': [2, 2],
  'render-projects-badges-4730.js': [1, 0],
  'render-projects-roadmap-3276.js': [1, 1],
  'render-projects.js': [7, 0],
  'render-provider-combobox-1040.js': [1, 1],
  'render-provider-order-3651.js': [2, 1],
  'render-push-718.js': [1, 0],
  'render-pwa-installable-718.js': [2, 1],
  'render-reactions-2255.js': [1, 0],
  'render-reassign-restart-2829.js': [1, 0],
  'render-reassign-update-3050.js': [1, 0],
  'render-reauth-reach-1918.js': [1, 1],
  'render-reload-toast.js': [1, 0],
  'render-remote-file-download-5165.js': [2, 0],
  'render-remove-force-2651.js': [1, 1],
  'render-rename-4421.js': [1, 1],
  'render-rename-followups-4423.js': [1, 1],
  'render-restart-kloader-2831.js': [1, 1],
  'render-restart-screen-4343.js': [3, 2],
  'render-restore-dircheck-2615.js': [1, 1],
  'render-richtext-room-2239.js': [1, 0],
  'render-role-limit.js': [1, 0],
  'render-role-order.js': [1, 0],
  'render-room-busy-scope-2882.js': [1, 1],
  'render-room-reply-3745.js': [2, 1],
  'render-room-scroll.js': [1, 0],
  'render-settings-403-2047.js': [1, 1],
  'render-settings-agy-3874.js': [3, 2],
  'render-settings-openai-goldbox.js': [1, 1],
  'render-signin-visible-3892.js': [1, 0],
  'render-sound-master-2436.js': [1, 1],
  'render-special-purpose.js': [1, 0],
  'render-subback-4586.js': [1, 0],
  'render-subview-cleanup-3502.js': [1, 0],
  'render-swarm-ui-3564.js': [2, 0],
  'render-switch-claude-5091.js': [1, 1],
  'render-talk-anchor-1926.js': [1, 1],
  'render-talk.js': [1, 0],
  'render-taskhover-4880.js': [1, 0],
  'render-tasks.js': [0, 1],
  'render-teamcreate-4557.js': [1, 1],
  'render-thread.js': [1, 0],
  'render-token-usage-2617.js': [2, 2],
  'render-tophead-consolidated-2282.js': [1, 1],
  'render-tophead-stable-2624.js': [1, 1],
  'render-trust-restart-0644.js': [1, 1],
  'render-type-to-focus-3283.js': [1, 0],
  'render-update-abort-2055.js': [1, 0],
  'render-update-toast.js': [0, 1],
  'render-update-win32-manual.js': [1, 0],
  'render-updates-stale.js': [1, 0],
  'render-user-menu-3051.js': [2, 2],
  'render-waiting-badge-4025.js': [3, 2],
  'render-waiting-phone-718.js': [0, 2],
  'render-workindicator-2146.js': [1, 1],
  'render-world-import-2563.js': [1, 1],
  'render-worldhide-2935.js': [1, 1],
  'render-worldrename-1704.js': [1, 1],
  'render-worldsw-abandon-2628.js': [1, 1],
  'render-worldsw-height-2350.js': [1, 1],
  'render-worldsw-lockout-3055.js': [2, 2],
  'render-worldswitch-2238.js': [1, 1],
};

/* One slot's measured count for one check, read from its source. A check with no
   SITE_COUNTS line is told its whole pair, both slots MEASURED: filling the other slot
   with 0 told a [1, 1] check to add [1, 0], a wrong line and a wasted round (Baron's
   #5106 review). A name not in docs/browser-checks has no source to measure, so it
   prints '?' rather than a number that could be wrong; every real caller's names come
   from that directory, so this is a guard, not a path anyone takes. */
function measuredSites(f, slot) {
  const p = path.join(DIR, f);
  if (!fs.existsSync(p)) return '?';
  const src = fs.readFileSync(p, 'utf8');
  return slot === 0 ? findingEmitSites(src).length : catchLaunchSites(src).length;
}

function siteCountMismatches(measured, slot, what, table = SITE_COUNTS) {
  const wrong = [];
  const files = new Set([...Object.keys(table), ...Object.keys(measured)]);
  for (const f of [...files].sort()) {
    const want = table[f] ? table[f][slot] : 0;
    const got = measured[f] || 0;
    if (want === got) continue;
    if (table[f]) {
      wrong.push(`${f}: ${got} ${what} sites matched, its SITE_COUNTS line says ${want}`);
      continue;
    }
    const pair = [];
    pair[slot] = got;
    pair[1 - slot] = measuredSites(f, 1 - slot);
    wrong.push(`${f}: ${got} ${what} sites matched and it has no SITE_COUNTS line `
      + `(add '${f}': [${pair[0]}, ${pair[1]}], in sorted order)`);
  }
  return wrong;
}

function assertSiteCounts(measured, slot, what) {
  const wrong = siteCountMismatches(measured, slot, what);
  assert.deepEqual(wrong, [],
    `${what} sites do not match SITE_COUNTS. The LIKELY cause is an emit site added or `
    + 'removed without updating its line: check the diff first, and if that is it, fix the '
    + `line deliberately (number ${slot + 1} of the pair is ${what}). If every line with a nonzero number in that slot is listed, `
    + 'the matcher has drifted and examines nothing -- the dangerous cause, and the reason '
    + 'this is an equality:\n  ' + wrong.join('\n  '));
}

test('SITE_COUNTS is sorted, one well-formed line per check, and names only checks that exist', () => {
  const keys = Object.keys(SITE_COUNTS);
  /* Code-unit order, the same as `LC_ALL=C sort` and JS's default sort. A locale sort
     (glibc en_US ignores '-' and '.') puts some lines elsewhere. */
  for (let i = 1; i < keys.length; i++) {
    assert.ok(keys[i - 1] < keys[i],
      `SITE_COUNTS is out of order: '${keys[i]}' must come before '${keys[i - 1]}' `
      + '(code-unit order, as LC_ALL=C sort; keep it sorted so new lines do not all land in one place)');
  }
  /* 🛑 A DUPLICATE KEY IS INVISIBLE TO THE OBJECT: JS keeps the last one and Object.keys
     shows it once, so a stale copy left by a "keep both" merge would sit there unread.
     Count the keys in the SOURCE. */
  const src = fs.readFileSync(__filename, 'utf8');
  const start = src.indexOf('const SITE_COUNTS = {');
  const end = src.indexOf('\n};', start);
  assert.ok(start >= 0 && end > start, 'could not find the SITE_COUNTS table in this file to check it for duplicates');
  const table = src.slice(start, end).split('\n').slice(1);
  /* Any key spelling (either quote, any indent), so a reformatted copy cannot hide. */
  const seen = table.map((l) => /^\s*(['"])(.+?)\1\s*:/.exec(l)).filter(Boolean).map((m) => m[2]);
  const dups = seen.filter((k, i) => seen.indexOf(k) !== i);
  assert.deepEqual(dups, [], 'SITE_COUNTS has a duplicate line (a merge kept both copies?): ' + dups.join(', '));
  const odd = table.filter((l) => l.trim() && !/^  '[^']+': \[\d+, \d+\],$/.test(l));
  assert.deepEqual(odd, [], "every SITE_COUNTS line is written `  '<check>.js': [n, n],`; these are not");
  const onDisk = new Set(fs.readdirSync(DIR).filter((f) => f.endsWith('.js')));
  for (const [f, pair] of Object.entries(SITE_COUNTS)) {
    assert.ok(onDisk.has(f), `SITE_COUNTS names ${f}, which is not in docs/browser-checks`);
    assert.ok(Array.isArray(pair) && pair.length === 2 && pair.every((n) => Number.isInteger(n) && n >= 0),
      `SITE_COUNTS['${f}'] must be [findingSites, catchSites], got ${JSON.stringify(pair)}`);
    assert.ok(pair[0] + pair[1] > 0, `SITE_COUNTS['${f}'] is [0, 0]; a check with no sites has no line`);
  }
});

/* The finding-emit sites of one check. Its length is that check's first SITE_COUNTS
   number. */
function findingEmitSites(src) {
  const out = [];
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
    out.push({ prefix, decorationOnly });
  }
  return out;
}

test('every emit site in every check prints a line the gate can quote', () => {
  const re = runnerReasonPattern();
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
  /* No file-count floor here. There was one, at `>= 40` against an actual 63,
     and by this file's own rule a floor with 23 of slack is decoration. The
     exact site count below is the real backstop: a broken directory read
     yields zero sites, and every SITE_COUNTS line then goes red. */

  const bad = [];
  const perFile = Object.create(null);
  for (const f of files) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const { prefix, decorationOnly } of findingEmitSites(src)) {
      perFile[f] = (perFile[f] || 0) + 1;
      /* A decoration needs a finding appended to become a line; a
         marker-carrying prefix already IS the start of one. */
      const printed = decorationOnly ? prefix + 'a sample finding' : prefix;
      if (!re.test(printed)) bad.push(`${f}: prints "${prefix}" + finding`);
    }
  }

  assertSiteCounts(perFile, 0, 'finding-emit');

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

/* The catch/launch sites of one check; its length is the second SITE_COUNTS number.
   These prefixes are already the START of a failure line (a crash/launch emit, not a
   decoration awaiting a finding), so they are tested as they stand. An
   empty/whitespace-only prefix is not a marker and is not a site. */
function catchLaunchSites(src) {
  return catchLaunchPrefixes(src).filter((prefix) => /[^\s]/.test(prefix));
}

test('every catch/launch emit prints a line the gate can quote (#1864)', () => {
  const re = runnerReasonPattern();
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
  const bad = [];
  const perFile = Object.create(null);
  for (const f of files) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const prefix of catchLaunchSites(src)) {
      perFile[f] = (perFile[f] || 0) + 1;
      if (!re.test(prefix)) bad.push(`${f}: catch/launch prints "${prefix}"`);
    }
  }
  assertSiteCounts(perFile, 1, 'catch/launch');
  assert.deepEqual(bad, [],
    'these checks print catch/launch failures the gate cannot quote, so a red reports '
    + '"(no FAIL or error line in its output)":\n  ' + bad.join('\n  '));
});

test('a check with no SITE_COUNTS line is told its real pair, both slots measured (#5106 review)', () => {
  /* A check whose two counts differ and are both nonzero, so a guessed 0 in either slot
     AND a swapped pair are both wrong answers this can see. */
  const f = Object.keys(SITE_COUNTS).find((k) => SITE_COUNTS[k][0] > 0 && SITE_COUNTS[k][1] > 0
    && SITE_COUNTS[k][0] !== SITE_COUNTS[k][1]);
  assert.ok(f, 'no check has two different nonzero counts to test the suggestion with');
  const real = SITE_COUNTS[f];
  /* Control: the source measures the table's pair, so "its real pair" is a fact here,
     not the table repeated back. */
  assert.deepEqual([measuredSites(f, 0), measuredSites(f, 1)], real);
  const copy = { ...SITE_COUNTS };
  delete copy[f];
  for (const slot of [0, 1]) {
    const mine = siteCountMismatches({ [f]: real[slot] }, slot, 'test', copy)
      .filter((l) => l.startsWith(f + ':'));
    assert.deepEqual(mine, [`${f}: ${real[slot]} test sites matched and it has no SITE_COUNTS line `
      + `(add '${f}': [${real[0]}, ${real[1]}], in sorted order)`], `slot ${slot}`);
  }
  /* A name with no source prints '?', never a guessed number. */
  const ghost = siteCountMismatches({ 'no-such-check.js': 1 }, 0, 'test', {});
  assert.deepEqual(ghost, ["no-such-check.js: 1 test sites matched and it has no SITE_COUNTS line "
    + "(add 'no-such-check.js': [1, ?], in sorted order)"]);
  assert.deepEqual(siteCountMismatches({ 'no-such-check.js': 1 }, 1, 'test', {}),
    ["no-such-check.js: 1 test sites matched and it has no SITE_COUNTS line "
    + "(add 'no-such-check.js': [?, 1], in sorted order)"]);
});
