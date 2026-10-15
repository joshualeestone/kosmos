'use strict';
/**
 * kosmos#6176 slice 2: an OpenAI (Codex) account's plan limits, as Codex itself last reported them.
 *
 * Codex writes its limits into its own session files: each `token_count` event in
 * `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*.jsonl` carries
 *   "rate_limits": { "primary": { "used_percent": 0.0, "window_minutes": 10080, "resets_at": 1791985721 },
 *                    "secondary": null, "plan_type": "prolite", ... }
 * (measured 2026-10-14 on this computer, a ChatGPT sign-in on the prolite plan). Since #4592 a launched agent writes
 * its sessions into its own private Codex home (codexruntime.forAgent), not the account's, so the caller passes every
 * home that writes for the account: the account's own and each of its agents' private ones. Nothing here asks OpenAI
 * anything. Only the account's own limit bucket counts (limit_id "codex", or none). A private home is passed as
 * { home, since }: an agent moved between accounts keeps its old account's sessions in the same home, so only reports
 * written since its current job took effect (`since`, ms) count for the account it is on now.
 *
 * Read cheaply, and bounded: only the newest seven day folders are listed (sessions/YYYY/MM/DD), their files ranked by
 * when they were last WRITTEN (a long or resumed session keeps writing to a file named for when it started), and only
 * the last 256 KB of each is read, most recent first, until three reports are found or six files are read. The report
 * with the latest time of its own wins. A window whose
 * reset time has passed is dropped: that figure is from a window that is over. Never throws.
 */
const fs = require('node:fs');
const path = require('node:path');

const FILES_TRIED = 3;   // reports compared
const FILES_MAX = 6;     // files read at most, so busy sessions that never reported cannot hide one that did
const DAYS_LISTED = 7;
const LISTED_PER_HOME = 12;   // files stat'd per home at most (newest day folders first), so many agents stay cheap
const TAIL_BYTES = 256 * 1024;

/** One window `{ used_percent, window_minutes, resets_at }`, validated, or null. resetsAt in epoch ms. */
function windowOf(w) {
  if (!w || typeof w !== 'object' || Array.isArray(w)) return null;
  const pct = w.used_percent, mins = w.window_minutes, resets = w.resets_at;
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0) return null;
  if (typeof mins !== 'number' || !Number.isFinite(mins) || mins <= 0) return null;
  if (typeof resets !== 'number' || !Number.isFinite(resets) || resets <= 0) return null;
  return { usedPct: pct, windowMinutes: mins, resetsAt: resets * 1000 };
}

/* The row's report on the account's own bucket: `{ windows, plan }`, where windows may be empty (a report that names
   no current window still counts as the latest report). null when the row carries no rate_limits, or another bucket. */
function limitsOfRow(row) {
  const p = row && row.type === 'event_msg' && row.payload && typeof row.payload === 'object' ? row.payload : null;
  const rl = p && p.type === 'token_count' ? p.rate_limits : null;
  if (!rl || typeof rl !== 'object' || Array.isArray(rl)) return null;
  if (rl.limit_id != null && rl.limit_id !== 'codex') return null;
  const windows = [rl.primary, rl.secondary].map(windowOf).filter(Boolean);
  return { windows, plan: typeof rl.plan_type === 'string' ? rl.plan_type : null };
}

/** The last 256 KB of a file as text, or '' when it cannot be read. A first line cut in half fails to parse and is skipped. */
function tail(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch { return ''; }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* nothing to do */ } } }
}

/** Sub-entries of `dir` named like a number, largest first (years, months, days). */
function numbered(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && /^\d+$/.test(e.name)).map((e) => e.name).sort((a, b) => Number(b) - Number(a)); }
  catch { return []; }
}
/** The session files in each home's newest DAYS_LISTED day folders, most recently written first across all of them,
 *  at most FILES_MAX in total. */
