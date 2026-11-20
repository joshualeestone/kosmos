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
 *                                      member's keys at the time asked (kosmos#8764: the receiver asks at the
 *                                      pack's own signed takenAt, no earlier than escrowd's record of the start;
 *                                      the leaving member is the record's `from`, checkRecordSender).
 *
 * Both checks refuse with a sentence, never throw, and say whether the refusal may pass later ({ wait: true }) or never
 * will. Waiting (nothing is packed or opened meanwhile, and the caller bounds the wait): escrowd could not be asked (no
 * history), a history too old or dated ahead of this computer's clock, a signer escrowd does not list YET (an enrolment
 * the company's admins have not finished), or one enrolled a moment after this computer's clock. Final: a signature
 * that does not check, a history for another member or company or not signed by escrowd, a key escrowd lists as revoked,
 * and a key listed only as a BACKFILL entry: escrowd enrols a key once, so a backfilled key never becomes an admin-
 * enrolled one (kosmos#8768: how such a computer gets enrolled). escrowd's history key ships in
 * engine/devkeyhist.js (VERIFYING_KEY), which is the only key trusted outside a node test process.
 *
 * kosmos#8764: WHO the successor is, and which agents move, no longer come from Kosmos+ alone.
 *   checkRecord(o)                     the leaving computer, before checkSeal: escrowd's signed hand-over record
 *                                      (kosmos-relay handoverrec.rs) verifies under the same shipped key, names this
 *                                      company, this hand-over and exactly the agents asked for, and its `from` is THIS
 *                                      computer's member (this computer's own device key is valid now in escrowd's
 *                                      history for that member). It answers the successor (`to`) for checkSeal. escrowd
 *                                      signs a record only after one of the company's admins signed the start, so a
 *                                      breached Kosmos+ can no longer name another enrolled colleague as the successor.
 * The record has no expiry beyond RECORD_MAX_AGE_SECS: a hand-over can sit for days before the successor's computer
 * comes online. Its hand-over id ties it to one hand-over; what that cannot stop is stated at RECORD_MAX_AGE_SECS.
 */
const crypto = require('crypto');
const devkeyhist = require('./devkeyhist');

const SEAL_TAG = Buffer.from('kosmos-handover-seal v1');
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
const HEX32 = /^[0-9a-f]{64}$/;
const PLAIN = /^[A-Za-z0-9_-]{1,64}$/;
// devkeyhist.verify refusals that a fresh history can pass: freshness and clock, not identity.
const STALE = /too old to trust|dated in the future/;
// kosmos#8764: FROZEN with kosmos-relay handoverrec.rs RECORD_TAG; pinned to its vector in handoverseal-8764.test.js.
const RECORD_TAG = Buffer.from('kosmos-escrowd-handover-record v1');
// How old a record may be. A replay needs a record escrowd signed for an EARLIER hand-over of this same member, with that
// hand-over's own id, agents and successor, so the worst it can do is complete a hand-over an admin once approved; the
// bound keeps that window to one month.
const RECORD_MAX_AGE_SECS = 30 * 24 * 3600;
const RECORD_SKEW_SECS = 300;
const RECORD_MAX_AGENTS = 50;
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

/* The bytes escrowd signs for a record, or null when it is not one escrowd could have signed. */
function encodeRecord(r) {
  if (!r || typeof r !== 'object') return null;
  const id = (v) => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v) <= 128;
  const agents = r.agents;
  if (!id(r.org) || !id(r.id) || !id(r.from) || !id(r.to) || r.from === r.to) return null;
  if (!Array.isArray(agents) || agents.length < 1 || agents.length > RECORD_MAX_AGENTS) return null;
  if (!agents.every((a) => typeof a === 'string' && a.length > 0 && Buffer.byteLength(a) <= 64)) return null;
  if (!Number.isSafeInteger(r.issuedAt) || r.issuedAt < 0) return null;
  const count = Buffer.alloc(4); count.writeUInt32BE(agents.length);
  const at = Buffer.alloc(8); at.writeBigInt64BE(BigInt(r.issuedAt));
  return Buffer.concat([put(RECORD_TAG), put(Buffer.from(r.org)), put(Buffer.from(r.id)), put(Buffer.from(r.from)),
    put(Buffer.from(r.to)), put(count), ...agents.map((a) => put(Buffer.from(a))), put(at)]);
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

/* o: { org, id (this hand-over), agents (the names this computer was asked to pack), record (escrowd's, from /mine),
   ownHistory (escrowd's history for the record's `from`), ownKeyHex (this computer's device key, hex), now }.
   { ok: true, to } (the successor's member id, for checkSeal) or { ok: false, wait?, because }. */
