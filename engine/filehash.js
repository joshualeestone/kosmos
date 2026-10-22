'use strict';
/**
 * #6761 (a feedback report: a revised file handed over by an agent can be mistaken for an earlier version): the
 * sha256 FINGERPRINT shown beside a file in a Files list.
 *
 * A Files list is read on every 5-second poll, so a fingerprint is never computed on the request: `known(path, st)`
 * answers only what is already cached and `want(path, st)` queues the file to be hashed in the background, one file at
 * a time, by streaming it (never read whole). The cache is keyed by the file's identity as stat sees it (device,
 * inode, size, modification and change times), so an unchanged file is read once and a changed one is read again.
 * A file over MAX_BYTES is not fingerprinted: its row shows nothing rather than a guess. A file that changes WHILE it
 * is hashed is not cached (its stat before and after must match), so a fingerprint never describes bytes that are no
 * longer there.
 *
 * Process memory only: a restarted board hashes again, in the background.
 */
const fs = require('node:fs');
const crypto = require('node:crypto');

const MAX_BYTES = 512 * 1024 * 1024;
const CACHE_MAX = 5000;      // fingerprints kept; the oldest go first
const QUEUE_MAX = 2000;      // files waiting to be hashed; past it, new ones wait for a later poll
/* Iteration 1 (measured: a 200 MB file appended to every 200 ms cost 1.8 GB of reads in 10 s, and was never cached):
   a file is hashed only once it has SETTLED (not written in the last SETTLE_MS), and a file that changed while it was
   read is not tried again for BACKOFF_MS. A growing log or a recording being written gets its fingerprint when it stops. */
let SETTLE_MS = 5000;
const PLACEHOLDER_MIN = 1024 * 1024;   // a file this big with no blocks here is taken for a cloud placeholder
const BACKOFF_MS = 60 * 1000;
const backoff = new Map();   // path -> time before which it is not tried again

const cache = new Map();     // path -> { key, sha256 }
const queue = [];            // [{ path, key }]
const queued = new Set();    // path + key, so one file is queued once
let running = false;
let onHashed = null;         // test seam: called after each file is hashed or given up

/* Undefined on win32 (#1732 fs-const-platform-flag): ORed in undefined-safe. The before/after identity check in hashOne
   (the listed dev:ino, size and times) refuses a swapped file on every platform; the kernel flags are a second guard. */
const FP_NOFOLLOW = fs.constants.O_NOFOLLOW;
const FP_NONBLOCK = fs.constants.O_NONBLOCK;
const OPEN_FLAGS = fs.constants.O_RDONLY | (FP_NOFOLLOW || 0) | (FP_NONBLOCK || 0);
const READ_BUF = Buffer.allocUnsafe(1024 * 1024);   // only the bytes each read fills are hashed
const keyOf = (st) => [st.dev, st.ino, st.size, st.mtimeMs, st.ctimeMs].join('|');   // '|', not ':' (#1732 reserves ':' for path lists)

/** The fingerprint already known for this file as it is now (its stat), or null. Never reads the file. */
function known(path, st) {
  const hit = cache.get(path);
  if (!(hit && st && hit.key === keyOf(st))) return null;
  cache.delete(path); cache.set(path, hit);   // iteration 1: least recently SHOWN goes first, not least recently hashed
  return hit.sha256;
}

/** Ask for this file to be fingerprinted in the background. Returns at once. */
function want(path, st) {
  if (!st || typeof st.isFile !== 'function' || !st.isFile() || st.size > MAX_BYTES) return;
  /* Iteration 3: a cloud-only placeholder (iCloud Drive, a file provider) reports its full size but holds no blocks here;
     reading it would make the system download the whole file because a list was shown. It gets no fingerprint. Whether
     Windows reports a OneDrive placeholder's blocks as 0 (libuv derives them from the allocation size) is NOT measured
     here: if it does, this catches it there too; if not, the plan records the gap. */
  // Iteration 4: only from 1 MiB, so a small file stored inline or compressed (no blocks of its own) is still fingerprinted.
  if (Number.isFinite(st.blocks) && st.blocks === 0 && st.size >= PLACEHOLDER_MIN) return;
  const now = Date.now();
  /* Iteration 2: settled by the CHANGE time only, which the kernel sets on every write and no one can set: a modification
     time in the future (cp -p or an archive from a fast clock, touch -d) would otherwise keep a file unhashed until then. */
  if (SETTLE_MS > 0 && now - st.ctimeMs < SETTLE_MS) return;   // still being written: a later poll asks again
  if ((backoff.get(path) || 0) > now) return;
  backoff.delete(path);
  const key = keyOf(st);
  if (known(path, st) || queued.has(path + '\0' + key) || queue.length >= QUEUE_MAX) return;
  queued.add(path + '\0' + key);
  queue.push({ path, key });
  if (!running) setImmediate(drain);
}

function remember(path, key, sha256) {
  cache.delete(path);
  cache.set(path, { key, sha256 });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

async function hashOne(job) {
  // A file swapped for a link after the list read it is not followed; a FIFO swapped in does not block.
  const fh = await fs.promises.open(job.path, OPEN_FLAGS);
  try {
    const before = await fh.stat();
    if (!before.isFile() || keyOf(before) !== job.key) return;   // changed since it was listed: the next poll asks again
    const h = crypto.createHash('sha256');
    const buf = READ_BUF;   // iteration 9: one buffer, reused (drain hashes one file at a time)
    for (let pos = 0; pos < before.size;) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, before.size - pos), pos);
      if (bytesRead <= 0) return;
      h.update(buf.subarray(0, bytesRead));
      pos += bytesRead;
    }
    const after = await fh.stat();
    if (keyOf(after) !== job.key) {   // written to while it was read: never cache a mix of two versions
      backoff.set(job.path, Date.now() + BACKOFF_MS);
      while (backoff.size > CACHE_MAX) backoff.delete(backoff.keys().next().value);
      return;
    }
    remember(job.path, job.key, h.digest('hex'));
  } finally {
    await fh.close().catch(() => {});
  }
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      try { await hashOne(job); } catch { /* unreadable or gone: no fingerprint, and the next poll may ask again */ }
      queued.delete(job.path + '\0' + job.key);
      if (onHashed) onHashed(job.path);
    }
  } finally { running = false; }
}

/** For a list row: the fingerprint if known, and the file queued if not. */
function forRow(path, st) {
  const sha = known(path, st);
  if (!sha) want(path, st);
  return sha;
}

function _resetForTest() { cache.clear(); queue.length = 0; queued.clear(); backoff.clear(); }
function _settleForTest(ms) { SETTLE_MS = ms == null ? 5000 : ms; }
function _onHashedForTest(fn) { onHashed = fn || null; }
function _idleForTest() { return !running && queue.length === 0; }

module.exports = { MAX_BYTES, BACKOFF_MS, known, want, forRow, keyOf, _resetForTest, _settleForTest, _onHashedForTest, _idleForTest };
