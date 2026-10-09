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
 * run. The manifest's own grant may land in the next period: the coordinator locks last-day chunk grants to the next
 * period's date for exactly that case.
 *
 * What is read, and how:
 *  - The deny-list (backupscan pathDecision) is applied BEFORE anything is opened: a denied folder (.git, .ssh,
 *    secrets/ ...) is pruned during the walk and recorded once; a denied file is recorded without being read.
 *  - Links are never followed (a followed link needs a check-then-read, and a folder link can loop): each is
 *    recorded as skipped.
 *  - A file is opened once, without following a final link and without blocking (a FIFO swapped in cannot hang the
 *    run), and the open descriptor must be a regular file with the device and inode the walk saw. So what is read is
 *    the very file the walk found inside the work Kosmos, whatever was renamed or swapped in between. Its real path is
 *    then checked (inside the work Kosmos, and the deny-list again on it), and at most maxFile + 1 bytes are read.
 *
 * Memory: sealed chunks wait in batches of at most batchBytes; one file is read whole (backupscan works on one
 * buffer), so the per-file peak is a few times maxFile (the bytes, a decoded copy, the redacted copy).
 *
 * Not here: key storage (the member public key, the naming key and the device key are inputs), persisting the period
 * index (the caller keeps it: `added` is returned on every result, failed or not), the schedule and freshness.
 */
const crypto = require('crypto');
const nodeFs = require('fs');
const path = require('path');
const { CDC, chunkBuffer, sealNamedChunk, sealManifest, checkBackupContext } = require('./backupformat');
const { scanFile, pathDecision, insideWorkKosmos } = require('./backupscan');
const { uploadChunks, uploadManifest, MAX_MANIFEST } = require('./backupupload');
const { pathProblem, collisionKey, collidingPaths } = require('./backuprestore');

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
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MONDAY_EPOCH = Date.UTC(1970, 0, 5);   // the first Monday 00:00 UTC after the Unix epoch
const CHUNK_NAME_LEN = 64;
// The longest object key the walker accepts (the coordinator's are about 140: two ids, epoch, period, two 32-hex ids).
const MAX_KEY_LEN = 256;