/* escrowd's record, verified and read once: { ok: true, c } (a copy of its fields) or a refusal. Shared by both sides. */
function readRecord(x) {
  const r = x.record;
  if (r == null) return later('the hand-over has not been signed by one of your company\'s admins yet');
  // Read every field once, into a copy: what is verified is exactly what is used.
  const c = r && typeof r === 'object'
    ? { org: r.org, id: r.id, from: r.from, to: r.to, agents: Array.isArray(r.agents) ? r.agents.slice() : r.agents, issuedAt: r.issuedAt, signature: r.signature }
    : null;
  const msg = encodeRecord(c);
  if (!msg) return no('the hand-over record is not in the form escrowd signs');
  const anchor = devkeyhist.trustAnchor();
  if (!anchor) return no('this version of Kosmos cannot check the hand-over record');
  const sig = typeof c.signature === 'string' && /^[A-Za-z0-9_-]+$/.test(c.signature) ? Buffer.from(c.signature, 'base64url') : null;
  const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, anchor]), format: 'der', type: 'spki' });
  if (!sig || sig.length !== 64 || !crypto.verify(null, msg, key, sig)) return no('escrowd\'s signature on the hand-over record did not check');
  if (c.org !== x.org || c.id !== x.id) return no('the hand-over record is for a different hand-over');
  const asked = Array.isArray(x.agents) ? [...x.agents].sort() : null;
  const signed = [...c.agents].sort();
  if (!asked || asked.length !== signed.length || asked.some((a, i) => a !== signed[i])) return no('the agents to pack are not the ones your company\'s admin approved');
  if (!Number.isSafeInteger(x.now) || x.now < 0) return no('the hand-over record was checked against a clock that is not a time');
  if (c.issuedAt > x.now + RECORD_SKEW_SECS) return later('the hand-over record is dated ahead of this computer\'s clock');
  if (x.now - c.issuedAt > RECORD_MAX_AGE_SECS) return no('the hand-over record is too old; an admin has to start the hand-over again');
  return { ok: true, c };
}

function checkRecord(o) {
  try {
    const x = o || {};
    const rr = readRecord(x);
    if (!rr.ok) return rr;
    const c = rr.c;
    // The record's `from` must be THIS computer's member: its own device key valid now in escrowd's history for them.
    if (typeof x.ownKeyHex !== 'string' || !HEX32.test(x.ownKeyHex)) return no('this computer\'s own device key could not be read');
    if (x.ownHistory == null) return later('this computer could not be checked yet: Kosmos+ could not get its device keys from the key service');
    const h = devkeyhist.verify(x.ownHistory, { org: x.org, member: c.from, now: x.now });
    if (!h.ok) return (STALE.test(h.because) ? later : no)(`this computer could not be checked: ${h.because}`);
    if (!devkeyhist.keyAt(h.keys, x.ownKeyHex, x.now)) return no('the hand-over record is for a colleague, not for the member this computer belongs to');
    return { ok: true, to: c.to };
  } catch { return no('the hand-over record could not be checked'); }
}

/* o: { org, member (the successor's member id), id, sealPub, sig (base64url), signer (hex), history, now (Unix s) }.
   { ok: true } or { ok: false, because }. */
function checkSeal(o) {
  try {
    const x = o || {};
    const msg = sealMessage(x.id, x.sealPub);
    if (!msg) return no('the key for this hand-over is not one this computer can check');
    if (typeof x.sig !== 'string' || !/^[A-Za-z0-9_-]+$/.test(x.sig)) return no('the colleague\'s computer did not sign the key for this hand-over');
    // The signature first: it needs no history, so a forged one is refused at once, never waited on (review 5).
    const pub = publicKeyOfHex(x.signer);
    if (!pub || !crypto.verify(null, msg, pub, Buffer.from(x.sig, 'base64url'))) return no('the key for this hand-over was not signed by the colleague\'s own computer');
    if (x.history == null) return later('the colleague\'s computer could not be checked yet: Kosmos+ could not get its device keys from the key service');
    const h = devkeyhist.verify(x.history, { org: x.org, member: x.member, now: x.now });
    if (!h.ok) return (STALE.test(h.because) ? later : no)(`the colleague's computer could not be checked: ${h.because}`);
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
   have been valid, Unix s: the receiver passes the pack's own signed time, kosmos#8764), now }.
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
    // Revoked at the time asked (the pack's time): the computer was retired before it packed.
    if (at.revoked) return no('the computer that packed these agents is no longer the leaving member\'s');
    if (at.e.backfill !== false) return no('the computer that packed these agents was only carried over from before your company\'s admins enrolled computers, so it has to be enrolled again before it can hand agents over');
    return { ok: true };
  } catch { return no('the computer that packed these agents could not be checked'); }
}

/* kosmos#8764, the receiving computer: escrowd's record names who is leaving (`from`) and when an admin started it, so
   the packing key is checked against THAT member's history, never Kosmos+'s sender_member. o: { org, id, agents, record,
   now }. { ok: true, from, issuedAt } or a refusal. */
function checkRecordSender(o) {
  try {
    const rr = readRecord(o || {});
    return rr.ok ? { ok: true, from: rr.c.from, issuedAt: rr.c.issuedAt } : rr;
  } catch { return no('the hand-over record could not be checked'); }
}

module.exports = { SEAL_TAG, RECORD_TAG, RECORD_MAX_AGE_SECS, sealMessage, signSeal, checkSeal, checkSender, keyHex, encodeRecord, checkRecord, checkRecordSender };
