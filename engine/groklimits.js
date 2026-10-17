'use strict';
/**
 * kosmos#6176 slice 3: a Grok subscription's usage, as Grok itself last logged it.
 *
 * On a grok.com sign-in, the Grok CLI fetches its billing state and logs it into its own log,
 * `<GROK_HOME>/logs/unified.jsonl`, one JSON object per line (`ts, lvl, src, pid, ver, msg, ctx`; other lines add `sid`):
 *   msg "billing: fetched credits config", ctx { config: { creditUsagePercent: 67.0,
 *     currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start: "<RFC 3339>", end: "<RFC 3339>" }, ... },
 *     subscriptionTier: "X Premium" }
 * (measured 2026-10-16 on this computer: 43 such lines from 09-26 to 09-29; the percent is of the plan's included
 * credits in the current period, and `end` is when it resets). Nothing here asks xAI anything: it reads the tail of a
 * file Grok wrote. An API key is reasoned (not measured) never to get this line, since Grok's billing read is of a
 * grok.com plan; the caller asks only for a subscription account.
 *
 * Grok does not log a fetch every session (none here after 09-29, though Grok ran on 10-05, 10-07 and 10-10), so a
 * reading can be days old: `at` is the line's own time, for the page to say how old it is, and a reading whose period
 * has ended is dropped (its figure belongs to a period that is over). A billing line with no percent is a reading with no figure (see
 * readingOfRow): the row says there is no current reading. A line without a valid period, or with a percent that is not a number, is skipped and the newest line
 * that has them answers, so a changed shape shows the last good reading, with its age, until its period ends; never a
 * figure read from a line it does not understand. Read cheaply: the last 256 KB of the log, then 1 MB, then 4 MB, only
 * while no reading is found (a busy day logs past 256 KB, measured: the last 09-29 reading sits about 355 KB from the
 * end of a 1.5 MB log; the 4 MB step is headroom, not a measurement). Never throws.
 *
 * Returns { windows: [{ usedPct, windowMinutes, resetsAt }], plan, at } (times in epoch ms), the shape
 * codexlimits.read returns, so the page draws both the same way; or null.
 */
const fs = require('node:fs');
const path = require('node:path');

const TAIL_STEPS = [256 * 1024, 1024 * 1024, 4 * 1024 * 1024];   // read further back only when no reading is found
const BILLING_MSG = 'billing: fetched credits config';

/** The last `bytes` of a file as text, or null when it cannot be read. A first line cut in half fails to parse. */
function tail(file, bytes) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch { return null; } finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* closed */ } } }
}

/** One log line's billing reading, validated, or null. */
function readingOfRow(row) {
  if (!row || typeof row !== 'object' || row.msg !== BILLING_MSG) return null;
  const at = Date.parse(row.ts);
  const ctx = row.ctx && typeof row.ctx === 'object' ? row.ctx : null;
  const c = ctx && ctx.config && typeof ctx.config === 'object' ? ctx.config : null;
  if (!c || !Number.isFinite(at)) return null;
  /* An absent percent is a reading with NO figure (review 5): it may mean 0% (protobuf JSON leaves out a zero) or a plan
     with no credit percent at all, and one sample here cannot tell them apart (both lines came on the account's first
     day, before any use). Showing 0% would be a confident wrong figure in the second case, so the newest reading decides
     and says nothing: no older line answers for it. A percent that is present but not a number is refused. */
  if (c.creditUsagePercent === undefined) {
    const s0 = c.currentPeriod && typeof c.currentPeriod === 'object' ? Date.parse(c.currentPeriod.start) : NaN;
    const e0 = c.currentPeriod && typeof c.currentPeriod === 'object' ? Date.parse(c.currentPeriod.end) : NaN;
    if (!Number.isFinite(s0) || !Number.isFinite(e0) || e0 <= s0) return null;
    return { windows: [], plan: typeof ctx.subscriptionTier === 'string' && ctx.subscriptionTier ? ctx.subscriptionTier : null, at };
  }
  const pct = c.creditUsagePercent;
  const p = c.currentPeriod && typeof c.currentPeriod === 'object' ? c.currentPeriod : null;
  const start = p ? Date.parse(p.start) : NaN;
  const end = p ? Date.parse(p.end) : NaN;
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0) return null;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return {
    windows: [{ usedPct: pct, windowMinutes: Math.round((end - start) / 60000), resetsAt: end }],
    plan: typeof ctx.subscriptionTier === 'string' && ctx.subscriptionTier ? ctx.subscriptionTier : null,
    at,
  };
}

/* The newest valid reading per log file (review 2, 3): kept with the file's identity and size. An unchanged file is not
   read; a file that only grew (Grok appends while it runs) has just its new bytes read, plus a little before them in
   case a line was half written; a replaced or shorter file, or one that grew by more than the largest step, is read
   again from its tail. */
