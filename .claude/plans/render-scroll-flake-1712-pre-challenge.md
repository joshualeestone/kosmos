---
pre_challenge: true
method: challenge-loop
branch: render-scroll-flake-1712
diff_hash: 159f9af5466f5e9df4b68005fed108352e0f36e52c211fa1939bebca0347f2ff
validation: passed
subdir_audit: passed
timestamp: 2026-09-01T01:25:00Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 returned zero actionable BLOCKER/WARNING/CONVENTION after deferral)
**Total findings:** 8 (0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs)
**Fixed:** 5 | **Deferred:** 3 | **Asked:** 0

kosmos#1712. `docs/browser-checks/render-room-scroll.js` flaked under concurrent
load and reded correct releases (signature h:4715, rewrote:false, "nothing was
added"), forcing a 20-minute fleet-wide quiet window before the 0.6.20 cut.
Verified root cause: `paintRoom`->`setLive` writes innerHTML + `__lastLive`
SYNCHRONOUSLY (web/index.html:18883); the arms that inject a client-only change
then WAITED a fixed time before measuring, and during that wait a background
`loadRoom` poll could re-fetch the server body (no injection) and REVERT it. The
fix measures on the first synchronous iteration of a bounded poll, before any
await, so the revert cannot happen; a genuine no-repaint/no-grow still fails.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
- [WARNING] render-room-scroll.js:124,135,365,367 -- the two scrollable arms' FAIL base names diverged from their PASS names, breaking signature-matching --> FIXED (76f2e6c7): kept the base name matched, diagnosis in the reason.
- [WARNING] render-room-scroll.js -- a broken FIXTURE (posted<20) made the three growth polls each burn the full window (3x15s=45s) --> FIXED (76f2e6c7): GROW_MS = posted>=20 ? 15000 : 1000, so a setup failure fails fast.
- [NIT] render-room-scroll.js -- catch-branch `el` deref unguarded --> FIXED (76f2e6c7): return {h:0,c:0} if the room is gone.

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] render-room-scroll.js:161,386 -- the two 120ms `rewrote` arms share the EXACT background-poll-revert race (not a different one), and my plan's "safe unless rAF-batched" rationale misnamed the mechanism --> FIXED (33ffe6c0): fixed arms 1 (moved) and consMoved with the same first-synchronous-iteration pattern; corrected the plan and arm 6's comment to the verified mechanism (traced setLive/loadRoom in web/index.html).
- [NIT] render-room-scroll.js:348 -- the last fixed waitForTimeout(900) before the consolidated layout check was redundant --> FIXED (33ffe6c0): bounded waitForFunction for the .consolidated class; consOn still reports a real no-switch.
- [NIT] render-room-scroll.js -- comments framed the cause as "slow async paint" for the client-only-injection arms --> FIXED (33ffe6c0): corrected to the background-poll-revert mechanism.

#### Iteration 3
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Converged** -- both findings are non-actionable and deferred with reasoning:
- [WARNING] render-room-scroll.js:107 -- a genuinely broken PRODUCT (posted>=20 but never grows/repaints) can make the check take up to ~75s to fail --> DEFERRED: never a false pass (reviewer's own words: "acceptable for a release gate, not a correctness bug"); it is the inherent cost of a bounded wait, the addressable setup-failure case is already fast via GROW_MS, and reducing the bound would trade away the load-robustness that is the entire point of the fix.
- [NIT] render-room-scroll.js:132,385 -- bare `catch {` vs the file's `catch (e)` style --> DEFERRED: cosmetic, both valid on Node; `catch {` avoids an unused binding.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | render-room-scroll.js:124/365 | scrollable FAIL/PASS name divergence | FIXED | 76f2e6c7 |
| 2 | 1 | WARNING | render-room-scroll.js | 45s on a broken fixture | FIXED | 76f2e6c7 |
| 3 | 1 | NIT | render-room-scroll.js | unguarded catch el deref | FIXED | 76f2e6c7 |
| 4 | 2 | WARNING | render-room-scroll.js:161/386 | 120ms arms share the race; wrong rationale | FIXED | 33ffe6c0 |
| 5 | 2 | NIT | render-room-scroll.js:348 | redundant fixed 900ms | FIXED | 33ffe6c0 |
| 6 | 2 | NIT | render-room-scroll.js | comments misnamed the mechanism | FIXED | 33ffe6c0 |
| 7 | 3 | WARNING | render-room-scroll.js:107 | ~75s to fail a broken product | DEFERRED | inherent, never a false pass |
| 8 | 3 | NIT | render-room-scroll.js:132 | bare catch style | DEFERRED | cosmetic |

### Outstanding questions (ASKED)
None.

### Validation
`yarn test:shell` (all checks passed) and the full `yarn test` (3348 tests, 0
fail) both green. The change itself was validated by reproducing the exact
failure before the fix, then running the check clean alone, 4x concurrent, and
twice under a concurrent full suite -- zero fails. The `posted>=20` "nothing was
added" control is untouched.

### NITs (deferred, non-blocking)
- [NIT] render-room-scroll.js -- bare `catch {` style vs `catch (e)` (iteration 3); cosmetic.

### Strengths (across all iterations, verified by the reviewers tracing the product)
- setLive/paintThreadInto/pinToBottom are synchronous (web/index.html), so first-iteration measurement captures the injected state before any background poll can revert it -- the load-bearing fact of the fix, independently confirmed twice.
- Every arm still FAILS on a real defect: arm 6 requires BOTH rewrote AND growth; the scrollable arms surface a never-scrollable room via the waitForFunction timeout into a bad(); the repaint arms leave __lastLive unchanged on a genuine no-repaint and fail the rewrote arm.
- The scrollable arms key on a server-painted growth signal, so the revert class cannot touch them; waitForFunction is the right tool there.
- GROW_MS gates every bounded wait and reaches every in-page loop; the posted>=20 control is intact; no em dashes in added lines.
