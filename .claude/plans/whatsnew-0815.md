# whatsnew-0815: What's New for the 0.8.15 cut

## Why
Splinter called a 0.8.15 staging cut at 03:49 CST 11-22. The cut's step 1b-ii refuses unless web/whats-new.json is for
the version it cuts and the pool records what prod serves. Prod has served 0.8.14 since 02:38 CST, and the pool still
recorded 0.8.13 (the same refusal that cost the 0.8.14 re-cut at 21:46 on 11-21). So this goes in before the cut.

## What
One command, nothing hand-edited: `node tools/whats-new-pool.js build 0.8.15`. Its prod sync marked 0.8.14's 5
highlights shown (shownIn 0.8.14) and set lastProd 0.8.14. Then it built the window from what is still pending:
- A little more room between chat lines
- The restart note says what was checked
- Windows Settings stops a false warning
- Removing Kosmos takes out its agent hooks
- A just-started agent gets your first message
That is mac 2, windows 4. The lines are as their authors put them in the pool.

## Rejected
- Hand-picking Mac lines to fill the window: the tool chooses highlights by its own ranking and platform rules, and the
  check accepts this window. The other pending pool items are agent-command notes (`kosmos ... --how` and the like),
  which the tool keeps out of the highlights.

## Weakest premise
That every pending highlight is on main at this commit. The pool is written by the PRs that ship them, so a highlight is
pending only once its PR merged, but nobody checked each one against main by hand for this file.

## Checks
- `node tools/whats-new-check.js 0.8.15`: 5 highlights (mac 2, windows 4).
- `node tools/whats-new-pool.js prod-check` after the build.
- The What's New tests, and the full suite.
