---
pre_challenge: true
method: challenge-loop
branch: following-9017
diff_hash: 2d5df52e8f695df322cddcc54292504d886b27af1bbdebb93b4d8b57599d5180
validation: passed
subdir_audit: passed
timestamp: 2026-11-25T15:52:09Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at the round-8 cap, Splinter's standing usage rule: past round 8 only an open BLOCKER continues; the round-8 BLOCKER was fixed and verified, none open)
**Total findings:** 2 BLOCKERs (both fixed: the verbs-parity pin in review 1, engine.reachable's test seams in review 8), the rest per round below; full ledger in .claude/plans/following-9017.md
**Asked (awaiting user):** 0

### Validation
- Validation 1 (ended 00:55 CST 2026-11-25): 31071 of 31072; the one red, engine/windows-tests-1777, fixed (ALSO_ROOT).
- Validation 2 on head 94b0159a82: PASSED on this Mac, ended 05:30 CST 2026-11-25 (validation_rc 0, audit_rc 0, hash 2d5df52e8f69, base d04020bcfa). The diff is unchanged since (same hash at 2026-11-25T15:52:09Z); only this proof file was added. main has moved since that base: the PR's CI is the run against current main.

### Per-Iteration Breakdown
(Reviewer models were not kept in the ledger for this card.)

#### Iteration 1
- [BLOCKER] tools.windows-kosmos-cli-verbs-parity did not pin following FIXED; repeated cursor, duplicates, bad date, 429 tests ADDED; only a real null last_post_at is "no posts yet" FIXED; communityguide wording NIT kept (its own review)
#### Iteration 2
- the answer kept inside the CLIs' 30 s (time bound, room rule) FIXED; unshowable names FIXED
#### Iteration 3
- cut-list words true to where it stopped FIXED; a follow landing mid-read seen by the next read FIXED; empty stored name NIT kept
#### Iteration 4
- time-cut words, only-unshowable list, first-page-only second ask PINNED
#### Iteration 5
- which date field the community does not send, each on its own FIXED; the service's time form to the local day FIXED
#### Iteration 6
- mixed list says some are missing FIXED; fixed-zone date test (America/Chicago) ADDED
#### Iteration 7
- unshowable names counted FIXED; one case table through both CLIs ADDED
#### Iteration 8
- [BLOCKER] engine.reachable red on three new test seams FIXED (excused beside _setSuggestWaitMs and _setReadTotalMs, 8/8)
