'use strict';

/**
 * #1668: the operator's timezone, captured in Settings and consumed on the
 * direct-message path so an agent is told the operator's local time.
 *
 * The card's own bar: it is not done when the setting saves, it is done when an
 * agent's greeting changes. So the load-bearing test here is not "the store
 * kept a string", it is that the EXACT expression server.js composes for the
 * operator prefix (messages.operatorDirect(messages.operatorNowLabel(
 * store.readSettings().timezone))) says the local time where, before a timezone
 * was set, it said nothing about time at all.
 *
 *   node --test engine/timezone-1668.test.js
 */

const os = require('node:os');
const path = require('node:path');

// ⚠️ Sandbox the data root BEFORE requiring store, exactly as the sibling
// suites do: writeSettings writes settings.json under store.root(), and an
// unsandboxed run would write into the operator's real record.
const SANDBOX = path.join(os.tmpdir(), 'kosmos-tz-1668-test-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('./store');
const messages = require('./messages');

// A pinned instant so the demonstration is deterministic. 2026-08-31 18:14:00Z
// is 1:14 PM in America/Chicago (CDT) and 3:14 AM the next day in Asia/Tokyo.
const NOW = new Date('2026-08-31T18:14:00Z');

// The exact composition server.js uses at the delivery point (5090), with the
// instant pinned so the assertion does not depend on when the suite runs.
function operatorPrefixForStoredTz(now) {
  return messages.operatorDirect(messages.operatorNowLabel(store.readSettings().timezone, now));
}

test('store: a timezone round-trips and an unset store reads empty', () => {
  // A fresh sandbox has no settings file yet.
  assert.equal(store.readSettings().timezone, undefined);
  const saved = store.writeSettings({ timezone: 'America/Chicago' });
  assert.equal(saved.timezone, 'America/Chicago');
  assert.ok(saved.updatedAt, 'a write stamps updatedAt');
  assert.equal(store.readSettings().timezone, 'America/Chicago');
});

test('validTimeZone accepts an IANA id and refuses anything else', () => {
  assert.equal(messages.validTimeZone('America/Chicago'), true);
  assert.equal(messages.validTimeZone('Asia/Tokyo'), true);
  assert.equal(messages.validTimeZone('Not/AZone'), false);
  assert.equal(messages.validTimeZone(''), false);
  assert.equal(messages.validTimeZone(null), false);
  assert.equal(messages.validTimeZone(42), false);
});

test('operatorNowLabel reflects the stored zone and degrades without throwing', () => {
  assert.equal(messages.operatorNowLabel('America/Chicago', NOW), '1:14 PM CDT');
  assert.equal(messages.operatorNowLabel('America/New_York', NOW), '2:14 PM EDT');
  // Tokyo's short zone name is the offset form ("GMT+9") on this ICU build but
  // could be "JST" on another, so pin the local time and that it differs from
  // the US zone, not the ICU-dependent abbreviation. (CDT/EDT above are stable
  // English abbreviations, so those stay exact.)
  const tokyo = messages.operatorNowLabel('Asia/Tokyo', NOW);
  assert.match(tokyo, /^3:14 AM /);
  assert.notEqual(tokyo, messages.operatorNowLabel('America/Chicago', NOW));
  // no zone, or an id the runtime does not know: '' (the bare prefix follows)
  assert.equal(messages.operatorNowLabel('', NOW), '');
  assert.equal(messages.operatorNowLabel('Not/AZone', NOW), '');
});

test('THE DEMONSTRATION: the operator prefix an agent receives changes once a timezone is set', () => {
  // Before: no timezone in the store. The prefix is the timeless base, byte for
  // byte the bare operator prefix every agent has always received.
  store.writeSettings({ timezone: null });
  const before = operatorPrefixForStoredTz(NOW);
  assert.equal(before, messages.operatorDirect());
  assert.equal(before.includes(' at '), false, 'timeless prefix carries no time');

  // After: the operator sets their timezone. The SAME expression now composes a
  // prefix that states their local time. This is the agent saying the right
  // thing where it previously said the timeless thing.
  store.writeSettings({ timezone: 'America/Chicago' });
  const after = operatorPrefixForStoredTz(NOW);
  assert.notEqual(after, before, 'the prefix changed');
  assert.equal(after, '[message from your operator at 1:14 PM CDT · to answer, run: kosmos reply]');

  // And it is the STORED zone that is spoken, not a fixed one: a different saved
  // zone yields a different local time from the same instant.
  store.writeSettings({ timezone: 'Asia/Tokyo' });
  const tokyo = operatorPrefixForStoredTz(NOW);
  // Tokyo is 3:14 AM the next day; pin the time and that it differs from the
  // Chicago prefix, not the ICU-dependent short zone name (GMT+9 here, JST on
  // another ICU build).
  assert.ok(tokyo.includes(' at 3:14 AM '), 'the Tokyo prefix carries the local time');
  assert.equal(tokyo.includes('CDT'), false, 'it speaks Tokyo, not the Chicago zone');
  assert.notEqual(tokyo, after, 'the spoken time follows the stored zone');

  // The opening marker is unchanged in every form, so the anti-forgery guard
  // that refuses an agent body containing it still matches.
  for (const p of [before, after, tokyo]) {
    assert.ok(p.startsWith('[message from your operator'), 'marker prefix intact');
  }
});
