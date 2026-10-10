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
const os = require('node:os');
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

/* The folder Claude Code nests a session's subagent transcripts under
   (<sess>/subagents/**). The walk descends into it and #2617's launch-folder
   keying recognises a subagent by it, so both read one name. */
const SUBAGENTS_DIRNAME = 'subagents';

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
async function walkTranscriptsUnder(root, onError) {
  // `onError` (#5532): told of a folder that exists but cannot be listed; a missing projects/ (ENOENT) is no sessions.
  const projects = path.join(root, 'projects');
  const failed = (e) => { if (onError && !(e && e.code === 'ENOENT')) onError(); };
  let projectDirs;
  try { projectDirs = await fsp.readdir(projects, { withFileTypes: true }); } catch (e) { failed(e); return []; }
  const files = [];
  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) continue;
    const projectPath = path.join(projects, projectDir.name);
    let entries;
    try { entries = await fsp.readdir(projectPath, { withFileTypes: true }); } catch (e) { failed(e); continue; }
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
        await walkSubagentsTree(entryPath, files, failed);
      }
    }
  }
  return files;
}

/** Only the `subagents/` child of a session directory, never its other contents. */
async function walkSubagentsTree(sessionDir, out, failed) {
  let entries;
  try { entries = await fsp.readdir(sessionDir, { withFileTypes: true }); } catch (e) { if (failed) failed(e); return; }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name === SUBAGENTS_DIRNAME) {
      await walkJsonlRecursive(path.join(sessionDir, entry.name), out, failed);
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
async function walkJsonlRecursive(dir, out, failed) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { if (failed) failed(e); return; }
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkJsonlRecursive(entryPath, out, failed);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(entryPath);
  }
}

/** The UTC calendar day (YYYY-MM-DD) a transcript row's timestamp falls on. */
function utcDay(isoTimestamp) {
  return typeof isoTimestamp === 'string' && isoTimestamp.length >= 10 ? isoTimestamp.slice(0, 10) : null;
}

/* #5363: the first cwd a transcript records, read line by line and stopping at the first one, for a transcript
   whose rows are skipped (it was last written before the window) but a subagent of which is read, and takes its
   launch folder.
   The same rule as the full read below: the first line that names a cwd and parses with a non-empty one. */
async function firstCwd(file, onError) {
  let stream;
  try {
    stream = fs.createReadStream(file, { encoding: 'utf8' });
    const lines = require('node:readline').createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.includes('"cwd"')) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (r && typeof r.cwd === 'string' && r.cwd) { lines.close(); return r.cwd; }
    }
  } catch { if (onError) onError(); /* unreadable: no launch folder, as the full read would give */ } finally {
    if (stream) stream.destroy();
  }
  return '';
}

/* #5363: a row is appended when it is written, so a transcript last written before the window can hold no row in
   it. Both a row's timestamp and a file's mtime are absolute times (no time zone in either), so the cut needs only a
   margin for clock drift: one hour before the window's first day. Measured on the fleet Mac, 2026-10-05: 85,008
   transcript files (14.8 GB); a one-DAY margin still read 3,143 of them (4.4 GB), most of the remaining time. */
const MTIME_MARGIN_MS = 60 * 60 * 1000;
function windowCutMs(sinceDay) {
  if (typeof sinceDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(sinceDay)) return null;
  const t = Date.parse(sinceDay + 'T00:00:00Z');
  // Not a real date (2026-02-31 would roll over to March): no cut, a full read.
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== sinceDay) return null;
  return t - MTIME_MARGIN_MS;
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
 * Returns `{ days: { [date]: { [model]: bucketed } },
 * folders: { [date]: { [launchCwd]: bucketed } }, rootsRead: [...] }` --
 * the roots list travels with the result so a caller can say "N of N
 * config roots read" rather than imply completeness it cannot back up.
 * #5363: with mtimeCut, a transcript last written before windowCutMs(sinceDay) is not read (see windowCutMs,
 * firstCwd); dailyUsageByModel asks for it.
 */
