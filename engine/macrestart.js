'use strict';
/**
 * kosmos#8988: the Mac half of #8979. When a Mac Claude agent's process ends and launchd starts it again, its card says
 * "Restarted at <time>: <why>" until a turn on the restarted agent finishes.
 *
 * Two records the supervisor (bin/agent-supervisor.sh) keeps under <store root>/runs, named by store.safeKey:
 *   <key>.died  one line, "<epoch> status <N>" or "<epoch> signal <name>": how its last process ended (pane-died hook,
 *               or the supervisor finding the pane dead).
 *   <key>.log   the run file engine/crashloop.js reads: "start <epoch>" for every launch.
 * The restart is the LAST start, when it came within RESTART_WINDOW_MS after the death: a later start is a launch of
 * its own (a person's restart, a login), which says nothing about that death. A finished answer (the report hook's
 * Stop row: idle, "finished responding") at or after that start clears it.
 */
const fs = require('fs');
const os = require('os');
const crashloop = require('./crashloop');

/* launchd's ThrottleInterval (30 s) plus the supervisor's 10 s wait poll and its start-up, with room to spare. */
const RESTART_WINDOW_MS = 5 * 60 * 1000;
/* A restart, switch or change Kosmos made itself stamps the run file ("kosmos <epoch>", crashloop.noteDeliberate) when
   it begins, just before it ends the process. A death this soon after such a stamp, with no start between the two, is
   Kosmos's own. One with a start between is the new process's (a switch whose new agent crashed), and a stamp after the
   death is a person's restart of an agent that had already stopped: both keep the line. */
const DELIBERATE_BEFORE_MS = 60 * 1000;

/** { atMs, code, signal } from a died file's text, or null. A signal name is given as tmux prints it ("term"). */
function parseDied(text) {
  const m = /^(\d{9,11}) (?:status ([0-9]{1,10})|signal ([A-Za-z]{1,16}))$/.exec(String(text || '').split('\n')[0].trim());
  if (!m) return null;
  const atMs = Number(m[1]) * 1000;
  if (m[2] !== undefined) return { atMs, code: Number(m[2]), signal: null };
  const name = m[3].toUpperCase();
  return { atMs, code: null, signal: name.startsWith('SIG') ? name : 'SIG' + name };
}

/** Did a turn finish at or after `sinceMs`? The report hook's Stop, as selfreport.history marks it (turn 'end', its
    `at` in ms). null when the record could not be read. */
function finishedSince(sessionName, sinceMs, history) {
  let rows;
  try { rows = history(sessionName); } catch { return null; }
  if (!rows) return false;
  return rows.some((row) => !!row && row.turn === 'end' && Number.isFinite(row.at) && row.at >= sinceMs);
}

/**
 * { at (ISO, when the restarted process started), why } for a Mac Claude agent whose last process ended and was
 * started again, while no turn on it has finished; else null. Never throws.
 */
function restartedFor(sessionName, opts) {
  try {
    const o = opts || {};
    const read = o.read || ((f) => fs.readFileSync(f, 'utf8'));
    const history = o.history || ((n) => require('./selfreport').history(n));
    let died;
    try { died = parseDied(read(crashloop.diedFileFor(sessionName))); } catch { return null; }
    /* An exit with code 0 is Claude closing on purpose (a person typing /exit): not a crash to explain. */
    if (!died || died.code === 0) return null;
    let runs;
    try { runs = crashloop.parse(read(crashloop.fileFor(sessionName))); } catch { return null; }
    const start = runs.length ? runs[runs.length - 1].start : null;
    if (start === null || start < died.atMs || start - died.atMs > RESTART_WINDOW_MS) return null;
    const ours = (runs.deliberate || []).some((d) => d <= died.atMs && d >= died.atMs - DELIBERATE_BEFORE_MS
      && !runs.some((r) => r.start > d && r.start <= died.atMs));
    if (ours) return null;
    /* A shutdown or logout ends every agent by signal, so a death before this boot is the machine's, not Claude's. */
    if (died.atMs < (Number.isFinite(o.bootMs) ? o.bootMs : Date.now() - os.uptime() * 1000)) return null;
    if (finishedSince(sessionName, start, history) !== false) return null;
    const why = require('./win32streamstate').restartWhy({ code: died.code, signal: died.signal });
    return { at: new Date(start).toISOString(), why };
  } catch { return null; }
}

module.exports = { RESTART_WINDOW_MS, DELIBERATE_BEFORE_MS, diedFileFor: crashloop.diedFileFor, parseDied, finishedSince, restartedFor };
