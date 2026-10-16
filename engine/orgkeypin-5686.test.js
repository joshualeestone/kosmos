'use strict';
/**
 * kosmos#5686 (b1-mac): engine/orgkeypin.js decides whether this computer may wrap its member key to the company key
 * Kosmos+ named: dormant until a verification key ships; with one, escrowd's signature is required and the first
 * verified (org, key) is pinned until the enrollment ends. Also through backupmemberkey.js (nothing is wrapped or sent
 * to a refused key) and orgenroll.js (the end of an enrollment clears the pin).
 *
 *   node --test engine/orgkeypin-5686.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-orgkeypin-5686-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const store = require('./store');
const backupkeys = require('./backupkeys');
const orgkeysig = require('./orgkeysig');
const pin = require('./orgkeypin');
const mk = require('./backupmemberkey');

// escrowd's org-key signing key, as a fresh Ed25519 pair (the shipped key's stand-in).
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const VK = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
const sign = (org, epoch, pub) => crypto.sign(null, orgkeysig.encode(org, epoch, pub), privateKey).toString('base64url');
const ARMED = { verifyingKey: VK };

const ROOT = () => store.ROOT;
const reset = () => fs.rmSync(path.join(store.ROOT, 'backupkeys'), { recursive: true, force: true });
const answer = (org, pub, signature) => ({ org, member: 'acct1', epoch: 1, public_key: pub.toString('base64url'), ...(signature === undefined ? {} : { signature }) });
const company = (org, pub) => ({ org, member: 'acct1', orgPublic: pub });

test.beforeEach(reset);
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

test('dormant until a verification key ships: answers ok, pins nothing, with or without a signature', () => {
  assert.equal(pin.VERIFYING_KEY, null, 'nothing has shipped yet');
  const k = Buffer.alloc(32, 3);
  assert.deepEqual(pin.check(ROOT(), answer('o1', k), company('o1', k)), { ok: true });
  assert.deepEqual(pin.check(ROOT(), answer('o1', k, 'garbage'), company('o1', k)), { ok: true });
  assert.equal(pin.readPin(ROOT()), null, 'no pin written');
});

test('armed: a missing, malformed or wrong signature is a refusal, and nothing is pinned', () => {
  const k = Buffer.alloc(32, 3);
  for (const [why, sig] of [['missing', undefined], ['not base64url', 'a+b/'], ['another org', sign('o2', 1, k)], ['another epoch', sign('o1', 2, k)], ['another key', sign('o1', 1, Buffer.alloc(32, 4))]]) {
    const r = pin.check(ROOT(), answer('o1', k, sig), company('o1', k), ARMED);
    assert.equal(r.ok, false, why);
    assert.match(r.because, /signature/, why);
  }
  assert.equal(pin.readPin(ROOT()), null, 'a refusal pins nothing');
});

test('armed: the first verified key is pinned; the same key passes; another key or another org is refused, signed or not', () => {
  const k = Buffer.alloc(32, 3), other = Buffer.alloc(32, 7);
  assert.deepEqual(pin.check(ROOT(), answer('o1', k, sign('o1', 1, k)), company('o1', k), ARMED), { ok: true, pinned: true });
  assert.deepEqual(pin.readPin(ROOT()), { org: 'o1', public: k.toString('hex') });
  assert.deepEqual(pin.check(ROOT(), answer('o1', k, sign('o1', 1, k)), company('o1', k), ARMED), { ok: true });
  const swapped = pin.check(ROOT(), answer('o1', other, sign('o1', 1, other)), company('o1', other), ARMED);
  assert.equal(swapped.ok, false);
  assert.match(swapped.because, /different company backup key/);
  assert.equal(pin.check(ROOT(), answer('o2', other, sign('o2', 1, other)), company('o2', other), ARMED).ok, false, 'another org, validly signed');
  assert.deepEqual(pin.readPin(ROOT()), { org: 'o1', public: k.toString('hex') }, 'the pin is unchanged');
});

test('armed: an unreadable pin refuses and is left as it is; clear() removes the pin, and the next verified key pins', () => {
  const k = Buffer.alloc(32, 3), other = Buffer.alloc(32, 7);
  fs.mkdirSync(path.join(ROOT(), 'backupkeys'), { recursive: true });
  const file = path.join(ROOT(), 'backupkeys', pin.PIN_FILE);
  fs.writeFileSync(file, 'not json');
  const r = pin.check(ROOT(), answer('o1', k, sign('o1', 1, k)), company('o1', k), ARMED);
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'not json', 'left as it is');
  pin.clear(ROOT());
  assert.equal(fs.existsSync(file), false);
  assert.equal(pin.check(ROOT(), answer('o1', other, sign('o1', 1, other)), company('o1', other), ARMED).pinned, true);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('through ensureMemberKey: a refused company key gets no member key kept, wrapped or sent', async () => {
  const org = backupkeys.newMemberKey();
  const calls = [];
  const macRequest = async (method, route) => {
    calls.push(route);
    if (route === mk.BACKUP_KEY_ROUTE) return { ok: true, data: answer('org1', org.pk) };   // unsigned
    return { ok: false, because: 'not reached' };
  };
  const r = await mk.ensureMemberKey({ macRequest, orgKeyPin: ARMED });
  assert.equal(r.ok, false);
  assert.equal(r.orgKeyRefused, true);
  assert.deepEqual(calls, [mk.BACKUP_KEY_ROUTE], 'no member-key request');
  const dir = path.join(store.ROOT, 'backupkeys');
  assert.deepEqual(fs.existsSync(dir) ? fs.readdirSync(dir) : [], [], 'no key file kept');
});

test('through ensureMemberKey: dormant (no verifyingKey) still registers exactly as before', async () => {
  const org = backupkeys.newMemberKey();
  const calls = [];
  const macRequest = async (method, route, body) => {
    calls.push(route);
    if (route === mk.BACKUP_KEY_ROUTE) return { ok: true, data: answer('org1', org.pk) };
    return { ok: true, data: { epoch: body.epoch, member_public: body.member_public } };
  };
  const r = await mk.ensureMemberKey({ macRequest });
  assert.equal(r.ok, true);
  assert.deepEqual(calls, [mk.BACKUP_KEY_ROUTE, mk.MEMBER_KEY_ROUTE]);
});

test('a Join keeps the same company\'s pin and clears another company\'s or an unreadable one', () => {
  const k = Buffer.alloc(32, 3);
  pin.check(ROOT(), answer('o1', k, sign('o1', 1, k)), company('o1', k), ARMED);
  pin.clearUnlessFor(ROOT(), 'o1');
  assert.deepEqual(pin.readPin(ROOT()), { org: 'o1', public: k.toString('hex') }, 'same company: kept');
  pin.clearUnlessFor(ROOT(), 'o2');
  assert.equal(pin.readPin(ROOT()), null, 'another company: cleared');
  fs.writeFileSync(path.join(ROOT(), 'backupkeys', pin.PIN_FILE), 'not json');
  pin.clearUnlessFor(ROOT(), 'o1');
  assert.equal(pin.readPin(ROOT()), null, 'unreadable: cleared at a Join');
  pin.clearUnlessFor(ROOT(), 'o1');   // no pin: nothing to do, no throw
});

/* Through orgenroll's real flows, with a fake coordinator (as orgenroll-5531.test.js). */
const org = require('./orgenroll');
const ORG = { id: 'org_1', name: 'Acme', slug: 'acme' };
const CONSENT = { reports: ['agent names'], backsUp: ['agent folders'], readers: ['you'], never: ['keys and passwords'] };
function fakeRemote(state) {
  return {
    macRequest: async (method, route, body) => {
      if (route === org.ROUTES.redeem) return { ok: true, data: { org: ORG, role: 'member', consent: CONSENT } };
      if (route === org.ROUTES.enroll) { state.world = body.world; return { ok: true, data: { ok: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } }; }
      if (route === org.ROUTES.status) return { ok: true, data: { member: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: state.world, thisComputer: true } } };
      if (route === org.ROUTES.leave) return state.leave || { ok: true, data: { ok: true } };
      return { ok: false, because: 'unknown route ' + route };
    },
  };
}
function world(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orgkeypin-world-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const pinFor = (root, o) => { const k = Buffer.alloc(32, 3); return pin.check(root, answer(o, k, sign(o, 1, k)), company(o, k), ARMED); };

test('through orgenroll: a confirmed Leave clears the pin', async (t) => {
  const root = world(t), state = {};
  await org.enroll('ACME-JOIN-1234', true, { root, remote: fakeRemote(state) });
  assert.equal(pinFor(root, 'org_1').pinned, true);
  const r = await org.leave({ root, remote: fakeRemote(state) });
  assert.equal(r.ok, true);
  assert.equal(pin.readPin(root), null);
});

test('through orgenroll: a Leave the company refuses (last admin) keeps the pin, as it keeps the enrollment', async (t) => {
  const root = world(t), state = {};
  await org.enroll('ACME-JOIN-1234', true, { root, remote: fakeRemote(state) });
  pinFor(root, 'org_1');
  state.leave = { ok: false, because: '409 {"because":"org_last_admin"}' };
  const r = await org.leave({ root, remote: fakeRemote(state) });
  assert.match(r.because, /last admin/);
  assert.equal(org.isEnrolledHere({ root }), true, 'the enrollment is back');
  assert.equal(pin.readPin(root).org, 'org_1', 'and so is the pin (it never left)');
});

test('through orgenroll: a Join to another company clears a pin; a Join to the pinned company keeps it', async (t) => {
  const other = world(t);
  pinFor(other, 'org_other');
  await org.enroll('ACME-JOIN-1234', true, { root: other, remote: fakeRemote({}) });
  assert.equal(pin.readPin(other), null, 'another company: cleared');
  const same = world(t);
  pinFor(same, 'org_1');
  await org.enroll('ACME-JOIN-1234', true, { root: same, remote: fakeRemote({}) });
  assert.equal(pin.readPin(same).org, 'org_1', 'the same company: kept');
});
