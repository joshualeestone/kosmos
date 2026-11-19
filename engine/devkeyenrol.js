'use strict';

/**
 * kosmos#7116 step 2, the member's Mac half of a two-admin device-key enrolment (Ice Cream Kitty's interface, #7116
 * comments 7016056841 and 7016119703; the design, comment 6515728359).
 *
 * escrowd keeps, per member, a history of the Mac keys (K: the raw 32-byte Ed25519 key a backup manifest is signed
 * with, engine/backupdevicekey.js) that restore and hand-over may trust (engine/devkeyhist.js). A key enters that
 * history only on the enrolment bytes (engine/seadmin.js encodeDevkeyEnrol, escrowd's roster.rs encode_devkey_enrol)
 * signed by K itself, by two admins of distinct persons, and with the inviting admin among them. This file is K's part:
 *   - the join code's two derived values. The inviting admin's app makes a 16-byte code and keeps it; the coordinator
 *     only ever holds codeHash. At join this Mac sends K and joinTag, an HMAC under the code over org, member and K, so
 *     the inviter's own device can recompute it and refuse a K the coordinator substituted (seadmin.prepare, joinCode);
 *   - signing the enrolment bytes with this Mac's own key, after decoding them and checking they enrol THIS key, for
 *     THIS org and member: never a blob, never bytes for another key;
 *   - the request escrowd's devkeyhist_enrol op decodes (kosmos-relay coordinator/src/rosterwire.rs at sealkey-8733
 *     b874d078d): { op, org, member, key, codeHash, joinTag, inviterAdminId, nonce, sigs: [{ adminId, se | passkey }],
 *     keySig }, every byte field unpadded base64url. No generation: escrowd rebuilds the bytes at its CURRENT roster
 *     generation, so bytes signed at another one fail there. A Mac admin's entry is what seadmin.sign returns for an
 *     enrolment ({ adminId, sig }, sent as `se`), so the id is the one checked; a passkey admin's comes from the
 *     console page, already typed.
 *
 * Not here, each named so nobody reads this file as the whole flow:
 *   - where the inviter's app keeps the code between invite and join, and the screen that asks an admin to sign
 *     (seadmin.prepare and sign are the signing; the screen is the admin screen, #7892, or the console page);
 *   - sending the request: the coordinator route that relays it to escrowd (step 1's op exists; the board-facing route
 *     is asked on #7116, comment 7021307518);
 *   - the join flow calling it: nothing outside the tests calls this file yet. When escrowd refuses a signature, one
 *     possible cause is that the roster's generation moved after the bytes were signed (escrowd rebuilds them at its
 *     current one, and says only that a signature failed): the caller fetches fresh bytes and signs again (review 5). Once it keeps the code it joined with,
 *     deviceSign's joinCode should be required, not optional (review 4);
 *   - that the inviter and the signing admins are on the company's admin roster: escrowd holds the roster, this Mac
 *     does not, so escrowd checks it (and each signature under its admin's registered key).
 */

const crypto = require('node:crypto');
const se = require('./seadmin');

const CODE_LEN = 16;
const NONCE_LEN = 32;   // escrowd's rosternonce::LEN: devkeyhist_enrol refuses any other length (review 5)
const CODE_HASH_TAG = 'kosmos-join-code hash v1';
const JOIN_TAG_TAG = 'kosmos-join-code tag v1';

// put = a u32 big-endian length, then the bytes (the design's convention for these derived values).
function put(b) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(b.length);
  return Buffer.concat([len, b]);
}
const utf8 = (s) => {
  if (typeof s !== 'string') throw new Error('a text field is a string');
  return Buffer.from(s, 'utf8');
};
function code16(code) {
  if (!(code instanceof Uint8Array) || code.length !== CODE_LEN) throw new Error('a join code is 16 bytes');
  return Buffer.from(code);
}
function key32(k) {
  if (!(k instanceof Uint8Array) || k.length !== 32) throw new Error('a Mac key is 32 bytes');
  return Buffer.from(k);
}

/** A new join code, for the inviting admin's app to keep. */
function newJoinCode() { return crypto.randomBytes(CODE_LEN); }

/** code_hash = SHA-256(put("kosmos-join-code hash v1") put(code)): all the coordinator is ever given. */
function joinCodeHash(code) {
  return crypto.createHash('sha256').update(Buffer.concat([put(utf8(CODE_HASH_TAG)), put(code16(code))])).digest();
}

/** join_tag = HMAC-SHA256(code, put("kosmos-join-code tag v1") put(org) put(member) put(K)). */
function joinTag(code, org, member, k) {
  return crypto.createHmac('sha256', code16(code))
    .update(Buffer.concat([put(utf8(JOIN_TAG_TAG)), put(utf8(org)), put(utf8(member)), put(key32(k))])).digest();
}

