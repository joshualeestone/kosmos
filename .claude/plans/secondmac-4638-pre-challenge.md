---
pre_challenge: true
method: challenge-loop
branch: secondmac-4638
diff_hash: c634ef4058518d1e7133bcc254be1dc898b3cee568a1f1899b911c0e47bde783
validation: passed (full tools/run-tests.sh on Mortals at 6531829dc, 12,223 tests, 0 fail; recorded clean for this hash)
subdir_audit: passed
timestamp: 2026-09-30T01:49:18Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, then sonnet; each a separately spawned reviewer). **Converged:** yes, round 2 found nothing above NIT.
**Post-convergence changes (covered by the validation above):** origin/main merged in (37 commits), and the pinned count in browser-checks-reason-grep.test.js moved 208 -> 209 for this branch's new check's one emit site (found by Renet Tilley; measured: origin/main alone passes at 208).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] a reinstalled computer (its old record live, so it looks like a second computer) had its "already in use by a Mac on this account" refusal swallowed and was registered again as name-2, with an Allow card nobody could answer --> FIXED: a computer whose own name is already one of the account's addresses takes the chooser path; only "taken" / "kept by Kosmos" are retried
- [WARNING] a reserved computer name (Admin, Support) dead-ended on an endless Try again --> FIXED: it moves on to name-2; after name-9 the last try is the private suggestion
- [NIT] with several other computers the landing named only the first --> FIXED: "one of your other computers"; the engine passes every label
- Tests: 5 new arms in render-plus-second-computer-4638 (reinstall, in-use, reserved, the run's end, several), each failing its own mutant

#### Iteration 2
**Reviewer model:** sonnet
- [NIT] two computers with the same default name take the chooser, not the skip (the round-1 reinstall guard cannot tell them apart) --> DEFERRED: stated in the plan
- [NIT] if the private suggestion after name-9 is itself taken (about 1 in 31^8), Try again resends it --> DEFERRED
**Converged.**

### Final Ledger
| # | Iter | Category | Origin | Description | Status | Resolution |
|---|------|----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | BRANCH | reinstall re-registered as name-2 | FIXED | own name on the account takes the chooser |
| 2 | 1 | WARNING | BRANCH | reserved name dead-ended | FIXED | moves on to name-2, private suggestion last |
| 3 | 2 | NIT | BRANCH | same default name takes the chooser | DEFERRED | stated consequence |
