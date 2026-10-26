# richnotice-6487: a needs-you report with no reason still gives the phone words (kosmos#6487)

## Finished looks like
A needs-you phone notice for an agent's report is rich (the agent's picture and words) even when the report carries
no reason, because the board always answers true words for it.

## Cause (read from code; Josh's board log is not readable here)
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
