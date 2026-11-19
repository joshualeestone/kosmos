'use strict';
/**
 * kosmos#8733: tie a hand-over's one-time key to the successor's computer, and the pack's signer to the leaving
 * member's computer, through escrowd's signed device-key history rather than the coordinator's word.
 *
 * Without this, the leaving computer seals the pack to whatever one-time key Kosmos+ relays (seal_pub), and the
 * receiving computer opens a pack signed by whatever key Kosmos+ names (sender_pubkey). A breached coordinator could
 * swap in keys of its own and read, or forge, a member's agents.
 *
 *   signSeal(id, sealPub, deviceKey)   the receiving computer, at /key: its device key signs SEAL_TAG, the hand-over id
 *                                      and the one-time public key (length-prefixed, so no two inputs share bytes).
 *   checkSeal(o)                       the leaving computer, before it packs: escrowd's history for the SUCCESSOR
 *                                      verifies (devkeyhist.verify, which trusts only escrowd's shipped key), the
 *                                      signer is one of that member's keys valid now (keyAt), and the signature holds.
 *   checkSender(o)                     the receiving computer, before it opens: the packing key is one of the LEAVING
 *                                      member's keys at the time the pack was granted.
 *
 * Both checks refuse with a sentence, never throw. They refuse every history until escrowd's history key ships in
 * engine/devkeyhist.js (VERIFYING_KEY, #7116): a hand-over then fails closed, said, rather than trusting the coordinator.
 */
const crypto = require('crypto');
const devkeyhist = require('./devkeyhist');

const SEAL_TAG = Buffer.from('kosmos-handover-seal v1');
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
const HEX32 = /^[0-9a-f]{64}$/;
const PLAIN = /^[A-Za-z0-9_-]{1,64}$/;

function put(b) { const n = Buffer.alloc(4); n.writeUInt32BE(b.length); return Buffer.concat([n, b]); }
/* The signed message: the tag, the hand-over id and the one-time public key's raw 32 bytes. null for an unusable input. */
function sealMessage(id, sealPub) {
  if (typeof id !== 'string' || !PLAIN.test(id) || typeof sealPub !== 'string') return null;
  const pk = Buffer.from(sealPub, 'base64');
  if (pk.length !== 32 || pk.toString('base64') !== sealPub) return null;
  return Buffer.concat([put(SEAL_TAG), put(Buffer.from(id)), put(pk)]);
}

/* base64url of the signature, or null. deviceKey: an Ed25519 private KeyObject (backupdevicekey.deviceKey().privateKey). */
function signSeal(id, sealPub, deviceKey) {
  const msg = sealMessage(id, sealPub);
  if (!msg || !deviceKey || deviceKey.type !== 'private' || deviceKey.asymmetricKeyType !== 'ed25519') return null;
  try { return crypto.sign(null, msg, deviceKey).toString('base64url'); } catch { return null; }
}

/* The hex of an Ed25519 public KeyObject's raw 32 bytes (as devkeyhist holds keys), or null. */
function keyHex(publicKey) {
  try { const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32); return raw.length === 32 ? raw.toString('hex') : null; } catch { return null; }
}
function publicKeyOfHex(hex) {
  if (typeof hex !== 'string' || !HEX32.test(hex)) return null;
  try { return crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' }); } catch { return null; }
}

/* o: { org, member (the successor's member id), id, sealPub, sig (base64url), signer (hex), history, now (Unix s) }.
   { ok: true } or { ok: false, because }. */
function checkSeal(o) {
  try {
    const x = o || {};
    const msg = sealMessage(x.id, x.sealPub);
    if (!msg) return { ok: false, because: 'the key for this hand-over is not one this computer can check' };
    if (typeof x.sig !== 'string' || !/^[A-Za-z0-9_-]+$/.test(x.sig)) return { ok: false, because: 'the colleague\'s computer did not sign the key for this hand-over' };
    const h = devkeyhist.verify(x.history, { org: x.org, member: x.member, now: x.now });
    if (!h.ok) return { ok: false, because: `the colleague's computer could not be checked: ${h.because}` };
    if (!devkeyhist.keyAt(h.keys, x.signer, x.now)) return { ok: false, because: 'the key for this hand-over was not signed by the colleague\'s own computer' };
    const pub = publicKeyOfHex(x.signer);
    if (!pub || !crypto.verify(null, msg, pub, Buffer.from(x.sig, 'base64url'))) return { ok: false, because: 'the key for this hand-over was not signed by the colleague\'s own computer' };
    return { ok: true };
  } catch { return { ok: false, because: 'the key for this hand-over could not be checked' }; }
}

/* o: { org, member (the leaving member's id), senderPub (an Ed25519 public KeyObject), history, at (the pack's grant
   time, Unix s), now }. { ok: true } or { ok: false, because }. */
function checkSender(o) {
  try {
    const x = o || {};
    const hex = keyHex(x.senderPub);
    if (!hex) return { ok: false, because: 'the computer that packed these agents is not known' };
    const h = devkeyhist.verify(x.history, { org: x.org, member: x.member, now: x.now });
    if (!h.ok) return { ok: false, because: `the computer that packed these agents could not be checked: ${h.because}` };
    if (!devkeyhist.keyAt(h.keys, hex, x.at)) return { ok: false, because: 'the pack was not signed by the leaving member\'s own computer' };
    return { ok: true };
  } catch { return { ok: false, because: 'the computer that packed these agents could not be checked' }; }
}

module.exports = { SEAL_TAG, sealMessage, signSeal, checkSeal, checkSender, keyHex };
