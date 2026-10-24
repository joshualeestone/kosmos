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
const cb = require('./communityblock');

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
const JOIN_UNKNOWN = 'org-join-unknown.json';   // orgenroll's marker for a join whose outcome is not known yet
/* This board joined to an org of `kind` ('family' or 'company'), or to nothing (null). No policy is in force. */
function joined(kind) {
  orgpolicy.clear();
  fs.rmSync(orgpolicy.APPLIED(), { force: true });
  const file = path.join(store.ROOT, orgenroll.ENROLLMENT_FILE);
  fs.rmSync(path.join(store.ROOT, JOIN_UNKNOWN), { force: true });
  fs.rmSync(path.join(store.ROOT, orgenroll.LEAVE_PENDING_FILE), { force: true });
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
    // kosmos#6870: the family default's own words; no policy said off here.
    assert.match(orgpolicy.contactAllows().because, /on a family's Kosmos, agents stay out of projects shared with other computers/);
    assert.doesNotMatch(orgpolicy.contactAllows().because, /policy set for this Kosmos/);
    assert.equal(cb.policyStopped(), true, "the agent's community block was not told it does not take part");
    joined('company');
    assert.equal(cb.policyStopped(), false, "CONTROL: a company's agent block is not stopped");
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
    // kosmos#6862: the parent's allow opens shared projects; the community stays closed on a family's Kosmos.
    assert.deepEqual(readers(), { ok: true, community: 'policy', rooms: 'open' }, 'a parent who allowed outside contact was not honoured for shared projects');
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

test('#6859: an enrollment that cannot be read, or a family join not yet settled, does not let agents out', () => {
  communitysend.setSwitch(() => ({ on: true, ok: true }));
  const file = path.join(store.ROOT, orgenroll.ENROLLMENT_FILE);
  try {
    joined('family');
    fs.writeFileSync(file, '{ not json');
    assert.throws(() => orgpolicy.contactAllows(), /enrollment file that cannot be read/, 'a damaged enrollment read as joined to nobody');
    assert.equal(communitysend.switchState(), 'policy_unreadable');
    assert.equal(fedseats.contactStopped(), true);
    // A marker beside a damaged record does not stand in for it (a damaged family record plus a company join).
    fs.writeFileSync(path.join(store.ROOT, JOIN_UNKNOWN), JSON.stringify({ at: new Date().toISOString(), orgKind: 'company' }) + '\n');
    assert.throws(() => orgpolicy.contactAllows(), /enrollment file that cannot be read/, 'a marker hid a damaged record');
    joined(null);
    fs.writeFileSync(path.join(store.ROOT, JOIN_UNKNOWN), JSON.stringify({ at: new Date().toISOString(), orgKind: 'family' }) + '\n');
    assert.equal(orgenroll.kindStrict(), 'family', 'CONTROL: the pending join is read');
    assert.deepEqual(readers(), OUT, 'a family join not yet settled let agents out');
    fs.writeFileSync(path.join(store.ROOT, JOIN_UNKNOWN), JSON.stringify({ at: new Date().toISOString(), orgKind: 'company' }) + '\n');
    assert.deepEqual(readers(), IN, 'CONTROL: a company join not yet settled lets agents out');
    // A marker from before kinds names none: read as a company's, as setJoinUnknown records an unknown kind.
    fs.writeFileSync(path.join(store.ROOT, JOIN_UNKNOWN), JSON.stringify({ at: new Date().toISOString() }) + '\n');
    assert.equal(orgenroll.kindStrict(), 'company');
    assert.deepEqual(readers(), IN, 'a kindless marker from an older build closed a company board');
    joined(null);
    // A family leave the coordinator has not confirmed yet keeps agents out until it is.
    fs.writeFileSync(path.join(store.ROOT, orgenroll.LEAVE_PENDING_FILE), JSON.stringify({ at: new Date().toISOString(), rec: { org: { id: 'org-1', kind: 'family' } } }) + '\n');
    assert.equal(orgenroll.kindStrict(), 'family', 'CONTROL: the pending leave is read');
    assert.deepEqual(readers(), OUT, 'a family leave not yet confirmed let agents out');
  } finally { communitysend.setSwitch(null); joined(null); }
});

test('#6859: the kind comes from the files themselves: a torn marker throws, a record with a bad identity keeps its kind', () => {
  communitysend.setSwitch(() => ({ on: true, ok: true }));
  const rec = path.join(store.ROOT, orgenroll.ENROLLMENT_FILE);
  try {
    joined(null);
    fs.writeFileSync(path.join(store.ROOT, orgenroll.LEAVE_PENDING_FILE), '{ torn');
    assert.throws(() => orgpolicy.contactAllows(), /enrollment file that cannot be read/, 'a torn leave marker read as a company');
    joined(null);
    fs.writeFileSync(path.join(store.ROOT, JOIN_UNKNOWN), '{ torn');
    assert.throws(() => orgpolicy.contactAllows(), /enrollment file that cannot be read/, 'a torn join marker read as a company');
    // A record whose identity readEnrollment rejects (world null) still says whose it is.
    joined(null);
    fs.writeFileSync(rec, JSON.stringify({ org: { id: 'org-1', kind: 'company' }, world: null }) + '\n');
    assert.equal(orgenroll.readEnrollment(), null, 'CONTROL: readEnrollment rejects this record');
    assert.deepEqual(readers(), IN, 'a company record with a bad identity closed the board for good');
    fs.writeFileSync(rec, JSON.stringify({ org: { id: 'org-1', kind: 'family' }, world: null }) + '\n');
    assert.deepEqual(readers(), OUT, 'a family record with a bad identity let agents out');
    // A move: a company leave pending beside a family join keeps agents out.
    joined(null);
    fs.writeFileSync(path.join(store.ROOT, orgenroll.LEAVE_PENDING_FILE), JSON.stringify({ rec: { org: { id: 'org-2', kind: 'company' } } }) + '\n');
    fs.writeFileSync(path.join(store.ROOT, JOIN_UNKNOWN), JSON.stringify({ orgKind: 'family' }) + '\n');
    assert.equal(orgenroll.kindStrict(), 'family', 'a move into a family read as a company');
    // The same move with the old company record still there, as it is until the join settles.
    fs.writeFileSync(rec, JSON.stringify({ org: { id: 'org-2', kind: 'company' }, world: 'a'.repeat(32) }) + '\n');
    fs.rmSync(path.join(store.ROOT, orgenroll.LEAVE_PENDING_FILE), { force: true });
    assert.equal(orgenroll.kindStrict(), 'family', 'a company record hid a family join not yet settled');
    assert.deepEqual(readers(), OUT);
    // A record that is JSON but not an object is unreadable, not a company's.
    joined(null);
    for (const body of ['null', '"x"', '[]']) {
      fs.writeFileSync(rec, body + '\n');
      assert.throws(() => orgpolicy.contactAllows(), /enrollment file that cannot be read/, 'a record of ' + body + ' read as a company');
    }
  } finally { communitysend.setSwitch(null); joined(null); }
});

test('#6859: a policy that says on or off decides without reading the enrollment', () => {
  const rec = path.join(store.ROOT, orgenroll.ENROLLMENT_FILE);
  try {
    joined(null);
    fs.mkdirSync(store.ROOT, { recursive: true });
    fs.writeFileSync(rec, '{ torn');
    assert.throws(() => orgpolicy.contactAllows({}), /enrollment file that cannot be read/, 'CONTROL: the kind is read when the policy does not settle it');
    assert.equal(orgpolicy.contactAllows({ outside_contact: { enabled: false } }).ok, false);
    assert.equal(orgpolicy.contactAllows({ outside_contact: { enabled: true } }).ok, true);
  } finally { joined(null); }
});

test('#6859: an answer that names no kind leaves a family\'s record a family\'s (an org\'s kind does not change)', async () => {
  const world = 'b'.repeat(32);
  // The coordinator's explicit word still wins (a family record answered 'company' becomes a company's).
  for (const [had, answered, want] of [['family', undefined, 'family'], ['company', undefined, 'company'], ['family', 'family', 'family'], ['family', 'company', 'company']]) {
    const root = fs.mkdtempSync(path.join(SANDBOX, 'refresh-'));
    fs.writeFileSync(path.join(root, orgenroll.WORLD_ID_FILE), world + '\n');
    fs.writeFileSync(path.join(root, orgenroll.ENROLLMENT_FILE), JSON.stringify({ org: { id: 'org-1', name: 'The Smiths', slug: 'smiths', kind: had }, role: 'member', world, enrolledAt: new Date().toISOString() }) + '\n');
    const org = { id: 'org-1', name: 'The Smiths', slug: 'smiths' };
    if (answered) org.kind = answered;
    const remote = { macRequest: async (method, route) => (route === orgenroll.ROUTES.status
      ? { ok: true, data: { member: true, enrolled: { world, thisComputer: true }, org, role: 'member' } }
      : { ok: false, because: 'not scripted' }) };
    await orgenroll.refresh({ root, remote });
    const after = orgenroll.readEnrollment({ root });
    assert.ok(after, 'CONTROL: the refresh kept a record (' + had + ')');
    assert.equal(after.org.kind, want, `a ${had} record answered with kind ${answered} became ${after.org.kind}`);
    assert.equal(orgenroll.kindStrict({ root }), want);
  }
});

test('#6859: a family join settled from an answer that names no kind is recorded as a family\'s', async () => {
  const world = 'c'.repeat(32);
  for (const [joinKind, want] of [['family', 'family'], ['company', 'company']]) {
    const root = fs.mkdtempSync(path.join(SANDBOX, 'settle-'));
    fs.writeFileSync(path.join(root, orgenroll.WORLD_ID_FILE), world + '\n');
    fs.writeFileSync(path.join(root, JOIN_UNKNOWN), JSON.stringify({ at: new Date().toISOString(), orgId: 'org-1', orgKind: joinKind }) + '\n');
    const remote = { macRequest: async (method, route) => (route === orgenroll.ROUTES.status
      ? { ok: true, data: { member: true, enrolled: { world, thisComputer: true }, org: { id: 'org-1', name: 'The Smiths', slug: 'smiths' }, role: 'member' } }
      : { ok: false, because: 'not scripted' }) };
    await orgenroll.refresh({ root, remote });
    const after = orgenroll.readEnrollment({ root });
    assert.ok(after, 'CONTROL: the join settled into a record (' + joinKind + ')');
    assert.equal(after.org.kind, want, `a ${joinKind} join settled as ${after.org.kind}`);
    assert.equal(fs.existsSync(path.join(root, JOIN_UNKNOWN)), false, 'CONTROL: the marker is gone once the record is written');
  }
});

test('#6859: a torn join marker beside a record is cleared by the next refresh, so it cannot close a board for good', async () => {
  const world = 'd'.repeat(32);
  const root = fs.mkdtempSync(path.join(SANDBOX, 'torn-'));
  fs.writeFileSync(path.join(root, orgenroll.WORLD_ID_FILE), world + '\n');
  fs.writeFileSync(path.join(root, orgenroll.ENROLLMENT_FILE), JSON.stringify({ org: { id: 'org-1', name: 'Acme', slug: 'acme', kind: 'company' }, role: 'member', world, enrolledAt: new Date().toISOString() }) + '\n');
  fs.writeFileSync(path.join(root, JOIN_UNKNOWN), '{ torn');
  assert.throws(() => orgenroll.kindStrict({ root }), /enrollment file that cannot be read/, 'CONTROL: the torn marker is read as damage');
  const remote = { macRequest: async (method, route) => (route === orgenroll.ROUTES.status
    ? { ok: true, data: { member: true, enrolled: { world, thisComputer: true }, org: { id: 'org-1', name: 'Acme', slug: 'acme', kind: 'company' }, role: 'member' } }
    : { ok: false, because: 'not scripted' }) };
  await orgenroll.refresh({ root, remote });
  assert.equal(fs.existsSync(path.join(root, JOIN_UNKNOWN)), false, 'the torn marker beside a record was kept');
  assert.equal(orgenroll.kindStrict({ root }), 'company');
});

test('#6859: enroll from an answer that names no kind keeps a family record of the same org a family\'s, and only that', async () => {
  const HASH = 'cd'.repeat(32);
  const WORDS = { reports: ['which agents ran on this computer'], backsUp: [], readers: ['the person who uses this computer'], never: ['keys and passwords'] };
  // [the org the answer names, the kind the caller passes, the kind recorded]
  for (const [to, orgKind, want] of [['org-1', 'company', 'family'], ['org-2', 'company', 'company'], ['org-2', undefined, 'company']]) {
    const root = fs.mkdtempSync(path.join(SANDBOX, 'enroll-'));
    const world = 'e'.repeat(32);
    fs.writeFileSync(path.join(root, orgenroll.WORLD_ID_FILE), world + '\n');
    fs.writeFileSync(path.join(root, orgenroll.ENROLLMENT_FILE), JSON.stringify({ org: { id: 'org-1', name: 'The Smiths', slug: 'smiths', kind: 'family' }, role: 'admin', world, enrolledAt: new Date().toISOString() }) + '\n');
    const org = { id: to, name: 'Named', slug: 'named' };
    const remote = { macRequest: async (method, route, body) => {
      if (route === orgenroll.ROUTES.enroll) return { ok: true, data: { ok: true, org, role: 'admin', enrolled: { computer: 'c', world: (body && body.world) || world, thisComputer: true } } };
      if (route === orgenroll.ROUTES.status) return { ok: true, data: { member: true, org, role: 'admin', enrolled: { computer: 'c', world, thisComputer: true } } };
      return { ok: false, because: 'not scripted' };
    } };
    const en = await orgenroll.enroll('RIVE-JOIN-1234', true, { root, remote, consentHash: HASH, consent: WORDS, orgId: to, orgKind });
    assert.equal(en.ok, true, 'CONTROL: the join went through: ' + JSON.stringify(en));
    const after = orgenroll.readEnrollment({ root });
    assert.equal(after.org.id, to, 'CONTROL: the record is the answered org');
    assert.equal(after.org.kind, want, `joining ${to} (caller said ${orgKind}) from a family record recorded ${after.org.kind}`);
  }
});

test('#6859: a torn join marker with no record is cleared by the next refresh, so it cannot close a board for good', async () => {
  const root = fs.mkdtempSync(path.join(SANDBOX, 'torn2-'));
  fs.writeFileSync(path.join(root, orgenroll.WORLD_ID_FILE), 'f'.repeat(32) + '\n');
  fs.writeFileSync(path.join(root, JOIN_UNKNOWN), '{ torn');
  assert.throws(() => orgenroll.kindStrict({ root }), /enrollment file that cannot be read/, 'CONTROL: the torn marker is read as damage');
  const remote = { macRequest: async () => ({ ok: true, data: { member: false } }) };
  await orgenroll.refresh({ root, remote });
  assert.equal(fs.existsSync(path.join(root, JOIN_UNKNOWN)), false, 'the torn marker with no record was kept');
  assert.equal(orgenroll.kindStrict({ root }), null);
});
