'use strict';
/**
 * kosmos#9038: whether the sign-in line on an agent's screen is from BEFORE its account's last sign-in.
 *
 * A repaired agent that has not been asked anything since keeps the old line in its bottom rows. Its account check
 * (engine/authprobe) reads HEALTHY, so the card is calm, but that answer is kept 30 seconds: on each re-check tick it
 * reads UNCHECKED, the card reads Sign-in Issue for a moment, and a refusal is recorded against a working account.
 *
 * THE EVIDENCE: the account's own login date moved LATER after the board first saw this line. A renewal never moves it
 * later (Claude Code 2.1.332 keeps the smaller of the two dates); only a new sign-in does. HEALTHY alone is not evidence:
 * `claude auth status` says signed in for a token Anthropic refuses (#874), and trusting it took the rejected badge off a
 * revoked account (#9031, review round 2).
 *
 * 🛑 EVERY DOUBT IS "NOT OLD", which is what the board did before this file: no line found, a line first seen after a
 * board restart, a date not read yet, a date read before the line was first seen (a sign-in between the two would make a
 * NEW line look old), another account, or a new line (the fingerprint below changed).
 *
 * In memory only: a restart forgets, and the line is then treated as before. Dependency-free but for the patterns.
 */
const { AUTH_FAILED_MARKERS, AUTH_FRIENDLY_MESSAGE } = require('./claudesignintext');

/* Rows of context above the last sign-in row. The same refusal printed again has the new prompt above it; the count of
   sign-in rows on the screen covers two identical exchanges one after the other. */
const CONTEXT_ROWS = 8;

/* The line's fingerprint, or null when no sign-in row is found. A row counts on the message alone, wider than the
   classifier (no envelope, no remedy): a row too many only makes the fingerprint change, which reads as a new line. */
function fingerprint(text) {
  const rows = String(text == null ? '' : text).split('\n').map((r) => r.trimEnd());
  let last = -1;
  let count = 0;
  rows.forEach((row, i) => {
    if (AUTH_FRIENDLY_MESSAGE.test(row) || AUTH_FAILED_MARKERS.some((re) => re.test(row))) { last = i; count += 1; }
  });
  if (last < 0) return null;
  return JSON.stringify([count, rows.slice(Math.max(0, last - CONTEXT_ROWS), last + 1)]);
}

const seen = new Map();   // agent -> { account, print, since, until, old }

/**
 * Whether this agent's line is old. `account` names the login the date belongs to; `date` is the last read of it,
 * { at: when that read began, until } or null. Called on every tick the line is up.
 */
function isOld(agent, { account, text, date, now }) {
  const print = fingerprint(text);
  if (print === null) { seen.delete(agent); return false; }
  const prev = seen.get(agent);
  if (!prev || prev.account !== account || prev.print !== print) {
    seen.set(agent, { account, print, since: now, until: null, old: false });
    return false;
  }
  if (prev.old) return true;   // it was printed before a sign-in, and that does not change
  if (!date || !Number.isFinite(date.until)) return false;
  if (prev.until === null) {
    if (date.at >= prev.since) prev.until = date.until;
    return false;
  }
  prev.old = date.until > prev.until;
  return prev.old;
}

function _clearForTest() { seen.clear(); }

module.exports = { isOld, fingerprint, CONTEXT_ROWS, _clearForTest };
