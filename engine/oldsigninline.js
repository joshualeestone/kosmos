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
 * 🛑 EVERY DOUBT IS "NOT OLD", which is what the board did before this file:
 *   - the line left the screen, even for one tick (forget), or was not looked at for GAP_MS;
 *   - another run of the agent (the supervisor's run instance, stamped on its session), or no run known: a restart prints
 *     the same banner, prompt and refusal again, so its text alone cannot tell the two apart;
 *   - the agent's process reads another login than the one the date belongs to (#2129, #6095), or that could not be read;
 *   - a new line, or one whose rows above repeat on the screen (it could be a later copy of itself);
 *   - a date not read yet, or read before the line was first seen (a sign-in between the two would make a NEW line old).
 * In memory only: a board restart forgets, and the line is then treated as before.
 */
const { AUTH_FAILED_MARKERS, AUTH_FRIENDLY_MESSAGE } = require('./claudesignintext');

const CONTEXT_ROWS = 8;        // rows above the last sign-in row that are part of the fingerprint
const GAP_MS = 3 * 60 * 1000;  // the slowest board sweep is about 60 s; past this the board was stalled or the Mac asleep

/* The line's fingerprint: how many sign-in rows the capture holds, the last one, and the rows above it. null when there is
   none, or when that block stands twice in the capture. A row counts on the message alone, wider than the classifier (no
   envelope, no remedy): a row too many only changes the fingerprint, which reads as a new line. */
function fingerprint(text) {
  const rows = String(text == null ? '' : text).split('\n').map((r) => r.trimEnd());
  let last = -1;
  let count = 0;
  rows.forEach((row, i) => {
    if (AUTH_FRIENDLY_MESSAGE.test(row) || AUTH_FAILED_MARKERS.some((re) => re.test(row))) { last = i; count += 1; }
  });
  if (last < 0) return null;
  const from = Math.max(0, last - CONTEXT_ROWS);
  const block = rows.slice(from, last + 1);
  for (let at = 0; at < from; at++) if (block.every((row, i) => rows[at + i] === row)) return null;
  return JSON.stringify([count, block]);
}

const seen = new Map();   // agent -> { run, service, print, since, asked, until, old, mine }

function forget(agent) { seen.delete(agent); }

/**
 * Whether this agent's line is old. Called on every tick the line is up; forget() on every tick it is not.
 *   run      this run of the agent, '' when not known
 *   service  the login the date belongs to (loginexpiry.serviceNameFor)
 *   reads    () -> a promise of the login this agent's own process reads, or null when unknown. Asked once per line.
 *   date     the last read of that login's date, { at: when that read began, until } or null
 */
function isOld(agent, { run, service, reads, text, date, now }) {
  const print = fingerprint(text);
  if (!run || print === null) { forget(agent); return false; }
  const prev = seen.get(agent);
  if (!prev || prev.run !== run || prev.service !== service || prev.print !== print || now - prev.asked > GAP_MS) {
    const entry = { run, service, print, since: now, asked: now, until: null, old: false, mine: false };
    seen.set(agent, entry);
    Promise.resolve().then(reads).then((got) => { entry.mine = got === service; }, () => {});
    return false;
  }
  prev.asked = now;
  if (!prev.old && date && Number.isFinite(date.until)) {
    if (prev.until === null) { if (date.at >= prev.since) prev.until = date.until; } else prev.old = date.until > prev.until;
  }
  return prev.old && prev.mine;   // old stays: it was printed before a sign-in, and that does not change
}

function _clearForTest() { seen.clear(); }

module.exports = { isOld, forget, fingerprint, CONTEXT_ROWS, GAP_MS, _clearForTest };