async function scanUsage({ sinceDay, untilDay, mtimeCut = false }) {
  /* #5363: the cut is OPT-IN (dailyUsageByModel asks for it). A past day this scan derives is FROZEN for good, so the
     premise matters: a file's mtime is the time of its last write, never earlier than its newest row. Copies that
     preserve mtimes (cp -p, rsync -t, a backup restore) keep it, since they keep that original time. What breaks it
     is a clock moved back by more than the one-hour margin between writing a row and stamping the file. Review 2
     proposed cutting only when today is the one missing day; rejected, because at every UTC midnight yesterday becomes
     a missing past day and the first open of each day would pay the full read again (6.9 minutes on the fleet Mac). */
  const cutMs = mtimeCut ? windowCutMs(sinceDay) : null;
  /* Scan-wide, not per file: a message id identifies one assistant message
     across the whole read, and the same message can appear in more than one
     file (a session transcript and a resumed copy of it). Per-file dedup would
     leave that case counted twice. */
  const seenIds = new Set();
  const roots = configRoots();
  const days = {};
  const folders = {};
  const folderModels = {};   // #5532: day -> launch folder -> model, for usage scoped to one Kosmos's agents
  let unreadable = 0;        // #5532: transcripts that could not be stat-ed or read, so a scoped count can say it is short
  // Launch folder per top-level transcript, for its subagents to inherit.
  const launchOf = new Map();
  for (const root of roots) {
    /* Sorted, so when one message id appears in two transcripts launched in
       different folders (a resumed session), the same file wins the dedup on
       every scan and the per-agent split does not depend on readdir order. */
    for (const file of (await walkTranscriptsUnder(root, () => { unreadable += 1; })).sort()) {
      const sub = file.indexOf(path.sep + SUBAGENTS_DIRNAME + path.sep, root.length);
      const isSub = sub !== -1;
      /* #5363: a file last written before the window holds no row in it, so it is not read. A top-level one still
         gives its first cwd (a head read), because a subagent written today takes its launch folder from it. */
      if (cutMs !== null) {
        let st;
        try { st = await fsp.stat(file); } catch { unreadable += 1; continue; }
        if (st.mtimeMs < cutMs) {
          // Its first cwd is read only if a subagent of it is read (below): most skipped sessions have none in the
          // window, and a head read of each was 14,196 file opens on the fleet Mac.
          if (!isSub) launchOf.set(file, { skipped: true });
          continue;
        }
      }
      let text;
      try { text = await fsp.readFile(file, 'utf8'); } catch { unreadable += 1; continue; }
      /* #2617: a transcript is keyed by the FIRST cwd it records, the folder
         the session was launched in. A row's own cwd moves when the agent
         `cd`s into a worktree; keyed per row, that work would leave the
         agent. Measured on this Mac, 2026-09-24: 6 of the 60 newest
         sessions carried more than one cwd, 21% of their rows off the first. */
      const lines = text.split('\n');
      let launch = '';
      let orphan = false;
      for (const line of lines) {
        if (!line.includes('"cwd"')) continue;
        let r;
        try { r = JSON.parse(line); } catch { continue; }
        if (r && typeof r.cwd === 'string' && r.cwd) { launch = r.cwd; break; }
      }
      /* A subagent's transcript (<sess>/subagents/**, at any depth) starts
         wherever its spawner was standing, often a worktree. It is the top-level
         session's work, so it takes that session's launch folder: the FIRST
         /subagents/ segment names it. The sorted walk visits <sess>.jsonl before
         <sess>/ ('.' sorts before '/'), so it is already known. The subagent
         keeps its own first cwd when there is no top-level transcript on disk,
         or that transcript records no cwd. Searched below the config root only,
         so a root that itself sits under a folder named subagents is not read
         as one. */
      if (isSub) {
        const parentFile = file.slice(0, sub) + '.jsonl';
        let parent = launchOf.get(parentFile);
        if (parent && typeof parent === 'object') {   // #5363: a skipped parent, head-read now that it is needed
          parent = await firstCwd(parentFile, () => { unreadable += 1; });   // #5532: a failed head read is a short count
          launchOf.set(parentFile, parent);
        }
        if (parent) launch = parent;
        /* #5532: for the SCOPED split only, a subagent whose top-level transcript is gone or records no folder counts
           for nobody: its own first folder may be wherever a person's own session had cd'd to, an agent's folder
           included. The per-folder totals the usage screen reads keep their behaviour. */
        else orphan = true;
      } else {
        launchOf.set(file, launch);
      }
      for (const line of lines) {
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
        /* #2617: the same row, once more, keyed by its transcript's launch
           folder (above). byAgent() ties a folder to an agent. A transcript
           that records no cwd keys to ''. */
        const folder = launch;
        if (!folders[day]) folders[day] = {};
        if (!folders[day][folder]) folders[day][folder] = emptyBuckets();
        const fb = folders[day][folder];
        for (const field of BUCKET_FIELDS) fb[field] += Number(usage[field]) || 0;
        fb.rows += 1;
        const scoped = orphan ? '' : folder;
        if (!folderModels[day]) folderModels[day] = {};
        if (!folderModels[day][scoped]) folderModels[day][scoped] = {};
        if (!folderModels[day][scoped][model]) folderModels[day][scoped][model] = emptyBuckets();
        const fm = folderModels[day][scoped][model];
        for (const field of BUCKET_FIELDS) fm[field] += Number(usage[field]) || 0;
        fm.rows += 1;
      }
    }
  }
  return { days, folders, folderModels, unreadable, rootsRead: roots };
}

/* kosmos#5759: TODAY's transcripts, read once and then only for what was appended. With every past day frozen (#5363),
   the usual open still re-read every transcript written today, which is never frozen: 155 files, 392 MB and about 10
   seconds a page open on the fleet Mac, 6 hours into the UTC day. This is the per-file byte-offset cursor the
   dailyUsageByModel docblock named: in this board process, each of the day's transcripts remembers how far it was read
   and what its rows added, and the next call reads only the bytes after that.

   🛑 THE RESULT IS EXACTLY WHAT A FULL READ OF THE SAME FILES WOULD GIVE, OR THE CURSOR IS THROWN AWAY. scanUsage is
   the definition: its seenIds keeps the FIRST copy of a message in (root, sorted path) order, and a transcript's rows
   go to its FIRST cwd (a subagent's to its top-level transcript's). Anything after which an incremental read could
   disagree with that throws Rebuild, and the call reads every file from the start, in order, which cannot disagree:
   - a file that vanished, could not be stat-ed or read, shrank below its cursor, or is a different file (inode);
   - a message id already counted for a file that sorts AFTER the one now holding it (a full read credits this one);
   - a launch folder that changes after rows were counted under the old one (a first cwd written late, or a
     subagent's parent changing);
   - a new UTC day or a different set of config roots (a fresh cursor, not a rebuild in place).
   A last line with no newline yet is read only when it parses whole, as the full read's split would parse it; a
   half-written one is left for next time.
   Held in memory only: a board restart starts from a full read of the day, as before. Calls are chained, so two
   requests never move one cursor at once. */
