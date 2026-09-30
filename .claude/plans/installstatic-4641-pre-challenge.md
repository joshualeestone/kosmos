---
pre_challenge: true
method: challenge-loop
branch: installstatic-4641
diff_hash: b29fb9125bbfb6316f36248b44351c912364f63ca7cc3cc154b07529657fd205
validation: passed (Mortals full run, clean at this hash, recorded 2026-09-30T07:11:32Z)
subdir_audit: passed
timestamp: 2026-09-30T07:33:31Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (a fresh loop: an earlier six-pass loop ran in a session that was restarted before its proof was written; its reports did not survive and are not reproduced here)
**Converged:** Yes
**Total findings:** 11 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 9 NITs)
**Fixed:** 2 WARNINGs and 3 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

Baseline (6.0): the runner (23/23) and its control passed after the rebase onto main (44fd03dfb). Final gate (6j): the Mortals
full run of this hash (the branch with main merged in at b1dbfcb92) recorded clean; runner 23/23 and control 8 arms pass.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (no loop commits yet)
- [WARNING] tools/test-install-static.sh:42-48 - the guard checked where each group is called but not test-install.sh's line that loads the checks library; moved after a group call or made conditional, the cut would break while this runner stayed green --> FIXED (commit b069f9cc3): exactly one column-0 load line, before the first group call; control arms for a late load and a missing load.
- [NIT] tools/test-install-static.sh:21 - one total count cannot see a check moved from a cut group into the open group --> TAKEN (b069f9cc3): per-group counts (port 14, update 3, board off 5, open 1), control arm moves a port check to open.
- [NIT] tools/lib/install-static-checks.sh:73 - order of lines in the cut log changes (intended, plan's Rejected section).
- [NIT] tools/lib/install-static-checks.sh:35 - a double blank line.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the WARNING: install_static_all became dead when b069f9cc3 made the runner count per group)
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] tools/lib/install-static-checks.sh:97 - install_static_all had no caller once the runner counted per group, so a fifth group added to the lib would run nowhere --> FIXED (commit 10fa059dd): function removed; the runner fails when the groups the lib defines differ from STATIC_GROUPS (control arm: an unlisted group fails); the plan's sentences about it rewritten to what the code does.
- [NIT] tools/test-install-static.sh:16 - comment wrap --> TAKEN (10fa059dd).
- [NIT] .claude/plans/installstatic-4641.md - still said "a count other than 23" --> FIXED with the WARNING.
- [NIT] tools/test-install-static.sh:44 - a column-0 call inside an if still counts as live (the plan's named weakest premise).

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.
- [NIT] tools/test-install-static.sh:62 - the group-call guard lists the four group names itself; a fifth group listed in STATIC_GROUPS but never called from test-install.sh would run on PRs and not at the cut (a follow-up; still more coverage than before this card).
- [NIT] .claude/plans/installstatic-4641.md:15 - "moved verbatim" (the checks read $SETUP, which is exactly $HERE/install/setup.sh in test-install.sh; one label reworded).
- [NIT] .claude/plans/installstatic-4641.md:26 - the Change section lists four control arms; there are eight (the iteration sections list the rest).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/test-install-static.sh:42 | BRANCH | lib load line unchecked | FIXED | b069f9cc3 |
| 2 | 2 | WARNING | tools/lib/install-static-checks.sh:97 | SELF | install_static_all dead, a new group could run nowhere | FIXED | 10fa059dd |

### NITs (non-blocking, across all iterations)
- [NIT] tools/lib/install-static-checks.sh:73 - cut-log line order changes, intended (iteration 1)
- [NIT] tools/lib/install-static-checks.sh:35 - double blank line (iteration 1)
- [NIT] tools/test-install-static.sh:44 - column-0 call inside an if counts as live, the named weakest premise (iteration 2)
- [NIT] tools/test-install-static.sh:62 - group names hardcoded in the call guard (iteration 3)
- [NIT] .claude/plans/installstatic-4641.md:15 and :26 - "moved verbatim"; four arms listed of eight (iteration 3)

### Strengths (across all iterations)
- The move is faithful: 23 chk calls left test-install.sh and the same 23 are in the lib; each group is called where its checks sat, three before the release-gate exit and the open one after it, as before (iterations 1 and 3).
- The runner is wired into the PR suite (package.json test:shell), so these checks now run on every PR, which is the gap behind the failed 0.7.11 cut (iterations 1 and 3).
- Every control arm confirms its break changed the file, then asserts the exact failure it targets (iterations 1 to 3).
