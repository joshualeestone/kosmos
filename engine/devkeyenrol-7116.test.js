'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#7116 step 2: the member's Mac half of a two-admin device-key enrolment (engine/devkeyenrol.js) and the
 * inviter's check in seadmin.prepare. No Secure Enclave and no network: K is a fresh Ed25519 key standing in for
 * backupdevicekey's, and the admin signatures are stand-in bytes (seadmin-7116.test.js covers real admin signing).
 *
 *   node --test engine/devkeyenrol-7116.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const dk = require('./devkeyenrol');
const se = require('./seadmin');

const ORG = 'org-é1';
const MEMBER = 'member-7';
const INVITER = 'admin-3';
const OTHER_ADMIN = 'admin-9';
const NONCE = Buffer.from('00112233445566778899aabbccddeeff', 'hex');   // the pinned vector's (16 bytes: it pins the encoder only)
const NONCE_ESCROWD = Buffer.alloc(32, 0x5a);   // escrowd issues 32-byte nonces (rosternonce::LEN), and the Mac signs only those
const GEN = '4294967298';

function macKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { ok: true, privateKey, publicKey };
}
// The bytes as the coordinator would hand them to every signer, made from a code the inviter holds.
function enrolment({ code = dk.newJoinCode(), mac = macKey(), org = ORG, member = MEMBER, k, nonce = NONCE_ESCROWD } = {}) {
  const key = k || dk.rawPublic(mac.publicKey);
  const bytes = se.encodeDevkeyEnrol(org, member, key, dk.joinCodeHash(code), dk.joinTag(code, org, member, key), INVITER, GEN, nonce);
  return { code, mac, key, bytes };
}

test('#7116 step 2: the join code hash and tag follow the design (labelled, length-prefixed), and depend on every input', () => {
  const code = Buffer.alloc(16, 7);
  const put = (b) => Buffer.concat([Buffer.from([0, 0, 0, b.length]), b]);
  const expectHash = crypto.createHash('sha256').update(Buffer.concat([put(Buffer.from('kosmos-join-code hash v1')), put(code)])).digest();
  assert.ok(dk.joinCodeHash(code).equals(expectHash));
  const k = Buffer.alloc(32, 1);
  const tag = dk.joinTag(code, ORG, MEMBER, k);
  const expectTag = crypto.createHmac('sha256', code).update(Buffer.concat([put(Buffer.from('kosmos-join-code tag v1')),
    put(Buffer.from(ORG, 'utf8')), put(Buffer.from(MEMBER)), put(k)])).digest();
  assert.ok(tag.equals(expectTag));
  // Each input changes the tag (no two org/member splits give the same bytes: they are length-prefixed).
  assert.ok(!dk.joinTag(code, ORG, MEMBER, Buffer.alloc(32, 2)).equals(tag));
  assert.ok(!dk.joinTag(code, ORG, 'member-8', k).equals(tag));
  assert.ok(!dk.joinTag(code, 'org-', 'é1' + MEMBER, k).equals(dk.joinTag(code, 'org-é1', MEMBER, k)));
  assert.ok(!dk.joinTag(Buffer.alloc(16, 8), ORG, MEMBER, k).equals(tag));
  assert.throws(() => dk.joinCodeHash(Buffer.alloc(15)), /a join code is 16 bytes/);
  assert.equal(dk.newJoinCode().length, 16);
});

