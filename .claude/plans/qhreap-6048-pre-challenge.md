---
pre_challenge: true
method: challenge-loop
branch: qhreap-6048
diff_hash: a998e7d4b350cabcaaceb34fc10082fb86dbe3c95a4d06f226cc9667872e4d60
validation: focused only (tools/test-queued-heavy-4977.sh, the file this changes, run whole on HEAD 2879daf56: PASS; full suite not run locally, the shared machine queue was 10 deep; CI runs it)
subdir_audit: passed
timestamp: 2026-10-13T15:05:33Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 9 NITs
**Fixed:** 3 WARNINGs, 4 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

**Validation, stated exactly.** This change touches one test file. That file ran whole on each fix commit, on this Mac's /bin/bash 3.2: PASS on HEAD 2879daf56 (the #5331 arm "teardown 0 s of 30"). It ran again with `_qh_stop_capper`'s KILL-by-pid removed from tools/queued-heavy.sh: the main arm is BAD ("teardown 16 s of 30", caught by "did not stop"), then restored. The full suite did not run locally; CI runs it.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above (ITER_COMMITS was empty)
- [WARNING] tools/test-queued-heavy-4977.sh:294 - "bounded at about 10 s" ignores a second capper loop from the test's TERM --> FIXED (3fb443fcd), then softened again in iteration 2
- [WARNING] test comment + plan - "a loaded CI runner" stated as the cause; a missed KILL fits the log as well --> FIXED (3fb443fcd): the cause is "not established", both named, the card stays open
- [NIT] the "of 30" figure hard-coded apart from the bound --> FIXED (3fb443fcd): B5331, shown as $((B5331 / 4))
- [NIT] a timed-out run labelled "teardown" --> FIXED (3fb443fcd): "not done after"
- [CONVENTION] plan present; its "about 10 s" claim wrong --> FIXED with the first warning

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the "twice" wording, written in iteration 1)
- [WARNING] plan - the 15 s measurement supports the diagnosis only weakly --> already stated as not established; wording tightened (2879daf56)
- [NIT] "twice if the TERM lands" describes the mechanism more precisely than it was measured --> FIXED (2879daf56): "longer if this test's TERM lands mid-teardown; the exact path was not measured"
- [NIT] a never-started run labelled "teardown ? s" --> FIXED (2879daf56): "no teardown, bound"
- [NIT] a 29 s release now passes silently except for its printed time --> kept: intended and disclosed

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [NIT] "of 30" counts polls; a slow runner's 120 polls can take over 30 s, so a pass could print "38 s of 30" (left: the pass condition is unaffected)
- [NIT] "no teardown, bound ? s" reads awkwardly (left: cosmetic, the run is BAD with "got 2" anyway)
- [NIT] plan's "exactly 15 s" claims more than whole-second clocks give (left: about 15 s)
- [NIT] the missed-KILL margin under 30 s is about 10 s, not 15 (left: accurate as worded, marked unmeasured)
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/test-queued-heavy-4977.sh:294 | BRANCH | teardown bound understated | FIXED | 3fb443fcd, 2879daf56 |
| 2 | 1 | WARNING | tools/test-queued-heavy-4977.sh:293 | BRANCH | cause stated as fact | FIXED | 3fb443fcd |
| 3 | 1 | CONVENTION | .claude/plans/qhreap-6048.md | BRANCH | plan's 10 s claim | FIXED | 3fb443fcd |
| 4 | 2 | WARNING | .claude/plans/qhreap-6048.md | SELF | weak support for diagnosis | FIXED | 2879daf56 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- hard-coded 30 (iteration 1, fixed); timed-out label (iteration 1, fixed); "twice" (iteration 2, fixed); never-started label (iteration 2, fixed); 29 s passes (iteration 2, kept); polls vs seconds, "bound ? s", "exactly", margin (iteration 3, left)

### Strengths (across all iterations)
- The main arm still fails on a missed KILL by its "did not stop" check, not by the clock (iterations 1, 2, 3)
- The control keeps its 15 s bound and still discriminates (iterations 1, 2, 3)
- The plan says the cause is not established and keeps the card open (iterations 2, 3)
