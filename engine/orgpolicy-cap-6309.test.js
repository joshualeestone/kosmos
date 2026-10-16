'use strict';

/**
 * kosmos#6309: a family's monthly usage cap, as engine/orgpolicy.js reads it. usage_cap is exactly
 * { monthly_tokens, warn_pct, tz }: a bundle with any other shape is refused whole and the last good policy stays. The
 * cap counts the calendar month in the cap's own zone; the heads-up is at warn_pct, and at the cap a new message is
 * refused with the policy's own sentence.
 *
 *   node --test engine/orgpolicy-cap-6309.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOTS = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); ROOTS.push(d); return d; };
process.env.AGENT_WORKFORCE_DATA = tmp('aw-orgcap-data-');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = tmp('aw-orgcap-tunnel-');
process.env.HOME = tmp('aw-orgcap-home-');
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

const CAP = { monthly_tokens: 1000, warn_pct: 80, tz: 'UTC' };

test('a cap in its exact shape applies; any other shape refuses the bundle whole and the last good one stays', () => {
  assert.equal(apply({ usage_cap: CAP }).refused, null, 'CONTROL: the good one applies');
  const bad = [
    { ...CAP, monthly_tokens: 0 },
    { ...CAP, monthly_tokens: -5 },
    { ...CAP, monthly_tokens: 10.5 },
    { ...CAP, monthly_tokens: '1000' },
    { ...CAP, monthly_tokens: 1e13 },
    { ...CAP, warn_pct: 0 },
    { ...CAP, warn_pct: 100 },
    { ...CAP, warn_pct: 80.5 },
    { ...CAP, tz: '/etc/localtime' },
    { monthly_tokens: 1000, warn_pct: 80 },
    { ...CAP, dollars: 20 },
    1000,
  ];
  for (const usage_cap of bad) {
    assert.match(apply({ usage_cap }).refused || '', /not one this Kosmos understands/, JSON.stringify(usage_cap));
    assert.deepEqual(orgpolicy.current(), { usage_cap: CAP }, 'the last good one stays');
  }
  assert.equal(apply({ usage_cap: null }).refused, null, 'CONTROL: null means no cap');
});

test('the heads-up is at warn_pct and the refusal at the cap, in the policy\'s own words', () => {
  const p = { usage_cap: CAP };
  assert.deepEqual(orgpolicy.capAt(p, 799), { capped: true, used: 799, cap: 1000, pct: 79, warn: false, over: false, tz: 'UTC' });
  assert.equal(orgpolicy.capAt(p, 800).warn, true, 'the heads-up at 80%');
  assert.equal(orgpolicy.capAt(p, 800).over, false);
  assert.equal(orgpolicy.capAt(p, 999).pct, 99, 'rounded down: it reads 99 until the cap is reached');
  assert.deepEqual(orgpolicy.capAllows(p, 999), { ok: true }, 'CONTROL: one short of the cap still goes');
  const at = orgpolicy.capAllows(p, 1000);
  assert.equal(at.ok, false);
  assert.match(at.because, /this month's usage cap is reached \(1000 of 1000 tokens\)/);
  assert.match(at.because, /under the policy set for this Kosmos; it opens again on the 1st \(UTC time\)/);
  assert.doesNotMatch(at.because, /company|dollar|\$/i);
  for (const none of [null, {}, { usage_cap: null }, { usage_cap: { ...CAP, warn_pct: 100 } }]) {
    assert.deepEqual(orgpolicy.capAt(none, 1e9), { capped: false }, JSON.stringify(none));
    assert.deepEqual(orgpolicy.capAllows(none, 1e9), { ok: true }, JSON.stringify(none));
  }
  for (const odd of [NaN, -3, undefined, Infinity]) assert.equal(orgpolicy.capAt(p, odd).used, 0, String(odd));
});

test('the month starts on the 1st at local midnight in the cap\'s zone, across a daylight-saving change', () => {
  const iso = (ms) => new Date(ms).toISOString();
  // 2026-10-31 22:00 in Chicago (CDT) is still October there, though it is November 1 in UTC.
  assert.equal(iso(orgpolicy.monthStart(Date.UTC(2026, 10, 1, 3), 'America/Chicago')), '2026-10-01T05:00:00.000Z');
  assert.equal(iso(orgpolicy.monthStart(Date.UTC(2026, 10, 1, 6), 'America/Chicago')), '2026-11-01T05:00:00.000Z');
  // Chicago leaves daylight time on 2026-11-01, so December starts at 06:00 UTC, not 05:00.
  assert.equal(iso(orgpolicy.monthStart(Date.UTC(2026, 11, 15), 'America/Chicago')), '2026-12-01T06:00:00.000Z');
  assert.equal(iso(orgpolicy.monthStart(Date.UTC(2026, 9, 16, 12), 'UTC')), '2026-10-01T00:00:00.000Z', 'CONTROL: UTC');
  assert.equal(iso(orgpolicy.monthStart(Date.UTC(2026, 3, 1, 0, 30), 'Europe/London')), '2026-03-31T23:00:00.000Z', 'London in summer time');
  assert.throws(() => orgpolicy.monthStart(Date.UTC(2026, 9, 16), 'Mars/Olympus_Mons'), 'a zone this runtime cannot read throws');
});
