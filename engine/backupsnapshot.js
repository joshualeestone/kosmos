'use strict';
/**
 * kosmos#5535 (E0.6) build-order step 3: the snapshot walker. One snapshot of a work Kosmos, composed from the
 * reviewed parts on main:
 *   engine/backupscan.js    what may leave (path deny-list, content scan with redaction, the real-path check)
 *   engine/backupformat.js  content-defined chunks, sealed and named; the manifest, sealed and signed
 *   engine/backupupload.js  the chunk uploader and the manifest uploader
 *
 * Order, and why: files are walked, decided and chunked one at a time; sealed chunks the period does not hold yet are
 * uploaded in bounded batches; the manifest is sealed and uploaded LAST. A snapshot without a manifest is incomplete
 * and ignored (design v1 section 4), so a crash or a refused grant never leaves one that looks whole.
 *
 * The period: chunks are named with the period's naming key BEFORE any grant, so ctx.period must be the period the
 * coordinator will grant in (periodOf, its period_of). Every granted chunk key carries its period
 * (<org>/<account>/<epoch>/<period>/<random>), and so must every index entry; a key from another period stops the
 * run. The manifest is granted only inside ctx.period too, so its key, the coordinator's record of it and its sealed
 * context always name the same period (a run that crosses Monday 00:00 UTC stops as newPeriod and starts again).
 *
 * What is read, and how:
 *  - The deny-list (backupscan pathDecision) is applied BEFORE anything is opened: a denied folder (.git, .ssh,
 *    secrets/ ...) is pruned during the walk and recorded once; a denied file is recorded without being read.
 *  - Links are never followed (a followed link needs a check-then-read, and a folder link can loop): each is
 *    recorded as skipped.
 *  - A file is opened once, without following a final link and without blocking (a FIFO swapped in cannot hang the
 *    run), and the open descriptor must be a regular file with the device and inode the walk saw. (O_NOFOLLOW,
 *    O_NONBLOCK and O_NOCTTY are POSIX: where the platform lacks them, as on Windows, they are 0, and the device,
 *    inode and real-path checks below are what holds; review 16.) So what is read is
 *    the very file the walk found inside the work Kosmos, whatever was renamed or swapped in between. Its real path is
 *    then checked (inside the work Kosmos, and the deny-list again on it), and at most maxFile + 1 bytes are read.
 *
 * Memory: sealed chunks wait in batches of at most batchBytes; one file is read whole (backupscan works on one
 * buffer), so the per-file peak is a few times maxFile (the bytes, a decoded copy, the redacted copy).
 *
 * Results stay on this Mac. `because` is a sentence for the person or the log here: the walker's own are fixed text (an
 * unexpected error gives only its code, never its message, which can carry paths), and an uploader's refusal is passed
 * on as the uploader wrote it (its own reviewed sentences). Names in the manifest are checked for credential kinds
 * secretmask names; a generic long token used as a name (secretmask's long_token, which fires on ordinary long names
 * too) is not masked, a known residual.
 *
 * Not here: key storage (the member public key, the naming key and the device key are inputs), persisting the period
 * index (the caller keeps it: `added` is returned on every result, failed or not), the schedule and freshness.
 */
const crypto = require('crypto');
const nodeFs = require('fs');
const path = require('path');
const { CDC, chunkBuffer, chunkName, sealNamedChunk, sealManifest, checkBackupContext } = require('./backupformat');
const { scanFile, pathDecision, insideWorkKosmos } = require('./backupscan');
const { uploadChunks, uploadManifest, MAX_MANIFEST } = require('./backupupload');
const { pathProblem, collisionKey, collidingPaths } = require('./backuprestore');
const { mask } = require('./secretmask');
const { namingKeyId: namingKeyIdOf } = require('./backupkeys');
/* A name holding something shaped like a credential (review 19: names were never checked, so a file named after a
   pasted token put it in the manifest). secretmask on each segment, specific kinds only: its generic long_token fires
   on ordinary long names (measured: 271 of 8,146 real paths), the specific kinds on 1 (an "xai" in a plan name).
   Returns the name with those parts masked, or null when nothing fired. */
function nameMasked(name) {
  const m = mask(name);
  return m.fired.some((f) => f.kind !== 'long_token') ? m.text : null;
}

const FORMAT = 1;
// A file is read whole to be scanned (backupscan works on one buffer), so a bigger one is skipped, and says so.
const MAX_FILE = 256 * 1024 * 1024;
// Sealed chunk bytes held before a batch is uploaded.
const BATCH_BYTES = 64 * 1024 * 1024;
// Restore's own default ceiling on entries (engine/backuprestore.js MAX_FILES).
const MAX_FILES = 500000;
// The manifest's JSON must fit the coordinator's ceiling after framing and padding (Padme adds at most about 12%).
const MANIFEST_JSON_BUDGET = Math.floor(MAX_MANIFEST * 0.8);
const MAX_SKIPPED = 100000;
const MAX_DEPTH = 256;
const SPLIT_WINDOW = 8;   // segments joined when looking for a credential split across folder names
// The coordinator's allowance per member per weekly period (docs/coordinator-api.md "Allowances"): chunk objects and
// bytes, spent at grant time. A snapshot that could pass either is refused before it spends any (review 9).
// The bound is cautious (chunks at the 256 KiB minimum, redaction doubling every file), so in practice it refuses at
// about 25 GB of files, though real chunks average 1 MiB; the refusal says so.
const CHUNK_ALLOWANCE = 200000, BYTE_ALLOWANCE = 64 * 2 ** 30;
// A sealed chunk object at most: the chunk, Padme padding (at most about 12%, here 13%), framing; never below the floor.
const sealedMax = (n) => Math.max(4148, Math.ceil(n * 1.13) + 4096);
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MONDAY_EPOCH = Date.UTC(1970, 0, 5);   // the first Monday 00:00 UTC after the Unix epoch
const CHUNK_NAME_LEN = 64;
// The longest object key the walker accepts (the coordinator's are about 140: two ids, epoch, period, two 32-hex ids).
const MAX_KEY_LEN = 256;
// The bounds backupupload.uploadManifest puts on a chunk's lock end (its LOCK_MAX_MS, plus an hour), checked here up front.
const LOCK_FLOOR_MS = Date.UTC(2020, 0, 1), LOCK_MAX_MS = 39 * 86400 * 1000;
const ownerOf = (key) => key.split('/').slice(0, 2).join('/');
/* The lock a manifest granted at time t gets: its period's end + 30 days + 15 minutes (backup.rs manifest_retain_until,
   RETAIN_AFTER_PERIOD_SECS and GRANT_SECS). An index chunk must outlast it (review 18: checked here, not after uploads). */
