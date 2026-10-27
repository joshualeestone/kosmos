'use strict';

/**
 * kosmos#7246 slice 2 (C): a backstop for agents waking each other in a room. Per project, at most LOOP_CAP agent posts
 * that woke anyone in any rolling LOOP_WINDOW_MS (counted per post, so an @all is one). Past it, agent-to-agent delivery in that project is
 * quiet for a whole LOOP_WINDOW_MS from the moment the pause began (round 8: latched, then counted from zero, never a slide
 * that lets one post through each time a wake ages out, which held a real loop at 40 wakes an hour forever); the caller
 * says so once per pause. A person's posts are never counted, and one
 * clears its project's count (clear): the person is there, so what the agents do next is theirs to see.
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
/* projectId -> when its current pause began (ms): quiet until a whole window has passed from it, or a person acts. */
const pausedAt = new Map();
/* projectId -> the pause (its pausedAt) last said, so each pause is said once; a pause lasts at least an hour. */
const said = new Map();

function recent(projectId, now) {
  const list = (wakes.get(projectId) || []).filter((t) => now - t < LOOP_WINDOW_MS);
  if (list.length) wakes.set(projectId, list); else wakes.delete(projectId);
  return list;
}

/* True while `projectId`'s pause lasts: from the post that found its cap used, for a whole window. When it ends, the count
   starts again from zero. */
function paused(projectId, now = Date.now()) {
  try {
    const p = String(projectId);
    if (pausedAt.has(p)) {
      if (now - pausedAt.get(p) < LOOP_WINDOW_MS) return true;
      pausedAt.delete(p); wakes.delete(p);
      return false;
    }
    if (recent(p, now).length >= cap) { pausedAt.set(p, now); return true; }
    return false;
  } catch { return false; }
}

/* Count one agent post that woke at least one member in `projectId` (once per post, so an @all is one). */
function noteWake(projectId, now = Date.now()) {
  try { const p = String(projectId); const list = recent(p, now); list.push(now); wakes.set(p, list); } catch { /* next one */ }
}

/* When the pause ends (ms), for the note; `now` when there is none. */
function freesAt(projectId, now = Date.now()) {
  const p = String(projectId);
  return pausedAt.has(p) ? pausedAt.get(p) + LOOP_WINDOW_MS : now;
}

/* The note for a pause, or '' when this pause was already said. */
function pauseNote(projectId, now = Date.now()) {
  try {
    const p = String(projectId);
    if (!pausedAt.has(p) || said.get(p) === pausedAt.get(p)) return '';
    said.set(p, pausedAt.get(p));
    const until = freesAt(p, now);
    const hhmm = new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    return 'Kosmos paused agents waking each other in this project until about ' + hhmm + ': their posts woke one another '
      + cap + ' times in the last hour without you. Your own messages still reach them.';
  } catch { return ''; }
}

/* What the sending agent is told when its post woke no one because of the pause (round 1). */
function senderNote(projectId, now = Date.now()) {
  try {
    const hhmm = new Date(freesAt(String(projectId), now)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    return 'your post is in the room, but it woke no one: Kosmos has paused agents waking each other in this project until about ' + hhmm;
  } catch { return 'your post is in the room, but it woke no one: agents waking each other is paused in this project'; }
}

/* Round 3: a person posted in `projectId`, so its count starts over and the next pause is said at once. */
function clear(projectId) {
  try { const p = String(projectId); wakes.delete(p); said.delete(p); pausedAt.delete(p); } catch { /* the pause runs out instead */ }
}

/* The cap in force (LOOP_CAP unless a test set it), for the board's log line. */
function liveCap() { return cap; }

/* A test that is about something else (the room valve) and sends many posts sets this high. */
function setCapForTests(n) { cap = n; }
function resetForTests() { wakes.clear(); said.clear(); pausedAt.clear(); cap = LOOP_CAP; }

module.exports = { LOOP_CAP, LOOP_WINDOW_MS, paused, noteWake, clear, liveCap, freesAt, pauseNote, senderNote, setCapForTests, resetForTests };
