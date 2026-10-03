'use strict';
/*
 * #5154 slice A (bounded retries): tell a crash LOOP from a healthy agent, so the board says "Kosmos keeps
 * restarting this agent and it keeps stopping" instead of showing an agent that looks fine between crashes.
 *
 * The signal. bin/agent-supervisor.sh appends "start <epoch>" when it launches an agent's session and
 * "end <epoch>" when that session is confirmed gone, to <data root>/runs/<key>.log (the key is store.safeKey's
 * rule). launchd restarts the supervisor every time its agent ends (KeepAlive, ThrottleInterval 30 s), so an agent
 * that crashes on start leaves a run of short lines.
 *
 * The rule (conservative, because a false "needs you" on a healthy agent teaches a person to ignore the real
 * ones): LOOP_RUNS runs, each of which ENDED on its own within SHORT_RUN_MS of starting, all ending inside
 * WINDOW_MS, and the newest run is not a long-lived one. Not counted:
 *  - a run that lived longer than SHORT_RUN_MS (a person stopping a working agent, a normal exit);
 *  - a run ended by a deliberate Kosmos disruption (a restart, a switch, a model change: engine/disruption.js)
 *    that began during it (or within DISRUPTION_SLACK_MS of its end);
 *  - anything older than WINDOW_MS.
 * It clears by itself once a run lives past SHORT_RUN_MS, or once the window has no such runs.
 *
 * Unmeasured (said on the card): how often real agents do this. The supervisor's own log is trimmed at every
 * start, so no history survived to tune against; these numbers are a deliberate, cautious guess.
 */

const fs = require('fs');
const path = require('path');
const store = require('./store');

const SHORT_RUN_MS = 2 * 60 * 1000;
const WINDOW_MS = 30 * 60 * 1000;
const LOOP_RUNS = 3;
const DISRUPTION_SLACK_MS = 10 * 1000;

function dir() { return path.join(store.ROOT, 'runs'); }
function fileFor(sessionName) { return path.join(dir(), store.safeKey(sessionName) + '.log'); }

/* The runs in a run file, oldest first: [{ start, end }] in ms, end null while running. A line that is not
   "start <n>" or "end <n>" is skipped; an "end" with no open start is skipped; a "start" while one is open closes
   nothing (the old one is treated as unknown and dropped, since its end was never seen). */
function parse(text) {
  const runs = [];
  let open = null;
  for (const line of String(text || '').split('\n')) {
    const m = /^(start|end) (\d{9,11})$/.exec(line.trim());
    if (!m) continue;
    const ms = Number(m[2]) * 1000;
    if (m[1] === 'start') { open = { start: ms, end: null }; runs.push(open); }
    else if (open && ms >= open.start) { open.end = ms; open = null; }
  }
  return runs.filter((r) => r.end !== null || r === runs[runs.length - 1]);
}

/* Pure. `runs` from parse; `deliberateAt` is when the last deliberate disruption began (ms) or null.
   Returns { looping, count, firstAt, lastAt } (counts and times of the short runs that make the loop). */
function assess(runs, now, deliberateAt) {
  const list = Array.isArray(runs) ? runs : [];
  const latest = list[list.length - 1];
  // A run that has lived past the short threshold, ended or not, means it is not looping now.
  if (latest && (latest.end === null ? now - latest.start > SHORT_RUN_MS : latest.end - latest.start > SHORT_RUN_MS)) {
    return { looping: false, count: 0, firstAt: null, lastAt: null };
  }
  const short = list.filter((r) => r.end !== null
    && r.end - r.start <= SHORT_RUN_MS
    && r.end >= now - WINDOW_MS && r.end <= now + DISRUPTION_SLACK_MS
    && !(Number.isFinite(deliberateAt) && deliberateAt >= r.start - DISRUPTION_SLACK_MS && deliberateAt <= r.end + DISRUPTION_SLACK_MS));
  if (short.length < LOOP_RUNS) return { looping: false, count: short.length, firstAt: null, lastAt: null };
  return { looping: true, count: short.length, firstAt: short[0].start, lastAt: short[short.length - 1].end };
}

/* The live answer for one agent. Never throws: an unreadable file is "not looping". */
function read(sessionName, now = Date.now()) {
  let text = '';
  try { text = fs.readFileSync(fileFor(sessionName), 'utf8'); } catch { return { looping: false, count: 0, firstAt: null, lastAt: null }; }
  let deliberateAt = null;
  try {
    const d = require('./disruption').read(sessionName);
    if (d && d.found === true) { const ms = Date.parse(d.startedAt); if (Number.isFinite(ms)) deliberateAt = ms; }
  } catch { deliberateAt = null; }
  try { return assess(parse(text), now, deliberateAt); } catch { return { looping: false, count: 0, firstAt: null, lastAt: null }; }
}

module.exports = { SHORT_RUN_MS, WINDOW_MS, LOOP_RUNS, DISRUPTION_SLACK_MS, dir, fileFor, parse, assess, read };
