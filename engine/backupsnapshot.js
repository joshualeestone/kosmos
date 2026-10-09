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
 * (<org>/<account>/<epoch>/<period>/<random>); a key from another period (a boundary crossed between naming and
 * granting) stops the run, retry later. The manifest's own grant may land in the next period: the coordinator
 * locks last-day chunk grants to the next period's date for exactly that case.
 *
 * Links are never followed (a followed link needs a check-then-read, and a folder link can loop): each is recorded
 * as skipped. Every file read is also checked by its real path (backupscan insideWorkKosmos), so a folder swapped
 * for a link during the walk cannot pull a file from outside the work Kosmos.
 *
 * Not here: key storage (the member public key, the naming key and the device key are inputs), persisting the period
 * index (the caller keeps it: `added` is returned on every result, failed or not), the schedule and freshness.
 */
const crypto = require('crypto');
const nodeFs = require('fs');
const path = require('path');
const { chunkBuffer, sealNamedChunk, sealManifest, checkBackupContext } = require('./backupformat');
const { scanFile, insideWorkKosmos } = require('./backupscan');
const { uploadChunks, uploadManifest } = require('./backupupload');

const FORMAT = 1;
// A file is read whole to be scanned (backupscan works on one buffer), so a bigger one is skipped, and says so.
const MAX_FILE = 256 * 1024 * 1024;
// Sealed chunk bytes held before a batch is uploaded: bounds memory, whatever the snapshot's size.
const BATCH_BYTES = 64 * 1024 * 1024;
const MAX_SKIPPED = 100000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MONDAY_EPOCH = Date.UTC(1970, 0, 5);   // the first Monday 00:00 UTC after the Unix epoch

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

/** Every regular file under root (absolute), as sorted '/'-separated relative paths, and the entries skipped (links,
    anything not a file or folder, a folder that could not be read). fs is injectable for tests. Never follows a link. */
function listFiles(root, fs = nodeFs) {
  const files = [], skipped = [];
  const walk = (rel) => {
    let names;
    try { names = fs.readdirSync(path.join(root, rel)); } catch { skipped.push({ path: rel || '.', why: 'a folder that could not be read' }); return; }
    for (const name of names.sort()) {
      const r = rel ? `${rel}/${name}` : name;
      let st;
      try { st = fs.lstatSync(path.join(root, r)); } catch { skipped.push({ path: r, why: 'an entry that could not be read' }); continue; }
      if (st.isSymbolicLink()) skipped.push({ path: r, why: 'a link (links are not followed)' });
      else if (st.isDirectory()) walk(r);
      else if (st.isFile()) files.push(r);
      else skipped.push({ path: r, why: 'not a regular file' });
    }
  };
  walk('');
  return { files: files.sort(), skipped };
}

const isKey32 = (b) => Buffer.isBuffer(b) && b.length === 32;

