'use strict';
/**
 * kosmos#7753: this computer signs its member key record (org, member, epoch, member_public) with its device key and
 * sends the signature with the registration, as member_key_sig, so escrowd can refuse a release whose key no device of
 * the member signed. A device key that cannot be read leaves the registration as it was before.
 *
 *   node --test engine/backupmemberkey-7753.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-memberkey-7753-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const store = require('./store');
const backupkeys = require('./backupkeys');
const mk = require('./backupmemberkey');

const ORG = 'org1', MEMBER = 'acct1';

/* A coordinator that takes the first key at epoch 1 and keeps every body it was sent. */
function fakeCoordinator() {
  const company = backupkeys.newMemberKey();
  const calls = [];
  const macRequest = async (method, route, body) => {
    calls.push({ route, body });
    if (route === mk.BACKUP_KEY_ROUTE) return { ok: true, data: { org: ORG, member: MEMBER, epoch: 1, public_key: company.pk.toString('base64url') } };
    if (route === mk.MEMBER_KEY_ROUTE) return { ok: true, data: { epoch: body.epoch, member_public: body.member_public } };
    return { ok: false, because: 'no such route' };
  };
  const registration = () => calls.find((c) => c.route === mk.MEMBER_KEY_ROUTE);
  return { macRequest, registration };
}
const device = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { privateKey, publicKey, read: () => ({ ok: true, privateKey, publicKey }) };
};

/* escrowd's check, as a test: devicePub's Ed25519 signature over the record's bytes. */
const verifies = (devicePub, org, member, epoch, memberPublic, sig) => {
  try { return crypto.verify(null, mk.memberKeyRecordBytes(org, member, epoch, memberPublic), devicePub, Buffer.from(sig, 'base64url')); } catch { return false; }
};

test.beforeEach(() => fs.rmSync(path.join(store.ROOT, 'backupkeys'), { recursive: true, force: true }));
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

test('#7753: the registration carries a device signature over (org, member, epoch, member_public)', async () => {
  const c = fakeCoordinator(), d = device();
  const r = await mk.ensureMemberKey({ macRequest: c.macRequest, deviceKey: d.read });
  assert.equal(r.ok, true, JSON.stringify(r));
  const body = c.registration().body;
  assert.equal(typeof body.member_key_sig, 'string');
  const pk = Buffer.from(body.member_public, 'base64url');
  assert.equal(verifies(d.publicKey, ORG, MEMBER, 1, pk, body.member_key_sig), true);
});

test('#7753: the signature binds every field and the device key (each changed one fails)', async () => {
  const c = fakeCoordinator(), d = device(), other = device();
  await mk.ensureMemberKey({ macRequest: c.macRequest, deviceKey: d.read });
  const body = c.registration().body;
  const pk = Buffer.from(body.member_public, 'base64url');
  const sig = body.member_key_sig;
  assert.equal(verifies(d.publicKey, ORG, MEMBER, 1, pk, sig), true, 'control: the true record verifies');
  assert.equal(verifies(other.publicKey, ORG, MEMBER, 1, pk, sig), false, 'another device');
  assert.equal(verifies(d.publicKey, 'org2', MEMBER, 1, pk, sig), false, 'another org');
  assert.equal(verifies(d.publicKey, ORG, 'acct2', 1, pk, sig), false, 'another member');
  assert.equal(verifies(d.publicKey, ORG, MEMBER, 2, pk, sig), false, 'another epoch');
  assert.equal(verifies(d.publicKey, ORG, MEMBER, 1, backupkeys.newMemberKey().pk, sig), false, 'a planted key');
  assert.equal(Buffer.from(sig, 'base64url').length, 64, 'an Ed25519 signature');
});

test('#7753: no readable device key registers exactly as before, with no signature', async () => {
  for (const read of [() => ({ ok: false, because: 'no device identity' }), () => { throw new Error('boom'); },
    () => ({ ok: true, privateKey: crypto.generateKeyPairSync('x25519').privateKey })]) {
    fs.rmSync(path.join(store.ROOT, 'backupkeys'), { recursive: true, force: true });
    const c = fakeCoordinator();
    const r = await mk.ensureMemberKey({ macRequest: c.macRequest, deviceKey: read });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(Object.keys(c.registration().body).sort(), ['epoch', 'member_public', 'wrap']);
  }
});

test('#7753: the signed bytes are the layout on the card (built here by hand, for escrowd to match)', () => {
  const pk = Buffer.alloc(32, 0xab);
  const expected = Buffer.concat([
    Buffer.from('6b6f736d6f732d6261636b7570207631206d656d6265722d6b65792d7265636f726400', 'hex'),   // "kosmos-backup v1 member-key-record\0"
    Buffer.from('0004', 'hex'), Buffer.from('org1'),
    Buffer.from('0005', 'hex'), Buffer.from('acct1'),
    Buffer.from('0000000000000007', 'hex'),
    pk,
  ]);
  assert.deepEqual(mk.memberKeyRecordBytes('org1', 'acct1', 7, pk), expected);
  assert.throws(() => mk.memberKeyRecordBytes('org1', 'acct1', 0, pk));
  assert.throws(() => mk.memberKeyRecordBytes('org1', 'acct1', 1, Buffer.alloc(31)));
});
