# loginended-9031: review record (kosmos#9031)

| Round | Reviewer | Commit | Findings | What was done |
|---|---|---|---|---|
| 1 | opus, blind | 7fbfc51eab | 0 B, 2 W, 1 C, 3 N | all fixed but W2, below |

Round 1: W1 (the account check hid the refusal of an ended login, and its re-check marked a repaired account refused) fixed both
ways, with tests through the real snapshot. W2 (the page's one-account pickers still offer an ended login) declared in the plan.
N5: the dot is now only the dot or an underscore.

Round 2 (opus, blind, 04f606cc85): 1 B, 3 W, 4 N. The blocker was round 1's own fix (a revoked account lost its rejected badge):
that fix and the date check in the account check are taken out, which also ends W2, W3 and three of the nits. W4 is declared. The
plan's wrong sentence about the Windows stream is corrected. New from this round: an ended login is the one whose tokens Claude Code
has emptied, measured with made-up credentials.

Round 3 (sonnet, blind, 4628c95dc8): 0 B, 2 W, 1 N. W1 (the test file spelled the line out, so reading it reads as signed out) fixed;
quoting a whole line is declared. W2 (emptied tokens taken as an ended login, unproven live) is the plan's weakest premise, kept: a
signed-out account is no target either. The nit (the page's pickers) is declared.
