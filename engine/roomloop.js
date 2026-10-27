'use strict';

/**
 * kosmos#7246 slice 2 (C): a backstop for agents waking each other in a room. Per project, at most LOOP_CAP agent posts
 * that woke anyone in any rolling LOOP_WINDOW_MS (counted per post, so an @all is one). Past it, agent-to-agent delivery in that project is
 * quiet until the window has room; the caller says so once per pause. A person's posts never come here.
 *
 * In memory, on the board: a restart starts every window over. Never throws.
 */

/* 40: about three times the busiest agent hour measured in this fleet's own room (13 posts, 2026-10-27, from the 40
   posts the room view showed). A guess with that basis; a loop that wakes members runs far past it. */
const LOOP_CAP = 40;
const LOOP_WINDOW_MS = 60 * 60 * 1000;
let cap = LOOP_CAP;   // setCapForTests only; resetForTests puts it back

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
  try { return recent(String(projectId), now).length >= cap; } catch { return false; }
}

/* Count one agent post that woke at least one member in `projectId` (once per post, so an @all is one). */
function noteWake(projectId, now = Date.now()) {
  try { const p = String(projectId); const list = recent(p, now); list.push(now); wakes.set(p, list); } catch { /* next one */ }
}

/* When the window next has room (ms), for the note. */
function freesAt(projectId, now = Date.now()) {
  const list = recent(String(projectId), now);
  return list.length ? list[Math.max(0, list.length - cap)] + LOOP_WINDOW_MS : now;
}

/* The note for a pause, or '' when this pause was already said. */
function pauseNote(projectId, now = Date.now()) {
  try {
    const p = String(projectId);
    const until = freesAt(p, now);
    if (said.get(p) === until) return '';
    said.set(p, until);
    const hhmm = new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    return 'Kosmos paused agents waking each other in this project until about ' + hhmm + ': they woke each other '
      + LOOP_CAP + ' times in the last hour without you. Your own messages still reach them.';
  } catch { return ''; }
}

/* What the sending agent is told when its post woke no one because of the pause (round 1). */
function senderNote(projectId, now = Date.now()) {
  try {
    const hhmm = new Date(freesAt(String(projectId), now)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    return 'your post is in the room, but it woke no one: Kosmos has paused agents waking each other in this project until about ' + hhmm;
  } catch { return 'your post is in the room, but it woke no one: agents waking each other is paused in this project'; }
}

/* A test that is about something else (the room valve) and sends many posts sets this high. */
function setCapForTests(n) { cap = n; }
function resetForTests() { wakes.clear(); said.clear(); cap = LOOP_CAP; }

module.exports = { LOOP_CAP, LOOP_WINDOW_MS, paused, noteWake, freesAt, pauseNote, senderNote, setCapForTests, resetForTests };
