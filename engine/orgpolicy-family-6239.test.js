'use strict';

/**
 * kosmos#6239 (first Kosmos+Kids slice): the two policy keys this board enforces, as engine/orgpolicy.js reads them.
 * outside_contact stops contact only for { enabled: false }; quiet_hours is a window in local time in a named zone,
 * belonging to the day it starts on, and with school_nights only windows starting Sunday to Thursday count. A bundle
 * whose values are not the coordinator's exact shapes is refused whole; a well-formed zone this runtime cannot read
 * is not (it keeps quiet hours all day: familyquiet-6239).
 *
 *   node --test engine/orgpolicy-family-6239.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOTS = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); ROOTS.push(d); return d; };
process.env.AGENT_WORKFORCE_DATA = tmp('aw-orgfam-data-');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = tmp('aw-orgfam-tunnel-');
process.env.HOME = tmp('aw-orgfam-home-');
test.after(() => { for (const d of ROOTS) fs.rmSync(d, { recursive: true, force: true }); });

const orgpolicy = require('./orgpolicy');

const NOW = 1_800_000_000;
const coordinator = crypto.generateKeyPairSync('ed25519');
const PINNED = coordinator.publicKey.export({ format: 'jwk' }).x;
function sign(payload) {
  const body = 'KST1.' + Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + crypto.sign(null, Buffer.from(body, 'ascii'), coordinator.privateKey).toString('base64url');
}
let version = 0;
function apply(policy) {
  version += 1;
  fs.writeFileSync(orgpolicy.BUNDLE(), sign({ typ: 'org_policy', v: 1, org: 'org-1', version, iat: NOW - 10, exp: NOW + 86400, policy }));
  return orgpolicy.refresh({ now: NOW, pinned: PINNED });
}

const QH = { tz: 'UTC', school_nights: true, from: '21:00', to: '07:00' };
// 2026-10-18 is a Sunday.
const at = (day, hhmm) => Date.UTC(2026, 9, 18 + day, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3)));
const SUN = 0, MON = 1, THU = 4, FRI = 5, SAT = 6;

test('outside_contact: only enabled false stops contact, with a sentence that names no company', () => {
  const off = orgpolicy.contactAllows({ outside_contact: { enabled: false } });
  assert.equal(off.ok, false);
  assert.match(off.because, /keeps agents out of the Kosmos\+ community and out of projects shared with other computers/);
  assert.doesNotMatch(off.because, /company/i);
  for (const p of [null, {}, { outside_contact: { enabled: true } }, { outside_contact: null }]) {
    assert.deepEqual(orgpolicy.contactAllows(p), { ok: true }, JSON.stringify(p));
  }
});

test('quiet hours across midnight belong to the night they start on; school nights are Sunday to Thursday', () => {
  const p = { quiet_hours: QH };
  const cases = [
    [at(SUN, '22:00'), true, 'Sunday night'],
    [at(MON, '06:59'), true, 'Monday morning is Sunday night'],
    [at(MON, '07:00'), false, 'the end is not quiet'],
    [at(MON, '20:59'), false, 'before the start'],
    [at(MON, '21:00'), true, 'the start is quiet'],
    [at(THU, '23:00'), true, 'Thursday night'],
    [at(FRI, '06:00'), true, 'Friday morning is Thursday night'],
    [at(FRI, '22:00'), false, 'Friday night is free'],
    [at(SAT, '06:00'), false, 'Saturday morning is Friday night'],
    [at(SAT, '22:00'), false, 'Saturday night is free'],
    [at(SUN + 7, '06:00'), false, 'Sunday morning is Saturday night'],
  ];
  for (const [ms, quiet, what] of cases) assert.equal(orgpolicy.quietAt(p, ms).quiet, quiet, what);
  const every = { quiet_hours: { ...QH, school_nights: false } };
  assert.equal(orgpolicy.quietAt(every, at(FRI, '22:00')).quiet, true, 'every night includes Friday');
  assert.equal(orgpolicy.quietAt(every, at(SAT, '06:00')).quiet, true, 'and Saturday morning');
});

test('a window within one day, and the zone decides which local time it is', () => {
  const day = { quiet_hours: { tz: 'UTC', school_nights: false, from: '13:00', to: '15:00' } };
  assert.equal(orgpolicy.quietAt(day, at(MON, '14:00')).quiet, true);
  assert.equal(orgpolicy.quietAt(day, at(MON, '15:00')).quiet, false);
  assert.equal(orgpolicy.quietAt(day, at(MON, '12:59')).quiet, false);
  // 19:00 UTC on 2026-10-19 is 14:00 in Chicago (CDT): quiet there, not in UTC.
  const chicago = { quiet_hours: { tz: 'America/Chicago', school_nights: false, from: '13:00', to: '15:00' } };
  assert.equal(orgpolicy.quietAt(chicago, at(MON, '19:00')).quiet, true, 'Chicago local time');
  assert.equal(orgpolicy.quietAt(day, at(MON, '19:00')).quiet, false, 'CONTROL: the same instant in UTC');
});

test('quietAllows says until when, in which zone, and names no company; no policy or no key allows', () => {
  const r = orgpolicy.quietAllows({ quiet_hours: QH }, at(SUN, '22:00'));
  assert.equal(r.ok, false);
  assert.equal(r.because, 'it is quiet hours until 07:00 (UTC time), under the policy set for this Kosmos');
  assert.deepEqual(orgpolicy.quietAllows({ quiet_hours: QH }, at(SUN, '12:00')), { ok: true }, 'CONTROL: outside the window');
  assert.deepEqual(orgpolicy.quietAllows(null, at(SUN, '22:00')), { ok: true });
  assert.deepEqual(orgpolicy.quietAllows({}, at(SUN, '22:00')), { ok: true });
});

test('a bundle with either key in another shape is refused whole; a well-formed unknown zone is not', () => {
  assert.equal(apply({ outside_contact: { enabled: false }, quiet_hours: QH }).refused, null, 'CONTROL: the good one applies');
  const bad = [
    { outside_contact: { enable: false } },
    { outside_contact: { enabled: 'no' } },
    { outside_contact: { enabled: false, extra: 1 } },
    { outside_contact: false },
    { quiet_hours: { ...QH, tz: '/etc/localtime' } },
    { quiet_hours: { ...QH, from: '07:00' } },
    { quiet_hours: { ...QH, from: '9:00' } },
    { quiet_hours: { ...QH, to: '24:00' } },
    { quiet_hours: { ...QH, school_nights: 1 } },
    { quiet_hours: { ...QH, days: [1] } },
    { quiet_hours: '21:00-07:00' },
  ];
  for (const policy of bad) {
    assert.match(apply(policy).refused || '', /not one this Kosmos understands/, JSON.stringify(policy));
    assert.deepEqual(orgpolicy.current(), { outside_contact: { enabled: false }, quiet_hours: QH }, 'the last good one stays');
  }
  assert.equal(apply({ quiet_hours: { ...QH, tz: 'America/Argentina/Buenos_Aires' } }).refused, null, 'CONTROL: a deep zone name');
  // Challenge round 1: a well-formed zone this runtime cannot read is not refused (it would take outside_contact down
  // with it); quietAt keeps quiet hours all day for it instead (familyquiet-6239).
  assert.equal(apply({ outside_contact: { enabled: false }, quiet_hours: { ...QH, tz: 'Mars/Olympus_Mons' } }).refused, null, 'an unknown zone refused the bundle');
});
