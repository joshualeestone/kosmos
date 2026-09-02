---
pre_challenge: true
method: challenge-loop
branch: cutmarker-1796
diff_hash: 751271b54dfaf9ef477b138ba78bbf8eb455ad45ee3166240d6fe663be836e15
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T13:18:53Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 returned zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 1 WARNING, 1 CONVENTION, 6 NITs (all fixed); many STRENGTHs
**Fixed:** all | **Deferred:** 0 | **Asked:** 0

**Validation note (release-critical guard):** targeted -- `bash tools/test-cut-guard.sh` = 28 arms,
0 failures (20 pre-existing + 8 new marker arms), incl. the M6 release-outage arm (a run marks
itself then checks -> does NOT refuse itself), confirmed red-capable by the iteration-3 reviewer.
`bash -n` clean on all four touched scripts. Full `run-tests.sh` withheld under the standing
no-local-full-suite constraint (kosmos#1796 is this very card about that guard); the `test` CI runs
the suite on the PR.

### Per-Iteration Breakdown

#### Iteration 1
**New:** 0 BLOCKER, 1 WARNING, 1 CONVENTION, 3 NIT
- [WARNING] the fix MITIGATES but does not ELIMINATE the reparent race (the OR'd name arm keeps its
  walk). --> FIXED (69a504d6): code header + plan made explicit; follow-up (retire the name arm once
  markers universal) named. Non-regressing; must not be read as "race closed."
- [CONVENTION] the M6 self-mark (release-outage) arm was uncommitted. --> FIXED: committed.
- [NIT] harden kosmos_mark_run ordering (export cookie before marker write; bail on empty type).
- [NIT] name the kill -0 EPERM (foreign-user miss) and lazy per-type cleanup residuals. --> FIXED.

#### Iteration 2
**New:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 2 NIT
- [NIT] key the marker dir off $HOME, not $TMPDIR, so TMPDIR-divergent runs still cross-detect. -->
  FIXED (b5a7c52b): ~/.cache/kosmos-run-markers.
- [NIT] note that <type> must be a shell identifier. --> FIXED (header).

#### Iteration 3
**New:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 2 NIT
**Converged** -- no new actionable findings.
- [NIT] the reboot comment over-claimed "only dead-pid markers." --> FIXED: cross-references the
  pid-reuse residual.
- [NIT] enforce the <type>-is-identifier invariant at runtime, not only in a comment. --> FIXED:
  `case "$type" in *[!A-Za-z_]*) return 0 ;;`.

### Final Ledger

| # | Iter | Category | Description | Status | Resolution |
|---|------|----------|-------------|--------|------------|
| 1 | 1 | WARNING | mitigates-not-eliminates the race (must not read as closed) | FIXED | 69a504d6 (doc) |
| 2 | 1 | CONVENTION | M6 release-outage arm uncommitted | FIXED | 69a504d6 |
| 3 | 1 | NIT | mark-run ordering / residual naming | FIXED | 69a504d6 |
| 4 | 2 | NIT | marker dir off $HOME (TMPDIR-independent) | FIXED | b5a7c52b |
| 5 | 3 | NIT | reboot comment / runtime type guard | FIXED | (iter3 commit) |

### Strengths (across iterations)
- Export-before-write closes the self-refoot outage window structurally; the OR reduces provably to
  the prior behavior when no marker exists, so it cannot regress the name arm.
- Test additions non-vacuous and red-capable -- notably M6, which directly guards the total-release-
  outage failure mode; marker-dir isolation keeps all 20 pre-existing arms genuinely inert.
- Every failure mode is safe-direction (over-refuse) and every residual (pid-reuse, foreign-user
  EPERM-reads-as-stale, lazy per-type cleanup, name-arm race) is named with its bound and backstop,
  matching the file's convention.
- Header/plan scrupulously honest that this MITIGATES, does not ELIMINATE, the race, and rests the
  change on the certain grounds (structural run-vs-work split + race-free marker path).