function recentFiles(homes) {
  const files = [];
  // A file last written before its home's `since` cannot hold a report from after it: dropped before ranking, so old
  // sessions of a moved agent never take the slots of the report that counts.
  for (const h of homes) for (const f of filesIn(h.home)) if (f.m >= h.since) files.push({ ...f, since: h.since });
  return files.sort((a, b) => b.m - a.m).slice(0, FILES_MAX);
}
function filesIn(home) {
  const root = path.join(home, 'sessions'), days = [], files = [];
  for (const y of numbered(root)) {
    for (const m of numbered(path.join(root, y))) {
      for (const d of numbered(path.join(root, y, m))) { days.push(path.join(root, y, m, d)); if (days.length >= DAYS_LISTED) break; }
      if (days.length >= DAYS_LISTED) break;
    }
    if (days.length >= DAYS_LISTED) break;
  }
  for (const dir of days) {
    if (files.length >= LISTED_PER_HOME) break;   // newest day folders first: the rest are older sessions
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => /^rollout-.*\.jsonl$/.test(n)).sort().reverse(); } catch { /* unreadable: skipped */ }
    for (const n of names) {
      if (files.length >= LISTED_PER_HOME) break;
      const f = path.join(dir, n); try { files.push({ f, m: fs.statSync(f).mtimeMs }); } catch { /* gone: skipped */ }
    }
  }
  return files;
}
/** The last report in one file, `{ windows, plan, at }`, or null. */
function lastReport(file) {
  const lines = tail(file).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || line.indexOf('rate_limits') === -1) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const lim = limitsOfRow(row);
    if (!lim) continue;
    const at = Date.parse(row.timestamp);
    if (!Number.isFinite(at)) continue;
    return { ...lim, at };
  }
  return null;
}

/**
 * The account's latest report across `homes` (a path or a list of paths): `{ windows: [{ usedPct, windowMinutes,
 * resetsAt (ms) }], plan, at (ms) }`, or null when none carries one, or the latest names no window that is current.
 */
function read(homes, now = Date.now()) {
  const seen = new Set(), list = [];
  for (const h of (Array.isArray(homes) ? homes : [homes])) {
    const home = typeof h === 'string' ? h : (h && typeof h.home === 'string' ? h.home : '');
    if (!home || seen.has(home)) continue;
    seen.add(home);
    list.push({ home, since: h && Number.isFinite(h.since) ? h.since : -Infinity });
  }
  if (!list.length) return null;
  let best = null;
  let found = 0;
  try {
    for (const { f, since } of recentFiles(list)) {
      const r = lastReport(f);
      if (!r || r.at < since) continue;   // a report from before this agent's current account is not this account's
      if (!best || r.at > best.at) best = r;
      if (++found >= FILES_TRIED) break;   // three reports compared is enough; files with none do not count
    }
  } catch { return null; }
  try {
    if (!best) return null;
    const windows = best.windows.filter((w) => w.resetsAt > now);
    return windows.length ? { windows, plan: best.plan, at: best.at } : null;   // the latest report decides, even when it is over
  } catch { return null; }
}

/**
 * When this folder's current ChatGPT login began, as far as Kosmos can tell, in ms; null when auth.json cannot be read.
 * A token refresh rewrites auth.json but keeps the login, so it must not hide the account's reports; a different login
 * must. So the login (auth.json tokens.account_id, kept only as a hash) is recorded in `recordFile` with the time it
 * was first seen: the same login keeps that time, a new one starts again. First sight uses auth.json's own time, the
 * latest the login can have begun. A sign-in with no account_id falls back to auth.json's time. Never throws.
 */
function signedInSince(dir, recordFile) {
  let mtime = null, id = null;
  try {
    const file = path.join(dir, 'auth.json');
    mtime = fs.statSync(file).mtimeMs;
    const auth = JSON.parse(fs.readFileSync(file, 'utf8'));
    const raw = auth && auth.tokens && typeof auth.tokens.account_id === 'string' ? auth.tokens.account_id : '';
    if (raw) id = require('node:crypto').createHash('sha256').update(raw).digest('hex').slice(0, 32);
  } catch { /* unreadable: whatever was read stands */ }
  if (mtime == null || !id || !recordFile) return mtime;
  try {
    let rec = {};
    try { rec = JSON.parse(fs.readFileSync(recordFile, 'utf8')) || {}; } catch { rec = {}; }
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) rec = {};
    const key = path.resolve(dir), had = rec[key];
    if (had && had.login === id && Number.isFinite(had.since)) return had.since;
    rec[key] = { login: id, since: mtime };
    const tmp = recordFile + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(rec), { mode: 0o600 });
    fs.renameSync(tmp, recordFile);
    return mtime;
  } catch { return mtime; }
}

module.exports = { read, signedInSince, windowOf, limitsOfRow, FILES_TRIED, FILES_MAX, DAYS_LISTED, LISTED_PER_HOME, TAIL_BYTES };