const DAY_CURSOR = { day: null, roots: null, files: new Map(), owner: new Map(), heads: new Map() };
const lastDayCursorRun = { rebuilt: false, bytesConsumed: 0 };
let dayCursorChain = Promise.resolve();
class Rebuild extends Error {}

function resetDayCursor(day = null, roots = null) {
  DAY_CURSOR.day = day;
  DAY_CURSOR.roots = roots;
  DAY_CURSOR.files = new Map();
  DAY_CURSOR.owner = new Map();
  DAY_CURSOR.heads = new Map();
}

function scanDayCursor(day) {
  const run = dayCursorChain.then(() => scanDayCursorNow(day));
  dayCursorChain = run.catch(() => {});
  return run;
}

async function scanDayCursorNow(day) {
  if (windowCutMs(day) === null) return scanUsage({ sinceDay: day, untilDay: day, mtimeCut: true });   // not a real day
  const roots = configRoots();
  const key = JSON.stringify(roots);
  let rebuilt = false;
  if (DAY_CURSOR.day !== day || DAY_CURSOR.roots !== key) { resetDayCursor(day, key); rebuilt = true; }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const out = await dayCursorPass(day, roots);
      lastDayCursorRun.rebuilt = rebuilt;
      lastDayCursorRun.bytesConsumed = out.bytesConsumed;
      return out.result;
    } catch (err) {
      if (!(err instanceof Rebuild)) { resetDayCursor(); throw err; }
      resetDayCursor(day, key);
      rebuilt = true;
    }
  }
  // A from-the-start pass asked to rebuild again (it should not be able to): the full read, and no cursor kept.
  resetDayCursor();
  lastDayCursorRun.rebuilt = true;
  lastDayCursorRun.bytesConsumed = -1;
  return scanUsage({ sinceDay: day, untilDay: day, mtimeCut: true });
}

const SEAM_BYTES = 64;   // round 1: bytes before the cursor, read back to tell an appended file from a rewritten one
async function readFrom(fh, start, end) {
  const buf = Buffer.alloc(Math.max(0, end - start));
  let got = 0;
  while (got < buf.length) {
    const { bytesRead } = await fh.read(buf, got, buf.length - got, start + got);
    if (!bytesRead) break;
    got += bytesRead;
  }
  return buf.subarray(0, got);
}

/* The first cwd among `lines`, by the full read's rule (the first line naming a cwd that parses with a non-empty one). */
function firstCwdOf(lines) {
  for (const line of lines) {
    if (!line.includes('"cwd"')) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r && typeof r.cwd === 'string' && r.cwd) return r.cwd;
  }
  return '';
}

const orderBefore = (a, b) => a.ri < b.ri || (a.ri === b.ri && a.file < b.file);

function addBucket(map, k, usage) {
  if (!map[k]) map[k] = emptyBuckets();
  for (const field of BUCKET_FIELDS) map[k][field] += Number(usage[field]) || 0;
  map[k].rows += 1;
}

