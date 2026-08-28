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

🛑 **THIS PARAGRAPH HAS BEEN WRONG TWICE, IN OPPOSITE DIRECTIONS, AND THE SECOND VERSION WAS
THE MORE DANGEROUS ONE.** Recorded in full because the correction is more useful than the
conclusion.

**v1:** "the hoist prevents the first row seeding the map and the second row seeing it seeded."
**v2, after a reviewer refuted v1:** "the `.add` after the loop is what prevents it; the hoist
changes nothing."

**Both false. Measured, four variants:**

| variant | first paint stamps its own history? |
|---|---|
| HEAD (hoist + trailing `.add`) | correct |
| hoist inlined per row, `.add` after the loop | **correct** |
| hoist kept, `.add` moved above the loop | **correct** |
| hoist inlined **and** `.add` above the loop | **BROKEN** |

⇒ **Neither is individually load-bearing. They are JOINTLY REDUNDANT** - `seededRoom` is read
before `.add` under either one alone.

⭐⭐ **AND THAT MAKES v2 WORSE THAN v1, WHICH IS THE PART TO KEEP.** v1 was merely wrong. **v2
told a future editor the hoist "changes nothing", which licenses inlining it - and inlining it
is precisely what turns a later `.add` move from harmless into silent breakage.** My correction
shed the second line of defence it was standing on, and it warned about the SAFE move while
clearing the way for the dangerous one.

🛑 **AND "KEEP BOTH" WAS WRONG TOO - THIS PARAGRAPH HAS NOW BEEN WRONG THREE TIMES.** Round 3
measured a fifth variant my four-row table did not contain: **both mechanisms present and
unmodified, with `.add` moved ABOVE the hoist.**

```
HEAD        dana.learnedAt = 0        erin.learnedAt = 0         history, correctly not speech
variant 5   dana.learnedAt = 5000000  erin.learnedAt = 5000000   STAMPED AS JUST SPOKE
```

⇒ **The original #1150 defect, restored on every room, with "keep both" fully satisfied.**

⭐⭐ **The failure is the same each time and it is not the reasoning, it is the SUMMARY.** My
accurate sentence has survived all three rewrites: *`seededRoom` must be read before
`ROOM_SPOKE_SEEDED.add`.* Every version then compressed it into an actionable rule about which
LINES to keep - and **the invariant is ORDER, not presence.** An editor acts on the
prescription, not on the sentence above it.

✅ **The only durable form, and it names the property rather than the lines:**

> **`seededRoom` must be READ BEFORE `ROOM_SPOKE_SEEDED.add` runs.** Any arrangement preserving
> that is fine; any arrangement breaking it restores #1150. Do not reason about the hoist and
> the `.add` as two things to keep - reason about the order of the read and the write.

📌 **Three wrong summaries of one correct sentence.** That is worth more than the fix: the
sentence was never the problem, and each rewrite made a tidier rule that lost the invariant.

📌 Fourth time on this branch that I credited a rule with protection it does not provide, and
the first time I did it while correcting exactly that mistake.

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


## Round 2, and it found the half my own mutation matrix could not

**The `!seededRoom` conjunct was unpinned, and dropping it is a real over-claim.** My matrix
tested reverting the fix wholesale; it never tested reverting HALF of it.

```
control (HEAD)                             3 pass 0 fail
`!seededRoom &&` removed                   3 pass 0 fail    <- NOT CAUGHT
stamp-preservation removed                 2 pass 1 fail
empty-paint gate removed                   2 pass 1 fail
```

With `!seededRoom` gone, an agent speaking a SECOND time in an already-seeded room satisfies
the preservation clause, so its stamp is kept instead of refreshed. **The stamp then goes
stale, `LAST_AT` advances past it, the consumer stops dropping the agent, and the name renders
beside a reply already on screen.** #1150 again, by a slower route.

⭐ **Why every existing arm was blind to it: they all speak ONCE per agent per seeded room.**
A single speech cannot distinguish a refreshed stamp from a preserved one. The missing arm is a
second speech.

🔑 **AND WRITING THAT ARM SURFACED THE SAME DEFECT IN THE HARNESS.** Two `seed()` calls in a
fast test land in the SAME MILLISECOND, so `Date.now()` returns an identical number for
"refreshed" and "preserved" and no assertion could separate them. **The test could not tell the
two apart** - the branch's own disease, in the instrument. `Date` is now a parameter of the
sliced block, stubbed with a clock the test advances, so the two are distinguishable by
construction.

**Also flattened the ternary** so `!seededRoom` stops being a separately-mutable component, and
**dropped a `body &&` guard that read as protection and was not**: `const allRows = body.rows || []`
already dereferences `body`, so a null body throws before that line.

### Mutation matrix, final

```
control (HEAD)                             3 pass 0 fail
preserved beats seeded (previously MISSED) 2 pass 1 fail
stamp-preservation removed                 2 pass 1 fail
empty-paint gate removed                   2 pass 1 fail
restored                                   3 pass 0 fail
```


## Round 3 under the new rule: three surviving mutations, all now dead

The stopping rule for this branch was changed before round 3 ran, from "no behaviour defect" to
**"no reviewer can break a line this branch defends and keep the suite green"**. Round 2 had
returned BEHAVIOUR DEFECTS: none. Round 3 found three survivors.

**1. The dedup boundary.** `at <= seen.at` weakened to `at <` left the whole suite green and
**blanks the working line permanently in every room**: a room re-serves the same rows on every
poll, so an unchanged `at` stops being skipped and every agent is re-stamped every tick.
⭐ **Nothing in the diff repainted unchanged rows - the single most common thing `paintRoom`
does.** The old test pinned that SOME dedup exists, not where its boundary is.

**2. The seeding gate on the `{ok:true, rows:[]}` side.** Tightening it to
`body.ok !== false && allRows.length` - which reads like an improvement on the comment beside
it - left the suite green and reintroduces #1150 **on the newest-project path**: a brand-new
room is empty-but-successful on first open, so it would never be seeded and its first real post
is announced as speech.

**3. The stamp-preservation arm could not fail.** `CLOCK.t` was advanced once and never again,
so `earned` and `Date.now()` were the same number across the two calls being compared.
⭐ **That is the harness defect this plan documents and cured for the `erin` arm, still present
in the arm the plan calls its most important correction.** Applied to one arm and not the other:
the same class of miss as the precedence gap on my sibling branch, on the same afternoon.

All three now die. Two guards whose weakening also survives are named in the code as
**unreachable only because another module holds the line** (`engine/messages.js` rejects
unparseable `at`; the route always sends a boolean `ok`), rather than tested here, because a
test here would assert a guarantee that lives elsewhere.
