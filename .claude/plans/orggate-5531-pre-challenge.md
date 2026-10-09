---
pre_challenge: true
method: challenge-loop
branch: orggate-5531
diff_hash: 5cf6fd85fbac363d9433135ebf3deb3378ca0a575b27ad1e24aa0fff28f658ae
validation: passed (Mortals full suite at 1efdad1fa, hash 5cf6fd85fbac)
subdir_audit: passed
timestamp: 2026-10-09T00:07:25Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4, each a fresh blind reviewer, alternating Opus (odd) and Sonnet (even).
**Converged:** Yes, at iteration 4 (Sonnet): its two warnings were a duplicate of a kept iteration-3 NIT and a bounded, documented behaviour the reviewer explicitly did not ask to change. **Total findings:** 0 BLOCKERs, 6 WARNINGs fixed (1 deferred with reason, 1 duplicate), plus NITs as marked.
**Validation:** render-orgenroll-5531.js all checks (O0, O1, O17a-c, O6 included); each fix's mutation made it fail; the browser-check surface gate passes; full suite on Mortals at the head named above.

## Ledger (verbatim, iteration by iteration)

# orggate-5531 ledger
#### Iteration 1 (Opus) on 721b09749
- [WARNING] (1) markup starts visible; failed read shows full box. FIXED (hidden in markup; O17a; mutation reddens).
- [WARNING] (2) O0 waited on an always-visible element. FIXED (waits for the GET).
- [WARNING] (3) mobile-shots plus-org-consent did not click opener. FIXED.
- [WARNING] (4) joined fresh page untested. FIXED (O17b; mutation reddens).
- [NIT] repaint after message FIXED; id rename FIXED; stays open (kept).
#### Iteration 2 (Sonnet) on f215b6d4a
- [WARNING] (5) msgOn coupling fragile for future writers ("not a bug today"). FIXED as documented rule at the line.
- [NIT] open:false declared FIXED; first paint redundant, mutation visibility (kept).
#### Iteration 3 (Opus) on 8116c95ce
- [WARNING] (6) company-note opening untested on a fresh page. FIXED (O17c; mutation reddens).
- [NIT] p2 pageerror FIXED; README O17 FIXED; first paint removed; joined+failed read shows opener (kept).
#### Iteration 4 (Sonnet) on 1efdad1fa: CONVERGED
- [WARNING] dup (iter-3 NIT kept): joined Kosmos with a failed first read shows the opener.
- [WARNING] (7) a company note keeps the block open after the server stops sending it: DEFERRED, the reviewer: "bounded and harmless, documented at msgOn, not asking for a change".
- [NIT] paint after body (nothing throws), focus untested, render-fields to confirm in validation (kept).
- ZERO NEW actionable B/W/C -> CONVERGED at iteration 4.
