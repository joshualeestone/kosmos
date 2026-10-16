---
pre_challenge: true
method: challenge-loop
branch: sbroot-6275
diff_hash: 25166621bcb338852e6742383c93c95a10e4b5c0c2d6cd3af5449843a3d67ddd
validation: passed
subdir_audit: passed
timestamp: 2026-10-16T02:42:58Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 21 (0 BLOCKERs, 6 WARNINGs, 0 CONVENTIONs, 15 NITs)
**Fixed:** 6 WARNINGs and 5 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: the first full validation (fab1e22's hash) failed 1 of 21,076 on cli.busy-health-4466.test.js:218, a
wall-clock arm in a file this branch does not touch (load average about 5.3). Solo runs: branch 2 pass, 1 fail; main
3 pass. Recorded on the open class card #5727. The re-run of the same commit passed: 20,833 pass, 0 fail, with this
branch's test in the run. Two earlier validations were stopped while still queued (never run) because the worktree
was edited after they joined.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/test-install-sbroot-6275.sh: compared setup.sh's form against the literal "$SB/home", never the
  harness's BOARD_LABEL_SUFFIX line (a mutant hashing "$SB//home" passed) --> FIXED (6e3c230): both real label lines
  lifted and compared
- [WARNING] tools/test-install-sbroot-6275.sh:28: a revert of the first line reds through the floor with a
  maintenance-sounding message --> FIXED (6e3c230): "changed shape" message naming #6252
- [NIT] setup.sh lines run under bash --> FIXED (under sh); [NIT] refusal stderr discarded --> FIXED (shown);
  [NIT] no TMPDIR unset or / arm --> left (plan: deliberate)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] the setup side used a hard-coded KOSMOS_HOME, not the harness's export --> FIXED (5e664ec): the first
  `export KOSMOS_HOME=` lifted
- [WARNING] only the first of setup.sh's two identical `_board_label=` lines lifted --> FIXED (5e664ec): all must be
  identical
- [NIT] lift spelling-tied (safe failure); [NIT] locals in run() --> FIXED; [NIT] plan measured claims (verified)

#### Iteration 3
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the run() harness side written in 5e664ec)
- [WARNING] the harness side computed its label without the harness's export (an equivalent refactor of line 604
  falsely red) --> FIXED (fab1e22)
- [WARNING] a new top-level KOSMOS_HOME rewrite in setup.sh (pwd -P) went unseen --> FIXED (fab1e22): count pinned at 3
- [NIT] a second export before line 604 unseen --> Known limits (plan); [NIT] a later $SB reassignment unseen -->
  Known limits; [NIT] over-long block mislabelled --> FIXED; [NIT] text compare of label lines --> Known limits

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.
- [NIT] the negative control also reds when the real squeeze is removed (extra line beside the real failure)
- [NIT] first-export and single-label positions (already in Known limits)
- [NIT] the plan's every-test-runs and mktemp-template measured lines sit under "Known limits" (placement only)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/test-install-sbroot-6275.sh:9 | BRANCH | harness label never read | FIXED | 6e3c230 |
| 2 | 1 | WARNING | tools/test-install-sbroot-6275.sh:28 | BRANCH | revert message misleading | FIXED | 6e3c230 |
| 3 | 2 | WARNING | tools/test-install-sbroot-6275.sh:58 | BRANCH | export not lifted | FIXED | 5e664ec |
| 4 | 2 | WARNING | tools/test-install-sbroot-6275.sh:32 | BRANCH | second label line unseen | FIXED | 5e664ec |
| 5 | 3 | WARNING | tools/test-install-sbroot-6275.sh:58 | SELF | harness side without export | FIXED | fab1e22 |
| 6 | 3 | WARNING | tools/test-install-sbroot-6275.sh:29 | BRANCH | new setup.sh rewrite unseen | FIXED | fab1e22 |

### NITs (non-blocking, across all iterations)
- no TMPDIR unset or / arm (iteration 1, deliberate)
- lift tied to exact spellings (iteration 2, fails safe)
- second export before line 604; later $SB reassignment; text compare of label lines (iteration 3, Known limits)
- negative control noise beside a real failure (iteration 4)
- plan section placement of two measured lines (iteration 4)

### Strengths (across all iterations)
- Lifts the real lines from both files rather than restating them, each with a floor (iterations 1 to 4)
- Real-file mutants each red for their own reason: label path, export path, second label line, setup.sh rewrite,
  strip removed, full revert (iterations 2 to 4)
- Wired into test:shell beside the #4298 test; tools.every-test-runs names it when unlisted (iterations 1, 4)
- Portable on BSD awk and mawk; scratch cleaned by trap (iterations 1, 3)