async function dayCursorPass(day, roots) {
  const cutMs = windowCutMs(day);
  const C = DAY_CURSOR;
  let unreadable = 0;
  let bytesConsumed = 0;   // new bytes taken into the counts (a half line left for later is read again, not consumed)
  const listed = new Set();
  const skippedTop = new Set();
  const passHeads = new Map();   // a skipped parent is head-read at most once a pass, as the full read's launchOf does
  for (let ri = 0; ri < roots.length; ri += 1) {
    const root = roots[ri];
    for (const file of (await walkTranscriptsUnder(root, () => { unreadable += 1; })).sort()) {
      const sub = file.indexOf(path.sep + SUBAGENTS_DIRNAME + path.sep, root.length);
      const isSub = sub !== -1;
      let st;
      try { st = await fsp.stat(file); } catch { if (C.files.has(file)) throw new Rebuild(); unreadable += 1; continue; }
      if (st.mtimeMs < cutMs) {
        if (C.files.has(file)) throw new Rebuild();
        if (!isSub) skippedTop.add(file);
        continue;
      }
      let s = C.files.get(file);
      if (s && (s.ri !== ri || s.ino !== st.ino || s.dev !== st.dev || st.size < s.offset)) throw new Rebuild();
      const fresh = !s;
      if (fresh) s = { ri, file, ino: st.ino, dev: st.dev, offset: 0, seam: Buffer.alloc(0), mtimeMs: st.mtimeMs, firstCwd: '', counted: false, launch: '', orphan: false, days: {}, folders: {}, folderModels: {} };
      let lines = [];
      /* Round 1: every listed file is opened on every pass, read or not, so one that became unreadable is noticed
         (the full read would drop its rows and count it unreadable), and an empty one that cannot be opened counts. */
      let fh;
      try { fh = await fsp.open(file, 'r'); } catch { if (!fresh) throw new Rebuild(); unreadable += 1; continue; }
      let buf = null;
      try {
        /* Round 1: the SEAM, the last bytes before the cursor, is read back with any new bytes (and on its own when the
           file was written without growing). A file truncated and rewritten, even longer and on the same inode, no
           longer has it there, and the cursor rebuilds rather than read the middle of new content. */
        const grew = st.size > s.offset;
        if (!fresh && (grew || st.mtimeMs !== s.mtimeMs)) {
          const from = s.offset - s.seam.length;
          const back = await readFrom(fh, from, grew ? st.size : s.offset);
          if (!back.subarray(0, s.seam.length).equals(s.seam)) throw new Rebuild();
          if (grew) buf = back.subarray(s.seam.length);
        } else if (grew) buf = await readFrom(fh, s.offset, st.size);
      } catch (err) {
        if (err instanceof Rebuild) throw err;
        if (!fresh) throw new Rebuild();
        unreadable += 1;
        continue;
      } finally { await fh.close().catch(() => {}); }
      s.mtimeMs = st.mtimeMs;
      if (buf && buf.length) {
        const nl = buf.lastIndexOf(0x0a);
        let take = buf.length;
        if (nl !== buf.length - 1) {
          // No newline after the last line yet: take it only if it parses whole (the full read would parse it too). A
          // writer that later extends that same line into something unparseable is not caught (none does).
          const tail = buf.subarray(nl + 1).toString('utf8');
          let whole = false;
          try { JSON.parse(tail); whole = true; } catch { /* half written */ }
          if (!whole) take = nl + 1;
        }
        lines = buf.subarray(0, take).toString('utf8').split('\n');
        s.seam = Buffer.concat([s.seam, buf.subarray(0, take)]).subarray(-SEAM_BYTES);
        s.offset += take;
        bytesConsumed += take;
      }
      if (fresh) C.files.set(file, s);
      listed.add(file);
      if (!s.firstCwd) s.firstCwd = firstCwdOf(lines);
      let launch = s.firstCwd;
      let orphan = false;
      if (isSub) {
        const parentFile = file.slice(0, sub) + '.jsonl';
        let parent;
        const ps = C.files.get(parentFile);
        if (ps && listed.has(parentFile)) parent = ps.firstCwd;
        else if (skippedTop.has(parentFile)) {
          // A parent last written before the window: its first cwd, head-read once per version of that file.
          let pst = null;
          try { pst = await fsp.stat(parentFile); } catch { /* read below fails the same way */ }
          const h = C.heads.get(parentFile);
          // Round 1: the saved head is trusted only while the parent still opens (a full read would fail to head-read it).
          const opens = h && pst && h.mtimeMs === pst.mtimeMs && h.size === pst.size
            ? await fsp.open(parentFile, 'r').then((p) => p.close().then(() => true), () => false) : false;
          if (passHeads.has(parentFile)) parent = passHeads.get(parentFile);
          else if (opens) parent = h.cwd;
          else {
            let failed = false;
            parent = await firstCwd(parentFile, () => { failed = true; unreadable += 1; });
            if (!failed && pst) C.heads.set(parentFile, { mtimeMs: pst.mtimeMs, size: pst.size, cwd: parent });
          }
          passHeads.set(parentFile, parent);
        }
        if (parent) launch = parent; else orphan = true;
      }
      if (s.counted && (s.launch !== launch || s.orphan !== orphan)) throw new Rebuild();
      s.launch = launch;
      s.orphan = orphan;
      for (const line of lines) {
        if (!line || SYNTHETIC_ROW.test(line)) continue;
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        const message = row && row.message;
        const usage = message && message.usage;
        if (!usage) continue;
        if (utcDay(row.timestamp) !== day) continue;
        if (message.id) {
          const owner = C.owner.get(message.id);
          if (owner) {
            if (owner !== s && orderBefore(s, owner)) throw new Rebuild();   // a full read counts it here, not there
            continue;
          }
          C.owner.set(message.id, s);
        }
        const model = message.model || 'unknown';
        addBucket(s.days, model, usage);
        addBucket(s.folders, launch, usage);
        const scoped = orphan ? '' : launch;
        if (!s.folderModels[scoped]) s.folderModels[scoped] = {};
        addBucket(s.folderModels[scoped], model, usage);
        s.counted = true;
      }
    }
  }
  for (const file of C.files.keys()) if (!listed.has(file)) throw new Rebuild();   // gone, or now unreadable
  const days = {};
  const folders = {};
  const folderModels = {};
  const sum = (into, from) => { for (const [k, b] of Object.entries(from)) addInto(into, k, b); };
  // Summed in (root, path) order, so the result's keys come in the order a full read gives them (round 1).
  for (const s of [...C.files.values()].sort((a, b) => (orderBefore(a, b) ? -1 : orderBefore(b, a) ? 1 : 0))) {
    if (!s.counted) continue;
    sum((days[day] = days[day] || {}), s.days);
    sum((folders[day] = folders[day] || {}), s.folders);
    for (const [scoped, models] of Object.entries(s.folderModels)) {
      if (!folderModels[day]) folderModels[day] = {};
      sum((folderModels[day][scoped] = folderModels[day][scoped] || {}), models);
    }
  }
  return { result: { days, folders, folderModels, unreadable, rootsRead: roots }, bytesConsumed };
}

