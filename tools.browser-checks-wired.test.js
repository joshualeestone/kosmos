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
  'render-agent-lines.js': '#1303 A item 3, merged 2026-08-28. Never wired.',
  'render-conn-url.js': 'never wired.',
  'render-found-count.js': '#1346, merged 2026-08-28. Never wired.',
  'render-long-title.js': '#1303 F, merged 2026-08-28. Never wired.',
  'render-openai-key-step.js': 'never wired.',
  'render-openai-step.js': 'never wired.',
  'render-project-rows.js': '#1303 E, merged 2026-08-28. Never wired.',
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
  assert.ok(code.includes('render-projects'), 'the matcher cannot find a check it should find');
  assert.ok(!code.includes('zzz-not-a-real-check'), 'the matcher finds a name that does not exist');
});

test('#1387: every browser check is RUN by the runner, or is listed as unwired with a reason', () => {
  const code = runnerCode();
  const orphans = [];
  for (const f of checkFiles()) {
    if (isLibrary(f)) continue;
    if (Object.prototype.hasOwnProperty.call(NOT_WIRED, f)) continue;
    if (!code.includes(f.replace(/\.js$/, ''))) orphans.push(f);
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
  const stale = Object.keys(NOT_WIRED).filter((f) => code.includes(f.replace(/\.js$/, '')));
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
