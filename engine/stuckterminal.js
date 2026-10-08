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
 * ON DISK, like crashloop's run files (store.ROOT/stuck/<key>.json holding {state, sinceAt}), for ONE
 * reason: `forget` must be reachable from engine/create.js, remove.js and delete-leftover.js so a
 * removed-and-recreated agent of the same name never inherits the old episode's clock (the chief risk,
 * and what slice A's forget-on-create guards). An in-memory Map in server.js cannot be reached from
 * those modules. `dir()` reads store.ROOT at call time, never at require (convention #2): nothing here
 * freezes the root.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

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

function dir() { return path.join(store.ROOT, 'stuck'); }
function fileFor(key) { return path.join(dir(), store.safeKey(key) + '.json'); }

// The stored anchor for one agent, or null (absent/unreadable/malformed). Never throws.
function readAnchor(key) {
  let text;
  try { text = fs.readFileSync(fileFor(key), 'utf8'); } catch { return null; }
  try {
    const a = JSON.parse(text);
    if (a && isTerminal(a.state) && Number.isFinite(a.sinceAt)) return { state: a.state, sinceAt: a.sinceAt };
  } catch { /* a malformed file reads as no anchor */ }
  return null;
}

// Write the anchor (or delete the file when null). Never throws. Written atomically (tmp + rename) so a
// concurrent 5s peek never reads a half-written file and a crash mid-write never leaves a truncated one.
function writeAnchor(key, anchor) {
  try {
    if (!anchor) { try { fs.unlinkSync(fileFor(key)); } catch { /* already gone */ } return; }
    fs.mkdirSync(dir(), { recursive: true });
    const dest = fileFor(key);
    const tmp = dest + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ state: anchor.state, sinceAt: anchor.sinceAt }));
    fs.renameSync(tmp, dest);   // atomic on the same filesystem
  } catch { /* a board that cannot write its own data dir simply does not escalate; never fatal */ }
}

/*
 * The next anchor for an agent, given its recorded anchor and its CURRENT state. Pure.
 *  - not in a terminal state  -> null  (recovered, or never stuck: the caller clears the file)
 *  - terminal, same as before  -> the SAME anchor (the error is continuing; the clock keeps running)
 *  - terminal, new/switched    -> a fresh anchor at `now` (a different error is a different episode)
 * An anchor is `{ state, sinceAt }`.
 */
function nextAnchor(anchor, state, now) {
  if (!isTerminal(state)) return null;
  if (anchor && anchor.state === state) return anchor;
  return { state: state, sinceAt: now };
}

function sameAnchor(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.state === b.state && a.sinceAt === b.sinceAt;
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
 * Advance the stored anchor for this agent to its current state and return its assessment. The WRITER:
 * only the 60s sweep calls this (via tellStuck). Writes only on a transition (enter / switch / recover),
 * so a continuously-stuck agent costs one read and no write per tick.
 */
function read(key, state, now) {
  if (now === undefined) now = Date.now();
  const prev = readAnchor(key);
  const next = nextAnchor(prev, state, now);
  if (!sameAnchor(prev, next)) writeAnchor(key, next);
  return assess(next, now);
}

/* READ-ONLY: the current assessment without advancing the clock, but ONLY if the stored anchor matches the
   agent's CURRENT state. /api/status (every 5s) passes the live state, so a just-switched (rate_limited ->
   auth_failed) or just-recovered agent stops showing the stale state's sentence/clock at once, rather than
   waiting up to a 60s sweep to rewrite the anchor. Never advances the clock. */
function peek(key, state, now) {
  if (now === undefined) now = Date.now();
  const a = readAnchor(key);
  if (!a || a.state !== state) return { stuck: false, state: null, sinceAt: null, forMs: 0 };
  return assess(a, now);
}

/* Wipe every anchor. Called once at board boot so a RESTART re-anchors from the live state (the plan's
   intended property): the anchor is a derived clock, not ground truth, so a board that was down must not
   judge an agent stuck on a clock from before the downtime. Never throws. */
function clearAll() {
  try { for (const f of fs.readdirSync(dir())) { try { fs.unlinkSync(path.join(dir(), f)); } catch { /* already gone */ } } }
  catch { /* no dir yet: nothing to clear */ }
}

/* Drop an agent's anchor (a removed/recreated agent never inherits an old episode -- as crashloop.forget).
   Wired into engine/create.js, remove.js and delete-leftover.js beside the crashloop.forget calls. */
function forget(key) { writeAnchor(key, null); }

/* The safeKey'd names of agents with a stored anchor (the files in dir()), like crashloop.keys(). Used by
   tellStuck to prune anchors for agents that have LEFT the roster. Never throws. */
function keys() {
  try { return fs.readdirSync(dir()).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); }
  catch { return []; }
}