test('#7116 step 2: the inviter\'s screen checks the code; a substituted key, member or code refuses; the second admin is told nothing was checked', () => {
  const e = enrolment();
  const p = se.prepare('devkeyEnrol', e.bytes, { joinCode: e.code });
  assert.equal(p.inviterChecked, true);
  assert.equal(p.decoded.member, MEMBER);
  assert.equal(p.fingerprint, se.fingerprintDisplay(se.devkeyFingerprint(ORG, MEMBER, e.key)));
  assert.match(p.fingerprint, /^[0-9a-f]{8}( [0-9a-f]{8}){3}$/);
  // The second admin never holds the code: decoded and shown, but not called checked.
  const second = se.prepare('devkeyEnrol', e.bytes);
  assert.equal(second.inviterChecked, false);
  // A coordinator that shows the inviter its OWN key, with a tag it cannot make without the code: refused.
  const attacker = macKey();
  const swapped = se.encodeDevkeyEnrol(ORG, MEMBER, dk.rawPublic(attacker.publicKey), dk.joinCodeHash(e.code),
    dk.joinTag(e.code, ORG, MEMBER, e.key), INVITER, GEN, NONCE);
  assert.throws(() => se.prepare('devkeyEnrol', swapped, { joinCode: e.code }), /does not match that enrolment/);
  // Another member, the right key: refused (the tag binds the member).
  const otherMember = se.encodeDevkeyEnrol(ORG, 'member-8', e.key, dk.joinCodeHash(e.code), dk.joinTag(e.code, ORG, MEMBER, e.key),
    INVITER, GEN, NONCE);
  assert.throws(() => se.prepare('devkeyEnrol', otherMember, { joinCode: e.code }), /does not match/);
  // Another invite's code: refused.
  assert.throws(() => se.prepare('devkeyEnrol', e.bytes, { joinCode: dk.newJoinCode() }), /does not match/);
  // Review 1: the right tag with another code's hash refuses (the hash arm of the check, alone).
  const wrongHash = se.encodeDevkeyEnrol(ORG, MEMBER, e.key, dk.joinCodeHash(dk.newJoinCode()), dk.joinTag(e.code, ORG, MEMBER, e.key),
    INVITER, GEN, NONCE);
  assert.throws(() => se.prepare('devkeyEnrol', wrongHash, { joinCode: e.code }), /does not match/);
  // Review 1: a code that is not 16 bytes refuses; it is never read as "no code, unchecked".
  assert.throws(() => se.prepare('devkeyEnrol', e.bytes, { joinCode: null }), /a join code is 16 bytes/);
  assert.throws(() => se.prepare('devkeyEnrol', e.bytes, { joinCode: Buffer.alloc(15) }), /a join code is 16 bytes/);
  // Review 1: K's fingerprint recomputed from its definition (posted on #7116 for the console page to match).
  const put = (b) => { const l = Buffer.alloc(4); l.writeUInt32BE(b.length); return Buffer.concat([l, b]); };
  const fp = crypto.createHash('sha256').update(Buffer.concat([Buffer.from('kosmos-escrowd-devkey-fingerprint v1'),
    put(Buffer.from(ORG, 'utf8')), put(Buffer.from(MEMBER)), put(e.key)])).digest().subarray(0, 16).toString('hex');
  assert.equal(p.fingerprint, [fp.slice(0, 8), fp.slice(8, 16), fp.slice(16, 24), fp.slice(24, 32)].join(' '));
  // The fingerprint is bound to the member: one key for two members reads differently.
  assert.notEqual(se.fingerprintDisplay(se.devkeyFingerprint(ORG, 'member-8', e.key)), p.fingerprint);
});

test('#7116 step 2 review 1: an admin signing an enrolment says who it is; the inviter cannot sign one its code did not check', async () => {
  const e = enrolment();
  const unchecked = se.prepare('devkeyEnrol', e.bytes);
  // Refused before kosmos-se is ever run (no helper is given): the inviter, unchecked; and an admin who does not say.
  await assert.rejects(se.sign(unchecked, { adminId: INVITER }), /you sent this invite, so your join code must be checked/);
  await assert.rejects(se.sign(unchecked, {}), /say which admin is signing this enrolment/);
  // CONTROL: the second admin, and the inviter once checked, get past that rule (and stop at the next check, the key).
  await assert.rejects(se.sign(unchecked, { adminId: OTHER_ADMIN }), /a key is 65 bytes/);
  await assert.rejects(se.sign(se.prepare('devkeyEnrol', e.bytes, { joinCode: e.code }), { adminId: INVITER }), /a key is 65 bytes/);
});

