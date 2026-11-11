# unchangedchain-8269: --unchanged says when the report it sees is another agent's

Card: kosmos#8269. `kosmos feedback write --unchanged` refused with "no earlier report of yours to point back to"
although `feedback show` printed a report, so a quiet stretch forced full reports.

## Cause (decided from code; the reporter's files are not available)
Baron measured the chain working on main for named and unnamed writers (card, 11-08). The refusal is the writer
mismatch: `unchanged()` matches only the writer's OWN section (#7886 item 6, so "my report" is true), while
`feedback show` prints every writer's. And the board's daily ask (engine/feedbacknudge.js, #7374) is not tied to
one agent: it goes to a Project Manager first but passes to the next agent when one is held, so a quiet stretch can
ask an agent with no report of its own here. The ask then told that agent to compare with "your last report" and
run --unchanged, which can only be refused.

## Change
- engine/feedback.js `unchanged()`: the 'none' refusal also returns `newest`, the newest EARLIER day holding any
  writer's non-empty report (never today), or null. For a NAMED writer the unnamed section does not count (review 1:
  a pre-#5317 or no-identity report may be the writer's own, so calling it another agent's could be false).
- Both CLIs (install/kosmos, tools/windows/kosmos-cli.js): with `newest`, the refusal says "the newest report here,
  of DATE, is another agent's, and --unchanged points back only to your own". Without it, the old sentence.
- The daily ask (feedbacknudge.nudgeText) and the Project Manager line (roles.js) say "your own last report", that
  `kosmos feedback list` says which days hold yours, and that another agent's report does not count.

## Decided against
- Letting --unchanged point at another writer's report (the card's "accept the latest report of either kind"). The
  pointer says "Nothing new since my report of DATE"; pointing at another agent's report makes that false, and
  #7886 item 6 chose own-section-only on purpose.
- The card's second ask (skip the daily prompt on a day with no activity) is already built: feedbacknudge asks only
  when some agent of the install was seen working today (#7374, 10-27).

## Weakest premise
That the 11-08 refusal was a different writer. The collector keeps one file per computer per day, so it cannot say
which agent wrote which day; Baron's 11-04/05/07/08 read fits it and does not prove it. If the reporter's files show
the same writer refused, this is not the cause and the card reopens.

## Tests
cli.feedback-unchanged-8269.test.js (5): Mac real CLI and engine: only another agent's reports (newest earlier day
named, today's report of theirs not named, nothing saved); your own older report still pointed back to over their
newer one; no reports at all keeps the plain sentence. Windows: the sentence with and without `newest`. The ask and
the PM line. 5 mutation arms all red (no newest; today counted; Mac or Windows old sentence; ask reverted).
engine/feedback-unchanged-8269.test.js (3): an empty section is not named; for a named writer the unnamed
section is not named (control: the unnamed writer finds that day as its own). 2 more mutation arms red.
Updated two pins of the refusal's shape (engine/feedback-unchanged-7886, engine/feedback-listnote-8340).
