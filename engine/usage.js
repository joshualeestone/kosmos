'use strict';

/**
 * Real, per-model, per-day token usage (#853).
 *
 * `readContext` (status.js) answers a different question: how full is an
 * agent's context window RIGHT NOW, from the LAST usage entry in ONE
 * transcript. That does not accumulate, drops on compaction, and never sees
 * a forked subagent's own transcript. This module answers the one #853 asks
 * for instead: how many tokens did every agent, of every model, actually use
 * today (and on past days), summed across EVERY transcript that exists.
 *
 * ⚠️ FOUR BUCKETS, NEVER BLENDED. input_tokens, output_tokens,
 * cache_creation_input_tokens and cache_read_input_tokens travel separately
 * through this entire module. A real day's numbers (Splinter's own sweep,
 * 25 Aug): 277,370,124 real work against 18,200,439,453 cache reads -- a
 * blended sum is off by ~66x and looks plausible on sight, which is worse
 * than an obviously wrong number. Nothing in this file sums the four
 * buckets; that choice belongs to whatever calls this and can say what it
 * summed and why.
 *
 * Bucketed by UTC CALENDAR DAY, because every transcript timestamp is
 * already UTC (`2026-08-25T13:40:02.891Z`) -- bucketing by UTC is the
 * unambiguous read of the data actually stored. A caller wanting Central-
 * time days (or any other zone) is a display-layer choice for whoever
 * builds on this, not a conversion this module makes silently.
 *
 * Root discovery is `status.configRoots()`, reused rather than re-derived:
 * it already walks every `~/.claude*` directory carrying a `projects/`
 * folder, so a new account root added later is picked up automatically. A
 * private second implementation of "where do the transcripts live" is
 * exactly the class of bug this codebase calls its worst-shipped one
 * (status.js's own comment on `readModel`), and Splinter's own three-
 * config-dir miss tonight was a manual sweep that had no such reuse to
 * lean on.
 */

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { configRoots } = require('./status');
const store = require('./store');

const usageDir = () => path.join(store.ROOT, 'usage');

// Claude Code stamps `"model":"<synthetic>"` on rows it writes itself (a
// usage-limit notice among them), and those rows can carry a `usage` object
// that is not the agent's own. status.js's readContext already excludes
// these by regex on the raw line; matched identically here rather than
// re-derived, for the reason above.
const SYNTHETIC_ROW = /"model":"<[^"]*>"/;

const BUCKET_FIELDS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];

function emptyBuckets() {
  return { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 0 };
}

/**
 * Every transcript file under one config root: each top-level
 * `projects/<dir>/<sessionId>.jsonl`, plus every subagent transcript
 * nested under `projects/<dir>/<sessionId>/subagents/**\/*.jsonl` --
 * walked recursively, because a subagent's own `spawnDepth` field implies
 * a subagent can itself spawn a subagent, one directory deeper each time.
 *
 * ⚠️ ASYNC, NOT fs.*Sync. Directory listings are cheap, but this walk sits
 * directly ahead of `scanUsage` reading potentially hundreds of files into
 * the tens of MB each -- async here (and throughout the read path below)
 * lets Node's event loop interleave other requests (agent status polling
 * included) between reads, rather than a synchronous call blocking the
 * ENTIRE single-threaded server for the walk's duration. Found in review:
 * the first version used fs.*Sync throughout and would have stalled every
 * other route on this server for as long as a scan took.
 */
async function walkTranscriptsUnder(root) {
  const projects = path.join(root, 'projects');
  let projectDirs;
  try { projectDirs = await fsp.readdir(projects, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) continue;
    const projectPath = path.join(projects, projectDir.name);
    let entries;
    try { entries = await fsp.readdir(projectPath, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const entryPath = path.join(projectPath, entry.name);
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(entryPath);
      } else if (entry.isDirectory()) {
        // ⚠️ SCOPED TO subagents/ TREES SPECIFICALLY, not "any directory
        // found here". `projects/` can hold entries that are not session
        // directories at all -- confirmed on this machine: sibling
        // directories named `memory`, `memory.pre-merge-...`, etc. sit at
        // this same level. They carry no .jsonl today, so an unscoped
        // recursive walk happened to come out right by accident; nothing
        // enforced that boundary, and a future file landing in one of them
        // would have been silently folded into a day's totals if it merely
        // looked usage-shaped. Only a subdirectory actually named
        // `subagents` is walked -- the one real shape a session directory
        // carries.
        await walkSubagentsTree(entryPath, files);
      }
    }
  }
  return files;
}

/** Only the `subagents/` child of a session directory, never its other contents. */
async function walkSubagentsTree(sessionDir, out) {
  let entries;
  try { entries = await fsp.readdir(sessionDir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name === 'subagents') {
      await walkJsonlRecursive(path.join(sessionDir, entry.name), out);
    }
  }
}

