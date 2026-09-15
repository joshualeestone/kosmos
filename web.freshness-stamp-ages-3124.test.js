'use strict';

/**
 * #3124: the agent-status freshness stamp must age on the OBSERVER'S clock.
 *
 * The stamp existed to make a frozen board legible -- "if this stops updating,
 * the stamp goes stale visibly rather than the board freezing on a happy
 * picture." It did the opposite. `age` was computed from `data.checkedAt`, which
 * the server stamps at response-BUILD time (it re-scrapes every request), so on
 * any live board `age` was ~network-latency ~= 0. The stamp could only ever read
 * "just now"; the `age > 30` stale band and every freshWords band above the
 * floor were unreachable. Josh, #admin: "I've never seen it say anything other
 * than that." He was right -- it structurally could not.
 *
 * The fix is `ageCheckedStamp()`: it renders from `LAST_STATUS_OK_AT` (the
 * client-clock instant of the last successful poll) and runs on its own ~1s
 * timer, so it can show the ABSENCE of new data -- which a stamp painted only
 * when data ARRIVES can never do.
 *
 * 🛑 THIS FILE RUNS THE FUNCTION, it does not only read source. The whole defect
 * was a stamp whose paint was correct on its own terms but structurally pinned
 * to age 0; only driving the ager with a controlled age can show it now moves.
 *
 *   node --test web.freshness-stamp-ages-3124.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const vm = require('node:vm');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

/* A fresh sandbox per test: `ageCheckedStamp` reads the free globals
   `LAST_STATUS_OK_AT` / `STATUS_POLL_FAILED` and `freshWords`, and paints
   `document.getElementById('checked')`. It never assigns the globals, so setting
   them on the context before the call is enough. */
function world({ okAt, failed }) {
  const checked = { className: 'PRISTINE', innerHTML: 'PRISTINE' };
  const ctx = {
    document: { getElementById: (id) => (id === 'checked' ? checked : null) },
    Date,
    LAST_STATUS_OK_AT: okAt === undefined ? null : okAt,
    STATUS_POLL_FAILED: !!failed,
    console,
  };
  vm.runInNewContext(page.liftAll(SCRIPT, ['freshWords', 'ageCheckedStamp']), ctx);
  return {
    checked,
    age() { ctx.ageCheckedStamp(); return checked; },
  };
}

test('a board just heard from reads "just now" and is NOT stale', () => {
  const c = world({ okAt: Date.now() }).age();
  assert.match(c.innerHTML, /Refreshed just now/);
  assert.equal(c.className, 'checked stamp', 'a fresh poll must not carry the stale treatment');
});

test('THE BITE: a board not heard from for minutes ages and goes stale', () => {
  /* This is the state the old paint-on-arrival stamp could never reach on a live
     server, because `age` was always ~0. 125s is comfortably inside floor(n/60)
     == 2 minutes, so clock drift of a few ms cannot move the band. */
  const c = world({ okAt: Date.now() - 125000 }).age();
  assert.match(c.innerHTML, /Refreshed 2 minutes ago/,
    'the stamp did not age from the last successful poll');
  assert.match(c.className, /\bstale\b/,
    'age > 30 did not fire the stale treatment -- the dead band is still dead');
});

test('the stale band boundary works: 45s ago is stale, 5s ago is not', () => {
  assert.match(world({ okAt: Date.now() - 45000 }).age().className, /\bstale\b/);
  assert.doesNotMatch(world({ okAt: Date.now() - 5000 }).age().className, /\bstale\b/,
    '5 seconds is under the 30s floor and must not read stale');
});

test('a FAILED poll owns the stamp: the ager leaves it untouched', () => {
  /* tick()'s catch path paints "could not refresh" and sets STATUS_POLL_FAILED.
     The ager must not overwrite that with an aging number until a poll succeeds
     again -- otherwise a dead board drifts back to a plausible "N seconds ago". */
  const w = world({ okAt: Date.now() - 999000, failed: true });
  const c = w.age();
  assert.equal(c.innerHTML, 'PRISTINE', 'the ager repainted over the failure message');
  assert.equal(c.className, 'PRISTINE');
});

test('before the first successful poll the ager says nothing', () => {
  /* No LAST_STATUS_OK_AT yet: rendering an age from a missing instant would be a
     fabricated freshness claim, the exact inversion freshWords guards for null. */
  const c = world({ okAt: null }).age();
  assert.equal(c.innerHTML, 'PRISTINE', 'the ager invented a freshness with no poll behind it');
});

test('the ager is WIRED to a timer, and the old response-time source is gone', () => {
  /* 🛑 A HELPER NOTHING CALLS is the defect this suite keeps finding. The ~1s
     interval is the caller that makes the stamp able to age between polls. */
  assert.match(SCRIPT, /setInterval\(ageCheckedStamp, 1000\)/,
    'the 1s ager is not scheduled, so the stamp still only moves when a poll lands');
  assert.match(SCRIPT, /LAST_STATUS_OK_AT = Date\.now\(\)/,
    'the success path does not record the client-clock instant of the poll');
  assert.match(SCRIPT, /STATUS_POLL_FAILED = true/,
    'the catch path does not hand the stamp to the failure message');
  /* Control: the stamp must no longer be built from the server response time,
     which is what made it vacuous. If this reappears, age is pinned to ~0 again. */
  assert.doesNotMatch(SCRIPT, /new Date\(data\.checkedAt\)/,
    'the stamp is being computed from data.checkedAt again -- age is pinned to ~0');
});
