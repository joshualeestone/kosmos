'use strict';

/**
 * #2568: the OpenAI provider row in Settings > AI Models rendered a chatgpt
 * SUBSCRIPTION account's long connection sentence inside the status pill, and
 * the pill classes are `white-space: nowrap`, so the sentence could not wrap:
 * it overflowed the pill and collided with the account email beside it (Josh,
 * live on v0.6.50: `jo$h@bookuio...in method is not yet checked live`).
 *
 * The fix: a chatgpt OpenAI row (no server `badge`, checkLive() returns state
 * UNKNOWN with a real long `because`) renders a SHORT shape pill -- the
 * signed-in-unverified shape, since a subscription sign-in DOES exist -- with
 * the full sentence in the `title`, matching the #1921 badge vocabulary's
 * short-visible/full-in-title rule the Claude pills already use. This is the
 * "auth_mode-shape display" #2568 asks the OpenAI row to adopt.
 *
 * Source-pattern style, matching web.accounts-badge.test.js / web.reauth-1492.test.js
 * (assert on the row builder's own source text, not its full DOM/fetch chain).
 *
 *   node --test web.openai-row-2568.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');

function rowBuilderSource() {
  const at = PAGE.indexOf('const acctRowHtml = (a) =>');
  assert.ok(at > -1, 'the row builder moved; restate this pin');
  const end = PAGE.indexOf('box.innerHTML = accountGroupsHtml', at);
  assert.ok(end > at, 'the row builder end marker moved; restate this pin');
  return PAGE.slice(at, end);
}

test('a chatgpt OpenAI row renders a SHORT pill, gated on the auth_mode SHAPE, before the legacy fallback', () => {
  const row = rowBuilderSource();

  const branchAt = row.search(/else if \(isOpenai && a\.authMode === 'chatgpt'\) \{/);
  assert.ok(branchAt > -1,
    'the chatgpt OpenAI row has no dedicated pill branch -- it falls to the legacy fallback and overflows the email again (#2568)');

  // The branch must sit BEFORE the legacy `else` fallback, or it never runs
  // (the fallback's bare `else` would swallow every badge-less row first).
  const fallbackAt = row.indexOf('The legacy state ternary, kept as the fallback');
  assert.ok(fallbackAt > branchAt,
    'the chatgpt branch is after the legacy fallback, so a bare else swallows the row before it is reached');

  // Isolate the chatgpt branch's connBadge assignment (up to the next `} else`).
  const branch = row.slice(branchAt, row.indexOf('} else', branchAt + 1));

  // The full because sentence goes in the TITLE (hover), never the visible span.
  assert.match(branch, /title="'\s*\+\s*esc\(unknownWhy\)\s*\+\s*'"/,
    'the chatgpt pill does not carry the full reason in its title');

  // The visible label is SHORT and fixed -- the overflow was the long sentence
  // sitting in the visible span, so that shape must NOT come back here.
  assert.match(branch, /<\/span>Signed in · not checked live<\/span>/,
    'the chatgpt pill lost its short visible label');
  assert.doesNotMatch(branch, /<\/span>'\s*\+\s*esc\(unknownWhy\)/,
    'the chatgpt pill puts the long because sentence back in the visible span -- the exact #2568 overflow');

  // Gated on the auth_mode SHAPE, not the provider alone: an api-key OpenAI row
  // (no email, a key last-4) is a different case and is left to the fallback.
  assert.match(branch, /a\.authMode === 'chatgpt'/,
    'the branch is not gated on the chatgpt auth-mode shape');
});