/** Whether `code` is the one these decoded enrolment fields were made from: its hash, and the tag over org, member, K. */
function matchesJoinCode(code, decoded) {
  const c = code16(code);
  const sameHash = crypto.timingSafeEqual(joinCodeHash(c), Buffer.from(decoded.codeHash));
  const sameTag = crypto.timingSafeEqual(joinTag(c, decoded.org, decoded.member, decoded.key), Buffer.from(decoded.joinTag));
  return sameHash && sameTag;
}

/** This Mac's raw 32-byte public key, from a KeyObject (backupdevicekey's publicKey). */
function rawPublic(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') throw new Error('the device key is not an Ed25519 key');
  return Buffer.from(jwk.x, 'base64url');
}

/**
 * Sign enrolment bytes with this Mac's key. The bytes are decoded first and must enrol THIS Mac's key for the org and
 * member the caller expects; anything else refuses, so this signs nothing it was not asked to. `deviceKey` is
 * backupdevicekey.deviceKey's answer (a test passes its own). Returns { signature (64 bytes), decoded }.
 */
function deviceSign(bytes, { org, member, deviceKey, joinCode }) {
  const dk = deviceKey || require('./backupdevicekey').deviceKey();
  if (!dk || dk.ok !== true) throw new Error((dk && dk.because) || 'this computer\'s device key could not be read');
  const decoded = se.decodeDevkeyEnrol(bytes);
  if (decoded.org !== org || decoded.member !== member) throw new Error('these bytes enrol a key for a different company or member');
  const mine = rawPublic(dk.publicKey);
  if (!mine.equals(Buffer.from(decoded.key))) throw new Error('these bytes enrol a different key from this computer\'s');
  // Review 1: the member's Mac holds the code it joined with; given, it binds this signature to that invite.
  if (joinCode !== undefined && !matchesJoinCode(joinCode, decoded)) throw new Error('these bytes are not for the invite this computer joined with');
  const signature = crypto.sign(null, Buffer.from(bytes), dk.privateKey);
  if (!crypto.verify(null, Buffer.from(bytes), dk.publicKey, signature)) throw new Error('the device signature does not verify');
  return { signature, decoded };
}

/**
 * The devkeyhist_enrol request escrowd decodes, built from the decoded bytes so every field is what was signed.
 * adminSigs: two entries, distinct ids, the inviter among them: a Mac admin's as seadmin.sign returns it
 * ({ adminId, sig: DER }), or a passkey admin's already typed ({ adminId, passkey: { authenticatorData,
 * clientDataJSON, signature } }, bytes). escrowd checks persons, keys and every signature; this refuses what it can see.
 */
function request(bytes, deviceSig, adminSigs) {
  const d = se.decodeDevkeyEnrol(bytes);
  if (d.nonce.length !== NONCE_LEN) throw new Error('an enrolment\'s nonce is ' + NONCE_LEN + ' bytes, as escrowd issues it');
  if (!(deviceSig instanceof Uint8Array) || deviceSig.length !== 64) throw new Error('a device signature is 64 bytes');
  if (!Array.isArray(adminSigs) || adminSigs.length !== 2) throw new Error('an enrolment takes two admins\' signatures');
  const isBytes = (b) => b instanceof Uint8Array && b.length > 0;
  const b64 = (b) => Buffer.from(b).toString('base64url');
  const sigs = adminSigs.map((a) => {
    if (!a || typeof a.adminId !== 'string' || !a.adminId) throw new Error('each admin signature names its admin');
    if (a.passkey !== undefined && a.sig !== undefined) throw new Error('an admin signature is a Mac key\'s or a passkey\'s, not both');   // review 5
    if (a.passkey && a.sig === undefined) {
      const pk = a.passkey;
      if (![pk.authenticatorData, pk.clientDataJSON, pk.signature].every(isBytes)) throw new Error('a passkey signature is three byte fields');
      return { adminId: a.adminId, passkey: { authenticatorData: b64(pk.authenticatorData), clientDataJSON: b64(pk.clientDataJSON), signature: b64(pk.signature) } };
    }
    if (!isBytes(a.sig) || a.passkey !== undefined) throw new Error('each admin signature is bytes');   // review 2
    return { adminId: a.adminId, se: b64(a.sig) };
  });
  if (sigs[0].adminId === sigs[1].adminId) throw new Error('the two admins must be different');
  if (!sigs.some((x) => x.adminId === d.inviterAdminId)) throw new Error('the admin who sent the invite must be one of the two');
  if (!crypto.verify(null, Buffer.from(bytes), crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519',
    x: Buffer.from(d.key).toString('base64url') }, format: 'jwk' }), Buffer.from(deviceSig))) {
    throw new Error('the device signature is not by the key being enrolled');
  }
  return {
    op: 'devkeyhist_enrol', org: d.org, member: d.member, key: b64(d.key), codeHash: b64(d.codeHash), joinTag: b64(d.joinTag),
    inviterAdminId: d.inviterAdminId, nonce: b64(d.nonce), sigs, keySig: b64(deviceSig),
  };
}

module.exports = { CODE_LEN, newJoinCode, joinCodeHash, joinTag, matchesJoinCode, rawPublic, deviceSign, request };