/**
 * Everything under a subagents/ tree, recursively -- a nested sub-subagent
 * (spawnDepth 2+) puts its own subagents/ directory one level deeper, so
 * this keeps recursing into ANY directory once already inside a
 * subagents/ tree (unlike walkSubagentsTree, which only enters one by
 * name at the session-directory level).
 */
async function walkJsonlRecursive(dir, out) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkJsonlRecursive(entryPath, out);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(entryPath);
  }
}

/** The UTC calendar day (YYYY-MM-DD) a transcript row's timestamp falls on. */
function utcDay(isoTimestamp) {
  return typeof isoTimestamp === 'string' && isoTimestamp.length >= 10 ? isoTimestamp.slice(0, 10) : null;
}

/**
 * Scan every transcript across every config root for rows whose UTC day is
 * within [sinceDay, untilDay] (both YYYY-MM-DD, inclusive), and accumulate
 * the four token buckets per (day, model).
 *
 * ⚠️ MALFORMED LINES ARE SKIPPED, NOT FATAL. A transcript can be mid-write
 * (the agent that owns it may be running right now); a truncated last line
 * must not lose every other line in the file.
 *
 * Returns `{ days: { [date]: { [model]: bucketed } }, rootsRead: [...] }`
 * -- the roots list travels with the result so a caller can say "N of N
 * config roots read" rather than imply completeness it cannot back up.
 */
async function scanUsage({ sinceDay, untilDay }) {
  /* Scan-wide, not per file: a message id identifies one assistant message
     across the whole read, and the same message can appear in more than one
     file (a session transcript and a resumed copy of it). Per-file dedup would
     leave that case counted twice. */
  const seenIds = new Set();
  const roots = configRoots();
  const days = {};
  for (const root of roots) {
    for (const file of await walkTranscriptsUnder(root)) {
      let text;
      try { text = await fsp.readFile(file, 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line || SYNTHETIC_ROW.test(line)) continue;
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        const message = row && row.message;
        const usage = message && message.usage;
        if (!usage) continue;
        const day = utcDay(row.timestamp);
        if (!day) continue;
        if (sinceDay && day < sinceDay) continue;
        if (untilDay && day > untilDay) continue;
            /* 🛑 ONE MESSAGE IS COUNTED ONCE, NOT ONCE PER LINE THAT MENTIONS IT.
               A transcript writes the SAME assistant message's usage on more than one
               line, with identical numbers. Measured 2026-08-27 across 40 transcripts
               on this machine: 27,139 usage-bearing rows carrying only 12,169 distinct
               message ids, a ratio of 2.23; of the repeats, 9,256 were identical and
               ZERO differed. They are not increments to add up, they are the same fact
               restated, and summing them multiplied every token count by about 2.2.
               ⇒ NOT A ROUNDING PROBLEM. This figure feeds a dollar amount on a page
               shown to people, and a number 2.2x too large reads as an achievement
               rather than an error, so nobody challenges it. Caught only because a
               second surface existed to disagree: the published tokens page reported
               FEWER output tokens over 38 days than this engine reported over 7, which
               is impossible on one population.
               ⚠️ A row with no message id cannot be deduplicated and is still counted:
               dropping it would trade an overcount for a SILENT undercount. */
            if (message.id) {
              if (seenIds.has(message.id)) continue;
              seenIds.add(message.id);
            }
        const model = message.model || 'unknown';
        if (!days[day]) days[day] = {};
        if (!days[day][model]) days[day][model] = emptyBuckets();
        const bucket = days[day][model];
        for (const field of BUCKET_FIELDS) bucket[field] += Number(usage[field]) || 0;
        bucket.rows += 1;
      }
    }
  }
  return { days, rootsRead: roots };
}

async function ensureUsageDir() {
  await fsp.mkdir(usageDir(), { recursive: true });
  return usageDir();
}

