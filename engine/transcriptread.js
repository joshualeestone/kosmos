'use strict';

/**
 * Reading Claude Code transcripts for their token counts: each file read incrementally, each message counted once.
 * Moved out of engine/swarm.js for kosmos#6309, unchanged, so that a module that only counts (the usage cap's worker
 * thread) need not load the engine: this file requires node's own modules only. engine/swarm.js re-exports it.
 */

const fs = require('node:fs');

const READ_CHUNK_BYTES = 4 * 1024 * 1024;
const READ_PER_CALL_BYTES = 64 * 1024 * 1024;
let readPerCallBytes = READ_PER_CALL_BYTES;   // resetForTests can lower it

/* The four token counts Claude reports, summed. One definition for the limit, the
   ratio and the display. */
function tokensOf(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  let t = 0;
  for (const k of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) {
    if (Number.isFinite(usage[k]) && usage[k] > 0) t += usage[k];
  }
  return t;
}

/* Per-file state, read INCREMENTALLY: a working lead's transcript grows all the time, and a
   board poll must not re-parse tens of megabytes to count the last few lines. Each entry keeps
   the byte offset read to, the running tokens, the message ids already counted, whether the
   last assistant message ended the turn, and the unfinished tail of a line cut at the offset.
   A file that shrank is read again from the start; on a new day (a different `since`) the count starts
   again at zero from where the read had got to, since every line before it is from an earlier day.
   Bounded: entries not touched for a day are dropped. */
const fileCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function freshEntry(since) {
  return { since, offset: 0, tokens: 0, seen: new Set(), finished: false, tail: Buffer.alloc(0), mtimeMs: 0, touched: 0 };
}

/* A stopped helper's file ends with this user line (measured, Claude Code 2.1.282,
   2026-09-25, after "stop all agents"), so it is not working even though it never
   wrote `end_turn`. */
const INTERRUPTED = '[Request interrupted by user';
function isInterruptedLine(j) {
  if (!j || j.type !== 'user' || !j.message) return false;
  const c = j.message.content;
  if (typeof c === 'string') return c.startsWith(INTERRUPTED);
  return Array.isArray(c) && c.some((b) => b && b.type === 'text' && typeof b.text === 'string' && b.text.startsWith(INTERRUPTED));
}

/* One transcript file: tokens written since `since`, and whether it has finished (its last
   assistant message ended the turn). Never throws.
   🛑 EACH MESSAGE COUNTS ONCE. Claude Code writes one line per content block, and every line
   of one message carries the same `message.id` and the same `usage` (measured on this Mac: 2660
   assistant lines, 1191 ids; summing lines overcounted 2.23x). So usage is added once per id. */
function readFile(file, since, now = Date.now(), budget = { left: readPerCallBytes }, cache = fileCache) {
  let st;
  try { st = fs.statSync(file); } catch { return { tokens: 0, finished: true, mtimeMs: 0, caughtUp: false }; }
  /* kosmos#6309: a caller counting from another `since` (the usage cap's month) passes its own cache: sharing this one
     would reset the day's count to zero on every alternate call, and the month's on the others. */
  let e = cache.get(file);
  /* A `since` that moved EARLIER (the day's start after a zone change) needs lines already passed, so the file is read
     again from the start. */
  if (!e || st.size < e.offset || since < e.since) {
    // A file read again from the start gives back the ids it counted, or a caller's shared set would skip them all.
    if (e && cache.sharedSeen instanceof Set) for (const id of e.seen) cache.sharedSeen.delete(id);
    e = freshEntry(since);
  }
  else if (e.since !== since) { e.since = since; e.tokens = 0; }   // a new day: earlier lines add nothing, so keep the position
  if (st.size > e.offset) {
    const take = (text) => {
      for (const line of text.split('\n')) {
        if (!line) continue;
        let j;
        try { j = JSON.parse(line); } catch { continue; }
        if (isInterruptedLine(j)) { e.finished = true; continue; }
        if (j.type !== 'assistant' || !j.message || typeof j.message !== 'object') continue;
        e.finished = j.message.stop_reason === 'end_turn';
        const id = typeof j.message.id === 'string' && j.message.id ? j.message.id : null;
        /* kosmos#6309: a caller whose cache carries `sharedSeen` counts each message once across all its files. A resumed
           or forked session copies earlier messages into its new file (measured: 10,459 of 180,614 ids this month, a
           5.68% overcount on a monthly cap). */
        const seen = cache.sharedSeen instanceof Set ? cache.sharedSeen : e.seen;
        if (id && seen.has(id)) continue;
        if (id) { seen.add(id); if (seen !== e.seen) e.seen.add(id); }   // e.seen: the ids this file counted
        const at = Date.parse(j.timestamp || '');
        if (Number.isFinite(at) && at >= since) e.tokens += tokensOf(j.message.usage);
      }
    };
    /* Bounded reads: READ_CHUNK_BYTES at a time, and at most `budget.left` bytes, a budget the
       whole meter() call shares (READ_PER_CALL_BYTES), so one board poll reads a bounded amount
       however many files are behind; the rest catch up over the next polls. Lines are cut at
       the byte 0x0A, so a character is never split, and the offset moves only past bytes read. */
    let fd = null;
    try {
      fd = fs.openSync(file, 'r');
      const stop = Math.min(st.size, e.offset + Math.max(0, budget.left));
      while (e.offset < stop) {
        const buf = Buffer.alloc(Math.min(READ_CHUNK_BYTES, stop - e.offset));
        const n = fs.readSync(fd, buf, 0, buf.length, e.offset);
        if (n <= 0) break;
        const data = e.tail.length ? Buffer.concat([e.tail, buf.subarray(0, n)]) : buf.subarray(0, n);
        const cut = data.lastIndexOf(0x0a);
        if (cut >= 0) take(data.subarray(0, cut).toString('utf8'));
        e.tail = Buffer.from(cut >= 0 ? data.subarray(cut + 1) : data);
        e.offset += n;
        budget.left -= n;
      }
    } catch { /* the offset stays after the last chunk read, so the next poll resumes there */ }
    finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* already closed */ } } }
  }
  e.mtimeMs = st.mtimeMs;
  e.touched = now;
  cache.set(file, e);
  /* Only the swarm's own cache is swept. A caller's cache (kosmos#6309: the usage cap's month, cleared each month) can
     hold every transcript of a month, and sweeping it on each of those reads is a pass over the whole map per file. */
  if (cache === fileCache && cache.size > 256) {
    for (const [k, v] of cache) if (now - v.touched > CACHE_TTL_MS) cache.delete(k);
  }
  return { tokens: e.tokens, finished: e.finished, mtimeMs: e.mtimeMs, caughtUp: e.offset >= st.size };
}

/** The per-call read budget now (resetForTests can lower it). */
function perCallBytes() { return readPerCallBytes; }

function resetForTests({ perCallBytes: n } = {}) {
  fileCache.clear();
  readPerCallBytes = n > 0 ? n : READ_PER_CALL_BYTES;
}

module.exports = { READ_CHUNK_BYTES, READ_PER_CALL_BYTES, tokensOf, readFile, perCallBytes, resetForTests };
