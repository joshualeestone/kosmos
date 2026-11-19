'use strict';
/**
 * kosmos#7116 step 2, the caller (engine/enrolsign.js): finding kosmos-se in the app's own bundle, the inviter's kept
 * join codes, reviewing an enrolment with them, and approving it. The Enclave is stood in for by a small helper script
 * that answers `pub` and `sign` with a P-256 key (the real kosmos-se is tested in engine/seadmin-7116.test.js); the
 * contract is the same: hex on stdout, DER over the raw message.
 *
 *   node --test engine/enrolsign-7116.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const es = require('./enrolsign');
const dk = require('./devkeyenrol');
const se = require('./seadmin');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-enrolsign-7116-'));
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
let n = 0;
const fresh = () => { const d = path.join(SANDBOX, 'case-' + (++n)); fs.mkdirSync(d, { recursive: true }); return d; };

const ORG = 'org-é1';
const MEMBER = 'member-7';
const INVITER = 'admin-3';
const OTHER_ADMIN = 'admin-9';
const NONCE = Buffer.from('00112233445566778899aabbccddeeff', 'hex');

function enrolment(code = dk.newJoinCode()) {
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const k = dk.rawPublic(publicKey);
  return { code, bytes: se.encodeDevkeyEnrol(ORG, MEMBER, k, dk.joinCodeHash(code), dk.joinTag(code, ORG, MEMBER, k), INVITER, '7', NONCE) };
}

// An app folder with a stand-in kosmos-se at bin/kosmos-se: `pub <keyfile>` and `sign <keyfile>` over a P-256 PEM key.
function appWithHelper() {
  const app = fresh();
  fs.mkdirSync(path.join(app, 'bin'));
  const helper = path.join(app, 'bin', 'kosmos-se');
  fs.writeFileSync(helper, `#!${process.execPath}
const fs = require('fs'), crypto = require('crypto');
const [cmd, file] = process.argv.slice(2);
const priv = crypto.createPrivateKey(fs.readFileSync(file));
const pub = crypto.createPublicKey(priv).export({ format: 'jwk' });
if (cmd === 'pub') { process.stdout.write('04' + Buffer.from(pub.x, 'base64url').toString('hex') + Buffer.from(pub.y, 'base64url').toString('hex') + '\\n'); process.exit(0); }
if (cmd === 'sign') { const msg = fs.readFileSync(0); process.stdout.write(crypto.sign('sha256', msg, { key: priv, dsaEncoding: 'der' }).toString('hex') + '\\n'); process.exit(0); }
process.stderr.write('kosmos-se: usage\\n'); process.exit(2);
`, { mode: 0o755 });
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const keyFile = path.join(app, 'admin.key');
  fs.writeFileSync(keyFile, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  const jwk = publicKey.export({ format: 'jwk' });
  const expectedKey = Buffer.concat([Buffer.of(4), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return { app, helper, keyFile, expectedKey, publicKey };
}

test('#7116 step 2 caller: kosmos-se is found only as a plain executable file in the app\'s own bin', () => {
  const none = fresh();
  assert.equal(es.helperPath(none), null, 'no bin');
  const { app, helper } = appWithHelper();
  assert.equal(es.helperPath(app), helper);
  // A link at that name is not the bundle's binary.
  const linked = fresh();
  fs.mkdirSync(path.join(linked, 'bin'));
  fs.symlinkSync(helper, path.join(linked, 'bin', 'kosmos-se'));
  assert.equal(es.helperPath(linked), null);
  // Not executable.
  const plain = fresh();
  fs.mkdirSync(path.join(plain, 'bin'));
  fs.writeFileSync(path.join(plain, 'bin', 'kosmos-se'), 'x', { mode: 0o644 });
  assert.equal(es.helperPath(plain), null);
  // The default is this checkout's app folder (engine/..), which has no built helper.
  assert.equal(es.helperPath(), fs.existsSync(path.join(__dirname, '..', 'bin', 'kosmos-se')) ? path.join(__dirname, '..', 'bin', 'kosmos-se') : null);
});

test('#7116 step 2 caller: a kept join code is owner-only, keyed by company and member, and expires', () => {
  const root = fresh();
  const code = dk.newJoinCode();
  assert.equal(es.joinCodeFor(ORG, MEMBER, { dataRoot: root }), null, 'none kept yet');
  es.keepJoinCode(ORG, MEMBER, code, { dataRoot: root, now: 1000 });
  assert.equal(fs.statSync(path.join(root, 'devkey-join-codes.json')).mode & 0o777, 0o600);
  assert.ok(es.joinCodeFor(ORG, MEMBER, { dataRoot: root, now: 2000 }).equals(code));
  assert.equal(es.joinCodeFor(ORG, 'member-8', { dataRoot: root, now: 2000 }), null, 'another member');
  assert.equal(es.joinCodeFor('org-2', MEMBER, { dataRoot: root, now: 2000 }), null, 'another company');
  // A name that would collide under a plain separator does not: ("a|b", "c") vs ("a", "b|c").
  es.keepJoinCode('a|b', 'c', Buffer.alloc(16, 1), { dataRoot: root, now: 1000 });
  assert.equal(es.joinCodeFor('a', 'b|c', { dataRoot: root, now: 2000 }), null);
  // Expired, and one dated in the future, are not used.
  assert.equal(es.joinCodeFor(ORG, MEMBER, { dataRoot: root, now: 1000 + es.CODE_MAX_AGE_MS + 1 }), null);
  es.keepJoinCode(ORG, MEMBER, code, { dataRoot: root, now: 10 * 60 * 1000 });
  assert.equal(es.joinCodeFor(ORG, MEMBER, { dataRoot: root, now: 1000 }), null, 'a code from the future');
  assert.equal(es.forgetJoinCode(ORG, MEMBER, { dataRoot: root }), true);
  assert.equal(es.joinCodeFor(ORG, MEMBER, { dataRoot: root, now: 20 * 60 * 1000 }), null);
  assert.equal(es.forgetJoinCode(ORG, MEMBER, { dataRoot: root }), false);
  assert.throws(() => es.keepJoinCode(ORG, MEMBER, Buffer.alloc(15), { dataRoot: root }), /16 bytes/);
  // An unreadable store says so, never reads as "no code" (which would let the inviter sign unchecked... it cannot, see
  // seadmin.sign, but the screen would show the wrong reason).
  const bad = fresh();
  fs.writeFileSync(path.join(bad, 'devkey-join-codes.json'), '{not json');
  assert.throws(() => es.joinCodeFor(ORG, MEMBER, { dataRoot: bad }), /not readable/);
});

test('#7116 step 2 caller: review uses the kept code for the DECODED company and member, and a kept code that does not match refuses', () => {
  const root = fresh();
  const e = enrolment();
  assert.equal(es.review(e.bytes, { dataRoot: root }).inviterChecked, false, 'no code kept: the second admin\'s view');
  es.keepJoinCode(ORG, MEMBER, e.code, { dataRoot: root });
  const p = es.review(e.bytes, { dataRoot: root });
  assert.equal(p.inviterChecked, true);
  assert.equal(p.decoded.member, MEMBER);
  // Kept code for this member, bytes made from another code (a coordinator's substitute): refused.
  const other = enrolment();
  assert.throws(() => es.review(other.bytes, { dataRoot: root }), /does not match that enrolment/);
});

test('#7116 step 2 caller: approve signs with this app\'s helper, refuses with none, keeps the inviter rule, and drops the used code', async () => {
  const root = fresh();
  const e = enrolment();
  es.keepJoinCode(ORG, MEMBER, e.code, { dataRoot: root });
  const h = appWithHelper();
  // No helper in the app: refused before anything else.
  await assert.rejects(es.approve(es.review(e.bytes, { dataRoot: root }), { adminId: INVITER, expectedKey: h.expectedKey, keyFile: h.keyFile, dataRoot: root, appDir: fresh() }),
    /admin key helper is not installed/);
  const out = await es.approve(es.review(e.bytes, { dataRoot: root }), { adminId: INVITER, expectedKey: h.expectedKey, keyFile: h.keyFile, dataRoot: root, appDir: h.app });
  assert.equal(out.adminId, INVITER);
  assert.ok(crypto.verify('sha256', e.bytes, { key: h.publicKey, dsaEncoding: 'der' }, out.sig), 'the signature is over the enrolment bytes');
  assert.equal(es.joinCodeFor(ORG, MEMBER, { dataRoot: root }), null, 'the used code is dropped');
  // Without the code now, the inviter is refused (seadmin.sign's rule); the second admin still signs.
  await assert.rejects(es.approve(es.review(e.bytes, { dataRoot: root }), { adminId: INVITER, expectedKey: h.expectedKey, keyFile: h.keyFile, dataRoot: root, appDir: h.app }),
    /you sent this invite/);
  const second = await es.approve(es.review(e.bytes, { dataRoot: root }), { adminId: OTHER_ADMIN, expectedKey: h.expectedKey, keyFile: h.keyFile, dataRoot: root, appDir: h.app });
  assert.equal(second.adminId, OTHER_ADMIN);
});
