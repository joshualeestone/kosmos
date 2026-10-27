'use strict';

/**
 * kosmos#7246 slice 2 (C): a backstop for agents waking each other in a room. Per project, at most LOOP_CAP deliveries
 * of an agent's post to a member in any rolling LOOP_WINDOW_MS. Past it, agent-to-agent delivery in that project is
 * quiet until the window has room; the caller says so once per pause. A person's posts never come here.
 *
 * In memory, on the board: a restart starts every window over. Never throws.
 */

const LOOP_CAP = 20;
const LOOP_WINDOW_MS = 60 * 60 * 1000;

/* projectId -> ms timestamps of agent-woken deliveries, oldest first */
const wakes = new Map();
/* projectId -> the pause it was last said for (ms the window frees), so each pause is said once */
const said = new Map();

function recent(projectId, now) {
  const list = (wakes.get(projectId) || []).filter((t) => now - t < LOOP_WINDOW_MS);
  if (list.length) wakes.set(projectId, list); else wakes.delete(projectId);
  return list;
}

/* True while `projectId` has used its cap in the window ending `now`. */
function paused(projectId, now = Date.now()) {
  try { return recent(String(projectId), now).length >= LOOP_CAP; } catch { return false; }
}

/* Count one delivery of an agent's post to a member in `projectId`. */
function noteWake(projectId, now = Date.now()) {
  try { const p = String(projectId); const list = recent(p, now); list.push(now); wakes.set(p, list); } catch { /* next one */ }
}

/* When the window next has room (ms), for the note. */
function freesAt(projectId, now = Date.now()) {
  const list = recent(String(projectId), now);
  return list.length ? list[Math.max(0, list.length - LOOP_CAP)] + LOOP_WINDOW_MS : now;
}

/* The note for a pause, or '' when this pause was already said. */
function pauseNote(projectId, now = Date.now()) {
  try {
    const p = String(projectId);
    const until = freesAt(p, now);
    if (said.get(p) === until) return '';
    said.set(p, until);
    const hhmm = new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return 'Kosmos paused agents waking each other in this project until about ' + hhmm + ': they woke each other '
      + LOOP_CAP + ' times in the last hour without you. Your own messages still reach them.';
  } catch { return ''; }
}

function resetForTests() { wakes.clear(); said.clear(); }

module.exports = { LOOP_CAP, LOOP_WINDOW_MS, paused, noteWake, freesAt, pauseNote, resetForTests };
