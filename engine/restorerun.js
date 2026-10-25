'use strict';
/**
 * kosmos#5536 (E0.7, restore) slice 1: ONE snapshot restored onto this computer, composed from the reviewed parts.
 * Design: #5536 comment 6399924599. Every source is injected, so this is tested against fakes now and wired to the
 * real routes later (the read grants, kosmos#5686 c, through engine/restorefetch.js; the device-key history, kosmos#7116).
 *
 *   engine/backupkeys.js     the member key, opened from the release's wrap with this computer's destination key
 *   engine/devkeyhist.js     the device-key history escrowd signs, and which key was valid when
 *   engine/backupformat.js   the manifest, opened only under that key and the full context
 *   engine/backuprestore.js  the files, each verified per chunk and per file against the device-signed manifest
 *   engine/restoresink.js    (the caller's sink) a fresh, private folder the person chose
 *
 * The time that picks the device key is the coordinator's record of when the manifest was granted, NEVER the time
 * inside the snapshot id: an attacker with a retired device key could seal a manifest to the member's PUBLIC key,
 * sign it, and date its id inside that key's window. With an honest coordinator, granted_at alone decides the key.
 * The id's own time is then only a CONSISTENCY check (review 1): a holder of a retired key writes any id time it
 * likes, so the check is no barrier to it, and it is kept wide (SNAPSHOT_TO_GRANT_SECS, plus a clock allowance) so a
 * genuine backup (a Mac clock a little fast, a long first upload, a run across Monday 00:00) is never refused.
 * Residuals, stated: a breached coordinator can move granted_at (the one #7116's two-admin enrolment and the
 * person-confirmed fingerprint address), and it can HIDE snapshots from the list (it cannot relabel one).
 *
 * Snapshots are labelled by the time inside their id, never by the coordinator's granted_at (#7118's correction): the
 * id's time is device-signed and so authentic once the manifest opens; until then it is shown as claimed.
 */
const crypto = require('crypto');
const { unwrapMemberKey } = require('./backupkeys');
const { openManifest } = require('./backupformat');
const { restoreSnapshot } = require('./backuprestore');
const devkeyhist = require('./devkeyhist');

// How far before its grant a snapshot's own time may be (a consistency bound, not a security one; see the header). A
// first upload of a large work Kosmos over a slow link can take many hours, and a manifest may be granted up to a
// period after its chunks (the last-day rule), so this is a period and a day. After the grant: only a clock allowance,
// since the id is made before anything is granted but on the Mac's clock, not the coordinator's.
const SNAPSHOT_TO_GRANT_SECS = 8 * 86400;
const CLOCK_SKEW_SECS = 300;   // as engine/devkeyhist.js
const FETCH_TIMEOUT_MS = 120000;   // one stored object; backuprestore leaves bounding fetches to its caller
const SNAPSHOT_ID_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-[0-9a-f]{8}$/;
const MAX_MANIFEST_OBJECT = 64 * 1024 * 1024;   // the coordinator's own ceiling for one manifest (backup.rs)
const KEY_HEX_RE = /^[0-9a-f]{64}$/;
const MAX_LISTED = 5000;   // more than the coordinator lists (3,000)
// The fixed DER prefix of an Ed25519 public key (SPKI), so a raw 32-byte key becomes a KeyObject.
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

/* The time inside a snapshot id (engine/backuprun.js newSnapshotId: the UTC time, then 4 random bytes), in Unix
   seconds, or null for anything else. */
function snapshotTimeOf(id) {
  const m = typeof id === 'string' ? SNAPSHOT_ID_RE.exec(id) : null;
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const d = new Date(ms);
  // A date that rolled over (month 13, second 61) is not the time the Mac wrote.
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3] || d.getUTCHours() !== +m[4]
    || d.getUTCMinutes() !== +m[5] || d.getUTCSeconds() !== +m[6]) return null;
  return Math.floor(ms / 1000);
}

/* A destination for one restore: a fresh X25519 key pair made here, named by the sha256 of its raw public key (the
   fingerprint engine/restorerequest.js puts in a signed request). The private half never leaves this object.
   open(wrap, ctx, verifiedMemberPk) is backupkeys.unwrapMemberKey with that private half: the member key, or null. */
function newDestination() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const publicRaw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  let secret = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  return {
    publicKey: Buffer.from(publicRaw),
    fingerprint: crypto.createHash('sha256').update(publicRaw).digest('hex'),
    open(wrap, ctx, verifiedMemberPk) {
      if (!secret) return null;
      return unwrapMemberKey(secret, wrap, ctx, verifiedMemberPk);
    },
    forget() { if (secret) secret.fill(0); secret = null; },
  };
}

/* The recorded manifests as a person picks from them: one row each, oldest first by the time inside its id (claimed
   until opened), never "latest". A row the restore would refuse says why, so it is shown, not hidden. */