test('#7116 step 2 review 3: the decoder refuses a wrong-length key, code hash or join tag, and an empty company, member or inviter', () => {
  const e = enrolment();
  const parts = { org: ORG, member: MEMBER, key: e.key, codeHash: dk.joinCodeHash(e.code), joinTag: dk.joinTag(e.code, ORG, MEMBER, e.key), inviter: INVITER };
  // Built field by field, so a wrong length reaches the decoder (the encoder refuses one itself).
  const put = (b) => { const l = Buffer.alloc(4); l.writeUInt32BE(b.length); return Buffer.concat([l, b]); };
  const raw = (q) => Buffer.concat([Buffer.from('kosmos-escrowd-devkeyhist-enrol v1'), put(Buffer.from(q.org, 'utf8')), put(Buffer.from(q.member)),
    put(q.key), put(q.codeHash), put(q.joinTag), put(Buffer.from(q.inviter)), put(Buffer.from('0000000100000002', 'hex')), put(NONCE)]);
  assert.ok(se.decodeDevkeyEnrol(raw(parts)), 'CONTROL: the valid twin decodes');
  for (const [k, what] of [['key', 'a Mac key'], ['codeHash', 'a code hash'], ['joinTag', 'a join tag']]) {
    for (const n of [31, 33]) assert.throws(() => se.decodeDevkeyEnrol(raw({ ...parts, [k]: Buffer.alloc(n) })), new RegExp(what + ' is 32 bytes'), k + ' ' + n);
  }
  for (const [k, what] of [['org', 'company'], ['member', 'member'], ['inviter', 'inviting admin']]) {
    assert.throws(() => se.decodeDevkeyEnrol(raw({ ...parts, [k]: '' })), new RegExp('must name its ' + what), k);
  }
  // Review 3: a join code with another action is refused, never ignored.
  assert.throws(() => se.prepare('cancel', se.encodeCancel(ORG, 'roster-change', Buffer.alloc(16)), { joinCode: e.code }), /only with an enrolment/);
});

test('#7116 step 2: this Mac signs only bytes enrolling its own key for the expected org and member', () => {
  const e = enrolment();
  const { signature, decoded } = dk.deviceSign(e.bytes, { org: ORG, member: MEMBER, deviceKey: e.mac });
  assert.equal(signature.length, 64);
  assert.equal(decoded.member, MEMBER);
  assert.ok(crypto.verify(null, e.bytes, e.mac.publicKey, signature));
  // Another key in the bytes: refused, and no signature is made.
  const notMine = enrolment();
  assert.throws(() => dk.deviceSign(notMine.bytes, { org: ORG, member: MEMBER, deviceKey: e.mac }), /a different key from this computer/);
  assert.throws(() => dk.deviceSign(e.bytes, { org: ORG, member: 'member-8', deviceKey: e.mac }), /different company or member/);
  assert.throws(() => dk.deviceSign(e.bytes, { org: 'org-2', member: MEMBER, deviceKey: e.mac }), /different company or member/);
  // Another action's bytes: refused by the decoder.
  assert.throws(() => dk.deviceSign(se.encodeCancel(ORG, 'roster-change', Buffer.alloc(16)), { org: ORG, member: MEMBER, deviceKey: e.mac }),
    /different action/);
  // Review 1: with the code this Mac joined with, it signs only that invite's enrolment.
  assert.ok(dk.deviceSign(e.bytes, { org: ORG, member: MEMBER, deviceKey: e.mac, joinCode: e.code }).signature.length === 64);
  assert.throws(() => dk.deviceSign(e.bytes, { org: ORG, member: MEMBER, deviceKey: e.mac, joinCode: dk.newJoinCode() }), /not for the invite/);
  // A device key that could not be read says why.
  assert.throws(() => dk.deviceSign(e.bytes, { org: ORG, member: MEMBER, deviceKey: { ok: false, because: 'this computer has no device key yet' } }),
    /no device key yet/);
});

