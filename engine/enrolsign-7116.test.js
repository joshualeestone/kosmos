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

/* ---- the route client (Renet Tilley's pinned interface, #7116 comment 7021733967) ---- */
// A stand-in coordinator: start answers bytes it builds from the body (as the coordinator does with escrowd's nonce),
// sign records what it is sent, pending lists entries.
function coordinator({ swapKey = false, inviter } = {}) {
  const calls = [];
  const entries = new Map();
  const send = async (method, route, body) => {
    calls.push({ method, route, body });
    if (method === 'POST' && route === '/v1/org/devkey-enrol') {
      const key = swapKey ? dk.rawPublic(crypto.generateKeyPairSync('ed25519').publicKey) : Buffer.from(body.key, 'base64url');
      const bytes = se.encodeDevkeyEnrol(ORG, MEMBER, key, Buffer.from(body.codeHash, 'base64url'), Buffer.from(body.joinTag, 'base64url'),
        inviter || body.inviterAdminId, '7', Buffer.alloc(32, 0x5a));
      entries.set('e1', bytes);
      return { ok: true, data: { id: 'e1', bytes: bytes.toString('base64url'), expiresAt: 'later' } };
    }
    if (method === 'POST' && route === '/v1/org/devkey-enrol/e1/sign') return { ok: true, data: { ok: true, waiting: true, signedBy: [], keySigned: true } };
    if (method === 'GET' && route === '/v1/org/devkey-enrol/pending') {
      return { ok: true, data: { pending: [{ id: 'e1', member: MEMBER, bytes: entries.get('e1').toString('base64url'), signedBy: [], keySigned: true, expiresAt: 'later' },
        { id: '../bad', bytes: 'AA' }] } };
    }
    return { ok: false, because: 'no such route' };
  };
  return { send, calls };
}
const macKey = () => { const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'); return { ok: true, privateKey, publicKey }; };

test('#7116 step 2 caller: the member\'s Mac starts, checks the bytes, signs them and posts keySig; the body never names an org', async () => {
  const c = coordinator(); const mac = macKey(); const code = dk.newJoinCode();
  const out = await es.startAndSign({ org: ORG, member: MEMBER, joinCode: code, inviterAdminId: INVITER, deviceKey: mac, send: c.send });
  assert.equal(out.id, 'e1');
  assert.equal(out.answer.keySigned, true);
  const [start, sign] = c.calls;
  assert.equal(start.route, '/v1/org/devkey-enrol');
  assert.deepEqual(Object.keys(start.body).sort(), ['codeHash', 'inviterAdminId', 'joinTag', 'key']);
  assert.ok(Buffer.from(start.body.joinTag, 'base64url').equals(dk.joinTag(code, ORG, MEMBER, dk.rawPublic(mac.publicKey))));
  const bytes = se.encodeDevkeyEnrol(ORG, MEMBER, dk.rawPublic(mac.publicKey), dk.joinCodeHash(code), dk.joinTag(code, ORG, MEMBER, dk.rawPublic(mac.publicKey)), INVITER, '7', Buffer.alloc(32, 0x5a));
  assert.ok(crypto.verify(null, bytes, mac.publicKey, Buffer.from(sign.body.keySig, 'base64url')), 'keySig is over the returned bytes');
});

test('#7116 step 2 caller: a coordinator that swaps the key or the inviter gets no signature', async () => {
  const swapped = coordinator({ swapKey: true });
  await assert.rejects(es.startAndSign({ org: ORG, member: MEMBER, joinCode: dk.newJoinCode(), inviterAdminId: INVITER, deviceKey: macKey(), send: swapped.send }),
    /different key from this computer/);
  assert.equal(swapped.calls.length, 1, 'nothing was signed or posted');
  const otherInviter = coordinator({ inviter: OTHER_ADMIN });
  await assert.rejects(es.startAndSign({ org: ORG, member: MEMBER, joinCode: dk.newJoinCode(), inviterAdminId: INVITER, deviceKey: macKey(), send: otherInviter.send }),
    /different inviting admin/);
  assert.equal(otherInviter.calls.length, 1);
});

test('#7116 step 2 caller: pending decodes each entry\'s bytes, drops a malformed id, and an admin\'s signature goes as escrowd\'s Wire object', async () => {
  const c = coordinator();
  await es.startAndSign({ org: ORG, member: MEMBER, joinCode: dk.newJoinCode(), inviterAdminId: INVITER, deviceKey: macKey(), send: c.send });
  const list = await es.pending({ send: c.send });
  assert.equal(list.length, 1, 'the malformed id is dropped');
  assert.equal(se.decodeDevkeyEnrol(list[0].bytes).member, MEMBER);
  await es.postAdminSig('e1', { adminId: OTHER_ADMIN, sig: Buffer.from('3045', 'hex') }, { send: c.send });
  assert.deepEqual(c.calls.at(-1).body, { sig: { adminId: OTHER_ADMIN, se: Buffer.from('3045', 'hex').toString('base64url') } });
  await assert.rejects(es.postAdminSig('../x', { adminId: 'a', sig: Buffer.alloc(1) }, { send: c.send }), /not an enrolment id/);
  await assert.rejects(es.pending({ send: async () => ({ ok: false, because: 'this computer is not connected to Kosmos+' }) }), /not connected/);
});

test('#7116 step 2 caller: adminQueue lists what an admin can sign, says why it cannot sign the rest, and leaves out what it signed', async () => {
  const root = fresh();
  const c = coordinator(); const code = dk.newJoinCode();
  await es.startAndSign({ org: ORG, member: MEMBER, joinCode: code, inviterAdminId: INVITER, deviceKey: macKey(), send: c.send });
  // The second admin: offered, nothing checked.
  const [second] = await es.adminQueue({ adminId: OTHER_ADMIN, send: c.send, dataRoot: root });
  assert.equal(second.refused, null);
  assert.equal(second.inviterChecked, false);
  assert.equal(second.member, MEMBER);
  assert.match(second.fingerprint, /^[0-9a-f]{8}( [0-9a-f]{8}){3}$/);
  // The inviter without its code: listed, not offered.
  const [noCode] = await es.adminQueue({ adminId: INVITER, send: c.send, dataRoot: root });
  assert.equal(noCode.prepared, null);
  assert.match(noCode.refused, /join code is not on this computer/);
  // The inviter with the right code: offered, checked.
  es.keepJoinCode(ORG, MEMBER, code, { dataRoot: root });
  const [checked] = await es.adminQueue({ adminId: INVITER, send: c.send, dataRoot: root });
  assert.equal(checked.inviterChecked, true);
  assert.ok(checked.prepared);
  // The inviter with ANOTHER code kept for this member: refused, never offered.
  es.keepJoinCode(ORG, MEMBER, dk.newJoinCode(), { dataRoot: root });
  const [wrong] = await es.adminQueue({ adminId: INVITER, send: c.send, dataRoot: root });
  assert.equal(wrong.prepared, null);
  assert.match(wrong.refused, /does not match the invite you sent/);
  // An admin who already signed it does not see it again.
  const signedSend = async (m, r, b) => (m === 'GET' ? { ok: true, data: { pending: [{ id: 'e1', bytes: (await c.send(m, r, b)).data.pending[0].bytes, signedBy: [OTHER_ADMIN], keySigned: true }] } } : c.send(m, r, b));
  assert.equal((await es.adminQueue({ adminId: OTHER_ADMIN, send: signedSend, dataRoot: root })).length, 0);
});
