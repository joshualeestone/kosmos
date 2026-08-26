'use strict';

/**
 * The connect tab's summary line is computed, never asserted (the
 * connections taxonomy doc, 2026-08-24): the static page said "Nothing is
 * connected yet" while the account thinking for every agent was live one
 * tab away.
 *
 *   node --test web.conn-live.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');

test('the static markup makes no connected-or-not claim; the painter owns all three arms', () => {
  const at = PAGE.indexOf('id="s-sec-connect"');
  const end = PAGE.indexOf('id="s-sec-gskills"') > at ? PAGE.length : PAGE.indexOf('</section>', at);
  const sec = PAGE.slice(at, PAGE.indexOf('id="conn-live"') + 4000).replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!/Nothing is connected yet/.test(sec.slice(0, 3000)),
    'the static copy asserts nothing-connected; that sentence is the painter’s none-arm only');
  assert.match(PAGE, /id="conn-live"/, 'the computed line’s element is gone');

  const fn = PAGE.slice(PAGE.indexOf('async function paintConnLive'), PAGE.indexOf('async function paintPolicy'));
  assert.ok(fn.length > 0, 'the painter moved; restate this pin');
  assert.match(fn, /Nothing is connected yet\./, 'the none-arm lost its sentence');
  assert.match(fn, /could not check your accounts/, 'could-not-check collapsed into nothing-connected');
  assert.match(fn, /connected and thinking for your agents/, 'the connected arm lost its sentence');
  assert.match(fn, /settingsGo\('accounts'\)/, 'the connected arm does not link to the Accounts tab');
});

test('#881: the count is filtered on a real live check, not raw row presence', () => {
  /* Caught in challenge-loop iteration 6: this function picked up the
     same class of "counts every row regardless of whether it is really
     connected" gap paintAccounts() was already fixed for, without
     getting the equivalent test coverage paintAccounts() got. Verified
     via source pattern (this file's own established style), not DOM
     execution -- matching web.accounts-badge.test.js. */
  const fn = PAGE.slice(PAGE.indexOf('async function paintConnLive'), PAGE.indexOf('async function paintPolicy'));
  assert.match(fn, /a\.provider !== 'anthropic' \|\| \(a\.connection && a\.connection\.state === 'connected'\)/,
    'the connected-count filter no longer checks connection.state -- every present row may be counted again regardless of whether it actually works');
  // ⚠️ THE ASYMMETRY, applied to a zero count specifically: a zero count
  // from every account being UNKNOWN (a claude auth status timeout, a
  // missing binary) must not render as the same "Nothing is connected
  // yet." sentence a genuine zero would -- that IS the false-negative
  // claim this whole card (#881) exists to eliminate, on a second
  // surface this same diff introduced.
  assert.match(fn, /anyUnknown/, 'the unknown-vs-none distinction for a zero count is gone');
  assert.match(fn, /a\.connection\.state === 'unknown'/, 'the anyUnknown check no longer reads connection.state');
});
