/**
 * kosmos#5536 (E0.7) design v2 / v2.1: the signed restore request. A release of a member's backup needs an
 * immutable request signed by two different admins' enrolled device keys, checked by the unwrap service (which is
 * separate from the coordinator and keeps its own admin roster), never by coordinator rows.
 *
 * This module is the reference for that record: its canonical bytes, how an admin's board signs them, and the
 * checks the unwrap service makes before it re-seals a member key. Pure except for the store the caller injects:
 * the caller supplies the roster, its own clock, its first-sight store, its wait policy, and its answers. Its fixed test vectors pin
 * the bytes for any other implementation of the service.
 *
 * What the caller still owns, and must not skip: in ONE atomic step at release, re-reading cancellation and
 * consuming the nonce (a cancellation recorded between checkRelease and the re-seal must still stop it); checking
 * that the epochs and snapshots belong to that member in that org before re-sealing them; recording first sight
 * by requestId (recordSeen is the reference) and showing the member the request then (the member can see it and,
 * by design, cannot block it); recording cancellations and authenticating who may cancel (an admin or the security
 * contact; a forged cancel can only block a release, never cause one); saying which destinations it trusts for a member; the
 * quarterly break-glass limit; and the re-seal. "Two different admins" here means two roster ids with two keys:
 * one person with two enrolled devices counts twice unless the roster allows one key per person (v2.1 item 1).
 * The whole wait rests on this service's clock: keeping it honest is the caller's too. Only instances on a trusted
 * clock may write first sights: one running slow records an early first sight and shortens every instance's wait.
 * checkRelease throws on a caller mistake (a bad policy, a missing store or callback) and passes on a throw from the
 * caller's own callbacks; treat any throw as a refusal. Signatures are bytes (Buffer or Uint8Array): decode hex or
 * base64 from JSON first, or a good signature reads as one that does not verify. The security contact must differ
 * from both signers by id and by key, and may not be a rostered admin at all; like the signers, one person
 * with a second enrolled device as contact passes unless the roster allows one key per person. The wait policy is
 * read at release, so lowering it shortens waits already running: it must come from this service's own config,
 * which the signing admins cannot write. A destination is the sha256 (hex) of the destination's raw 32-byte HPKE
 * public key; every implementation must fingerprint the same bytes for destinationAllowed to mean the same thing.
 *
 * A requirement on everything else an admin's device key signs (E0.1/E0.2 device auth above all): it must carry its
 * own domain tag and never sign raw bytes another party chose. A challenge that begins 'kosmos-restore-request v1'
 * would otherwise collect an approval signature.
 */
const crypto = require('crypto');
const { canonicalJson } = require('./backupformat');

const DOMAIN = Buffer.from('kosmos-restore-request v1\n');
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const NONCE_RE = /^[0-9a-f]{32}$/;
const HOUR = 3600;
const RELEASE_WINDOW = 7 * 24 * HOUR;
const MAX_WAIT = 168 * HOUR;
const MAX_LIST = 1000;

/* Ids are compared byte for byte ('E1' and 'e1' are two ids; 'ALL' is not the wildcard). A list of ids in strictly
   ascending order: no repeats, and one release has one spelling (so one requestId). Holes
   are not caught here (every skips them): canonicalJson, which every path runs, refuses them. */
const ids = (v) => Array.isArray(v) && v.length > 0 && v.length <= MAX_LIST && v.every((x) => typeof x === 'string' && ID_RE.test(x))
  && v.every((x, i) => i === 0 || v[i - 1] < x);

/* Why input is not a well-formed request, or null. Unknown fields are refused, so nothing unsigned rides along, and
   only the record's own fields are read, so nothing inherited (a polluted prototype) is checked but left unsigned. */
function shapeProblem(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'not a record';
  const allowed = ['v', 'org', 'unwrap', 'member', 'destination', 'epochs', 'snapshots', 'waitEndsAt', 'requester', 'approver', 'breakGlass', 'contact', 'nonce'];
  for (const k of Object.keys(input)) if (!allowed.includes(k)) return `unknown field ${k}`;
  const req = Object.create(null);  // no prototype, so nothing inherited can appear in it
  for (const k of allowed) if (Object.hasOwn(input, k)) req[k] = input[k];
  if (req.v !== 1) return 'unknown version';
  for (const k of ['org', 'unwrap', 'member', 'requester', 'approver']) if (typeof req[k] !== 'string' || !ID_RE.test(req[k])) return `bad ${k}`;
  if (typeof req.destination !== 'string' || !HEX64_RE.test(req.destination)) return 'bad destination';
  if (!ids(req.epochs)) return 'bad epochs';
  // 'all' or named ids, never implied; 'all' is reserved, so a list cannot hold an id that reads as the wildcard.
  if (req.snapshots !== 'all' && (!ids(req.snapshots) || req.snapshots.includes('all'))) return 'bad snapshots';
  if (!Number.isSafeInteger(req.waitEndsAt) || req.waitEndsAt <= 0) return 'bad waitEndsAt';
  if (typeof req.breakGlass !== 'boolean') return 'bad breakGlass';
  if (req.breakGlass ? typeof req.contact !== 'string' || !ID_RE.test(req.contact) : Object.hasOwn(req, 'contact')) return 'bad contact';
  if (typeof req.nonce !== 'string' || !NONCE_RE.test(req.nonce)) return 'bad nonce';
  return null;
}

