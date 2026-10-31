---
pre_challenge: true
method: challenge-loop
branch: build11
diff_hash: b9a66d90e88ae3a35a7918a58ba926f202cc85700880ef8d8f53431db1842434
validation: passed
subdir_audit: passed
timestamp: 2026-10-28T08:58:20Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

`diff_hash` is `git diff origin/main...HEAD -- ':!.claude/plans/build11-pre-challenge.md' | shasum -a 256`.

**Validation of record (on e4a75157a6, rebased onto main):** iOS 16 simulator typecheck with 0 errors; ios/LogicTests/run.sh 1545/1545; run-room.sh 472/472; the 13 repo tests that read these Swift files (incl. fixture-discipline, no-brand-refs, no-name-refs, tools.shell-shard-4317) 106/106. A full suite has not run locally; CI runs it.

**Convergence:** findings per round are in the plan's Reviews section and the "review N:" commit messages.

### Per-Iteration Breakdown

#### Iteration 1
- [BLOCKER] the ring went round the bubble's width frame. Fixed.
- [WARNING] VoiceOver and file-card openings unmarked; failed star save said only on Agents; star built on an unread list. Fixed.
#### Iteration 2
- [WARNING] star failure note in any chat; star could stay disabled for a whole chat. Fixed. (Design then corrected by Mona Lisa: lit, not ringed.)
#### Iteration 3
- [BLOCKER] cut-out offset by the top safe-area inset. Fixed.
- [WARNING] VoiceOver could leave the sheet; the lit bubble was live. Fixed. Navigation bar live: not taken (reason in the plan).
#### Iteration 4
- [WARNING] a half-hidden bubble lit a patch of the composer; an empty-built star item on iOS 16. Fixed.
#### Iteration 5
- [BLOCKER] the visible-area preference erased the bubble's anchor. Fixed (transformAnchorPreference).
#### Iteration 6
- [WARNING] a lit bubble scrolled out of the list leaves a full dim: kept as the fallback. [NIT] star after the computer is known. No blocker. Converged.

## Final ledger
No open BLOCKER. One WARNING kept on purpose (documented). Converged.
