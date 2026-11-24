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
const path = require('path');
const store = require('./store');
const crashloop = require('./crashloop');

/* launchd's ThrottleInterval (30 s) plus the supervisor's 10 s wait poll and its start-up, with room to spare. */
const RESTART_WINDOW_MS = 5 * 60 * 1000;

function diedFileFor(sessionName) { return path.join(crashloop.dir(), store.safeKey(sessionName) + '.died'); }

/** { atMs, code, signal } from a died file's text, or null. A signal name is given as tmux prints it ("term"). */
function parseDied(text) {
  const m = /^(\d{9,11}) (status|signal) ([0-9]{1,10}|[A-Za-z]{1,16})$/.exec(String(text || '').split('\n')[0].trim());
  if (!m) return null;
  const atMs = Number(m[1]) * 1000;
  if (m[2] === 'status') {
    if (!/^[0-9]+$/.test(m[3])) return null;
    return { atMs, code: Number(m[3]), signal: null };
  }
  if (!/^[A-Za-z]+$/.test(m[3])) return null;
  const name = m[3].toUpperCase();
  return { atMs, code: null, signal: name.startsWith('SIG') ? name : 'SIG' + name };
}

/** The ms of the last "start" line, or null. */
function lastStartMs(runText) {
  const runs = crashloop.parse(runText);
  return runs.length ? runs[runs.length - 1].start : null;
}

/** Did a turn finish (the report hook's Stop row) at or after `sinceMs`? null when the record cannot say. */
function finishedSince(sessionName, sinceMs, history) {
  let rows;
  try { rows = history(sessionName); } catch { return null; }
  if (!rows) return false;
  for (const row of rows) {
    if (!row || row.by === 'operator' || row.state !== 'idle') continue;
    if (!/finished responding/.test(String(row.because || ''))) continue;
    const at = Date.parse(row.at || '');
    if (Number.isFinite(at) && at >= sinceMs) return true;
  }
  return false;
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
    try { died = parseDied(read(diedFileFor(sessionName))); } catch { return null; }
    if (!died) return null;
    let start;
    try { start = lastStartMs(read(crashloop.fileFor(sessionName))); } catch { return null; }
    if (start === null || start < died.atMs || start - died.atMs > RESTART_WINDOW_MS) return null;
    if (finishedSince(sessionName, start, history) !== false) return null;
    const why = require('./win32streamstate').restartWhy({ code: died.code, signal: died.signal });
    return { at: new Date(start).toISOString(), why };
  } catch { return null; }
}

module.exports = { RESTART_WINDOW_MS, diedFileFor, parseDied, lastStartMs, finishedSince, restartedFor };
