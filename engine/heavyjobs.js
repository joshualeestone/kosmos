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
 *   - its agent is gone (not on the roster, when the roster could be read);
 *   - it is older than MAX_AGE_MS (a ceiling, so a record nothing can judge cannot stay for ever).
 * Without --pid a record is tied to its agent only: it ends with `kosmos heavy end`, with the agent, or at the ceiling.
 *
 * Weakest premise (Splinter's review): that agents call start and end. A missing end is bounded by the clearing above; a
 * missing start is simply not shown. Slice 2 (a takeable turn) builds on these records.
 */

const fs = require('fs');
const path = require('path');

const FILE = 'heavy-jobs.json';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_LABEL = 80;
const MAX_JOBS = 50;   // a bound on the file, not a policy: no computer runs fifty heavy jobs at once

function fileOf(root) { return path.join(root, FILE); }

/* The label to store, or throws an Error with a sentence for the agent. */
function normalizeLabel(value) {
  if (typeof value !== 'string') throw new Error('say what the job is, in words');
  if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(value)) throw new Error('say what the job is on one line');
  const v = value.replace(/\s+/g, ' ').trim();
  if (!v) throw new Error('say what the job is, in words');
  if (v.length > MAX_LABEL) throw new Error('keep the job to ' + MAX_LABEL + ' characters');
  if (v.startsWith('-')) throw new Error('a job cannot start with -');
  return v;
}

/* A positive process id, or null for none; throws on anything else. */
function normalizePid(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : (/^[0-9]+$/.test(String(value)) ? Number(value) : NaN);
  if (!Number.isSafeInteger(n) || n <= 1) throw new Error('a process id is a whole number above 1');
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
    && (j.pid === null || Number.isSafeInteger(j.pid))
    && (j.pidStart === null || typeof j.pidStart === 'string'));
}

function writeAll(root, list) {
  const file = fileOf(root);
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(list.slice(-MAX_JOBS)) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

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
  if (now - j.since > MAX_AGE_MS) return false;
  if (agentAlive && agentAlive(j.agent) === false) return false;
  if (j.pid !== null) {
    const s = startOf(j.pid);
    if (s === null) return false;                                  // no such process
    if (typeof s === 'string' && j.pidStart && s !== j.pidStart) return false;   // the number was reused
    // undefined (could not ask): kept, the safe side for a passive notice
  }
  return true;
}

function defaultStartOf(pid) {
  return require('./restoresink').processStart(pid);
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
    const s = startOf(p);
    if (s === null) return { ok: false, because: 'there is no process ' + p + ' on this computer', refused: true };
    pidStart = typeof s === 'string' ? s : null;
  }
  const job = { agent, label: lab, pid: p, pidStart, since: now };
  const r = locked(root, () => {
    const list = readAll(root).filter((j) => !(j.agent === agent && j.pid === p));
    list.push(job);
    writeAll(root, list);
  });
  return r.ok ? { ok: true, job } : { ok: false, because: r.because };
}

/* Record that agent's job has ended: the record for that process, or with no pid the agent's process-less record.
   Returns { ok, ended: <count> }. Ending what is not there is not an error (ended: 0). */
function end({ root, agent, pid }) {
  if (!agent) return { ok: false, because: 'Kosmos could not tell which agent you are' };
  let p;
  try { p = normalizePid(pid); } catch (err) { return { ok: false, because: err.message, refused: true }; }
  let ended = 0;
  const r = locked(root, () => {
    const all = readAll(root);
    const keep = all.filter((j) => !(j.agent === agent && j.pid === p));
    ended = all.length - keep.length;
    if (ended) writeAll(root, keep);
  });
  return r.ok ? { ok: true, ended } : { ok: false, because: r.because };
}

/* The live records, oldest first, each as { agent, label, pid, since }. Stale ones are removed from the file when its
   lock can be had at once; a reader never waits for it, so the board's status poll is never held up. */
function live({ root, now = Date.now(), startOf = defaultStartOf, agentAlive = null }) {
  const all = readAll(root);
  const keep = all.filter((j) => isLive(j, { now, startOf, agentAlive }));
  if (keep.length !== all.length) {
    require('./filelock').withFileLock(fileOf(root), () => {
      const fresh = readAll(root).filter((j) => isLive(j, { now, startOf, agentAlive }));
      writeAll(root, fresh);
    }, { waitMs: 0 });
  }
  return keep.map((j) => ({ agent: j.agent, label: j.label, pid: j.pid, since: j.since }));
}

module.exports = { FILE, MAX_AGE_MS, MAX_LABEL, normalizeLabel, normalizePid, readAll, isLive, start, end, live };
