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
const path = require('node:path');
const { configRoots } = require('./status');
const store = require('./store');

const USAGE_DIR = path.join(store.ROOT, 'usage');

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
 */
function walkTranscriptsUnder(root) {
  const projects = path.join(root, 'projects');
  let projectDirs;
  try { projectDirs = fs.readdirSync(projects, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) continue;
    const projectPath = path.join(projects, projectDir.name);
    let entries;
    try { entries = fs.readdirSync(projectPath, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const entryPath = path.join(projectPath, entry.name);
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(entryPath);
      } else if (entry.isDirectory()) {
        // The subagents/ (and any deeper) tree for this session.
        walkJsonlRecursive(entryPath, files);
      }
    }
  }
  return files;
}

function walkJsonlRecursive(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJsonlRecursive(entryPath, out);
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
function scanUsage({ sinceDay, untilDay }) {
  const roots = configRoots();
  const days = {};
  for (const root of roots) {
    for (const file of walkTranscriptsUnder(root)) {
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
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

function ensureUsageDir() {
  fs.mkdirSync(USAGE_DIR, { recursive: true });
  return USAGE_DIR;
}

function frozenDayPath(day) {
  // day is always a YYYY-MM-DD string produced by utcDay()/todayUtc(), never
  // caller-supplied, so no path-traversal guard is needed the way safeKey()
  // guards an untrusted agent name elsewhere in this codebase.
  return path.join(USAGE_DIR, `${day}.json`);
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Per-day, per-model usage for the last `days` UTC calendar days
 * (including today). A day strictly before today is scanned once and
 * frozen to disk -- transcripts for a completed day do not grow, so
 * re-scanning it is wasted work every future call would otherwise repeat.
 * Today is always re-scanned live, never cached, since its transcripts are
 * still being appended to.
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

function dailyUsageByModel(days = 7) {
  const clampedDays = Math.min(MAX_DAYS, Math.max(1, Math.trunc(Number(days)) || 1));
  const today = todayUtc();
  const wanted = [];
  for (let i = 0; i < clampedDays; i += 1) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    wanted.push(d);
  }
  wanted.sort();
  const sinceDay = wanted[0];

  const byDay = {};
  const missing = [];
  for (const day of wanted) {
    if (day === today) { missing.push(day); continue; }
    try {
      byDay[day] = JSON.parse(fs.readFileSync(frozenDayPath(day), 'utf8'));
    } catch {
      missing.push(day);
    }
  }

  let rootsRead = configRoots();
  if (missing.length) {
    // One scan covers every missing day at once, rather than one full
    // transcript walk per missing day.
    const untilDay = wanted[wanted.length - 1];
    const scanResult = scanUsage({ sinceDay, untilDay });
    rootsRead = scanResult.rootsRead;
    for (const day of missing) {
      const byModel = scanResult.days[day] || {};
      byDay[day] = byModel;
      if (day !== today) {
        try {
          ensureUsageDir();
          fs.writeFileSync(frozenDayPath(day), JSON.stringify(byModel), 'utf8');
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
  USAGE_DIR,
};
