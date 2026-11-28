'use strict';

/*
 * kosmos#9217 slice 2: taking turns on a heavy job, so agents on one computer stop keeping the order in room posts.
 *
 * A turn is a heavy job (engine/heavyjobs.js) with a line in front of it. `kosmos heavy take "<label>" [--pid N]`
 * (POST /api/heavy, action take) never blocks: when nothing heavy is recorded on this computer and the caller is first
 * in line (or the line is empty), it records the caller's heavy job, exactly as `start` does, and says "your turn";
 * otherwise it keeps the caller's place and says who has the turn and who is ahead. Calling it again keeps the place,
 * so an agent polls it. `kosmos heavy release` gives the place up, or ends the turn (as `end`). The holder is whatever
 * heavyjobs.live() shows, so there is no second record of the same fact, and an agent that only ever uses `start`
 * still counts as the holder for everyone who asks to take.
 *
 * The line lives in <data root>/heavy-line.json, oldest place first. A place lasts while its agent keeps asking: one
 * that has not called take for PLACE_IDLE_MS (30 min) is gone, whatever its process, so the board never names as next
 * an agent that stopped asking. Inside that, it is judged as a heavy-job record is (heavyjobs.judge): with --pid while
 * that process runs, without while its agent is on the roster. A place at the FRONT, with the turn free, must be taken
 * within GRACE_MS of another agent's take first finding the turn free for it (so in the waiter's favour, never less):
 * past that it goes to the back once, and out on the second miss.
 * Start-time reads: the places and the jobs judged in one take share one heavyjobs ps budget (budgetedStartOf, which
 * the server's take route also hands to its refresh read); the caller's own process is read fresh, and recording the
 * turn (heavyjobs.start) reads it, and its agent's aged records, with start's own small budget.
 *
 * Weakest premise: that agents poll take. The line informs; it does not stop an agent that runs its job without it.
 */

const fs = require('fs');
const path = require('path');
const hj = require('./heavyjobs');

const FILE = 'heavy-line.json';
const GRACE_MS = 2 * 60 * 1000;
const PLACE_IDLE_MS = 30 * 60 * 1000;   // a place nobody has asked for in this long is gone (round 3)
const MAX_LINE = 20;   // a bound on the file, not a policy: no computer has twenty agents waiting for one turn
const MAX_PLACES_PER_AGENT = 4;   // as heavyjobs' MAX_PER_AGENT: one place for each wrapper an agent runs

function fileOf(root) { return path.join(root, FILE); }

