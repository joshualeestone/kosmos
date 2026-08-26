'use strict';
/**
 * #864 (Josh, 2026-08-26): "kill the line." The positive arm of the
 * per-account history sentence ("An agent moved here keeps its
 * conversation history") was filler nobody outside the team could parse.
 * The negative arm is a real, working "Fix this" button for an account
 * that does not share history, and stays -- he asked to kill the line,
 * not the remedy.
 *
 *   node --test web.accounts-history-line.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.slice(PAGE.lastIndexOf('<script>'));

test('the "keeps its conversation history" line is gone', () => {
  assert.doesNotMatch(SCRIPT, /An agent moved here keeps its conversation history/,
    'the positive-arm filler line is back');
});

test('the "Fix this" button for an account with no shared history still exists', () => {
  assert.match(SCRIPT, /An agent moved here would start with no history\. Fix this/,
    'the real remedy button was removed along with the filler line');
  assert.match(SCRIPT, /data-share="' \+ esc\(a\.dir\) \+ '"/,
    'the Fix-this button lost its wiring to the account it names');
});

test('an account that already shares history says nothing, rather than the removed filler', () => {
  const at = SCRIPT.indexOf('const shared = isOpenai || a.memoryShared ? \'\'');
  assert.ok(at > -1, 'the shared-history branch no longer collapses OpenAI and memoryShared to the same empty case');
});
