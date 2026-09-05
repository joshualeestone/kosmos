---
pre_challenge: true
method: challenge-loop
branch: dock-copy-tighten-2240
diff_hash: d7eb010a4b64f3555f004379525bba8b383676f31257666085567e6cecbd31dd
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T21:31:18Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes
**Total findings:** 1 CONVENTION, 1 NIT, 4 STRENGTHs
**Fixed:** 1 CONVENTION | **Deferred:** 1 NIT (resolved) | **Asked:** 0

Validation: `tools/run-tests.sh` ran to completion with exit 0 (box free, no release cut). All dock guards
pass with the change: server.test.js (the `/Kosmos is already in your Dock, the strip of icons/` regex
~5448 + the fr-return-msg negatives) and docs/browser-checks/render-first-run.js (:515 presence, :519
negative). The #1720 web-gate is satisfied by the commit's `Browser-check:` trailer.

### Per-Iteration Breakdown

#### Iteration 1
**New:** 0 BLOCKER, 0 WARNING, 1 CONVENTION, 1 NIT --> CONVERGED after fixing the CONVENTION
- [CONVENTION] plan file had em dashes (title + a verification line) --> FIXED: replaced with a colon;
  grep confirms 0 em dashes remain (all five spellings). The no-em-dash rule covers all output, and the
  served-HTML em-dash gate does not scan plan files, which is why it slipped through.
- [NIT] plan listed the full run as "pending" --> RESOLVED: the run completed exit 0 and the plan now
  records that.

### Final Ledger
| # | Iter | Category | File:Line | Description | Status |
|---|------|----------|-----------|-------------|--------|
| 1 | 1 | CONVENTION | plan | em dashes in plan file | FIXED |

### Outstanding questions (ASKED)
None.

### Strengths
- The guarded substring "Kosmos is already in your Dock, the strip of icons" is preserved byte-for-byte,
  so server.test.js and render-first-run.js still match; the dropped "Keep it one click away" lead is not
  asserted anywhere (grep empty).
- The two-instances fix is intact: "already in your Dock" + "Drag its icon to the far left", never "onto
  the Dock", so a first-timer is steered away from a second instance.
- Dropping the redundant bold lead is a genuine tightening, not a loss; new line is em-dash-free and in
  Josh's plain voice; the #fr-return-keep id/structure unchanged.
- #1720 gate satisfied via the non-empty Browser-check trailer.
