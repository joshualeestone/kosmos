---
pre_challenge: true
method: challenge-loop
branch: plusgate-flake-1615
diff_hash: d0ccbaedc4a7fcd81cfc64d1c5002f2389ce9cc18d4b667a7efbb14cbd016f40
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T22:50:09Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (the blind review returned zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 1 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT)
**Fixed:** 0 | **Deferred:** 1 (NIT) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
The blind reviewer verified the new settle condition against the product's own `paintPlus`
(web/index.html:23472): unenrolled -> state1 shown/flow hidden, enrolled -> state1 hidden/flow
shown, and the waits `want ? (fl>0 && s1===0) : (s1>0 && fl===0)` are the precise per-scenario
final shapes. Confirmed: `wantEnrolled = remote.enrolled === true` mirrors the fixtures AND the
product's gate; the race is closed at root and in the safe direction (a broken page now hard-fails
at the 5s timeout instead of the old XOR silently passing on the wrong single state); no both-0 /
both->0 hang is possible (paintPlus's three .hidden assignments are one synchronous block); the
unroute is correct (removes all handlers for the pattern, safe no-op on the first call, the two
patterns do not overlap); and every chk() assertion is unchanged, so the check still guards the
same behaviour.
- [NIT] docs/browser-checks/render-plus-gate-1615.js:82-83 — for the UNENROLLED scenario only, the
  wait is no stronger than the old XOR (the static loading state is byte-identical to the unenrolled
  final state) --> DEFERRED: harmless, the assert reads correct values either way, and the entire
  value of the fix lives in the enrolled scenario; the reviewer explicitly said "not worth changing".

**Converged** — no actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | NIT | render-plus-gate-1615.js:82-83 | unenrolled wait no stronger than old XOR (harmless) | DEFERRED | byte-identical states; value is in the enrolled arm |

### NITs (non-blocking)
- Recorded above; deferred with reasoning.

### Strengths
- The new settle condition matches `paintPlus` exactly and waits on the same `enrolled` signal the product gates on; the fix eliminates the race at root and in the safe direction (broken page -> hard 5s timeout red, vs the old XOR silently passing on the wrong state), so it strengthens the guard rather than masking regressions.
- Assertions are untouched (only the unroute + waitForFunction changed), so the check still guards the same behaviour; the enrolled switch-presence assertion remains the real guard and is not masked by the new wait.
- Validated empirically: 8/8 consecutive standalone runs pass (the check flaked ~50% before). The unroute is correct and safe; no both-visible/both-hidden hang is possible.
