---
pre_challenge: true
method: challenge-loop
branch: casefold-5424
diff_hash: e37b13bceb1b1810fb424916ffd34673d3ab91c96526b7d12d827857f9c7c63a
validation: passed (Mortals full suite at 55d49f318, hash e37b13bceb1b, EXIT=0 21:36)
subdir_audit: passed
timestamp: 2026-10-07T02:41:31Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (4 before the rebase onto #4919, 1 after it)
**Converged:** Yes (iterations 4 and 5 returned NITs only)
**Total findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 11 NITs
**Fixed:** 3 | **Deferred:** 1 | **Asked (awaiting user):** 0

Local evidence at 6ea874514: engine/projects.test.js 161/161 and server.projects.test.js 178/178 on this Mac.
On a case-sensitive APFS image (TMPDIR on it): the engine and route case tests fail against main's engine and
pass with the fix. The stubbed-fs test fails against main's engine on this Mac's own disk. Linux: the engine
case test passed on the #4919 lane (run 37533354548), where the card's run 37531000100 had it red.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [BLOCKER] server.projects.test.js:1829 - the route twin of the case test still assumed a case-insensitive disk --> FIXED (4fddcbcc4)
- [WARNING] engine/projects.test.js:1741 - neither test can fail on a Mac --> FIXED in iteration 3 (stubbed-fs test)
- [NIT] trueChildName and preview docstrings, test comment, makeFolder comment --> FIXED (4fddcbcc4)
- [NIT] NFD/NFC names keep the typed spelling (pre-existing; preview and act still agree) --> recorded in the plan

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/projects.test.js:1819,1851,1862 - three tests assume a case-insensitive disk by their own names --> DEFERRED: the #4919 Linux lane already skips them off case-insensitive disks; a second skip here would collide with it (plan names the weakest premise)
- [NIT] docstring wrap --> FIXED (945b7fee4)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 3 NITs
**Self-generated:** 1 of the above (the makeFolder comment)
- [WARNING] engine/projects.test.js - no guard on a Mac if #4919 stalls --> FIXED (6ea874514: stubbed-fs test)
- [CONVENTION] server.js:16727 - comment said the preview only lists --> FIXED (6ea874514)
- [NIT] makeFolder comment and the exact-entry shortcut --> FIXED (6ea874514)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.

#### Iteration 5 (after rebasing onto main, which had merged #4919)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- The rebase kept this branch's engine case test over #4919's version, removed the route test's skip (now right on
  either disk) and its unused probe. Verified on a case-sensitive APFS image: engine, route and stubbed-fs case tests
  all ran and passed. Rebase review found nothing dropped or duplicated.
**Converged** - no new actionable findings.

### NITs (non-blocking, open)
- [NIT] engine/projects.test.js:1746 - the stubbed-fs test depends on the exact fs calls and paths; a refactor fails it loudly, never vacuously (iteration 4)
- [NIT] plan claims about the Linux lane are checkable only on the card and the runs (iteration 4)
- [NIT] plan: the rebase time is given to the minute range, not a sha (iteration 5)
- [NIT] engine/projects.js: a typed name whose stat is denied keeps the typed spelling; preview and act still agree (iteration 5)

### Strengths
- Small fix: one function, and the preview and the act go through it, so they cannot disagree
- Reproduced on a real case-sensitive disk image before and after
