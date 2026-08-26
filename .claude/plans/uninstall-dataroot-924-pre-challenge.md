---
pre_challenge: true
method: challenge-loop
branch: uninstall-dataroot-924
diff_hash: 06fd4ee5c3da6cd8a8eda3006d0b4eb4a3c125575bc3a4e8192e54437537d395
subdir_audit: passed
timestamp: 2026-08-26T05:10:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 8 (0 BLOCKERs, 1 WARNING, 1 CONVENTION, 4 NITs, 5 STRENGTHs across iterations, some findings carry multiple observations)
**Fixed:** 2 (the WARNING and the CONVENTION) | **Deferred:** 0 | **Noted, not actioned (NITs):** 4

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs, 2 STRENGTHs
- [WARNING] tools/test-install.sh:1640-1644 — The debug-dump block added to diagnose the control scenario's install failure ran two `cat` calls with no `|| true` guard, under this file's `set -euo pipefail`. If the diagnostic ever fires again (a board failing before writing its own log), the `cat` on a missing file would abort the entire suite instead of just failing the one check. --> FIXED (commit 690d2d6): guarded both `cat` calls with `|| true` and added a comment explaining why.
- [CONVENTION] install/setup.sh:766-769 — The new belt-guard refusal used a hand-rolled `info` + `exit 1` sequence instead of the file's own `die()` helper, which is the established convention for every other fatal-exit path in this script (over a dozen call sites). --> FIXED (commit 690d2d6): routed through `die()`.
- [NIT] tools/test-install.sh:1602-1616 — The "belt" scenario reuses `$D924_KHOME` after its directory was already removed by an earlier scenario's uninstall, which reads oddly on a first pass. --> FIXED (commit 690d2d6): added a comment explaining this is deliberate (the guard is a pure env-var string comparison with no directory precondition).
- [NIT] install/setup.sh:766-768 — The refusal message only suggested "unset KOSMOS_HOME" as the fix, not the equally-valid "point AGENT_WORKFORCE_DATA at the sandboxed root instead". --> FIXED (commit 690d2d6): the die() message now names both remediation paths.
- [STRENGTH] The derivation is a faithful, minimal mirror of the existing #883 install-side pattern.
- [STRENGTH] Test coverage is a genuine vertical slice: each scenario plants an observable sentinel file outside the sandboxed walk and asserts survival/removal byte-for-byte, not just exit codes.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs, 3 STRENGTHs
**Duplicates of prior findings (confirmed resolved):** 0 (fresh agent, no overlap with iteration 1's fixed items — independently re-verified the derivation, the belt guard, and the die()/$LOG interaction from scratch and found them correct)
- [NIT] install/setup.sh:765 — No dedicated trailing-slash regression scenario for the new belt guard specifically (the file has this pattern for other guards). Low risk since normalization happens once, upstream, at file load. Not actioned — the existing upstream trailing-slash test (tools/test-install.sh:1416) already covers the shared normalization this guard relies on; adding a redundant per-guard copy did not seem worth the additional sandboxed install/uninstall cycle under tonight's machine load.
- [NIT] install/setup.sh:766 — `die()`'s `$LOG`-details line never fires from `uninstall()` (by design — uninstall() never calls `start_log()`), confirmed pre-existing and safe under `set -e`. Informational only, not a defect introduced by this change.
- [STRENGTH] The fix is correctly scoped to only what `uninstall()` actually reads (`AGENT_WORKFORCE_DATA` only, not a blind copy of all three install-side derivations).
- [STRENGTH] The belt guard independently re-derives both sides of its comparison rather than trusting the derivation above ran, and fails closed.
- [STRENGTH] Confirmed the plan's self-reported test-harness bug (a stray `AGENT_WORKFORCE_LAUNCH` override tripping the pre-existing #634 half-sandbox guard) checks out against the current code, and was fixed correctly (dropping the override) rather than worked around.

**Converged** — zero new BLOCKER/WARNING/CONVENTION findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/test-install.sh:1640-1644 | Unguarded `cat` in debug-dump block could abort the whole suite under `set -e` | FIXED | 690d2d6 |
| 2 | 1 | CONVENTION | install/setup.sh:766-769 | Belt refusal bypassed the file's own `die()` helper | FIXED | 690d2d6 |
| 3 | 1 | NIT | tools/test-install.sh:1602-1616 | Belt scenario reuses a removed directory, unexplained | FIXED | 690d2d6 |
| 4 | 1 | NIT | install/setup.sh:766-768 | Refusal message names only one of two valid fixes | FIXED | 690d2d6 |
| 5 | 2 | NIT | install/setup.sh:765 | No dedicated trailing-slash test for the new belt guard | DEFERRED | Covered by existing upstream normalization test; redundant per-guard copy not worth another sandboxed cycle tonight |
| 6 | 2 | NIT | install/setup.sh:766 | `die()`'s `$LOG` line never fires from uninstall (pre-existing, by design) | DEFERRED | Not a defect; informational |

### NITs (non-blocking, across all iterations)
- [NIT] tools/test-install.sh:1602-1616 — belt scenario directory reuse (iteration 1, fixed with a comment)
- [NIT] install/setup.sh:766-768 — refusal message completeness (iteration 1, fixed)
- [NIT] install/setup.sh:765 — no per-guard trailing-slash test (iteration 2, deferred)
- [NIT] install/setup.sh:766 — die()'s unused $LOG line under uninstall (iteration 2, deferred, pre-existing)

### Strengths (across all iterations)
- Uninstall-side derivation is a minimal, correctly-scoped mirror of the existing install-side #883 pattern (iteration 1, iteration 2)
- Belt guard independently re-derives both sides of its comparison and fails closed via die() (iteration 1, iteration 2)
- Test coverage plants observable sentinel files and asserts byte-for-byte survival/removal, not just exit codes, across all four scenarios (iteration 1, iteration 2)
- The plan's self-reported test-harness bug diagnosis (a stray env var tripping an unrelated pre-existing guard) was independently verified against the current code and confirmed correctly fixed (iteration 2)

### Note on full-suite verification

`tools/test-install.sh`'s full run was flaky tonight in an unrelated, pre-existing section (`update`, an unguarded `board.pid` read — filed separately as kosmos#935) due to sustained heavy machine load (13-16 load average, 18 agents resuming post-reboot plus a live release cut). The #924-specific scenarios were independently verified via isolated reproduction outside the full harness (all four scenarios: the exact incident, explicit-override precedence, the belt refusal, and the control case) both before and after this challenge loop's fixes, with clean results each time.
