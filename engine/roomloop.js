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
/* kosmos#7461: while a project is paused, a post asking exactly ONE member still wakes it, so a handoff gets through (a
   gate queue's "my run ended" to the next in line; a summary addressed to one member). Bounded twice, so a loop cannot
   use it: PAIR_CAP wakes per ordered pair (sender to recipient) per pause, and THROUGH_CAP for the whole project per
   pause (a ring of agents uses fresh pairs, so the pair bound alone would grow with the room's size). The pair counts
   and the project's total are forgotten whenever the pause ends (it runs out, or a person clears it). */
const PAIR_CAP = 3;
const THROUGH_CAP = 10;
const pairWakes = new Map();   // project\u0000from\u0000to -> wakes this pause
const throughWakes = new Map();   // project -> wakes this pause

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
      pausedAt.delete(p); wakes.delete(p); forgetPairs(p);
      return false;
    }
    if (recent(p, now).length >= cap) { pausedAt.set(p, now); return true; }
    return false;
  } catch { return false; }
}

function forgetPairs(p) {
  for (const k of [...pairWakes.keys()]) if (k.startsWith(p + '\u0000')) pairWakes.delete(k);
  throughWakes.delete(p);
}
/* kosmos#7461: may this paused project's one-member post from `from` wake `to`? Asks only; pairTake spends it, once the
   post is counted (review 1: a post refused after this check must not spend a slot). False when no pause is recorded
   (the caller asks only after paused(), which clears an expired one), or either name is missing. */
function pairCan(projectId, from, to) {
  try {
    const p = String(projectId);
    if (!pausedAt.has(p) || typeof from !== 'string' || !from || typeof to !== 'string' || !to) return false;
    return (pairWakes.get(p + '\u0000' + from + '\u0000' + to) || 0) < PAIR_CAP && (throughWakes.get(p) || 0) < THROUGH_CAP;
  } catch { return false; }
}
/* Give one back: the post that spent it reached nobody (review 2), so it was not a wake, and its retry must not find the
   pair spent. */
function pairRefund(projectId, from, to) {
  try {
    const p = String(projectId);
    const key = p + '\u0000' + from + '\u0000' + to;
    const n = pairWakes.get(key) || 0;
    if (n > 0) pairWakes.set(key, n - 1);
    const t = throughWakes.get(p) || 0;
    if (t > 0) throughWakes.set(p, t - 1);
  } catch { /* the slot stays spent: one fewer handoff this pause */ }
}
/* Spend one: called synchronously after pairCan in the same post, before any typing, so two posts cannot both spend the
   last slot. */
