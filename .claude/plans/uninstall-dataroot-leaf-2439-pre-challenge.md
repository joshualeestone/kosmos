---
pre_challenge: true
method: challenge-loop
branch: uninstall-dataroot-leaf-2439
diff_hash: 7eb6495f0f1f0be2ca47fa6653e41ed8cdfb093ce6c12df212403372d9634381
validation: passed
subdir_audit: passed
timestamp: 2026-09-10T18:31:32Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 3 (1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 1 NIT)
**Fixed:** 3 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (blind reviewer); 6.0 initial validation also ran and failed on the same defect
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above (findings are on the pre-existing test / the fix's coverage, not this loop's own output)
- [BLOCKER] tools/test-data-root-1511.sh — the fallback leaf change (/AgentWorkforce -> legacy-aware
  /Kosmos) breaks this existing delete-path test, which is wired into test:shell / yarn test (the
  canonical pre-PR gate) and asserted the old /AgentWorkforce fallback. 6.0's own validation
  independently failed with 9 FAILs in this file (deterministic on arms 2/11, plus arms 1/4/5/6/7/9g
  which compared against a hardcoded-AgentWorkforce EXP_DEFAULT using the runner's real $HOME) -->
  FIXED (commit 305be003): updated the assertions to the post-#2439 /Kosmos leaf, and pinned HOME to a
  fresh empty Application Support so the fresh-fallback arms are deterministic across boxes (the runner's
  real home may hold either leaf; a cut box carries the installed /Kosmos).
- [WARNING] install/setup.sh:1116 — behavioral change with no positive test exercising the new
  leaf-selection (fresh -> /Kosmos, legacy-only -> /AgentWorkforce, both-present -> /Kosmos) -->
  FIXED (commit 305be003): added arms 2b (legacy-only) and 2c (Kosmos present beside a lingering legacy
  folder), each building real directories to force each branch of the -d / ! -d selection.

#### Iteration 2
**Reviewer model:** sonnet (different model from iteration 1, per 6a rotation)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
**Converged** (zero blocking findings). The sonnet pass independently confirmed the setup.sh fallback
exactly mirrors the reviewed write-side pattern at :3522 and agrees with store.js maybeMigrateLegacyStore
semantics, that the result stays bounded by the five downstream refusals (which already accept both
leaves), and that pinning HOME weakens no other arm (refusal/box arms set their own HOME/env -i; consult
arms use $FAKE). It grepped setup.sh for other AgentWorkforce hardcodes and found none in the uninstall
path.
- [NIT] tools/test-data-root-1511.sh:40 — the pinned `HOME="$(mktemp -d)"` was never cleaned up, unlike
  every other mktemp in this file --> FIXED (commit 469cadbd): named it PINNED_HOME and removed it with
  FAKE/HELPER in the final cleanup.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | tools/test-data-root-1511.sh | BRANCH | stale test asserts old /AgentWorkforce fallback; gates yarn test | FIXED | 305be003 |
| 2 | 1 | WARNING | install/setup.sh:1116 | BRANCH | no positive test for the new leaf-selection | FIXED | 305be003 |
| 3 | 2 | NIT | tools/test-data-root-1511.sh:40 | BRANCH | pinned HOME mktemp not cleaned up | FIXED | 469cadbd |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] tools/test-data-root-1511.sh:40 — pinned HOME cleanup (iteration 2); FIXED in 469cadbd.

### Strengths (across all iterations)
- The fallback fix is a faithful, minimal mirror of an already-reviewed pattern (setup.sh:3522) rather
  than a novel derivation, and agrees with engine/store.js's dataRootFor default and migration semantics
  (iterations 1 and 2).
- The result stays bounded by the five downstream delete-path refusals, which already accept both leaves;
  the fix can never produce a broader/undelimited path than before (iteration 2).
- The two new test arms (2b/2c) build real directories to force each selection branch, so they are
  genuinely discriminating rather than vacuous on a delete-path test (iterations 1 and 2).
- Pinning HOME removes the prior nondeterminism (the runner's real box could carry either leaf) without
  weakening any other arm's explicit HOME/env-i overrides (iteration 2).
- The #931 root cause was reproduced in isolation on mortals (no build, no signing) and the fix verified
  there both arms before the loop (plan file).
