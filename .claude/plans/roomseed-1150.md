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

`seededRoom` is read ONCE before the loop, not per row.

⚠️ **An earlier version of this file credited the hoist with preventing the first row of a
fresh room from seeding the map and the second row of the same paint seeing it seeded. A
reviewer refuted that by measurement.** What prevents it is the `.add` sitting AFTER the
loop; the hoist is good practice and changes nothing about that hazard. **The distinction
matters because the wrong version tells a future editor the hoist is load-bearing when the
`.add` placement is** - and they might then move the `.add` while carefully preserving the
hoist. Third time on this branch that I credited a rule I wrote with protection it does not
provide.

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
with `learnedAt = 0`.

🛑 **I FIRST WROTE THAT THIS PRODUCES AN UNDER-CLAIM AND CITED THE COMMENT AT :14375 AS
COVER. BOTH HALVES WERE WRONG, AND IT IS THE MOST IMPORTANT CORRECTION ON THIS BRANCH.** The
consumer DROPS an agent when the stamp is recent:

```js
.filter((a) => { const spoke = ROOM_SPOKE_AT.get(a.sessionName);
                 return !(spoke && spoke.learnedAt > LAST_AT); });
```

⇒ **A recent `learnedAt` means the name is NOT shown, which is the under-claim that comment
describes. `learnedAt = 0` means the name IS shown, next to a reply already on screen - the
OVER-claim, which is #1150 itself.** I had the direction exactly backwards, so my reason for
leaving it alone was an argument for the opposite conclusion.

⭐ **And it was a REGRESSION AGAINST MAIN on that one path**, which makes it worse than a
missed improvement: the page-wide boolean had already flipped true by then, so main stamped
X properly and suppressed. My per-room fix reopened the case main happened to cover.

✅ **Fixed rather than documented.** Seeding a room no longer clears a stamp another room
earned; `at` still advances so the dedup does not go stale. Pinned with a four-step trace and
a control where the second room holds an OLDER message, so the arm can come out both ways.

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


## A second defect the same review found: an empty first paint

`ROOM_SPOKE_SEEDED.add(PJ_CURRENT)` ran unconditionally. `engine/messages.js` returns
`{ ok: false, rows: [] }` on a stat or read failure of the message log, and the route sends
that at **HTTP 200**, so `paintRoom` paints it rather than taking its catch branch.

⇒ The room is marked seeded on a paint that carried nothing, **the real backlog arrives on
the next poll into a room believed already seeded, and every member is stamped as having just
spoken** - blanking the working line, which is the exact thing the guard exists to prevent.

**Not a regression** (main had the same hole for the one room it protected), but it bounds
what "seeding is asked and answered per room" was recording: **"this room has been painted
once", not "this room's backlog has been read".** Now gated on `body.ok !== false`.

## Mutation matrix, re-run after both fixes

```
control (fixed)                       3 pass 0 fail
stamp-preservation removed            2 pass 1 fail
empty-paint gate removed              2 pass 1 fail
declaration reverted to a boolean     2 pass 1 fail
restored                              3 pass 0 fail
```

📌 **And one finding I am keeping because it corrects this file's own narrative.** The plan
leaned on "driven, not matched". The reviewer re-ran the matrix with the two
`assert.match(SCRIPT, ...)` shape checks stripped and found the driven arms catch four of six
mutations but **not** the one that turns the declaration back into a boolean while the block
still calls `.has`/`.add` - a mutation that breaks every room paint on the real page. The
driven half is blind to it **by construction**, because the test injects its own `Set`.
⇒ **The matched half covers a hole the driven half cannot reach, and dismissing shape checks
wholesale would have removed a real guard.**
