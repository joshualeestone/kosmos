# howonce-9015: review record (kosmos#9015)

| Round | Reviewer | Commit | Findings | What was done |
|---|---|---|---|---|
| 1 | opus, blind | cd60f5b81c | 0 B, 5 W, 6 N | all fixed |
| 2 | opus, blind | after round 1 | 0 B, 3 W, 7 N | fixed, but the sandboxed agents, which the plan declares |
| 3 | sonnet, blind | 40ee3762fb | 0 B, 1 W, 3 N | below |

Round 3: the warning (a token's name should lose "-discord" too) is not taken: round 2 measured that it merges two real agents, and
the supervisor mints under the name without it. The revoke hook is now in a try. Accepted: marks forgotten by a revoke that then
fails (one more pointer); a launch with no name here past 3000 newer ones.
