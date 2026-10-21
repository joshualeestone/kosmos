# handoffage-6593: the handoff's self-report line says how old it is (kosmos#6593 item 2)

**Card.** #6593 carries the leftovers from Josh's five-model reports (0.7.59, then 0.7.60): item 2, `kosmos handoff`'s
"Live state (self-report)" line is stale on GPT and Grok (it showed states from 10-05 and 10-09), because those runners
do not report working, so the last hand-written line stays. The card's ask: label it by age, or leave it out when older
than the current session. Splinter gave me #6593 (00:27) with "split it into parts, make the calls yourself"; this is
the first part. Items 3 (answered room posts sent again), 4 (Meta's extra nudges) and 6 (Meta's shortened messages)
are separate parts.

**The call.** Label by age. After "as of <time>", the line says the age in words ("5 minutes ago", "14 days ago"), and
past a day it adds ", so it may not describe what the agent is doing now". Rejected: leaving the line out when it is old,
because an absent line reads as "never reported", which is false, and an old state is still a fact the reader can weigh.
Rejected: "older than the current session" as the test, because the handoff does not know when the session started and
guessing it would be a second, weaker clock.

**Done when.** A fresh report reads "...; as of <time>; N minutes ago"; a report older than a day reads "...; N days
ago, so it may not describe what the agent is doing now"; the report itself is still shown.

## Change
- `engine/handoff.js` stateFact: after a sane "as of", push agoWords(now - at), with the old-report clause past
  STALE_REPORT_MS (a day). A future time (clock skew already bounded by saneIso) says no age.

## Tests (engine/handoff.test.js)
- 5 minutes: "5 minutes ago", not called old. 14 days: "14 days ago, so it may not describe what the agent is doing
  now", and the report is still shown (CONTROL). Boundary: 23 hours is not old, 25 hours is.
- Checked by hand: with the old-report clause removed, the test goes red (the 14-day, 24-hour and 25-hour arms).
- Review 1: exactly a day is old (>=); the singular words and a skewed future time (no age) are tested.

**Weakest premise.** A day as the line between current and old. A working session reports far more often than daily,
so an older line is the leftover of an earlier session; but an idle agent that has truly done nothing for a day will
also be called old, which is honest (its report may well not describe now).
