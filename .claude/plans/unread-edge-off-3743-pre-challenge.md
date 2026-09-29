---
pre_challenge: true
method: challenge-loop
branch: unread-edge-off-3743
diff_hash: ea9748d0877ddb8641653a8390aca2b7864eacfff02d5f8f9e023b48cdae4b02
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T00:29:59Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 9 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 7 NITs)
**Fixed:** 2 WARNINGs, 2 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: the 6.0 run and the run after iteration 1 both passed (the latter is this head: 11298 pass, 0 fail;
its hash is this proof's diff_hash). Measured before any change: on origin/main the check failed 11 arms and
then threw on U11. After: 72/72 PASS on chromium and webkit with the switch off; with the switch on (probe) the
original arms all pass; with the page marking while switched off (probe) the off arms fail.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (ITER_COMMITS was empty)
- [WARNING] render-unread-edge-3743.js edgeChk: the off branch only re-read the DOM, missing U8/U12/U13's arrival moment --> FIXED (offOk: each passes its own arrival snapshot)
- [WARNING] render-unread-edge-3743.js: U2's off arm could never fail (the cleanup removed every marker) --> FIXED (removes only U17's hand-set marker, after asserting it is the only one)
- [NIT] why a missing switch reads as on --> FIXED (comment); [NIT] U15h's control only means something while on --> FIXED (comment)
- [NIT] several off arms re-read the state of the arm before them --> left (harmless, can still fail); [NIT] the tally overstates off coverage --> left (same)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.
- [NIT] duplicate re-reads (as above); [NIT] EDGE_ON's strict === true also does double duty (a truthy non-true switch fails loudly, not silently)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | docs/browser-checks/render-unread-edge-3743.js edgeChk | BRANCH | off branch missed the arrival moment | FIXED | iteration 1 |
| 2 | 1 | WARNING | docs/browser-checks/render-unread-edge-3743.js U2 | BRANCH | U2 off arm could never fail | FIXED | iteration 1 |

### NITs (non-blocking, across all iterations)
- Left: repeated off re-reads (harmless, still able to fail); EDGE_ON's strictness (fails loudly on an odd value).

### Strengths (across all iterations)
- The switched-on branch is the original assertions verbatim, verified by running with the switch on (1, 2)
- Every off check requires bubbles to have been found, and the leak probe turns them red in both engines (1, 2)
- Wiring complete: gated.txt sorted, NOT_WIRED entry removed, README row accurate (1, 2)
