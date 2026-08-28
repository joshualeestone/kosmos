# roomseed-1150: the room-history guard covered one room per page, not every room

## The defect

`paintRoom` must not stamp a room's existing history as "everybody just spoke". Painting a
room for the first time hands the page the whole backlog at once, and stamping it would
blank the working line for a poll. So the guard exists, and it was right.

It was a single boolean:

```js
let ROOM_SPOKE_SEEDED = false;
...
ROOM_SPOKE_AT.set(who, { at, learnedAt: ROOM_SPOKE_SEEDED ? Date.now() : 0 });
ROOM_SPOKE_SEEDED = true;
```

Set true after the first room painted and never reset. **So the guard covered exactly one
room per page load: the room you happen to open first.** Open a second room and its entire
history is stamped `learnedAt = Date.now()`, the working line reads everybody as having
just spoken, and it blanks.

## The fix

A `Set` keyed on `PJ_CURRENT`, so seeding is asked and answered per room:

```js
const ROOM_SPOKE_SEEDED = new Set();
...
const seededRoom = ROOM_SPOKE_SEEDED.has(PJ_CURRENT);
```

`seededRoom` is read ONCE before the loop, not per row. Reading it inside would let the
first row of a fresh room seed the map and the second row of the same paint see a seeded
room, which is the same bug one level down.

## Decided: `ROOM_SPOKE_AT` stays keyed on the speaker, globally

The seeding is now per room while `ROOM_SPOKE_AT` is keyed on `who` alone. That is a mixed
keying and it deserves a reason rather than an accident.

Its only consumer (index.html:14384) reads `spoke.learnedAt > LAST_AT` - "did this agent's
message reach the page after the snapshot we are painting from". That is a question about
the AGENT, not about a room: an agent that just replied anywhere is an agent whose board
state is older than what is on screen. So the global key is the right one for the consumer.

**The one case where the two keyings interact**, stated so the next reader does not have to
find it: open room A, agent X speaks there (`learnedAt = now`), then open room B unseeded
where X has a NEWER message. The dedup `at <= seen.at` no longer holds, so X is re-stamped
with `learnedAt = 0` and the working line stops suppressing X even though it genuinely just
spoke in A. **That is an under-claim - X shows as working for at most one poll** - and it is
the direction the existing comment at :14375 says this line is built to fail in. Left as is.

## Deliberately not done

- **Keying `ROOM_SPOKE_AT` by room.** It would fix the interaction above, and it would break
  the consumer, which asks a per-agent question. Two derivations of "did this agent just
  speak" is the defect this codebase pays for most often.
- **Clearing the Set on room close.** It grows by one short string per room opened per page
  load. A page open long enough for that to matter has other problems.

## Test

`web.typing-order-1150.test.js`. The pre-existing test asserted the guard's SHAPE and passed
against the bug, which is why the bug shipped. The new one paints TWO rooms and asserts the
second room's history is not stamped.

**Measured, not asserted.** I reverted the fix to the original single boolean, in both halves
(`const ROOM_SPOKE_SEEDED = new Set()` back to `let ... = false`, the `.has(PJ_CURRENT)` read back
to the bare boolean, the `.add(PJ_CURRENT)` back to `= true`), and ran the file:

```
fixed      3 pass  0 fail
pre-fix    2 pass  1 fail     <- the test genuinely catches the bug it was written for
restored   3 pass  0 fail
```

⭐ Worth doing because the defect this branch fixes is *precisely* a test that passed against the
bug. A replacement test that had the same weakness would be invisible, and the only way to tell the
two apart is to watch the new one go red.
