'use strict';
/*
 * #5154 slice C: a RECURRING terminal error, bounded and named.
 *
 * Slice A (engine/crashloop.js) bounds a process crash LOOP. This bounds the other half of the ask:
 * an agent stuck on the SAME terminal error -- an expired login (`auth_failed`) or a rate limit that
 * never lifts (`rate_limited`). When the same terminal state has stood continuously past a
 * conservative threshold, Kosmos raises ONE needs-you per episode that names the error and the action,
 * and clears itself when the agent recovers.
 *
 * SIGNAL, NOT A SECOND DERIVATION (repo convention #5): this reads the state status.js already
 * classified (the agent snapshot's `a.state`, STATE.AUTH_FAILED / STATE.RATE_LIMITED). It never
 * re-derives the state from a pane or a transcript.
 *
 * TRANSIENT IS EXCLUDED ON PURPOSE: `connection_lost` is a transient network state with its own
 * self-heal (engine/connlost-heal.js) and is NOT a terminal error, so it is not bounded here. Only the
 * two terminal states below are, because they do not clear on their own on any useful timescale
 * (an expired login never self-heals; a rate limit can outlast a person's patience).
 *
 * ANCHOR IS IN-MEMORY: `a.state` is only the CURRENT state, so the caller keeps a Map (a "book", like
 * server.js's CONNLOST_BOOK) recording when each agent entered its current terminal state. read()
 * updates that book each poll; no per-poll disk write (this runs on the 5s status path). Nothing here
 * freezes store.ROOT at require time, so the sandbox-every-root trap (convention #2) does not apply.
 */

// The terminal states this bounds. NOT connection_lost (transient) and NOT needs_you (the agent's own
// question, which must never be masked -- precedence rule). Spellings match status.js STATE constants.
const TERMINAL_STATES = Object.freeze(['auth_failed', 'rate_limited']);

// Per-state threshold, deliberately conservative (false alarms are the chief risk -- a needs-you on a
// healthy agent teaches people to ignore the real ones). An expired login does not self-heal, so it is
// the shorter wait; a rate limit legitimately persists a while, so it gets longer before Kosmos speaks.
// Starting values, logged before they push; tune from real boards (no fleet history survived to tune
// against, same as slice A).
const STUCK_MS = Object.freeze({
  auth_failed: 15 * 60 * 1000,
  rate_limited: 30 * 60 * 1000,
});

function isTerminal(state) { return TERMINAL_STATES.indexOf(state) !== -1; }

/*
 * The next anchor for an agent, given its recorded anchor and its CURRENT state. Pure.
 *  - not in a terminal state  -> null  (recovered, or never stuck: the caller clears the book entry)
 *  - terminal, same as before  -> the SAME anchor (the error is continuing; the clock keeps running)
 *  - terminal, new/switched    -> a fresh anchor at `now` (a different error is a different episode)
 * An anchor is `{ state, sinceAt }`.
 */
function nextAnchor(anchor, state, now) {
  if (!isTerminal(state)) return null;
  if (anchor && anchor.state === state) return anchor;
  return { state: state, sinceAt: now };
}

/*
 * Is this anchor past its threshold? Pure. Returns the shape the route/sweep and the board read:
 *   { stuck, state, sinceAt, forMs }
 * `stuck` is false for a null/non-terminal anchor and for one that has not yet crossed its threshold.
 */
function assess(anchor, now) {
  if (!anchor || !isTerminal(anchor.state)) return { stuck: false, state: null, sinceAt: null, forMs: 0 };
  const forMs = now - anchor.sinceAt;
  return { stuck: forMs >= STUCK_MS[anchor.state], state: anchor.state, sinceAt: anchor.sinceAt, forMs: forMs };
}

/*
 * Update the in-memory book for this agent and return its assessment. The one call the 5s status path
 * makes. `book` is a Map the caller owns (so the state survives across polls but not across a restart,
 * which is correct: a restart re-reads the live state and re-anchors).
 */
function read(book, key, state, now) {
  if (now === undefined) now = Date.now();
  const anchor = nextAnchor(book.get(key) || null, state, now);
  if (anchor) book.set(key, anchor); else book.delete(key);
  return assess(anchor, now);
}

/* Drop an agent's anchor (a removed/recreated agent never inherits an old episode -- as crashloop.forget). */
function forget(book, key) { book.delete(key); }

/*
 * The once-per-episode sweep, encapsulated here so it is unit-testable (mirrors crashloop.tellLoops).
 * The caller (server.js, from the 60s tick) passes:
 *   - rows: the agents it runs this tick, each `{ key, state, shown }` (only agents we started).
 *   - book: the anchor Map (this is the ONE place it is written).
 *   - told: a Set tracking which agents have already been told THIS episode.
 *   - now: the clock.
 *   - tell(key, assessment, shown): the side effect (log + phone push). Called at most ONCE per episode.
 * Behaviour: advance/clear each agent's anchor; tell once when it first crosses the threshold; clear the
 * told-mark the moment it recovers, so a later episode tells again. Then prune the book and the told set of
 * any agent not in `rows` (removed/gone) -- this is slice C's lifecycle-forget, since the in-memory book is
 * reachable only from the sweep.
 */
function tellStuck({ rows, book, told, now, tell }) {
  const liveKeys = new Set();
  for (const row of rows || []) {
    if (!row || !row.key) continue;
    liveKeys.add(row.key);
    const r = read(book, row.key, row.state, now);
    if (r.stuck) {
      if (!told.has(row.key)) { told.add(row.key); tell(row.key, r, row.shown || row.key); }
    } else {
      told.delete(row.key);
    }
  }
  for (const key of Array.from(book.keys())) if (!liveKeys.has(key)) book.delete(key);
  for (const key of Array.from(told)) if (!liveKeys.has(key)) told.delete(key);
}

module.exports = { TERMINAL_STATES, STUCK_MS, isTerminal, nextAnchor, assess, read, forget, tellStuck };