const newestCache = new Map();
const OVERLAP = 16 * 1024;

/** The newest valid billing line in `text`, or null. */
function newestIn(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || line.indexOf(BILLING_MSG) === -1) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    const r = readingOfRow(row);
    if (r) return r;
  }
  return null;
}

/** The newest valid billing line in the file, whatever its period, or null; undefined when the file could not be read
    (review 4: a failed read is not an answer, so it is not kept). Reads the tail in TAIL_STEPS. */
function newestReading(file, size) {
  for (const bytes of TAIL_STEPS) {
    const text = tail(file, bytes);
    if (text === null) return undefined;
    if (!text) return null;
    const r = newestIn(text);
    if (r) return r;
    if (bytes >= size) return null;   // the whole file was read
  }
  return null;
}

/** The bytes from `start` to `end` of a file as text, or null when they cannot be read. */
function slice(file, start, end) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(end - start);
    fs.readSync(fd, buf, 0, end - start, start);
    return buf.toString('utf8');
  } catch { return null; } finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* closed */ } } }
}

function cachedNewest(file, st) {
  const hit = newestCache.get(file);
  const same = hit && hit.ino === st.ino && hit.dev === st.dev;
  if (same && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.reading;
  let r;
  if (same && st.size > hit.size && st.size - hit.size <= TAIL_STEPS[TAIL_STEPS.length - 1]) {
    const text = slice(file, Math.max(0, hit.size - OVERLAP), st.size);
    if (text === null) return null;
    r = newestIn(text) || hit.reading;
  } else {
    r = newestReading(file, st.size);
    if (r === undefined) { newestCache.delete(file); return null; }
  }
  newestCache.set(file, { ino: st.ino, dev: st.dev, size: st.size, mtimeMs: st.mtimeMs, reading: r });
  return r;
}

/**
 * The newest billing reading in `<home>/logs/unified.jsonl`, or null: no log, no reading, a reading from before the
 * folder's current sign-in, or its period is over.
 * @param {string} home  the account's Grok folder (~/.grok, or a named account's ~/.grok-<label>)
 * @param {number} [now] epoch ms
 * @param {number|null} [since] epoch ms the folder's current sign-in began (signedInSince), or null when unknown
 */
function read(home, now = Date.now(), since = null) {
  try {
    if (typeof home !== 'string' || !home) return null;
    const file = path.join(home, 'logs', 'unified.jsonl');
    let st; try { st = fs.statSync(file); } catch { return null; }
    const r = cachedNewest(file, st);
    if (!r) return null;
    // A reading logged before this folder's current sign-in began is another login's (review 1): it says nothing.
    if (Number.isFinite(since) && r.at < since) return null;
    // The newest reading decides, even when its period is over: then there is no current figure.
    const windows = r.windows.filter((w) => w.resetsAt > now);
    return windows.length ? { ...r, windows } : null;
  } catch { return null; }
}

/**
 * When the folder's current grok.com sign-in began, as epoch ms, or null when it cannot be told (review 1: a folder
 * reused by another login, or signed in again, keeps the earlier login's log, and its readings must not show as this
 * account's). The login is told by the keys of auth.json's entries (`https://auth.x.ai::<id>`) and their user_id,
 * hashed; the first time a login is seen in a folder, its start is auth.json's own time, recorded in `recordFile` so a
 * token refresh (which rewrites auth.json under the same login) does not move it. The codexlimits.signedInSince shape.
 */
function signedInSince(dir, recordFile) {
  let mtime = null, id = null;
  try {
    const file = path.join(dir, 'auth.json');
    mtime = fs.statSync(file).mtimeMs;
    const auth = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (auth && typeof auth === 'object' && !Array.isArray(auth)) {
      const parts = Object.keys(auth).filter((k) => /^https:\/\/auth\.x\.ai::/.test(k)).sort()
        .map((k) => k + '\n' + (auth[k] && typeof auth[k] === 'object' && typeof auth[k].user_id === 'string' ? auth[k].user_id : ''));
      if (parts.length) id = require('node:crypto').createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32);
    }
  } catch { /* unreadable: whatever was read stands */ }
  if (mtime == null || !id || !recordFile) return mtime;
  try {
    let rec = {};
    try { rec = JSON.parse(fs.readFileSync(recordFile, 'utf8')) || {}; } catch { rec = {}; }
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) rec = {};
    const key = path.resolve(dir), had = rec[key];
    if (had && had.login === id && Number.isFinite(had.since)) return had.since;
    rec[key] = { login: id, since: mtime };
    const tmp = recordFile + '.' + process.pid + '.' + require('node:crypto').randomBytes(6).toString('hex') + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(rec), { mode: 0o600 });
    fs.renameSync(tmp, recordFile);
    return mtime;
  } catch { return mtime; }
}

module.exports = { read, readingOfRow, signedInSince, BILLING_MSG, TAIL_STEPS };