/*
 * The once-per-episode sweep, encapsulated here so it is unit-testable (mirrors crashloop.tellLoops).
 * The caller (server.js, from the 60s tick) passes:
 *   - rows: the agents it runs this tick, each `{ key, state, shown }` (only agents we started).
 *   - told: a Set tracking which agents have already been told THIS episode.
 *   - now: the clock.
 *   - tell(key, assessment, shown): the side effect (log + phone push). Called at most ONCE per episode.
 * Behaviour: advance/clear each agent's stored anchor; tell once when it first crosses the threshold;
 * clear the told-mark the moment it recovers, so a later episode tells again. Then, because the caller
 * invokes this ONLY on a GOOD roster (it skips on roster === null), prune the anchor AND the told-mark of
 * any agent no longer in `rows`: an agent that LEFT the roster without a remove event (a world closed, a
 * pause, a dead session) must not return later in the same terminal state and be judged stuck on its old
 * clock. forget-on-create/remove/delete covers an explicit removal; this covers the rest. A genuinely
 * empty roster correctly prunes everything (no agents, no anchors); a FAILED read is null and never reaches
 * here, so a transient enumerate failure never wipes a genuinely-stuck clock.
 */
function tellStuck({ rows, told, now, tell }) {
  if (now === undefined) now = Date.now();
  const liveSafe = new Set();
  for (const row of rows || []) {
    if (!row || !row.key) continue;
    liveSafe.add(store.safeKey(row.key));
    const r = read(row.key, row.state, now);
    if (r.stuck) {
      if (!told.has(row.key)) { told.add(row.key); tell(row.key, r, row.shown || row.key); }
    } else {
      told.delete(row.key);
    }
  }
  // #5154 slice C (review 2): on a GOOD roster (the caller only invokes tellStuck when the snapshot read
  // succeeded -- it skips on roster === null), forget the anchor of any agent that is NO LONGER present.
  // An agent that LEFT the roster while anchored -- a world closed, a pause, a session gone without a
  // remove event -- must not come back later in the same terminal state and be judged stuck on its OLD
  // clock (the chief risk). forget-on-remove covers an explicit removal; this covers the rest. Safe
  // because it runs only on a good roster; a transient enumerate failure never reaches here to wipe a clock.
  for (const dk of keys()) if (!liveSafe.has(dk)) { try { fs.unlinkSync(path.join(dir(), dk + '.json')); } catch { /* already gone */ } }
  // Prune the told-mark too, or a departed-then-returned agent's new episode never re-pushes (its key
  // stays in told) and the Set grows without bound. told is keyed by sessionName; compare via safeKey.
  for (const tk of Array.from(told)) if (!liveSafe.has(store.safeKey(tk))) told.delete(tk);
}

module.exports = { TERMINAL_STATES, STUCK_MS, isTerminal, dir, fileFor, readAnchor, writeAnchor, nextAnchor, sameAnchor, assess, read, peek, forget, keys, clearAll, tellStuck };
