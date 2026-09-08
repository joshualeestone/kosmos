---
pre_challenge: true
method: challenge-loop
branch: lifetime-1163
diff_hash: ad24698bd3ce310fb8c89e041eed5681fdb02214d62f6dfab12f8d907fa57b29
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T23:58:29Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 found 0 BLOCKER/WARNING/CONVENTION)
**Total findings:** 1 BLOCKER, 8 NITs (0 WARNINGs, 0 CONVENTIONs)
**Fixed:** 6 | **Deferred:** 3 (NITs: pre-existing untested glue; documented scope limits) | **Asked:** 0

Baseline (6.0) and every iteration's validation passed the full suite on a clean
tree. Three fresh blind agents reviewed independently. Iteration 2 caught a real
BLOCKER (a shared-function contract break); it was fixed with a regression guard
proven to go red on the pre-fix code, and iteration 3 confirmed convergence.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 3 NITs
- [NIT] mid-run persistence-flip double-note --> DEFERRED (documented as a deliberate cosmetic, warn-only scope limit in the lib).
- [NIT] "SURVIVES LOGOUT" over-claims beyond the two keys detected --> FIXED (2c29b5be): reworded to "carries a persistence key (RunAtLoad/KeepAlive)".
- [NIT] diff-only limitation (pre-existing leak not surfaced) --> DEFERRED (inherited from #566, documented).

#### Iteration 2
**New findings:** 1 BLOCKER, 1 NIT
- [BLOCKER] `lw_judge` has TWO consumers; only clean-machine.sh was updated. `sweep-leaked-supervisors.sh` (the REAPER) cased on REAL|UNKNOWN|SANDBOX with no default, so the new PERSIST verdict fell through silently: a persistent leaked job (the exact #1163 shape) was counted in FOUND but never LEAKED and never reaped, and with an empty "before" every persistent non-real job took that path -> `--reap` reports "nothing leaked" on the most dangerous job. --> FIXED (1507f208): `SANDBOX|PERSIST)` arm handles PERSIST at least as strongly as SANDBOX; added a sweep-test regression guard verified RED on the pre-fix sweep and GREEN on the fix.
- [NIT] flip-double-note cause stated narrower than actual trigger (read variance) --> FIXED (1507f208): comment broadened.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 3 NITs. Confirmed NO third consumer (whole-repo grep). Both tests wired into test:shell.
- [NIT] clean-machine.sh verdict-list comment stale (missing PERSIST) --> FIXED (5f0b68c2).
- [NIT] persistence grep unanchored to the top-level properties line --> FIXED (5f0b68c2, comment): noted as fail-safe (a false persist only upgrades to a non-failing warning, never a missed leak/false reap/false fail).
- [NIT] clean-machine PERSIST glue not exercised by a harness --> DEFERRED (matches the pre-existing untested SANDBOX glue arm; no regression).
**Converged.**

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | NIT | lib | flip double-note | DEFERRED | documented scope limit |
| 2 | 1 | NIT | clean-machine.sh | "survives logout" over-claim | FIXED | 2c29b5be |
| 3 | 1 | NIT | lib | diff-only limit | DEFERRED | inherited from #566, documented |
| 4 | 2 | BLOCKER | sweep-leaked-supervisors.sh | new PERSIST verdict swallowed by the reaper | FIXED | 1507f208 (+ regression guard) |
| 5 | 2 | NIT | lib | flip-note cause too narrow | FIXED | 1507f208 |
| 6 | 3 | NIT | clean-machine.sh | stale verdict-list comment | FIXED | 5f0b68c2 |
| 7 | 3 | NIT | lib | unanchored persistence grep | FIXED | 5f0b68c2 (noted fail-safe) |
| 8 | 3 | NIT | clean-machine.sh | PERSIST glue untested | DEFERRED | pre-existing pattern, no regression |

### NITs (deferred)
- mid-run persistence-flip double-note (cosmetic, warn-only, rare).
- diff-only surfacing inherited from #566 (a pre-existing unchanged leak is not surfaced).
- clean-machine PERSIST glue untested (matches the pre-existing untested SANDBOX arm).

### Strengths (across iterations)
- The escalation is genuinely non-failing (PERSIST only `say`s, never `fail`s), so it cannot reintroduce the #566 false-failure - verified by the persist-real->REAL and transient->SANDBOX arms.
- Persistence detection verified correct against real launchctl (`properties =` line, lowercase ` | `-separated; `-iE` matches runatload/keepalive without matching siblings).
- The reaper's merged SANDBOX|PERSIST arm reaps a plist-gone persistent job and leaves a plist-present one alone; the sweep regression guard is non-vacuous (red on the pre-fix sweep).
- Classification precedence is correct: persistence only ever escalates the SANDBOX bucket, never downgrades a REAL/OURS leak; a 2-field legacy line reads non-persistent so existing arms are unchanged.
