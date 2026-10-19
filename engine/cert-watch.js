'use strict';
/* kosmos#6602: what the tunnel's certificate check (kosmos-relay, crates/tunnel/src/ctwatch.rs) found,
   read from the state dir, and its off switch.

   The tunnel writes `ct-watch.json` there. Only counts, times and the state are passed on from it: its
   strings come from a third party's answer, so none of them reaches the page.

   States, as the page shows them:
   - `foreign`: a certificate for this computer's address carries a key this computer never made.
   - `unknown`: nothing could be confirmed (no check has worked yet, a check is failing, an earlier
     report was lost, or the last success is old because the check stopped running).
   - `clear`: a recent check found nothing.
   - `none`: no check has run yet (a new computer, or one switched off before its first check).
   The tunnel itself keeps `clear` for up to two check spacings while failing; past that, and whenever
   the report is that old, this reads `unknown`, as the tunnel's report doc asks of a reader. */

const fs = require('fs');
const path = require('path');

const REPORT_FILE = 'ct-watch.json';
const OFF_FILE = 'ct-watch-off';
/* The tunnel's CHECK_SPACING_SECS is 20 hours; a `clear` older than two spacings is not current. */
const STALE_MS = 2 * 20 * 60 * 60 * 1000;

const count = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
const len = (v) => (Array.isArray(v) ? v.length : 0);
const secs = (v) => (Number.isInteger(v) && v > 0 ? v : null);

/** What the check found, from `dir` at `nowMs`. Never throws. */
function certWatchFrom(dir, nowMs) {
  const on = !fs.existsSync(path.join(dir, OFF_FILE));
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, REPORT_FILE), 'utf8')); } catch { raw = null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    /* A file that is there but does not parse is not "never checked". */
    const there = fs.existsSync(path.join(dir, REPORT_FILE));
    return { on, state: there ? 'unknown' : 'none', foreign: 0, earlier: 0, beforeRecord: 0, checkedAt: null, failing: there };
  }
  const foreign = len(raw.foreign) + count(raw.foreign_overflow);
  const earlier = len(raw.earlier_foreign) + count(raw.earlier_overflow);
  const checkedAt = secs(raw.checked_at);
  const errorAt = secs(raw.error_at);
  let state = ['clear', 'foreign', 'unknown'].includes(raw.state) ? raw.state : 'unknown';
  if (foreign + earlier > 0) state = 'foreign';
  else if (state === 'clear' && (checkedAt === null || Math.abs(nowMs - checkedAt * 1000) > STALE_MS)) state = 'unknown';
  if (raw.damaged_report_at !== undefined && state === 'clear') state = 'unknown';
  return {
    on,
    state,
    foreign,
    earlier,
    beforeRecord: count(raw.before_record),
    checkedAt,
    /* The last try failed after the last success (or there has been no success). */
    failing: errorAt !== null && (checkedAt === null || errorAt >= checkedAt),
  };
}

/** Switch the check on or off for this computer. `dir` must exist (a computer that has been set up). */
function setCertWatchIn(dir, on) {
  if (typeof on !== 'boolean') return { ok: false, because: 'say on or off' };
  if (!fs.existsSync(dir)) return { ok: false, because: 'this computer is not set up for Kosmos+ yet' };
  const off = path.join(dir, OFF_FILE);
  try {
    if (on) fs.rmSync(off, { force: true });
    else fs.writeFileSync(off, '', { mode: 0o600 });
    return { ok: true };
  } catch {
    return { ok: false, because: 'we could not save that setting' };
  }
}

module.exports = { certWatchFrom, setCertWatchIn, REPORT_FILE, OFF_FILE, STALE_MS };