/**
 * Take one snapshot.
 *   input: { root, memberPk, namingKey, namingKeyId, deviceKey, ctx, index?, bucket? }
 *     root         the work Kosmos folder (absolute)
 *     memberPk     the member's backup public key (32 bytes), namingKey this period's naming key (32 bytes) and
 *                  namingKeyId its id (backupkeys namingKeyId), deviceKey the device's Ed25519 private KeyObject
 *     ctx          the manifest context { org, member, epoch, period, snapshot }; period must be periodOf(now)
 *     index        this period's chunks stored by earlier runs: Map name -> { key, lockedUntilMs }, all under bucket
 *   deps: { macRequest, fetch?, now?, sleep?, fs?, uploadChunks?, uploadManifest?, batchBytes?, maxFile? }
 * Resolves { ok: true, manifestKey, files, skipped, uploaded, reused, added, bucket } or
 * { ok: false, because, retryLater?, unsure?, added, bucket }. `added` (Map name -> { key, lockedUntilMs }) is every chunk
 * this run stored, failed or not, for the caller's index. Never throws.
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
  if (typeof root !== 'string' || !path.isAbsolute(root)) return fail('the work Kosmos folder must be an absolute path');
  if (!isKey32(memberPk) || !isKey32(namingKey)) return fail('the member key and the naming key must be 32-byte Buffers');
  if (typeof namingKeyId !== 'string' || !/^[0-9a-f]{32}$/.test(namingKeyId)) return fail('the naming key id must be 32 lowercase hex characters');
  try { checkBackupContext(ctx); } catch (err) { return fail(err.message); }
  const period = periodOf(now());
  if (ctx.period !== period) return fail(`the context names period ${ctx.period}, but this computer's clock is in ${period}`, { retryLater: true });
  const index = input.index instanceof Map ? input.index : new Map();
  state.bucket = index.size ? (typeof input.bucket === 'string' && input.bucket ? input.bucket : null) : null;
  if (index.size && !state.bucket) return fail('an index of earlier chunks needs the bucket they are stored under');

  let rootReal;
  try { rootReal = fs.realpathSync(root); } catch { return fail('the work Kosmos folder could not be read'); }
  const listed = listFiles(rootReal, fs);
  const skipped = listed.skipped.slice();
  const files = [], redacted = [];
  const objects = {};        // every referenced chunk: name -> key (filled as chunks are stored or reused)
  const pending = new Map(); // sealed this run, not yet uploaded: name -> object
  let pendingBytes = 0, uploaded = 0, reused = 0;

  // Upload what is pending; on any failure, stop. The keys must be this period's and under one bucket.
  const flush = async () => {
    if (!pending.size) return null;
    const batch = [...pending].map(([name, object]) => ({ name, object }));
    const r = await putChunks(deps, batch);
    if (r && r.bucket && !state.bucket) state.bucket = r.bucket;
    const stored = (r && r.keys instanceof Map) ? r.keys : new Map();
    if (r && r.bucket && r.bucket !== state.bucket) return fail('a grant named another bucket than this period\'s earlier chunks; retry later', { retryLater: true });
    for (const [name, key] of stored) {
      const lockedUntilMs = r.lockedUntil instanceof Map ? r.lockedUntil.get(name) : undefined;
      if (periodOfKey(key) !== ctx.period) return fail(`a chunk was granted in period ${periodOfKey(key)}, not ${ctx.period} (a period boundary passed); retry later`, { retryLater: true });
      if (!Number.isSafeInteger(lockedUntilMs)) return fail('a stored chunk came back without its lock end');
      added.set(name, { key, lockedUntilMs });
      objects[name] = key;
    }
    if (!r || !r.ok) return fail(`chunks could not be uploaded: ${(r && r.because) || 'no answer'}`, Object.assign({}, r && r.retryLater ? { retryLater: true } : {}, r && r.unsure ? { unsure: r.unsure } : {}));
    uploaded += pending.size;
    pending.clear(); pendingBytes = 0;
    return null;
  };

  for (const rel of listed.files) {
    const abs = path.join(rootReal, rel);
    let buf;
    try {
      const st = fs.statSync(abs);
      if (st.size > maxFile) { skipped.push({ path: rel, why: `larger than ${Math.round(maxFile / 1024 / 1024)} MB, too large to scan` }); continue; }
      const real = fs.realpathSync(abs);
      if (!insideWorkKosmos(real, rootReal)) { skipped.push({ path: rel, why: 'its real path is outside the work Kosmos' }); continue; }
      buf = fs.readFileSync(real);
    } catch { skipped.push({ path: rel, why: 'a file that could not be read' }); continue; }
    const d = scanFile(rel, buf);
    if (d.action !== 'store') { skipped.push({ path: rel, why: d.why || 'not stored' }); continue; }
    const data = d.data;
    if (d.redacted && d.redacted.length) redacted.push({ path: rel, kinds: d.redacted });
    const names = [];
    for (const piece of chunkBuffer(data)) {
      const { name, object } = sealNamedChunk(memberPk, namingKey, piece);
      names.push(name);
      if (objects[name] || pending.has(name)) continue;
      const known = index.get(name);
      if (known) { objects[name] = known.key; reused++; continue; }
      pending.set(name, object); pendingBytes += object.length;
      if (pendingBytes >= batchBytes) { const stop = await flush(); if (stop) return stop; }
    }
    files.push({ path: rel, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), chunks: names });
  }
  const stop = await flush();
  if (stop) return stop;

  // Every chunk a file names, with its key and lock end, for the manifest uploader's checks.
  const chunks = [];
  for (const name of Object.keys(objects)) {
    const e = added.get(name) || index.get(name);
    chunks.push({ key: e.key, lockedUntilMs: e.lockedUntilMs });
  }
  if (!chunks.length && files.length) return fail('files were stored but no chunk is known for them');
  const manifest = {
    format: FORMAT, takenAt: new Date(now()).toISOString(), namingKeyId,
    files, objects, redacted, skipped: skipped.slice(0, MAX_SKIPPED), skippedNotListed: Math.max(0, skipped.length - MAX_SKIPPED),
  };
  const sealed = sealManifest(memberPk, deviceKey, ctx, manifest);
  if (!state.bucket) return fail('nothing was granted, so the manifest has no bucket to go to (an empty work Kosmos?)');
  const m = await putManifest(deps, sealed, { bucket: state.bucket, chunks });
  if (!m || !m.ok) return fail(`the manifest could not be uploaded: ${(m && m.because) || 'no answer'}`, Object.assign({}, m && m.retryLater ? { retryLater: true } : {}, m && m.unsure ? { unsure: m.unsure } : {}, m && m.outlastsChunks ? { outlastsChunks: true } : {}));
  return { ok: true, manifestKey: m.key, files: files.length, skipped: skipped.length, uploaded, reused, added, bucket: state.bucket };
}

module.exports = { periodOf, periodOfKey, listFiles, takeSnapshot, MAX_FILE, BATCH_BYTES };
