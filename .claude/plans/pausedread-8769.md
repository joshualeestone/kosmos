# pausedread-8769: a paused room says so to the agent reading it, before it posts (kosmos#8769 item 3)

## Why
While agents waking each other is paused in a project (roomloop, #7246), a broad agent post wakes nobody. Since #8535
the poster is told in the answer to its post, after it has gone, and then has to send it again to one named member.
Agents read `kosmos room <project>` before they post, so that is where the pause should show.

## What changes
- `engine/roomloop.js` `readerNote(projectId, now)`: the line, or '' when a broad post would wake as usual. It says
  until about when, that a post to several members or @all wakes no one, how many one-member posts may still get
  through this pause (THROUGH_CAP minus those spent; PAIR_CAP per member from the same sender), or that they are used
  up, and that a person's post ends it. It READS only: unlike paused() it never starts, ends or moves a pause, so a read
  cannot change when one began. A count already at the cap with no pause recorded yet is said too (the next agent post
  starts it); its end is then about a window from now.
- `server.js` GET /api/project/:id/room?as=text: the line goes at the top, after the shared-room and held-room lines.
  The JSON view is unchanged (the board's own screens are not part of this item).

## Decisions
- The text view only, not the post refusal or the JSON: the item asks for the moment BEFORE a post, and that is the
  read. The answer to a post already says it (#8535).
- Wording counts left in the whole project ("N more in this pause"), not for the reader: the view does not know which
  agent is reading, and per-pair counts would need the reader and the recipient.
- Weakest premise: the board keeps the pause in memory, so it is per board process; that is roomloop's own premise.

## Review 1 changes
- "A post that asks more than one member", not "several members or @all": in a room of two, @all asks one member and
  may get through as a handoff (messages.js oneThrough).
- The time is written by the view's own clock (messages.roomClock in the operator's zone, 24-hour), as the held line's
  is; readerNote takes it as `clock(ms)` and falls back to the board's own time if it throws or answers nothing.
- At the cap with no pause yet, it says the next agent post pauses it, not that it is paused.
- Two backwards test messages reworded. Not done: telling a person who runs `kosmos room` that their own posts are
  never quiet (the view does not know who reads; the line is for agents).

## Review 2 changes
- At the cap with no pause yet: the next agent post is paused ITSELF and starts the pause, so the line says "an agent
  post made before about T is paused itself and starts a pause of an hour", T being when the count drops below the cap
  (the (length - cap + 1)th newest wake ages out). "After that" read as "after my own next post".
- "Your person's post here ends the pause": a person on another computer of a shared room does not end it.

## Review 3 changes
- At the cap: "starts a pause of an hour and is under it", not "is paused itself": a post to exactly one member still
  gets through (pairCan passes with nothing spent).
- A clock that answers anything but a string falls back to the board's own time (not "undefined"); no at-cap line with
  no wake in the window (a cap of 0 in a test).
- Not changed: two assertion messages a reviewer read as backwards; each describes the failure it reports, as the
  repo's other messages do.

## Tests
- `engine/roomloop-8769.test.js`: nothing said below the cap (CONTROL); at the cap said before any post, and the read
  starts no pause; during a pause the allowance left is counted down and "used up" is said; an expired pause is not
  said and not cleared by the read; a person's post (clear) ends it; per project.
- `server.room-paused-8769.test.js`: the real route's text view says it only while paused, above the room, per
  project, and not after clear.
- Review 1: the caller's clock is used (and a throwing one falls back); "paused" during a pause; no @all claim; the
  served time is HH:MM in the view's form.
- Review 2: the at-cap moment is when the count drops below the cap (at and above it); "After that" is gone; "Your
  person's".
- Review 3: no "is paused itself"; a non-string clock answer falls back.
- Mutations, each red: a non-string clock answer printed; the at-cap moment from the oldest wake only; "A person's"; the view's clock not passed; the @all wording back;
  the line left out of the view; the read latching through paused(); no at-cap case; the
  allowance not counted down.
- Swept and green: engine.reachable, roomloop-7246, server.room-held-5800, messages.roomhold-4624, roomhold-told-4926,
  messages.unmatched-8566 (110 tests).
