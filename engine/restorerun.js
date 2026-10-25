'use strict';
/**
 * kosmos#5536 (E0.7, restore) slice 1: ONE snapshot restored onto this computer, composed from the reviewed parts.
 * Design: #5536 comment 6399924599. Every source is injected, so this is tested against fakes now and wired to the
 * real routes later (the read grants, kosmos#5686 c; the device-key history, kosmos#7116).
 *
 *   engine/backupkeys.js     the member key, opened from the release's wrap with this computer's destination key
 *   engine/devkeyhist.js     the device-key history escrowd signs, and which key was valid when
 *   engine/backupformat.js   the manifest, opened only under that key and the full context
 *   engine/backuprestore.js  the files, each verified per chunk and per file against the device-signed manifest
 *   engine/restoresink.js    (the caller's sink) a fresh, private folder the person chose
 *
 * The time that picks the device key is the coordinator's record of when the manifest was granted, NEVER the time
 * inside the snapshot id: an attacker with a retired device key could seal a manifest to the member's PUBLIC key,
 * sign it, and date its id inside that key's window. The id's time must agree with the recorded one (the snapshot is
 * taken, then its manifest granted, minutes apart), and both must fall in the manifest's period, or the snapshot is
 * refused by name. A breached coordinator could still move the recorded time, but not the id's without the open
 * failing (the id is in the device-signed context), so it must forge both: the residual #7116 and the person-confirmed
 * fingerprint address.
 *
 * Snapshots are labelled by the time inside their id, never by the coordinator's granted_at (#7118's correction): the
 * id's time is device-signed and so authentic once the manifest opens; until then it is shown as claimed.
 */
const crypto = require('crypto');
const { unwrapMemberKey } = require('./backupkeys');
const { openManifest } = require('./backupformat');
const { restoreSnapshot } = require('./backuprestore');
const { periodOf } = require('./backupsnapshot');
const devkeyhist = require('./devkeyhist');

// How far before its grant a snapshot's own time may be: a large work Kosmos takes a while to chunk and upload before
// the manifest is granted. Never after it: the id is made before anything is granted.
const SNAPSHOT_TO_GRANT_SECS = 6 * 3600;
const SNAPSHOT_ID_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-[0-9a-f]{8}$/;
const MAX_MANIFEST_OBJECT = 64 * 1024 * 1024;   // the coordinator's own ceiling for one manifest (backup.rs)
const KEY_HEX_RE = /^[0-9a-f]{64}$/;
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
  return (Array.isArray(manifests) ? manifests : []).map((m) => {
    const claimedAt = snapshotTimeOf(m && m.snapshot);
    return {
      key: m && m.key,
      snapshot: m && m.snapshot,
      claimedAt,
      grantedAt: m && m.granted_at,
      period: m && m.period,
      problem: timeProblem(m, claimedAt) || (m && m.readable === false ? 'this backup is in the company\'s own bucket, which cannot be read yet' : null),
    };
  }).sort((a, b) => (a.claimedAt ?? Infinity) - (b.claimedAt ?? Infinity));
}

/* Why the snapshot's own time and the recorded one cannot both be true, or null. */
function timeProblem(m, claimedAt) {
  if (!m || typeof m.snapshot !== 'string') return 'Kosmos+ has no snapshot id for this backup, so it cannot be opened';
  if (claimedAt === null) return 'this backup\'s snapshot id carries no readable time';
  const granted = m.granted_at;
  if (!Number.isSafeInteger(granted)) return 'Kosmos+ recorded no grant time for this backup';
  if (claimedAt > granted) return 'this backup says it was taken after Kosmos+ recorded it';
  if (granted - claimedAt > SNAPSHOT_TO_GRANT_SECS) return 'this backup says it was taken long before Kosmos+ recorded it';
  if (periodOf(claimedAt * 1000) !== m.period || periodOf(granted * 1000) !== m.period) return 'this backup\'s time is not in the week it is filed under';
  return null;
}

/* Restore ONE recorded manifest. opts:
     org, member, epoch    the member being restored and the key epoch released (as the release names them)
     manifest              the coordinator's record: { key, period, snapshot, sha256, size, granted_at }
     memberSk              the member key, from newDestination().open(...)
     history, now          the device-key history escrowd signed, and this computer's clock (devkeyhist.verify)
     fetchObject(key, { maxBytes }) -> bytes | null   one stored object (a read grant's GET, later)
     sink, maxTotalBytes   as backuprestore.restoreSnapshot
   Resolves { ok: true, deviceKey, backfill, takenAt, result } (result is restoreSnapshot's) or { ok: false, because }.
   Never throws on what a store, a coordinator or a history hands it; a caller's own mistake (no sink) still throws
   from restoreSnapshot, as there. */
async function runRestore(opts) {
  const { org, member, manifest } = opts;
  const epoch = String(opts.epoch);
  const takenAt = snapshotTimeOf(manifest && manifest.snapshot);
  const why = timeProblem(manifest, takenAt);
  if (why) return { ok: false, because: why };
  const h = devkeyhist.verify(opts.history, { org, member, now: opts.now });
  if (!h.ok) return { ok: false, because: h.because };
  // Every key valid when Kosmos+ recorded the grant (normally one; two only across a re-registration).
  const candidates = h.keys.filter((k) => devkeyhist.keyAt(h.keys, k.key, manifest.granted_at));
  if (!candidates.length) return { ok: false, because: 'no device key of this member was valid when this backup was recorded' };
  let bytes;
  try { bytes = await opts.fetchObject(manifest.key, { maxBytes: MAX_MANIFEST_OBJECT }); } catch { bytes = null; }
  if (!bytes) return { ok: false, because: 'the backup\'s manifest could not be fetched' };
  bytes = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
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
  const fetchChunk = async (name, o) => {
    const key = Object.prototype.hasOwnProperty.call(objects, name) ? objects[name] : null;
    if (typeof key !== 'string') return null;
    return opts.fetchObject(key, o);
  };
  const result = await restoreSnapshot({
    memberSk: opts.memberSk, devicePubAtSnapshot: used.pub, ctx, manifestObject: bytes, fetchChunk,
    sink: opts.sink, maxTotalBytes: opts.maxTotalBytes,
  });
  return { ok: true, deviceKey: used.k.key, backfill: used.k.backfill === true, takenAt, result };
}

module.exports = { newDestination, listSnapshots, runRestore, snapshotTimeOf, SNAPSHOT_TO_GRANT_SECS };
