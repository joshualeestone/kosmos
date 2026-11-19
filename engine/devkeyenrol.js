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
 *   - the submission, in the shape Kitty pinned: { org, member, key (hex), code_hash, join_tag, inviter_admin_id,
 *     generation, nonce, device_sig, admin_sigs: [{ admin_id, sig }] }.
 *
 * Not here, each named so nobody reads this file as the whole flow:
 *   - where the inviter's app keeps the code between invite and join, and the screen that asks an admin to sign
 *     (seadmin.prepare and sign are the signing; the screen is the admin screen, #7892, or the console page);
 *   - sending the submission: escrowd's op and its coordinator route are step 1 (Kitty), not built when this was;
 *   - the join flow calling it: nothing outside the tests calls this file yet.
 */

const crypto = require('node:crypto');
const se = require('./seadmin');

const CODE_LEN = 16;
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
function deviceSign(bytes, { org, member, deviceKey }) {
  const dk = deviceKey || require('./backupdevicekey').deviceKey();
  if (!dk || dk.ok !== true) throw new Error((dk && dk.because) || 'this computer\'s device key could not be read');
  const decoded = se.decodeDevkeyEnrol(bytes);
  if (decoded.org !== org || decoded.member !== member) throw new Error('these bytes enrol a key for a different company or member');
  const mine = rawPublic(dk.publicKey);
  if (!mine.equals(Buffer.from(decoded.key))) throw new Error('these bytes enrol a different key from this computer\'s');
  const signature = crypto.sign(null, Buffer.from(bytes), dk.privateKey);
  if (!crypto.verify(null, Buffer.from(bytes), dk.publicKey, signature)) throw new Error('the device signature does not verify');
  return { signature, decoded };
}

/**
 * The submission for the coordinator to relay to escrowd, in the shape Kitty pinned. Built from the decoded bytes, so
 * every field is what was signed. adminSigs: [{ adminId, sig (DER bytes) }], two of them, distinct ids, the inviter
 * among them (escrowd checks persons and keys; this refuses only what it can see).
 */
function submission(bytes, deviceSig, adminSigs) {
  const d = se.decodeDevkeyEnrol(bytes);
  if (!(deviceSig instanceof Uint8Array) || deviceSig.length !== 64) throw new Error('a device signature is 64 bytes');
  if (!Array.isArray(adminSigs) || adminSigs.length !== 2) throw new Error('an enrolment takes two admins\' signatures');
  const ids = adminSigs.map((a) => a && a.adminId);
  if (ids.some((x) => typeof x !== 'string' || !x) || ids[0] === ids[1]) throw new Error('the two admins must be different');
  if (!ids.includes(d.inviterAdminId)) throw new Error('the admin who sent the invite must be one of the two');
  if (!crypto.verify(null, Buffer.from(bytes), crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519',
    x: Buffer.from(d.key).toString('base64url') }, format: 'jwk' }), Buffer.from(deviceSig))) {
    throw new Error('the device signature is not by the key being enrolled');
  }
  const hex = (b) => Buffer.from(b).toString('hex');
  return {
    org: d.org, member: d.member, key: hex(d.key), code_hash: hex(d.codeHash), join_tag: hex(d.joinTag),
    inviter_admin_id: d.inviterAdminId, generation: d.generation.toString(), nonce: hex(d.nonce),
    device_sig: hex(deviceSig), admin_sigs: adminSigs.map((a) => ({ admin_id: a.adminId, sig: hex(a.sig) })),
  };
}

module.exports = { CODE_LEN, newJoinCode, joinCodeHash, joinTag, matchesJoinCode, rawPublic, deviceSign, submission };
