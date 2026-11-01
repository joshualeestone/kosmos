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
    () => ({ ok: true, privateKey: crypto.generateKeyPairSync('x25519').privateKey }),
    () => ({ ok: true, privateKey: crypto.generateKeyPairSync('ed25519').publicKey })]) {
    fs.rmSync(path.join(store.ROOT, 'backupkeys'), { recursive: true, force: true });
    const c = fakeCoordinator();
    const r = await mk.ensureMemberKey({ macRequest: c.macRequest, deviceKey: read });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(Object.keys(c.registration().body).sort(), ['epoch', 'member_public', 'wrap']);
  }
});

test('#7753: with no deviceKey option, the connector\'s mac_key in this data root\'s state folder signs the record', async () => {
  // The sandbox's own state folder (remote.stateDir() under AGENT_WORKFORCE_DATA), laid out as the connector leaves it.
  const dir = require('./remote').stateDir();
  assert.ok(dir.startsWith(SANDBOX), 'premise: the state folder is inside this test\'s sandbox, never the real one');
  fs.mkdirSync(dir, { recursive: true });
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(dir, 'mac_id'), 'mac_test1\n');
  fs.writeFileSync(path.join(dir, 'mac_key'), privateKey.export({ format: 'jwk' }).d + '\n');
  try {
    const c = fakeCoordinator();
    const r = await mk.ensureMemberKey({ macRequest: c.macRequest });
    assert.equal(r.ok, true, JSON.stringify(r));
    const body = c.registration().body;
    assert.equal(verifies(publicKey, ORG, MEMBER, 1, Buffer.from(body.member_public, 'base64url'), body.member_key_sig), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
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

/* The shared vector. The same values are in escrowd's Rust verifier (kosmos-relay, #5686 Part 2), so a drift in the
   bytes or the signature goes red on both sides. Ed25519 is deterministic: this seed always gives this signature. */
const VECTOR = {
  org: 'org1', member: 'acct1', epoch: 7,
  memberPublic: 'ab'.repeat(32),
  seed: '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20',
  devicePublic: '79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664',
  bytes: '6b6f736d6f732d6261636b7570207631206d656d6265722d6b65792d7265636f72640000046f726731000561636374310000000000000007'
    + 'ab'.repeat(32),
  sig: '1333a3f066ce5b254731fc74fc322e1eaf871e51471f3075a24f6af67584542981ce3a90f3a26fea1155073b913b666e81e9fa9ed869877f89c105eaa74c0507',
};
test('#7753: the shared vector: seed, device public key, record bytes and signature', () => {
  const priv = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(VECTOR.seed, 'hex')]), format: 'der', type: 'pkcs8' });
  const pub = crypto.createPublicKey(priv);
  assert.equal(Buffer.from(pub.export({ format: 'jwk' }).x, 'base64url').toString('hex'), VECTOR.devicePublic);
  const bytes = mk.memberKeyRecordBytes(VECTOR.org, VECTOR.member, VECTOR.epoch, Buffer.from(VECTOR.memberPublic, 'hex'));
  assert.equal(bytes.toString('hex'), VECTOR.bytes);
  assert.equal(crypto.sign(null, bytes, priv).toString('hex'), VECTOR.sig);
  assert.equal(crypto.verify(null, bytes, pub, Buffer.from(VECTOR.sig, 'hex')), true);
});