/** The coordinator's period label for a time: the ISO week of the Monday 00:00 UTC that starts it, "2026-W41". */
function periodOf(ms) {
  const start = MONDAY_EPOCH + Math.floor((ms - MONDAY_EPOCH) / WEEK_MS) * WEEK_MS;
  // ISO week-numbering year: the year of the Thursday of that week.
  const thursday = new Date(start + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / WEEK_MS);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/* The period segment of a coordinator object key (<org>/<account>/<epoch>/<period>/<random>), or null. */
function periodOfKey(key) {
  const parts = typeof key === 'string' ? key.split('/') : [];
  return parts.length === 5 ? parts[3] : null;
}

/* Why a coordinator key cannot stand for a chunk of this context, or null: it must be <org>/<account>/<epoch>/<period>/<random>
   with the context's org, epoch and period. A chunk under another epoch was sealed to another member key, and one
   under another period was named with another naming key: a manifest naming it would not restore. */
function keyProblem(key, ctx) {
  const parts = typeof key === 'string' ? key.split('/') : [];
  if (parts.length !== 5 || parts.some((x) => !x)) return 'not a coordinator object key';
  if (parts[0] !== ctx.org) return `under org ${parts[0]}, not ${ctx.org}`;
  if (parts[2] !== ctx.epoch) return `under key epoch ${parts[2]}, not ${ctx.epoch}`;
  if (parts[3] !== ctx.period) return `in period ${parts[3]}, not ${ctx.period}`;
  return null;
}

/* A folder the deny-list refuses: every folder rule ends in '/', so a bare child name matches exactly those. */
const folderDenied = (rel) => { const d = pathDecision(`${rel}/x`); return d.include ? null : d.why; };

/** Every regular file under root (absolute) the deny-list allows, as sorted '/'-separated relative paths with the
    device and inode seen, and what was skipped (links, denied folders and files, anything not a file or folder, a
    folder that could not be read). Nothing is opened but folders. fs is injectable for tests. */
function listFiles(root, fs = nodeFs, { maxFiles = MAX_FILES, maxSkipped = MAX_SKIPPED } = {}) {
  const files = [];
  const skipped = [];
  let skippedExtra = 0, over = false;
  // Bounded, whatever the tree holds: past maxFiles the walk stops, and skips past maxSkipped are only counted.
  const skip = (x) => { if (skipped.length < maxSkipped) skipped.push(x); else skippedExtra++; };
  const walk = (rel) => {
    if (over) return;
    let names;
    try { names = fs.readdirSync(path.join(root, rel)); } catch { skip({ path: rel || '.', why: 'a folder that could not be read' }); return; }
    for (const name of names.sort()) {
      if (over) return;
      const r = rel ? `${rel}/${name}` : name;
      let st;
      // bigint: device and inode compared exactly (a Number loses precision above 2^53).
      try { st = fs.lstatSync(path.join(root, r), { bigint: true }); } catch { skip({ path: r, why: 'an entry that could not be read' }); continue; }
      if (st.isSymbolicLink()) { skip({ path: r, why: 'a link (links are not followed)' }); continue; }
      if (st.isDirectory()) {
        const why = folderDenied(r);
        if (why) skip({ path: r, why }); else walk(r);
        continue;
      }
      if (!st.isFile()) { skip({ path: r, why: 'not a regular file' }); continue; }
      const d = pathDecision(r);
      if (!d.include) { skip({ path: r, why: d.why }); continue; }
      // A path restore would refuse (engine/backuprestore.js pathProblem) is not stored: it could never come back.
      const problem = pathProblem(r);
      if (problem) { skip({ path: r, why: `${problem}: restore cannot write it` }); continue; }
      files.push({ path: r, dev: st.dev, ino: st.ino, size: Number(st.size) });
      if (files.length > maxFiles) over = true;
    }
  };
  walk('');
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
  if (collidingPaths(kept).size) throw new Error('the walker kept paths restore would refuse as colliding');
  return { files: kept, skipped, skippedExtra, over };
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
    if (st.nlink > 1n) return { why: 'a hard link (another name for it may be outside the work Kosmos)' };
    // The real path, from the path opened; the descriptor's identity already ties it to the file the walk saw.
    const real = fs.realpathSync(abs);
    if (!insideWorkKosmos(real, rootReal)) return { why: 'its real path is outside the work Kosmos' };
    const relReal = path.relative(rootReal, real).split(path.sep).join('/');
    const d = pathDecision(relReal);
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
      if (n === buf.length) return { why: `larger than ${Math.round(maxFile / 1024 / 1024)} MB, too large to scan` };
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
   with the longest key accepted; plus the entry itself and a redaction record (at most secretmask's 11 kinds, about
   530 bytes past the path) or a skip entry, within the fixed 1024.
   So a snapshot is limited to about 20 GB of files under maxFile: past that this bound passes the manifest ceiling
   even where the real manifest would not (at 1 MiB average chunks and real key lengths it is about a tenth). */
function upperBound(f, maxFile) {
  const pathJson = Buffer.byteLength(JSON.stringify(f.path));
  if (f.size > maxFile) return 2 * pathJson + 1024;
  const n = Math.floor((2 * f.size) / CDC.min) + 1;
  return 2 * pathJson + 1024 + n * (CHUNK_NAME_LEN + 3) + n * (CHUNK_NAME_LEN + 6 + MAX_KEY_LEN);
}

/**
 * Take one snapshot.
 *   input: { root, memberPk, namingKey, namingKeyId, deviceKey, ctx, index?, bucket? }
 *     root         the work Kosmos folder (absolute)
 *     memberPk     the member's backup public key (32 bytes), namingKey this period's naming key (32 bytes) and
 *                  namingKeyId its id (backupkeys namingKeyId), deviceKey the device's Ed25519 private KeyObject
 *     ctx          the manifest context { org, member, epoch, period, snapshot }; period must be periodOf(now)
 *     index        this period's chunks stored by earlier runs: Map name -> { key, lockedUntilMs }, all under bucket
 *   deps: { macRequest, fetch?, now?, sleep?, fs?, uploadChunks?, uploadManifest?, batchBytes?, maxFile?, maxManifestJson? }
 * Resolves { ok: true, manifestKey, files, skipped, uploaded, reused, added, bucket } or
 * { ok: false, because, retryLater?, newPeriod?, staleIndex?, tooLarge?, grantSpent?, unsure?, added, bucket }.
 *   newPeriod: a period boundary passed (the context's, or a grant's): start again with the new period's context and
 *     naming key; this input can never succeed.
 *   added (Map name -> { key, lockedUntilMs }) is every chunk this run stored in ctx.period under `bucket`, failed or not.
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
    return fail(`the snapshot failed: ${(err && err.message) || err}`);
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
  if (typeof namingKeyId !== 'string' || !/^[0-9a-f]{32}$/.test(namingKeyId)) return fail('the naming key id must be 32 lowercase hex characters');
  try { checkBackupContext(ctx); } catch (err) { return fail(err.message); }
  const period = periodOf(now());
  // newPeriod, not retryLater: the same input fails again; the caller needs this period's context and naming key.
  if (ctx.period !== period) return fail(`the context names period ${ctx.period}, but this computer's clock is in ${period}`, { newPeriod: true });

  // The index: every entry this period's, with a lock end, under one named bucket. Checked before anything is read.
  const index = input.index instanceof Map ? input.index : new Map();
  if (index.size) {
    if (typeof input.bucket !== 'string' || !input.bucket) return fail('an index of earlier chunks needs the bucket they are stored under', { staleIndex: true });
    for (const [name, e] of index) {
      const why = typeof name !== 'string' || !/^[0-9a-f]{64}$/.test(name) || !e ? 'malformed'
        : keyProblem(e.key, ctx) || (Number.isSafeInteger(e.lockedUntilMs) ? null : 'no lock end');
      if (why) return fail(`the index holds an entry this snapshot cannot name (${why})`, { staleIndex: true });
    }
    state.bucket = input.bucket;
  }
  // Every key this snapshot names, so none is ever named for two chunks (review 5: a repeat across batches, or of an
  // index key, would point two names at one object; on a versioned bucket restore could only open one of them).
  const usedKeys = new Set([...index.values()].map((e) => e.key));
  if (usedKeys.size !== index.size) return fail('the index names one key for two chunks', { staleIndex: true });

  let rootReal;
  try { rootReal = fs.realpathSync(root); } catch { return fail('the work Kosmos folder could not be read'); }
  const listed = listFiles(rootReal, fs);
  if (listed.over) return fail(`the work Kosmos holds more than ${MAX_FILES} files, more than one snapshot can list`, { tooLarge: true });
  // The manifest budget, kept so that NOTHING is uploaded unless the finished manifest is sure to fit (review 3):
  //   estimate  the exact JSON so far (entries, objects, skips), with keys not yet granted charged at MAX_KEY_LEN
  //   reserve   the upper bound of every listed file not yet finished (the current one included)
  // estimate + reserve is an upper bound on the final manifest at every point, and it is checked before each batch.
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
  const tooLargeWhy = () => `the work Kosmos is too large for one snapshot: ${listed.files.length} files, ${Math.round(listedBytes / 2 ** 20)} MB, could make a manifest past its ceiling (one snapshot holds about 20 GB of files)`;
  if (over()) return fail(tooLargeWhy(), { tooLarge: true });
  const files = [], redacted = [];
  const objects = {};        // every referenced chunk: name -> key (filled as chunks are stored or reused)
  const pending = new Map(); // sealed this run, not yet uploaded: name -> object
  let pendingBytes = 0, uploaded = 0, reused = 0;

  // Upload what is pending; on any failure, stop. Keys must be this period's and under one bucket.
  const flush = async () => {
    if (!pending.size) return null;
    // The manifest so far, with every entry this run will add for what is pending, must still fit: stop BEFORE
    // uploading, so a manifest that cannot be stored never leaves locked chunks behind.
    if (over()) return fail(tooLargeWhy(), { tooLarge: true });
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
      for (const [name, key] of stored) if (!keyProblem(key, ctx) && Buffer.byteLength(key) <= MAX_KEY_LEN && Number.isSafeInteger(lockOf(name))) added.set(name, { key, lockedUntilMs: lockOf(name) });
      return fail(index.size ? 'a grant named another bucket than the index\'s: drop the index and take a full snapshot' : 'two grants in one snapshot named different buckets: take a full snapshot', Object.assign({ staleIndex: true }, spent));
    }
    if (r && r.bucket && !state.bucket) state.bucket = r.bucket;
    // Every usable stored chunk is recorded before any failure is returned, so the caller's index keeps it (review 2).
    const wrongPeriod = [];
    let noLock = false, badKey = null;
    for (const [name, key] of stored) {
      if (!pending.has(name)) { badKey = badKey || 'for a chunk this run did not ask to store'; continue; }
      if (usedKeys.has(key)) { badKey = badKey || 'repeats a key already named'; continue; }
      const kp = keyProblem(key, ctx);
      if (kp && kp.startsWith('in period')) { wrongPeriod.push(periodOfKey(key)); continue; }
      if (kp) { badKey = badKey || kp; continue; }
      if (!Number.isSafeInteger(lockOf(name))) { noLock = true; continue; }
      if (Buffer.byteLength(key) > MAX_KEY_LEN) { badKey = badKey || `longer than ${MAX_KEY_LEN} characters`; continue; }
      added.set(name, { key, lockedUntilMs: lockOf(name) });
      usedKeys.add(key);
      objects[name] = key;
      if (pending.has(name)) estimate += Buffer.byteLength(key) - MAX_KEY_LEN;   // charged at MAX_KEY_LEN when it was sealed
    }
    if (badKey) return fail(`a granted key is not one this snapshot can name (${badKey})`, spent);
    if (noLock) return fail('a stored chunk came back without its lock end', spent);
    if (wrongPeriod.length) return fail(`a chunk was granted in period ${wrongPeriod[0]}, not ${ctx.period} (a period boundary passed); start again in the new period`, Object.assign({ newPeriod: true }, spent));
    if (!r || !r.ok) return fail(`chunks could not be uploaded: ${(r && r.because) || 'no answer'}`, Object.assign({}, r && r.retryLater ? { retryLater: true } : {}, r && r.unsure ? { unsure: r.unsure } : {}, spent));
    for (const name of pending.keys()) if (!objects[name]) return fail('the uploader reported success without a key for every chunk');
    uploaded += pending.size;
    pending.clear(); pendingBytes = 0;
    return null;
  };

  for (const f of listed.files) {
    const got = readListed(fs, rootReal, f, maxFile);
    if (!got.buf) { skip({ path: f.path, why: got.why }); reserve -= ub(f); continue; }
    const d = scanFile(f.path, got.buf);
    if (d.action !== 'store') { skip({ path: f.path, why: d.why || 'not stored' }); reserve -= ub(f); continue; }
    const data = d.data;
    // The reserve assumed at most twice the file's size; a copy past that would break the bound, so it is not stored.
    // (The +1 adds no chunk to upperBound's floor(2 * size / CDC.min) + 1: 2 * size + 1 is odd and CDC.min is even.)
    if (data.length > 2 * f.size + 1) { skip({ path: f.path, why: 'its redacted copy is over twice its size' }); reserve -= ub(f); continue; }
    if (d.redacted && d.redacted.length) { redacted.push({ path: f.path, kinds: d.redacted }); estimate += entryBytes(redacted[redacted.length - 1]); }
    const names = [];
    for (const piece of chunkBuffer(data)) {
      const { name, object } = sealNamedChunk(memberPk, namingKey, piece);
      names.push(name);
      if (objects[name] || pending.has(name)) continue;
      const known = index.get(name);
      // Every name this snapshot references gets one objects entry: its JSON is counted once, here.
      estimate += CHUNK_NAME_LEN + 6 + (known ? Buffer.byteLength(known.key) : MAX_KEY_LEN);
      if (known) { objects[name] = known.key; reused++; continue; }
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
  if (!chunks.length) return fail('there is nothing to back up: no file with content was found (a manifest must name at least one chunk)');
  const manifest = {
    format: FORMAT, takenAt: new Date(now()).toISOString(), namingKeyId,
    files, objects, redacted, skipped, skippedNotListed: skippedExtra,
  };
  const sealed = sealManifest(memberPk, deviceKey, ctx, manifest);
  const m = await putManifest(deps, sealed, { bucket: state.bucket, chunks });
  if (!m || !m.ok) {
    // outlastsChunks: the index's chunks lock out too soon for this manifest (a period passed): they cannot be named.
    return fail(`the manifest could not be uploaded: ${(m && m.because) || 'no answer'}`, Object.assign({},
      m && m.retryLater ? { retryLater: true } : {}, m && m.unsure ? { unsure: m.unsure } : {},
      m && m.outlastsChunks ? { staleIndex: true } : {}, m && m.grantSpent !== undefined ? { grantSpent: m.grantSpent } : {}));
  }
  return { ok: true, manifestKey: m.key, files: files.length, skipped: skipped.length + skippedExtra, uploaded, reused, added, bucket: state.bucket };
}

module.exports = { periodOf, periodOfKey, listFiles, takeSnapshot, MAX_FILE, BATCH_BYTES, MAX_FILES };