function pairTake(projectId, from, to) {
  try {
    const p = String(projectId);
    const key = p + '\u0000' + from + '\u0000' + to;
    pairWakes.set(key, (pairWakes.get(key) || 0) + 1);
    throughWakes.set(p, (throughWakes.get(p) || 0) + 1);
  } catch { /* the bound errs toward one more wake */ }
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

/* What the sending agent is told when its post woke no one because of the pause (round 1). kosmos#8535: and why, who set
   it, and what still gets through, in one line. `ctx` is what `quietWhy` returned for this post. */
function senderNote(projectId, now = Date.now(), ctx = {}) {
  try {
    const p = String(projectId);
    const hhmm = new Date(freesAt(p, now)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    const head = 'your post is in the room, but it woke no one: Kosmos has paused agents waking each other in this project until about ' + hhmm
      + ', because agents\' posts here woke one another ' + cap + ' times within an hour (an automatic limit, not a person; a person\'s post in the room ends it)';
    const c = ctx && typeof ctx === 'object' ? ctx : {};
    // Review 1: the project's one-member allowance is said for EVERY post, so no post is told to address one member when
    // that would be refused too. Review 2: from `quietWhy`, taken when the post was ruled quiet, not read again now. No
    // final full stop: the CLIs add their own after the note.
    if (c.throughSpent === true) {
      return head + '. A post to exactly one member gets through ' + THROUGH_CAP + ' times per pause in this project, and those are used up';
    }
    if (c.pairSpent === true && typeof c.to === 'string' && c.to) {
      return head + '. You have woken ' + c.to + ' ' + PAIR_CAP + ' times during this pause, the most it allows; a post to a different single member may still get through';
    }
    return head + '. To wake someone now, address exactly one member: that may still get through, up to ' + PAIR_CAP + ' times per member and ' + THROUGH_CAP + ' in all during this pause';
  } catch { return 'your post is in the room, but it woke no one: agents waking each other is paused in this project'; }
}

/* kosmos#8535 review 2: why a paused post was quiet, read when it is ruled quiet (beside pairCan), so the note given back
   describes that moment, not the counters after its delivery. `to` is the one member the post asked, when it asked one. */
function quietWhy(projectId, from, asked, to) {
  try {
    const p = String(projectId);
    const one = asked === 1 && typeof to === 'string' && to && typeof from === 'string' && from;
    return {
      throughSpent: (throughWakes.get(p) || 0) >= THROUGH_CAP,
      pairSpent: Boolean(one) && (pairWakes.get(p + '\u0000' + from + '\u0000' + to) || 0) >= PAIR_CAP,
      to: one ? to : null,
    };
  } catch { return {}; }
}

/* kosmos#8769 item 3: the line an agent reads in `kosmos room` BEFORE it posts, while a post asking more than one member
   here would wake no one, so it need not learn it only from the answer to a post already sent. '' when a post would wake
   as usual. Reads only: unlike paused() it never starts, ends or moves a pause, so a read cannot change when one began.
   At the cap with no pause recorded yet (review 2): the next agent post starts the pause and is under it, but only
   while the count stays at the cap, so the line names when it drops below (the wake that must age out, in the window).
   `clock(ms)` writes times the way the view writes its others (review 1); without one, the board's own. Review 2: "your
   person", since a person's post on another computer of a shared room does not end it (messages.js clears it for this
   computer's person, a Reopen, and their own other computer). No final newline. */
function readerNote(projectId, now = Date.now(), clock = null) {
  try {
    const p = String(projectId);
    const live = pausedAt.has(p) && now - pausedAt.get(p) < LOOP_WINDOW_MS;
    // Review 4: a sorted copy, so a wall clock stepped back between two wakes cannot pick the wrong one below.
    const inWindow = pausedAt.has(p) ? [] : (wakes.get(p) || []).filter((t) => now - t < LOOP_WINDOW_MS).sort((x, y) => x - y);
    const atCap = !pausedAt.has(p) && inWindow.length > 0 && inWindow.length >= cap;   // review 3: never with no wake
    if (!live && !atCap) return '';
    const at = (ms) => {
      let w = '';
      // Review 3: only a string counts; null or undefined would otherwise print as a word.
      try { const v = typeof clock === 'function' ? clock(ms) : ''; w = typeof v === 'string' ? v : ''; } catch { w = ''; }
      return w || new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    };
    const why = ' (an automatic limit: agents\' posts here woke one another ' + cap + ' times within an hour). ';
    const ends = ' Your person\'s post here ends the pause.';
    const startsOver = ' Your person\'s post here starts the count over.';   // review 4: at the cap there is no pause yet
    if (live) {
      const left = Math.max(0, THROUGH_CAP - (throughWakes.get(p) || 0));
      return '[kosmos] Agents waking each other is paused in this room until about ' + at(pausedAt.get(p) + LOOP_WINDOW_MS) + why
        + 'A post that asks more than one member will wake no one. '
        + (left > 0
          ? 'A post to exactly one member may still get through: ' + left + ' more in this pause, at most ' + PAIR_CAP + ' to the same member from you.'
          : 'The posts to exactly one member that may get through during this pause are used up.')
        + ends;
    }
    // wakes are kept oldest first: the count drops below the cap when the (length - cap + 1)th newest ages out.
    const below = inWindow[inWindow.length - cap] + LOOP_WINDOW_MS;
    return '[kosmos] Agents waking each other is at its limit in this room' + why
      // Review 3: "starts a pause and is under it", not "is paused itself": a post to exactly one member still gets through.
      + 'An agent post made before about ' + at(below) + ' starts a pause of an hour and is under it: during it, a post '
      + 'that asks more than one member wakes no one, and a post to exactly one member may still get through (' + THROUGH_CAP
      + ' in the pause, at most ' + PAIR_CAP + ' to the same member from you).' + startsOver;
  } catch { return ''; }
}

/* Round 3: a person posted in `projectId`, so its count starts over and the next pause is said at once. */
function clear(projectId) {
  try { const p = String(projectId); wakes.delete(p); said.delete(p); pausedAt.delete(p); forgetPairs(p); } catch { /* the pause runs out instead */ }
}

/* The cap in force (LOOP_CAP unless a test set it), for the board's log line. */
function liveCap() { return cap; }

/* A test that is about something else (the room valve) and sends many posts sets this high. */
function setCapForTests(n) { cap = n; }
function resetForTests() { wakes.clear(); said.clear(); pausedAt.clear(); pairWakes.clear(); throughWakes.clear(); cap = LOOP_CAP; }

module.exports = { LOOP_CAP, LOOP_WINDOW_MS, paused, noteWake, clear, liveCap, freesAt, pauseNote, senderNote, readerNote, quietWhy, setCapForTests, resetForTests, pairCan, pairTake, pairRefund, PAIR_CAP, THROUGH_CAP };
