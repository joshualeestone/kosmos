'use strict';

/*
 * kosmos#9217 slice 1: "a heavy job is running on this computer, whose, and since when".
 *
 * The report (agents' feedback, 2026-11-26): several agents on one computer each start a long run (a full test suite,
 * a validation). Each is right on its own; two at once slow each other, and nothing in Kosmos said that one was already
 * running or whose it was, so agents took turns by posting free text in a room.
 *
 * An agent says so itself: `kosmos heavy start "<label>" [--pid N]`, `kosmos heavy end [--pid N]` (POST /api/heavy).
 * Records live in <data root>/heavy-jobs.json. A record CLEARS ITSELF, on every read, when:
 *   - it names a process (--pid) and that process is gone, or the number now belongs to another process (its start time,
 *     read by the server when the job started, no longer matches);
 *   - it names no process and its agent is gone (judged by the caller: server.js heavyJobsNow); a job tied to a
 *     process lives as long as that process, whatever the roster says;
 *   - it was last announced more than MAX_AGE_MS ago and nothing can judge it (a ceiling, so it cannot stay for ever;
 *     a process confirmed by its start time is judged, and stays while it runs, kosmos#9222).
 * Without --pid a record is tied to its agent only: it ends with `kosmos heavy end`, with the agent, or at the ceiling.
 * Where a start time cannot be read (Windows has no ps), a --pid record still clears when its process is gone (signal 0),
 * but a reused number is not told apart from the job.
 *
 * Weakest premise (Splinter's review): that agents call start and end. A missing end is bounded by the clearing above; a
 * missing start is simply not shown. Slice 2 (a takeable turn) builds on these records.
 */

const fs = require('fs');
const path = require('path');

const FILE = 'heavy-jobs.json';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_LABEL = 80;
const MAX_JOBS = 50;   // a bound on the file (the oldest go past it), not a policy: no computer runs fifty heavy jobs
const MAX_PER_AGENT = 4;   // and on what one agent's records can cost every status poll (one start-time read each)
const START_CACHE_MS = 10 * 1000;
const PS_PER_READ = 8;   // at most this many ps runs in one live(), and none STARTED once PS_MS_PER_READ is spent
const PS_MS_PER_READ = 500;   // (so one read is bounded by about PS_MS_PER_READ + PS_TIMEOUT_MS); the rest are judged by signal 0 and the cache
const PS_TIMEOUT_MS = 750;   // one ps, on the status route's event loop, never waits longer than this

function fileOf(root) { return path.join(root, FILE); }

/* The label to store, or throws an Error with a sentence for the agent. Another agent reads it in `kosmos heavy`, so it
   is stored as server.js othersWordsOneLine shapes someone else's words (#3311): no bracket to spell a marker with
   (every marker starts with `[`), and no direction mark or invisible space (the joiners some scripts need stay). */
function normalizeLabel(value) {
  if (typeof value !== 'string') throw new Error('say what the job is, in words');
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)) throw new Error('say what the job is on one line');
  if (/[\u061c\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(value)) throw new Error('say what the job is in plain text, without direction marks');
  const v = value.replace(/\[/g, '(').replace(/\]/g, ')').replace(/\s+/g, ' ').trim();
  if (!v) throw new Error('say what the job is, in words');
  if (v.length > MAX_LABEL) throw new Error('keep the job to ' + MAX_LABEL + ' characters');
  if (v.startsWith('-')) throw new Error('a job cannot start with -');
  return v;
}

/* A process id (2 to 2^31-1, what signal 0 accepts everywhere), or null for none; throws on anything else. */
function normalizePid(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : (/^[0-9]+$/.test(String(value)) ? Number(value) : NaN);
  if (!Number.isSafeInteger(n) || n <= 1 || n > 2147483647) throw new Error('a process id is a whole number above 1');
  return n;
}

/* Every record that is well formed, oldest first. A file that cannot be read or parsed is no records: the board shows
   nothing rather than something wrong. */
