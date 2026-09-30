---
pre_challenge: true
method: challenge-loop
branch: task-routes-4491
diff_hash: f167a63959e7c318bd494eb382de04e5cc2166940ee3b97e979a5455fef5f130
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T13:50:45Z
iterations: 13
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 13 (plus one early review of the first commit before the loop)
**Converged:** Yes (iteration 13: its one WARNING is the valve-before-membership cost the plan accepts; the rest NITs. Final validation on 5844c66af PASSED, 11914 node tests / 0 fail, shell suites and subdir audit clean)
**Total findings:** 27 actionable (0 BLOCKERs; WARNINGs including 1 validation red, CONVENTIONs), plus NITs
**Fixed:** 22 | **Deferred:** 5 | **Asked (awaiting user):** 0

⚠️ **Disclosures:**
- Built stacked on slice 2 (#4521), then rebased onto main twice (after #4521 merged, and after more main commits); no conflicts. Earlier shas are orphaned; the current commits are listed in the ledger.
- Many validation runs were stopped by me because the code changed under them (only processes whose cwd was this worktree), and several waited in the Mac's one-suite queue behind other agents' suites; runs were re-queued with KOSMOS_WAIT_MAX_S=3600. Only the final run's result is claimed.
- One test I added in iteration 8 could not fail (it stubbed projects.readAll, but projects.get reads through the module's own readAll). Its control run showed it; it now stubs projects.get too and is measured red with the re-read restored.
- Iteration 1's reviewer ran an unguarded `rm -f $S/$f` in its scratch probe and waited on a permission prompt until Splinter dismissed it; later reviewer prompts require guarded rm.
- One claim in the plan (that the other task notifications reach departed assignees, filed as #4540) was measured false while building #4540 and was deleted, not rewritten (commit 5844c66af).
- Decided while Josh was away, recorded on #4491 and in the plan: task message is not delivered to an assignee no longer on the project (every sender, the person included), and `delivered` says why.

### Per-Iteration Breakdown (models alternate; every fix has a control measured red, restored clean)

#### Early review (sonnet, one commit)
- [WARNING] pane arm used `roster.find(target)` where the CLI sends %N --> FIXED (roster target, else messages.resolveSender)
- [WARNING] paneless name vs stored spelling --> FIXED (shared helper)
- [WARNING] valve before membership --> FIXED (membership first, as task built)

#### Iteration 1 (opus)
- [WARNING] key comparison for everyone admits look-alikes and refuses non-ASCII --> FIXED (exact; key only for paneless)
- [WARNING] no test for the %N arm --> FIXED
- [WARNING] self-exclusion by exact name vs key --> FIXED (same rule)
- [WARNING] Mac stale-token behaviour change unstated --> FIXED (plan)
- [WARNING] valve cost and order untested --> FIXED (valve-order test); cost DEFERRED (accepted in plan)
- [CONVENTION] stale header comment --> FIXED

#### Iteration 2 (sonnet)
- [WARNING] comment implied a boundary --> FIXED (advisory stated)
- [WARNING] roster-target arm did not require isNamedOurs --> FIXED
- [WARNING] unreadable project list answered 400 --> FIXED (503)

#### Iteration 3 (opus)
- [WARNING] task built returned 400 on an unreadable list --> FIXED (503)
- [WARNING] task built paneless arm untested --> FIXED
- [WARNING] paneless self-exclusion untested --> FIXED
- [CONVENTION] task built comment said board token only --> FIXED; [CONVENTION] plan stale --> FIXED (rebased)

#### Iteration 4 (sonnet)
- [WARNING] the screen's pane was looked up although never held to membership --> FIXED
- NITs: gate cases for trailing slash, non-numeric task, encoded slash --> applied

#### Iteration 5 (opus)
- [WARNING] departed assignees were told to reply and then refused --> FIXED (not delivered; `delivered` says why) and DECIDED on #4491
- [WARNING] paneless test duplicated inline --> FIXED (panelessCaller)
- [WARNING] valve cost --> DEFERRED (duplicate, accepted)

#### Iteration 6 (sonnet)
- [WARNING] other notifications to departed assignees --> filed #4540, later measured not to exist (see disclosures)
- NITs: sender excluded by raw name, stale comment, one-entry-per-assignee test --> applied

#### Iteration 7 (opus)
- [WARNING] no test that a token plus the screen header cannot clear or take over the person's built mark --> FIXED (server.task-built-3951.test.js, control: screen alone clears)
- NIT: one project-list read --> applied

#### Iteration 8 (sonnet)
- [WARNING] message failed open on an unnamed card --> FIXED (fails closed, as built)
- [WARNING] a second read after the record could 400 a recorded message --> FIXED (single read reused)

#### Iteration 9 (opus)
- [WARNING] %N self-exclusion untested --> FIXED; [WARNING] stale token with good pane untested --> FIXED
- NITs: Array.isArray guard, null-safe reads, unissued token on a pattern route --> applied

#### Iteration 10 (sonnet)
- [WARNING] no pin that the network-peer guard never reads the agent-token routes --> FIXED (static pin, control: guard admitting them goes red)
- [WARNING] valve-order test depended on test order --> FIXED (spends the cap itself)
- [WARNING] person's messages withheld from departed assignees --> DEFERRED (the decision covers every sender; stated in the plan)

#### Iteration 11 (opus)
- [WARNING] unreadable list at the record step answered 400 --> FIXED (503)
- [WARNING] a comment described an unreachable fail-open path --> FIXED
- [WARNING] #4540 opened by this slice --> recorded on #4540 (later rescoped)

#### Iteration 12 (sonnet)
- [WARNING] two comments I wrote claimed more than the code backs --> FIXED by deleting them (not rewriting)
- [WARNING] one shared caller-resolution helper for both handlers --> DEFERRED (built's CLI sends only %N; giving it the target arm changes behaviour for no caller; stated in the plan)

#### Iteration 13 (opus)
**New findings:** 0 BLOCKERs, 0 NEW WARNINGs (the valve cost again, accepted), 0 CONVENTIONs, 4 NITs
- Reviewer measured the departed filter and isNamedOurs requirement red when removed. 89 tests pass across the eight relevant files; merge-tree clean.
**Converged.**

### Final Ledger
Commits oldest first (findings by iteration above):
68dcb4096 slice 3 · b725775d6 early review · 502df3c12 i1 · 906d12406 i2 · ca55bc458 i3 · 61cefd0b6 i4 · dabab8c1b i5 · ba6149eda i6 · 198e57874 i7 · 1bb4653b1 i8 · 06e2e5dbc i8 test armed · d6426ddb5 i9 · 890dc282f i10 · ba99fd886 i11 · 75ac4ec58 i12 · 5844c66af plan correction

| Deferred | Reason |
|---|---|
| Membership before the valve costs a roster read (and a tmux lookup for %N) per valved request | accepted in the plan: a non-member hears why, not the breaker; task built already works this way |
| Mac `task message` now refuses a stale token instead of the pane | by design (a bad credential is never swapped for a weaker one); the supervisor re-mints per launch; stated |
| The person's messages to a departed assignee are not delivered | same decision for every sender; the person can message the agent directly; stated |
| Paneless names match by safeKey (lossy) | the token store is keyed the same way; stated |
| No shared caller-resolution helper | built's CLI sends only %N; stated |

### Validation
- Final on 5844c66af (rebased on main): PASSED, hash f167a63959e7, 11914 node tests / 0 fail, shell suites clean, subdir audit clean.

### NITs (non-blocking)
- source-text pins instead of behavioural pattern tests; duplicated token-shape case in install/kosmos; project-existence oracle (403 vs 404) as in task built; the CLIs' "were notified" sentence (fixed separately in #4540)

### Strengths
- The gate stays narrow: one anchored pattern, pinned exactly, still requiring a valid header token; the network-peer guard is pinned not to read it
- A token holder can never pass as the screen (tested on the person's built mark), a bad token never falls back to the pane, membership comes before anything is recorded
- Every refusal test has a control that can return the dangerous answer
