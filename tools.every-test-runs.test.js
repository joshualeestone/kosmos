'use strict';

/**
 * Every shell test in tools/ is actually RUN by the suite.
 *
 * 🛑 WHY. On 2026-08-27 an audit found tools/test-sweep-leaked.sh named
 * NOWHERE in this repo -- not executed, not syntax-checked, not mentioned. It
 * is the control set for sweep-leaked-supervisors.sh, which bootouts launchd
 * jobs: a DELETE path. 19 arms, fully stubbed, under a second to run. Nothing
 * had ever run it, and nothing said so.
 *
 * ⭐ AN UNRUN GUARD READS AS COVERAGE. That is the whole defect: the file
 * exists, the arms are real, a reader counting guards counts it, and it can
 * never go red. It has the same shape as the thing it is supposed to catch --
 * it makes the log say the work was done.
 *
 * 🔑 THIS IS THE DURABLE HALF. Wiring that one script in fixes today; this
 * fixes the next one, which is the same principle as naming a watcher
 * uniquely instead of remembering to kill by PID, and the same principle as
 * the worktree recipe in CLAUDE.md: make the safe path the only path rather
 * than banning the deviation. Adding a test to tools/ now fails the suite
 * until somebody says how it runs.
 *
 * ⚠️ EXECUTED, NOT MERELY MENTIONED, and the distinction is not pedantry.
 * `bash -n x.sh` is a SYNTAX CHECK: it parses the file and executes nothing,
 * so a script that only appears that way has still never been watched to
 * pass or fail. Splinter's freeze monitor raised a false alarm the same
 * morning by counting a `bash -n tools/browser-checks.sh` as a RUN of it.
 * A substring match cannot tell a mention from an execution.
 *
 *   node --test tools.every-test-runs.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SHELL = require('./package.json').scripts['test:shell'] || '';

/**
 * Scripts that are deliberately NOT in the automatic suite. Each needs a
 * reason, and the reason has to be a real cost, not a preference.
 *
 * ⚠️ THE ALLOWLIST IS THE DANGEROUS PART OF THIS FILE. It is the documented
 * way to make a guard stop running, so it must stay short and each line must
 * be checkable against the script's own header rather than asserted here.
 */
const MANUAL = {
  'tools/test-install.sh':
    'does a real install from staged dist/ trees; has its own npm script (test:install). Its header says to build the trees first.',
  'tools/test-install-gate-control.sh':
    'needs the staged dist/ trees and takes minutes across three gate runs; its own header says "run by hand before changing the gate".',
};

function toolsTests() {
  return fs.readdirSync('tools')
    .filter((f) => /^test-.*\.sh$/.test(f))
    .map((f) => 'tools/' + f)
    .sort();
}

/* 🔑 A FLOOR ON THE POPULATION, the same reason check-served.js has one. If
   the directory read came back empty this file would pass by finding nothing
   to check, which is the failure mode it exists to prevent. */
test('the instrument is reading something', () => {
  const found = toolsTests();
  assert.ok(found.length >= 10, `only ${found.length} tools/test-*.sh found; the directory read looks broken, and every assertion below would pass for the wrong reason`);
});

test('every tools/test-*.sh is EXECUTED by the suite, or is explicitly manual with a reason', () => {
  const orphans = [];
  const mentionedOnly = [];

  for (const f of toolsTests()) {
    if (Object.prototype.hasOwnProperty.call(MANUAL, f)) continue;

    /* Executed = `bash <file>` or `sh <file>` with no -n. Anchor on the space
       so `bash -n tools/x.sh` cannot satisfy `bash tools/x.sh`. */
    const executed = new RegExp('(?:^|&&|;)\\s*(?:bash|sh)\\s+' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s|$)').test(SHELL);
    if (executed) continue;

    if (SHELL.includes(f)) mentionedOnly.push(f);
    else orphans.push(f);
  }

  assert.deepEqual(orphans, [],
    `named nowhere in test:shell, so nothing runs them and nothing says so: ${orphans.join(', ')}. Add `
    + `"&& bash <file>" to test:shell, or add it to MANUAL in this file with the real reason it cannot run automatically.`);

  assert.deepEqual(mentionedOnly, [],
    `only SYNTAX-CHECKED (bash -n), never executed: ${mentionedOnly.join(', ')}. A syntax check parses the file and runs `
    + `nothing, so these have never been watched to pass or fail. Execute them, or declare them MANUAL with a reason.`);
});

/**
 * ⚠️ THE ALLOWLIST HAS TO STAY HONEST, or it becomes the hole. A stale entry
 * naming a deleted file reads as "we thought about this one" while covering
 * nothing -- the same shape as an absence check on a string that never
 * existed.
 */
test('every MANUAL entry names a file that exists and carries a reason', () => {
  for (const [f, why] of Object.entries(MANUAL)) {
    assert.ok(fs.existsSync(f), `MANUAL names ${f}, which does not exist. Remove the entry rather than leaving it to read as coverage`);
    assert.ok(typeof why === 'string' && why.trim().length > 30, `MANUAL[${f}] needs a real reason, not a placeholder`);
  }
});
