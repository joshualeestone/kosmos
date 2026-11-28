---
pre_challenge: true
method: challenge-loop
branch: heavycaller-9217
diff_hash: 1e8b7eb022c01be606e223a4185941501ed819b6c522f7d3363ebd86e33aa223
validation: passed
subdir_audit: passed
timestamp: 2026-11-28T01:47:06Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped after iteration 8 by Splinter's standing usage rule (Fleet Builders m510, 2026-10-26: past 8
rounds, WARNINGs go to a follow-up card). No BLOCKER was open. Round 8's WARNINGs are kosmos#9246.
**Total findings:** 19 actionable (0 BLOCKERs, 15 WARNINGs, 4 CONVENTIONs) and 32 NITs, plus one round-8 WARNING that was the reviewer s own conclusion that the detach is correct (not a defect, not in the ledger)
**Fixed:** 16 | **Deferred:** 3 (2 to kosmos#9246, 1 not a defect) | **Asked:** 0

Every fixed code finding has an arm in tools/test-queued-heavy-4977.sh that was mutated to red in a queued harness run
(except the off-switch arm, reasoned only). Shas below are the loop's own commits before the final rebase.

**Closing validation (6j).** Full validation of f4bbe83953 passed: 31862 node tests, 0 failures, rc 0, audit rc 0,
clean tree. Main had moved on, touching none of this branch's files.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/queued-heavy.sh:1037 - the call ran in the foreground, up to ~35 s with the box claimed --> FIXED (03ed494783, detached)
- [WARNING] tools/queued-heavy.sh:1036 - silent when no kosmos is on PATH --> FIXED (03ed494783, one line)
- [WARNING] tools/test-queued-heavy-4977.sh:1074 - no arm for best-effort, QH_RUNS_BC or a beside run --> FIXED (03ed494783)
- [NIT] five FIXED, one DEFERRED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] tools/test-queued-heavy-4977.sh:1073 - no arm proved the call is detached --> FIXED (0731e06012)
- [WARNING] tools/queued-heavy.sh:1039 - "asked" printed for a certain refusal --> FIXED (0731e06012, dash skipped)
- [NIT] one FIXED, three DEFERRED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 2 of the above
- [WARNING] tools/queued-heavy.sh:1044 - the label put the run's name back into argv (#5467) --> FIXED (f44213d453)
- [WARNING] tools/test-queued-heavy-4977.sh:1097 - the detach arm's margin was ~1 s --> FIXED (f44213d453)
- [CONVENTION] tools/test-queued-heavy-4977.sh:96 - a bare sleep (#6710) --> FIXED (f44213d453)
- [NIT] four FIXED, one DEFERRED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] tools/queued-heavy.sh:1042 - a test run on its own (not through run-tests.sh) could announce --> FIXED (f765f5072e, default off under private markers)
- [CONVENTION] plan exists and matches --> DEFERRED: not a defect
- [NIT] two FIXED, three DEFERRED

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] tools/test-queued-heavy-4977.sh:1082 - the opt-out arm passed by the default; the fleet default untested --> FIXED (a96b0cff28)
- [WARNING] tools/queued-heavy.sh:1055 - "asked" with no agent token or pane --> FIXED (a96b0cff28)
- [NIT] two FIXED, two DEFERRED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] tools/queued-heavy.sh:1057 - bare script names (run-tests) still in argv --> FIXED (903c2da317)
- [NIT] one FIXED, three DEFERRED

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 CONVENTIONs, 5 NITs
**Self-generated:** 2 of the above
- [WARNING] tools/test-queued-heavy-4977.sh:86 - the loosened shim had no refusing control --> FIXED (71ee2b104e)
- [WARNING] tools/test-queued-heavy-4977.sh:1103 - a stand-in left a 30 s process --> FIXED (71ee2b104e)
- [CONVENTION] plan line contradicted the code --> FIXED (71ee2b104e)
- [CONVENTION] the file header named one accepted case --> FIXED (71ee2b104e)
- [NIT] four FIXED, one DEFERRED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/queued-heavy.sh:1043 - explicitly set real markers stay silent --> DEFERRED to kosmos#9246
- [WARNING] tools/queued-heavy.sh:1054 - a refused label still reads as asked --> DEFERRED to kosmos#9246
- [WARNING] tools/queued-heavy.sh:1066 - the detach reasoned correct --> not a defect (the reviewer's own conclusion)
**Stopped** - the usage rule's cap, with no BLOCKER open.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/queued-heavy.sh:1037 | BRANCH | foreground call | FIXED | 03ed494783 |
| 2 | 1 | WARNING | tools/queued-heavy.sh:1036 | BRANCH | silent without kosmos | FIXED | 03ed494783 |
| 3 | 1 | WARNING | tools/test-queued-heavy-4977.sh:1074 | BRANCH | arm gaps | FIXED | 03ed494783 |
| 4 | 2 | WARNING | tools/test-queued-heavy-4977.sh:1073 | SELF | detach unproven | FIXED | 0731e06012 |
| 5 | 2 | WARNING | tools/queued-heavy.sh:1039 | SELF | asked though refused | FIXED | 0731e06012 |
| 6 | 3 | WARNING | tools/queued-heavy.sh:1044 | SELF | label in argv (#5467) | FIXED | f44213d453 |
| 7 | 3 | WARNING | tools/test-queued-heavy-4977.sh:1097 | SELF | thin margin | FIXED | f44213d453 |
| 8 | 3 | CONVENTION | tools/test-queued-heavy-4977.sh:96 | SELF | bare sleep | FIXED | f44213d453 |
| 9 | 4 | WARNING | tools/queued-heavy.sh:1042 | SELF | direct test runs announce | FIXED | f765f5072e |
| 10 | 4 | CONVENTION | .claude/plans | BRANCH | plan exists | DEFERRED | not a defect |
| 11 | 5 | WARNING | tools/test-queued-heavy-4977.sh:1082 | SELF | opt-out masked; default untested | FIXED | a96b0cff28 |
| 12 | 5 | WARNING | tools/queued-heavy.sh:1055 | SELF | no agent named | FIXED | a96b0cff28 |
| 13 | 6 | WARNING | tools/queued-heavy.sh:1057 | SELF | bare stems in argv | FIXED | 903c2da317 |
| 14 | 7 | WARNING | tools/test-queued-heavy-4977.sh:86 | SELF | shim control missing | FIXED | 71ee2b104e |
| 15 | 7 | WARNING | tools/test-queued-heavy-4977.sh:1103 | SELF | process left behind | FIXED | 71ee2b104e |
| 16 | 7 | CONVENTION | .claude/plans/heavycaller-9217.md | SELF | plan contradicted code | FIXED | 71ee2b104e |
| 17 | 7 | CONVENTION | tools/test-queued-heavy-4977.sh:4 | SELF | stale header | FIXED | 71ee2b104e |
| 18 | 8 | WARNING | tools/queued-heavy.sh:1043 | SELF | explicit markers silent | DEFERRED | kosmos#9246 |
| 19 | 8 | WARNING | tools/queued-heavy.sh:1054 | SELF | refused label reads asked | DEFERRED | kosmos#9246 |

Origin is the round's own reading of which loop commit wrote the cited code; it was not run through the blame lookup.

### NITs (non-blocking, across all iterations)
- 32 NITs: many FIXED in their round's commit, the rest DEFERRED with reasons in each round's commit message.

### Strengths (across all iterations)
- Tied to --pid $$: the board's line clears itself on any exit, with no end call added to _qh_end.
- Detached, best-effort, and silent toward the run: a slow or failing board never holds or changes it.
- Off for every test two ways (private markers; run-tests.sh's 0), with a stand-in kosmos first on PATH.
