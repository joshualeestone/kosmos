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

/* Review 1 (probed): a breached coordinator renames the org at the hourly refresh, then makes the board re-accept the
   words on its own (a codeless review enroll, no person). The pin must survive, and the other org's genuine key is
   refused. */
test('through orgenroll: the automatic re-accept after a coordinator-renamed org never clears the pin', async (t) => {
  const root = world(t);
  const HASH = 'a'.repeat(64);
  const st = { org: ORG };
  const remote = { macRequest: async (m, route, body) => {
    if (route === org.ROUTES.redeem) return { ok: true, data: { org: st.org, role: 'member', consent: CONSENT, consentHash: HASH } };
    if (route === org.ROUTES.enroll) { st.world = body.world; return { ok: true, data: { ok: true, org: st.org, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } }; }
    if (route === org.ROUTES.status) return { ok: true, data: { member: true, org: st.org, role: 'member', consent: CONSENT, consentHash: st.hash || HASH, enrolled: { computer: 'c1', world: st.world, thisComputer: true } } };
    return { ok: false, because: 'unknown ' + route };
  } };
  const opts = { root, remote };
  await org.enroll('ACME-JOIN-1234', true, Object.assign({}, opts, { orgId: ORG.id, consentHash: HASH, consent: CONSENT }));
  pinFor(root, ORG.id);
  st.org = { id: 'org_evil', name: 'Evil', slug: 'evil' };
  await org.refresh(opts);
  assert.equal(org.readEnrollment(opts).org.id, 'org_evil', 'precondition: the refresh took the coordinator\'s org');
  st.hash = 'b'.repeat(64);
  await org.consentWithdrawn(opts, HASH);
  const a = await org.reacceptWords(opts);
  assert.equal(a.ok, true, 'precondition: the review enroll ran');
  assert.equal(pin.readPin(root).org, ORG.id, 'the pin survives');
  const k = Buffer.alloc(32, 7);
  assert.equal(pin.check(root, answer('org_evil', k, sign('org_evil', 1, k)), company('org_evil', k), ARMED).ok, false, 'and the renamed org\'s key is refused');
});

test('the refusal names no company, so the backup job keeps no state for a pair this computer refused', async () => {
  const k = backupkeys.newMemberKey();
  const macRequest = async (m, route) => (route === mk.BACKUP_KEY_ROUTE ? { ok: true, data: answer('org1', k.pk) } : { ok: false, because: 'not reached' });
  const r = await mk.ensureMemberKey({ macRequest, orgKeyPin: ARMED });
  assert.equal(r.orgKeyRefused, true);
  assert.equal(r.org, undefined);
  assert.equal(r.member, undefined);
});

test('only a 32-byte key overrides the shipped one: null cannot switch checking off', () => {
  const k = Buffer.alloc(32, 3);
  assert.deepEqual(pin.check(ROOT(), answer('o1', k), company('o1', k), { verifyingKey: null }), { ok: true }, 'dormant today either way');
  assert.equal(pin.check(ROOT(), answer('o1', k), company('o1', k), { verifyingKey: VK }).ok, false, 'armed by a real key');
});

test('through orgenroll: a join whose answer was lost and settles later clears another company\'s pin', async (t) => {
  const root = world(t);
  pinFor(root, 'org_other');
  let status = () => ({ ok: false, because: 'offline' });
  const co = { macRequest: async (m, route) => {
    if (route === org.ROUTES.enroll) return { ok: false, because: 'the tunnel program did not answer in time' };
    if (route === org.ROUTES.status) return status();
    return { ok: false, because: 'unexpected ' + route }; } };
  const r = await org.enroll('ACME-JOIN-1234', true, { root, remote: co, consentHash: 'c'.repeat(64) });
  assert.equal(r.code, 'org_join_unknown', JSON.stringify(r));
  assert.equal(pin.readPin(root).org, 'org_other', 'nothing settled yet: kept');
  status = () => ({ ok: true, data: { member: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: org.worldId({ root }), thisComputer: true } } });
  const r2 = await org.refresh({ root, remote: co });
  assert.equal(r2.enrolled, true, JSON.stringify(r2));
  assert.equal(pin.readPin(root), null, 'the settled join to another company cleared it');
});

test('the backup tick says a refused company key to the person, once', async () => {
  const tick = require('./backuptick');
  const said = [];
  let t = Date.parse('2026-10-08T12:00:00Z');
  const refused = { ok: false, orgKeyRefused: true, because: 'the escrow\'s signature on the company backup key did not check, so the key was not used' };
  const stop = tick.startTick({ runBackup: async () => refused, roots: () => [{ name: 'workers', path: '/w' }], enrolled: () => true,
    say: (x) => said.push(x), now: () => t, setInterval: () => ({ unref() {} }), clearInterval: () => {} });
  await stop.tick(); t += 3 * 24 * 3600 * 1000; await stop.tick();
  assert.deepEqual(said, [`company backup: ${refused.because}`]);
});

test('the backup job carries orgKeyRefused to the scheduler, and snapshots nothing', async () => {
  const job = require('./backupjob');
  let snaps = 0;
  const r = await job.runOnce({}, { ensureMemberKey: async () => ({ ok: false, orgKeyRefused: true, because: 'refused' }), now: () => Date.now(), snapshot: async () => { snaps++; return { ok: true }; } });
  assert.equal(r.result.orgKeyRefused, true, JSON.stringify(r));
  assert.equal(snaps, 0);
});
