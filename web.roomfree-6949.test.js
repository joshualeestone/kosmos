'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * #6949: the page decides which reaction pill is a room post's claim with its own copy of the engine's rule
 * (RXN_CLAIM_FORM beside rxnsInner, engine/messages.js isClaimEmoji). The two must agree on every raised hand, or a
 * claim the board holds shows on the page as an ordinary reaction with no Free beside it. This runs the same forms
 * through both, the page's lifted from web/index.html.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');
const messages = require('./engine/messages');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));
const RXN_CLAIM_FORM = new Function(page.liftConst(SCRIPT, 'RXN_CLAIM_FORM') + '\nreturn RXN_CLAIM_FORM;')();

const FORMS = [
  '\u{1F64B}',                          // plain
  '\u{1F64B}\u{1F3FB}', '\u{1F64B}\u{1F3FF}',   // skin tones, both ends of the range
  '\u{1F64B}‍♀️', '\u{1F64B}\u{1F3FD}‍♂️',   // gendered, with and without a tone
  '\u{1F64B}️', '\u{1F64B}︎',   // presentation selectors
  // not claims
  '\u{1F64B}\u{1F525}', '\u{1F44D}', '\u{1F64C}', '', 'raise',
];

test('the page and the engine agree on which emoji is a claim, for every form', () => {
  const claims = FORMS.filter((e) => messages.isClaimEmoji(e));
  assert.ok(claims.length >= 7 && claims.length < FORMS.length, 'the corpus does not hold both claims and non-claims');
  for (const e of FORMS) {
    assert.equal(RXN_CLAIM_FORM.test(e), messages.isClaimEmoji(e),
      'the page and the engine disagree on ' + JSON.stringify(e) + ' (' + [...e].map((c) => c.codePointAt(0).toString(16)).join(' ') + ')');
  }
});
