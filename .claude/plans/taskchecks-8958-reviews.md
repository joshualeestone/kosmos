# taskchecks-8958: review record (kosmos#8958 slice B9), base taskholdform-8958

| Round | Reviewer | Commit | Findings | What was done |
|---|---|---|---|---|
| 1 | opus, blind | after the rebase on B8 | 0 B, 3 W, 8 N | all fixed, or declared in the plan (what is left on the board's page) |
| 2 | opus, blind | 86ac4ec6de | 0 B, 1 W, 4 N | all fixed |
| 3 | sonnet, blind | e105a2b141 | 0 B, 3 W, 4 N | below |

Round 3: W1 (a link pushes a task already under this one) is accepted and now in the plan: the page's other task links do the same,
and the engine refuses a task that replaces or moves to itself. W2 and W3 (the UI test's swipes) fixed; a repeated number in the
state's links fixed. Not changed: values the engine never writes.
