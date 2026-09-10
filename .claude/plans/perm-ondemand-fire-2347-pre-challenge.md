---
pre_challenge: true
method: challenge-loop
branch: perm-ondemand-fire-2347
diff_hash: 5c11ad29b8d7540e098c4d32c71b8050e5ecd6a607f91d1b19c35a7bfe21959c
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T23:54:56Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (6.0 baseline validation + 2 blind review passes)
**Converged:** Yes (iteration 2 returned zero findings)
**Total findings:** 2 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT)
**Fixed:** 2 | **Deferred:** 0 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 baseline validation)
JS/shell suite + browser-check gate: PASSED (native-app + test change, no web/, gate correctly does not fire). Swift `-typecheck` clean; native suite green.

#### Iteration 2 (blind review)
**New findings:** 0 BLOCKERs, 1 WARNING, 1 NIT — both stale comments my change left behind. Fixed.
- [WARNING] native-app/main.swift (consumeRequest staleness comment) — said "a11y has a launch-time axprompt anyway; this matters most for the file-access request" — false after removing the launch axprompt (neither fires at launch now). --> FIXED (reworded: the 30s drop matters equally for both requests).
- [NIT] native-app/main.swift (startPromptRequestWatcher doc) — attribution "exactly as the launch-time axprompt is" — dangling reference. --> FIXED (reworded to the launch axcheck spawn, and re-scoped the KOSMOS-vs-tmux identity to item B/#2125).

#### Iteration 3 (blind review)
**New findings:** 0. **Converged.** The reviewer confirmed: launch a11y prompt cleanly removed while axcheck (launch+timer) and the on-demand axprompt path stay intact; `a11yPromptFired`/`currentlyTrusted()` fully removed with zero live refs; the re-anchored test assertion is non-vacuous and robust (call-form match, stable slice); no stale comment survives; on-demand firing covered by perm-prompts-2189; Swift typechecks; suites green.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 2 | WARNING | native-app/main.swift | stale consumeRequest launch-axprompt comment | FIXED | 599113b0 |
| 2 | 2 | NIT | native-app/main.swift | stale startPromptRequestWatcher attribution comment | FIXED | 599113b0 |

### Verification tiers (same posture as #2371)
- TIER-1 (done): source wiring pinned (launch fires only axcheck, not axprompt; on-demand path intact); Swift typecheck clean; native suite green.
- TIER-2 (Josh's fresh-account re-test): the a11y prompt appears on the Access-screen tmux Turn-On, not at launch, and the tmux step reads "Needs Activated" (cascade resolved). Baron holds the cut; rides the next re-test.

### Scope
Item A (fire-timing) of Josh's 0.6.41 re-test. Item B (KOSMOS-vs-TMUX identity) is a separate #2125/#2188 rework; the definitive answer (correct identity is tmux; the KOSMOS label is the bug — the Accessibility API reports the calling binary, not the responsible process) was reported to Splinter/Josh. A does not depend on B (the fire-timing fix removes the launch prompt regardless of which binary the prompt attributes to).

### Strengths (blind review)
- Launch prompt removed cleanly; axcheck + on-demand paths intact; dead code fully removed; Swift typechecks.
- Re-anchored test guard is robust and can return the dangerous answer (call-form match avoids the guard-tripped-by-its-own-documentation trap; stable func-definition anchors).
- Removed-tests decision loses no coverage (subjects deleted; on-demand covered by perm-prompts-2189).
- No em dashes; A/B split accurate.
