'use strict';
/**
 * #8173 (the Muse half of #8159): a Muse sign-in Kosmos last saw work weeks ago read green "confirmed 18 days ago".
 * Past 3 days it now reads not confirmed since then; within them it is green as before.
 *
 *   node --test engine/musestatus.stale-8173.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
process.env.TZ = 'America/Chicago';
const muse = require('./musestatus');
const { accountLine } = require('./accountline');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 10, 6, 23, 0).getTime();

test('#8173: THE CARD\'S CASE: last seen working 18 days ago is not confirmed since then, never green', () => {
  const c = muse.connectionFor({ at: NOW - 18 * DAY, from: 'turn' }, NOW);
  assert.equal(c.badge, 'signed_in_unverified');
  assert.equal(c.state, 'connected', 'still signed in by its record: Kosmos does not know it died');
  assert.equal(c.notConfirmedSince, NOW - 18 * DAY);
  assert.equal(c.observedAgeMs, undefined, 'no age, so the page cannot draw "confirmed 18 days ago"');
});

test('#8173: CONTROL: seen working an hour ago is green with its age, as before', () => {
  const c = muse.connectionFor({ at: NOW - 60 * 60 * 1000, from: 'sign' }, NOW);
  assert.deepEqual(c, { state: 'connected', checkedLive: false, badge: 'working', observedFrom: 'sign', observedAgeMs: 60 * 60 * 1000 });
});

test('#8173: the line is three days, both sides; never seen is amber with no date, as before', () => {
  assert.equal(muse.connectionFor({ at: NOW - 3 * DAY + 60000, from: 'turn' }, NOW).badge, 'working');
  assert.equal(muse.connectionFor({ at: NOW - 3 * DAY - 60000, from: 'turn' }, NOW).badge, 'signed_in_unverified');
  assert.equal(muse.SEEN_FRESH_MS, 3 * DAY);
  assert.deepEqual(muse.connectionFor(null, NOW), { state: 'connected', checkedLive: false, badge: 'signed_in_unverified' });
  assert.deepEqual(muse.connectionFor({ at: NaN, from: 'turn' }, NOW), { state: 'connected', checkedLive: false, badge: 'signed_in_unverified' });
  // A record dated ahead of the clock (clock stepped back) counts as just seen, never as weeks stale.
  assert.equal(muse.connectionFor({ at: NOW + 60000, from: 'turn' }, NOW).badge, 'working');
});

test('#8173: the server builds the Muse row through connectionFor, not its own copy', () => {
  const src = fs.readFileSync(nodePath.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /museSub = row\(muse\.connectionFor\(muse\.lastSeenWorking\(\)\)\);/);
  assert.doesNotMatch(src, /badge: 'working', observedFrom: seen\.from, observedAgeMs/, 'the old always-green copy is back');
});

test('#8173: kosmos accounts says since when for Muse, and tells it to sign in again (it has the button)', () => {
  const at = new Date(2026, 9, 19, 12).getTime();
  const line = accountLine({ provider: 'meta', providerName: 'Meta', authMode: 'muse', email: null,
    connection: { state: 'connected', badge: 'signed_in_unverified', notConfirmedSince: at } });
  assert.equal(line, 'Meta: its Meta account sign-in: not confirmed since Oct 19, 2026; if its agents stop at a sign-in screen, the person signs in again in Settings > AI Models');
  // CONTROL: a Grok row with no email still says to add it again (it has no Sign in again).
  const grok = accountLine({ provider: 'xai', providerName: 'Grok', authMode: 'subscription', email: null,
    connection: { state: 'connected', badge: 'signed_in_unverified', notConfirmedSince: at } });
  assert.match(grok, /adds the Grok account again/);
});

test('#8173: the page draws the stale Muse pill in amber before the plain unconfirmed one', () => {
  const page = fs.readFileSync(nodePath.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const stale = page.indexOf("} else if (c.badge === 'signed_in_unverified' && Number.isFinite(c.notConfirmedSince)) {");
  assert.ok(stale > 0, 'the stale Muse branch is gone');
  assert.ok(stale < page.indexOf("Muse Code\\'s own record says it is signed in to Meta"), 'the plain amber branch would win');
  const pill = page.indexOf("Not confirmed since ' + esc(since)", stale);
  assert.ok(pill > stale && pill < page.indexOf("Muse Code\\'s own record says it is signed in to Meta"), 'the stale branch draws no "Not confirmed since" pill');
});
