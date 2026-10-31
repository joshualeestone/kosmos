# richnotice-6487: a needs-you report with no reason still gives the phone words (kosmos#6487)

## Finished looks like
A needs-you phone notice for an agent's report is rich (the agent's picture and words) even when the report carries
no reason, because the board always answers true words for it.

## Cause: NOT ESTABLISHED (corrected after review 1)
The phone extension (ios/KosmosNotice) makes a notice rich only when GET /api/phone/notice answers words. reportNote
answered null for a needs_you row with no `because` (a report made with only --on or --owner; an automatic report
without a reason), so the bare push showed: Josh's "Jonah Ellis needs you", K icon, no words (TestFlight build 3).

## Built
engine/phonenotice.js reportWords(row): because, else 'Waiting on <on>.', else (row.auto) 'Asking your permission to
go on.', else 'Waiting for your answer.'. docs/phone-notifications.md says so. Board-side only: no app build.

## Decided
- crashloop:/stuckterminal:/ownbounds: needs-you ids stay plain (board parseId and phone isAskable accept only
  report:/reply:/post:); making them rich needs an app build. Separate change, on the card.
- Weakest premise: that Jonah's notice was a reason-less report and not one of those three kinds. Would change my mind:
  the board log line for that push naming a crashloop/stuck/ownbounds id.

## Evidence
engine/phonenotice.test.js 7/7 (three new rows: no reason, --on, auto); route and catalog tests 36/36.

## Review
- Round 1 (.claude/plans/richnotice-6487-review1.md): 0 blockers, 3 warnings, 2 nits. My first stated cause was wrong:
  a Claude Code permission hook always sends a reason, and a needs_you with no reason, --on or --owner is refused at
  record time (selfreport.js:271). So this branch only closes the --on-only / --owner-only (and pre-#2001 row) gap; it
  is NOT shown to be why Jonah's notice was plain. The auto branch was dead (rows store `by:'auto'`, never `auto`),
  removed; an --owner-only report now says "Waiting on <owner>." (never "your answer" when someone else must act).
  Card and Splinter corrected. Still open: which id that push carried (crashloop/stuckterminal/ownbounds, the
  borrowedName 404, or the extension's request failing), which only the sending board's log can say.
