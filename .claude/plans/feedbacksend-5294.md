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
- `engine/feedbacksend.js`: `sendNow(date, now)` returns a Promise of what happened: `sent`; `already` (a version
  delivered today, unchanged); `later` (changed, but a version was DELIVERED under 3 h ago: the #4766 floor); `off`;
  `unreadable` (the setting file cannot be read: nothing sent); `none`; `failed` (not confirmed: refused, unreachable or
  timed out, so it may have landed); `soon` (nothing delivered today and a send started under 60 s ago, failed or still
  in flight: no POST, so a looping agent cannot flood a down collector); `unsent` (the marker could not be saved, so
  nothing was sent); `blocked` (sandboxed, aimed at a non-loopback address). The 3 h floor applies only after a real
  delivery, so after a failure, writing the same report again retries (after the 60 s floor).
- `sandboxed()`: the node test-runner signal OR a data root under a FIXED temp root (/tmp, /private/tmp, /var/folders,
  /private/var/folders), never os.tmpdir(), which follows the caller's TMPDIR. Sandboxed, sendNow reaches loopback only.
  It gates sendNow only; the board's sweep keeps its runner-only guard.
- Both CLIs print `feedbacksend.writeMessage(state)`, one shared sentence table. install/kosmos counts a report as
  saved only when node printed SAVED after the write; anything else says "We could not save that report."

## Decided
- **Respect the opt-out.** Splinter's call says this send is user-initiated, so outside Josh's three-ping ruling.
  But `kosmos feedback write` is how AGENTS file the DAILY report (roles.js teaches it), the same data the opt-out
  governs. Sending it with the switch off would break that switch. So: on, it sends now; off, it says plainly that
  it saved locally because sending is off, and where to turn it on.
- **Keep the 3 h floor** for a changed report (#4766), only after a real delivery; no sentence promises a time.
- **No new transport.** The collector already works (measured). Splinter's suggested coordinator route is not needed
  for delivery.

## Not in this change (follow-up)
- Nobody is ALERTED when a report arrives: they sit in the collector until someone runs `kosmos feedback pull`.
  That is the remaining "never reaches us" gap, and it is collector-side (installkosmos.com). Carded separately.

## Tests
- engine: every state with an injected sender, plus: a retry after a failure; later never after a failed attempt;
  soon (no POST within 60 s); unreadable; sandboxed true for a temp root without the runner, and FALSE for a real root
  even with TMPDIR=/ (review 3).
- CLI (Mac, bash, as a process) and Windows CLI: write with a local stub collector receives one POST and prints the
  sent sentence; a non-loopback .invalid address prints blocked; sending off prints off; a node that cannot run prints
  "could not save", never Saved. Every harness defaults to a dead loopback, so no test can reach installkosmos.com.

## Weakest premise
That the agent's belief came from the CLI sentence and not from a failed send on that machine. The collector cannot
say which install it was (scrubbed, no names). The fix covers both: the sentence is now true, and a failure is said.
