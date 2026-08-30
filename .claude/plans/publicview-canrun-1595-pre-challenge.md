---
pre_challenge: true
method: challenge-loop
branch: publicview-canrun-1595
diff_hash: ce71bf1e93b6bb7d0da9c5de39ad35c55a2d54c38156dc8e618828cbc8c26525
validation: passed
subdir_audit: passed
timestamp: 2026-08-30T14:18:38Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (a clean 6.0 baseline + 1 independent blind review pass)
**Converged:** Yes
**Total findings:** 1 NIT (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs)
**Fixed:** 0 | **Deferred:** 1 NIT | **Asked:** 0

The change adds `canRunClaude` to `publicView` in engine/connect.js so the STUCK
screen's escape hatch (gated on that field in web/index.html) reaches the client;
the field was computed and written by becomeStuck but never served. web/index.html
is not touched (its read already exists). engine/connect.js plus a new test.

### Per-Iteration Breakdown

#### Iteration 1 (blind review 1)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
- **Converged** on actionable findings. 4 STRENGTHs: the fix is correct
  (`|| false` maps the only-ever-boolean field's undefined to false with no
  coercion of a real value); the completeness thesis (canRunClaude was the ONLY
  dropped field) verified independently (st.error is the /api/connect/start
  error-response body, st.willInstall reads FR.connect from /api/first-run, both
  correctly excluded); no regression surface (no exact-shape or export-set
  assertion exists); conventions clean.
- [NIT] engine.publicview-canrun-1595.test.js -- the unit test drives publicView
  directly, so it would not catch a future change that made /api/connect stop
  routing a stuck state through publicView (server.js:3683 builds an inline
  unsure-phase object that bypasses it). A route-level test would be marginally
  more faithful --> DEFERRED: driving a real STUCK state needs a full
  failing-flow harness (becomeStuck is reached only through ~15 real failure
  paths, no force-seam) for marginal gain; the one bypass (3683) is the
  defensive unsure-error path, a different phase that correctly omits
  canRunClaude; state() -> publicView for every non-idle phase is trivial and
  verified. The loop is closed by the unit test (server sends it) plus the
  existing client-half pin at server.connect.test.js:797 (client reads it). The
  reviewer's own recommendation was that it is not required.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | NIT | engine.publicview-canrun-1595.test.js | Unit test cannot catch a future publicView bypass | DEFERRED | Route test needs a failing-flow harness; loop closed by unit + existing client test |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking)
- [NIT] A route-level test (fetch /api/connect on a driven stuck state) would be
  marginally more faithful than the direct publicView unit test (iteration 1).
  Deferred, reviewer agreed not required.

### Strengths (across all iterations)
- The fix is correct: canRunClaude is only ever true/false/undefined (becomeStuck
  is the only writer), so `|| false` maps undefined to false and preserves the
  real value; false on every non-stuck phase is the correct default.
- The completeness thesis holds under independent verification: the card's
  suggested sweep of every st.<field> the connect flow reads confirms
  canRunClaude was the only genuine drop.
- No regression surface: adding the field and exporting publicView break nothing
  (no exact-shape or export-set assertion); the pre-existing client canRunClaude
  tests are harness-injected and unaffected.
- The test reds on revert and guards the pre-existing fields via a key loop.
