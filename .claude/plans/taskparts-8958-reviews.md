# taskparts-8958: review record (kosmos#8958 slice B7), base f0fa2537c5

| Round | Reviewer | Commit | Findings | What was done |
|---|---|---|---|---|
| 1 | opus, blind | 7b27a1d5b1 | 0 B, 6 W, 6 N | all fixed but one N: "could not tell" is also said when the app could not send at all, as its other writes say |
| 2 | opus, blind | 5b3f4eff98 | 0 B, 2 W, 6 N | all fixed |
| 3 | sonnet, blind | 11532e3a1b | 0 B, 1 W, 5 N | below |

Round 3: W1 (somebody else's same words, added between the page's last read and ours, read as ours when our answer is lost)
is accepted and now said so in the plan: a read before every Add would slow each one for a case that needs the same words, a
lost answer and the same few seconds. Fixed: the view kept alive by an unsettled write, one unsettled Add forgetting another, a
comment. Not changed, as the board: a typed part is not kept past the page; a refusal after the Mac moved the part (its tell
threw) reads as refused.