/** The bytes every signer signs. Throws on a malformed request. The input is read once, into a plain copy. */
function requestBytes(input) {
  let req;
  try { req = JSON.parse(canonicalJson(input)); } catch (e) { throw new Error(`restorerequest: not a plain record (${e.message})`); }
  const problem = shapeProblem(req);
  if (problem) throw new Error(`restorerequest: ${problem}`);
  return Buffer.concat([DOMAIN, Buffer.from(canonicalJson(req))]);
}

/** The request's id: sha256 of its signed bytes, hex. The service keys first-seen time and cancellation by it. */
function requestId(req) {
  return crypto.createHash('sha256').update(requestBytes(req)).digest('hex');
}

/** An admin's (or the security contact's) Ed25519 signature over the request. */
function signRequest(req, privateKey) {
  if (!privateKey || privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') throw new Error('restorerequest: an Ed25519 private key signs');
  return crypto.sign(null, requestBytes(req), privateKey);
}

const verifies = (bytes, pub, sig) => {
  try {
    return pub && pub.type === 'public' && pub.asymmetricKeyType === 'ed25519' && Object.prototype.toString.call(sig) === '[object Uint8Array]' && sig.byteLength === 64
      && crypto.verify(null, bytes, pub, sig);
  } catch { return false; }
};

/* The checks first sight and release share. The record must be well formed and for this service. It is copied into
   a plain record, checked again, and that copy is what gets verified and returned, so a field cannot read one way for
   the signature and another for the result. It must be signed by two different rostered
   admins, and for break-glass by the roster's security contact as a third person. { req } or { why }. */
function signedRecord(input, signatures, service, roster) {
  const no = (why) => ({ why });
  let req, bytes;
  try {
    const problem = shapeProblem(input);
    if (problem) return no(`malformed request: ${problem}`);
    req = JSON.parse(canonicalJson(input));
    bytes = requestBytes(req);
  } catch (e) { return no(`malformed request: ${e.message}`); }
  if (req.org !== service.org || req.unwrap !== service.unwrap) return no('the request is for another org or unwrap service');
  if (req.requester === req.approver) return no('one admin cannot both request and approve');
  let sigs;
  try { sigs = { requester: signatures?.requester, approver: signatures?.approver, contact: signatures?.contact }; } catch { return no('the signatures could not be read'); }
  const keys = {};
  for (const role of ['requester', 'approver']) {
    const pub = roster.admins.get(req[role]);
    if (!pub) return no(`the ${role} is not an admin on this service's roster`);
    if (!verifies(bytes, pub, sigs[role])) return no(`the ${role}'s signature does not verify`);
    keys[role] = pub;
  }
  // Two ids are not two people when the roster maps them to one key. (equals runs only after both keys verified a
  // signature, so a roster value that merely looks like a key never reaches it.)
  if (keys.requester.equals(keys.approver)) return no('the requester and approver ids share one key');
  if (req.breakGlass) {
    const c = roster.contact;
    if (!c || req.contact !== c.id) return no('break-glass needs the org security contact named on this service\'s roster');
    if (!(c.pub instanceof crypto.KeyObject) || c.pub.type !== 'public') return no('the roster\'s security contact has no public key');
    if (c.id === req.requester || c.id === req.approver || c.pub.equals(keys.requester) || c.pub.equals(keys.approver)) {
      return no('the security contact must be a third person');
    }
    // A third PERSON, not a third admin (design v2.1: two admins alone cannot break glass): the contact may not be
    // a rostered admin, by id or by key.
    if (roster.admins.has(c.id) || [...roster.admins.values()].some((k) => k instanceof crypto.KeyObject && c.pub.equals(k))) {
      return no('the security contact may not also be an admin');
    }
    if (!verifies(bytes, c.pub, sigs.contact)) return no('the security contact\'s signature does not verify');
  }
  return { req };
}

/* The request's waitEndsAt against when this service first saw it (fully signed), shared by first sight and
   release. The request builder sets waitEndsAt to creation + the policy wait; the wait that counts runs from first
   sight anyway. waitEndsAt may be at most 168 h, the longest any policy allows (plus an hour for clocks), after first sight, and a
   request first seen more than 7 days after it carries signatures held back too long: the approver has until then. */
function timeProblem(req, seenAt) {
  if (req.waitEndsAt > seenAt + MAX_WAIT + HOUR) return 'the request\'s wait is longer than any policy allows';
  if (seenAt > req.waitEndsAt + RELEASE_WINDOW) return 'the request was signed long before this service saw it';
  return null;
}

/**
 * The unwrap service's check before it releases. Returns { ok: true, id, member, destination, epochs, snapshots
 * ('all' or ids), nonce, breakGlass, requester, approver, contact } (consume the nonce atomically, then re-seal only
 * to that destination; count and audit from these fields, never from the input), or { ok: false, why }.
 *
 *   service: { org, unwrap } this service's own ids.
 *   roster:  { admins: Map(adminId -> Ed25519 public KeyObject), contact: { id, pub } } this service's own roster.
 *   policy:  { waitSeconds (24 to 168 hours), breakGlassWaitSeconds (at least 4 hours, no longer than waitSeconds) }.
 *   now: seconds on this service's clock.
 *   seen: the first-sight store recordSeen writes (get by requestId). checkRelease reads it itself and refuses a
 *     request this service never recorded. The store must
 *     be durable and this service's own: lost, every wait restarts; written by anyone else, the wait is theirs.
 *     Keep first sights, used nonces and cancellations at least 22 days after first sight: a request opens at most
 *     14 days after it (a notice up to 7 days late, then the longest wait) and can release for 7 days after that,
 *     and a purged cancellation reads as none. A cancellation
 *     made before first sight has no first sight to count from: keep it until 7 days and an hour past the request's
 *     waitEndsAt, after which first sight refuses the request as stale anyway.
 *   nonceUsed(nonce) -> boolean.
 *   isCancelled(requestId) -> boolean: a request cancelled during its wait (by an admin or the security contact)
 *     is never released.
 *   noticeSentAt(requestId) -> whole seconds when the member was shown the request, or anything else (null) if not
 *     yet; for an offboarded member, whom the design does not notify, the caller returns the first-sight time. Who
 *     is offboarded must come from this service's own records, never coordinator rows or anything an admin can write,
 *     or two admins could mark a member offboarded to skip the notice. The
 *     wait runs from the later of first sight and the notice, so a lost or late notice delays the release.
 *   destinationAllowed(fingerprint, member) -> boolean: whether this service trusts that destination for that
 *     member (a successor's enrolled board, an org export key). The list must not be writable by the signing admins:
 *     if they can enrol a board as a member's successor, they can name a key of their own. One service
 *     serves one org (service.org), so the org is implied.
 */
function checkRelease({ req: input, signatures, service, roster, policy, now, seen, nonceUsed, isCancelled, destinationAllowed, noticeSentAt }) {
  if (!service || !roster || !(roster.admins instanceof Map) || !policy || typeof nonceUsed !== 'function' || typeof isCancelled !== 'function'
    || typeof destinationAllowed !== 'function' || typeof noticeSentAt !== 'function' || !seen || typeof seen.get !== 'function') {
    throw new Error('restorerequest: service, roster, policy, seen, nonceUsed, isCancelled, destinationAllowed and noticeSentAt are required');
  }
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('restorerequest: now is whole seconds');
  const { waitSeconds, breakGlassWaitSeconds } = policy;
  if (!Number.isSafeInteger(waitSeconds) || waitSeconds < 24 * HOUR || waitSeconds > MAX_WAIT) throw new Error('restorerequest: waitSeconds must be 24 to 168 hours');
  if (!Number.isSafeInteger(breakGlassWaitSeconds) || breakGlassWaitSeconds < 4 * HOUR || breakGlassWaitSeconds > waitSeconds) {
    throw new Error('restorerequest: breakGlassWaitSeconds must be at least 4 hours and no longer than waitSeconds');
  }

  const no = (why) => ({ ok: false, why });
  const signed = signedRecord(input, signatures, service, roster);
  if (signed.why) return no(signed.why);
  const { req } = signed;
  const id = requestId(req);
  const seenAt = seen.get(id);
  if (seenAt === undefined) return no('this service never recorded the request (recordSeen first)');
  if (!Number.isSafeInteger(seenAt) || seenAt <= 0) return no('could not read when this request was first seen');
  if (seenAt > now) return no('the wait has not ended (this service\'s clocks disagree: first sight is later than now)');
  const wait = req.breakGlass ? breakGlassWaitSeconds : waitSeconds;
  const late = timeProblem(req, seenAt);
  if (late) return no(late);
  // The wait runs from the later of first sight and the member's notice, so a notice that went out late still
  // leaves the member (and anyone who can cancel) the full wait.
  const noticeAt = noticeSentAt(id);
  if (!Number.isSafeInteger(noticeAt) || noticeAt <= 0 || noticeAt > now) return no('the member has not been shown the request');
  // A notice more than 7 days after first sight would push the release past what the service keeps (see seen).
  if (noticeAt > seenAt + RELEASE_WINDOW) return no('the member was shown the request too late; make a new request');
  const opensAt = Math.max(req.waitEndsAt, seenAt + wait, noticeAt + wait);
  if (now < opensAt) return no('the wait has not ended');
  if (now > opensAt + RELEASE_WINDOW) return no('the request expired (7 days after its wait)');
  // The three answers must be exact booleans: a Promise, undefined or a lookup result is not an answer, so it refuses.
  if (destinationAllowed(req.destination, req.member) !== true) return no('the destination is not one this service trusts for this member');
  const cancelled = isCancelled(id);
  if (cancelled !== false) return no(cancelled === true ? 'the request was cancelled' : 'could not confirm the request is not cancelled');
  const used = nonceUsed(req.nonce);
  if (used !== false) return no(used === true ? 'the request was already used' : 'could not confirm the request is unused');
  // Everything the caller acts on comes from the verified copy: who signed (the audit trail) and whether this was
  // break-glass (the quarterly limit), as well as what to release.
  return { ok: true, id, member: req.member, destination: req.destination, epochs: req.epochs, snapshots: req.snapshots, nonce: req.nonce,
    breakGlass: req.breakGlass, requester: req.requester, approver: req.approver, contact: req.breakGlass ? req.contact : null };
}

/**
 * The reference for recording first sight, which starts the wait and the member's notice. It records only a fully
 * signed request (the same signer checks as release), so a wait cannot run before the approval exists. seen is a
 * store keyed by requestId with get(id) and setIfAbsent(id, value) -> true when this call stored it, false when a
 * value was already there. setIfAbsent must be atomic: two service instances racing on one request then agree on
 * one first sight, and only one of them sends the notice. Keyed by anything but requestId, a
 * second request could inherit a wait.
 * A used nonce is not checked here (checkRelease refuses it), so a request re-signed under a spent nonce can still
 * be recorded and notified.
 * Returns { ok: true, seenAt, first } (first is true when this call recorded it: show the member the request then)
 * or { ok: false, why }. seen.get must return undefined for never seen or the recorded whole seconds; anything else
 * (a Promise from an async store, say) refuses, so await the store before calling.
 */
function recordSeen(seen, { req, signatures, service, roster, now, isCancelled, destinationAllowed }) {
  if (!seen || typeof seen.get !== 'function' || typeof seen.setIfAbsent !== 'function') throw new Error('restorerequest: seen must be a store with get and setIfAbsent');
  if (!service || !roster || !(roster.admins instanceof Map) || typeof isCancelled !== 'function' || typeof destinationAllowed !== 'function') {
    throw new Error('restorerequest: service, roster, isCancelled and destinationAllowed are required');
  }
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('restorerequest: now is whole seconds');
  const signed = signedRecord(req, signatures, service, roster);
  if (signed.why) return { ok: false, why: signed.why };
  const id = requestId(signed.req);
  // A request cancelled before first sight, or naming a destination this service does not trust, is never recorded,
  // so the member is not told of a request that cannot release.
  if (destinationAllowed(signed.req.destination, signed.req.member) !== true) return { ok: false, why: 'the destination is not one this service trusts for this member' };
  const cancelled = isCancelled(id);
  if (cancelled !== false) return { ok: false, why: cancelled === true ? 'the request was cancelled' : 'could not confirm the request is not cancelled' };
  const at = seen.get(id);
  if (Number.isSafeInteger(at) && at > 0) return { ok: true, seenAt: at, first: false };
  // Only an exact undefined means never seen: a Promise or a string from a store would otherwise overwrite the first
  // sight with now, pushing the wait forward on every relay.
  if (at !== undefined) return { ok: false, why: 'could not read when this request was first seen' };
  const late = timeProblem(signed.req, now);
  if (late) return { ok: false, why: late };  // never recorded, so the member is not told of a request too stale or too long to release
  const inserted = seen.setIfAbsent(id, now);
  if (inserted === true) return { ok: true, seenAt: now, first: true };
  if (inserted !== false) return { ok: false, why: 'could not record when this request was first seen' };
  const winner = seen.get(id);  // another instance recorded it first, and its time stands
  if (!Number.isSafeInteger(winner) || winner <= 0) return { ok: false, why: 'could not read when this request was first seen' };
  return { ok: true, seenAt: winner, first: false };
}

module.exports = {
  requestBytes,
  requestId,
  signRequest,
  checkRelease,
  recordSeen,
};