function readLine(root) {
  let list;
  try { list = JSON.parse(fs.readFileSync(fileOf(root), 'utf8')); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list.filter((e) => e && typeof e === 'object'
    && typeof e.agent === 'string' && e.agent
    && typeof e.label === 'string' && e.label
    && Number.isFinite(e.since) && Number.isFinite(e.at)
    && (e.pid === null || Number.isSafeInteger(e.pid))
    && (e.pidStart === null || typeof e.pidStart === 'string')
    && (e.front === null || Number.isFinite(e.front))
    && (e.missed === 0 || e.missed === 1));
}

function writeLine(root, list) {
  try {
    require('./store').saveFlushed(fileOf(root), JSON.stringify(list.slice(0, MAX_LINE)) + '\n');
    return true;
  } catch {
    return false;
  }
}
const NOT_SAVED = 'Kosmos could not save its place in the line just now';

function locked(root, fn) {
  try { fs.mkdirSync(root, { recursive: true }); } catch { /* the lock below says so */ }
  return require('./filelock').withFileLock(fileOf(root), fn, {
    busy: 'another agent is taking a turn right now; try again',
    cannotAccess: 'Kosmos could not write its line of turns',
  });
}

const mine = (agent, p) => (e) => e.agent === agent && e.pid === p;
const shown = (e) => ({ agent: e.agent, label: e.label, pid: e.pid, since: e.since });
// A place is judged by the heavy-job rules: `since` is when it joined, `at` the last time it asked. The idle limit keeps it
// far inside heavyjobs' 12 h ceiling, so a place is only ever shown or dropped, never hidden.
const judgePlace = (e, opts) => (opts.now - e.at > PLACE_IDLE_MS ? 'drop' : hj.judge(e, opts));
const keeps = (e, opts) => judgePlace(e, opts) !== 'drop';

/* Take a turn, or keep a place. Returns { ok, turn: true, job } when the caller now holds the turn,
   { ok, turn: false, place, holder, ahead } when it waits (place is 1 for first in line), or { ok: false, because }. */
function take({ root, agent, label, pid, now = Date.now(), startOf = hj.defaultStartOf, agentAlive = null, othersOf = null }) {
  if (!agent) return { ok: false, because: 'Kosmos could not tell which agent you are' };
  let lab, p;
  try { lab = hj.normalizeLabel(label); p = hj.normalizePid(pid); }
  catch (err) { return { ok: false, because: err.message, refused: true }; }
  let pidStart = null;
  if (p !== null) {
    const s = startOf === hj.defaultStartOf ? hj.defaultStartOf(p, now, 'fresh') : startOf(p);
    if (s === null) return { ok: false, because: 'there is no process ' + p + ' on this computer', refused: true };
    pidStart = typeof s === 'string' ? s : null;
  }
  // One ps budget for every other read in this take (othersOf: a caller's reader, so the server shares one with the read
  // it made just before); the caller's own process is read fresh, as start does.
  const others = othersOf || (startOf === hj.defaultStartOf ? hj.budgetedStartOf(now) : startOf);
  let out = null;
  const r = locked(root, () => {
    const opts = { now, startOf: others, agentAlive };
    let line = readLine(root).filter((e) => keeps(e, opts));   // the caller's own lapsed place too: it rejoins at the back
    // hidden: a job this read could not check still holds the turn, so the turn never looks free for want of a ps read.
    const jobs = hj.live({ root, now, startOf: others, agentAlive, hidden: true });
    let held = jobs.find((j) => j.agent === agent && j.pid === p);
    // Round 7: the one case where an agent's own job is this take's turn. It holds the turn with no process and now
    // takes it under a wrapper (--pid): the turn moves to the wrapper, so it stays ONE job. Any other job of its own,
    // under another pid, is busy like anyone's: a second wrapper waits. Round 8: the wrapper's record is made FIRST and
    // the one without a process ended only once it exists, so a failed start leaves the turn where it was.
    // Round 9: it moves only when that record is the agent's ONLY job (with another of its own running, a new wrapper
    // waits, as round 7 says); and once the wrapper holds the turn, a record without a process left by a failed end is
    // ended by its next take, so the two never outlive one more ask.
    const own = jobs.filter((j) => j.agent === agent);
    const bare = p !== null ? (own.find((j) => j.pid === null) || null) : null;
    if (!held && bare && own.length === 1) held = bare;
    if (held) {   // already the holder: asking again is not a place in its own line, and re-announces (a new label shows)
      line = line.filter((e) => !mine(agent, p)(e));
      const again = hj.start({ root, agent, label: lab, pid: p, now, startOf });
      if (!again.ok) { out = again; return; }   // the old record, if this was a move, is untouched: the turn stays
      if (bare) hj.end({ root, agent, pid: null });   // moved, or left over: a failed end is retried by the next take --pid
      out = writeLine(root, line) ? { ok: true, turn: true, job: again.job } : { ok: true, turn: true, job: again.job, lineNotSaved: true };
      return;
    }
    const busy = jobs;   // any live job, the caller's own included (round 7: excluding them let one agent hold two turns)
    let me = line.find(mine(agent, p));
    if (!me) {
      if (line.length >= MAX_LINE) { out = { ok: false, because: 'the line already has ' + MAX_LINE + ' places; try again later', refused: true }; return; }
      if (line.filter((e) => e.agent === agent).length >= MAX_PLACES_PER_AGENT) {
        out = { ok: false, because: 'you already have ' + MAX_PLACES_PER_AGENT + ' places in the line; kosmos heavy release --pid N gives one up', refused: true };
        return;
      }
      me = { agent, label: lab, pid: p, pidStart, since: now, at: now, front: null, missed: 0 };
      line.push(me);
    }
    me.label = lab; me.at = now;
    if (pidStart) me.pidStart = pidStart;
    if (busy.length) {
      for (const e of line) e.front = null;   // the turn is not free, so nobody's grace is running
    } else {
      // The turn is free. A front place that has had it free for GRACE_MS without taking it goes to the back once, then
      // out; each place is looked at once per take, so this ends.
      for (let n = line.length; n > 0 && line[0] !== me && line[0].front !== null && now - line[0].front > GRACE_MS; n--) {
        const late = line.shift();
        if (late.missed === 0) line.push({ ...late, front: null, missed: 1 });
      }
      if (line[0] === me) {
        const s = hj.start({ root, agent, label: lab, pid: p, now, startOf });
        if (!s.ok) { out = s; return; }   // refused or not saved: the place is kept, unwritten, as it was
        line = line.slice(1);
        // Not saved: the turn is recorded, but the caller's old place stays in the file until its release (which removes
        // it) or the idle limit; meanwhile it counts as a place ahead of others. Rare: it needs a failed write.
        out = writeLine(root, line) ? { ok: true, turn: true, job: s.job } : { ok: true, turn: true, job: s.job, lineNotSaved: true };
        return;
      }
      if (line[0].front === null) line[0].front = now;
    }
    const at = line.indexOf(me);
    out = writeLine(root, line)
      ? { ok: true, turn: false, place: at + 1, holder: busy.length ? busy[0] : null, ahead: line.slice(0, at).map(shown) }
      : { ok: false, because: NOT_SAVED };
  });
  if (!r.ok) return { ok: false, because: r.because };
  return out;
}

/* Give up a place, and end the turn if the caller holds it. */
function release({ root, agent, pid }) {
  if (!agent) return { ok: false, because: 'Kosmos could not tell which agent you are' };
  let p;
  try { p = hj.normalizePid(pid); } catch (err) { return { ok: false, because: err.message, refused: true }; }
  let left = 0, saved = true;
  const r = locked(root, () => {
    const line = readLine(root);
    const keep = line.filter((e) => !mine(agent, p)(e));
    left = line.length - keep.length;
    if (left) saved = writeLine(root, keep);
  });
  if (!r.ok) return { ok: false, because: r.because };
  if (!saved) return { ok: false, because: NOT_SAVED };
  const e = hj.end({ root, agent, pid: p });
  if (!e.ok) return { ok: false, because: e.because };
  return { ok: true, left, ended: e.ended, others: e.others };   // others: the agent's jobs left (tied to other pids)
}

/* The line, oldest place first, as { agent, label, pid, since }: a read, which never waits, and removes only the
   places it judged gone. The idle limit keeps every place far inside heavyjobs' 12 h ceiling, so a place this read did
   not ask ps about (over budget) is shown on signal 0, as a job inside the ceiling is. */
function waiting({ root, now = Date.now(), startOf = null, agentAlive = null }) {
  const s = startOf || hj.budgetedStartOf(now);
  const all = readLine(root);
  const verdict = all.map((e) => judgePlace(e, { now, startOf: s, agentAlive }));
  if (verdict.includes('drop')) {
    // As heavyjobs.live does: exactly the places this read dropped leave the file (re-read under the lock, so a place
    // taken meanwhile stays), when the lock can be had at once. Without it a gone waiter's place would outlive the
    // roster mark that judged it gone (server.js heavyNow keeps a mark only while its agent has a job or a place).
    const key = (e) => e.agent + '\u0000' + e.pid + '\u0000' + e.since + '\u0000' + e.at;
    const gone = new Set(all.filter((_, i) => verdict[i] === 'drop').map(key));
    require('./filelock').withFileLock(fileOf(root), () => {
      writeLine(root, readLine(root).filter((e) => !gone.has(key(e))));
    }, { waitMs: 0 });   // busy, or not saved: the next read tries again
  }
  return all.filter((_, i) => verdict[i] === 'show').map(shown);
}

module.exports = { FILE, GRACE_MS, PLACE_IDLE_MS, MAX_LINE, MAX_PLACES_PER_AGENT, readLine, take, release, waiting };
