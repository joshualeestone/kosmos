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

const cache = new Map();     // path -> { key, sha256 }
const queue = [];            // [{ path, key }]
const queued = new Set();    // path + key, so one file is queued once
let running = false;
let onHashed = null;         // test seam: called after each file is hashed or given up

const keyOf = (st) => [st.dev, st.ino, st.size, st.mtimeMs, st.ctimeMs].join(':');

/** The fingerprint already known for this file as it is now (its stat), or null. Never reads the file. */
function known(path, st) {
  const hit = cache.get(path);
  return hit && st && hit.key === keyOf(st) ? hit.sha256 : null;
}

/** Ask for this file to be fingerprinted in the background. Returns at once. */
function want(path, st) {
  if (!st || typeof st.isFile !== 'function' || !st.isFile() || st.size > MAX_BYTES) return;
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
  // O_NOFOLLOW (undefined-safe on win32): a file swapped for a link after the list read it is not followed.
  const fh = await fs.promises.open(job.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const before = await fh.stat();
    if (!before.isFile() || keyOf(before) !== job.key) return;   // changed since it was listed: the next poll asks again
    const h = crypto.createHash('sha256');
    const buf = Buffer.alloc(1024 * 1024);
    for (let pos = 0; pos < before.size;) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, before.size - pos), pos);
      if (bytesRead <= 0) return;
      h.update(buf.subarray(0, bytesRead));
      pos += bytesRead;
    }
    const after = await fh.stat();
    if (keyOf(after) !== job.key) return;   // written to while it was read: never cache a mix of two versions
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

function _resetForTest() { cache.clear(); queue.length = 0; queued.clear(); }
function _onHashedForTest(fn) { onHashed = fn || null; }
function _idleForTest() { return !running && queue.length === 0; }

module.exports = { MAX_BYTES, known, want, forRow, keyOf, _resetForTest, _onHashedForTest, _idleForTest };
