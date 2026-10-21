'use strict';
/**
 * kosmos#6859: a computer joined to a family keeps its agents out of the Kosmos+ community and out of shared rooms
 * whether or not a parent saved a policy. Only `outside_contact: { enabled: true }` lets a family's agents out; a
 * company (and a computer joined to nobody) with no policy is allowed, as before.
 *
 *   node --test engine/kidcontact-6859.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-kidcontact-6859-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = path.join(SANDBOX, 'tunnel');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_TUNNEL_STATE, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./store');
const orgenroll = require('./orgenroll');
const orgpolicy = require('./orgpolicy');
const communitysend = require('./communitysend');
const fedseats = require('./fedseats');

test.after(() => { fedseats.stopAll(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const coordinator = crypto.generateKeyPairSync('ed25519');
const PINNED = coordinator.publicKey.export({ format: 'jwk' }).x;
let version = 0;
/* Push `policy` as the coordinator signs it, and apply it as the board does. */
function apply(policy) {
  const now = Math.floor(Date.now() / 1000);
  version += 1;
  const body = 'KST1.' + Buffer.from(JSON.stringify({ typ: 'org_policy', v: 1, org: 'org-1', version, iat: now - 10, exp: now + 86400, policy })).toString('base64url');
  fs.writeFileSync(orgpolicy.BUNDLE(), body + '.' + crypto.sign(null, Buffer.from(body, 'ascii'), coordinator.privateKey).toString('base64url'));
  const r = orgpolicy.refresh({ now, pinned: PINNED });
  assert.equal(r.refused, null, 'the test policy did not apply: ' + r.refused);
}
/* This board joined to an org of `kind` ('family' or 'company'), or to nothing (null). No policy is in force. */
function joined(kind) {
  orgpolicy.clear();
  fs.rmSync(orgpolicy.APPLIED(), { force: true });
  const file = path.join(store.ROOT, orgenroll.ENROLLMENT_FILE);
  if (kind === null) { fs.rmSync(file, { force: true }); return; }
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ org: { id: 'org-1', name: 'The Smiths', slug: 'smiths', kind }, world: 'a'.repeat(32) }) + '\n');
  assert.equal(orgenroll.kindHere(), kind, 'CONTROL: the board reads the kind this test wrote');
}
/* What each outside-contact reader says: the policy's verdict, the community's state, and the shared rooms'. */
function readers() {
  return { ok: orgpolicy.contactAllows().ok, community: communitysend.switchState(), rooms: fedseats.contactStopped() ? 'stopped' : 'open' };
}
const OUT = { ok: false, community: 'policy', rooms: 'stopped' };
const IN = { ok: true, community: 'on', rooms: 'open' };

test('#6859: a family with no policy keeps agents out; a company with no policy does not (the control)', () => {
  communitysend.setSwitch(() => ({ on: true, ok: true }));
  try {
    joined('company');
    assert.deepEqual(readers(), IN, 'CONTROL: a company with no policy lets agents out');
    joined(null);
    assert.deepEqual(readers(), IN, 'CONTROL: a computer joined to nobody lets agents out');
    joined('family');
    assert.deepEqual(readers(), OUT, 'a family that never saved a policy let its agents out');
    assert.match(orgpolicy.contactAllows().because, /keeps agents out of the Kosmos\+ community/);
  } finally { communitysend.setSwitch(null); joined(null); }
});

test('#6859: in a family only outside_contact enabled true lets agents out; a policy without the key keeps them in', () => {
  communitysend.setSwitch(() => ({ on: true, ok: true }));
  try {
    joined('family');
    apply({ quiet_hours: { tz: 'UTC', school_nights: true, from: '21:00', to: '07:00' } });
    assert.equal(readers().ok, false, 'a family policy that says nothing about outside contact let agents out');
    apply({ outside_contact: { enabled: false } });
    assert.deepEqual(readers(), OUT);
    apply({ outside_contact: { enabled: true } });
    assert.deepEqual(readers(), IN, 'a parent who allowed outside contact was not honoured');
    joined('company');
    apply({ quiet_hours: { tz: 'UTC', school_nights: true, from: '21:00', to: '07:00' } });
    assert.equal(readers().ok, true, 'CONTROL: a company policy without the key still lets agents out');
  } finally { communitysend.setSwitch(null); joined(null); }
});

test('#6859: an explicit policy and kind are read as given (orgpolicy.contactAllows)', () => {
  assert.equal(orgpolicy.contactAllows(null, 'family').ok, false);
  assert.equal(orgpolicy.contactAllows({}, 'family').ok, false);
  assert.equal(orgpolicy.contactAllows({ outside_contact: null }, 'family').ok, false);
  assert.equal(orgpolicy.contactAllows({ outside_contact: { enabled: true } }, 'family').ok, true);
  for (const kind of ['company', null]) {
    assert.equal(orgpolicy.contactAllows(null, kind).ok, true, String(kind));
    assert.equal(orgpolicy.contactAllows({ outside_contact: { enabled: false } }, kind).ok, false, String(kind));
  }
});
