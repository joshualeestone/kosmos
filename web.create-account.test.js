'use strict';

/**
 * The create-agent dialog's account picker reads a real live check, not
 * just presence (#881, iteration 8): a person could otherwise create a new
 * agent against an account this same PR's own logic already knows is not
 * signed in, with no signal in the one place that decision is made. Same
 * source-pattern style as web.accounts-badge.test.js / web.conn-live.test.js
 * -- asserting on the functions' own source text, not executing their full
 * DOM/fetch chain.
 *
 *   node --test web.create-account.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');

test('fillCreateAccounts() excludes a confirmed-not-signed-in account and labels an unchecked one', () => {
  const start = PAGE.indexOf('function fillCreateAccounts');
  assert.ok(start >= 0, 'fillCreateAccounts moved or was renamed; restate this pin');
  const end = PAGE.indexOf('\n}', start);
  const fn = PAGE.slice(start, end > start ? end + 2 : PAGE.length);
  assert.ok(fn.length > 100, 'the extracted function body looks too short; the slice bounds probably moved');

  // ⚠️ EXCLUDED, not just visually flagged: "an option that always fails
  // is worse than an option that is not there" (this file's own rule,
  // already applied to a non-shared-memory account a few thousand lines
  // away). A `none` connection state is a POSITIVELY confirmed negative,
  // the one case the asymmetry rule allows acting on.
  assert.match(fn, /x\.connection\.state !== 'none'/, 'a confirmed-not-signed-in account is no longer filtered out');
  // ⚠️ NOT excluded for `unknown` -- that would be the false-negative
  // mistake this whole feature exists to prevent, applied here instead
  // of caught. Labelled instead, so the choice stays informed.
  assert.match(fn, /x\.connection\.state === 'unknown'/, 'the could-not-check label is gone');
  assert.match(fn, /could not check just now/, 'the could-not-check account lost its label text');
  // OpenAI rows carry no `connection` field (out of scope for #881) and
  // must stay untouched by either filter.
  assert.match(fn, /openai \? list :/, 'the OpenAI branch no longer bypasses the connection-state filter');
});

test('loadCreateExtras() shows a loading state before the account list resolves', () => {
  const start = PAGE.indexOf('async function loadCreateExtras');
  assert.ok(start >= 0, 'loadCreateExtras moved or was renamed; restate this pin');
  const end = PAGE.indexOf('\n}', PAGE.indexOf('fillCreateAccounts();', start));
  const fn = PAGE.slice(start, end > start ? end + 2 : PAGE.length);
  assert.match(fn, /asel\.innerHTML = '<option value="" disabled selected>Checking…<\/option>'/,
    'the account select no longer shows a loading state while GET /api/accounts (now a real live check) is in flight');
});