/* This Kosmos's own agent folders, from its roster, exactly as the usage screen builds them (server.js, the per-agent
   split). Null when the roster cannot be read. An agent whose folder cannot be resolved stays in the list as null, so
   the count says it left that agent out rather than looking whole. */
function worldAgentDirs() {
  const register = require('./register');
  const create = require('./create');
  const known = register.known();
  if (!known.ok) return null;
  const dirs = [];
  for (const name of known.names) { try { dirs.push(create.workerDir(name)); } catch { dirs.push(null); } }
  return dirs;
}

/**
 * #5532 (Enterprise E0.3): usage of THIS Kosmos's own agents only, per day and model. The rest of this file reads
 * every Claude config folder on the computer, so its totals include the person's other Kosmoses and their sessions
 * outside Kosmos; the company rollup must never send those.
 *
 * MATCHING. A row counts only when its transcript's launch folder IS one of `agentDirs`, compared after realpath as
 * byAgent compares. A subfolder is not claimed, so an agent on a broad folder cannot absorb the person's own sessions
 * beneath it. Unlike byAgent, a home folder, a root, a shared parent and an orphaned subagent claim nothing here, so the
 * usage screen's per-agent totals can be larger than this for the same agents.
 * Read fresh each time, frozen nowhere: the per-day files the usage screen keeps are untouched.
 *
 * Returns { byDay: { day: { model: bucket } }, complete } where complete is false when any provider was only partly
 * read, a Claude transcript could not be read, or a scan failed outright (never thrown): the caller then says so rather
 * than send a short count as the whole. A folder that is not absolute is nobody's (it would otherwise resolve against
 * this server's own folder). A message found in two transcripts counts once, for the copy whose path sorts first, so an
 * agent can be UNDER-counted when a person's own transcript holds the same message: the safe direction.
 * An agent folder that is the home folder, a filesystem root, not absolute or unresolvable claims nothing AND makes the
 * result incomplete (that agent's own sessions are left out). One that no longer exists also makes it incomplete: its
 * sessions recorded under the same spelling still match, but any reached through a link cannot be resolved (review 11).
 * The rollup decides what an incomplete count means; a roster profile that outlives its folder keeps it incomplete.
 * 🛑 The folders are this Kosmos's own roster (worldAgentDirs: register.known() through create.workerDir, as the usage
 * screen builds it), NEVER a listing of the workers folder: in the default world several Kosmoses on one computer share that folder,
 * and a listing would sweep in another Kosmos's agents (review 3).
 * A folder that contains another agent's folder (a shared parent) claims nothing, and the count says incomplete.
 * RESIDUAL (review 6): ownership is by launch folder only. In the default world several Kosmoses share the workers
 * folder, so two Kosmoses' agents with the same name, or a person's own session started in an agent's exact folder,
 * cannot be told apart here and count as this world's. The rollup sends usage only under consent words that say
 * "sessions launched in your agents' folders". `days` is meant to be small (the
 * rollup's seven): every call is a fresh scan of the window.
 * `deps` (scanUsage, scanProviders, realpath, home, agentDirs) is for tests only: `deps.agentDirs` overrides the roster,
 * so a caller COULD pass a listing; a test (usage-world-5532, review 7) refuses any non-test file that passes a second
 * argument. Within one config root the copy whose path sorts first is the one counted; across roots, the root's place
 * in configRoots() decides.
 */
