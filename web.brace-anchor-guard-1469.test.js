'use strict';
// #1469 - the brace-anchor guard. Logic + pin table live in the sibling module
// web.brace-anchor-guard-1469.lib.js (read its header for the claim this makes
// and the traps it is proven against); this file is the node:test that runs it.
// The proof by planting is web.brace-anchor-guard-1469.selftest.test.js.

const test = require('node:test');
const assert = require('node:assert');
const { checkBraceAnchors } = require('./web.brace-anchor-guard-1469.lib.js');

test('#1469: every #1430-loosened CSS assertion still has its open tail (no brace re-anchor)', () => {
  const failures = checkBraceAnchors(__dirname);
  assert.deepStrictEqual(
    failures, [],
    '#1469 brace-anchor guard tripped. A loosened CSS assertion was re-anchored to its\n' +
    'closing brace (any spelling: \\}, }, ; \\}, ;\\s*\\}, or wrapped onto two lines), which\n' +
    'reintroduces the #1310 brittleness that took main red. Restore the open-tail form,\n' +
    'or - if the assertion was legitimately removed/reshaped - update EXPECTED in the\n' +
    'lib module to match. Failures:\n' + JSON.stringify(failures, null, 2)
  );
});
