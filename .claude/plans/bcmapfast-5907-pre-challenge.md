---
pre_challenge: true
method: challenge-loop
branch: bcmapfast-5907
diff_hash: 9738b3facedf410fb023de64f0470eeb2b4d93a8cd9ff3420aaed0a4c288fe0b
validation: passed
subdir_audit: passed
timestamp: 2026-10-13T13:51:49Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (5 in the session that built the branch, 2 after it was rebased onto main)
**Converged:** Yes (iteration 7: no new BLOCKER, WARNING or CONVENTION)
**Total findings this session (iterations 6 and 7):** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 7 NITs
**Fixed:** 1 NIT | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: full suite through tools/queued-heavy.sh at head 0dde6f49 (QUEUE_DONE rc=0 08:51 CDT): node 19,869 tests,
0 fail; shell 232 of 232 passed; no leak; `validation PASSED ... hash=9738b3facedf`, equal to this proof's hash.

Iterations 1 to 5 ran in the session that built the branch (handoff renettilley-night-1909), when it was stacked on
bcsgfast-5907: covering on the gate's one-pass scan, with the original per-token path kept for SLOW checks and for any
scan failure. Old vs new on 74 queries from frozen copies: identical; a reviewer's own 252-case comparison: identical;
covering about 9 s to 1 s. Their per-iteration detail is in that session.

After bcsgfast-5907 merged (#6028) the branch was rebased with `--onto origin/main` (its own six commits only). Every
file it changes was byte-identical before and after; tools/test-bc-surface-map.sh and
tools/test-browser-check-surface-gate.sh pass on the new base.

### Per-Iteration Breakdown (this session)

#### Iteration 6 (after the rebase)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not computed (the loop's commit list from earlier iterations was not carried across the restart)
- [NIT] .claude/plans/bcmapfast-5907.md said "stacked on bcsgfast-5907", stale after #6028 --> FIXED (0dde6f49)
- [NIT] tools/bc-surface-map.sh header still says "COPIED identical from the gate" (predates this branch)
- [NIT] the SLOW arm cannot tell a SLOW verdict from a fallback (same output either way)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** not computed
- [NIT] the fallback comparison arm uses two inputs; the lib's own SCAN arm covers the MISS branch
- [NIT] `[ -n "$toks" ] && ...` leaves status 1 in a loop body (harmless without set -e)
- [NIT] the plan's 7 s is an idle-machine figure (12.7 s under load)
- [NIT] the header's "COPIED identical" line
**Converged** - no new actionable findings.

### Final Ledger (this session)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 6 | NIT | .claude/plans/bcmapfast-5907.md | BRANCH | stale "stacked on" line | FIXED | 0dde6f49 |

### Strengths (this session)
- HIT and MISS come only from plain tokens, matched exactly as bc_surface_token_hits does; every undecidable case goes to the unchanged per-token `_bcm_covers` (6, 7).
- The fallback arm proves the scan really failed under a bad TMPDIR and that the probe works under the normal one (6, 7).
- An awk shim reds the test if covering stops calling the scan (6, 7).
