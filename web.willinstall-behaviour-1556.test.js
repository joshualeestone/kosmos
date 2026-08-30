'use strict';

/**
 * #1556: the confirm dialog must actually be SKIPPED, not merely skippable.
 *
 * 🛑 WHY THIS EXISTS. The only previous guard on this behaviour,
 * `web.connect-confirm.test.js:113`, matches the string `willInstall` in the
 * READER'S SOURCE. That passes whether or not the value is ever a boolean, and it
 * passed throughout the period when this branch served the field on a route the
 * page never reads. A source-text assertion cannot tell "asks the question" from
 * "gets an answer".
 *
 * ⭐ SO THIS ONE EXECUTES THE READER. `frConnectStart` gates on
 * `if (!confirmed && frClaudeInstallNeeded())`, so that predicate IS the decision:
 * false means the 281MB confirm is skipped, true means it opens. Driving the whole
 * of `frConnectStart` would need a dozen page globals; driving the predicate needs
 * none and covers the branch that changed.
 *
 * The three cases are the three states a user is actually in.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page.js');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));

/** Runs the real page function against a supplied FR, and nothing else. */
function installNeededWith(FR) {
  // eslint-disable-next-line no-new-func
  return new Function('FR', page.lift(SCRIPT, 'frClaudeInstallNeeded') + '\nreturn frClaudeInstallNeeded();')(FR);
}

test('#1556 a working Claude SKIPS the download confirm', () => {
  assert.equal(installNeededWith({ connect: { willInstall: false } }), false,
    'somebody with Claude Code already installed is still shown the 281MB confirm');
});

test('#1556 a machine that needs the download still gets the confirm', () => {
  assert.equal(installNeededWith({ connect: { willInstall: true } }), true,
    'the confirm was skipped for somebody who is about to download 281MB unannounced');
});

test('#1556 an unknown answer still asks, in all three of its shapes', () => {
  /* ⚠️ THE FAIL-OPEN DIRECTION, AND IT IS THE ONE THAT MATTERS. Every shape that
     is not a boolean must ask. A confident "no" here is the unannounced download. */
  for (const [label, FR] of [
    ['no FR at all', null],
    ['FR with no connect key (the bug this branch shipped first)', { subscription: {} }],
    ['connect present but the field absent', { connect: {} }],
    ['the field present but not a boolean', { connect: { willInstall: 'no' } }],
  ]) {
    assert.equal(installNeededWith(FR), true, `${label}: an unknown answer did not fall back to asking`);
  }
});
