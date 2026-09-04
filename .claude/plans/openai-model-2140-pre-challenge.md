---
pre_challenge: true
method: challenge-loop
branch: openai-model-2140
diff_hash: 44e4cbadee59889a67208e6859808636f31ac138e9ec80161cfc302566a475e7
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T20:57:25Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 9 (0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 5 NITs) + 1 synthetic (a validation-caught stale test)
**Fixed:** 8 | **Deferred:** 0 | **Asked:** 0

#2140 create-flow OpenAI model picker: engine seam (lift #245, per-account async validation),
create-form picker (paintOpenaiCreateModel), and the #1720 browser check.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 1 NIT
- [WARNING] the picker merged OpenAI models into the shared CREATE_MODELS, leaking them into the
  Claude create picker AND every Claude agent's detail picker --> FIXED (5705caae): a separate
  OPENAI_PICK_MODELS cache; paintModelWhy searches the union. Verified live.
- [WARNING] the Claude branch left stale OpenAI options + a stale-fetch race onto the Claude
  picker --> FIXED (5705caae): repaint from CREATE_MODELS + bump the generation on leaving OpenAI.
- [WARNING] setModel's auto label was null -> "null it is." copy --> FIXED (5705caae): label
  "OpenAI's default".
- [NIT] cross-vendor guard matched Claude keys only --> FIXED: key OR arg.

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] the Claude-branch repaint discarded a user's non-default Claude pick on a provider
  round-trip --> FIXED (7b4c07c6): LAST_CLAUDE_MODEL capture/restore. Verified live (opus survives).
- [NIT] regex allowed a leading dash --> FIXED: anchored first char to [A-Za-z0-9].
- [NIT] not-listable left OPENAI_PICK_MODELS stale --> FIXED: cleared.
- [NIT] a test docstring described the rejected merged design --> FIXED.

#### Synthetic (6g/6j full-suite validation)
- [BLOCKER] initial-validation: web.picker-provider-2097 "#2098 (source)" asserted the retired
  blanket `modelRow.hidden = openai` --> FIXED (387b95b2): re-pointed to the #2140 picker
  delegation; the no-stale-value invariant now via the browser check.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (both verified HARMLESS by the reviewer)
- [NIT] OPENAI_PICK_MODELS not cleared in the no-account branch --> applied (uniform lifecycle).
- [NIT] LAST_CLAUDE_MODEL never reset on reopen --> applied (reset in resetCreateProvider).
**Converged** — no actionable findings.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html | CREATE_MODELS pollution leaked OpenAI rows into Claude menus | FIXED | 5705caae |
| 2 | 1 | WARNING | web/index.html | Claude branch stale options + stale-fetch race | FIXED | 5705caae |
| 3 | 1 | WARNING | engine/create.js | setModel auto label null -> "null it is." | FIXED | 5705caae |
| 4 | 1 | NIT | engine/create.js | cross-vendor guard matched keys only | FIXED | 5705caae |
| 5 | 2 | WARNING | web/index.html | round-trip discarded a non-default Claude pick | FIXED | 7b4c07c6 |
| 6 | 2 | NIT | engine/create.js | regex allowed a leading dash | FIXED | 7b4c07c6 |
| 7 | 2 | NIT | web/index.html | not-listable left OPENAI_PICK_MODELS stale | FIXED | 7b4c07c6 |
| 8 | - | BLOCKER(synthetic) | web.picker-provider-2097.test.js | stale #2098 source assertion | FIXED | 387b95b2 |
| 9 | 3 | NIT x2 | web/index.html | cache/pick lifecycle tidiness (harmless) | FIXED | (this commit) |

### NITs (non-blocking)
- Covered above; all applied.

### Strengths (across all iterations)
- The provider seam is defense-in-depth: engine sync guard + async per-account route validation
  that fails open on uncertainty (#1916) and refuses only a definitive mismatch.
- OPENAI_PICK_MODELS kept separate from the Claude-only CREATE_MODELS prevents cross-flow leaks;
  the generation guard is race-free across provider AND account switches.
- Tests exercise the shipped functions (sliced from index.html, real engine calls asserting the
  plist -m slot); the browser check reds on origin/main.
- Surface-2 deferral is clean — no detail-page code touched; an OpenAI model reaches the
  change-model route only from the create surface.
