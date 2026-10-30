---
pre_challenge: true
method: challenge-loop
branch: download-7389
diff_hash: 941db2b8bcedd9cc68f7c2bd97de8ee67e7bb302a4f45ead46322af62c25c79f
validation: passed
subdir_audit: passed
timestamp: 2026-10-28T08:28:00Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

`diff_hash` is `git diff origin/main...HEAD -- ':!.claude/plans/download-7389-pre-challenge.md' | shasum -a 256`.

**Validation of record:** the full suite on the pre-fix head (52e4397646) ran 24519 pass and 1 fail. The fail was ios.privacy-manifest-7352: review 4's sweep read file modification dates, which the privacy manifest does not declare. That is fixed here (4697d2ec27). After rebasing onto main: ios/LogicTests/run.sh 1584/1584, and the iOS repo tests (ios.*.test.js, server.ios-routes-6838, tools.shell-shard-4317) 64/64. A full suite on this head has not run locally; CI runs it.

**Convergence:** each round's findings are in the commit messages ("review N:") and in the plan's Review 1 section.

### Per-Iteration Breakdown

#### Iteration 1
- [BLOCKER] board downloads are <a download> and never reach the response policy, so nothing was judged. Now judged at the destination, by the Mac's rules. Fixed.
- [WARNING] six more: 204/205 handling, errors or the sign-in page kept as the file, failures not said, redirects off the board's origin, the Getting line not tied to its download, per-page counts. Fixed.
#### Iteration 2
- [WARNING] a refused redirect was said twice; with two downloads, the one still running lost its Getting line and Cancel. Fixed.
#### Iteration 3
- [WARNING] presentations dropped when one was already up; Cancel cleanup late; the folder download's page refusals unsaid. Fixed with a queue.
#### Iteration 4
- [WARNING] the queue stalled when a presentation never reported back; folders a killed app left were never swept. Fixed.
#### Iteration 5
- [WARNING] files and sheets outlived the lock; a late report from a skipped presentation changed state; Cancel not its own VoiceOver button. Fixed.
#### Iteration 6
- [NIT] only. Converged (10-27 19:10).
#### Iteration 7
- The post-convergence fix (the sweep reads no file dates), reviewed blind: no blocker, no warning. [NIT] the comment should say every folder creator must call sweepOnce() first. Taken.

## Final ledger
No open BLOCKER or WARNING. Converged.
