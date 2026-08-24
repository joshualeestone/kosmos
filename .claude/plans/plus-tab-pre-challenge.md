---
pre_challenge: true
method: challenge-loop
branch: plus-tab
diff_hash: f8f8b09eeb027d7ef88ffcbe8b4aebe8e0f8c0321e8a737b172956a031b68be1
subdir_audit: passed
timestamp: 2026-08-24T00:39:07Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes, by the pre-set stopping rule (round two's findings all sat in round one's fixes; five small ones applied and verified).
**Total findings:** 12 (2 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 5 NITs)
**Fixed:** 12 | **Deferred:** 0

### Per-Iteration Breakdown

#### Iteration 1 (both blockers were mine, both built against assumed contracts)
- [BLOCKER] the confirm called setupComplete(email, code) against a (code, name) engine: every confirm 400ed with a dishonest sentence, invisible because only refusal paths were tested --> FIXED: correct order, the name field the engine requires, and a success-path route test with a fake binary
- [BLOCKER] nothing told the engine the board's port, so the switch could never produce a connection --> FIXED: ensure(bound port) at boot inside onListening, source-pinned fail-closed
- [WARNING] the copy promised a text the machinery cannot send --> FIXED: email-code wording end to end
- [WARNING] only refusal paths tested --> FIXED (the success-path test above)
- [WARNING] the switch toggled re-fetched state, not its own label's intent --> FIXED
- [CONVENTION] setOn coerced instead of letting the engine refuse --> FIXED: raw
- [NIT] ENOENT relayed verbatim --> FIXED: the person sentence, keyed on the engine's spawn-failure shape (tightened in round two)
- [NIT] narrow leak pins / fail-open slice anchor --> FIXED

#### Iteration 2 (stopping rule fired)
- [WARNING] maxlength truncated pasted codes before any trim --> FIXED: the field normalizes itself on input
- [WARNING] plusWords keyed on bare ENOENT --> FIXED: the spawn-failure shape only
- [NIT] boot pin fail-open anchor --> FIXED
- [NIT] email residue in the shared fixture --> FIXED: cleared in finally
- [NIT] name pre-validation --> FIXED: the engine's own sentence, client-side

### Strengths (from the reviewers)
- Route hygiene by construction (crossSiteWrite covers the new writes)
- The holding place genuinely has zero controls and the flow starts hidden
- The boot ensure verified safe in every repeat-start context (unconfigured no-ops)
- The label-intent switch sound end to end; double-clicks harmless by idempotence
