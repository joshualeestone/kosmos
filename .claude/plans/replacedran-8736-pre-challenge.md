---
pre_challenge: true
method: challenge-loop
branch: replacedran-8736
diff_hash: 7c6f5e8b0e14fda30bc4410dcede2d7b9f455fe4122f24e5554669a001f420d0
validation: focused, from the repo root on the rebased head: 41 test files that touch closedUnrun, replacedBy, unrun, subtask counts or never-run (kosmos#8734's included), 975 pass, 0 fail, plus engine.reachable, windows-tests-1777 and fixture-discipline; GitHub CI is the full gate on this PR
subdir_audit: passed
timestamp: 2026-11-19T19:15:50Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (round 4 raised no BLOCKER, WARNING or CONVENTION)
**Fixed:** every WARNING of rounds 1 and 3 | **Deferred:** the NITs listed below | **Asked:** 0

Record kept during the run in ~/.cache/claude-handoffs/angel-8724-review-ledgers-20261119.md. Rounds 1 and 2 ran on
main before kosmos#8734 (PR #8749) merged; after it merged the branch was rebased, its --not-run refusal switched to call
ranOnRecord (agreed with its author), and rounds 3 and 4 reviewed the whole result.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] engine/tasks.js: a later replace erased an explicit --not-run over a ran record --> FIXED (a replace never takes back a not-run mark)
- [WARNING] engine/tasks.replacedran-8736.test.js: a test title promised an untested case --> FIXED (split; both tested)
- [NIT] a run recorded through the real API, a re-replace test, the closedHow (#8552) caveat in the comment --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs.
- [NIT] a comment naming kosmos#8734's refusal before it was in the tree --> FIXED (comment only); [NIT] comment placement, landedCommit wording --> recorded

#### Iteration 3
**Reviewer model:** opus (after the rebase onto kosmos#8734 and the switch to ranOnRecord)
- [WARNING] engine/tasks.js: the subtask count's comment still said replaced children count as unrun --> FIXED (names closedUnrunOf)
- [NIT] the kept-not-run comment, ranOnRecord computed once, a combined count test --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs. **Converged.** The --not-run refusal confirmed unchanged against origin/main.
- [NIT] plan test count --> FIXED (prose); [NIT] comment placement; ranAny reads t, not changed (correct, documented) --> recorded

### Strengths
- [STRENGTH] One "it ran" test (ranOnRecord) serves both the --not-run refusal and the replaced path.
- [STRENGTH] Legacy replaced tasks with no field keep counting unrun; every other reader tests closedUnrun === true.
