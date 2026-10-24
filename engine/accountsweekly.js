'use strict';
/**
 * kosmos#6178: each Claude account's weekly usage, as Kosmos last recorded it, in ONE place.
 *
 * GET /api/accounts gives each Claude row `weekly` and `weeklyBlocked` (#6108). GET /api/status now carries the same two
 * facts per account as `accountsWeekly`, so another of the person's computers can read them through the sibling path
 * #4812 built (this browser asks that computer, which answers only a browser it already lets in). Both routes call
 * weeklyOf and weeklyBlockedOf here.
 *
 * summary() is what /api/status sends. The status poll runs every five seconds, so the summary is kept for CACHE_MS and
 * rebuilt only when it is older or the account list changed. A reading or a reason (`blocked`) can therefore be up to CACHE_MS old
 * here while /api/accounts reads it live.
 */
const fs = require('node:fs');
const path = require('node:path');

const CACHE_MS = 15000;   // the other computers' read interval (OA_STATUS_EVERY_MS, #4812)
const MAX_ACCOUNTS = 50;   // what one computer sends; far past any real list

/** The account's weekly reading, or null when there is none this week (an API key, none recorded, unreadable, the week
    has reset). resetsAt and at are epoch ms (readWeekly gives resetsAt in seconds). */
function weeklyOf(a, nowMs) {
  try {
    const r = a && a.dir && !a.apiKey ? require('./allowance').readWeekly(a.dir, nowMs) : null;   // a key has no weekly limit
    return r ? { usedPct: r.usedPct, resetsAt: r.resetsAt * 1000, at: r.at } : null;
  } catch { return null; }
}

/** #6176: the account's five-hour reading, or null when there is none (an API key, none recorded, unreadable, the window
    has reset). Same units as weeklyOf: resetsAt and at in epoch ms. */
function fiveHourOf(a, nowMs) {
  try {
    const r = a && a.dir && !a.apiKey ? require('./allowance').readFiveHour(a.dir, nowMs) : null;
    return r ? { usedPct: r.usedPct, resetsAt: r.resetsAt * 1000, at: r.at } : null;
  } catch { return null; }
}

/** Why there can be NO reading for this account, when that is known: 'own-statusline', 'not-wired',
    'linked-settings' (#6175) or 'unreadable-settings'. null when Kosmos's own status line is there, so a reading comes once an agent on it works.
    kosmos#6570: always null on Windows, where an agent's readings come from its own event stream (win32streamstate), not
    the status line, which Claude Code never runs for a headless agent: none of these reasons stops a reading there. */
function weeklyBlockedOf(a, platform = process.platform) {
  if (!a || a.apiKey || typeof a.dir !== 'string' || !a.dir) return null;   // no folder: nothing to say about it
  if (platform === 'win32') return null;
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
    blocked: weeklyBlockedOf(a),
  }));
  cached = { key, at: nowMs, value };
  return value;
}

function resetForTests() { cached = null; }

module.exports = { weeklyOf, fiveHourOf, weeklyBlockedOf, summary, CACHE_MS, MAX_ACCOUNTS, resetForTests };