function listSnapshots(manifests) {
  return (Array.isArray(manifests) ? manifests.slice(0, MAX_LISTED) : []).map((m) => {
    const claimedAt = snapshotTimeOf(m && m.snapshot);
    return {
      key: m && m.key,
      snapshot: m && m.snapshot,
      claimedAt,
      grantedAt: m && m.granted_at,
      period: m && m.period,
      problem: timeProblem(m, claimedAt) || (m && m.readable === false ? 'this backup is in the company\'s own bucket, which cannot be read yet' : null),
    };
  }).sort((a, b) => (a.claimedAt === null ? 1 : 0) - (b.claimedAt === null ? 1 : 0) || (a.claimedAt ?? 0) - (b.claimedAt ?? 0));
}

/* Why the snapshot's own time and the recorded one cannot both be true, or null. */
function timeProblem(m, claimedAt) {
  if (!m || typeof m.snapshot !== 'string') return 'Kosmos+ has no snapshot id for this backup, so it cannot be opened';
  if (claimedAt === null) return 'this backup\'s snapshot id carries no readable time';
  const granted = m.granted_at;
  if (!Number.isSafeInteger(granted)) return 'Kosmos+ recorded no grant time for this backup';
  if (claimedAt > granted + CLOCK_SKEW_SECS) return 'this backup says it was taken after Kosmos+ recorded it';
  if (granted - claimedAt > SNAPSHOT_TO_GRANT_SECS) return 'this backup says it was taken long before Kosmos+ recorded it';
  // No week check (review 1): the period is in the device-signed context, so a wrong one fails the open anyway, and
  // a genuine run that crossed Monday 00:00, or retried under the coordinator's grantedPeriod, is filed in a week its
  // own times do not both fall in.
  return null;
}

/* A stored object's key this restore may fetch: the coordinator's shape for this org and member (the chunks a manifest
   names may sit under an earlier epoch or period), and nothing a URL could read as more than a path. */
function keyOk(key, org, member) {
  if (typeof key !== 'string' || key.length > 256) return false;
  const parts = key.split('/');
  return parts.length === 5 && parts[0] === org && parts[1] === member && parts.every((x) => /^[A-Za-z0-9._:-]+$/.test(x) && x !== '.' && x !== '..');
}

/* fetchObject under a deadline: backuprestore bounds sizes, never time, and says the caller must. A fetch that does not
   settle in FETCH_TIMEOUT_MS reads as not stored. Only bytes are accepted (a number or an array-like is not). */
