---
pre_challenge: true
method: challenge-loop
branch: installgate-nshome-sandbox
diff_hash: 54c75fec2a8f2ab50a8f37e21b3c1fe44e9efc4187afe8a46dc1dca91efb2e67
validation: passed
subdir_audit: passed
timestamp: 2026-09-10T17:59:44Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 2 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT)
**Fixed:** 1 | **Deferred:** 1 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above (first reviewer pass; no loop fix commit existed yet when it reviewed)
- [WARNING] .claude/plans/installgate-nshome-sandbox.md:56 — Verification section left the on-mortals
  result as an unfilled placeholder (`[to be filled from the on-box gate run]`); box-dependence is the
  whole premise so the on-box result is load-bearing evidence --> FIXED (commit a994a054): filled with
  the actual result (all five launcher-arm checks pass on mortals).
- [NIT] tools/test-install.sh:566 — comment "activates-and-exits the moment otherRunningInstance()
  finds any process" is accurate for the no-handoff case but a reader could miss that the handoff flag
  is the other half of the decision --> DEFERRED: the comment's very next sentences explain that
  KOSMOS_RELAUNCH_HANDOFF makes shouldDeferToExistingInstance() return false, so the handoff's role is
  already stated; no correctness impact.

#### Iteration 2
**Reviewer model:** sonnet (different model from iteration 1, per 6a rotation)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0
**Converged** — no new actionable findings. The sonnet pass independently re-verified the mechanism
against native-app/main.swift and additionally confirmed no cross-contamination with a real production
#2094 relaunch token (the token path is derived from AGENT_WORKFORCE_DATA, which the harness exports to
$SB/data, so consumeFreshRelaunchHandoff's unconditional token delete stays inside the sandbox).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | .claude/plans/installgate-nshome-sandbox.md:56 | BRANCH | Verification placeholder unfilled | FIXED | a994a054 |
| 2 | 1 | NIT | tools/test-install.sh:566 | BRANCH | comment could note the handoff is the other half of the decision | DEFERRED | comment explains the handoff in the following sentences |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] tools/test-install.sh:566 — comment phrasing (iteration 1); deferred with reasoning above.

### Strengths (across all iterations)
- Mechanism verified against source in both passes: KOSMOS_RELAUNCH_HANDOFF makes
  shouldDeferToExistingInstance() return false, upstream of the uid-compare/refuse/own-copy resolution,
  so bypassing dedup does not alter what any of the three arms assert (iterations 1 and 2).
- Genuine no-op on a clean box, proven by construction: with no other instance, otherRunning is false so
  the defer decision is false with or without the flag (iterations 1 and 2).
- The "all three launcher arms" claim is complete and correctly scoped; the only three sites that run the
  AppKit binary through applicationDidFinishLaunching now carry the flag; the port-selftest hatch exits
  before NSApp.run (iterations 1 and 2).
- The relaunch-handoff token path is sandbox-scoped, so it cannot race a real production #2094 token on a
  live box like mortals (iteration 2).
- Plan retracts an earlier wrong diagnosis (the NSHomeDirectory/KOSMOS_APP_TEST_HOME seam) with the reason
  it was wrong; all cited line numbers check out; no em dashes in the diff (iteration 1).