function frozenDayPath(day) {
  // day is always a YYYY-MM-DD string produced by utcDay()/todayUtc(), never
  // caller-supplied, so no path-traversal guard is needed the way safeKey()
  // guards an untrusted agent name elsewhere in this codebase.
  /* 🛑 THE `.v2` IS A CACHE INVALIDATION AND IT IS LOAD-BEARING. Every frozen
     file written before the message-id deduplication above holds a figure about
     TEN TIMES too large, and a completed day is never rescanned once frozen. So
     shipping the dedup alone would fix today and leave every past day wrong
     forever, which is the worse failure: a number that is right at the front and
     wrong behind it invites nobody to check.
     Versioning the FILENAME rather than adding a field inside means old files
     are simply never read again. No migration, no shape change, and if this
     count is ever corrected again the next author bumps one string. The orphans
     are small JSON and harmless; deleting them is a separate tidy, not a
     correctness step. */
  return path.join(usageDir(), `${day}.v2.json`);
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Per-day, per-model usage for the last `days` UTC calendar days
 * (including today). A day strictly before today is scanned once and
 * frozen to disk, so a repeat request for that SAME day never re-sums it.
 *
 * ⚠️ THIS IS NOT A FULL-CORPUS CACHE, AND SAYING SO WOULD BE DISHONEST.
 * Transcripts are not date-partitioned -- there is no way to know a file
 * holds nothing for "today" without reading it -- so `scanUsage` still
 * reads and JSON.parses every line of every transcript across every
 * config root on every call that has ANY missing day (today always
 * qualifies, since it's never frozen). The freeze only saves the
 * ACCUMULATION work for days already on disk; it does not save the I/O.
 * A stats page polling this on a live schedule will still cost real time
 * and real disk I/O on this machine's volumes (hundreds of transcripts,
 * individual files into the tens of MB) on every call. What this DOES
 * avoid, because every read on this path is async (fs.promises, not
 * fs.*Sync): it does not block Node's single event loop while doing so --
 * without that, every OTHER route on this server (agent status polling
 * included) would stall for the scan's full duration, found in review as
 * a real, not hypothetical, consequence of the first synchronous version.
 * A genuinely cheaper re-scan (a persistent per-file byte-offset cursor,
 * so an already-fully-read file only has its NEW bytes reparsed next
 * time) is out of scope for this card -- a separate piece of work, not a
 * corner cut here, and distinct from the event-loop-blocking fix above.
 *
 * The scan range is narrowed to the missing days' own span (not the full
 * requested window), so at least the ACCUMULATION and per-day freeze work
 * scoped to `wanted` isn't wasted on days already cached -- a real, if
 * smaller, saving than skipping the read entirely would be.
 *
 * Returns `{ byDay: { [date]: { [model]: bucketed } }, rootsRead: [...] }`
 * -- `rootsRead` is always the CURRENT config roots (`configRoots()` is
 * cheap: a readdir per candidate), reported every call, cached or not, so
 * a caller can always say "N of N config roots" rather than only on the
 * calls that happened to scan.
 */
// ⚠️ CLAMPED, NOT TRUSTED. An unreasonably large `days` (an HTTP caller
// passing `?days=999999999999`, say) overflowed `Date` well before it
// reached anything resembling a useful range -- `new Date(...).toISOString()`
// throws RangeError once the millisecond offset leaves Date's own bounds,
// which a naive loop reaches at a few hundred thousand years, long before a
// person would ever want that many days. 10 years is already far past any
// real "last N days" request.
const MAX_DAYS = 3650;

async function dailyUsageByModel(days = 7) {
  const clampedDays = Math.min(MAX_DAYS, Math.max(1, Math.trunc(Number(days)) || 1));
  const today = todayUtc();
  const wanted = [];
  for (let i = 0; i < clampedDays; i += 1) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    wanted.push(d);
  }
  wanted.sort();

  const byDay = {};
  const missing = [];
  for (const day of wanted) {
    if (day === today) { missing.push(day); continue; }
    try {
      byDay[day] = JSON.parse(await fsp.readFile(frozenDayPath(day), 'utf8'));
    } catch {
      missing.push(day);
    }
  }

  let rootsRead = configRoots();
  if (missing.length) {
    // Narrowed to the MISSING days' own span, not the full requested
    // window -- if only today is missing (the common case once a window
    // has been scanned once), this is a one-day range, not `wanted`'s
    // full length. Real transcript files still get read in full either
    // way (see the function doc above); this at least keeps the
    // accumulation and per-day freeze work scoped to what's actually new.
    const missingSorted = [...missing].sort();
    const sinceDay = missingSorted[0];
    const untilDay = missingSorted[missingSorted.length - 1];
    const scanResult = await scanUsage({ sinceDay, untilDay });
    rootsRead = scanResult.rootsRead;
    for (const day of missing) {
      const byModel = scanResult.days[day] || {};
      byDay[day] = byModel;
      if (day !== today) {
        try {
          await ensureUsageDir();
          await fsp.writeFile(frozenDayPath(day), JSON.stringify(byModel), 'utf8');
        } catch { /* best effort: a failed freeze just means this day rescans next time */ }
      }
    }
  }

  return { byDay, rootsRead };
}

module.exports = {
  configRoots, // re-exported so a caller can report roots without a second require
  walkTranscriptsUnder,
  scanUsage,
  dailyUsageByModel,
  utcDay,
  BUCKET_FIELDS,
  get USAGE_DIR() { return usageDir(); },
};