// escrowd issues 32-byte nonces (rosternonce::LEN) and its devkeyhist_enrol refuses any other length; the pinned
// vector's 16-byte NONCE pins only the encoder (review 5).
const NONCE32 = Buffer.alloc(32, 0x5a);
function enrolment32() {
  const code = dk.newJoinCode(); const mac = macKey(); const key = dk.rawPublic(mac.publicKey);
  return { code, mac, key, bytes: se.encodeDevkeyEnrol(ORG, MEMBER, key, dk.joinCodeHash(code), dk.joinTag(code, ORG, MEMBER, key), INVITER, GEN, NONCE32) };
}
test('#7116 step 2: the request is escrowd\'s devkeyhist_enrol shape (rosterwire.rs at sealkey-8733), carries exactly the signed fields, and refuses what escrowd would', () => {
  const e = enrolment32();
  const { signature } = dk.deviceSign(e.bytes, { org: ORG, member: MEMBER, deviceKey: e.mac });
  const admins = [{ adminId: INVITER, sig: Buffer.from('3045', 'hex') }, { adminId: OTHER_ADMIN, sig: Buffer.from('3046', 'hex') }];
  const r = dk.request(e.bytes, signature, admins);
  // The names rosterwire.rs reads, and nothing else (no generation: escrowd rebuilds the bytes at its current one).
  assert.deepEqual(Object.keys(r), ['op', 'org', 'member', 'key', 'codeHash', 'joinTag', 'inviterAdminId', 'nonce', 'sigs', 'keySig']);
  assert.equal(r.op, 'devkeyhist_enrol');
  // Every byte field unpadded base64url (rosterwire's B64 = URL_SAFE_NO_PAD).
  const b64 = (x) => Buffer.from(x, 'base64url');
  for (const k of ['key', 'codeHash', 'joinTag', 'nonce', 'keySig']) assert.match(r[k], /^[A-Za-z0-9_-]+$/, k + ' is unpadded base64url');
  assert.ok(b64(r.key).equals(e.key));
  assert.ok(b64(r.nonce).equals(NONCE32));
  assert.ok(b64(r.keySig).equals(signature));
  assert.deepEqual(r.sigs, [{ adminId: INVITER, se: Buffer.from('3045', 'hex').toString('base64url') }, { adminId: OTHER_ADMIN, se: Buffer.from('3046', 'hex').toString('base64url') }]);
  // Re-encoding the request's fields at the signed generation gives the signed bytes back.
  assert.ok(se.encodeDevkeyEnrol(r.org, r.member, b64(r.key), b64(r.codeHash), b64(r.joinTag), r.inviterAdminId, GEN, b64(r.nonce)).equals(e.bytes));
  // A nonce of any other length is refused, as escrowd refuses it (review 5).
  const short = enrolment({ nonce: NONCE });
  // The Mac refuses to sign it (review 6); a signature made anyway is refused by request() too.
  assert.throws(() => dk.deviceSign(short.bytes, { org: ORG, member: MEMBER, deviceKey: short.mac }), /nonce escrowd did not issue/);
  assert.throws(() => dk.request(short.bytes, crypto.sign(null, short.bytes, short.mac.privateKey), admins), /nonce is 32 bytes/);
  // A passkey admin's signature (from the console page) goes through typed.
  const pk = { authenticatorData: Buffer.from('aa', 'hex'), clientDataJSON: Buffer.from('{}'), signature: Buffer.from('3044', 'hex') };
  const withPasskey = dk.request(e.bytes, signature, [admins[0], { adminId: OTHER_ADMIN, passkey: pk }]);
  assert.deepEqual(withPasskey.sigs[1], { adminId: OTHER_ADMIN, passkey: { authenticatorData: 'qg', clientDataJSON: 'e30', signature: 'MEQ' } });
  assert.throws(() => dk.request(e.bytes, signature, [admins[0], { adminId: OTHER_ADMIN, passkey: { ...pk, signature: '' } }]), /three byte fields/);
  assert.throws(() => dk.request(e.bytes, signature, [admins[0], { adminId: OTHER_ADMIN, passkey: pk, sig: Buffer.alloc(2) }]), /not both/);
  assert.throws(() => dk.request(e.bytes, signature, [admins[0], { adminId: OTHER_ADMIN, passkey: null, sig: Buffer.alloc(2) }]), /not both/);
  // Refusals.
  assert.throws(() => dk.request(e.bytes, signature, [admins[0]]), /two admins/);
  assert.throws(() => dk.request(e.bytes, signature, [{ adminId: INVITER, sig: '3045' }, admins[1]]), /each admin signature is bytes/);   // review 2
  assert.throws(() => dk.request(e.bytes, signature, [admins[0], admins[0]]), /must be different/);
  assert.throws(() => dk.request(e.bytes, signature, [{ adminId: 'admin-1', sig: Buffer.alloc(2) }, admins[1]]), /sent the invite must be one/);
  assert.throws(() => dk.request(e.bytes, signature, [{ adminId: '', sig: Buffer.alloc(2) }, admins[1]]), /names its admin/);
  const wrong = macKey();
  assert.throws(() => dk.request(e.bytes, crypto.sign(null, e.bytes, wrong.privateKey), admins), /not by the key being enrolled/);
});
