---
pre_challenge: true
method: challenge-loop
branch: worldswitch-escape
diff_hash: d4641e8eff55dca20a3a87c3da49f7fcc653032f6aeb4097b2f1b3130d18085d
validation: passed
subdir_audit: passed
timestamp: 2026-09-09T14:34:00Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (initial validation + 6 blind reviews, sonnet/opus/opus/sonnet/opus/sonnet)
**Converged:** Yes (iteration 6: 0 BLOCKER/WARNING/CONVENTION requiring a code change; only two cosmetic strings, fixed, + the documented weakest premise deferred)
**Total findings:** 2 BLOCKER (both fixed, one via redesign), several WARNING (fixed or deferred-with-reason), doc/convention/nits all resolved

#2528 fast-follow: Josh hit the world-switch lockout AGAIN on 0.6.50 (which has the #2528 guard). Verdict:
the guard recovers only after THRESHOLD=3 failed boots; a user gives up at the first "Kosmos could not
start" (Josh did), before recovery. Fix: a SET-ONCE per-world "confirmed" marker -- a world that has NEVER
served is abandoned to the default world on its FIRST failed reopen (recovers on reopen 1); a CONFIRMED
world keeps THRESHOLD=3. Engine-only (one board, launchctl-restarted, so recovery must be engine-side).

### Per-iteration
- **Iter 0 (validation):** clean baseline.
- **Iter 1 (sonnet):** [BLOCKER] a first design used a switch-time PENDING marker; a redundant no-op switch
  (server route models it as isNoop) re-armed the fast path on an established world -> false-abandon. Guarded
  by `id !== wasActive`; proven RED without the guard.
- **Iter 2 (opus):** [WARNING] the `id !== wasActive` guard keyed on the registry POINTER but the route's no-op
  keys on the BOOTED world; on an unmanaged board (pointer != booted) a switch-back re-armed the fast path on a
  healthy world. REDESIGNED to a set-once "confirmed" marker keyed on "has this world ever served?" -- removes
  the pointer/booted divergence at the root (setActiveWorld does no marker bookkeeping).
- **Iter 3 (opus):** 0 BLOCKER, no false-abandon path, recovery verified. Stale docblocks (THE GUARANTEE / THE
  MECHANISM described the old THRESHOLD-only model) FIXED; onError/pending asymmetry documented.
- **Iter 4 (sonnet):** 0 BLOCKER. A pre-existing test's comment overclaimed system behavior post-fix -> scoped
  it to the isAbandoned primitive AND added an explicit shouldAbandon companion assertion (adds coverage).
- **Iter 5 (opus):** 0 BLOCKER. [WARNING] THRESHOLD 3->2 reduction narrowed a confirmed world's force-quit
  tolerance (a mild false-abandon). REVERTED to 3: the never-served fast path fixes Josh independent of
  THRESHOLD, so the confirmed path's tolerance need not change (now identical to shipped 0.6.50).
- **Iter 6 (sonnet):** 0 BLOCKER, both abandon arms perturbation-verified + end-to-end confirmed, 7 STRENGTHs.
  Two cosmetic strings from the 2->3 revert (a stale "THRESHOLD 2" test message; an "8/8" plan count now 9)
  FIXED. Weakest premise (slow first-ever boot of a never-served world) DEFERRED with reasoning. CONVERGED.

### Final Ledger
| Iter | Cat | Where | Status |
|---|---|---|---|
| 1 | BLOCKER | switch-time pending marker re-armed by a no-op switch | FIXED then superseded by the iter2 redesign |
| 2 | BLOCKER/WARNING | pending marker keyed on pointer != booted world | FIXED (redesign to set-once confirmed marker) |
| 3 | CONVENTION | stale THRESHOLD-only docblocks | FIXED |
| 4 | WARNING | pre-existing test comment overclaimed | FIXED (scoped + added assertion) |
| 5 | WARNING | THRESHOLD 3->2 narrowed confirmed-world tolerance | FIXED (reverted to 3) |
| 5,6 | WARNING | slow first-ever-boot of a never-served world abandoned on reopen 1 | DEFERRED (documented weakest premise; self-correcting) |
| 6 | CONVENTION/NIT | stale "THRESHOLD 2" test string + "8/8" plan count | FIXED |

### Verification
full run-tests.sh EXIT=0 (5409 tests, 0 fail; browser-check surface gate 0 FAILED, #1720 N/A -- engine-only
change). engine/worldbootguard-2528.test.js 9/9. Both shouldAbandon branches proven non-vacuous by
perturbation across multiple iterations (dropping !isConfirmed reds the confirmed tests; disabling the
THRESHOLD branch reds the THRESHOLD tests). base/id consistency between markConfirmed (onListening) and
isConfirmed (bootstrapWorldEnv) verified. All fail-open.

### Strengths
[STRENGTH] Recovers Josh's real lockout on reopen 1 (never-served world abandons on the first failed reopen).
[STRENGTH] No false-abandon of a confirmed world by ANY switch (redundant / switch-back / pointer-divergent / force-quit): keying on "has it served?" not on a switch removes the whole class the iter1/iter2 pending design had.
[STRENGTH] THRESHOLD stays 3 -> a confirmed world's behavior is unchanged from shipped 0.6.50.
[STRENGTH] Fail-open biases toward recovery (unreadable state -> unconfirmed -> fall back to the working default), the safe direction for a lockout guard. No em dashes (5 spellings).
