# staleq-8212: remind a stale needs_you too (kosmos#8212)

## Problem
Three agents on one project sat in needs_you for about three days after the stuck process they
waited on ended by itself. Only the agent that set the state can clear it, and nothing asked it.

## What exists
engine/stalereport-nudge.js (#5959 slice 3) reminds an agent once whose own report has stood
over STALE_WAIT_MS (a day), but only for `blocked`. needs_you was excluded because, for runners
other than Claude, nothing keeps a typed line out of an open question.

## Change
- REMINDED_STATES = ['blocked', 'needs_you'] (the WAITING_ON_A_PERSON pair).
- A needs_you gets its own line: "Kosmos here, a reminder, not an answer from the person: ...
  If nobody needs to answer it any more, clear it with: kosmos report clear. If you still need
  the person, leave it, and there is nothing to send them."
- A needs_you is reminded only when the agent wrote it (by: agent): a line with no writer may
  be an old permission wait, and a person's own line is theirs (review iteration 2).
- Unchanged guards that make this safe: Claude cards only and never one reached through a
  channel; screenOpen refuses an open question menu or permission prompt; by:'auto' excluded;
  untilDefers holds back a held question (#7915) and one with an until.

## Tests (engine/stalereport-nudge-5959.test.js)
The old "never needs_you" half of one test is replaced by:
- a three-day-old own needs_you is told once, in the new words, without repeating the question;
- not typed into an open question menu or prompt, a held question, Kosmos's own, or a fresh one
  (control: the same question with a clear screen is told);
- Claude only (control: the Claude card is told).
Control run against origin/main's nudge: exactly the 3 new tests fail.

## Wording
The needs_you line uses report show's own clear condition ("If nobody needs to answer it any
more"), pinned by a test that reads server.js, and says there is nothing to send the person,
so the reminder does not prompt the agent to ask the person again (review iteration 1).

## Known tradeoff (review iteration 1, deferred with reasons)
The reminder starts a turn. If that turn hits a transient provider error, Claude Code's
StopFailure hook writes an automatic `blocked` over the question, and #6209 review 7 deliberately
keeps such a block rather than re-show the wait under it (each re-showing design drew a defect).
The card then shows a provider block where the question was, and this sweep skips by:'auto'.
Before this change an idle needs_you agent took no turn, so it could not reach that state.
Accepted because: it needs a provider error in the one reminder turn; the card stays red, so
the person still sees the agent is waiting; and the fix belongs to #6209's residual, not here.
What would change it: seeing it happen; then re-showing the covered wait gets its own card.

## Not built (decided on the card)
- an agent that is not running: nothing can ask it, and auto-clearing would erase a real question;
- non-Claude runners: #5959's reason still holds there;
- the per-project "blocked on the same thing" view: a web/ change, its own card.
