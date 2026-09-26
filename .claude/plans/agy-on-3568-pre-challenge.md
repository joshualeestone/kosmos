---
pre_challenge: true
method: challenge-loop
branch: agy-on-3568
diff_hash: 8f85020bfe2ca58fd77c8e758efabf26a46301da2ac0abd5f3b267f53e4e9063
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T04:56:33Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 (reviewer models alternated opus / sonnet)
**Converged:** Yes (iteration 10: no BLOCKER; its one WARNING is a residual of the round 9 fix, recorded as accepted in the plan; NITs only otherwise)
**Total findings:** 9 BLOCKERs, about 40 WARNINGs, 10 CONVENTIONs, many NITs
**Fixed:** every BLOCKER and every WARNING that changed behaviour or copy | **Deferred:** recorded in the plan (Settings button #3874, auth-failed copy for PR 2, bounded_run #3859, untagged Gemini/Grok panes, install holding one request, installer checksum) | **Asked:** 0

Validation: full run on this head PASSED (hash 8f85020bfe2c). Earlier reds were load-bound timing tests untouched by the branch, each green alone. Browser checks run and passing via the runner: render-create-form, render-firstrun-keyed-connect-3658, render-provider-order-3651, render-keyed-install-3713, render-gemini-logo-3422, render-grok-subscription-3391, render-unread-edge-3743, render-agentdm-3414.

### Per-Iteration Breakdown
- **1 (opus):** BLOCKER "Restarted on Anthropic" after a switch; option sank below coming-soon rows; Gemini CLI downloaded for the subscription path; check opened Terminal as a side effect; a hung check could wedge later checks -> all FIXED.
- **2 (sonnet):** BLOCKERs install had no hard cap; switch copy named the program not the pick -> FIXED; Stop wired; no check spent on a fresh install.
- **3 (opus):** switched-off and Windows paths offered; Ready not connected; installer stdin open; sandboxed install into the real home; end-to-end flow untested -> FIXED.
- **4 (sonnet):** BLOCKERs saved pick not restored, create recovery and switch pre-refusal skipped it, false "Download complete" -> one predicate vendorPicksModel.
- **5 (opus):** copy pointed at a place that does not exist; one runner list; engine words -> FIXED.
- **6 (sonnet):** BLOCKER agyAsk returned nothing on the fetching path -> FIXED with a held-fetch test.
- **7 (opus):** BLOCKER account picker called it a key and pointed at Settings -> FIXED; strict "ok"; dropped install copy.
- **8 (sonnet):** saved pick raced the installed read -> awaited.
- **9 (opus):** await without staleness check; installer environment; tagline where not offered; Ready depended on accounts -> FIXED.
- **10 (sonnet):** no actionable findings. **Converged.**

### Final Ledger (highest severity)
| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | BLOCKER | web/index.html | "Restarted on Anthropic" after a switch | FIXED |
| 2 | 2 | BLOCKER | engine/agystatus.js | install had no hard cap | FIXED |
| 3 | 2 | BLOCKER | engine/create.js | switch copy named the program | FIXED |
| 4 | 4 | BLOCKER | web/index.html | saved pick / recovery / pre-refusal skipped antigravity | FIXED |
| 5 | 4 | BLOCKER | web/index.html | "Download complete" with nothing downloaded | FIXED |
| 6 | 6 | BLOCKER | web/index.html | agyAsk did not return its read | FIXED |
| 7 | 7 | BLOCKER | web/index.html | account picker called it a key | FIXED |
| 8 | 10 | WARNING | web/index.html | summary line waits for next repaint if accounts read fails | DEFERRED: residual, primary confirmations shown |