async function worldUsageByModel(days, deps) {
  const d = deps || {};
  // `deps.agentDirs` overrides the roster, for tests only (see the docblock).
  const agentDirs = Array.isArray(d.agentDirs) ? d.agentDirs : worldAgentDirs();
  if (!agentDirs) return { byDay: {}, complete: false };   // the roster could not be read: say so
  const n = Math.min(MAX_DAYS, Math.max(1, Math.trunc(Number(days)) || 1));
  const untilDay = todayUtc();
  const sinceDay = new Date(Date.now() - (n - 1) * 86400000).toISOString().slice(0, 10);
  const realpath = d.realpath || (async (p) => { try { return await fsp.realpath(p); } catch { return path.resolve(p); } });
  const mine = new Set();
  let missingDir = false;
  /* An agent whose folder is dropped below (unresolvable, not absolute, a home or a root) has its own sessions left
     out, so the count is short and says so, exactly as a shared parent does. */
  let droppedAgent = false;
  /* Never a folder that holds the person's own work too (review 2): the home folder or a filesystem root as an
     agent's folder would claim every session started there. */
  // The home Kosmos uses (AGENT_WORKFORCE_HOME, as store.js reads it) AND the account's own: either claims nothing (review 8).
  // A filesystem root is caught per folder below.
  const homes = [d.home || process.env.AGENT_WORKFORCE_HOME || os.homedir(), os.homedir()];
  const broad = new Set(await Promise.all(homes.map((h) => realpath(h))));
  const reals = [];
  for (const dir of agentDirs) {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) { droppedAgent = true; continue; }
    try { await fsp.access(dir); } catch { missingDir = true; }   // a gone folder cannot be matched by its real path
    const real = await realpath(dir);
    if (broad.has(real) || real === path.parse(real).root) { droppedAgent = true; continue; }
    reals.push(real);
  }
  /* A folder that CONTAINS another agent's folder is a shared parent (the workers root, a person's ~/work), not one
     agent's own folder: it claims nothing (review 5). */
  let droppedParent = false;
  for (const real of reals) {
    if (!reals.some((o) => o !== real && o.startsWith(real.endsWith(path.sep) ? real : real + path.sep))) mine.add(real);
    else droppedParent = true;   // its own sessions are left out too, so the count is short (review 6)
  }
  let claude;
  try { claude = await (d.scanUsage || scanUsage)({ sinceDay, untilDay, mtimeCut: true }); }
  catch { claude = { folderModels: {}, unreadable: 1 }; }   // a failed scan is a short count, never a throw
  let others = { folderModels: {}, complete: false };
  try { others = await (d.scanProviders || ((o) => require('./usageproviders').scanProviders(o)))({ sinceDay, untilDay }); }
  catch { others = { folderModels: {}, complete: false }; }
  const byDay = {};
  const sources = [claude.folderModels || {}, others.folderModels || {}];
  // Every distinct folder resolved once, in parallel (review 3), as byAgentAsync does.
  const distinct = new Set();
  for (const src of sources) for (const folders of Object.values(src)) for (const f of Object.keys(folders || {})) if (f && path.isAbsolute(f)) distinct.add(f);
  const resolved = new Map(await Promise.all([...distinct].map(async (f) => [f, await realpath(f)])));
  for (const src of sources) {
    for (const [day, folders] of Object.entries(src)) {
      for (const [folder, models] of Object.entries(folders || {})) {
        if (!folder || !path.isAbsolute(folder)) continue;   // no recorded folder, or a relative one: nobody's
        if (!mine.has(resolved.get(folder))) continue;
        for (const [model, b] of Object.entries(models || {})) addInto((byDay[day] = byDay[day] || {}), model, b);
      }
    }
  }
  // Fails closed (review 8): a provider result that does not SAY complete is not complete.
  return { byDay, complete: others.complete === true && !(claude.unreadable > 0) && !missingDir && !droppedParent && !droppedAgent };
}

async function ensureUsageDir() {
  await fsp.mkdir(USAGE_DIR, { recursive: true });
  return USAGE_DIR;
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
  return path.join(USAGE_DIR, `${day}.v2.json`);
}

/* #2617: the per-folder split of a completed day, frozen beside the per-model
   file and never in place of it. The model file stays the day's authoritative
   total. A day frozen per-model before this shipped gets its folder split from
   whatever transcripts still exist, which can be fewer than when the total was
   taken; `byAgent` reports that gap as `unattributed` rather than hiding it. */
function frozenFolderPath(day) {
  return path.join(USAGE_DIR, `${day}.folders.v1.json`);
}

/* A frozen file's contents, or null when it is missing, unreadable, or not
   a plain object (any of which means the day is rescanned). */
