'use strict';
/* kosmos#6602: what the tunnel's certificate check (kosmos-relay, crates/tunnel/src/ctwatch.rs) found,
   read from the state dir, and its off switch.

   The tunnel writes `ct-watch.json` there, whole (a temp file then a rename, crates/tunnel/src/atomic.rs
   write_private), so a read never sees half a report. Only counts, times and the state are passed on from
   it: its strings come from a third party's answer, so none of them reaches the page.

   States, as the page shows them:
   - `foreign`: a certificate for this computer's address carries a key this computer never made.
   - `unknown`: nothing could be confirmed (no check has worked yet, a check is failing, an earlier
     report was lost, or the last success is old because the check stopped running).
   - `clear`: a recent check found nothing.
   - `none`: no check has run yet (a new computer, or one switched off before its first check).
   The tunnel itself keeps `clear` for up to two check spacings while failing; past that, and whenever
   the report is that old, this reads `unknown`, as the tunnel's report doc asks of a reader. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPORT_FILE = 'ct-watch.json';
const OFF_FILE = 'ct-watch-off';
/* kosmos#6613: the board's own record that a person has seen a lost report: the tunnel's damaged_report_at value
   it was told about. Written by the board, never by the tunnel, and the tunnel's report is never edited. */
const LOST_ACK_FILE = 'ct-watch-lost-ack';
/* The tunnel's CHECK_SPACING_SECS is 20 hours; a `clear` older than two spacings is not current. */
const STALE_MS = 2 * 20 * 60 * 60 * 1000;

/* kosmos#6613: one finding set, as a short hex key: the same certificates give the same key, and any new one gives
   a new key (so a dismissed notice comes back for it). Built from each finding's own hash, or its log id when it has
   none, for this address and earlier ones; only the hex digest leaves this module. */
function findingKey(raw) {
  const ids = [];
  for (const list of [raw.foreign, raw.earlier_foreign]) {
    if (!Array.isArray(list)) continue;
    for (const [n, f] of list.entries()) {
      if (!f || typeof f !== 'object') continue;
      // The last fallback carries its place in the list, so two entries with nothing to tell them apart stay two.
      const id = typeof f.cert_sha256 === 'string' && f.cert_sha256 ? 'c:' + f.cert_sha256
        : typeof f.id === 'string' && f.id ? 'i:' + f.id : 'p:' + String(f.pubkey_sha256) + '@' + String(f.not_before) + '#' + n;
      ids.push(id);
    }
  }
  ids.push('o:' + count(raw.foreign_overflow) + ':' + count(raw.earlier_overflow));
  ids.sort();
  return crypto.createHash('sha256').update(ids.join('\n')).digest('hex').slice(0, 16);
}

const count = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
const len = (v) => (Array.isArray(v) ? v.length : 0);
/* Unix seconds as the tunnel writes them (an i64); a number with a fraction is floored, anything else is absent. */
const secs = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : null);

/** What the check found, from `dir` at `nowMs`. Never throws. */
function certWatchFrom(dir, nowMs) {
  const on = !fs.existsSync(path.join(dir, OFF_FILE));
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, REPORT_FILE), 'utf8')); } catch { raw = null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    /* A file that is there but does not parse is not "never checked". */
    const there = fs.existsSync(path.join(dir, REPORT_FILE));
    /* Not `failing`: a report that does not parse says nothing about whether the check runs. */
    return { on, state: there ? 'unknown' : 'none', foreign: 0, earlier: 0, beforeRecord: 0, lost: false, lostAt: null, key: null, checkedAt: null, failing: false };
  }
  const foreign = len(raw.foreign) + count(raw.foreign_overflow);
  const earlier = len(raw.earlier_foreign) + count(raw.earlier_overflow);
  const checkedAt = secs(raw.checked_at);
  const errorAt = secs(raw.error_at);
  /* A `foreign` stays foreign however old the report is (only `clear` goes stale): a finding is never aged out. */
  let state = ['clear', 'foreign', 'unknown'].includes(raw.state) ? raw.state : 'unknown';
  if (foreign + earlier > 0) state = 'foreign';
  /* Both directions on purpose: a check dated far in the future (a skewed clock, a bad write) is not current either. */
  else if (state === 'clear' && (checkedAt === null || Math.abs(nowMs - checkedAt * 1000) >= STALE_MS)) state = 'unknown';
  /* An earlier report could not be read and was kept aside by the tunnel: findings in it may be lost. The tunnel
     keeps the marker until a person has looked; acknowledging it from the board is kosmos#6613. */
  const damagedAt = secs(raw.damaged_report_at);
  /* kosmos#6613: a lost report a person has acknowledged (the same marker value) is no longer said. */
  const acked = damagedAt === null ? null
    : (() => { try { const t = fs.readFileSync(path.join(dir, LOST_ACK_FILE), 'utf8').trim(); return /^\d+$/.test(t) ? Number(t) : null; } catch { return null; } })();
  // A record that is not all digits (empty, damaged) reads as none and never matches, so the loss is said again. Any
  // positive marker is a loss, even one that is not a whole second (said, though it cannot be acknowledged).
  const marked = typeof raw.damaged_report_at === 'number' && raw.damaged_report_at > 0;
  const lost = marked && (damagedAt === null || acked !== damagedAt);
  if (lost && state === 'clear') state = 'unknown';
  return {
    on,
    state,
    foreign,
    earlier,
    beforeRecord: count(raw.before_record),
    lost,
    /* The lost marker's value, so an acknowledgement names exactly the one the person saw (null when none). */
    lostAt: damagedAt,
    key: foreign + earlier > 0 ? findingKey(raw) : null,
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

/** kosmos#6613: a person has seen the lost-report notice for marker `at` (the `lostAt` they were shown). Refused when the
    report's marker is no longer that value, so an acknowledgement never covers a later loss. */
function ackLostIn(dir, at) {
  if (!Number.isInteger(at) || at <= 0) return { ok: false, because: 'say which report' };
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, REPORT_FILE), 'utf8')); } catch { raw = null; }
  if (!raw || secs(raw.damaged_report_at) !== at) return { ok: false, because: 'that report is no longer the one to acknowledge' };
  /* Whole or not at all (a temp file then a rename), so a read never sees an empty record and says the loss again. */
  const file = path.join(dir, LOST_ACK_FILE), tmp = file + '.' + process.pid + '.' + Date.now() + '.' + Math.random().toString(16).slice(2) + '.tmp';
  try {
    fs.writeFileSync(tmp, String(at) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
    return { ok: true };
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing was left */ }
    return { ok: false, because: 'we could not save that' };
  }
}

module.exports = { certWatchFrom, setCertWatchIn, ackLostIn, findingKey, REPORT_FILE, OFF_FILE, LOST_ACK_FILE, STALE_MS };
