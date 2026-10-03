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

/* The runs in a run file, oldest first: [{ start, end }] in ms, end null while running, plus `deliberate`: every
   "kosmos <epoch>" line (a restart, switch or change Kosmos itself made, written by noteDeliberate). A line that is not
   one of the three is skipped; an "end" with no open start is skipped; a "start" while one is open ENDS the old one
   at the new start (its own end was never seen). Review 1: the deliberate times live HERE, in the run file nothing clears, because the
   disruption record is cleared on the first live reading after a restart and holds only the latest one. */
function parse(text) {
  const runs = [];
  const deliberate = [];
  let open = null;
  for (const line of String(text || '').split('\n')) {
    const m = /^(start|end|kosmos) (\d{9,11})$/.exec(line.trim());
    if (!m) continue;
    const ms = Number(m[2]) * 1000;
    if (m[1] === 'kosmos') { deliberate.push(ms); continue; }
    if (m[1] === 'start') {
      // A start whose end never came (a supervisor stopped by TERM or bootout, a reboot) ends at the next start and is
      // marked ORPHAN. Review 2: an orphan is never counted as a crash, because a person or an update bouncing an agent
      // leaves exactly this shape. A launch that FAILS writes a real end line (the supervisor's EXIT trap), so it counts.
      if (open) { open.end = ms; open.orphan = true; }
      open = { start: ms, end: null }; runs.push(open);
    }
    else if (open && ms >= open.start) { open.end = ms; open = null; }
  }
  const out = runs.slice();
  out.deliberate = deliberate;
  return out;
}

/* Pure. `runs` from parse; `deliberateAt` is a time (ms), or a list of times, at which Kosmos itself disrupted the
   agent (null for none); `runs.deliberate` (from parse) is added to it. A run any of them falls inside (with
   DISRUPTION_SLACK_MS either side) is not counted. Returns { looping, count, firstAt, lastAt }. */
function assess(runs, now, deliberateAt) {
  const list = Array.isArray(runs) ? runs : [];
  const latest = list[list.length - 1];
  // A run that has lived past the short threshold, ended or not, means it is not looping now.
  if (latest && (latest.end === null ? now - latest.start > SHORT_RUN_MS : latest.end - latest.start > SHORT_RUN_MS)) {
    return { looping: false, count: 0, firstAt: null, lastAt: null };
  }
  const marks = [].concat(deliberateAt == null ? [] : deliberateAt, Array.isArray(list.deliberate) ? list.deliberate : [])
    .filter((t) => Number.isFinite(t));
  const short = list.filter((r) => r.end !== null && r.orphan !== true
    && r.end - r.start <= SHORT_RUN_MS
    && r.end >= now - WINDOW_MS && r.end <= now + DISRUPTION_SLACK_MS
    && !marks.some((t) => t >= r.start - DISRUPTION_SLACK_MS && t <= r.end + DISRUPTION_SLACK_MS));
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

/* Review 1: Kosmos is about to disrupt this agent on purpose (a restart, a switch, an instructions change). Called
   from disruption.begin, the one door every such path goes through. Best-effort: a failed write only means the
   run it ends may be counted. */
function noteDeliberate(sessionName, now = Date.now()) {
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.appendFileSync(fileFor(sessionName), 'kosmos ' + Math.floor(now / 1000) + '\n');
    return true;
  } catch { return false; }
}

/* Review 1: the agent was removed, or a new one is being made under its name: its runs go with it, so a new agent
   never inherits "Keeps stopping" from the last one. */
function forget(sessionName) {
  try { fs.rmSync(fileFor(sessionName), { force: true }); return true; } catch { return false; }
}

/* The phone tick's decision, pure (review 1: it was untested). For each run-file `key`, `readOne(key)` answers; a key
   that is looping and not in `told` is told once (`tell(key, answer)`) and remembered; a key whose OWN read says it is
   not looping is forgotten, so a later loop tells again. A key merely missing from this pass is NOT forgotten.
   Returns the keys told this pass. */
function tellLoops({ keys, told, readOne, tell }) {
  const out = [];
  for (const key of Array.isArray(keys) ? keys : []) {
    let c;
    try { c = readOne(key); } catch { continue; }
    if (!c || c.looping !== true) { told.delete(key); continue; }
    if (told.has(key)) continue;
    told.add(key);
    try { tell(key, c); } catch { /* a failed push is not retried this episode */ }
    out.push(key);
  }
  return out;
}

/* The run files on disk, as keys (the file name less .log). */
function keys() {
  try { return fs.readdirSync(dir()).filter((f) => f.endsWith('.log')).map((f) => f.slice(0, -4)); } catch { return []; }
}

module.exports = { SHORT_RUN_MS, WINDOW_MS, LOOP_RUNS, DISRUPTION_SLACK_MS, dir, fileFor, parse, assess, read, noteDeliberate, forget, tellLoops, keys };