function readFrozen(file) {
  return fsp.readFile(file, 'utf8').then((t) => {
    let v;
    try { v = JSON.parse(t); } catch { return null; }
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  }, () => null);
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
 * Transcripts are not date-partitioned, so before #5363 `scanUsage`
 * read and JSON.parsed every line of every transcript across every
 * config root on every call that had ANY missing day (today always
 * qualifies, since it's never frozen); the freeze saved only the
 * ACCUMULATION work for days already on disk, not the I/O.
 * #5363: since then, a transcript last written more than an hour before the first missing day is not read at all (a
 * row is appended when it is written, so it holds none in the missing days); a skipped top-level one is head-read for
 * its first cwd only when a subagent of it is read. With every past day frozen (the usual open) that is the files
 * written since an hour before today began (UTC); just after UTC midnight, since an hour before yesterday began.
 * A stats page polling this on a live schedule still costs real time and
 * disk I/O on every call: the files written since the first missing day
 * (measured on the fleet Mac, about 4 to 6 seconds). What this DOES
 * avoid, because every read on this path is async (fs.promises, not
 * fs.*Sync): it does not block Node's single event loop while doing so --
 * without that, every OTHER route on this server (agent status polling
 * included) would stall for the scan's full duration, found in review as
 * a real, not hypothetical, consequence of the first synchronous version.
 * #5759: today, when it is the only missing day (the usual open), is read
 * through a per-file byte-offset cursor (scanDayCursor): each of the day's
 * transcripts is read once, then only for the bytes appended since, with the
 * same answer as a full read (it rebuilds whenever it could disagree). The
 * cursor lives in this board process, so the first open after a restart, and
 * any open with a past day missing, still reads in full.
 *
 * The scan range is narrowed to the missing days' own span (not the full
 * requested window), so the ACCUMULATION and per-day freeze work scoped to
 * `wanted` isn't wasted on days already cached, and (#5363) neither is the
 * read of files last written before that span.
 *
 * Returns `{ byDay: { [date]: { [model]: bucketed } },
 * byFolder: { [date]: { [launchCwd]: bucketed } }, rootsRead: [...] }` --
 * `rootsRead` is always the CURRENT config roots (`configRoots()` is
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
  const byFolder = {};
  const missing = [];
  for (const day of wanted) {
    if (day === today) { missing.push(day); continue; }
    const [m, f] = await Promise.all([readFrozen(frozenDayPath(day)), readFrozen(frozenFolderPath(day))]);
    if (m) byDay[day] = m;
    if (f) byFolder[day] = f;
    if (!m || !f) missing.push(day);
  }

  let rootsRead = configRoots();
  if (missing.length) {
    // Narrowed to the MISSING days' own span, not the full requested
    // window -- if only today is missing (the common case once a window
    // has been scanned once), this is a one-day range, not `wanted`'s
    // full length. Since #5363 the READ is narrowed too: a file last written
    // before the first missing day (less an hour) is not read (see scanUsage).
    const missingSorted = [...missing].sort();
    const sinceDay = missingSorted[0];
    const untilDay = missingSorted[missingSorted.length - 1];
    // #5363: files last written before the first missing day (less an hour) are not read (see scanUsage).
    /* kosmos#5759: when today is the only missing day (the usual open), its transcripts are read through the cursor
       (scanDayCursor): only what was appended since the last open, with the same result as a full read. */
    const scanResult = sinceDay === today && untilDay === today
      ? await scanDayCursor(today)
      : await scanUsage({ sinceDay, untilDay, mtimeCut: true });
    rootsRead = scanResult.rootsRead;
    for (const day of missing) {
      /* Whichever half of a past day is already frozen keeps it: re-deriving
         it from today's transcripts could only lose what has been pruned
         since. Only the missing half is taken from this scan and frozen. */
      const has = (o) => day !== today && Object.prototype.hasOwnProperty.call(o, day);
      const modelFrozen = has(byDay);
      const folderFrozen = has(byFolder);
      if (!modelFrozen) byDay[day] = scanResult.days[day] || {};
      if (!folderFrozen) byFolder[day] = scanResult.folders[day] || {};
      if (day !== today) {
        try {
          await ensureUsageDir();
        } catch { /* the writes below fail and say so */ }
        /* Best effort, each half on its own: a failed freeze means that half
           rescans next time. With two files per day that can be the whole
           window on every request (a full disk, a read-only data folder), so
           say it. */
        if (!modelFrozen) {
          try { await fsp.writeFile(frozenDayPath(day), JSON.stringify(byDay[day]), 'utf8'); }
          catch (err) { console.error('usage: could not freeze ' + day + ':', (err && err.message) || err); }
        }
        if (!folderFrozen) {
          try { await fsp.writeFile(frozenFolderPath(day), JSON.stringify(byFolder[day]), 'utf8'); }
          catch (err) { console.error('usage: could not freeze the folder split for ' + day + ':', (err && err.message) || err); }
        }
      }
    }
  }

  await mergeProviders(wanted, today, byDay, byFolder);
  return { byDay, byFolder, rootsRead };
}

/* #5158: Codex, Gemini CLI, Grok and Antigravity, frozen per past day in their OWN file beside Claude's pair, never inside it.
   🛑 CLAUDE'S SAVED DAYS ARE NOT TOUCHED. `<day>.v2.json` and `<day>.folders.v1.json` are read and written exactly as
   before; Claude prunes old transcripts, so re-deriving a past Claude day could only lose history. A past day with no
   providers file yet (every day, the first time after this update) is scanned from the providers' own session files and
   frozen; today is always scanned. The two are merged on read: Claude's model names never collide with the others'
   (claude-*, gpt-*, gemini-*, grok-*). Gemini CLI and Antigravity both run gemini-* models, and there the buckets add:
   the same model at the same price. */
function frozenProvidersPath(day) {
  return path.join(USAGE_DIR, `${day}.providers.v1.json`);
}

function addInto(map, key, b) {
  if (!map[key]) map[key] = emptyBuckets();
  for (const f of [...BUCKET_FIELDS, 'rows']) map[key][f] += Number(b && b[f]) || 0;
}

async function mergeProviders(wanted, today, byDay, byFolder, scan = (o) => require('./usageproviders').scanProviders(o)) {
  const got = {};
  const missing = [];
  for (const day of wanted) {
    if (day === today) { missing.push(day); continue; }
    const v = await readFrozen(frozenProvidersPath(day));
    if (v && v.models && v.folders) got[day] = v; else missing.push(day);
  }
  if (missing.length) {
    const sorted = [...missing].sort();
    let res = { days: {}, folders: {}, complete: false };
    try { res = await scan({ sinceDay: sorted[0], untilDay: sorted[sorted.length - 1] }); }
    catch (err) { console.error('usage: could not read Codex, Gemini, Grok or Antigravity usage:', (err && err.message) || err); }
    /* Shown either way, FROZEN only when every home and file was read: a passing error must not fix a past day at zero. */
    const freeze = !!(res && res.complete);
    if (!freeze) console.error('usage: Codex, Gemini, Grok or Antigravity usage was only partly read; not saving it, it is read again next time');
    for (const day of missing) {
      got[day] = { models: (res.days && res.days[day]) || {}, folders: (res.folders && res.folders[day]) || {} };
      if (day !== today && freeze) {
        try { await ensureUsageDir(); await fsp.writeFile(frozenProvidersPath(day), JSON.stringify(got[day]), 'utf8'); }
        catch (err) { console.error('usage: could not freeze Codex, Gemini, Grok and Antigravity usage for ' + day + ':', (err && err.message) || err); }
      }
    }
  }
  for (const [day, v] of Object.entries(got)) {
    if (!byDay[day]) byDay[day] = {};
    if (!byFolder[day]) byFolder[day] = {};
    for (const [model, b] of Object.entries(v.models)) addInto(byDay[day], model, b);
    for (const [folder, b] of Object.entries(v.folders)) addInto(byFolder[day], folder, b);
  }
}

