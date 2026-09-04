'use strict';
/**
 * "How many lines of THIS pattern were on this agent's screen, and when." A
 * per-(agent, pattern) COUNT, and nothing else. (#1930)
 *
 * 🔑 WHY A COUNT AND NOT A TIMESTAMP OR A HASH, AND WHY THAT DISTINCTION IS THE
 * WHOLE POINT. liveness.js answers "was this agent seen at T" -- a heartbeat.
 * That is the report tier, and it is enough for #2146/#2019 (is the agent fresh
 * at all). It is NOT enough for #1930, where the question is narrower: a Claude
 * account probe reads HEALTHY, yet the pane shows a sign-in rejection. Is that
 * rejection STALE scrollback from before the account was repaired, or is a live
 * loop still hitting the API and getting NEW 401s under a probe that cached
 * healthy a moment ago? A global "was seen at T" cannot separate those -- the
 * agent is alive either way. What separates them is whether the AUTH-ERROR
 * REGION is still producing new lines, which is a per-pattern question, so the
 * signal is a per-pattern line COUNT.
 *
 * ⚠️ A RAW BYTE HASH WOULD NOT WORK AND WAS REJECTED (Pete's contract, point 4).
 * A spinner or a clock churns a whole-pane hash on every tick, so everything
 * would read perpetually live. Even a hash of just the auth-error region fails:
 * a frozen 401 screen and a live loop redrawing the SAME 401 text have the same
 * hash. Counting the auth-error MARKER lines, and asking whether that count
 * GREW SINCE THE PREVIOUS TICK, is what actually distinguishes a live loop
 * (producing new lines now) from stale scrollback (a static count).
 *
 * ⚠️ WEAKEST PREMISE, NAMED (Pete, 2026-09-04). The per-tick-delta compare
 * (`currentCount > previousTickCount`) catches a live loop only while new error
 * lines OUTPACE the pane-capture window. A steady-state loop AT the capture cap
 * -- old 401s scrolling off the top as fast as new ones append -- holds the
 * count flat tick-to-tick and reads as no-increase, i.e. MISSES the loop. That
 * is acceptable by design: a miss fails toward the existing HEALTHY-suppression
 * (the accepted #1930-first-half residual), NEVER toward a new false-calm, so
 * the tier still only ever REDUCES false-calm. If it proves too lossy the escape
 * hatch is to track the NEWEST auth-error line's identity (a new distinct newest
 * line is scroll-robust), not just the count. Count is the simpler first cut.
 *
 * 🛑 NO STATE MACHINE HERE, EXACTLY LIKE liveness.js AND disruption.js. This
 * module only records a number and reads it back. The decision of WHEN to
 * record (every tick, so the stored value is the PREVIOUS tick's count) versus
 * WHEN to clear (when the 401 leaves the screen or the probe goes non-healthy)
 * lives in the snapshot caller, the same begin/clear split disruption.js uses.
 * That keeps status.reconcileReport a pure function of its inputs: the caller
 * resolves an `activityFresh` verdict from this store and passes it in, like
 * `liveAuth` and `disruptionRec`.
 *
 * 🔑 THREE ANSWERS, NEVER TWO (the liveness discipline). `read` returns
 * found:false for "no sample recorded at all" -- which is every agent on its
 * FIRST tick under the guard -- and that is deliberately NOT the same as a
 * recorded count
 * of 0. A caller that treated no-sample as count 0 would compute a spurious
 * increase the first time a real count landed, and un-suppress on no evidence,
 * which is the exact false-alarm direction #1930's one-directional guard must
 * never take.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const DIR = path.join(store.ROOT, 'activity');
const FILE_MODE = 0o600;

/* One file per (agent, pattern). Both halves go through store.safeKey so the
   filename is always a safe token; they are joined with a separator safeKey
   itself cannot introduce ambiguity into, because safeKey keeps `_` and `-`
   but the patternKeys we use ('auth-error') never contain the double-underscore
   we join on. patternKey is a controlled internal constant, never user input. */
function fileFor(sessionName, patternKey) {
  const nameKey = store.safeKey(sessionName); // throws on an unusable name
  const patKey = store.safeKey(patternKey);   // throws on an unusable pattern
  return path.join(DIR, nameKey + '__' + patKey + '.json');
}

/**
 * Record that this agent's screen showed `count` lines of `patternKey` at a
 * moment. An UNCONDITIONAL write -- the caller decides whether this is a
 * baseline (first healthy tick) or a refresh; this module just stores the
 * latest number. Returns {ok:true, count, at} or a refusal with a reason --
 * never throws at a caller, because the caller is a per-tick snapshot that must
 * not crash on a bookkeeping write.
 */
function record(sessionName, patternKey, count, atISO) {
  let file;
  try { file = fileFor(sessionName, patternKey); } catch {
    return { ok: false, because: 'that agent or pattern name is not one we can keep a record under' };
  }
  const n = Number(count);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, because: 'that is not a count we can read' };
  }
  const at = typeof atISO === 'string' && atISO ? atISO : new Date().toISOString();
  if (!Number.isFinite(Date.parse(at))) {
    return { ok: false, because: 'that is not a time we can read' };
  }
  try {
    fs.mkdirSync(DIR, { recursive: true });
    /* One line, rewritten. Only the latest count means anything; an append-only
       history would grow without ever being read past its tail, exactly as in
       liveness.js. */
    fs.writeFileSync(file, JSON.stringify({ count: Math.floor(n), at }) + '\n', { mode: FILE_MODE });
  } catch (e) {
    return { ok: false, because: 'we could not write that down (' + (e && e.code || 'unknown') + ')' };
  }
  return { ok: true, count: Math.floor(n), at };
}

/**
 * The recorded count for this (agent, pattern), if any.
 * 🔑 found:false means NO sample -- never baselined, or cleared -- and is
 * deliberately NOT a count of 0. Collapsing those is the defect this fleet
 * spent 2026-08-27 finding in eight separate instruments.
 */
function read(sessionName, patternKey) {
  let file;
  try { file = fileFor(sessionName, patternKey); } catch { return { found: false, because: 'unreadable agent or pattern name' }; }
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return { found: false, because: 'no activity sample has been recorded for this agent and pattern' };
    return { found: false, because: 'we could not read the activity record' };
  }
  let rec;
  try { rec = JSON.parse(raw); } catch { return { found: false, because: 'the activity record is not readable' }; }
  const count = rec && rec.count;
  if (!Number.isFinite(count) || count < 0) return { found: false, because: 'the activity record carries no readable count' };
  const ms = Date.parse((rec && rec.at) || '');
  if (!Number.isFinite(ms)) return { found: false, because: 'the activity record carries no readable time' };
  return { found: true, count: Math.floor(count), at: rec.at, ageMs: Date.now() - ms };
}

/**
 * Drop this (agent, pattern) sample. The caller clears it when the account
 * leaves HEALTHY, so the next healthy transition re-baselines against a fresh
 * count instead of an old one. Optional -- tests use it to reset. Never throws.
 */
function clear(sessionName, patternKey) {
  let file;
  try { file = fileFor(sessionName, patternKey); } catch { return { ok: false, because: 'unreadable agent or pattern name' }; }
  try { fs.rmSync(file, { force: true }); } catch (e) {
    return { ok: false, because: 'we could not clear that (' + (e && e.code || 'unknown') + ')' };
  }
  return { ok: true };
}

module.exports = { DIR, fileFor, record, read, clear };
