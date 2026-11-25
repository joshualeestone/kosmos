# waitonce-9058: a wait is reminded at the first session end and once more, not at every /clear (#9058)

Built on PigeonPete's `waitresume-9049` (#9049, not on main yet); rebased onto main once it lands.

## Problem
awaydigest.lastWait skips automatic rows, so an agent answered in chat that carried on without reporting was reminded
of its wait at every /clear and every resume after a quit, for up to 7 days. And "it has not said otherwise since" is
false for an agent that kept working.

## Decision
Count, from the history alone, the sessions since the wait that began at a `started` or `stopped` after it, in which
the agent took a turn (an automatic working/idle) and that ended (a later `stopped`, `started`, or a row of a new
run instance: review 3 and 5): awaydigest.sessionsSinceWait.
The route reminds a /clear or resume only while that is under REMIND_SESSIONS (2): the first session end, then one
repeat, then none. The wording becomes "it has made no report of its own since" (startup and ended both).
Why one repeat: a /clear wipes the context that held the reminder, and #9049 already pins a /clear after a startup
that reminded being reminded again; counting a startup session the same as a /clear keeps that, and stops the third.
Rejected:
- Recording each reminder given (a new store): more state, and a record says it was SENT, not that the agent read it.
- Reminding exactly once: breaks #9049's pinned startup-then-clear case, and the card itself suggests a single repeat.
Weakest premise: a reminder that never reached the agent (lost race, refused ask) still counts as given. It fails
silent and is bounded, never false.

## Smaller, from the card
- install/kosmos-report-hook.sh: the wait-only path now says it costs up to about 2.8 s (two 1 s asks and the pause).
- Not done: a /clear whose own `stopped` lands after the retry still loses the reminder. Silent, bounded, unmeasured;
  left as the card describes it.

## Tests
engine/awaydigest-9058.test.js (the count, sessions with no turn, an open session, the startup case, rows before the
wait; the wording). server.away-9049.test.js: one #9058 route test (reminded, reminded once more, then empty, never
pending; a control where /clears with no turn keep reminding). Controls: the route test fails without the server
rule; the wording test fails with the old phrase. #9049's own tests unchanged and green.

## Review round 1 (opus): 0 BLOCKERs, 2 SHOULDs, 1 NIT, all fixed
- SHOULD: a third /clear whose own `stopped` had not landed was reminded a third time --> FIXED: sessionsSinceWait
  takes `endingNow` (the route passes it for src=clear) and counts the session being ended when it had a turn; once
  its stopped lands the open session is the empty new one, so nothing counts twice.
- SHOULD: a real startup (at=startup / the Windows as=hook) still reminded at every restart for 7 days --> FIXED: the
  same limit on the startup path. A startup after fewer than two worked sessions still reminds, in the startup words.
- NIT: the by-hand text after the limit read as if it applied after any startup reminder --> FIXED: its own sentence,
  only when the limit is the reason.
- Measured by the reviewer: while the wait is the newest row, selfreport refuses (and does not store) automatic
  working/idle, so the wait's own session has no automatic rows; the SessionEnd's `stopped` is always stored.

## Review round 2 (sonnet): 0 BLOCKERs, 0 SHOULDs, 2 NITs
- NIT: an in-session /resume can race its own `stopped` like a /clear and give one extra reminder --> DECLINED, stated
  residual: it errs toward reminding, never silence, and nothing today tells an in-session /resume from a quit-then-resume.
- NIT: the sessionAfter comment said every /clear is reminded; the limit's sentence hard-coded "two" and "each begun with
  that reminder" (false after a crash) --> FIXED (reads REMIND_SESSIONS; claims only that it reminded already).
- Measured by the reviewer: the Mac (asks before `started`) and Windows (after) count the same at the same moment.

## Review round 3 (opus): 0 BLOCKERs, 1 SHOULD, 2 NITs, all fixed
- SHOULD (measured in this Mac's selfreports): most restarts leave no `stopped` (started after started 17/9/8/8/6
  times for five agents, after stopped 0), so the startup limit never applied --> FIXED: a worked session also ends at
  the next `started`; the Mac's at=startup ask (before its `started` lands) passes endingNow, the Windows as=hook (after
  it) does not, so both count the same at the same moment. Route test with no `stopped` rows at all, both platforms.
- NIT: a startup assertion could pass on an error body --> FIXED (asserts 200).
- NIT: "each such session began with a reminder" overstated --> FIXED ("began where a reminder is given").

## Review round 4 (sonnet): 0 BLOCKERs, 2 SHOULDs, NITs, fixed
- SHOULD: an in-session /resume racing its own `stopped` got a third reminder (endingNow was /clear only) --> FIXED:
  every hook ask (as=waithook) counts the ending session; after a quit the open session is empty, so it adds nothing.
  A by-hand wait=only (inside a live session) does not. Round 2's decline of this is withdrawn: the reviewer showed
  the two resumes need no telling apart.
- SHOULD: the limit's sentence said exactly 2 sessions and "it has reminded you already" --> FIXED ("at least",
  "each begun where a reminder is given").
- NITs: a unit case for a started closing a session --> ADDED; a long comment line --> wrapped. The unguarded call in
  the waitOnly branch is left (pure, inside the route's catch).
- The reviewer read the real selfreports: the measured figures in the comment match; no live standing wait exists to
  exercise, so only synthetic histories test this path.

## Review round 5 (opus): 0 BLOCKERs, 1 SHOULD, NITs
- SHOULD: a crash relaunched with --resume writes no stopped and no started, so its sessions ran together and each
  resume was reminded --> FIXED: a change of run `instance` between two rows that carry one ends the session (it
  changes at every run in the real selfreports). Rows with no instance never split.
- NIT: the by-hand comment named wait=only, which no CLI sends --> FIXED. NIT: "two" in the startup comment --> FIXED.
  NIT: plan said only `stopped` ends a session --> FIXED.
- NIT: after the limit, a racing /clear still answers pending, costing one 0.8 s retry --> LEFT (correct answer).
- NIT: the first unit case puts auto rows in the wait's own session, which selfreport never stores --> LEFT (the
  assertion holds either way; the route tests use realistic rows).
