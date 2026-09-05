---
pre_challenge: true
method: challenge-loop
branch: dock-copy-2240
diff_hash: 3a277116d2bf24e1e33573f25d8f77d65996c3ed014c3cc6345ab7e3a10a9219
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T18:21:27Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 returned nothing requiring a code change)
**Total findings:** 1 WARNING (out of scope), NITs; 0 BLOCKERs
**Fixed:** 0 code changes needed after iter 1 | **Deferred (carded):** 1 | **Asked:** 0

Change: the first-run Success-screen Dock copy (`web/index.html` `#fr-return-keep`) now says the icon is already in the Dock and to drag it to the far left, instead of "Drag Kosmos onto the Dock" (which made users drag a second instance). The tests/browser-checks that read this line were updated in lockstep so they stay meaningful. Validation: `node --test server.test.js` 264/264; the full browser harness (`tools/browser-checks.sh`) "all page checks passed", including the two changed checks click-first-run and render-first-run.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] web/index.html:9880 (Settings copy) - carries the same "drag onto the Dock" second-instance defect, out of the install-flow scope --> DEFERRED: filed as #2258.
- [NIT] commit message named the Settings copy at :9878 and called it "same wording" --> CORRECTED in the plan file (:9880, same defect / different string).
- Strengths: copy keeps the DRAG verb (LSUIElement) and no "Keep in Dock"; the leakage guards use the new string so they are not vacuous; the browser-checks positively pin the new copy.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** - "nothing requires a code change."
- [NIT] the positive pin lives only in the browser checks (server.test.js has only negative leakage guards) - pre-existing architecture, acknowledged in the plan.
- [NIT] frApplyPlatformCopy rewrites this line on non-Mac, so the present-assertions presume macOS - pre-existing, unaffected by this change.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:9880 | Settings copy has the same defect | DEFERRED | #2258 (out of scope) |
| 2 | 1 | NIT | (commit msg) | Settings line/wording inaccuracy | FIXED | corrected in plan |
| 3 | 2 | NIT | server.test.js | positive pin only in browser checks | DOCUMENTED | pre-existing |
| 4 | 2 | NIT | web/index.html frApplyPlatformCopy | present-assertions presume macOS | DOCUMENTED | pre-existing |

### Outstanding questions (ASKED)
None.

### NITs (non-blocking)
- The positive copy assertion lives in the step-3b browser harness, not the unit suite (pre-existing).
- The Dock line is macOS-only copy (non-Mac gets a different string via frApplyPlatformCopy).

### Strengths
- Keeps the DRAG verb and avoids the unreachable "Keep in Dock" (LSUIElement); both browser-checks keep their !/Keep in Dock/ guard.
- The server.test.js leakage guards were updated to the NEW string, so they still test that the line does not leak into the repainted region rather than checking a now-nonexistent string (not vacuous).
- click-first-run.js positively asserts BOTH halves of the new copy on the Success screen, so it cannot silently drift back; render-first-run asserts present-on-Success / absent-on-last-step.
- Browser harness verified the rendered copy end to end (all page checks passed).
