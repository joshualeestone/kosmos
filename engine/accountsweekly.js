'use strict';
/**
 * kosmos#6178: each Claude account's weekly usage, as Kosmos last recorded it, in ONE place.
 *
 * GET /api/accounts gives each Claude row `weekly` and `weeklyBlocked` (#6108). GET /api/status now carries the same two
 * facts per account as `accountsWeekly`, so another of the person's computers can read them through the sibling path
 * #4812 built (this browser asks that computer, which answers only a browser it already lets in). Both routes call
 * weeklyOf and weeklyBlockedOf here.
 *
 * kosmos#7152: a reading comes from one of two sources, the status line (kosmos-statusline.js, written when an agent
 * on the account takes a turn) or the usage endpoint (usagepoll.js, read every ten minutes for every account, idle ones
 * included). weeklyOf and fiveHourOf give the newer of the two, so `at` can come from either.
 *
 * summary() is what /api/status sends. The status poll runs every five seconds, so the summary is kept for CACHE_MS and
 * rebuilt only when it is older or the account list changed. A reading or a reason (`blocked`) can therefore be up to CACHE_MS old
 * here while /api/accounts reads it live.
 */
const fs = require('node:fs');
const path = require('node:path');

const CACHE_MS = 15000;   // the other computers' read interval (OA_STATUS_EVERY_MS, #4812)
const MAX_ACCOUNTS = 50;   // what one computer sends; far past any real list

/* kosmos#7152: of the status line's reading and the usage endpoint's (usagepoll), the newer one, in the same shape as
   before ({ usedPct, resetsAt, at }), which other computers read through /api/status. */
function newer(statusLine, polled) {
  const a = statusLine ? { usedPct: statusLine.usedPct, resetsAt: statusLine.resetsAt * 1000, at: statusLine.at } : null;
  const b = polled ? { usedPct: polled.usedPct, resetsAt: polled.resetsAt * 1000, at: polled.at } : null;
  const bMeasured = polled && typeof polled.measuredAt === 'number' ? polled.measuredAt : (b && b.at);
  if (!a) return b;
  if (!b) return a;
  /* Review 4: two readings of the SAME window (resets within an hour of each other; the two sources stamp the reset
     slightly differently) are compared by figure, because usage within a window only rises: the higher one is the
     later truth, whichever source was quicker to see it. Across windows, the newer reading wins. */
  if (Math.abs(a.resetsAt - b.resetsAt) <= SAME_WINDOW_MS) {
    if (a.usedPct !== b.usedPct) return a.usedPct > b.usedPct ? a : b;
    return b.at >= a.at ? b : a;   // review 6: the same figure in the same window: the later change is the one shown
  }
  /* Review 5: across windows the question is which reading is CURRENT, so the endpoint's is dated by when it was last
     measured, not by when its figure last changed (an idle account's figure can sit unchanged for days). */
  return bMeasured >= a.at ? b : a;
}
const SAME_WINDOW_MS = 3600 * 1000;

/* The endpoint's figure for one window, dated when it last CHANGED (usagepoll's changedAt), which is what the status
   line's `at` means and what the page shows as "last saw it change". A window with no reset time yet is left to the
   status line: the /api/status shape carries a reset time. */
function accountOrg(a) {
  try { const who = require('./accounts').identityOf(a.dir); return who && who.organizationUuid; } catch { return null; }
}

function polledOf(a, nowMs, key) {
  const usagepoll = require('./usagepoll');
  const r = usagepoll.readUsage(a.dir, nowMs);
  /* Review 17: a record names the login it was measured for, and is shown only for that login, so a folder signed in
     again (or copied) does not show the old login's figure until the next read replaces it. */
  if (r && r.email && !usagepoll.sameLogin(r, a, accountOrg(a))) return null;
  const w = r && r[key];
  return w && typeof w.resetsAt === 'number' && typeof w.changedAt === 'number'
    ? { usedPct: w.usedPct, resetsAt: w.resetsAt, at: w.changedAt, measuredAt: r.measuredAt } : null;
}

/** The account's weekly reading, or null when there is none this week (an API key, none recorded, unreadable, the week
    has reset). resetsAt and at are epoch ms (readWeekly gives resetsAt in seconds). */
function weeklyOf(a, nowMs = Date.now()) {
  try {
    if (!a || !a.dir || a.apiKey) return null;   // a key has no weekly limit
    return newer(require('./allowance').readWeekly(a.dir, nowMs), polledOf(a, nowMs, 'weekly'));
  } catch { return null; }
}

