# loginended-9031: review record (kosmos#9031)

| Round | Reviewer | Commit | Findings | What was done |
|---|---|---|---|---|
| 1 | opus, blind | 7fbfc51eab | 0 B, 2 W, 1 C, 3 N | all fixed but W2, below |

Round 1: W1 (the account check hid the refusal of an ended login, and its re-check marked a repaired account refused) fixed both
ways, with tests through the real snapshot. W2 (the page's one-account pickers still offer an ended login) declared in the plan.
N5: the dot is now only the dot or an underscore.
