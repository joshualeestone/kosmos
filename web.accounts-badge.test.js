'use strict';

/**
 * Settings > Accounts' Connected badge is computed, never hardcoded (#881,
 * then #960 for the OpenAI provider): the static markup used to say
 * "Connected" for every account row unconditionally, regardless of any
 * real check. Same source-pattern style as web.conn-live.test.js --
 * asserting on the function's own source text, not executing its full
 * DOM/fetch dependency chain, matching this file's established convention
 * for testing web/index.html's paint functions.
 *
 *   node --test web.accounts-badge.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');

test('paintAccounts() renders three real states, not one hardcoded one', () => {
  const start = PAGE.indexOf('async function paintAccounts');
  assert.ok(start >= 0, 'paintAccounts moved or was renamed; restate this pin');
  const end = PAGE.indexOf('\nasync function', start + 1);
  const fn = PAGE.slice(start, end > start ? end : PAGE.length);
  assert.ok(fn.length > 200, 'the extracted function body looks too short; the slice bounds probably moved');

  // ⚠️ NOT a bare 'Connected' literal outside the ternary's own branches --
  // the regression this test exists to catch is exactly that markup going
  // back to unconditional. Every branch of connBadge is checked instead.
  assert.match(fn, /a\.connection\s*&&\s*a\.connection\.state === 'connected'/,
    'the connected branch no longer reads a.connection.state -- the badge may be unconditional again');
  assert.match(fn, /a\.connection\.state === 'none'/, 'the not-connected branch is gone');
  assert.match(fn, /class="acct-none"/, 'the not-connected branch lost its distinct CSS class');
  assert.match(fn, /class="acct-unknown"/, 'the could-not-check branch lost its distinct CSS class');

  // The real sentence must be BOTH the title and the visible text (#761
  // item 8's rule, applied here in challenge-loop iteration 2) -- not a
  // fixed generic label with the reason hidden in a hover-only tooltip.
  assert.match(fn, /title="'\s*\+\s*esc\(noneWhy\)\s*\+\s*'"[^<]*<span class="dot"[^<]*<\/span>'\s*\+\s*esc\(noneWhy\)/,
    'the none badge does not show the same because-sentence as both title and visible text');
  assert.match(fn, /title="'\s*\+\s*esc\(unknownWhy\)\s*\+\s*'"[^<]*<span class="dot"[^<]*<\/span>'\s*\+\s*esc\(unknownWhy\)/,
    'the unknown badge does not show the same because-sentence as both title and visible text');

  // OpenAI rows carry a real connection field too (#960), so the ternary
  // must NOT branch on provider any more -- a regression here would bring
  // back the exact pre-#960 hardcoded-Connected shape for that provider.
  assert.doesNotMatch(fn, /isOpenai \? '<span class="acct-connected">/,
    'the OpenAI-row unconditional badge is back -- #960 regressed');

  // The epoch guard (challenge-loop iteration 2, a real race once this
  // route stopped being an instant read) must still be present.
  assert.match(fn, /const mine = \+\+ACCT_EPOCH;/, 'the epoch guard against a stale slower fetch overwriting a fresher paint is gone');
  assert.match(fn, /if \(mine !== ACCT_EPOCH\) return;/, 'the epoch guard is declared but never checked');
});