/** #6176: the account's five-hour reading, or null when there is none (an API key, none recorded, unreadable, the window
    has reset). Same units as weeklyOf: resetsAt and at in epoch ms. */
function fiveHourOf(a, nowMs = Date.now()) {
  try {
    if (!a || !a.dir || a.apiKey) return null;
    return newer(require('./allowance').readFiveHour(a.dir, nowMs), polledOf(a, nowMs, 'fiveHour'));
  } catch { return null; }
}

/** Why there can be NO reading for this account, when that is known: 'own-statusline', 'not-wired',
    'linked-settings' (#6175) or 'unreadable-settings'. null when Kosmos's own status line is there, so a reading comes once an agent on it works.
    kosmos#6570: always null on Windows, where an agent's readings come from its own event stream (win32streamstate), not
    the status line, which Claude Code never runs for a headless agent: none of these reasons stops a reading there.
    kosmos#7152: also null while the usage endpoint has a fresh reading for the account, which keeps it updating. */
function weeklyBlockedOf(a, platform = process.platform, nowMs = Date.now()) {
  if (!a || a.apiKey || typeof a.dir !== 'string' || !a.dir) return null;   // no folder: nothing to say about it
  if (platform === 'win32') return null;
  /* kosmos#7152 review 3: the usage endpoint reads this account every ten minutes, so a fresh reading from it IS
     updating, and "it will not update" would be false next to it. None of these reasons stops a reading then. */
  if (polledOf(a, nowMs, 'weekly') && (require('./usagepoll').readUsage(a.dir, nowMs) || {}).state === 'ok') return null;   // review 6: only while the endpoint is still answering
  const sp = path.join(a.dir, 'settings.json');
  const linkedAway = () => {   // #6175: the same test the set-up route makes before it writes
    try { if (!fs.lstatSync(sp).isSymbolicLink()) return false; } catch { return false; }
    try { return path.dirname(fs.realpathSync(sp)) !== fs.realpathSync(a.dir); } catch { return true; }   // a link to nothing
  };
  const unwired = () => (linkedAway() ? 'linked-settings' : 'not-wired');
  try {
    const j = JSON.parse(fs.readFileSync(sp, 'utf8'));
    const sl = j && j.statusLine;
    if (sl === undefined || sl === null) return unwired();   // nothing records a reading here
    return require('./allowance').isOurs(sl) ? null : 'own-statusline';
  } catch (e) { return e && e.code === 'ENOENT' ? unwired() : 'unreadable-settings'; }   // missing (or a link to nothing): nothing records one; unreadable: Kosmos cannot tell
}

let cached = null;   // { key, at, value }

/* What makes a cached summary wrong before its time: an account added, removed or renamed. */
function listKey(list) {
  return JSON.stringify(list.map((a) => [a.dir || '', a.email || '', a.label || '', a.organization || '', a.isDefault === true, a.apiKey === true]));
}

/** The Claude accounts on this computer with their weekly facts, for /api/status. `list` is accounts.list() (Claude
    rows only). An API-key account is listed with apiKey true and no reading. */
function summary(list, nowMs = Date.now()) {
  const rows = (Array.isArray(list) ? list : []).filter((a) => a && typeof a.dir === 'string' && a.dir)
    .slice(0, MAX_ACCOUNTS);
  const key = listKey(rows);
  if (cached && cached.key === key && nowMs - cached.at >= 0 && nowMs - cached.at < CACHE_MS) return cached.value;
  const value = rows.map((a) => ({
    dir: a.dir,
    email: typeof a.email === 'string' ? a.email : null,
    label: typeof a.label === 'string' ? a.label : null,
    organization: typeof a.organization === 'string' ? a.organization : null,
    isDefault: a.isDefault === true,
    apiKey: a.apiKey === true,   // listed so its agents join to it; a key has no weekly limit (weeklyOf, weeklyBlockedOf: null)
    weekly: weeklyOf(a, nowMs),
    blocked: weeklyBlockedOf(a, undefined, nowMs),
  }));
  cached = { key, at: nowMs, value };
  return value;
}

function resetForTests() { cached = null; }

module.exports = { weeklyOf, fiveHourOf, weeklyBlockedOf, summary, CACHE_MS, MAX_ACCOUNTS, resetForTests };
