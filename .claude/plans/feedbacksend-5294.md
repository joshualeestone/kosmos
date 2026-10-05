# #5294: `kosmos feedback write` sends the report now, and says plainly what happened

## The report (day-one, community kosmos-bugs, 2026-10-05)
A user's agent wrote its report with `kosmos feedback write`, read "It stays on this computer.", concluded the report
never reaches the team, and posted it in the community.

## What was actually true (measured before changing anything)
- Reports DO reach the team's collector. The board's hourly sweep (`feedbacksend.sendDailyOnce`, server.js) sends
  today's report, scrubbed, to installkosmos.com/api/feedback, on by default with a Settings opt-out (#2037/#2013).
  `kosmos feedback pull` on 2026-10-05 brought down 75 collected reports, two to seven a day (two from 10-05).
- But: the CLI told the agent the opposite. "It stays on this computer." was written in #2158 (2026-09-04), when only
  the local write existed. Sending shipped later and the sentence was never updated. So the local-only message was not
  a deliberate choice (the card's weakest premise); it is stale.
- And: nothing is sent until the board's next hourly sweep, and nothing at all if the board is not running.

## Change
- `engine/feedbacksend.js`: `sendNow(date, now)` returns a Promise of what happened: `sent`, `already` (sent today,
  unchanged), `later` (a changed report, but one went out under 3 h ago: the existing #4766 floor, so an agent that
  rewrites its report often cannot flood the collector), `off` (the person switched sending off), `none` (no report),
  `failed` (the collector did not take it; the board retries after the 3 h floor), `unsent` (the send marker could not
  be written, so nothing was sent: the same rule as the sweep), `blocked` (a test run aimed at a real address). Same
  gates and order as `sendDailyOnce`: opt-out first, then the unchanged and 3 h checks, then mark, then POST, recording
  the delivered hash only after the collector accepts it. Same payload, scrub, endpoint and 5 s timeout.
- Under test, `sendNow` may POST only to a loopback endpoint (127.0.0.1, localhost, ::1), so a test can run a stub
  collector and prove the real path, and a test run still never phones home. `maybeSend`/`sendDailyOnce` unchanged.
- `install/kosmos` and `tools/windows/kosmos-cli.js` (`feedback write`): save as before, then `sendNow`, then one
  plain sentence for what happened, naming where it went and what was removed. Both CLIs share one message table,
  `feedbacksend.writeMessage(state)`, so the two cannot drift.

## Decided
- **Respect the opt-out.** Splinter's call says this send is user-initiated, so outside Josh's three-ping ruling.
  But `kosmos feedback write` is how AGENTS file the DAILY report (roles.js teaches it), the same data the opt-out
  governs. Sending it with the switch off would break that switch. So: on, it sends now; off, it says plainly that
  it saved locally because sending is off, and where to turn it on.
- **Keep the 3 h floor** for a changed report (#4766), and say so ("goes with the board's next send").
- **No new transport.** The collector already works (measured). Splinter's suggested coordinator route is not needed
  for delivery.

## Not in this change (follow-up)
- Nobody is ALERTED when a report arrives: they sit in the collector until someone runs `kosmos feedback pull`.
  That is the remaining "never reaches us" gap, and it is collector-side (installkosmos.com). Carded separately.

## Tests
- engine: each state, with an injected sender: sent (payload scrubbed, hash recorded), already, later, off (no POST),
  none, failed (4xx and a throw, marker kept), unsent (marker write fails, no POST), blocked (test run, real address,
  no POST), loopback allowed under test.
- CLI (Mac, bash, as a process) and Windows CLI: write with a local stub collector receives one POST and prints the
  sent sentence; with the default (real) endpoint under test, prints the blocked sentence and posts nothing; with
  sending off, the off sentence.

## Weakest premise
That the agent's belief came from the CLI sentence and not from a failed send on that machine. The collector cannot
say which install it was (scrubbed, no names). The fix covers both: the sentence is now true, and a failure is said.
