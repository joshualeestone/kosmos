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
 * The line lives in <data root>/heavy-line.json, oldest place first. A place is judged as a heavy-job record is
 * (heavyjobs.judge): with --pid it lasts while that process runs; without, while its agent is on the roster, and either
 * way at most MAX_AGE_MS from the last time it asked. A place at the FRONT, with the turn free, must be taken within
 * GRACE_MS of becoming free for it: past that it goes to the back once, and out on the second miss, so an agent that
 * stopped asking cannot hold the line.
 *
 * Weakest premise: that agents poll take. The line informs; it does not stop an agent that runs its job without it.
 */

const fs = require('fs');
const path = require('path');
const hj = require('./heavyjobs');

const FILE = 'heavy-line.json';
const GRACE_MS = 2 * 60 * 1000;
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
// A place is judged by the heavy-job rules: `since` is when it joined, `at` the last time it asked.
const keeps = (e, opts) => hj.judge(e, opts) !== 'drop';

/* Take a turn, or keep a place. Returns { ok, turn: true, job } when the caller now holds the turn,
   { ok, turn: false, place, holder, ahead } when it waits (place is 1 for first in line), or { ok: false, because }. */
function take({ root, agent, label, pid, now = Date.now(), startOf = hj.defaultStartOf, agentAlive = null }) {
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
  const others = startOf === hj.defaultStartOf ? (q) => hj.defaultStartOf(q, now, 'cached') : startOf;
  let out = null;
  const r = locked(root, () => {
    const opts = { now, startOf: others, agentAlive };
    let line = readLine(root).filter((e) => mine(agent, p)(e) || keeps(e, opts));
    const jobs = hj.live({ root, now, startOf: others, agentAlive });
    const held = jobs.find((j) => j.agent === agent && j.pid === p);
    if (held) {   // already the holder: asking again is not a place in its own line
      line = line.filter((e) => !mine(agent, p)(e));
      out = writeLine(root, line) ? { ok: true, turn: true, job: held } : { ok: false, because: NOT_SAVED };
      return;
    }
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
    if (jobs.length) {
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
        out = writeLine(root, line) ? { ok: true, turn: true, job: s.job } : { ok: true, turn: true, job: s.job, lineNotSaved: true };
        return;
      }
      if (line[0].front === null) line[0].front = now;
    }
    const at = line.indexOf(me);
    out = writeLine(root, line)
      ? { ok: true, turn: false, place: at + 1, holder: jobs.length ? jobs[0] : null, ahead: line.slice(0, at).map(shown) }
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
  return { ok: true, left, ended: e.ended };
}

/* The line, oldest place first, as { agent, label, pid, since }: a read, which never writes or waits. */
function waiting({ root, now = Date.now(), startOf = null, agentAlive = null }) {
  const s = startOf || ((q) => hj.defaultStartOf(q, now, 'cached'));
  return readLine(root).filter((e) => keeps(e, { now, startOf: s, agentAlive })).map(shown);
}

module.exports = { FILE, GRACE_MS, MAX_LINE, MAX_PLACES_PER_AGENT, readLine, take, release, waiting };
