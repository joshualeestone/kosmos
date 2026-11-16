# feedidle-8572: the daily feedback ask goes only to an agent that worked today (kosmos#8572)

## Finished looks like
On an evening when some agents worked and others did not, the daily product-feedback ask reaches an agent that itself
worked today (or one whose provider Kosmos cannot see), never an agent idle all day; if every agent that worked is
still busy, nobody is asked until one is free; a board restart in the afternoon does not change who may be asked.

## The change (engine/feedbacknudge.js)
- seenWorking(card) and cannotSee(card) split out of workedToday; the day gate is unchanged.
- candidates() takes a mayAsk filter; plan() asks only cards that worked today (seen now, or in the record's workers,
  or no_source). Reason when none: "nobody who worked today is free to ask yet" (no try spent).
- The record (feedbacknudge.json) keeps workers: the sessions seen working today, grown on each tick.

## Decided, and rejected
- Rejected: the card's fallback to an idle Project Manager when nobody who worked can be asked. That is the reported case.
- Kept: Project Manager, then Director, then roster order, among those who worked.
- Weakest premise: an idle-all-day agent can have nothing useful to report. A Project Manager might see across projects;
  but `kosmos feedback day` shows only its own conversation and tasks, which is what the ask tells it to report on.

## Verification
engine/feedbacknudge-7374.test.js (3 new tests, 2 updated), with a control (main's module fails 4); tree guards; the
related feedback CLI, feedback-day and chat tests.
