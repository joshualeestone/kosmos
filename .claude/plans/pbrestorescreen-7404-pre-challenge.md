---
pre_challenge: true
method: challenge-loop
branch: pbrestorescreen-7404
diff_hash: 673b8173778e807e943bced7d66c16f0a012522abb989d2f02a0dd85beac935e
validation: failed (one test that fails on main too and passed alone 24/24; see below)
subdir_audit: passed
timestamp: 2026-11-02T21:43:59Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at the 8-round cap, Splinter's review rule of 2026-10-22: past 8 with no BLOCKER open,
the remaining WARNINGs go to a follow-up card; the user did not ask for this stop, the standing rule did)
**Total findings:** 1 BLOCKER, 26 WARNINGs, several CONVENTIONs and NITs across 8 rounds
**Fixed:** all but the round-8 WARNINGs | **Deferred:** 3 | **Follow-up card:** #7801 (round 8's two WARNINGs)

**Final validation (6j), stated as it happened:** the first full run failed 2 tests: a CSS rule naming `--border`,
which the page defines nowhere (mine; fixed in 05df74a66e with `--separator`), and tools.shell-shard-4317 ("run-tests.sh
hands its platform to shell-shard.js"). The rerun on the fixed tree: 26435 tests, 26027 pass, 1 fail, 407 skipped; the
one failure is that shell-shard test again. It fails on main's checkout too (measured in a worktree of origin/main the
same afternoon), its message is the leak guard finding things a run left on this machine, and it passed alone 24/24 at
15:36. This branch touches no tools/ file. PR CI runs the suite again.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 8 WARNINGs, 1 CONVENTION, several NITs
**Self-generated:** 0 of the above
- [WARNING] a Stop before the copy exists: the stopped end claimed a copy --> FIXED (ae3c7770db), wording conditional (Mona Lisa then reworded it)
- [WARNING] keyMissing never shown, "no backups yet" false --> FIXED (ae3c7770db)
- [WARNING] four focus losses (Cancel, See, Restore, Stop) --> FIXED (ae3c7770db)
- [WARNING] Cancel live while a start was in flight --> FIXED (ae3c7770db)
- [WARNING] a second Stop --> FIXED (ae3c7770db)
- [WARNING] Off kept the old list and names --> FIXED (ae3c7770db)
- [WARNING] no paint test --> FIXED (ae3c7770db): a stand-in document test of each state

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs
**Self-generated:** 1 (the plan's own claim about worldsFetch)
- [WARNING] focus lost when a restore ends --> FIXED (5e744faab0)
- [WARNING] late answers after Off wrote state back --> FIXED (5e744faab0): a generation counter
- [WARNING] a Stop confirm carried to the next restore --> FIXED (5e744faab0)
- [WARNING] the plan said worldsFetch was not awaited --> FIXED (5e744faab0): claim replaced
- [WARNING] no handler tests --> FIXED (5e744faab0)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs
**Self-generated:** 1 (the body-counts-as-inside focus rule from 5e744faab0)
- [WARNING] the running line named another tab's restore --> FIXED (2b30fc10b4)
- [WARNING] no sign after an accepted Stop --> FIXED (2b30fc10b4): "Stopping the restore."
- [WARNING] Stop and Open untested --> FIXED (2b30fc10b4)
- [WARNING] focus moved from elsewhere on the page --> FIXED (2b30fc10b4)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs
- [WARNING] a list with no actionable row hid See --> FIXED (473918e3a6)
- [WARNING] the list is never refreshed while up --> DEFERRED: a start on a backup gone since says so in the engine's sentence; the list is put away after a restore this tab saw end (in the plan)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 3 CONVENTIONs
- [BLOCKER] the three requests threw away a remote session's step-up instruction ("Try again" that cannot work) --> FIXED (c1ae631bb2): through pbPost; the test reds on the old page
- [WARNING] the turned-off stop read by matching engine English --> FIXED (c1ae631bb2): the test reads the engine's sentence from its source
- [WARNING] refusal paths untested --> FIXED (c1ae631bb2)
- [WARNING] a confirm survived someone else's restore ending --> FIXED (c1ae631bb2)
- [CONVENTION] three hand-rolled fetches beside pbPost --> FIXED (c1ae631bb2)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs
**Self-generated:** 1 (the Off reset rule from ae3c7770db)
- [WARNING] a hidden panel kept the state --> FIXED (517b5a1e63)
- [WARNING] other views wiped a running restore's state --> FIXED (517b5a1e63)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs
**Self-generated:** 1 (the focus test written in 2b30fc10b4)
- [WARNING] a slow read was thrown away by the next repaint --> FIXED (b80daf4e59)
- [WARNING] the live end line rewritten every repaint --> FIXED (b80daf4e59)
- [WARNING] the focus-elsewhere test could not fail --> FIXED (b80daf4e59)
- [WARNING] a refused start left focus on a hidden confirm --> FIXED (b80daf4e59)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, NITs
- [WARNING] a refusal line outlives its state --> follow-up #7801
- [WARNING] the end line may not be announced when it appears filled --> follow-up #7801
**Stopped at the cap** with no BLOCKER open.

### Final Ledger (WARNINGs and above)

| # | Iter | Category | Origin | Description | Status | Resolution |
|---|------|----------|--------|-------------|--------|------------|
| 1 | 5 | BLOCKER | BRANCH | step-up instruction thrown away | FIXED | c1ae631bb2 |
| 2 | 4 | WARNING | BRANCH | list not refreshed while up | DEFERRED | engine refusal covers it |
| 3 | 8 | WARNING | BRANCH | stale refusal line | FOLLOW-UP | #7801 |
| 4 | 8 | WARNING | BRANCH | live region appears filled | FOLLOW-UP | #7801 |
| 5 | 6j | BLOCKER | BRANCH | undefined --border | FIXED | 05df74a66e |
| 6 | 6j | BLOCKER | BRANCH | shell-shard leak-guard test | DEFERRED | fails on main too; passes alone |
| - | 1-7 | WARNING | mixed | 24 more, listed per iteration above | FIXED | per iteration |

### NITs (non-blocking)
- an empty copy after a failed hide, and no count for a failed partial restore (iteration 7)
- aria-describedby on the inline confirms, shared with the existing Turn off confirm (iteration 3)

### Strengths
- Engine text reaches the page only through textContent; a remote session gets counts, never names (iterations 1-8)
- Design approved by Mona Lisa (two reviews and two word passes); 20 design shots in ~/work/design-shots/kosmos-7404/
- 30 tests that lift the page's real functions; each guard added in a round was shown red by a mutant