async function fetchBounded(fetchObject, key, o, ms) {
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  try {
    const got = await Promise.race([Promise.resolve().then(() => fetchObject(key, o)), deadline]);
    if (got instanceof ArrayBuffer) return Buffer.from(new Uint8Array(got));
    return got instanceof Uint8Array ? Buffer.from(got) : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

/* Restore ONE recorded manifest. opts:
     org, member, epoch    the member being restored and the key epoch released (as the release names them)
     manifest              the coordinator's record: { key, period, snapshot, sha256, size, granted_at }
     memberSk              the member key, from newDestination().open(...)
     history, now          the device-key history escrowd signed, and this computer's clock (devkeyhist.verify)
     fetchObject(key, { maxBytes }) -> bytes | null   one stored object (a read grant's GET, later). It should refuse
                           more than maxBytes; each call is also cut off after fetchTimeoutMs (default 2 min).
     sink, maxTotalBytes   as backuprestore.restoreSnapshot
     plan, planned         optional: engine/restorefetch.js readGrantFetcher's, given with its fetchObject
   Resolves { ok: true, deviceKey, backfill, takenAt, result, fetchProblems } (result is restoreSnapshot's;
   fetchProblems the fetcher's reasons for any file it could not fetch) or { ok: false, because }.
   Never throws on what a store, a coordinator or a history hands it; a caller's own mistake (no sink) still throws
   from restoreSnapshot, as there. */
async function runRestore(opts) {
  const { org, member, manifest } = opts;
  // The caller's own inputs, refused by name (review 1: a missing epoch became "undefined" and read as a key mismatch).
  if (typeof org !== 'string' || !org || typeof member !== 'string' || !member) return { ok: false, because: 'the restore was asked without naming the member' };
  if (!(Number.isSafeInteger(opts.epoch) && opts.epoch > 0) && !(typeof opts.epoch === 'string' && /^[1-9][0-9]{0,17}$/.test(opts.epoch))) return { ok: false, because: 'the restore was asked without a key epoch' };
  const epoch = String(opts.epoch);
  if (!(opts.memberSk instanceof Uint8Array) || opts.memberSk.length !== 32) return { ok: false, because: 'the member key was not opened, so nothing can be restored' };
  const ms = Number.isSafeInteger(opts.fetchTimeoutMs) && opts.fetchTimeoutMs > 0 ? opts.fetchTimeoutMs : FETCH_TIMEOUT_MS;
  const takenAt = snapshotTimeOf(manifest && manifest.snapshot);
  const why = timeProblem(manifest, takenAt);
  if (why) return { ok: false, because: why };
  const h = devkeyhist.verify(opts.history, { org, member, now: opts.now });
  if (!h.ok) return { ok: false, because: h.because };
  // Every key valid when Kosmos+ recorded the grant (normally one; two only across a re-registration).
  const candidates = h.keys.filter((k) => devkeyhist.keyAt(h.keys, k.key, manifest.granted_at));
  if (!candidates.length) return { ok: false, because: 'no device key of this member was valid when this backup was recorded' };
  if (!keyOk(manifest.key, org, member)) return { ok: false, because: 'the backup\'s manifest is not filed under this member' };
  const bytes = await fetchBounded(opts.fetchObject, manifest.key, { maxBytes: MAX_MANIFEST_OBJECT }, ms);
  if (!bytes) {
    // slice 2: a refused read grant says why (a 429's wait included), rather than only that nothing came back.
    let why = null;
    if (typeof opts.planned === 'function') { try { why = opts.planned().because; } catch { why = null; } }
    return { ok: false, because: typeof why === 'string' && why ? why : 'the backup\'s manifest could not be fetched' };
  }
  if (bytes.length > MAX_MANIFEST_OBJECT) return { ok: false, because: 'the backup\'s manifest is larger than any manifest can be' };
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) {
    return { ok: false, because: 'the backup\'s manifest is not the one Kosmos+ recorded' };
  }
  const ctx = { org, member, epoch, period: manifest.period, snapshot: manifest.snapshot };
  let opened = null, used = null;
  for (const k of candidates) {
    if (!KEY_HEX_RE.test(k.key)) continue;
    const pub = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(k.key, 'hex')]), format: 'der', type: 'spki' });
    const m = openManifest(opts.memberSk, pub, ctx, bytes);
    if (m) { opened = m; used = { k, pub }; break; }
  }
  if (!opened) return { ok: false, because: 'the backup\'s manifest does not open under this member\'s device key for that time' };
  const objects = opened.objects && typeof opened.objects === 'object' ? opened.objects : {};
  // slice 2: a read-grant fetcher (engine/restorefetch.js) is told every object the manifest names before the first
  // chunk, so it grants them in batches rather than one call per chunk; a grant it cannot get stops the restore here.
  const planOf = (p) => (p && typeof p === 'object' ? p : {});
  if (typeof opts.plan === 'function') {
    const keys = [...new Set(Object.values(objects).filter((k) => keyOk(k, org, member)))];
    let p;
    try { p = planOf(await opts.plan(keys)); } catch { p = { ok: false }; }
    if (p.ok === false) return { ok: false, because: typeof p.because === 'string' && p.because ? p.because : 'the backup\'s files could not be granted' };
  }
  const fetchChunk = async (name, o) => {
    const key = Object.prototype.hasOwnProperty.call(objects, name) ? objects[name] : null;
    if (!keyOk(key, org, member)) return null;
    return fetchBounded(opts.fetchObject, key, o, ms);
  };
  // opts.restoreSnapshot: a test seam for the result's SHAPE only (a real snapshot cannot be made to come back malformed).
  const result = await (opts.restoreSnapshot || restoreSnapshot)({
    memberSk: opts.memberSk, devicePubAtSnapshot: used.pub, ctx, manifestObject: bytes, fetchChunk,
    sink: opts.sink, maxTotalBytes: opts.maxTotalBytes,
  });
  // review 1: restoreSnapshot answers { malformed } or { overBound } when nothing could be restored; that is no success.
  if (!result || !Array.isArray(result.restored)) {
    const what = result && (result.malformed || result.overBound);
    return { ok: false, because: `the backup could not be restored${what ? ` (${what})` : ''}` };
  }
  // slice 2: why some files were not fetched (a grant refused part way, or files under an earlier key), so the person
  // is told the reason and not only which files failed.
  let fetchProblems = [];
  if (typeof opts.planned === 'function') {
    let p;
    try { p = planOf(opts.planned()); } catch { p = {}; }
    if (typeof p.because === 'string' && p.because) fetchProblems.push(p.because);
    if (Array.isArray(p.unreadableBecause)) fetchProblems = fetchProblems.concat(p.unreadableBecause.filter((x) => typeof x === 'string'));
  }
  return { ok: true, deviceKey: used.k.key, backfill: used.k.backfill === true, takenAt, result, fetchProblems };
}

module.exports = { newDestination, listSnapshots, runRestore, snapshotTimeOf, SNAPSHOT_TO_GRANT_SECS, CLOCK_SKEW_SECS };