const manifestLockAt = (t) => MONDAY_EPOCH + (Math.floor((t - MONDAY_EPOCH) / WEEK_MS) + 1) * WEEK_MS + 30 * DAY_MS + 15 * 60 * 1000;
/* The member key a chunk was sealed to, as recorded in each index entry: the first 16 bytes of a domain-tagged SHA-256 of
   the public key, hex. An index entry under another member key cannot be named (the new private key cannot open it). */
const memberKeyIdOf = (pk) => crypto.createHash('sha256').update('kosmos-backup v1 member-key-id\0').update(pk).digest().subarray(0, 16).toString('hex');

/** The coordinator's period label for a time: the ISO week of the Monday 00:00 UTC that starts it, "2026-W41". (The
    coordinator falls back to "p<start>" for a time its time crate cannot hold, years past 9999; a clock that far off is
    not refused here, but every grant it gets is in the coordinator's own period, so the run stops as newPeriod.) */
function periodOf(ms) {
  const start = MONDAY_EPOCH + Math.floor((ms - MONDAY_EPOCH) / WEEK_MS) * WEEK_MS;
  // ISO week-numbering year: the year of the Thursday of that week.
  const thursday = new Date(start + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const jan1 = new Date(0); jan1.setUTCFullYear(year, 0, 1);   // not Date.UTC, which reads years 0 to 99 as 1900 on
  const week = 1 + Math.floor((thursday - jan1) / WEEK_MS);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/* The period segment of a coordinator object key (<org>/<account>/<epoch>/<period>/<random>), or null. */
function periodOfKey(key) {
  const parts = typeof key === 'string' ? key.split('/') : [];
  return parts.length === 5 ? parts[3] : null;
}

/* Why a coordinator key cannot stand for a chunk of this context, or null: it must be <org>/<account>/<epoch>/<period>/<random>
   with the context's org and period (one under another period was named with another naming key: a manifest naming it
   would not restore). NOT the epoch segment (review 13): the coordinator writes a constant there today (backup.rs EPOCH
   = 1), so it says nothing about which member key sealed a chunk; that binding is the index entry's memberKeyId. */
function keyProblem(key, ctx) {
  const parts = typeof key === 'string' ? key.split('/') : [];
  // Plain segments only (review 7): the manifest budget charges a key at its byte length, which JSON keeps only for these.
  if (parts.length !== 5 || parts.some((x) => !/^[A-Za-z0-9._:-]+$/.test(x) || x === '.' || x === '..')) return 'not a coordinator object key';
  if (parts[0] !== ctx.org) return `under org ${parts[0]}, not ${ctx.org}`;
  if (parts[3] !== ctx.period) return `in period ${parts[3]}, not ${ctx.period}`;
  return null;
}

/* The deny-list, on the path AS RESTORE WILL WRITE IT (review 15): restore reads '\\' as a folder separator, so a Mac
   name like ".ssh\\id_rsa" comes back as .ssh/id_rsa; every rule anchors on '/', so the name as written would pass. */
const asRestored = (rel) => rel.replace(/\\/g, '/');
// And on restore's own equivalence of it (review 18): collisionKey drops invisible characters and folds case, so
// ".git<zero-width space>" is .git to restore. Denied if either reading is.
// (The second reading's `why` is a rule's name, never the folded path itself.)
const denied = (rel) => { const a = pathDecision(asRestored(rel)); return a.include ? pathDecision(collisionKey(rel)) : a; };
/* A folder the deny-list refuses: every folder rule ends in '/', so a bare child name matches exactly those. A rule on a
   NAME only (".env", "credentials") is not a folder rule: a folder so named is walked, and each file in it is judged
   by name and content as usual (review 22). */
const folderDenied = (rel) => { const d = denied(`${rel}/x`); return d.include ? null : d.why; };

/** Every regular file under root (absolute) the deny-list allows, as sorted '/'-separated relative paths with the
    device and inode seen, and what was skipped (links, denied folders and files, anything not a file or folder, a
    folder that could not be read). Nothing is opened but folders. fs is injectable for tests. */
function listFiles(root, fs = nodeFs, { maxFiles = MAX_FILES, maxSkipped = MAX_SKIPPED } = {}) {
  // Another volume mounted inside the work Kosmos (an external disk, a network share) is not crossed (review 11): what
  // is backed up is this computer's work Kosmos, and a mount can bring in anything. Recorded as skipped.
  let rootDev = null;
  try { rootDev = fs.lstatSync(root, { bigint: true }).dev; } catch { /* the walk reports the unreadable root */ }
  const files = [];
  const skipped = [];
  let skippedExtra = 0, over = false;
  // Bounded, whatever the tree holds: past maxFiles the walk stops, and skips past maxSkipped are only counted.
  const skip = (x) => { if (skipped.length < maxSkipped) skipped.push(x); else skippedExtra++; };
  const walk = (rel, depth, seen) => {
    if (over) return;
    // A depth cap (review 8): recursion this deep is a pathological tree, skipped by name rather than a stack overflow.
    if (depth > MAX_DEPTH) { skip({ path: rel, why: `folders nested more than ${MAX_DEPTH} deep` }); return; }
    let names;
    try { names = fs.readdirSync(path.join(root, rel)); } catch { skip({ path: rel || '.', why: 'a folder that could not be read' }); return; }
    // The folder listed must be the one the walk saw (review 13): a folder swapped for a link after its lstat would be
    // listed through the link. Checked again after listing; its files are also each checked at the open.
    if (seen) {
      let again = null;
      try { again = fs.lstatSync(path.join(root, rel), { bigint: true }); } catch { /* gone */ }
      if (!again || !again.isDirectory() || again.dev !== seen.dev || again.ino !== seen.ino) { skip({ path: rel, why: 'replaced while the snapshot was taken' }); return; }
    }
    for (const name of names.sort()) {
      if (over) return;
      const r = rel ? `${rel}/${name}` : name;
      // Recorded under the masked name: the skipped list leaves the Mac too.
      const masked = nameMasked(name);
      if (masked !== null) { skip({ path: rel ? `${rel}/${masked}` : masked, why: 'a name holding something shaped like a credential' }); continue; }
      // And a token split across folder boundaries (reviews 24 and 26): secretmask does not read a token across '/', so
      // each name is also checked joined to the 1 to 7 names above it (every window ending here; windows ending higher
      // were checked on the way down). '\\' inside a name is a boundary to restore, so its parts count as segments.
      // Measured on 8,146 real paths: 0 windows of up to 6 fire only joined. A hit is recorded with the whole window
      // masked. Residual: a token split over more than 8 segments.
      const segs = asRestored(r).split('/');
      let hit = 0;
      for (let w = 2; w <= Math.min(SPLIT_WINDOW, segs.length) && !hit; w++) if (nameMasked(segs.slice(-w).join('')) !== null) hit = w;
      if (hit) { skip({ path: segs.slice(0, -hit).concat(['\u2022\u2022\u2022\u2022']).join('/'), why: 'a path holding something shaped like a credential' }); continue; }
      let st;
      // bigint: device and inode compared exactly (a Number loses precision above 2^53).
      try { st = fs.lstatSync(path.join(root, r), { bigint: true }); } catch { skip({ path: r, why: 'an entry that could not be read' }); continue; }
      if (st.isSymbolicLink()) { skip({ path: r, why: 'a link (links are not followed)' }); continue; }
      if (st.isDirectory()) {
        if (rootDev !== null && st.dev !== rootDev) { skip({ path: r, why: 'another volume mounted inside the work Kosmos (not crossed)' }); continue; }
        const why = folderDenied(r);
        if (why) skip({ path: r, why }); else walk(r, depth + 1, st);
        continue;
      }
      if (!st.isFile()) { skip({ path: r, why: 'not a regular file' }); continue; }
      const d = denied(r);
      if (!d.include) { skip({ path: r, why: d.why }); continue; }
      // A path restore would refuse (engine/backuprestore.js pathProblem) is not stored: it could never come back.
      const problem = pathProblem(r);
      if (problem) { skip({ path: r, why: `${problem}: restore cannot write it` }); continue; }
      // Number: exact up to 2^53 bytes, far past maxFile, so the cap test stays right.
      files.push({ path: r, dev: st.dev, ino: st.ino, size: Number(st.size) });
      if (files.length > maxFiles) over = true;
    }
  };
  walk('', 0, null);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  // Restore refuses every entry that collides (engine/backuprestore.js collidingPaths): the same key (case, invisible
  // characters, '\\' as '/'), or a file whose key is another entry's folder. Keep-first, in sorted order, on a trie of
  // key segments; the rest are skipped and named. The kept set is then checked with restore's own rule.
  const node = () => ({ kids: new Map(), file: null });
  const trie = node(), kept = [];
  for (const f of files) {
    let n = trie, clash = null;
    for (const seg of collisionKey(f.path).split('/')) {
      if (n.file) { clash = n.file; break; }
      if (!n.kids.has(seg)) n.kids.set(seg, node());
      n = n.kids.get(seg);
    }
    if (!clash && n.file) clash = n.file;
    if (!clash && n.kids.size) clash = 'a folder of the same name';
    if (clash) { skip({ path: f.path, why: `restore would refuse it beside ${clash} (names it treats as one)` }); continue; }
    n.file = f.path; kept.push(f);
  }
  // Restore's own rule has the last word: anything it would still refuse is skipped too (review 8: a throw here would
  // have refused the whole snapshot over one name).
  const refused = collidingPaths(kept);
  const out = refused.size ? kept.filter((f) => { if (!refused.has(f.path)) return true; skip({ path: f.path, why: 'restore would refuse it as colliding with another name' }); return false; }) : kept;
  return { files: out, skipped, skippedExtra, over };
}

/* Read the file the walk found, or say why not: { buf } or { why }. One open, no final link followed, never blocking. */
function readListed(fs, rootReal, f, maxFile) {
  const abs = path.join(rootReal, f.path);
  const c = fs.constants || nodeFs.constants;
  // O_NOCTTY: a terminal device swapped in is refused by the fstat check below, and must not become ours first.
  const flags = c.O_RDONLY | (c.O_NOFOLLOW || 0) | (c.O_NONBLOCK || 0) | (c.O_NOCTTY || 0);
  let fd;
  try { fd = fs.openSync(abs, flags); } catch { return { why: 'a file that could not be opened (gone, or replaced by a link)' }; }
  try {
    const st = fs.fstatSync(fd, { bigint: true });
    if (!st.isFile() || st.dev !== f.dev || st.ino !== f.ino) return { why: 'replaced while the snapshot was taken' };
    // A hard link has no real path of its own to check: another name for it may be outside the work Kosmos.
    if (st.nlink > 1n) return { why: 'stored under more than one name (a hard link; another name may be outside the work Kosmos)' };
    // The real path, which must name the very file opened (review 9: a folder swapped for a link during the walk, and
    // back again before this lookup, would otherwise let the path checked differ from the file read). With hard links
    // refused above, the same device and inode mean the same file.
    const real = fs.realpathSync(abs);
    if (!insideWorkKosmos(real, rootReal)) return { why: 'its real path is outside the work Kosmos' };
    const rs = fs.statSync(real, { bigint: true });
    if (rs.dev !== st.dev || rs.ino !== st.ino) return { why: 'replaced while the snapshot was taken' };
    const relReal = path.relative(rootReal, real).split(path.sep).join('/');
    const d = denied(relReal);
    if (!d.include) return { why: d.why };
    const size = Number(st.size);
    if (size > maxFile) return { why: `larger than ${Math.round(maxFile / 1024 / 1024)} MB, too large to scan` };
    // One byte more than allowed: filling it means the file grew past maxFile after the size check.
    const buf = Buffer.alloc(Math.min(size, maxFile) + 1);
    let n = 0;
    for (;;) {
      const got = fs.readSync(fd, buf, n, buf.length - n, null);
      if (got === 0) break;
      n += got;
      // The buffer holds one byte more than the file had: filling it means it grew during the read (review 9), or,
      // when it was already at the cap, that it passed the cap.
      if (n === buf.length) return { why: size >= maxFile ? `larger than ${Math.round(maxFile / 1024 / 1024)} MB, too large to scan` : 'it grew while the snapshot was taken' };
    }
    return { buf: buf.subarray(0, n) };
  } catch { return { why: 'a file that could not be read' }; } finally { try { fs.closeSync(fd); } catch { /* already closed */ } }
}

const isKey32 = (b) => Buffer.isBuffer(b) && b.length === 32;
// A manifest entry's JSON size, for the running budget (canonicalJson writes the same characters as JSON.stringify).
const entryBytes = (x) => Buffer.byteLength(JSON.stringify(x)) + 1;
/* An UPPER bound on what one listed file can add to the manifest, from its size alone. A file over maxFile is only ever
   a skip entry (review 5: counting its size made one big disk image fail every snapshot). Otherwise every chunk but a
   file's last is at least CDC.min, and the stored bytes may be at most twice the file's (redaction can lengthen text),
   so it has at most floor(2 * size / CDC.min) + 1 chunks; each adds a name to the file entry and one objects entry
   with the longest key accepted; plus the entry itself and a redaction record or a skip entry, within the fixed 1024
   (review 21 measured the worst: all 17 kinds secretmask can report, 8-digit counts, is 703 bytes past the path, and
   with the file entry 815; about 200 bytes to spare).
   So a snapshot is limited to about 20 GB of files under maxFile: past that this bound passes the manifest ceiling
   even where the real manifest would not (at 1 MiB average chunks and real key lengths it is about a tenth). */
const chunksMax = (f, maxFile) => (f.size > maxFile ? 0 : Math.floor((2 * f.size) / CDC.min) + 1);
function upperBound(f, maxFile) {
  const pathJson = Buffer.byteLength(JSON.stringify(f.path));
  if (f.size > maxFile) return 2 * pathJson + 1024;
  const n = chunksMax(f, maxFile);
  return 2 * pathJson + 1024 + n * (CHUNK_NAME_LEN + 3) + n * (CHUNK_NAME_LEN + 6 + MAX_KEY_LEN);
}

/**
 * Take one snapshot.
 *   input: { root, memberPk, namingKey, namingKeyId, deviceKey, ctx, index?, bucket? }
 *     root         the work Kosmos folder (absolute)
 *     memberPk     the member's backup public key (32 bytes), namingKey this period's naming key (32 bytes) and
 *                  namingKeyId its id (backupkeys namingKeyId), deviceKey the device's Ed25519 private KeyObject
 *     ctx          the manifest context { org, member, epoch, period, snapshot }; period must be periodOf(now)
 *     index        this period's chunks stored by earlier runs: Map name -> { key, lockedUntilMs, memberKeyId }, all under
 *                  bucket; memberKeyId binds each to the member key it was sealed to (an entry for another is stale)
 *   deps: { macRequest, fetch?, now?, sleep?, fs?, uploadChunks?, uploadManifest?, batchBytes?, maxFile?, maxManifestJson? }
 * Resolves { ok: true, manifestKey, files, skipped, uploaded, reused, added, bucket } or
 * { ok: false, because, retryLater?, newPeriod?, staleIndex?, tooLarge?, overAllowance?, grantSpent?, unsure?, added, bucket }.
 *   overAllowance: the week's backup allowance would be passed (refused before anything is spent), or is used up
 *     (backup_quota, which can arrive after some batches were stored: they are in `added`): not this period.
 *   newPeriod: a period boundary passed (the context's, or a grant's): start again with the new period's context and
 *     naming key; this input can never succeed.
 *   added (Map name -> { key, lockedUntilMs, memberKeyId }) is every chunk this run stored in ctx.period under `bucket`,
 *     failed or not; keep memberKeyId with each entry (an index entry without it is stale).
 *   staleIndex: the index cannot be used (another bucket or period, malformed, or chunks whose locks end too soon):
 *     drop it, keep `added` under `bucket`, and take the next snapshot from that.
 *   tooLarge: the manifest would pass its ceiling (too many files): not a retry.
 * Never throws.
 */
async function takeSnapshot(input, deps) {
  const added = new Map();
  const state = { bucket: null };
  const fail = (because, extra) => Object.assign({ ok: false, because, added, bucket: state.bucket }, extra || {});
  try {
    return await snapshotInner(input || {}, deps || {}, added, state, fail);
  } catch (err) {
    // A fixed sentence and the error's code, never its message: an fs error carries absolute paths (review 7).
    return fail(`the snapshot failed unexpectedly${err && err.code ? ` (${err.code})` : ''}`);
  }
}

async function snapshotInner(input, deps, added, state, fail) {
  const { root, memberPk, namingKey, namingKeyId, deviceKey, ctx } = input;
  const now = deps.now || Date.now;
  const fs = deps.fs || nodeFs;
  const putChunks = deps.uploadChunks || uploadChunks;
  const putManifest = deps.uploadManifest || uploadManifest;
  const pos = (n, dflt) => (Number.isSafeInteger(n) && n > 0 ? n : dflt);
  const batchBytes = pos(deps.batchBytes, BATCH_BYTES), maxFile = pos(deps.maxFile, MAX_FILE);
  const budget = pos(deps.maxManifestJson, MANIFEST_JSON_BUDGET);
  if (typeof root !== 'string' || !path.isAbsolute(root)) return fail('the work Kosmos folder must be an absolute path');
  if (!isKey32(memberPk) || !isKey32(namingKey)) return fail('the member key and the naming key must be 32-byte Buffers');
  // The id the manifest records must be THIS naming key's (review 21): restore matches it against the naming key it
  // unwraps, so a stale id (last period's) would lock in a manifest that can never be opened.
  if (typeof namingKeyId !== 'string' || namingKeyId !== namingKeyIdOf(namingKey)) return fail('the naming key id is not this naming key\'s (backupkeys namingKeyId)');
  // The device key is used only to sign the manifest, after every chunk is uploaded: checked here, before anything is
  // spent (review 11), with sealManifest's own rule.
  if (!deviceKey || deviceKey.type !== 'private' || deviceKey.asymmetricKeyType !== 'ed25519') return fail('the device key must be an Ed25519 private key');
  try { checkBackupContext(ctx); } catch (err) { return fail(err.message); }
  const t = now();
  // A Date can hold only about 275,000 years either side of 1970 (review 19): past that, periodOf reads "NaN-WNaN".
  const usable = (x) => Number.isFinite(x) && Number.isFinite(new Date(x).getTime());
  if (!usable(t)) return fail('this computer\'s clock gave no usable time');
  const period = periodOf(t);
  // newPeriod, not retryLater: the same input fails again; the caller needs this period's context and naming key.
  if (ctx.period !== period) return fail(`the context names period ${ctx.period}, but this computer's clock is in ${period}`, { newPeriod: true });

  // The index: every entry this period's, with a lock end, under one named bucket. Checked before anything is read.
  const index = input.index instanceof Map ? input.index : new Map();
  const mkid = memberKeyIdOf(memberPk);
  if (index.size) {
    if (typeof input.bucket !== 'string' || !input.bucket) return fail('an index of earlier chunks needs the bucket they are stored under', { staleIndex: true });
    for (const [name, e] of index) {
      const why = typeof name !== 'string' || !/^[0-9a-f]{64}$/.test(name) || !e ? 'malformed'
        : keyProblem(e.key, ctx) || (Buffer.byteLength(e.key) > MAX_KEY_LEN ? `a key longer than ${MAX_KEY_LEN} characters` : null)
          || (e.memberKeyId !== mkid ? 'sealed to another member key' : null)
          || (!Number.isSafeInteger(e.lockedUntilMs) || e.lockedUntilMs < LOCK_FLOOR_MS || e.lockedUntilMs > t + LOCK_MAX_MS + 3600 * 1000 ? 'a lock end no grant could set' : null)
          // A lock that ends before any manifest granted now would (period end + 30 days + the window; at least now + 30
          // days + 15 min): uploadManifest would refuse it as outlasting it (review 9 NIT). Mirrors the coordinator's
          // RETAIN_AFTER_PERIOD_SECS (30 days) and GRANT_SECS (15 minutes) in backup.rs retain_until_for (review 14).
          || (e.lockedUntilMs < manifestLockAt(t) ? 'a lock that ends before this snapshot\'s manifest would' : null);
      if (why) return fail(`the index holds an entry this snapshot cannot name (${why})`, { staleIndex: true });
    }
    state.bucket = input.bucket;
  }
  // Every key this snapshot names, so none is ever named for two chunks (review 5: a repeat across batches, or of an
  // index key, would point two names at one object; on a versioned bucket restore could only open one of them).
  const usedKeys = new Set([...index.values()].map((e) => e.key));
  if (usedKeys.size !== index.size) return fail('the index names one key for two chunks', { staleIndex: true });
  // One <org>/<account> for every chunk the manifest names, as uploadManifest requires (review 7): the index's, or the
  // first grant's.
  const owners = new Set([...usedKeys].map(ownerOf));
  if (owners.size > 1) return fail('the index names chunks under more than one account', { staleIndex: true });
  let owner = owners.size ? [...owners][0] : null;

  let rootReal;
  try { rootReal = fs.realpathSync(root); } catch { return fail('the work Kosmos folder could not be read'); }
  const listed = listFiles(rootReal, fs);
  if (listed.over) return fail(`the work Kosmos holds more than ${MAX_FILES} files, more than one snapshot can list`, { tooLarge: true });
  // The manifest budget, kept so that NOTHING is uploaded unless the finished manifest is sure to fit (review 3):
  //   estimate  the exact JSON so far (entries, objects, skips), with keys not yet granted charged at MAX_KEY_LEN
  //   reserve   the upper bound of every listed file not yet finished (the current one included)
  // The check before the walk is the guard, and it is enough by construction: every file's exact charge (its entry, its
  // objects at their real key length, a redaction record or a skip) is at most its reserve, so the final manifest is at
  // most that sum. No check runs per batch (a mutant showed it redundant): mid-file it would count pending chunks twice,
  // once charged and once in the file's reserve, and could only trip spuriously, after earlier batches were stored.
  let estimate = 1024;
  const ub = (f) => upperBound(f, maxFile);
  let reserve = listed.files.reduce((n, f) => n + ub(f), 0);
  const listedBytes = listed.files.reduce((n, f) => n + (f.size > maxFile ? 0 : f.size), 0);
  const over = () => estimate + reserve > budget;

  const skipped = [];
  // Every skip is charged to the manifest estimate as it happens, so the last batch is never uploaded for a manifest
  // its skipped list would push over the ceiling (review 2).
  let skippedExtra = listed.skippedExtra;
  const skip = (s) => { if (skipped.length < MAX_SKIPPED) { estimate += entryBytes(s); skipped.push(s); } else skippedExtra++; };
  for (const s of listed.skipped) skip(s);
  // The allowance, before anything is spent. Chunks: this period's earlier ones (the index) plus this run's upper bound.
  // Bytes: this run's upper bound only (review 10): the index records no sizes, and charging each earlier chunk at the
  // largest size refused ordinary second runs. Bytes spent earlier in the period are caught by the coordinator's
  // backup_quota refusal, which ends the run as overAllowance below.
  const chunkBound = index.size + listed.files.reduce((n, f) => n + chunksMax(f, maxFile), 0);
  // The manifest counts too: the 64 GiB is chunks and manifests together (review 21).
  const byteBound = listed.files.reduce((n, f) => n + (f.size > maxFile ? 0 : sealedMax(2 * f.size) + chunksMax(f, maxFile) * 4148), 0) + sealedMax(budget);
  if (chunkBound > CHUNK_ALLOWANCE || byteBound > BYTE_ALLOWANCE) {
    return fail(`the work Kosmos is too large to back up in one week: ${listed.files.length} files, ${Math.round(listedBytes / 2 ** 20)} MB, could pass the weekly allowance (${CHUNK_ALLOWANCE} chunks, 64 GB) under a cautious estimate; in practice about 25 GB of files fit`, { tooLarge: true, overAllowance: true });
  }
  const tooLargeWhy = () => `the work Kosmos is too large for one snapshot: ${listed.files.length} files, ${Math.round(listedBytes / 2 ** 20)} MB, could make a manifest past its ceiling (one snapshot holds about 20 GB of files)`;
  if (over()) return fail(tooLargeWhy(), { tooLarge: true });
  const files = [], redacted = [];
  const objects = {};        // every referenced chunk: name -> key (filled as chunks are stored or reused)
  const pending = new Map(); // sealed this run, not yet uploaded: name -> object
  let pendingBytes = 0, uploaded = 0, reused = 0;

  // Upload what is pending; on any failure, stop. Keys must be this period's and under one bucket.
  const flush = async () => {
    if (!pending.size) return null;
    // No size check here: the one check before the walk already guarantees the finished manifest fits (see there).
    const batch = [...pending].map(([name, object]) => ({ name, object }));
    const r = await putChunks(deps, batch);
    const stored = (r && r.keys instanceof Map) ? r.keys : new Map();
    const lockOf = (name) => (r && r.lockedUntil instanceof Map ? r.lockedUntil.get(name) : undefined);
    const spent = r && r.grantSpent !== undefined ? { grantSpent: r.grantSpent } : {};
    if (r && r.bucket && state.bucket && r.bucket !== state.bucket) {
      // Another bucket than the index's: the index cannot be used with these. `added` is reported under ONE bucket, so it
      // becomes what this batch stored under the NEW bucket; chunks earlier batches of this run stored under the old
      // bucket are dropped from it (stored, locked, and named by nothing until their lock ends), deliberately.
      added.clear(); state.bucket = r.bucket;
      for (const [name, key] of stored) {
        if (pending.has(name) && !usedKeys.has(key) && !keyProblem(key, ctx) && (!owner || ownerOf(key) === owner) && Buffer.byteLength(key) <= MAX_KEY_LEN && Number.isSafeInteger(lockOf(name))) {
          added.set(name, { key, lockedUntilMs: lockOf(name), memberKeyId: mkid }); usedKeys.add(key);
        }
      }
      // staleIndex only when there was an index to drop (review 22); without one, the next run is a full snapshot anyway.
      return fail((index.size ? 'a grant named another bucket than the index\'s: drop the index and take a full snapshot' : 'two grants in one snapshot named different buckets: take a full snapshot') + '; chunks stored under the earlier bucket in this run are not kept', Object.assign(index.size ? { staleIndex: true } : {}, spent));
    }
    if (r && r.bucket && !state.bucket) state.bucket = r.bucket;
    // Stored keys with no bucket named (reviews 14 and 17): whether or not an index set one, they cannot be checked
    // against it or filed. Not recorded; a malformed answer.
    if (stored.size && !(r && r.bucket)) return fail('the uploader answered stored chunks without naming their bucket', spent);
    // Every usable stored chunk is recorded before any failure is returned, so the caller's index keeps it (review 2).
    const wrongPeriod = [];
    let noLock = false, badKey = null, shortLock = false;
    for (const [name, key] of stored) {
      if (!pending.has(name)) { badKey = badKey || 'for a chunk this run did not ask to store'; continue; }
      if (usedKeys.has(key)) { badKey = badKey || 'repeats a key already named'; continue; }
      const kp = keyProblem(key, ctx) || (owner && ownerOf(key) !== owner ? `under account path ${ownerOf(key)}, not ${owner}` : null);
      if (kp && kp.startsWith('in period')) { wrongPeriod.push(periodOfKey(key)); continue; }
      if (kp) { badKey = badKey || kp; continue; }
      if (!Number.isSafeInteger(lockOf(name))) { noLock = true; continue; }
      // A lock shorter than this snapshot's manifest will get (review 25): the manifest could never name it.
      if (lockOf(name) < manifestLockAt(t)) { shortLock = true; continue; }
      if (Buffer.byteLength(key) > MAX_KEY_LEN) { badKey = badKey || `longer than ${MAX_KEY_LEN} characters`; continue; }
      added.set(name, { key, lockedUntilMs: lockOf(name), memberKeyId: mkid });
      usedKeys.add(key);
      owner = owner || ownerOf(key);
      objects[name] = key;
      estimate += Buffer.byteLength(key) - MAX_KEY_LEN;   // charged at MAX_KEY_LEN when it was sealed (only pending names reach here)
    }
    if (badKey) return fail(`a granted key is not one this snapshot can name (${badKey})`, spent);
    if (noLock) return fail('a stored chunk came back without its lock end', spent);
    if (shortLock) return fail('a stored chunk came back locked for less time than this snapshot\'s manifest would be', spent);
    if (wrongPeriod.length) return fail(`a chunk was granted in period ${wrongPeriod[0]}, not ${ctx.period} (a period boundary passed); start again in the new period (chunks granted there are not kept: they stay stored, unnamed, until their lock ends)`, Object.assign({ newPeriod: true }, spent));
    // backup_quota: this period's allowance is spent (by earlier runs, or anything signing as this computer): not a
    // retry this period (review 9).
    if (r && r.code === 'backup_quota') return fail(`the period's backup allowance is used up: ${r.because || 'backup_quota'}`, Object.assign({ overAllowance: true }, r.unsure ? { unsure: r.unsure } : {}, spent));
    if (!r || !r.ok) return fail(`chunks could not be uploaded: ${(r && r.because) || 'no answer'}`, Object.assign({}, r && r.retryLater ? { retryLater: true } : {}, r && r.unsure ? { unsure: r.unsure } : {}, spent));
    for (const name of pending.keys()) if (!objects[name]) return fail('the uploader reported success without a key for every chunk', spent);
    uploaded += pending.size;
    pending.clear(); pendingBytes = 0;
    return null;
  };

  for (const f of listed.files) {
    // Over the cap at walk time: its reserve is a skip entry only, so it is never read (review 7: one that shrank before
    // the read was stored past its reserve).
    if (f.size > maxFile) { skip({ path: f.path, why: `larger than ${Math.round(maxFile / 1024 / 1024)} MB, too large to scan` }); reserve -= ub(f); continue; }
    const got = readListed(fs, rootReal, f, maxFile);
    if (!got.buf) { skip({ path: f.path, why: got.why }); reserve -= ub(f); continue; }
    // Grown since the walk: its reserve was sized from the walk's size, and it is being written to (review 6).
    if (got.buf.length > f.size) { skip({ path: f.path, why: 'it grew while the snapshot was taken' }); reserve -= ub(f); continue; }
    const d = scanFile(f.path, got.buf);
    if (d.action !== 'store') { skip({ path: f.path, why: d.why || 'not stored' }); reserve -= ub(f); continue; }
    const data = d.data;
    // The reserve assumed at most twice the file's size; a copy past that would break the bound, so it is not stored.
    // (The +1 adds no chunk to upperBound's floor(2 * size / CDC.min) + 1: 2 * size + 1 is odd and CDC.min is even.)
    if (data.length > 2 * f.size + 1) { skip({ path: f.path, why: 'its redacted copy is over twice its size' }); reserve -= ub(f); continue; }
    if (d.redacted && d.redacted.length) { redacted.push({ path: f.path, kinds: d.redacted }); estimate += entryBytes(redacted[redacted.length - 1]); }
    const names = [];
    for (const piece of chunkBuffer(data)) {
      // Named first, sealed only if it will be uploaded (review 13: sealing every chunk re-encrypted the whole work
      // Kosmos on every run, to upload only what changed).
      const name = chunkName(namingKey, piece);
      names.push(name);
      if (objects[name] || pending.has(name)) continue;
      const known = index.get(name);
      // Every name this snapshot references gets one objects entry: its JSON is counted once, here.
      // A key is charged at its byte length, which is its JSON length only because keyProblem allows plain segments
      // ([A-Za-z0-9._:-]); widen that rule and this charge must escape (pinned by the "a key with a quote" test).
      estimate += CHUNK_NAME_LEN + 6 + (known ? Buffer.byteLength(known.key) : MAX_KEY_LEN);
      if (known) { objects[name] = known.key; reused++; continue; }
      const sealed = sealNamedChunk(memberPk, namingKey, piece);
      if (sealed.name !== name) return fail('a chunk was sealed under another name than it was given');   // cannot differ today
      const { object } = sealed;
      pending.set(name, object); pendingBytes += object.length;
      if (pendingBytes >= batchBytes) { const stop = await flush(); if (stop) return stop; }
    }
    const entry = { path: f.path, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), chunks: names };
    estimate += entryBytes(entry);
    reserve -= ub(f);
    files.push(entry);
  }
  if (estimate > budget) return fail(tooLargeWhy(), { tooLarge: true });
  const stop = await flush();
  if (stop) return stop;
  if (estimate > budget) return fail(tooLargeWhy(), { tooLarge: true });

  // Every chunk a file names, with its key and lock end, for the manifest uploader's checks.
  const chunks = [];
  for (const name of Object.keys(objects)) {
    const e = added.get(name) || index.get(name);
    if (!e) return fail('a chunk the manifest names has no stored key');
    chunks.push({ key: e.key, lockedUntilMs: e.lockedUntilMs });
  }
  if (!chunks.length) return fail('there is nothing to back up: no file with content (empty files alone make no snapshot, since a manifest must name at least one chunk)');
  const manifest = {
    format: FORMAT, takenAt: new Date(t).toISOString(), namingKeyId,   // t: the reading already checked (review 11)
    files, objects, redacted, skipped, skippedNotListed: skippedExtra,
  };
  // A period boundary passed during the run: NO manifest grant is asked for (review 17). The manifest is sealed with
  // ctx.period, but the coordinator would file it under the period of the moment it is granted (its key and record), so a
  // restore looking it up by that period could not open it; and its lock would be the new period's, which earlier
  // chunks may not outlast (review 15). The run starts again in the new period, with its context and naming key.
  const tEnd = now();
  if (!usable(tEnd)) return fail('this computer\'s clock gave no usable time');   // fails closed, as at the start
  if (periodOf(tEnd) !== ctx.period) return fail(`a period boundary passed during the snapshot (now ${periodOf(tEnd)}): start again in the new period`, { newPeriod: true });
  // Cannot throw on this content (review 8): file and redacted paths passed pathProblem, skipped ones are walk paths, every other value is a fixed sentence, a number,
  // hex or a key of plain segments, and the context and keys were checked before anything was read. If it ever did,
  // takeSnapshot's catch returns `added` intact.
  const sealed = sealManifest(memberPk, deviceKey, ctx, manifest);
  const m = await putManifest(deps, sealed, { bucket: state.bucket, chunks });
  if (!m || !m.ok) {
    // outlastsChunks: the named chunks lock out too soon for this manifest. Every lock was checked against this period's
    // manifest lock, so in practice Monday passed since (review 25: a FRESH reading says so; the one above cannot). Else
    // it is the index's (staleIndex, only when there is one).
    const tNow = now();
    const passed = m && m.outlastsChunks && usable(tNow) && periodOf(tNow) !== ctx.period;
    // otherBucket: the coordinator now grants to another bucket. With an index, drop it (review 23); without one, this
    // run's chunks are in the abandoned bucket, so none is handed back to be kept as an index (review 25).
    if (m && m.otherBucket && !index.size) added.clear();
    return fail(`the manifest could not be uploaded: ${(m && m.because) || 'no answer'}`, Object.assign({},
      m && m.retryLater ? { retryLater: true } : {}, m && m.unsure ? { unsure: m.unsure } : {},
      passed ? { newPeriod: true } : (m && m.outlastsChunks && index.size ? { staleIndex: true } : {}),
      m && m.otherBucket && index.size ? { staleIndex: true } : {}, m && m.grantSpent !== undefined ? { grantSpent: m.grantSpent } : {}));
  }
  // The manifest's key must be this context's (review 19): Monday 00:00 UTC can pass between the check above and the
  // coordinator signing the grant, and uploadManifest checks only the owner. A key in another period files the manifest
  // where a restore looking it up by period cannot open it; said, not hidden (it is stored and locked either way).
  const mk = keyProblem(m.key, ctx) || (owner && ownerOf(m.key) !== owner ? 'under another account path' : null);
  // newPeriod only when the period is what differs (review 23); another org or a malformed key is a plain failure.
  if (mk && mk.startsWith('in period')) return fail(`the manifest was stored under a key ${mk} (a period boundary passed as it was granted): start again in the new period`, { newPeriod: true, grantSpent: true });
  if (mk) return fail(`the manifest was stored under a key that is not this snapshot's (${mk})`, { grantSpent: true });
  return { ok: true, manifestKey: m.key, files: files.length, skipped: skipped.length + skippedExtra, uploaded, reused, added, bucket: state.bucket };
}

module.exports = { periodOf, periodOfKey, memberKeyIdOf, listFiles, takeSnapshot, MAX_FILE, BATCH_BYTES, MAX_FILES };