/**
 * #2617: the window's tokens per agent, from the per-folder split.
 *
 * `agents` is [{ name, shown, dir }]. A folder is an agent's when it is the
 * agent's own folder, both sides compared after `canonical` (realpath), so a
 * link and its target match and two identical spellings always do. A subfolder is not
 * claimed, so an agent recorded on a broad folder cannot absorb the person's
 * own sessions beneath it. A message found in two transcripts (a resumed copy)
 * counts once, for the transcript whose path sorts first: stable across scans,
 * but not a judgement about which copy is the original. Kosmos resumes an agent
 * in its own folder, so both copies usually carry the same launch folder.
 * A folder two agents share goes to `shared`, not to
 * whichever name sorts first. A folder no agent owns goes to `elsewhere`.
 *
 * Checked per day against the per-model total: `unattributed` is what a day's
 * total holds beyond its folders (transcripts pruned after the total froze),
 * and `overcount` is the reverse, so the two cannot cancel across days.
 * Four buckets, never blended, as everywhere in this module.
 */
function byAgent({ byDay, byFolder }, agents, canonical = defaultCanonical) {
  const owners = new Map();
  for (const a of Array.isArray(agents) ? agents : []) {
    if (!a || typeof a.name !== 'string' || typeof a.dir !== 'string' || !a.dir) continue;
    const dir = canonical(a.dir);
    if (!owners.has(dir)) owners.set(dir, []);
    owners.get(dir).push({ name: a.name, shown: typeof a.shown === 'string' && a.shown ? a.shown : a.name });
  }
  const totals = new Map();
  const elsewhere = emptyBuckets();
  const shared = emptyBuckets();
  const unattributed = emptyBuckets();
  const overcount = emptyBuckets();
  const add = (into, b) => { for (const f of BUCKET_FIELDS) into[f] += Number(b && b[f]) || 0; into.rows += Number(b && b.rows) || 0; };
  const ownersOf = new Map();
  const days = new Set([...Object.keys(byDay || {}), ...Object.keys(byFolder || {})]);
  for (const day of days) {
    const dayFolders = emptyBuckets();
    for (const [folder, b] of Object.entries((byFolder && byFolder[day]) || {})) {
      add(dayFolders, b);
      if (!ownersOf.has(folder)) ownersOf.set(folder, folder ? owners.get(canonical(folder)) || [] : []);
      const who = ownersOf.get(folder);
      if (who.length > 1) { add(shared, b); continue; }
      if (!who.length) { add(elsewhere, b); continue; }
      const o = who[0];
      if (!totals.has(o.name)) totals.set(o.name, { name: o.name, shown: o.shown, ...emptyBuckets() });
      add(totals.get(o.name), b);
    }
    const dayModel = emptyBuckets();
    for (const b of Object.values((byDay && byDay[day]) || {})) add(dayModel, b);
    for (const f of [...BUCKET_FIELDS, 'rows']) {
      const gap = dayModel[f] - dayFolders[f];
      if (gap > 0) unattributed[f] += gap; else overcount[f] -= gap;
    }
  }
  const list = [...totals.values()].sort((x, y) => (y.output_tokens - x.output_tokens) || x.name.localeCompare(y.name));
  return { agents: list, elsewhere, shared, unattributed, overcount };
}

function defaultCanonical(p) {
  return require('./trust').canonicalOnDisk(p);
}

/**
 * byAgent() for a request handler: every folder and agent folder is resolved
 * with the async realpath first, then the split runs on the results, so no
 * synchronous filesystem call runs on the server's one thread. The number of
 * distinct folders grows with worktrees and window length, not with agents.
 * Same fallback as trust.canonicalOnDisk: a folder that is gone resolves to
 * itself.
 */
async function byAgentAsync(result, agents) {
  const all = new Set();
  for (const day of Object.keys((result && result.byFolder) || {})) {
    for (const folder of Object.keys(result.byFolder[day] || {})) if (folder) all.add(folder);
  }
  for (const a of Array.isArray(agents) ? agents : []) if (a && typeof a.dir === 'string' && a.dir) all.add(a.dir);
  const real = new Map();
  await Promise.all([...all].map(async (p) => {
    try { real.set(p, await fsp.realpath(p)); } catch { real.set(p, path.resolve(p)); }
  }));
  return byAgent(result, agents, (p) => (real.has(p) ? real.get(p) : path.resolve(p)));
}

module.exports = {
  configRoots, // re-exported so a caller can report roots without a second require
  walkTranscriptsUnder,
  scanUsage,
  scanDayCursor,      // kosmos#5759
  resetDayCursor,     // kosmos#5759: tests start from an empty cursor
  lastDayCursorRun,   // kosmos#5759: tests read whether the last call rebuilt and how many bytes it read
  dailyUsageByModel,
  worldUsageByModel,
  worldAgentDirs,
  byAgent,
  byAgentAsync,
  utcDay,
  BUCKET_FIELDS,
  USAGE_DIR,
  mergeProviders,
  frozenProvidersPath,
  windowCutMs,   // kosmos#5367: the one cut, shared with the other providers' scans (engine/usageproviders.js)
};