function readAll(root) {
  let raw;
  try { raw = fs.readFileSync(fileOf(root), 'utf8'); } catch { return []; }
  let list;
  try { list = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list.filter((j) => j && typeof j === 'object'
    && typeof j.agent === 'string' && j.agent
    && typeof j.label === 'string' && j.label
    && Number.isFinite(j.since)
    && (j.at === undefined || Number.isFinite(j.at))
    && (j.pid === null || Number.isSafeInteger(j.pid))
    && (j.pidStart === null || typeof j.pidStart === 'string'));
}

/* Writes the list; false (never a throw) when it could not be saved, so no caller passes an fs message, with its path,
   to an agent or a page. */
function writeAll(root, list) {
  try {
    require('./store').saveFlushed(fileOf(root), JSON.stringify(list.slice(-MAX_JOBS)) + '\n');   // flushed, then renamed
    return true;
  } catch {
    return false;
  }
}
const NOT_SAVED = 'Kosmos could not save its heavy-job record just now';

function locked(root, fn) {
  try { fs.mkdirSync(root, { recursive: true }); } catch { /* the lock below says so */ }
  return require('./filelock').withFileLock(fileOf(root), fn, {
    busy: 'another agent is recording a heavy job right now; try again',
    cannotAccess: 'Kosmos could not write its heavy-job record',
  });
}

/* Whether record j is still live. startOf(pid) gives the process's start identity (a string), null when there is no
   such process, or undefined when it cannot be asked; agentAlive(name) gives true, false, or null for "could not tell". */
function isLive(j, { now, startOf, agentAlive }) {
  const aged = now - (Number.isFinite(j.at) ? j.at : j.since) > MAX_AGE_MS;   // from the last announcement
  if (j.pid !== null) {
    // A job tied to a process lives as long as that process, whatever the roster says: --pid is for a wrapper that
    // outlives its agent's call, and an agent restarting while its suite runs is when the line matters most.
    const s = startOf(j.pid);
    if (s === null) return false;                                  // no such process
    if (typeof s === 'string' && j.pidStart && s !== j.pidStart) return false;   // the number was reused
    // kosmos#9222: the same process, confirmed by its start time, is judged, so the ceiling (for what nothing can
    // judge) does not apply: an overnight run stays on the board. Could not ask (undefined, or no recorded start):
    // kept until the ceiling, the safe side for a passive notice.
    if (typeof s === 'string' && j.pidStart && s === j.pidStart) return true;
    return !aged;
  }
  if (aged) return false;
  return !(agentAlive && agentAlive(j.agent) === false);
}

/* Signal 0 first: a gone process costs nothing to recognise (another user's process answers EPERM, and is kept as
   alive). A live one's start time is read with ps, and kept for
   START_CACHE_MS so a board polled by several pages does not run ps for every record on every poll; a number reused
   inside that window is judged by the old start until it runs out. */
const startCache = new Map();
/* how: 'cached' (a read, from the cache when it is fresh), 'fresh' (always ps: what a new record stores, so a number
   cached for an earlier process is never stored as this one's start), or 'alive' (signal 0 and the cache only: no ps;
   a live process with no fresh cached start is undefined, kept). */
function defaultStartOf(pid, now = Date.now(), how = 'cached') {
  const rs = require('./restoresink');
  if (!rs.pidAlive(pid)) { startCache.delete(pid); return null; }
  const hit = startCache.get(pid);
  if (how !== 'fresh' && hit && now - hit.at < START_CACHE_MS) return hit.v;
  if (how === 'alive') return undefined;
  const v = rs.processStart(pid, { timeoutMs: PS_TIMEOUT_MS });   // a slow ps is "could not ask": kept
  if (v === null) { startCache.delete(pid); return null; }
  if (startCache.size > MAX_JOBS * 2) startCache.clear();
  startCache.set(pid, { v, at: now });
  return v;
}

/* Record that agent's job is running. Replaces the agent's own record for the same process (or its process-less one),
   so a repeated start updates the label rather than doubling the line. Returns { ok, job } or { ok:false, because }. */
function start({ root, agent, label, pid, now = Date.now(), startOf = defaultStartOf }) {
  if (!agent) return { ok: false, because: 'Kosmos could not tell which agent you are' };
  let lab, p;
  try { lab = normalizeLabel(label); p = normalizePid(pid); }
  catch (err) { return { ok: false, because: err.message, refused: true }; }
  let pidStart = null;
  if (p !== null) {
    const s = startOf === defaultStartOf ? defaultStartOf(p, now, 'fresh') : startOf(p);
    if (s === null) return { ok: false, because: 'there is no process ' + p + ' on this computer', refused: true };
    pidStart = typeof s === 'string' ? s : null;
  }
  const job = { agent, label: lab, pid: p, pidStart, since: now, at: now };
  // The agent's other records are judged without ps (signal 0 and the cache): this runs under the lock, on the route.
  const othersOf = startOf === defaultStartOf ? (q) => defaultStartOf(q, now, 'alive') : startOf;   // since: shown; at: the ceiling counts from it
  let out = { ok: true, job };
  const r = locked(root, () => {
    const list = readAll(root).filter((j) => !(j.agent === agent && j.pid === p));
    if (list.filter((j) => j.agent === agent && isLive(j, { now, startOf: othersOf, agentAlive: null })).length >= MAX_PER_AGENT) {
      out = { ok: false, because: 'you already have ' + MAX_PER_AGENT + ' heavy jobs recorded; end one with kosmos heavy end first', refused: true };
      return;
    }
    const was = readAll(root).find((j) => j.agent === agent && j.pid === p && j.pidStart === job.pidStart);
    if (was && isLive(was, { now, startOf: othersOf, agentAlive: null })) job.since = was.since;   // announced again: since stays
    list.push(job);
    if (!writeAll(root, list.filter((j) => j.agent !== agent || isLive(j, { now, startOf: othersOf, agentAlive: null })))) out = { ok: false, because: NOT_SAVED };
  });
  return r.ok ? out : { ok: false, because: r.because };
}

/* Record that agent's job has ended: the record for that process, or with no pid the agent's process-less record.
   Returns { ok, ended: <count>, others: <the agent's records left> }. Ending what is not there is not an error. */
function end({ root, agent, pid }) {
  if (!agent) return { ok: false, because: 'Kosmos could not tell which agent you are' };
  let p;
  try { p = normalizePid(pid); } catch (err) { return { ok: false, because: err.message, refused: true }; }
  let ended = 0, others = 0, saved = true;
  const r = locked(root, () => {
    const all = readAll(root);
    const keep = all.filter((j) => !(j.agent === agent && j.pid === p));
    ended = all.length - keep.length;
    others = keep.filter((j) => j.agent === agent).length;
    if (ended) saved = writeAll(root, keep);
  });
  if (!r.ok) return { ok: false, because: r.because };
  return saved ? { ok: true, ended, others } : { ok: false, because: NOT_SAVED };
}

/* The live records, oldest first, each as { agent, label, pid, since }. Stale ones are removed from the file when its
   lock can be had at once; a reader never waits for it, so the board's status poll is never held up, and a removal that
   could not be saved changes nothing the reader is told. */
function live({ root, now = Date.now(), startOf = defaultStartOf, agentAlive = null }) {
  if (startOf === defaultStartOf) {
    let budget = PS_PER_READ;
    const until = Date.now() + PS_MS_PER_READ;
    startOf = (pid) => defaultStartOf(pid, now, budget-- > 0 && Date.now() < until ? 'cached' : 'alive');
  }
  const all = readAll(root);
  const keep = all.filter((j) => isLive(j, { now, startOf, agentAlive }));
  if (keep.length !== all.length) {
    require('./filelock').withFileLock(fileOf(root), () => {
      const fresh = readAll(root).filter((j) => isLive(j, { now, startOf, agentAlive }));
      writeAll(root, fresh);
    }, { waitMs: 0 });   // its { ok:false } (busy) and writeAll's false both leave the file for the next read
  }
  return keep.map((j) => ({ agent: j.agent, label: j.label, pid: j.pid, since: j.since }));
}

module.exports = { FILE, MAX_AGE_MS, MAX_LABEL, MAX_PER_AGENT, defaultStartOf, normalizeLabel, normalizePid, readAll, isLive, start, end, live };
