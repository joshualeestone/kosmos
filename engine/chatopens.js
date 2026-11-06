'use strict';
/**
 * #7420: how often the iPhone chat goes blank, per app build. The phone sends one record when a chat showing ends; only
 * numbers and the app's version, never text or a name. Counted by build rather than kept as records, so a rate holds
 * for the last MAX_BUILDS builds to report.
 *
 * What the numbers mean, for a build: opens is showings (a chat appearing or coming back to the front, until it closes or
 * leaves the front), so one long chat can count twice. blankOpens is showings with a rebuild or left blank at close.
 * rebuilds is the total. closedBlank is showings with no row reported for the last 3 s before they closed, unless a search
 * or unsent messages explain it.
 * Missing from the blank count, so it is a floor and a change in it can be a blank moving out of view: a blank repaired
 * another way (a list past its end put back), one that recovers with no repair, and a screen with rows reported but not
 * drawn. Missing from both counts: a showing lost as the app is killed, or to a chat closed or backgrounded under its info
 * page. A person may force-quit a blank chat more than a fine one, so blankOpens / opens can err either way. Compare builds
 * with enough showings, do not quote it.
 *
 * Read with GET /api/phone/chat-opens (the board's token, as its sibling chat-shifts) or from the file itself on this Mac.
 *
 * Kept on the board (store.ROOT/phone-chat-opens.json). Never throws to a caller. A file that cannot be read reads as
 * no builds with ok false and is never overwritten from that reading.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const MAX_BUILDS = 30;
// Sent with the numbers, for whoever reads them without this file.
const NOTE = 'Compare builds with enough showings; do not quote a rate. blankOpens is a floor on blanks, and lost showings can move blankOpens/opens either way. Definitions: engine/chatopens.js.';
const MAX_REBUILDS = 100;   // the app's own budget is far lower; a bad record cannot move a rate by much
const FIELDS = ['opens', 'blankOpens', 'rebuilds', 'closedBlank'];
// Digits and dots, with the build in brackets: no room for a word.
const VERSION_RE = /^[0-9]{1,4}(\.[0-9]{1,4}){0,3} \([0-9]{1,8}\)$/;

const file = () => path.join(store.ROOT, 'phone-chat-opens.json');

/** One showing as counted, or { refused }. */
function clean(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { refused: 'not a record' };
  if (typeof body.app !== 'string' || !VERSION_RE.test(body.app)) return { refused: 'app must be a version with its build' };
  if (!Number.isInteger(body.rebuilds) || body.rebuilds < 0) return { refused: 'rebuilds must be a count' };
  if (typeof body.closedBlank !== 'boolean') return { refused: 'closedBlank must be true or false' };
  return { record: { app: body.app, rebuilds: Math.min(body.rebuilds, MAX_REBUILDS), closedBlank: body.closedBlank } };
}

function cleanBuild(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const out = {};
  for (const k of FIELDS) {
    if (!Number.isInteger(b[k]) || b[k] < 0) return null;
    out[k] = b[k];
  }
  if (typeof b.lastAt !== 'string' || Number.isNaN(Date.parse(b.lastAt))) return null;
  out.lastAt = b.lastAt;
  return out;
}

/** { builds: { '<app>': { opens, blankOpens, rebuilds, closedBlank, lastAt } }, ok }. No file is no builds. */
function read() {
  let raw;
  try { raw = fs.readFileSync(file(), 'utf8'); } catch (err) { return { builds: {}, ok: err.code === 'ENOENT' }; }
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v.builds !== 'object' || v.builds === null || Array.isArray(v.builds)) return { builds: {}, ok: false };
    const builds = {};
    for (const [app, b] of Object.entries(v.builds)) {
      const c = cleanBuild(b);
      if (c && VERSION_RE.test(app)) builds[app] = c;
    }
    return { builds, ok: true };
  } catch { return { builds: {}, ok: false }; }
}

/** Counts one showing under its build, with the board's own time. { ok } or { refused }. */
function add(body, now = new Date()) {
  const c = clean(body);
  if (c.refused) return c;
  const was = read();
  if (!was.ok) return { ok: false };
  const b = Object.prototype.hasOwnProperty.call(was.builds, c.record.app)
    ? was.builds[c.record.app] : { opens: 0, blankOpens: 0, rebuilds: 0, closedBlank: 0 };
  b.opens += 1;
  if (c.record.rebuilds > 0 || c.record.closedBlank) b.blankOpens += 1;
  b.rebuilds += c.record.rebuilds;
  if (c.record.closedBlank) b.closedBlank += 1;
  b.lastAt = now.toISOString();
  was.builds[c.record.app] = b;
  const kept = Object.entries(was.builds).sort((x, y) => Date.parse(y[1].lastAt) - Date.parse(x[1].lastAt)).slice(0, MAX_BUILDS);
  try {
    fs.mkdirSync(store.ROOT, { recursive: true });
    store.saveFlushed(file(), JSON.stringify({ builds: Object.fromEntries(kept) }));
  } catch (err) { console.warn('chatopens: could not keep a record:', err && err.code); return { ok: false }; }
  return { ok: true };
}

module.exports = { read, add, clean, file, MAX_BUILDS, MAX_REBUILDS, NOTE };
