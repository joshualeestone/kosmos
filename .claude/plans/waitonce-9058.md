# waitonce-9058: a wait is reminded at the first session end and once more, not at every /clear (#9058)

Built on PigeonPete's `waitresume-9049` (#9049, not on main yet); rebased onto main once it lands.

## Problem
awaydigest.lastWait skips automatic rows, so an agent answered in chat that carried on without reporting was reminded
of its wait at every /clear and every resume after a quit, for up to 7 days. And "it has not said otherwise since" is
false for an agent that kept working.

## Decision
Count, from the history alone, the sessions since the wait that began at a `started` or `stopped` after it, in which
the agent took a turn (an automatic working/idle) and that ended (a later `stopped`): awaydigest.sessionsSinceWait.
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
