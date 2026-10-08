---
pre_challenge: true
method: challenge-loop
branch: reachable2-5548
diff_hash: 4ec1bd72df155e07a6003dade258bad671ddc3000ca535e5f1f1616177f9d067
validation: passed (validation_log PASSED for stack=typescript hash=4ec1bd72df15 on main after #5577, full tools/run-tests.sh; engine.reachable.test.js 7/7)
subdir_audit: passed
timestamp: 2026-10-08T15:47:58Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 blind reviews (sonnet, opus, sonnet). The full rounds are in .claude/plans/reachable2-5548.md. Between them the reviewers spot-checked every one of the triaged entries.

**Review 1 (sonnet): 2 WARNING + 1 NIT, fixed**
- [WARNING] three exports were excused as "used inside its own module", which was false: fixed, recategorised as #5346's test seams with accurate reasons.
- [WARNING] bin/ callers were matched on raw text, so a shell script's comment could hide an orphan: fixed. bin/ JS goes through codeOnly and shell scripts lose full-line comments; tested; mutation red.
- [NIT] labelFor cites "OPEN #4375": checked, #4375 is open.

**Review 2 (opus): 1 WARNING + 2 NIT, fixed**
- [WARNING] minInterval was excused as superseded, which was false in the dangerous direction: it is an unwired cost defence (#1645). Fixed: carded as #5583 (wire or delete) and removed from #5582, whose title and body are corrected.
- [NIT] the plan's test count, corrected. [NIT] a future non-JS, non-shell file in bin/ would be stripped as shell: recorded, no current case.

**Review 3 (sonnet): CONVERGED.** It spot-checked the 17 entries the first two rounds had not and found none hiding an unreachable capability. One wording NIT fixed.

**Mutations proven red:** bin/ removed from CALLER_FILES; one triaged entry removed; a fake entry for a called name (shrink-only).

**After convergence:** rebased onto main after #5577 merged. The test passes 7/7 on current main, and the full validation passed on the rebased diff.

**Weakest premise:** the per-name category in the research pass. An entry is cheap to correct, and the shrink-only check stops the list growing.
