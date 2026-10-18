---
pre_challenge: true
method: challenge-loop
branch: keptbuilt-6359
diff_hash: 77c50b3aa117c9f5014ec1ff11d07b995a9890b5b467fa1a334d5d0a80722a6d
validation: the full local suite (validation_log_run_or_skip) at c1be2123, same tree as this head: node 21457 tests, 21213 pass, 0 fail; shell 246/246. Its one red was the repo's browser-check gate (#1720), web/ changed with no docs/browser-checks/ update; this head adds the gate's own trailer (copy-only, covered by engine/taskactphrase.test.js running the page's lifted tkActPhrase), and the gate run alone then passes (it failed without it, the control). Main moved 88 commits since the base, no conflict predicted; the PR's CI is the run against current main.
subdir_audit: passed
timestamp: 2026-10-17T15:01:42Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, sonnet)
**Converged:** Yes. Iteration 2 raised NITs only (no BLOCKER or WARNING); the three were applied.
**Total findings:** 0 BLOCKERs, 2 WARNINGs (both fixed), 6 NITs (fixed, or decided in the plan).
Stacked on Baron Draxum's builttell-6330 while it was open; rebased onto main after #6330 merged (rebase --onto), with the changed lines compared before and after (identical).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] the drop notice pointed at kosmos task message, which reaches only the task's assignees, not a parent task's holder that a built notice also goes to --> FIXED (points at kosmos msg <agent>)
- [WARNING] the drop notice said "the task is still marked built" a day later without checking (a mark can be cleared, a task closed) --> FIXED (removed)
- [NIT] re-marking with a new note kept a second notice beside the first --> FIXED (a new built notice for the same task, sender and recipient replaces a kept one; test)
- [NIT] comments over-stated that a built notice cannot be sent again --> FIXED (reworded)
- [NIT] the pointer named no project or task --> FIXED by the change of command (kosmos msg <agent> needs neither)
- Checked clean: other readers of kept entries (only dm entries are listed; kept-* events are read only by the page phrase and the activity sort); the built flag reaches the page as a boolean; "the same mark again tells nobody" is true (setBuilt changed: false).

#### Iteration 2
**Reviewer model:** sonnet
- [NIT] the replace removes before it adds; a failed add then loses the old notice silently --> DOCUMENTED in the code and plan (it frees the sender's place; the write that just succeeded makes it rare)
- [NIT] the replace ignored an entry the sweep is typing --> FIXED (isTyping and isDone entries are left to finish)
- [NIT] the replace test had no control for the sender check, and lines kept before this change still read as messages --> FIXED (a second sender's notice must survive; mutant: the sender check removed, red) and DOCUMENTED (old entries drain within a day)
- Checked clean: the replace touches only the recipient's own queue; another sender's notice, a person's line and another task's notice survive; keepTaskLine is synchronous, so it cannot interleave with the sweep.

Mutants, each red: the route's kind, the summary's kind, the queue whitelist line, the drop words, the record flag, the page phrase, the replace, the sender check.
