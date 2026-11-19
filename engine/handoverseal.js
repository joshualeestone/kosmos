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
 *                                      signer is one of that member's keys valid now (keyAt), enrolled by two admins
 *                                      (not a backfill entry, which is the coordinator's word), and the signature holds.
 *   checkSender(o)                     the receiving computer, before it opens: the packing key is one of the LEAVING
 *                                      member's keys at the time asked (the receiver passes now until kosmos#8764
                                      gives a signed pack time).
 *
 * Both checks refuse with a sentence, never throw, and say whether the refusal may pass later ({ wait: true }) or never
 * will. Waiting (nothing is packed or opened meanwhile, and the caller bounds the wait): escrowd could not be asked (no
 * history), a history too old or dated ahead of this computer's clock, a signer escrowd does not list YET (an enrolment
 * the company's admins have not finished), or one enrolled a moment after this computer's clock. Final: a signature
 * that does not check, a history for another member or company or not signed by escrowd, a key escrowd lists as revoked,
 * and a key listed only as a BACKFILL entry: escrowd enrols a key once, so a backfilled key never becomes an admin-
 * enrolled one (kosmos#8768: how such a computer gets enrolled). escrowd's history key ships in
 * engine/devkeyhist.js (VERIFYING_KEY), which is the only key trusted outside a node test process.
 */
const crypto = require('crypto');
const devkeyhist = require('./devkeyhist');

const SEAL_TAG = Buffer.from('kosmos-handover-seal v1');
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
const HEX32 = /^[0-9a-f]{64}$/;
const PLAIN = /^[A-Za-z0-9_-]{1,64}$/;
// devkeyhist.verify refusals that a fresh history can pass: freshness and clock, not identity.
const STALE = /too old to trust|dated in the future/;
const no = (because) => ({ ok: false, because });
const later = (because) => ({ ok: false, wait: true, because });
/* The key's entry valid at t, or why not: { e } | { absent: true } (escrowd does not list it at all, or lists it from a
   moment after t: both may pass later) | { revoked: true } (listed, and its validity ended at or before t). */
function entryAt(keys, hex, t) {
  const e = devkeyhist.keyAt(keys, hex, t);
  if (e) return { e };
  const listed = Array.isArray(keys) ? keys.filter((k) => k && k.key === hex) : [];
  return listed.some((k) => k.until !== null && t >= k.until) ? { revoked: true } : { absent: true };
}

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
    if (!msg) return no('the key for this hand-over is not one this computer can check');
    if (typeof x.sig !== 'string' || !/^[A-Za-z0-9_-]+$/.test(x.sig)) return no('the colleague\'s computer did not sign the key for this hand-over');
    if (x.history == null) return later('the colleague\'s computer could not be checked yet: Kosmos+ could not get its device keys from the key service');
    const h = devkeyhist.verify(x.history, { org: x.org, member: x.member, now: x.now });
    if (!h.ok) return (STALE.test(h.because) ? later : no)(`the colleague's computer could not be checked: ${h.because}`);
    const pub = publicKeyOfHex(x.signer);
    if (!pub || !crypto.verify(null, msg, pub, Buffer.from(x.sig, 'base64url'))) return no('the key for this hand-over was not signed by the colleague\'s own computer');
    const at = entryAt(h.keys, x.signer, x.now);
    // Absent may be an enrolment not finished, or a key that never came from the colleague's computer: say both.
    if (at.absent) return later('the colleague\'s computer has not been enrolled by your company\'s admins yet, or the key for this hand-over did not come from it');
    if (at.revoked) return no('the key for this hand-over was signed by a computer that is no longer the colleague\'s');
    // A backfilled entry is the coordinator's word at the switch-over: never enough to seal a member's work to, and
    // never upgraded (escrowd enrols a key once), so final.
    if (at.e.backfill !== false) return no('the colleague\'s computer was only carried over from before your company\'s admins enrolled computers, so it has to be enrolled again before it can take a hand-over');
    return { ok: true };
  } catch { return no('the key for this hand-over could not be checked'); }
}

/* o: { org, member (the leaving member's id), senderPub (an Ed25519 public KeyObject), history, at (when the key must
   have been valid, Unix s: the receiver passes now until kosmos#8764 gives a signed pack time), now }.
   { ok: true } or { ok: false, wait?, because }. */
function checkSender(o) {
  try {
    const x = o || {};
    const hex = keyHex(x.senderPub);
    if (!hex) return no('the computer that packed these agents is not known');
    if (x.history == null) return later('the computer that packed these agents could not be checked yet: Kosmos+ could not get its device keys from the key service');
    const h = devkeyhist.verify(x.history, { org: x.org, member: x.member, now: x.now });
    if (!h.ok) return (STALE.test(h.because) ? later : no)(`the computer that packed these agents could not be checked: ${h.because}`);
    const at = entryAt(h.keys, hex, x.at);
    if (at.absent) return later('the computer that packed these agents has not been enrolled by your company\'s admins yet, or the pack did not come from the leaving member\'s computer');
    if (at.revoked) return no('the pack was not signed by the leaving member\'s own computer');
    if (at.e.backfill !== false) return no('the computer that packed these agents was only carried over from before your company\'s admins enrolled computers, so it has to be enrolled again before it can hand agents over');
    return { ok: true };
  } catch { return no('the computer that packed these agents could not be checked'); }
}

module.exports = { SEAL_TAG, sealMessage, signSeal, checkSeal, checkSender, keyHex };
